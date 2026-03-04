
    // 4. Server load
    health.checks.serverLoad = {
        status: connectedUsers.size < 1000 ? 'ok' : 'high',
        activeConnections: connectedUsers.size,
    };

    // 5. Recent upload error rate from AI interceptor
    try {
        const aiStatus = aiErrorInterceptor.getStatus();
        const uploadErrors = (aiStatus.stats.byCategory || {}).UPLOAD || 0;
        health.checks.recentErrors = {
            uploadErrors,
            overallStatus: aiStatus.status,
        };
    } catch (e) {
        health.checks.recentErrors = { status: 'unknown' };
    }

    // 6. Storage file count (async to avoid blocking event loop)
    try {
        const files = await fs.promises.readdir(uploadsDir);
        health.checks.storage = { fileCount: files.length, status: files.length < 50000 ? 'ok' : 'warning' };
        if (files.length >= 50000) {
            health.issues.push('high_file_count');
            health.recommendations.push('Server has many files. Cleanup may be needed.');
        }
    } catch (e) {
        health.checks.storage = { status: 'error', error: e.code };
    }

    // 7. Spaceship backup status
    health.checks.spaceshipBackup = {
        configured: !!SPACESHIP_FTP.password,
        retryQueueSize: spaceshipRetryQueue.length,
        status: SPACESHIP_FTP.password ? (spaceshipRetryQueue.length < 10 ? 'ok' : 'backlog') : 'not_configured',
    };
    if (spaceshipRetryQueue.length >= 10) {
        health.issues.push('spaceship_backlog');
        health.recommendations.push(`${spaceshipRetryQueue.length} files waiting for Spaceship replication.`);
    }

    // 8. Upload success rate metrics
    const successRate = uploadMetrics.getSuccessRate();
    health.checks.uploadMetrics = {
        successRate: Math.round(successRate * 100) / 100,
        avgResponseTime: uploadMetrics.getAvgResponseTime(),
        totalRequests: uploadMetrics.requestCount,
        successCount: uploadMetrics.successCount,
        failureCount: uploadMetrics.failureCount,
        windowStart: new Date(uploadMetrics.lastReset).toISOString(),
        status: successRate >= 0.95 ? 'ok' : successRate >= 0.8 ? 'warning' : 'critical'
    };
    if (successRate < 0.8 && uploadMetrics.requestCount >= 10) {
        health.issues.push('low_upload_success_rate');
        health.recommendations.push('Upload success rate is ' + Math.round(successRate * 100) + '%. Investigation recommended.');
        health.healthy = false;
    }

    res.json(health);
});

// Quick health ping for upload pre-check (ultra-fast response)
app.get('/api/ping', (req, res) => {
    res.json({ ok: true, t: Date.now() });
});

// Live stats API
app.get('/api/live-stats', (req, res) => {
    res.json({
        success: true,
        ...getLiveStats()
    });
});

// Note: Version API moved to line ~196 using VERSION_INFO constant

// ============ DEMO SYSTEM - $3.33/month ============
const DEMO_DURATION = 60 * 60 * 1000; // 1 hour in ms
const MONTHLY_PRICE = 333; // $3.33 in cents
const demosDbPath = path.join(dataDir, 'demos.json');
const subscriptionsDbPath = path.join(dataDir, 'subscriptions.json');

async function loadDemosDb() {
    return await dbUtils.loadJSON(demosDbPath, { demos: [] });
}

async function saveDemosDb(data) {
    return await dbUtils.saveJSON(demosDbPath, data);
}

async function loadSubscriptionsDb() {
    return await dbUtils.loadJSON(subscriptionsDbPath, { subscriptions: [] });
}

async function saveSubscriptionsDb(data) {
    return await dbUtils.saveJSON(subscriptionsDbPath, data);
}

// Start demo - register device
app.post('/api/demo/start', express.json(), async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ success: false, error: 'Device ID required' });

    const demosDb = await loadDemosDb();
    const existing = demosDb.demos.find(d => d.deviceId === deviceId);

    if (existing) {
        if (existing.paid) {
            return res.json({ success: true, status: 'paid', deviceId });
        }
        const elapsed = Date.now() - new Date(existing.startTime).getTime();
        if (elapsed >= DEMO_DURATION) {
            return res.json({ success: false, status: 'expired', deviceId, message: 'Demo expired. Subscribe to continue.' });
        }
        return res.json({ success: true, status: 'active', deviceId, remainingSeconds: Math.floor((DEMO_DURATION - elapsed) / 1000) });
    }

    // New demo
    const demo = {
        id: uuidv4(),
        deviceId,
        startTime: new Date().toISOString(),
        paid: false,
        createdAt: new Date().toISOString()
    };
    demosDb.demos.push(demo);
    await saveDemosDb(demosDb);

    res.json({ success: true, status: 'started', deviceId, remainingSeconds: DEMO_DURATION / 1000 });
});

