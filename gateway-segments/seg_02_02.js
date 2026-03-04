        let totalImages = 0;
        try {
            const imgDir = path.join(__dirname, 'uploads');
            if (fs.existsSync(imgDir)) {
                totalImages = fs.readdirSync(imgDir).filter(f => !f.startsWith('.')).length;
            }
        } catch (e) {}

        // Real checkout/sales data
        let activeCheckouts = 0;
        let recentPurchases = 0;
        let lastPurchaseMinutes = null;

        try {
            const salesDb = require('./services/sales-database');
            const activeJourneys = salesDb.getActiveJourneys ? salesDb.getActiveJourneys() : [];
            activeCheckouts = activeJourneys.filter(j =>
                j.stage === 'checkout' || j.stage === 'considering' ||
                (j.lastPage && (j.lastPage.includes('checkout') || j.lastPage.includes('pricing') || j.lastPage.includes('pay')))
            ).length;

            const sales = salesDb.getSales ? salesDb.getSales() : [];
            const oneHourAgo = now - (60 * 60 * 1000);
            recentPurchases = sales.filter(s => new Date(s.createdAt).getTime() > oneHourAgo).length;

            if (sales.length > 0) {
                const lastSale = sales[sales.length - 1];
                lastPurchaseMinutes = Math.floor((now - new Date(lastSale.createdAt).getTime()) / 60000);
            }
        } catch (e) {}

        const result = {
            success: true,
            activeVisitors,
            activeCheckouts,
            todayUploads,
            todayPageViews,
            todaySessions,
            totalImages,
            recentPurchases,
            lastPurchaseMinutes,
            cached: false
        };

        socialProofCache = { data: { ...result, cached: true }, timestamp: now };
        res.json(result);
    } catch (err) {
        console.error('[SocialProof] Error:', err);
        res.json({ success: false, activeVisitors: 0, activeCheckouts: 0, todayUploads: 0, todayPageViews: 0, todaySessions: 0, totalImages: 0, recentPurchases: 0, lastPurchaseMinutes: null });
    }
});

// Helper to get session ID from cookie header
function getSessionFromCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/doz_session=([^;]+)/);
    return match ? match[1] : null;
}

app.post('/api/analytics/pageview', express.json(), async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || getSessionFromCookies(req) || uuidv4();
        const event = await trackAnalyticsPageView(req, sessionId, req.body?.page || '/');
        res.json({ success: true, event });
    } catch (err) {
        console.error('[Analytics] Pageview error:', err);
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/analytics/event', express.json(), (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || getSessionFromCookies(req) || uuidv4();
        const event = trackAnalyticsEvent(sessionId, req.body?.name, req.body?.data);
        res.json({ success: true, event });
    } catch (err) {
        console.error('[Analytics] Event error:', err);
        res.json({ success: false, error: err.message });
    }
});

// Performance monitoring endpoint - receives client-side freeze/performance logs
// Now silently routed through AI interceptor instead of spamming logs
app.post('/api/performance-log', express.text({ type: '*/*' }), (req, res) => {
    try {
        const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        // Route through AI interceptor silently — no more console.warn spam
        if (data.event === 'freeze' || data.event === 'safe_mode') {
            aiErrorInterceptor.handleError({
                message: `Client ${data.event}: ${data.data?.duration || 0}ms at ${data.url || 'unknown'}`,
                source: 'performance-monitor',
                context: {
                    event: data.event,
                    duration: data.data?.duration,
                    freezeCount: data.data?.freezeCount || data.data?.count,
                },
            });
        }
    } catch (err) {
        // Silent
    }
    res.status(200).end();
});

console.log('[Analytics] Real-time analytics system initialized');

// ============ AI SUPPORT WEBSOCKET (Luna Chat Widget) ============
const supportWss = new WebSocket.Server({ noServer: true });
const supportClients = new Map(); // fingerprintId -> { ws, profile, conversationHistory }

// ============ AI AGENTS WEBSOCKET ============
const agentsWss = new WebSocket.Server({ noServer: true });

agentsWss.on('connection', (ws) => {
    console.log('[Agents] Dashboard client connected');
    // Send current status immediately (legacy + V2)
    try {
        const status = agentOrchestrator.getStatus();
        ws.send(JSON.stringify({ type: 'status', ...status }));
    } catch (e) {}
    try {
        const v2Status = orchestratorV2.getStatus();
        ws.send(JSON.stringify({ type: 'v2:status', ...v2Status }));
    } catch (e) {}

    ws.on('close', () => {
        console.log('[Agents] Dashboard client disconnected');
    });
});

