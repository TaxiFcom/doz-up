            customerName: customerName || ''
        });

        // Broadcast to WebSocket clients
        if (global.trackMonitorSale) {
            global.trackMonitorSale({
                plan: sale.plan,
                amount: sale.amount,
                email: sale.email
            });
        }

        res.json({ success: true, sale });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Sync recent sales from Stripe
app.post('/api/admin/sales/sync-stripe', async (req, res) => {
    try {
        const stripeService = require('./services/stripe-payments');
        let synced = 0;

        // 1. Get recent payment intents (last 100)
        console.log('[SalesSync] Fetching payment intents...');
        const recentPayments = await stripeService.listRecentPayments(100);

        for (const payment of recentPayments || []) {
            if (payment.status === 'succeeded') {
                const existingSale = salesDatabase.getSaleById(payment.id);
                if (!existingSale) {
                    const saleData = {
                        stripeId: payment.id,
                        email: payment.receipt_email || payment.metadata?.email || payment.customer?.email || '',
                        plan: payment.metadata?.planId || payment.description || 'Stripe Payment',
                        amount: (payment.amount || 0) / 100,
                        currency: (payment.currency || 'usd').toUpperCase(),
                        status: 'completed',
                        type: 'purchase',
                        createdAt: new Date(payment.created * 1000).toISOString()
                    };
                    salesDatabase.recordSale(saleData);
                    synced++;
                    console.log('[SalesSync] Synced payment:', payment.id, payment.amount / 100);
                    // Broadcast for real-time dashboard update
                    if (global.trackMonitorSale) {
                        global.trackMonitorSale(saleData);
                    }
                }
            }
        }

        // 2. Get recent checkout sessions
        console.log('[SalesSync] Fetching checkout sessions...');
        const sessions = await stripeService.listRecentCheckoutSessions(100);

        for (const session of sessions || []) {
            if (session.payment_status === 'paid') {
                const existingSale = salesDatabase.getSaleById(session.id);
                if (!existingSale) {
                    const saleData = {
                        stripeId: session.id,
                        email: session.customer_email || session.customer_details?.email || '',
                        plan: session.metadata?.planId || 'Checkout Session',
                        amount: (session.amount_total || 0) / 100,
                        currency: (session.currency || 'usd').toUpperCase(),
                        status: 'completed',
                        type: 'purchase',
                        createdAt: new Date(session.created * 1000).toISOString()
                    };
                    salesDatabase.recordSale(saleData);
                    synced++;
                    console.log('[SalesSync] Synced checkout:', session.id, session.amount_total / 100);
                    // Broadcast for real-time dashboard update
                    if (global.trackMonitorSale) {
                        global.trackMonitorSale(saleData);
                    }
                }
            }
        }

        // 3. Get recent charges
        console.log('[SalesSync] Fetching charges...');
        const charges = await stripeService.listRecentCharges(100);

        for (const charge of charges || []) {
            if (charge.status === 'succeeded' && charge.paid) {
                const existingSale = salesDatabase.getSaleById(charge.id);
                if (!existingSale) {
                    const saleData = {
                        stripeId: charge.id,
                        email: charge.receipt_email || charge.billing_details?.email || '',
                        plan: charge.description || 'Stripe Charge',
                        amount: (charge.amount || 0) / 100,
                        currency: (charge.currency || 'usd').toUpperCase(),
                        status: 'completed',
                        type: 'purchase',
                        createdAt: new Date(charge.created * 1000).toISOString()
                    };
                    salesDatabase.recordSale(saleData);
                    synced++;
                    console.log('[SalesSync] Synced charge:', charge.id, charge.amount / 100);
                    // Broadcast for real-time dashboard update
                    if (global.trackMonitorSale) {
                        global.trackMonitorSale(saleData);
                    }
                }
            }
        }

        console.log('[SalesSync] Total synced:', synced);
        res.json({ success: true, synced, message: `Synced ${synced} payments from Stripe` });
    } catch (e) {
        console.error('[SalesSync] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Get active user journeys
app.get('/api/admin/journey/active', (req, res) => {
    try {
        const journeys = salesDatabase.getActiveJourneys();
        res.json(journeys);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get funnel analytics
app.get('/api/admin/journey/funnel', (req, res) => {
    try {
        const funnel = salesDatabase.getFunnelAnalytics();
        res.json(funnel);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Track user journey (called from client)
app.post('/api/track/journey', express.json(), (req, res) => {
    try {
        const fingerprint = req.body.fingerprint || req.headers['x-fingerprint'] || 'anonymous';
        const journey = salesDatabase.trackJourney(fingerprint, {
            page: req.body.page,
            source: req.body.source,
            email: req.body.email,
            stage: req.body.stage
        });
        res.json({ success: true, stage: journey.stage });
    } catch (e) {
        res.json({ success: true }); // Don't break client
    }
});

// ============ PAYMENT RECOVERY API ============
// Recover missed payments from Stripe
app.post('/api/admin/recover-payments', async (req, res) => {
    try {
        const recoveryService = require('./services/payment-recovery');
        console.log('[Admin] Starting payment recovery...');

        // Run recovery
        const result = await recoveryService.recoverAll();

        // Also sync from Stripe directly
        const syncResult = await recoveryService.syncFromStripe(30);

        // Broadcast recovered orders to dashboards
        if (result.stats.recovered > 0) {
            const subscriptions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'subscriptions.json'), 'utf8'));
            const recentSubs = subscriptions.filter(s => s.recoveredAt);

            recentSubs.forEach(sub => {
                broadcastNewOrder({
                    id: sub.id,
                    customerName: sub.userId,
                    email: sub.userId,
                    plan: sub.planName,
                    amount: (sub.amount || 0) / 100,
                    status: 'active'
                });
            });
        }

        res.json({
            success: true,
            recovery: result.stats,
            sync: syncResult,
            message: `Recovered ${result.stats.recovered} payments, synced ${syncResult.synced || 0} from Stripe`
        });
    } catch (error) {
        console.error('[Admin] Payment recovery error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Broadcast user plan update to connected clients
function broadcastUserPlanUpdate(userId, plan) {
    const message = JSON.stringify({
        type: 'plan_update',
        userId,
        plan: {
            id: plan.id || plan.planId,
            name: plan.name || plan.planName,
            status: plan.status || 'active',
            features: plan.features || [],
            storage: plan.storage,
            updatedAt: new Date().toISOString()
        }
    });

    // Send to specific user's connections
    connectedUsers.forEach((user) => {
        if (user.userId === userId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
            console.log(`[WS] Sent plan update to user ${userId}`);
        }
    });

    // Also broadcast to admin dashboards
    if (typeof analyticsWss !== 'undefined' && analyticsWss.clients) {
        analyticsWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
}

// Export for use in payment webhooks
global.broadcastUserPlanUpdate = broadcastUserPlanUpdate;

// simulate-success endpoint REMOVED - security risk (allowed free subscriptions)

// ============ STRIPE PAYMENT INTEGRATION ============

// Rate limiting for Stripe endpoints (30 requests per minute per IP)
const stripeRateLimits = new Map();
app.use('/api/stripe', (req, res, next) => {
    // Skip rate limiting for webhooks (Stripe sends them server-to-server)
    if (req.path === '/webhook') return next();
    if (req.method !== 'POST') return next();

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const key = `stripe:${ip}`;
    const now = Date.now();
    const window = 60000;
    const limit = 30;

    let entry = stripeRateLimits.get(key);
    if (!entry || now - entry.start > window) {
        entry = { start: now, count: 0 };
    }
    entry.count++;
    stripeRateLimits.set(key, entry);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));

    if (entry.count > limit) {
        return res.status(429).json({ error: 'Too many payment requests. Try again in 1 minute.' });
    }
    next();
});

// Verify Stripe checkout session (used by payment success page)
app.get('/api/stripe/verify-session', async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
            return res.json({ success: false, error: 'session_id required' });
        }
        const result = await stripeService.verifySession(sessionId);
        res.json(result);
    } catch (err) {
        console.error('[Stripe] Verify session error:', err.message);
        res.json({ success: false, error: 'Verification failed' });
    }
});

// Get Stripe publishable key
app.get('/api/stripe/config', (req, res) => {
    res.json({
        success: true,
        publishableKey: stripeService.getPublicKey(),
        plans: stripeService.getPlans()
    });
});

// Get available plans
app.get('/api/stripe/plans', (req, res) => {
    res.json({
        success: true,
        plans: stripeService.getPlans()
    });
});

// Create Stripe Checkout Session
app.post('/api/stripe/create-checkout-session', express.json(), async (req, res) => {
    try {
        const { userId, email, planId, customerName, isGuest } = req.body;

        // Only planId is required - allow guest checkout without userId/email
        if (!planId) {
            return res.status(400).json({
                success: false,
                error: 'planId is required'
            });
        }

        // AI Payment Guard - check for fraud/rate limits
        if (email) {
            const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || '0.0.0.0';
            const guardResult = paymentGuard.checkPayment(email, clientIP, planId, null, userId || null);

            if (!guardResult.allowed) {
                console.log(`[Stripe] Checkout BLOCKED by AI guard: score=${guardResult.score}`);
                return res.status(429).json({
                    success: false,
                    error: guardResult.message
                });
            }
        }

        // Generate guest ID if not provided
        const effectiveUserId = userId || ('guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));

        const session = await stripeService.createCheckoutSession(effectiveUserId, email, planId, customerName, isGuest);

        res.json({
            success: true,
            sessionId: session.id,
            url: session.url
        });
    } catch (error) {
        console.error('[Stripe] Checkout session error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get storage add-ons
app.get('/api/stripe/storage-addons', (req, res) => {
    res.json({
        success: true,
        addons: stripeService.getStorageAddons()
    });
});

// Create Storage Add-on Checkout Session
app.post('/api/stripe/add-storage', express.json(), async (req, res) => {
    try {
        const { userId, email, addonId, customerName } = req.body;

        if (!userId || !email || !addonId) {
            return res.status(400).json({
                success: false,
                error: 'userId, email, and addonId are required'
            });
        }

        const session = await stripeService.createStorageAddonCheckout(userId, email, addonId, customerName);

        res.json({
            success: true,
            sessionId: session.id,
            url: session.url
        });
    } catch (error) {
        console.error('[Stripe] Storage addon checkout error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create Payment Intent (for custom payment forms)
app.post('/api/stripe/create-payment-intent', express.json(), async (req, res) => {
    try {
        const { userId, email, planId, customerName } = req.body;

        if (!userId || !email || !planId) {
            return res.status(400).json({
                success: false,
                error: 'userId, email, and planId are required'
            });
        }

        const result = await stripeService.createPaymentIntent(userId, email, planId, customerName);

        res.json({
            success: true,
            clientSecret: result.clientSecret,
            paymentIntentId: result.paymentIntentId
        });
    } catch (error) {
        console.error('[Stripe] Payment intent error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create Inline Checkout (for embedded Payment Element with express checkout)
// Validate coupon code
app.post('/api/stripe/validate-coupon', express.json(), (req, res) => {
    try {
        const { code, planId } = req.body;

        if (!code || !planId) {
            return res.status(400).json({ valid: false, error: 'Coupon code and planId are required' });
        }

        const result = stripeService.validateCoupon(code, planId);
        res.json(result);
    } catch (error) {
        console.error('[Stripe] Coupon validation error:', error);
        res.status(500).json({ valid: false, error: 'Server error' });
    }
});

app.post('/api/stripe/create-inline-checkout', express.json(), async (req, res) => {
    try {
        const { planId, email, customerName, shareFilename, couponCode, abVariant, currency, fingerprintId } = req.body;

        if (!planId || !email) {
            return res.status(400).json({
                success: false,
                error: 'planId and email are required'
            });
        }

        // AI Payment Guard - check for fraud/rate limits
        const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || '0.0.0.0';
        const guardResult = paymentGuard.checkPayment(email, clientIP, planId, null, req.headers['x-user-id'] || null);

        if (!guardResult.allowed) {
            console.log(`[Stripe] Payment BLOCKED by AI guard: score=${guardResult.score}, email=${email}`);
            return res.status(429).json({
                success: false,
                error: guardResult.message
            });
        }

        if (guardResult.decision === 'flag') {
            console.log(`[Stripe] Payment FLAGGED by AI guard: score=${guardResult.score}, email=${email}`);
        }

        // Determine A/B variant - from request, fingerprint, or default to B
        let variant = abVariant;
        if (!variant && fingerprintId) {
            variant = visitorIntelligence.getVariant(fingerprintId);
        }
        variant = variant || 'B';  // Default to baseline

        // Track checkout start for A/B test
        const abTestTracker = require('./services/ab-test-tracker');
        abTestTracker.trackCheckoutStart(variant);

        // Generate userId from email
        let userId = Buffer.from(email).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);

        // If shareFilename provided, try to link to existing customer
        let shareContext = null;
        if (shareFilename) {
            const owner = stripeService.getUploadOwner(shareFilename);
            if (owner) {
                const customerInfo = stripeService.getCustomerFromOwner(owner);
                if (customerInfo) {
                    // Use existing customer's userId for continuity
                    userId = customerInfo.identifier;
                    shareContext = {
                        filename: shareFilename,
                        customerId: customerInfo.customerId
                    };
                }
            }
        }

        // Pass variant and currency to checkout
        const result = await stripeService.createInlineCheckout(
            userId, email, planId, customerName, couponCode || null,
            variant, currency || 'usd'
        );

        console.log(`[Stripe] Checkout created: variant=${variant}, currency=${currency || 'usd'}, plan=${planId}`);

        res.json({
            success: true,
            ...result,
            publicKey: stripeService.getPublicKey(),
            shareContext
        });
    } catch (error) {
        console.error('[Stripe] Inline checkout error:', error);
