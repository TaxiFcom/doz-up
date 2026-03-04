            subscription: plan.subscription,
            isActive: plan.isPaid
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Unified plan endpoint - THE definitive plan info for any page/app
app.get('/api/account/plan/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const deviceId = req.query.deviceId || req.headers['x-device-id'];

        const plan = planResolver.resolvePlan(userId, deviceId);

        res.json({
            success: true,
            tier: plan.tier,
            planId: plan.planId,
            planName: plan.planName,
            isActive: plan.isPaid,
            isPaid: plan.isPaid,
            expiresAt: plan.expiresAt,
            startedAt: plan.startedAt,
            limits: plan.limits,
            features: plan.features,
            appAccess: plan.appAccess
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Unified plan endpoint by deviceId (for users not logged in with account)
app.get('/api/device/plan/:deviceId', (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const plan = planResolver.resolvePlan(null, deviceId);

        res.json({
            success: true,
            tier: plan.tier,
            planId: plan.planId,
            planName: plan.planName,
            isActive: plan.isPaid,
            isPaid: plan.isPaid,
            expiresAt: plan.expiresAt,
            limits: plan.limits,
            features: plan.features,
            appAccess: plan.appAccess
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get billing/transaction history for a user
app.get('/api/account/transactions/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const limit = parseInt(req.query.limit) || 50;

        // Get transactions from Stripe service
        const transactions = stripeService.getTransactions(userId, limit);

        // Also get account data to match by email
        const accountData = authService.getAccountData(userId);
        let email = null;
        if (accountData.success && accountData.user) {
            email = accountData.user.email;
        }

        // If we have an email, also include transactions matched by email (in case userId wasn't set)
        let allTransactions = transactions;
        if (email) {
            const emailTxns = stripeService.getTransactions(null, 500)
                .filter(t => t.email === email && !transactions.some(existing => existing.id === t.id || (existing.createdAt === t.createdAt && existing.amount === t.amount)));
            allTransactions = [...transactions, ...emailTxns]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
        }

        res.json({
            success: true,
            transactions: allTransactions,
            total: allTransactions.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, transactions: [] });
    }
});

// Sync endpoint - returns all user data for syncing to external website
app.get('/api/sync/user/:identifier', (req, res) => {
    try {
        const accountData = authService.getAccountData(req.params.identifier);

        if (!accountData.success) {
            return res.status(404).json(accountData);
        }

        const deviceIds = accountData.linkedDevices || [];
        const uploadsDb = loadUploadsDb();
        const uploads = uploadsDb.uploads.filter(u => deviceIds.includes(u.deviceId));

        res.json({
            success: true,
            syncTimestamp: new Date().toISOString(),
            user: accountData.user,
            subscription: accountData.subscription,
            isSubscriptionActive: accountData.isSubscriptionActive,
            linkedDevices: deviceIds,
            uploads: uploads,
            stats: {
                totalUploads: uploads.length,
                totalSize: uploads.reduce((sum, u) => sum + (u.size || 0), 0)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ CHECKOUT.COM PAYMENT INTEGRATION ============

// Check Checkout.com configuration status
app.get('/api/checkout/status', (req, res) => {
    const publicKey = paymentService.getPublicKey();
    const isConfigured = publicKey && !publicKey.includes('xxxx') && publicKey.length > 10;

    res.json({
        configured: isConfigured,
        environment: paymentService.CONFIG?.environment || 'sandbox',
        message: isConfigured
            ? 'Checkout.com is ready to accept payments'
            : 'Please add your API keys to config/checkout.json'
    });
});

// Get available pricing plans (using Stripe)
app.get('/api/checkout/plans', (req, res) => {
    res.json({
        success: true,
        plans: stripeService.getPlans(),
        publicKey: stripeService.getPublicKey()
    });
});

// Create checkout session (hosted payment page)
app.post('/api/checkout/create-session', express.json(), async (req, res) => {
    try {
        const { userId, email, planId, customerName } = req.body;

        if (!userId || !email || !planId) {
            return res.status(400).json({ error: 'Missing required fields: userId, email, planId' });
        }

        const session = await paymentService.createHostedPaymentPage(userId, email, planId, customerName);

        res.json({
            success: true,
            sessionId: session.id,
            redirectUrl: session._links?.redirect?.href || `/v2/checkout/process?session=${session.id}`
        });
    } catch (error) {
        console.error('[Checkout] Session creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Process payment directly (with card token)
app.post('/api/checkout/process-payment', express.json(), async (req, res) => {
    try {
        const { userId, email, planId, token, customerName } = req.body;

        if (!userId || !email || !planId || !token) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const payment = await paymentService.createPaymentSession(userId, email, planId, {
            token,
            customerName
        });

        res.json({
            success: true,
            paymentId: payment.id,
            status: payment.status,
            redirectUrl: payment._links?.redirect?.href
        });
    } catch (error) {
        console.error('[Checkout] Payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook endpoint for Checkout.com events
app.post('/api/webhooks/checkout', express.json(), async (req, res) => {
    try {
        const signature = req.headers['cko-signature'];
        const result = await paymentService.processWebhook(req.body, signature);
        res.json(result);
    } catch (error) {
        console.error('[Webhook] Error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get user subscription status
app.get('/api/checkout/subscription/:userId', (req, res) => {
    const { userId } = req.params;
    const subscription = paymentService.getSubscription(userId);
    const isActive = paymentService.isSubscriptionActive(userId);

    res.json({
        success: true,
        subscription,
        isActive,
        plan: subscription ? paymentService.getPlan(subscription.planId) : null
    });
});

// Cancel subscription
app.post('/api/checkout/cancel-subscription', express.json(), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }

        const subscription = await paymentService.cancelSubscription(userId);
        res.json({ success: true, subscription });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get user transactions
app.get('/api/checkout/transactions/:userId', (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const transactions = paymentService.getTransactions(userId, limit);

    res.json({
        success: true,
        transactions,
        count: transactions.length
    });
});

// Admin auth middleware with device binding verification (moved here to fix hoisting issue)
const requireAdmin = (permission = null) => {
    return (req, res, next) => {
        try {
            console.log('[RequireAdmin] Checking permission:', permission);
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.log('[RequireAdmin] No auth header');
                return res.status(401).json({ error: 'Authentication required' });
            }

            const token = authHeader.substring(7);
            console.log('[RequireAdmin] Token prefix:', token.substring(0, 20));
            const result = adminService.validateAdminSession(token);
            console.log('[RequireAdmin] Validation result:', result ? 'valid' : 'invalid');

        if (!result) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Check device binding
        const adminSettingsPath = path.join(__dirname, 'data', 'admin-settings.json');
        try {
            if (fs.existsSync(adminSettingsPath)) {
                const settings = JSON.parse(fs.readFileSync(adminSettingsPath, 'utf8'));
                if (settings.deviceBinding && settings.deviceBinding.enabled) {
                    const clientDeviceId = req.headers['x-device-id'];
                    if (!clientDeviceId || clientDeviceId !== settings.deviceBinding.deviceId) {
                        return res.status(403).json({
                            error: 'Access denied: Device not authorized',
                            code: 'DEVICE_NOT_BOUND'
                        });
                    }
                }
            }
        } catch (e) {
            console.error('[Admin] Error checking device binding:', e);
        }

        if (permission && !adminService.hasPermission(result.admin.id, permission)) {
            console.log('[RequireAdmin] Insufficient permissions for:', permission);
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        req.admin = result.admin;
        req.session = result.session;
        console.log('[RequireAdmin] Access granted to:', result.admin.username);
        next();
        } catch (err) {
            console.error('[RequireAdmin] Error:', err);
            return res.status(500).json({ error: 'Admin authentication error', details: err.message });
        }
    };
};

// Admin: Get all subscriptions (Admin only - subscription data is sensitive)
app.get('/api/admin/subscriptions', requireAdmin('subscriptions:read'), (req, res) => {
    const subscriptions = paymentService.getAllSubscriptions() || [];
    const subArray = Array.isArray(subscriptions) ? subscriptions : [];
    res.json({
        success: true,
        subscriptions: subArray,
        total: subArray.length,
        active: subArray.filter(s => s.status === 'active').length
    });
});

// Admin: Get revenue stats (Admin only - financial data is sensitive)
app.get('/api/admin/revenue', requireAdmin('revenue:read'), (req, res) => {
    const stats = paymentService.getRevenueStats();
    res.json({
        success: true,
        ...stats
    });
});

// Admin: Test notification (for testing real-time alerts) (Admin only)
app.post('/api/admin/test-order', requireAdmin('orders:write'), (req, res) => {
    try {
        console.log('[Test Order] Request received, admin:', req.admin?.username);
        console.log('[Test Order] Body:', JSON.stringify(req.body));

        const testOrder = {
            id: `test_${Date.now()}`,
            customerName: req.body?.name || 'Test Customer',
            email: req.body?.email || 'test@example.com',
            plan: req.body?.plan || 'Pro',
            amount: req.body?.amount || 99.99,
            status: 'active',
            createdAt: new Date().toISOString()
        };

        console.log('[Test Order] Created order:', testOrder.id);

        // Broadcast to all connected dashboards
        if (global.broadcastNewOrder) {
            global.broadcastNewOrder(testOrder);
            console.log('[Test Order] Broadcasted to dashboards');
        }

        res.json({
            success: true,
            message: 'Test order broadcasted',
            order: testOrder
        });
    } catch (err) {
        console.error('[Test Order] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Get all transactions (Admin only - financial data)
app.get('/api/admin/transactions', requireAdmin('orders:read'), (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const transactions = paymentService.getTransactions(null, limit);
    res.json({
        success: true,
        transactions,
        count: transactions.length
    });
});

// ============ SALES DATABASE API ============
const salesDatabase = require('./services/sales-database');

// Get all sales with pagination and filters
app.get('/api/admin/sales/all', (req, res) => {
    try {
        const result = salesDatabase.getAllSales({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50,
            status: req.query.status,
            search: req.query.search,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            plan: req.query.plan
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get today's sales
app.get('/api/admin/sales/today', (req, res) => {
    try {
        const result = salesDatabase.getTodaySales();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get sales statistics
app.get('/api/admin/sales/stats', (req, res) => {
    try {
        const stats = salesDatabase.getStats();
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Debug: View raw Stripe data (must be before :id route)
app.get('/api/admin/sales/stripe-debug', async (req, res) => {
    try {
        const stripeService = require('./services/stripe-payments');

        const payments = await stripeService.listRecentPayments(20);
        const sessions = await stripeService.listRecentCheckoutSessions(20);
        const charges = await stripeService.listRecentCharges(20);

        res.json({
            paymentsCount: payments.length,
            sessionsCount: sessions.length,
            chargesCount: charges.length,
            payments: payments.map(p => ({
                id: p.id,
                amount: p.amount / 100,
                status: p.status,
                email: p.receipt_email,
                created: new Date(p.created * 1000).toISOString()
            })),
            sessions: sessions.map(s => ({
                id: s.id,
                amount: (s.amount_total || 0) / 100,
                status: s.payment_status,
                email: s.customer_email,
                created: new Date(s.created * 1000).toISOString()
            })),
            charges: charges.map(c => ({
                id: c.id,
                amount: c.amount / 100,
                status: c.status,
                paid: c.paid,
                email: c.receipt_email,
                created: new Date(c.created * 1000).toISOString()
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message, stack: e.stack });
    }
});

// Get single sale by ID
app.get('/api/admin/sales/:id', (req, res) => {
    try {
        const sale = salesDatabase.getSaleById(req.params.id);
        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        res.json(sale);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Export sales to CSV
app.get('/api/admin/sales/export', (req, res) => {
    try {
        const csv = salesDatabase.exportToCSV({
            status: req.query.status,
            startDate: req.query.startDate,
            endDate: req.query.endDate
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=sales-export.csv');
        res.send(csv);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Manually record a sale (for testing or manual entry)
app.post('/api/admin/sales/record', express.json(), (req, res) => {
    try {
        const { email, plan, amount, currency, status, type, customerName } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount required' });
        }

        const sale = salesDatabase.recordSale({
            email: email || 'manual@entry.com',
            plan: plan || 'Manual Entry',
            amount: parseFloat(amount),
            currency: currency || 'USD',
            status: status || 'completed',
            type: type || 'purchase',