// Check demo status
app.get('/api/demo/status/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    const demosDb = await loadDemosDb();
    const demo = demosDb.demos.find(d => d.deviceId === deviceId);

    if (!demo) return res.json({ success: false, status: 'not_found', deviceId });

    if (demo.paid) return res.json({ success: true, status: 'paid', deviceId });

    const elapsed = Date.now() - new Date(demo.startTime).getTime();
    if (elapsed >= DEMO_DURATION) {
        return res.json({ success: false, status: 'expired', deviceId });
    }

    res.json({ success: true, status: 'active', deviceId, remainingSeconds: Math.floor((DEMO_DURATION - elapsed) / 1000) });
});

// ============ PROMO CODE API ============

const promoCodesPath = path.join(__dirname, 'data', 'promo-codes.json');

async function loadPromoCodes() {
    return await dbUtils.loadJSON(promoCodesPath, { codes: {} });
}

async function savePromoCodes(data) {
    return await dbUtils.saveJSON(promoCodesPath, data);
}

// Validate promo code
app.post('/api/promo/validate', express.json(), (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.json({ valid: false, message: 'No code provided' });
        }

        const data = loadPromoCodes();
        const upperCode = code.toUpperCase();
        const promo = data.codes[upperCode];

        if (!promo) {
            return res.json({ valid: false, message: 'Invalid promo code' });
        }

        if (!promo.active) {
            return res.json({ valid: false, message: 'This code is no longer active' });
        }

        if (promo.validUntil && new Date(promo.validUntil) < new Date()) {
            return res.json({ valid: false, message: 'This code has expired' });
        }

        if (promo.maxUses && promo.usedCount >= promo.maxUses) {
            return res.json({ valid: false, message: 'This code has reached its usage limit' });
        }

        res.json({
            valid: true,
            code: upperCode,
            discount: promo.discount,
            description: promo.description
        });
    } catch (error) {
        res.json({ valid: false, message: 'Error validating code' });
    }
});

// Use promo code (called when subscription is created)
app.post('/api/promo/use', express.json(), (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.json({ success: false });
        }

        const data = loadPromoCodes();
        const upperCode = code.toUpperCase();

        if (data.codes[upperCode]) {
            data.codes[upperCode].usedCount = (data.codes[upperCode].usedCount || 0) + 1;
            savePromoCodes(data);
            return res.json({ success: true });
        }

        res.json({ success: false });
    } catch (error) {
        res.json({ success: false });
    }
});