// Forward all orchestrator events to WebSocket clients
['agent:start', 'agent:progress', 'agent:finding', 'agent:complete', 'agent:error', 'cycle:start'].forEach(evt => {
    agentOrchestrator.on(evt, (data) => {
        const message = JSON.stringify({ type: evt, ...data });
        agentsWss.clients.forEach(client => {
            if (client.readyState === 1) {
                try { client.send(message); } catch (e) {}
            }
        });
    });
});

// Load agents and start schedule
agentOrchestrator.loadAgents();
agentOrchestrator.startSchedule(30);

// ============ ORCHESTRATOR V2 (1000+ AI Agents) ============
try {
    orchestratorV2.initialize();
    orchestratorV2.startSchedule();
    console.log('[Gateway] Orchestrator V2 started with 1000+ agents');
} catch (err) {
    console.error('[Gateway] Orchestrator V2 init failed:', err.message);
}

// Forward V2 orchestrator events to agents WebSocket
if (orchestratorV2 && typeof orchestratorV2.on === 'function') {
    ['agent:start', 'agent:progress', 'agent:finding', 'agent:complete', 'agent:error', 'tier:start', 'tier:complete'].forEach(evt => {
        orchestratorV2.on(evt, (data) => {
            const message = JSON.stringify({ type: `v2:${evt}`, ...data });
            agentsWss.clients.forEach(client => {
                if (client.readyState === 1) {
                    try { client.send(message); } catch (e) {}
                }
            });
        });
    });
}

// ============ AUTOMATED DATA BACKUP ============
// Backs up critical JSON data files every 6 hours
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const BACKUP_FILES = ['uploads.json', 'auth-users.json', 'auth-credentials.json', 'sales.json', 'traffic.json', 'analytics-advanced.json'];

function runDataBackup() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        let backed = 0;

        for (const file of BACKUP_FILES) {
            const src = path.join(__dirname, 'data', file);
            if (!fs.existsSync(src)) continue;
            const stat = fs.statSync(src);
            if (stat.size === 0) continue;
            // Skip files > 50MB for backup
            if (stat.size > 50 * 1024 * 1024) continue;

            const dest = path.join(BACKUP_DIR, `${timestamp}_${file}`);
            fs.copyFileSync(src, dest);
            backed++;
        }

        // Prune backups older than 7 days
        try {
            const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const backups = fs.readdirSync(BACKUP_DIR);
            for (const f of backups) {
                const fp = path.join(BACKUP_DIR, f);
                const fstat = fs.statSync(fp);
                if (fstat.mtimeMs < cutoff) fs.unlinkSync(fp);
            }
        } catch (e) {}

        console.log(`[Backup] Backed up ${backed} data files (${timestamp})`);
    } catch (e) {
        console.error('[Backup] Error:', e.message);
    }
}

// Run backup on startup and every 6 hours
setTimeout(runDataBackup, 30000); // 30s after start
setInterval(runDataBackup, 6 * 60 * 60 * 1000);

