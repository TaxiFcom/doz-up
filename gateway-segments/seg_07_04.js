    res.json({ success: true, ...result });
});

app.get('/api/admin/activities/recent', requireAdmin('analytics:read'), (req, res) => {
    res.json({ success: true, activities: activityService.getRecent(parseInt(req.query.limit) || 20) });
});

app.get('/api/admin/activities/stats', requireAdmin('analytics:read'), (req, res) => {
    res.json({ success: true, ...activityService.getStats(parseInt(req.query.days) || 7) });
});

// ============ ADMIN SETTINGS API ============

// Settings data paths
const settingsDataPath = path.join(__dirname, 'data', 'admin-settings.json');
const checkoutConfigPath = path.join(__dirname, 'config', 'checkout.json');

function loadSettingsJSON(filepath, defaultValue = {}) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveSettingsJSON(filepath, data) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, JSON.stringify(data));
}

// Get checkout settings
app.get('/api/admin/settings/checkout', (req, res) => {
    try {
        const config = loadSettingsJSON(checkoutConfigPath, {});
        const isConfigured = config.publicKey && config.secretKey &&
            !config.publicKey.includes('xxxx') && !config.secretKey.includes('xxxx');

        res.json({
            success: true,
            config: {
                publicKey: config.publicKey || '',
                secretKey: config.secretKey ? true : false, // Don't expose secret key
                webhookSecret: config.webhookSecret ? true : false,
                environment: config.environment || 'sandbox',
                currency: config.currency || 'USD',
                merchantName: config.merchantName || 'DOZ UP'
            },
            configured: isConfigured
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save checkout settings
app.post('/api/admin/settings/checkout', express.json(), (req, res) => {
    try {
        const { publicKey, secretKey, webhookSecret, environment } = req.body;

        // Load existing config
        const config = loadSettingsJSON(checkoutConfigPath, {
            currency: 'USD',
            merchantName: 'DOZ UP',
            successUrl: 'https://doz.com/up/payment/success',
            cancelUrl: 'https://doz.com/up/payment/cancel',
            webhookUrl: 'https://doz.com/up/api/webhooks/checkout'
        });

        // Update only provided fields
        if (publicKey !== undefined) config.publicKey = publicKey;
        if (secretKey !== undefined) config.secretKey = secretKey;
        if (webhookSecret !== undefined) config.webhookSecret = webhookSecret;
        if (environment !== undefined) config.environment = environment;

        // Validate keys format
        if (config.publicKey && !config.publicKey.startsWith('pk_')) {
            return res.status(400).json({ error: 'Public key must start with pk_' });
        }
        if (config.secretKey && !config.secretKey.startsWith('sk_') && !config.secretKey.includes('xxxx')) {
            return res.status(400).json({ error: 'Secret key must start with sk_' });
        }

        // Save config
        saveSettingsJSON(checkoutConfigPath, config);

        res.json({ success: true, message: 'Checkout settings saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get security settings
app.get('/api/admin/settings/security', (req, res) => {
    try {
        const settings = loadSettingsJSON(settingsDataPath, {
            deviceBinding: { enabled: false },
            googleAuth: { enabled: false }
        });

        res.json({
            success: true,
            deviceBinding: settings.deviceBinding,
            googleAuth: {
                enabled: settings.googleAuth?.enabled || false,
                allowedEmail: settings.googleAuth?.allowedEmail || null
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bind device
app.post('/api/admin/settings/security/bind-device', express.json(), (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID is required' });
        }

        const settings = loadSettingsJSON(settingsDataPath, {});
        settings.deviceBinding = {
            enabled: true,
            deviceId: deviceId,
            boundAt: new Date().toISOString()
        };

        saveSettingsJSON(settingsDataPath, settings);

        res.json({ success: true, message: 'Device bound successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unbind device
app.post('/api/admin/settings/security/unbind-device', express.json(), (req, res) => {
    try {
        const settings = loadSettingsJSON(settingsDataPath, {});
        settings.deviceBinding = {
            enabled: false,
            deviceId: null,
            boundAt: null
        };

        saveSettingsJSON(settingsDataPath, settings);

        res.json({ success: true, message: 'Device binding removed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Google Auth settings
app.post('/api/admin/settings/security/google-auth', express.json(), (req, res) => {
    try {
        const { enabled, allowedEmail } = req.body;

        const settings = loadSettingsJSON(settingsDataPath, {});

        if (enabled && !allowedEmail) {
            return res.status(400).json({ error: 'Allowed email is required to enable Google Auth' });
        }

        settings.googleAuth = {
            enabled: !!enabled,
            allowedEmail: enabled ? allowedEmail : null,
            configuredAt: enabled ? new Date().toISOString() : null
        };

        saveSettingsJSON(settingsDataPath, settings);

        res.json({
            success: true,
            message: enabled ? 'Google Auth enabled' : 'Google Auth disabled'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ WEBHOOK API ============

app.post('/api/admin/webhooks', requireAdmin('settings:write'), express.json(), (req, res) => {
    try {
        const webhook = webhookService.createWebhook({ ...req.body, createdBy: req.admin.id });
        res.json({ success: true, webhook });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/admin/webhooks', requireAdmin('settings:read'), (req, res) => {
    res.json({ success: true, webhooks: webhookService.getWebhooks() });
});

app.get('/api/admin/webhooks/events/list', requireAdmin('settings:read'), (req, res) => {
    res.json({ success: true, events: webhookService.getAvailableEvents() });
});

app.post('/api/admin/webhooks/:id/test', requireAdmin('settings:write'), async (req, res) => {
    try {
        const delivery = await webhookService.testWebhook(req.params.id);
        res.json({ success: true, delivery });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/admin/webhooks/:id', requireAdmin('settings:write'), (req, res) => {
    const deleted = webhookService.deleteWebhook(req.params.id);
    res.json({ success: deleted });
});

// ============ BACKUP API ============

app.post('/api/admin/backups', requireAdmin('settings:write'), express.json(), (req, res) => {
    try {
        const backup = backupService.createBackup({ type: 'manual', description: req.body.description || 'Manual backup' });
        activityService.log('SYSTEM_BACKUP', { userId: req.admin.id, userName: req.admin.username, entityId: backup.id });
        res.json({ success: true, backup });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/backups', requireAdmin('settings:read'), (req, res) => {
    res.json({ success: true, ...backupService.getBackups({ limit: parseInt(req.query.limit) || 20 }) });
});

app.get('/api/admin/backups/stats', requireAdmin('settings:read'), (req, res) => {
    res.json({ success: true, ...backupService.getBackupStats() });
});

app.get('/api/admin/backups/:id/download', requireAdmin('settings:read'), (req, res) => {
    try {
        const { filename, data, contentType } = backupService.downloadBackup(req.params.id);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(data);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

app.post('/api/admin/backups/:id/restore', requireAdmin('settings:write'), express.json(), (req, res) => {
    try {
        const result = backupService.restoreBackup(req.params.id, { skipPreBackup: req.body.skipPreBackup });
        activityService.log('ADMIN_ACTION', { userId: req.admin.id, userName: req.admin.username, description: `Restored backup ${req.params.id}` });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ============ EXPORT API ============

app.get('/api/admin/export/leads', requireAdmin('leads:read'), (req, res) => {
    const leads = enterpriseService.getLeads({});
    const format = req.query.format || 'csv';
    const data = exportService.exportLeads(leads, { format });
    res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${new Date().toISOString().split('T')[0]}.${format}"`);
    res.send(data);
});

app.get('/api/admin/export/deals', requireAdmin('deals:read'), (req, res) => {
    const deals = enterpriseService.getDeals({});
    const format = req.query.format || 'csv';
    const data = exportService.exportDeals(deals, { format });
    res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="deals_${new Date().toISOString().split('T')[0]}.${format}"`);
    res.send(data);
});

app.get('/api/admin/export/proposals', requireAdmin('proposals:read'), (req, res) => {
    const proposals = proposalService.getProposals({});
    const format = req.query.format || 'csv';
    const data = exportService.exportProposals(proposals, { format });
    res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="proposals_${new Date().toISOString().split('T')[0]}.${format}"`);
    res.send(data);
});

app.get('/api/admin/export/sales-report', requireAdmin('analytics:read'), (req, res) => {
    const report = exportService.generateSalesReport({
        leads: enterpriseService.getLeads({}),
        deals: enterpriseService.getDeals({}),
        proposals: proposalService.getProposals({}),
        affiliates: enterpriseService.getAffiliates(),
        period: { from: req.query.from, to: req.query.to }
    });
    res.json({ success: true, report });
});

// ============ API KEY MANAGEMENT ============

app.post('/api/admin/api-keys', requireAdmin('settings:write'), express.json(), (req, res) => {
    const apiKey = securityService.generateAPIKey(req.admin.id, req.body.name, req.body.permissions);
    activityService.log('ADMIN_ACTION', { userId: req.admin.id, userName: req.admin.username, description: `Generated API key: ${req.body.name}` });
    res.json({ success: true, apiKey, message: 'Save this key securely. It will not be shown again.' });
});

// ============ NOTIFICATIONS API ============

app.get('/api/admin/notifications', requireAdmin(), (req, res) => {
    const result = notificationService.getNotifications(req.admin.id, {
        unreadOnly: req.query.unread === 'true',
        type: req.query.type,
        offset: parseInt(req.query.offset) || 0,
        limit: parseInt(req.query.limit) || 50
    });
    res.json({ success: true, ...result });
});

app.get('/api/admin/notifications/unread-count', requireAdmin(), (req, res) => {
    const count = notificationService.getUnreadCount(req.admin.id);
    res.json({ success: true, count });
});

app.post('/api/admin/notifications/:id/read', requireAdmin(), (req, res) => {
    notificationService.markRead(req.params.id, req.admin.id);
    res.json({ success: true });
});

app.post('/api/admin/notifications/read-all', requireAdmin(), (req, res) => {
    const count = notificationService.markAllRead(req.admin.id);
    res.json({ success: true, markedRead: count });
});

app.delete('/api/admin/notifications/:id', requireAdmin(), (req, res) => {
    notificationService.delete(req.params.id);
    res.json({ success: true });
});

// Test notification (for development)
app.post('/api/admin/notifications/test', requireAdmin('settings:write'), (req, res) => {
    const notification = notificationService.create({
        type: 'SYSTEM_ALERT',
        title: 'Test Notification',
        message: 'This is a test notification from the admin panel',
        priority: 'normal'
    });
    res.json({ success: true, notification });
});

// ============ ANALYTICS API ============

// ============ CONVERSION FUNNEL API ============
app.get('/api/admin/funnel', (req, res) => {
    try {
        const stats = getConversionFunnelStats();
        res.json({ success: true, ...stats, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[Funnel] Error:', err);
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/admin/funnel/live', (req, res) => {
    try {
        // Real-time: who's on checkout pages right now
        const activeCheckout = [];
        const activePricing = [];
        const activePayment = [];

        for (const session of realtimeAnalytics.activeSessions.values()) {
            const page = session.currentPage || '/';
            const entry = {
                page,
                device: session.device,
                browser: session.browser,
                country: session.country,
                city: session.city,
                source: session.source,
                pagesViewed: session.pageViews,
                duration: Math.round((Date.now() - session.startTime.getTime()) / 1000),
                journeyPages: session.pages.map(p => p.page)
            };

            if (['/checkout.html', '/order.html', '/pay.html'].includes(page)) {
                activeCheckout.push(entry);
            } else if (['/pricing.html', '/subscription/', '/lifetime.html'].some(p => page.startsWith(p))) {
                activePricing.push(entry);
            } else if (page.startsWith('/payment/')) {
                activePayment.push(entry);
            }
        }

        res.json({
            success: true,
            activeOnPricing: activePricing,
            activeOnCheckout: activeCheckout,
            activeOnPayment: activePayment,
            totalActive: realtimeAnalytics.activeSessions.size,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Get dashboard overview
app.get('/api/admin/analytics/overview', requireAdmin(), (req, res) => {
    const overview = analyticsService.getDashboardOverview();
    res.json({ success: true, ...overview });
});

// Get MRR/ARR metrics
app.get('/api/admin/analytics/mrr', requireAdmin(), (req, res) => {
    const mrr = analyticsService.getMRRMetrics();
    res.json({ success: true, ...mrr });
});

// Get revenue trend
app.get('/api/admin/analytics/revenue-trend', requireAdmin(), (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const trend = analyticsService.getRevenueTrend(days);
    res.json({ success: true, trend });
});

// Get lead sources
app.get('/api/admin/analytics/lead-sources', requireAdmin(), (req, res) => {
    const sources = analyticsService.getLeadSources();
    res.json({ success: true, sources });
});

// Get tier distribution
app.get('/api/admin/analytics/tier-distribution', requireAdmin(), (req, res) => {
    const tiers = analyticsService.getTierDistribution();
    res.json({ success: true, tiers });
});

// Get sales funnel
app.get('/api/admin/analytics/funnel', requireAdmin(), (req, res) => {
    const funnel = analyticsService.getSalesFunnel();
    res.json({ success: true, funnel });
});

// Get top affiliates
app.get('/api/admin/analytics/top-affiliates', requireAdmin(), (req, res) => {
    const limit = parseInt(req.query.limit) || 5;
    const affiliates = analyticsService.getTopAffiliates(limit);
    res.json({ success: true, affiliates });
});

// Get daily stats for sparklines
app.get('/api/admin/analytics/daily/:metric', requireAdmin(), (req, res) => {
    const { metric } = req.params;
    const days = parseInt(req.query.days) || 7;
    const stats = analyticsService.getDailyStats(metric, days);
    res.json({ success: true, stats });
});

// ============ TRAFFIC ANALYTICS ============
// NOTE: POST /api/track/pageview is defined earlier (line ~3029) and handles basic visitor stats.
// The advanced trafficService tracking below uses a different path to avoid duplicate route.

app.post('/api/track/advanced-pageview', express.json(), (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const data = {
            path: req.body.path || req.body.url || '/',
            referrer: req.body.referrer || req.headers.referer || 'direct',
            ip,
            userAgent,
            sessionId: req.body.sessionId,
            country: req.body.country || req.headers['cf-ipcountry'] || 'Unknown',
            city: req.body.city,
            screenWidth: req.body.screenWidth,
            screenHeight: req.body.screenHeight,
            language: req.body.language || req.headers['accept-language']?.split(',')[0]
        };

        const pageView = trafficService.trackPageView(data);

        // Track for live monitor
        if (global.trackMonitorActivity) {
            global.trackMonitorActivity('visit', {
                description: 'Page visited',
                page: data.path,
                country: data.country,
                city: data.city
            });
        }

        // Track user journey for sales funnel
        try {
            const fingerprint = req.body.fingerprint || req.body.sessionId || data.sessionId;
            if (fingerprint && salesDatabase) {
                salesDatabase.trackJourney(fingerprint, {
                    page: data.path,
                    source: data.referrer === 'direct' ? 'direct' : new URL(data.referrer || '').hostname
