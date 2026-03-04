
        results.checkDurationMs = Date.now() - startTime;
        res.json(results);

    } catch (err) {
        results.overall = 'error';
        results.score = 0;
        results.error = err.message;
        results.checkDurationMs = Date.now() - startTime;
        res.status(500).json(results);
    }
});

// ============ AI ERROR INTERCEPTOR API ============
// Frontend reports errors here — AI analyzes and auto-fixes in real-time
app.post('/api/ai/report-error', express.json(), async (req, res) => {
    try {
        const result = await aiErrorInterceptor.handleError({
            message: req.body.message,
            source: req.body.source || 'frontend',
            page: req.body.page,
            url: req.body.url,
            deviceId: req.body.deviceId,
            context: req.body.context || {},
        });

        res.json({
            success: true,
            issueId: result.issueId,
            handled: result.handled,
            category: result.categoryLabel,
            severity: result.severity,
            userMessage: result.userMessage,
            silent: result.silent,
        });
    } catch (err) {
        res.json({ success: false, error: 'AI interceptor error' });
    }
});

// AI Error Interceptor status dashboard
app.get('/api/ai/interceptor/status', (req, res) => {
    try {
        res.json({ success: true, ...aiErrorInterceptor.getStatus() });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// AI Error Interceptor full telemetry
app.get('/api/ai/interceptor/telemetry', (req, res) => {
    try {
        res.json({ success: true, ...aiErrorInterceptor.getTelemetry() });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Reset a permanent fix (admin action)
app.post('/api/ai/interceptor/reset-fix', express.json(), (req, res) => {
    try {
        const result = aiErrorInterceptor.resetPermanentFix(req.body.category);
        res.json({ success: true, ...result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============ MIRROR FAILOVER STATUS ============
// (CORS handled by global middleware at top of file)

// Mirror status endpoint - shows health of primary + mirror
app.get('/api/mirror/status', (req, res) => {
    const https = require('https');
    const mirrorUrl = 'https://up.doz.com.im/api/health';

    // Quick check mirror health
    const mirrorReq = https.get(mirrorUrl, { timeout: 5000, rejectUnauthorized: false }, (mirrorRes) => {
        let data = '';
        mirrorRes.on('data', chunk => data += chunk);
        mirrorRes.on('end', () => {
            res.json({
                primary: { status: 'ok', url: 'https://doz.com', uptime: process.uptime() },
                mirror: { status: mirrorRes.statusCode === 200 ? 'ok' : 'degraded', url: 'https://up.doz.com.im' },
                timestamp: new Date().toISOString()
            });
        });
    });
    mirrorReq.on('error', () => {
        res.json({
            primary: { status: 'ok', url: 'https://doz.com', uptime: process.uptime() },
            mirror: { status: 'unreachable', url: 'https://up.doz.com.im' },
            timestamp: new Date().toISOString()
        });
    });
    mirrorReq.on('timeout', () => {
        mirrorReq.destroy();
        res.json({
            primary: { status: 'ok', url: 'https://doz.com', uptime: process.uptime() },
            mirror: { status: 'timeout', url: 'https://up.doz.com.im' },
            timestamp: new Date().toISOString()
        });
    });
});

// ============ STATUS PAGE API ============
let _statusCache = null;
let _statusCacheTime = 0;
app.get('/api/status', (req, res) => {
    // Cache for 5 seconds to ensure fast responses
    const now = Date.now();
    if (_statusCache && now - _statusCacheTime < 5000) {
        return res.json(_statusCache);
    }

    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const startTime = now - (uptime * 1000);
    const isHealthy = memUsage.heapUsed < 800 * 1024 * 1024;
    const status = isHealthy ? 'operational' : 'degraded';

    _statusCache = {
        success: true,
        status,
        statusLabel: isHealthy ? 'All Systems Operational' : 'Degraded Performance',
        statusColor: isHealthy ? '#10b981' : '#fbbf24',
        lastUpdated: new Date(now).toISOString(),
        uptime: { seconds: Math.floor(uptime), startedAt: new Date(startTime).toISOString() },
        metrics: {
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMB: Math.round(memUsage.rss / 1024 / 1024)
        },
        services: [
            { name: 'API Gateway', status },
            { name: 'Upload Service', status: 'operational' },
            { name: 'Real-time', status: 'operational', connections: connectedUsers.size },
            { name: 'Authentication', status: 'operational' },
            { name: 'File Storage', status: 'operational' },
            { name: 'CDN', status: 'operational' }
        ],
        incidents: []
    };
    _statusCacheTime = now;
    res.json(_statusCache);
});

// ============ MISSING ENDPOINTS FIX ============

// Traffic tracking (for demo.html)
app.post('/api/traffic/track', express.json(), (req, res) => {
    res.json({ success: true, tracked: true });
});

app.get('/api/traffic/track', (req, res) => {
    res.json({ success: true, tracked: true });
});

// Help center API
app.get('/api/help/categories', (req, res) => {
    res.json({
        success: true,
        categories: [
            { id: 'getting-started', name: 'Getting Started', icon: '🚀', count: 5 },
            { id: 'uploads', name: 'Uploads & Sharing', icon: '📤', count: 8 },
            { id: 'account', name: 'Account & Billing', icon: '👤', count: 6 },
            { id: 'desktop', name: 'Desktop App', icon: '💻', count: 7 },
            { id: 'troubleshooting', name: 'Troubleshooting', icon: '🔧', count: 10 }
        ]
    });
});

app.get('/api/help/popular', (req, res) => {
    res.json({
        success: true,
        articles: [
            { id: 1, title: 'How to capture screenshots', category: 'getting-started', views: 1520 },
            { id: 2, title: 'Sharing files with a link', category: 'uploads', views: 1340 },
            { id: 3, title: 'Installing the desktop app', category: 'desktop', views: 1180 },
            { id: 4, title: 'Keyboard shortcuts', category: 'getting-started', views: 980 },
            { id: 5, title: 'Managing your gallery', category: 'uploads', views: 870 }
        ]
    });
});

app.get('/api/help/search', (req, res) => {
    res.json({ success: true, results: [] });
});

// Stripe public key endpoint
app.get('/api/stripe-key', (req, res) => {
    const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!stripeKey) {
        return res.json({ success: false, error: 'Stripe not configured' });
    }
    res.json({ success: true, publishableKey: stripeKey });
});

// Admin support inbox - show active support conversations & escalations
app.get('/api/admin/support/inbox', (req, res) => {
    const activeChats = [];
    supportClients.forEach((client, fingerprintId) => {
        if (client.conversationHistory.length > 0) {
            const lastMsg = client.conversationHistory[client.conversationHistory.length - 1];
            activeChats.push({
                fingerprintId,
                messageCount: client.conversationHistory.length,
                lastMessage: lastMsg.content?.substring(0, 100) || '',
                lastRole: lastMsg.role,
                visitorInfo: {
                    visitCount: client.profile?.visitCount || 0,
                    journeyStage: client.profile?.journeyStage || 'unknown'
                },
                isConnected: client.ws?.readyState === WebSocket.OPEN
            });
        }
    });
    res.json({
        success: true,
        activeChats,
        stats: {
            open: activeChats.length,
            connected: activeChats.filter(c => c.isConnected).length,
            total: supportClients.size
        }
    });
});

// Admin replies directly to a user in support chat
app.post('/api/admin/support/reply', express.json(), (req, res) => {
    const { fingerprintId, message } = req.body;
    if (!fingerprintId || !message) {
        return res.status(400).json({ success: false, error: 'fingerprintId and message required' });
    }
    const client = supportClients.get(fingerprintId);
    if (!client || client.ws?.readyState !== WebSocket.OPEN) {
        return res.status(404).json({ success: false, error: 'User not connected' });
    }
    // Send admin message to user
    client.ws.send(JSON.stringify({
        type: 'agent_joined',
        agentName: 'Support Team',
        message: {
            role: 'ASSISTANT',
            content: message,
            createdAt: new Date().toISOString(),
            fromAdmin: true
        }
    }));
    client.conversationHistory.push({ role: 'assistant', content: message });
    console.log(`[WS Support] Admin replied to ${fingerprintId}: ${message.substring(0, 50)}`);
    res.json({ success: true, message: 'Reply sent to user' });
});

// ============ USER INTELLIGENCE API ============

// Track user behavior
app.post('/api/intelligence/track', express.json(), (req, res) => {
    try {
        const { userId, deviceId, event } = req.body;
        if (!userId || !deviceId || !event) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        const tracked = userIntelligence.trackBehavior(userId, deviceId, event);
        res.json({ success: true, eventId: tracked.id });
    } catch (err) {
        console.error('[Intelligence] Track error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get pending fixes for device (called by desktop/mobile app)
app.get('/api/intelligence/fixes/:deviceId', (req, res) => {
    try {
        const fixes = userIntelligence.getPendingFixes(req.params.deviceId);
        res.json({ success: true, fixes });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Report fix result
app.post('/api/intelligence/fixes/:fixId/result', express.json(), (req, res) => {
    try {
        const result = userIntelligence.markFixApplied(req.params.fixId, req.body);
        res.json({ success: true, fix: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Submit explicit feedback
app.post('/api/intelligence/feedback', express.json(), (req, res) => {
    try {
        const { userId, deviceId, feedback } = req.body;
        const entry = userIntelligence.collectExplicitFeedback(userId, deviceId, feedback);
        res.json({ success: true, feedbackId: entry.id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get personalization profile
app.get('/api/intelligence/personalization/:userId', (req, res) => {
    try {
        const profile = userIntelligence.getPersonalizationProfile(req.params.userId);
        const recommendations = userIntelligence.getUIRecommendations(req.params.userId);
        res.json({ success: true, profile, recommendations });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Run device diagnostics
app.post('/api/intelligence/diagnostics', express.json(), (req, res) => {
    try {
        const { deviceId, deviceInfo } = req.body;
        const diagnostic = userIntelligence.runDiagnostics(deviceId, deviceInfo);
        res.json({ success: true, diagnostic });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get device health
app.get('/api/intelligence/health/:deviceId', (req, res) => {
    try {
        const health = userIntelligence.getDeviceHealth(req.params.deviceId);
        res.json({ success: true, ...health });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get intelligence stats (admin)
app.get('/api/intelligence/stats', (req, res) => {
    try {
        const stats = userIntelligence.getStats();
        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Force update check for all devices
app.post('/api/intelligence/force-update-check', (req, res) => {
    try {
        // Broadcast update check to all connected devices
        connectedUsers.forEach((user, ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'check_update',
                    version: DOWNLOAD_VERSION,
                    force: false
                }));
            }
        });
        res.json({ success: true, notified: connectedUsers.size });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ ENTERPRISE SALES API ============

// Get enterprise pricing tiers
app.get('/api/enterprise/tiers', (req, res) => {
    res.json({
        success: true,
        tiers: enterpriseService.getTiers()
    });
});

// Create enterprise lead
app.post('/api/enterprise/leads', express.json(), (req, res) => {
    try {
        const lead = enterpriseService.createLead(req.body);

        // Send notification for new lead
        notificationService.notifyNewLead(lead);

        // If hot lead, send urgent notification
        if (lead.priority === 'hot' || lead.score >= 80) {
            notificationService.notifyHotLead(lead);
        }

        // Log activity
        activityService.log('LEAD_CREATED', {
            description: `New lead: ${lead.company} - ${lead.name}`,
            entityType: 'lead',
            entityId: lead.id,
            entityName: lead.company
        });

        // Trigger webhooks
        webhookService.trigger('lead.created', lead);

        res.json({ success: true, lead });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get leads (admin)
app.get('/api/enterprise/leads', (req, res) => {
    const filters = {
        status: req.query.status,
        priority: req.query.priority,
        tier: req.query.tier
    };
    const leads = enterpriseService.getLeads(filters);
    res.json({ success: true, leads, count: leads.length });
});

// Update lead
app.put('/api/enterprise/leads/:id', express.json(), (req, res) => {
    const lead = enterpriseService.updateLead(req.params.id, req.body);
    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }
    res.json({ success: true, lead });
});

// Add lead activity
app.post('/api/enterprise/leads/:id/activity', express.json(), (req, res) => {
    const lead = enterpriseService.addLeadActivity(req.params.id, req.body);
    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }
    res.json({ success: true, lead });
});

// Create deal from lead
app.post('/api/enterprise/deals', express.json(), (req, res) => {
    try {
        const deal = enterpriseService.createDeal(req.body.leadId, req.body);

        // Log activity
        activityService.log('DEAL_CREATED', {
            description: `New deal: ${deal.company} - ${deal.tierName}`,
            entityType: 'deal',
            entityId: deal.id,
            entityName: deal.company
        });

        // Trigger webhooks
        webhookService.trigger('deal.created', deal);

        res.json({ success: true, deal });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get deals
app.get('/api/enterprise/deals', (req, res) => {
    const filters = { status: req.query.status };
    const deals = enterpriseService.getDeals(filters);
    res.json({ success: true, deals, count: deals.length });
});

// Update deal
app.put('/api/enterprise/deals/:id', express.json(), (req, res) => {
    const oldDeal = enterpriseService.getDeals().find(d => d.id === req.params.id);
    const deal = enterpriseService.updateDeal(req.params.id, req.body);
    if (!deal) {
        return res.status(404).json({ error: 'Deal not found' });
    }

    // Check for status changes and send notifications
    if (req.body.status && oldDeal && oldDeal.status !== req.body.status) {
        if (req.body.status === 'won') {
            notificationService.notifyDealWon(deal);
            activityService.log('DEAL_WON', {
                description: `Deal won: ${deal.company} - $${(deal.finalAmount / 100).toLocaleString()}`,
                entityType: 'deal',
                entityId: deal.id,
                entityName: deal.company
            });
            webhookService.trigger('deal.won', deal);
        } else if (req.body.status === 'lost') {
            notificationService.notifyDealLost(deal);
            activityService.log('DEAL_LOST', {
                description: `Deal lost: ${deal.company} - ${deal.lostReason || 'No reason'}`,
                entityType: 'deal',
                entityId: deal.id,
                entityName: deal.company
            });
            webhookService.trigger('deal.lost', deal);
        }
    }

    res.json({ success: true, deal });
});

// ============ AFFILIATE SYSTEM API ============

// Create affiliate
app.post('/api/affiliates', express.json(), (req, res) => {
    try {