supportWss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${HOST}`);
    const fingerprintId = url.searchParams.get('fingerprint') || 'anon_' + Date.now();
    const visitorId = url.searchParams.get('visitor') || '';
    const sessionId = url.searchParams.get('session') || '';
    const deviceInfo = {
        platform: url.searchParams.get('platform') || '',
        screen: url.searchParams.get('screen') || '',
        timezone: url.searchParams.get('tz') || '',
        language: url.searchParams.get('lang') || 'en'
    };

    // Get or create visitor profile
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
    const refLower = referrer.toLowerCase();
    let source = 'direct';
    if (refLower.includes('google.') || refLower.includes('bing.') || refLower.includes('yahoo.')) source = 'organic';
    else if (refLower.includes('facebook.') || refLower.includes('twitter.') || refLower.includes('instagram.')) source = 'social';
    else if (referrer && !refLower.includes(HOST)) source = 'referral';
    const profile = visitorIntelligence.getOrCreateProfile(fingerprintId, deviceInfo, source);
    const greeting = visitorIntelligence.generatePersonalizedGreeting(profile);

    // Store client connection
    supportClients.set(fingerprintId, {
        ws,
        profile,
        conversationHistory: [],
        visitorId,
        sessionId
    });

    console.log(`[WS Support] Client connected - fingerprint: ${fingerprintId}, returning: ${profile.visitCount > 1}, visits: ${profile.visitCount}`);

    // Send connected acknowledgment with profile data
    ws.send(JSON.stringify({
        type: 'connected',
        conversationId: sessionId,
        fingerprintId,
        isReturning: profile.visitCount > 1,
        visitCount: profile.visitCount,
        journeyStage: profile.journeyStage || 'new',
        personalizedGreeting: greeting
    }));

    ws.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw);
            const client = supportClients.get(fingerprintId);
            if (!client) return;

            switch (data.type) {
                case 'start_conversation': {
                    if (data.pageUrl) {
                        visitorIntelligence.recordPageVisit(fingerprintId, data.pageUrl);
                    }

                    const welcomeMsg = greeting || "Hi there! I'm Luna, your AI assistant. How can I help you today?";

                    // Stage-aware suggested actions for sales conversion
                    const stage = profile.journeyStage || 'new';
                    let startActions;
                    switch (stage) {
                        case 'exploring':
                            startActions = [
                                { type: 'text', label: 'See all features', value: 'What features does DOZ UP have?' },
                                { type: 'text', label: 'Compare plans', value: 'Can you compare the plans?' },
                                { type: 'text', label: 'Download app', value: 'How do I download DOZ UP?' }
                            ];
                            break;
                        case 'interested':
                        case 'considering':
                            startActions = [
                                { type: 'text', label: 'Compare plans', value: 'Can you compare the Starter and Pro plans?' },
                                { type: 'text', label: 'Any discounts?', value: 'Do you have any discount codes or special offers?' },
                                { type: 'link', label: 'View pricing', url: 'https://up.doz.com/pay.html' }
                            ];
                            break;
                        case 'customer':
                            startActions = [
                                { type: 'text', label: 'Help with account', value: 'I need help with my account' },
                                { type: 'text', label: 'How to use Studio', value: 'How do I use the Studio tools?' },
                                { type: 'text', label: 'Upgrade plan', value: 'I want to upgrade my plan' }
                            ];
                            break;
                        default:
                            startActions = [
                                { type: 'text', label: 'What is DOZ UP?', value: 'What is DOZ UP and how does it work?' },
                                { type: 'text', label: 'Pricing & Plans', value: 'Tell me about your pricing plans' },
                                { type: 'text', label: 'Get started free', value: 'How do I get started for free?' }
                            ];
                    }

                    ws.send(JSON.stringify({
                        type: 'conversation_started',
                        conversationId: sessionId,
                        isReturning: profile.visitCount > 1,
                        message: {
                            role: 'ASSISTANT',
                            content: welcomeMsg,
                            createdAt: new Date().toISOString(),
                            suggestedActions: startActions
                        }
                    }));
                    break;
                }

                case 'message': {
                    const userMessage = data.content;
                    if (!userMessage) break;

                    // Record action
                    visitorIntelligence.recordAction(fingerprintId, 'support_message', { message: userMessage.substring(0, 100) });

                    // Store in conversation history
                    client.conversationHistory.push({ role: 'user', content: userMessage });

                    // Send typing indicator
                    ws.send(JSON.stringify({ type: 'typing', isTyping: true, sender: 'assistant' }));

                    try {
                        // Get visitor context for AI
                        const visitorContext = visitorIntelligence.getVisitorContextForAI(fingerprintId);

                        // Generate AI response
                        const aiResponse = await aiSupportEngine.generateResponseWithTimeout(
                            client.conversationHistory,
                            userMessage,
                            visitorContext
                        );

                        // Stop typing
                        ws.send(JSON.stringify({ type: 'typing', isTyping: false, sender: 'assistant' }));

                        // Store in history
                        client.conversationHistory.push({ role: 'assistant', content: aiResponse.content });

                        // Send response
                        ws.send(JSON.stringify({
                            type: 'message',
                            message: {
                                role: 'ASSISTANT',
                                content: aiResponse.content,
                                createdAt: new Date().toISOString(),
                                suggestedActions: aiResponse.suggestedActions || []
                            }
                        }));

                        // Handle escalation if needed
                        if (aiResponse.shouldEscalate) {
                            ws.send(JSON.stringify({
                                type: 'escalated',
                                message: {
                                    role: 'SYSTEM',
                                    content: 'Connecting you with a human agent...',
                                    createdAt: new Date().toISOString()
                                }
                            }));

                            // Notify ALL connected admins immediately
                            const escalationAlert = {
                                type: 'support_escalation',
                                urgent: true,
                                data: {
                                    fingerprintId,
                                    reason: aiResponse.escalationReason || 'UNKNOWN',
                                    lastMessage: userMessage.substring(0, 200),
                                    confidence: aiResponse.confidence,
                                    conversationLength: client.conversationHistory.length,
                                    visitorProfile: {
                                        visitCount: client.profile?.visitCount || 0,
                                        journeyStage: client.profile?.journeyStage || 'unknown'
                                    },
                                    timestamp: new Date().toISOString()
                                }
                            };
                            const alertJson = JSON.stringify(escalationAlert);
                            adminConnections.forEach((conn, id) => {
                                try {
                                    if (conn.ws.readyState === WebSocket.OPEN) {
                                        conn.ws.send(alertJson);
                                    }
                                } catch (e) {}
                            });
                            console.log(`[WS Support] ESCALATION: ${aiResponse.escalationReason} from ${fingerprintId} - notified ${adminConnections.size} admins`);
                        }
                    } catch (aiErr) {
                        console.error('[WS Support] AI response error:', aiErr.message);
                        ws.send(JSON.stringify({ type: 'typing', isTyping: false, sender: 'assistant' }));
                        ws.send(JSON.stringify({
                            type: 'message',
                            message: {
                                role: 'ASSISTANT',
                                content: "I'm sorry, I'm having trouble processing your request right now. Please try again or email us at support@doz.com for immediate assistance.",
                                createdAt: new Date().toISOString()
                            }
                        }));
                    }
                    break;
                }

                case 'behavior': {
                    // Evaluate triggers based on behavior data
                    const behaviorData = {
                        ...data.behavior,
                        visitorId,
                        sessionId,
                        fingerprintId
                    };

                    const trigger = supportTriggers.evaluateTriggersWithProfile(behaviorData, profile);

                    if (trigger) {
                        console.log(`[WS Support] Trigger fired: ${trigger.triggerName} for ${fingerprintId}`);
                        ws.send(JSON.stringify({
                            type: 'trigger',
                            trigger: {
                                id: trigger.id,
                                message: trigger.message,
                                offerType: trigger.offerType
                            }
                        }));
                        visitorIntelligence.recordAction(fingerprintId, 'support_trigger', { triggerId: trigger.triggerId });
                    }
                    break;
                }

                case 'typing': {
                    // User typing indicator - no action needed server-side
                    break;
                }

                case 'rating': {
                    // Store support rating
                    visitorIntelligence.recordAction(fingerprintId, 'support_rating', { rating: data.rating });
                    console.log(`[WS Support] Rating received: ${data.rating} from ${fingerprintId}`);
                    break;
                }
            }
        } catch (err) {
            console.error('[WS Support] Message processing error:', err.message);
        }
    });

    ws.on('close', () => {
        supportClients.delete(fingerprintId);
        console.log(`[WS Support] Client disconnected - ${fingerprintId}. Active: ${supportClients.size}`);
    });

    ws.on('error', () => {
        supportClients.delete(fingerprintId);
    });
});

console.log('[Support] Luna AI support WebSocket initialized on /ws/support');

// ============ SSH TERMINAL RELAY WITH HIGH AVAILABILITY ============
const SSHRelayHA = require('./terminal/ssh-relay-ha');
const { createSSHUplinkAPI } = require('./services/ssh-uplink-api');

// Initialize High Availability SSH Relay with load balancer
const sshRelay = new SSHRelayHA(server, '/terminal/ssh');

// Mount SSH uplink management API
createSSHUplinkAPI(app);

// Serve terminal frontend
app.use('/terminal', express.static(path.join(__dirname, 'terminal')));

// Terminal stats API (enhanced with load balancer info)
app.get('/api/terminal/stats', (req, res) => {
    const stats = sshRelay.getStats();
    res.json({
        ...stats,
        highAvailability: true,
        uplinks: sshRelay.getUplinks()
    });
});

// ============ ADMIN API ENDPOINTS ============

// Global admin auth middleware - protects ALL /api/admin/* routes
// Exemptions: /api/admin/auth/login (needs to be accessible before auth)
app.use('/api/admin', (req, res, next) => {
    // Allow login endpoint through
    if (req.path === '/auth/login') return next();
