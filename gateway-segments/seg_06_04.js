app.get('/api/stripe/admin/transactions', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const transactions = stripeService.getTransactions(null, limit);
    res.json({ success: true, transactions });
});

// ============ SMART CHECKOUT FROM SHARE LINKS ============
// Look up upload owner for checkout prefill (from /i/ links)
app.get('/api/checkout/owner/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        if (!filename) {
            return res.json({ success: false, error: 'Filename required' });
        }

        const owner = stripeService.getUploadOwner(filename);

        if (!owner) {
            return res.json({
                success: true,
                found: false,
                message: 'Upload not found'
            });
        }

        const customerInfo = stripeService.getCustomerFromOwner(owner);

        if (!customerInfo) {
            return res.json({
                success: true,
                found: true,
                owner: {
                    deviceId: owner.deviceId,
                    hasUser: !!owner.userId
                },
                hasCustomer: false
            });
        }

        // Get payment preferences from Stripe
        const preferences = await stripeService.getCustomerPaymentPreferences(
            customerInfo.customerId
        );

        res.json({
            success: true,
            found: true,
            owner: {
                deviceId: owner.deviceId,
                hasUser: !!owner.userId
            },
            hasCustomer: true,
            customerId: customerInfo.customerId,
            paymentPreferences: preferences
        });
    } catch (error) {
        console.error('[Checkout] Owner lookup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create checkout session with owner prefill from /i/ link
app.post('/api/checkout/from-share', express.json(), async (req, res) => {
    try {
        const { filename, planId } = req.body;

        if (!planId) {
            return res.status(400).json({
                success: false,
                error: 'Plan ID required'
            });
        }

        const result = await stripeService.createCheckoutFromShare(filename, planId);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('[Checkout] From-share error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Payment Link URL with prefill
app.get('/api/checkout/payment-link', async (req, res) => {
    try {
        const { planId, filename } = req.query;

        if (!planId) {
            return res.status(400).json({ success: false, error: 'planId required' });
        }

        let customerEmail = null;
        let clientReferenceId = null;
        let prefilled = false;

        if (filename) {
            const owner = stripeService.getUploadOwner(filename);
            if (owner) {
                const customerInfo = stripeService.getCustomerFromOwner(owner);
                if (customerInfo) {
                    clientReferenceId = customerInfo.identifier;
                    prefilled = true;

                    // Get email from preferences
                    const prefs = await stripeService.getCustomerPaymentPreferences(
                        customerInfo.customerId
                    );
                    customerEmail = prefs.email;
                }
            }
        }

        const url = stripeService.getPaymentLinkUrl(planId, customerEmail, clientReferenceId);

        if (!url) {
            return res.json({
                success: false,
                error: 'Payment Link not found for this plan. Run /api/admin/init-payment-links first.'
            });
        }

        res.json({
            success: true,
            url,
            prefilled,
            planId
        });
    } catch (error) {
        console.error('[Checkout] Payment link error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all available Payment Links
app.get('/api/checkout/payment-links', (req, res) => {
    const data = stripeService.getPaymentLinks();
    res.json({
        success: true,
        links: data.links || {},
        lastSync: data.lastSync
    });
});

// Admin: Initialize/sync all Payment Links
app.post('/api/admin/init-payment-links', async (req, res) => {
    try {
        console.log('[Admin] Initializing Payment Links...');
        const links = await stripeService.createPaymentLinks();
        res.json({
            success: true,
            message: 'Payment Links created/synced',
            links
        });
    } catch (error) {
        console.error('[Admin] Init payment links error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ AI DEPLOYER API ============
// Proxy to internal AI deployer service
const AI_DEPLOYER_SECRET = process.env.AI_DEPLOYER_SECRET || 'doz-deploy-2026';

app.post('/api/internal/deploy', express.json(), async (req, res) => {
    // Verify secret
    const secret = req.headers['x-deploy-secret'] || req.body?.secret;
    if (secret !== AI_DEPLOYER_SECRET) {
        return res.status(403).json({ error: 'Invalid deploy secret' });
    }

    try {
        // Forward to AI deployer
        const http = require('http');
        const deployReq = http.request({
            hostname: '127.0.0.1',
            port: 3010,
            path: '/deploy',
            method: 'POST',
            timeout: 120000
        }, (deployRes) => {
            let data = '';
            deployRes.on('data', chunk => data += chunk);
            deployRes.on('end', () => {
                try {
                    res.json(JSON.parse(data));
                } catch (e) {
                    res.json({ success: true, raw: data });
                }
            });
        });
        deployReq.on('error', (e) => {
            res.status(500).json({ error: 'Deployer unavailable', details: e.message });
        });
        deployReq.end();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/internal/deploy/status', async (req, res) => {
    try {
        const http = require('http');
        const statusReq = http.request({
            hostname: '127.0.0.1',
            port: 3010,
            path: '/status',
            method: 'GET',
            timeout: 10000
        }, (statusRes) => {
            let data = '';
            statusRes.on('data', chunk => data += chunk);
            statusRes.on('end', () => {
                try {
                    res.json(JSON.parse(data));
                } catch (e) {
                    res.json({ raw: data });
                }
            });
        });
        statusReq.on('error', (e) => {
            res.status(500).json({ error: 'Deployer unavailable', details: e.message });
        });
        statusReq.end();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/internal/deploy/reset', async (req, res) => {
    try {
        const http = require('http');
        const resetReq = http.request({
            hostname: '127.0.0.1',
            port: 3010,
            path: '/reset',
            method: 'POST',
            timeout: 10000
        }, (resetRes) => {
            let data = '';
            resetRes.on('data', chunk => data += chunk);
            resetRes.on('end', () => {
                try {
                    res.json(JSON.parse(data));
                } catch (e) {
                    res.json({ success: true, raw: data });
                }
            });
        });
        resetReq.on('error', (e) => {
            res.status(500).json({ error: 'Deployer unavailable', details: e.message });
        });
        resetReq.end();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/internal/neural/status', async (req, res) => {
    try {
        const http = require('http');
        const statusReq = http.request({
            hostname: '127.0.0.1',
            port: 3009,
            path: '/status',
            method: 'GET',
            timeout: 10000
        }, (statusRes) => {
            let data = '';
            statusRes.on('data', chunk => data += chunk);
            statusRes.on('end', () => {
                try {
                    res.json(JSON.parse(data));
                } catch (e) {
                    res.json({ raw: data });
                }
            });
        });
        statusReq.on('error', (e) => {
            res.status(500).json({ error: 'Neural engine unavailable', details: e.message });
        });
        statusReq.end();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    res.json({
        status: 'healthy',
        version: APP_VERSION,
        uptime: Math.floor(uptime),
        uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
        },
        connections: {
            websocket: connectedUsers.size,
            adminWebsocket: adminConnections.size
        },
        timestamp: new Date().toISOString()
    });
});

// ============ COMPREHENSIVE AI HEALTH CHECK ============
// Full platform health verification - checks pages, APIs, services, files, AI systems
app.get('/api/health/full', async (req, res) => {
    const startTime = Date.now();
    const http = require('http');
    const results = {
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        overall: 'healthy',
        score: 100,
        uptime: Math.floor(process.uptime()),
        checks: {},
        autoFixes: []
    };

    // Helper: internal GET request for health checks (use localhost to avoid SSL issues)
    function localCheck(urlPath, timeoutMs = 3000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const req = http.get(`http://localhost:${PORT}${urlPath}`, { timeout: timeoutMs }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({ status: res.statusCode, time: Date.now() - start, ok: res.statusCode >= 200 && res.statusCode < 400, body: data.substring(0, 200) }));
            });
            req.on('error', (e) => resolve({ status: 0, time: Date.now() - start, ok: false, error: e.message }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 0, time: timeoutMs, ok: false, error: 'timeout' }); });
        });
    }

    try {
        // 1. CRITICAL PAGES CHECK
        const criticalPages = [
            '/', '/login.html', '/download.html', '/hub.html', '/cabinet.html',
            '/my.html', '/gallery.html', '/upload.html', '/studio.html',
            '/pricing.html', '/status.html', '/help-center.html', '/features.html',
            '/my-account.html', '/mobile.html', '/collage.html', '/annotate.html',
            '/frames.html', '/themes.html', '/tools.html', '/demo.html',
            '/checkout.html', '/pay.html', '/changelog.html'
        ];
        const adminPages = [
            '/admin/dashboard.html', '/admin/analytics.html', '/admin/system-monitor.html',
            '/admin/control-center.html', '/admin/support-inbox.html', '/admin/admin-panel.html',
            '/admin/intelligence.html', '/admin/growth-center.html', '/admin/login.html'
        ];
        const pageChecks = await Promise.all(
            [...criticalPages, ...adminPages].map(p => localCheck(p).then(r => ({ page: p, ...r })))
        );
        const pagesPassed = pageChecks.filter(p => p.ok).length;
        const pagesFailed = pageChecks.filter(p => !p.ok);
        results.checks.pages = {
            total: pageChecks.length,
            passed: pagesPassed,
            failed: pagesFailed.length,
            failedList: pagesFailed.map(p => ({ page: p.page, status: p.status, error: p.error })),
            avgResponseMs: Math.round(pageChecks.reduce((s, p) => s + p.time, 0) / pageChecks.length)
        };
        if (pagesFailed.length > 0) results.score -= Math.min(30, pagesFailed.length * 3);

        // 2. CRITICAL API ENDPOINTS CHECK
        const apiEndpoints = [
            '/health', '/api/health', '/api/version', '/api/status',
            '/api/diagnostics', '/api/ping', '/api/live-stats',
            '/api/help/categories', '/api/mirror/status',
            '/api/ai/interceptor/status', '/api/upload-health'
        ];
        const apiChecks = await Promise.all(
            apiEndpoints.map(e => localCheck(e).then(r => ({ endpoint: e, ...r })))
        );
        const apiPassed = apiChecks.filter(a => a.ok).length;
        const apiFailed = apiChecks.filter(a => !a.ok);
        results.checks.apis = {
            total: apiChecks.length,
            passed: apiPassed,
            failed: apiFailed.length,
            failedList: apiFailed.map(a => ({ endpoint: a.endpoint, status: a.status, error: a.error })),
            avgResponseMs: Math.round(apiChecks.reduce((s, a) => s + a.time, 0) / apiChecks.length)
        };
        if (apiFailed.length > 0) results.score -= Math.min(30, apiFailed.length * 5);

        // 3. FILE SYSTEM CHECK
        const uploadsPath = path.join(__dirname, 'uploads');
        const dataPath = path.join(__dirname, 'data');
        let fsOk = true;
        try {
            if (!fs.existsSync(uploadsPath)) { fs.mkdirSync(uploadsPath, { recursive: true }); results.autoFixes.push('Created uploads directory'); }
            if (!fs.existsSync(dataPath)) { fs.mkdirSync(dataPath, { recursive: true }); results.autoFixes.push('Created data directory'); }
            // Write test
            const testFile = path.join(uploadsPath, '.health-check-test');
            fs.writeFileSync(testFile, 'ok');
            fs.unlinkSync(testFile);
        } catch (e) {
            fsOk = false;
            results.score -= 20;
        }
        const uploadFiles = fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath).filter(f => !f.startsWith('.')).length : 0;
        results.checks.filesystem = {
            ok: fsOk,
            uploadsDir: fs.existsSync(uploadsPath),
            dataDir: fs.existsSync(dataPath),
            writable: fsOk,
            uploadFileCount: uploadFiles
        };

        // 4. MEMORY & CPU CHECK
        const memUsage = process.memoryUsage();
        const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const rssMB = Math.round(memUsage.rss / 1024 / 1024);
        const memOk = heapMB < 700;
        if (!memOk) results.score -= 15;
        results.checks.memory = {
            ok: memOk,
            heapUsedMB: heapMB,
            heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMB: rssMB,
            warning: heapMB > 500 ? 'High memory usage' : null
        };
        // Force GC if memory is high
        if (heapMB > 600 && global.gc) {
            global.gc();
            results.autoFixes.push('Triggered garbage collection (heap > 600MB)');
        }

        // 5. WEBSOCKET CONNECTIONS CHECK
        results.checks.websockets = {
            ok: true,
            liveConnections: connectedUsers.size,
            adminConnections: adminConnections.size,
            totalConnections: connectedUsers.size + adminConnections.size
        };

        // 6. AI SERVICES CHECK
        let aiStatus = { ok: false };
        try {
            const aiReport = aiErrorInterceptor.getStatus();
            aiStatus = {
                ok: true,
                interceptor: 'active',
                totalIssues: aiReport.totalIssuesHandled || 0,
                permanentFixes: aiReport.permanentFixes || 0,
                categories: aiReport.categoryStats ? Object.keys(aiReport.categoryStats).length : 0
            };
        } catch (e) {
            aiStatus = { ok: false, error: e.message };
            results.score -= 10;
        }
        results.checks.aiServices = aiStatus;

        // 7. UPLOAD SYSTEM CHECK
        const uploadLimitTest = checkDailyUploadLimit('health-check-probe', false);
        results.checks.uploadSystem = {
            ok: true,
            limitCheck: uploadLimitTest.allowed ? 'functional' : 'limit-active',
            dailyLimit: uploadLimitTest.limit,
            uploadsDir: fs.existsSync(uploadsPath)
        };

        // 8. SHARE PAGE CHECK (test a known pattern)
        const shareCheck = await localCheck('/i/health-check-test');
        results.checks.shareSystem = {
            ok: shareCheck.status === 200 || shareCheck.status === 404, // 404 is fine, means route works
            routeActive: shareCheck.status !== 0,
            status: shareCheck.status
        };

        // 9. SERVICE WORKER CHECK
        const swExists = fs.existsSync(path.join(__dirname, 'public', 'sw.js'));
        const appSwExists = fs.existsSync(path.join(__dirname, 'public', 'app', 'sw.js'));
        results.checks.serviceWorkers = {
            ok: swExists && appSwExists,
            mainSW: swExists,
            appSW: appSwExists
        };

        // 10. DOWNLOADS CHECK
        const downloadDir = path.join(__dirname, 'public', 'download');
        const latestYml = path.join(downloadDir, 'updates', 'latest.yml');
        results.checks.downloads = {
            ok: fs.existsSync(latestYml),
            latestYml: fs.existsSync(latestYml),
            downloadDir: fs.existsSync(downloadDir)
        };

        // Calculate overall status
        if (results.score >= 90) results.overall = 'healthy';
        else if (results.score >= 70) results.overall = 'degraded';
        else if (results.score >= 50) results.overall = 'unhealthy';
        else results.overall = 'critical';