// Admin: Get all promo codes
app.get('/api/admin/promo-codes', (req, res) => {
    try {
        const data = loadPromoCodes();
        res.json({ success: true, codes: data.codes });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Admin: Create/update promo code
app.post('/api/admin/promo-codes', express.json(), (req, res) => {
    try {
        const { code, discount, description, maxUses, validUntil, active } = req.body;

        if (!code || !discount) {
            return res.status(400).json({ success: false, error: 'Code and discount required' });
        }

        const data = loadPromoCodes();
        data.codes[code.toUpperCase()] = {
            discount: parseInt(discount),
            description: description || '',
            maxUses: maxUses || null,
            usedCount: data.codes[code.toUpperCase()]?.usedCount || 0,
            validUntil: validUntil || null,
            active: active !== false,
            createdAt: data.codes[code.toUpperCase()]?.createdAt || new Date().toISOString()
        };

        savePromoCodes(data);
        res.json({ success: true, message: 'Promo code saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin: Delete promo code
app.delete('/api/admin/promo-codes/:code', (req, res) => {
    try {
        const data = loadPromoCodes();
        const code = req.params.code.toUpperCase();

        if (data.codes[code]) {
            delete data.codes[code];
            savePromoCodes(data);
            return res.json({ success: true, message: 'Promo code deleted' });
        }

        res.status(404).json({ success: false, error: 'Code not found' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create subscription
app.get('/api/checkout/subscribe', (req, res) => {
    const { email, device: deviceId, plan } = req.query;
    if (!email || !deviceId) return res.status(400).json({ success: false, error: 'Email and device ID required' });

    const db = loadSubscriptionsDb();
    const subId = uuidv4();
    const subscription = {
        id: subId,
        deviceId,
        email,
        plan: plan || 'monthly',
        amount: MONTHLY_PRICE,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    db.subscriptions.push(subscription);
    saveSubscriptionsDb(db);

    res.redirect(`/pay.html?sub=${subId}&device=${deviceId}&email=${encodeURIComponent(email)}`);
});

// Activate subscription (after payment)
app.post('/api/checkout/activate', express.json(), (req, res) => {
    const { subscriptionId, deviceId } = req.body;

    const subDb = loadSubscriptionsDb();
    const sub = subDb.subscriptions.find(s => s.id === subscriptionId);
    if (!sub) return res.status(404).json({ success: false, error: 'Subscription not found' });

    sub.status = 'active';
    sub.activatedAt = new Date().toISOString();
    saveSubscriptionsDb(subDb);

    // Mark demo as paid
    const demoDb = loadDemosDb();
    const demo = demoDb.demos.find(d => d.deviceId === deviceId);
    if (demo) {
        demo.paid = true;
        demo.paidAt = new Date().toISOString();
        saveDemosDb(demoDb);
    }

    res.json({ success: true, subscription: sub });
});

// Check subscription status
app.get('/api/subscriptions/:deviceId', (req, res) => {
    try {
        const { deviceId } = req.params;
        const db = loadSubscriptionsDb();
        const subs = db.subscriptions || [];
        const sub = subs.find(s => s.deviceId === deviceId && s.status === 'active');
        res.json({ success: true, subscribed: !!sub, subscription: sub || null });
    } catch (err) {
        res.json({ success: true, subscribed: false, subscription: null });
    }
});

// Supported currencies with exchange rates (updated periodically)
const currencyRates = {
    USD: { rate: 1, symbol: '$', code: 'USD' },
    EUR: { rate: 0.92, symbol: '\u20ac', code: 'EUR' },
    GBP: { rate: 0.79, symbol: '\u00a3', code: 'GBP' },
    CAD: { rate: 1.36, symbol: 'C$', code: 'CAD' },
    AUD: { rate: 1.53, symbol: 'A$', code: 'AUD' },
    JPY: { rate: 149.50, symbol: '\u00a5', code: 'JPY', decimals: 0 },
    INR: { rate: 83.12, symbol: '\u20b9', code: 'INR' },
    BRL: { rate: 4.97, symbol: 'R$', code: 'BRL' },
    MXN: { rate: 17.15, symbol: 'MX$', code: 'MXN' },
    SGD: { rate: 1.34, symbol: 'S$', code: 'SGD' },
    CHF: { rate: 0.88, symbol: 'CHF', code: 'CHF' },
    SEK: { rate: 10.42, symbol: 'kr', code: 'SEK' },
    NOK: { rate: 10.65, symbol: 'kr', code: 'NOK' },
    DKK: { rate: 6.87, symbol: 'kr', code: 'DKK' },
    PLN: { rate: 3.96, symbol: 'z\u0142', code: 'PLN' },
    ZAR: { rate: 18.65, symbol: 'R', code: 'ZAR' },
    NZD: { rate: 1.64, symbol: 'NZ$', code: 'NZD' },
    HKD: { rate: 7.82, symbol: 'HK$', code: 'HKD' },
    CNY: { rate: 7.24, symbol: '\u00a5', code: 'CNY' },
    KRW: { rate: 1320, symbol: '\u20a9', code: 'KRW', decimals: 0 },
    THB: { rate: 35.50, symbol: '\u0e3f', code: 'THB' },
    MYR: { rate: 4.72, symbol: 'RM', code: 'MYR' },
    PHP: { rate: 56.20, symbol: '\u20b1', code: 'PHP' },
    IDR: { rate: 15750, symbol: 'Rp', code: 'IDR', decimals: 0 },
    TWD: { rate: 31.50, symbol: 'NT$', code: 'TWD' },
    TRY: { rate: 32.15, symbol: '\u20ba', code: 'TRY' },
    ILS: { rate: 3.65, symbol: '\u20aa', code: 'ILS' },
    CZK: { rate: 22.85, symbol: 'K\u010d', code: 'CZK' },
    AED: { rate: 3.67, symbol: '\u062f.\u0625', code: 'AED' },
    SAR: { rate: 3.75, symbol: '\ufdfc', code: 'SAR' }
};

// Convert USD amount to local currency (in smallest unit for payment processing)
function convertToLocalCurrency(usdAmount, currencyCode) {
    const currency = currencyRates[currencyCode] || currencyRates.USD;
    const converted = usdAmount * currency.rate;
    const decimals = currency.decimals !== undefined ? currency.decimals : 2;
    const multiplier = Math.pow(10, decimals);
    return Math.round(converted * multiplier);
}

// Process Checkout.com payment with multi-currency support
app.post('/api/checkout/process', express.json(), async (req, res) => {
    const { token, subscriptionId, deviceId, email, amount, currency = 'USD', planId } = req.body;

    try {
        // Validate currency
        const currencyInfo = currencyRates[currency] || currencyRates.USD;
        const processedCurrency = currencyInfo.code;

        // Convert amount if needed (amount coming in should be in USD cents)
        const localAmount = currency !== 'USD'
            ? convertToLocalCurrency(amount / 100, currency)
            : amount;

        console.log(`Processing payment: ${email}, device: ${deviceId}, amount: ${localAmount} ${processedCurrency}`);

        // In production with Checkout.com SDK:
        // const checkout = new Checkout(CHECKOUT_SECRET_KEY);
        // const payment = await checkout.payments.request({
        //     source: { type: 'token', token: token },
        //     amount: localAmount,
        //     currency: processedCurrency,
        //     reference: subscriptionId || deviceId,
        //     customer: { email: email },
        //     metadata: { deviceId, planId }
        // });

        // Activate subscription
        const subDb = loadSubscriptionsDb();
        const sub = subDb.subscriptions.find(s => s.id === subscriptionId);
        if (sub) {
            sub.status = 'active';
            sub.activatedAt = new Date().toISOString();
            sub.paymentToken = token;
            sub.currency = processedCurrency;
            sub.localAmount = localAmount;
            saveSubscriptionsDb(subDb);
        }

        // Mark demo as paid
        const demoDb = loadDemosDb();
        const demo = demoDb.demos.find(d => d.deviceId === deviceId);
        if (demo) {
            demo.paid = true;
            demo.paidAt = new Date().toISOString();
            demo.currency = processedCurrency;
            demo.localAmount = localAmount;
            saveDemosDb(demoDb);
        }

        res.json({
            success: true,
            message: 'Payment successful',
            currency: processedCurrency,
            amount: localAmount
        });
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ success: false, error: 'Payment processing failed' });
    }
});

// API endpoint to get supported currencies and rates
app.get('/api/checkout/currencies', (req, res) => {
    res.json({
        success: true,
        currencies: currencyRates,
        lastUpdated: new Date().toISOString()
    });
});

// Demo stats
app.get('/api/demo/stats', (req, res) => {
    const demoDb = loadDemosDb();
    const subDb = loadSubscriptionsDb();

    const totalDemos = demoDb.demos.length;
    const paidDemos = demoDb.demos.filter(d => d.paid).length;
    const subs = subDb.subscriptions || [];
    const activeSubs = Array.isArray(subs) ? subs.filter(s => s.status === 'active').length : 0;
    const mrr = activeSubs * (MONTHLY_PRICE / 100);

    res.json({
        success: true,
        totalDemos,
        paidDemos,
        activeSubscriptions: activeSubs,
        conversionRate: totalDemos > 0 ? ((paidDemos / totalDemos) * 100).toFixed(1) : 0,
        mrr: mrr.toFixed(2)
    });
});

// ============ USER DASHBOARD API ============
const featureRequestsPath = path.join(dataDir, 'feature-requests.json');

async function loadFeatureRequests() {
    return await dbUtils.loadJSON(featureRequestsPath, { requests: [] });
}

async function saveFeatureRequests(data) {
    return await dbUtils.saveJSON(featureRequestsPath, data);
}

// User stats for dashboard
app.get('/api/user/stats', (req, res) => {
    const { device } = req.query;
    const uploadsDb = loadJSON(path.join(dataDir, 'uploads.json'), { uploads: [] });

    // Include uploads from ALL linked devices when userId is available
    const userId = req.query.userId || req.headers['x-user-id'];
    let linkedDeviceIds = [device];
    if (userId) {
        try {
            const accountData = authService.getAccountData(userId);
            if (accountData.success && accountData.linkedDevices) {
                linkedDeviceIds = [...new Set([device, ...accountData.linkedDevices])];
            }
        } catch (e) {}
    }
