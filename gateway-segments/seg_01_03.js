
app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.includes('corporate.doz.com.im')) {
        // API and Socket.IO routes proxy to backend
        if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
            const proxy = createProxyMiddleware({
                target: CORPORATE_BACKEND,
                changeOrigin: true,
                ws: true,
                logLevel: 'warn'
            });
            return proxy(req, res, next);
        }

        // Static files for React app
        if (req.path === '/') {
            return res.sendFile(path.join(CORPORATE_STATIC_DIR, 'index.html'));
        }

        // Try to serve static file
        const filePath = path.join(CORPORATE_STATIC_DIR, req.path);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return res.sendFile(filePath);
        }

        // SPA fallback - serve index.html for client-side routing
        return res.sendFile(path.join(CORPORATE_STATIC_DIR, 'index.html'));
    }
    next();
});

// Version check API
app.get('/api/version', (req, res) => {
    res.json(VERSION_INFO);
});

// ============ SSL STATUS API ============
app.get('/api/ssl/status', (req, res) => {
    const hasCA = !!SSL_CERTS.default.ca;
    res.json({
        success: true,
        ssl: {
            enabled: !!(SSL_CERTS.default.key && SSL_CERTS.default.cert),
            hasKey: !!SSL_CERTS.default.key,
            hasCert: !!SSL_CERTS.default.cert,
            hasCA: hasCA,
            caSize: SSL_CERTS.default.ca ? SSL_CERTS.default.ca.length : 0,
            minVersion: SSL_OPTIONS.minVersion || 'TLSv1.2',
            httpsServerRunning: !!httpsServer
        },
        environment: process.env.NODE_ENV || 'development',
        recommendations: [
            ...(!hasCA ? ['Add CA bundle (ca-bundle.crt or chain.crt) for complete certificate chain'] : []),
            ...(!SSL_CERTS.default.key || !SSL_CERTS.default.cert ? ['SSL certificates not found. Add server.key and server.crt to ssl/ folder'] : []),
            ...(process.env.NODE_ENV !== 'production' ? ['Set NODE_ENV=production for strict SSL verification'] : [])
        ]
    });
});

// SSL certificate verification endpoint
app.get('/api/ssl/verify', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL parameter required' });
    }
    try {
        const urlObj = new URL(url);
        if (urlObj.protocol !== 'https:') {
            return res.json({ success: true, ssl: false, message: 'Not an HTTPS URL' });
        }
        const testAgent = new https.Agent({ rejectUnauthorized: true });
        const response = await fetch(url, {
            method: 'HEAD',
            agent: testAgent,
            signal: AbortSignal.timeout(5000)
        });
        res.json({
            success: true,
            ssl: true,
            valid: true,
            status: response.status,
            message: 'SSL certificate is valid'
        });
    } catch (error) {
        res.json({
            success: true,
            ssl: true,
            valid: false,
            error: error.message,
            code: error.code || 'UNKNOWN',
            message: error.message.includes('certificate')
                ? 'SSL certificate verification failed - check certificate chain'
                : error.message
        });
    }
});

// Force update check - returns if update is required
app.get('/api/check-update', (req, res) => {
    const clientVersion = req.query.v || req.headers['x-app-version'] || '0.0.0';

    const needsUpdate = isVersionLower(clientVersion, MIN_SUPPORTED_VERSION);
    const hasUpdate = isVersionLower(clientVersion, DOWNLOAD_VERSION);

    res.json({
        currentVersion: DOWNLOAD_VERSION,
        clientVersion: clientVersion,
        needsUpdate: needsUpdate,
        forceUpdate: FORCE_UPDATE && needsUpdate,
        hasUpdate: hasUpdate,
        downloadUrl: VERSION_INFO.downloadUrl,
        changelog: VERSION_INFO.changelog
    });
});

// Helper function to compare versions
function isVersionLower(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return true;
        if (p1 > p2) return false;
    }
    return false;
}

// Broadcast force update to all connected clients
function broadcastForceUpdate() {
    const message = JSON.stringify({
        type: 'force-update',
        version: DOWNLOAD_VERSION,
        downloadUrl: VERSION_INFO.downloadUrl,
        changelog: VERSION_INFO.changelog,
        message: `DOZ UP v${DOWNLOAD_VERSION} is now available! Please update for the latest features and fixes.`
    });

    connectedUsers.forEach(user => {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    });

    console.log(`[Update] Broadcasted force update to ${connectedUsers.size} clients`);
}

// ============ SEO MASS SUBMISSION SYSTEM ============
const { SEOSubmitter, MEGA_PING_LIST } = require('./services/seo-submitter');
const { StructuredDataGenerator, BacklinkOpportunities, KeywordStrategy, SocialProof } = require('./services/organic-traffic');

const seoSubmitter = new SEOSubmitter();

// Run SEO submission
app.post('/api/seo/submit', async (req, res) => {
    try {
        console.log('[SEO] Starting mass submission...');
        const report = await seoSubmitter.runFullSubmission();
        res.json({ success: true, report });
    } catch (err) {
        console.error('[SEO] Submission error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ping specific search engine
app.get('/api/seo/ping/:engine', async (req, res) => {
    const { engine } = req.params;
    const sitemapUrl = `https://${HOST}/sitemap.xml`;

    const pingUrls = {
        google: `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
        bing: `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
        yandex: `https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`
    };

    if (!pingUrls[engine]) {
        return res.status(400).json({ success: false, error: 'Unknown engine. Use: google, bing, yandex' });
    }

    try {
        const response = await seoSubmitter.httpGet(pingUrls[engine]);
        res.json({ success: response.status < 400, engine, status: response.status });
    } catch (err) {
        res.json({ success: false, engine, error: err.message });
    }
});

// IndexNow instant indexing
app.post('/api/seo/indexnow', express.json(), async (req, res) => {
    const urls = req.body.urls || [`https://${HOST}`];
    try {
        const results = await seoSubmitter.submitIndexNow(urls);
        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get structured data for SEO
app.get('/api/seo/structured-data', (req, res) => {
    res.json({
        software: StructuredDataGenerator.getSoftwareSchema(),
        organization: StructuredDataGenerator.getOrganizationSchema(),
        faq: StructuredDataGenerator.getFAQSchema(),
        howTo: StructuredDataGenerator.getHowToSchema(),
        website: StructuredDataGenerator.getWebsiteSchema(),
        product: StructuredDataGenerator.getProductSchema()
    });
});

// Get backlink opportunities
app.get('/api/seo/backlinks', (req, res) => {
    res.json({
        opportunities: BacklinkOpportunities.getOpportunities(),
        contentTemplates: BacklinkOpportunities.getContentTemplates()
    });
});

// Get keyword strategy
app.get('/api/seo/keywords', (req, res) => {
    res.json({
        primary: KeywordStrategy.getPrimaryKeywords(),
        longTail: KeywordStrategy.getLongTailKeywords(),
        contentIdeas: KeywordStrategy.getContentIdeas()
    });
});

// Get social proof schema
app.get('/api/seo/reviews', (req, res) => {
    const reviews = SocialProof.getSampleReviews();
    res.json({
        reviews,
        schema: SocialProof.getReviewSchema(reviews)
    });
});

// Mega ping - ping all services
app.post('/api/seo/mega-ping', async (req, res) => {
    console.log('[SEO] Starting mega ping to all services...');
    const results = [];
    let success = 0;
    let failed = 0;

    for (const pingUrl of MEGA_PING_LIST.slice(0, 50)) { // Limit to 50 for performance
        try {
            const fullUrl = pingUrl.includes('sitemap=') ? pingUrl : pingUrl + `https://${HOST}/sitemap.xml`;
            const response = await seoSubmitter.httpGet(fullUrl, 5000);
            const isSuccess = response.status >= 200 && response.status < 400;
            results.push({ url: pingUrl, success: isSuccess, status: response.status });
            if (isSuccess) success++; else failed++;
        } catch (err) {
            results.push({ url: pingUrl, success: false, error: err.message });
            failed++;
        }
    }

    console.log(`[SEO] Mega ping complete: ${success} success, ${failed} failed`);
    res.json({ success: true, total: results.length, successful: success, failed, results });
});

// Auto-run SEO submission on server start (after 30 seconds)
setTimeout(async () => {
    console.log('[SEO] Running automatic submission on server start...');
    try {
        await seoSubmitter.runFullSubmission();
    } catch (err) {
        console.error('[SEO] Auto-submission error:', err.message);
    }
}, 30000);

// ============ VIRAL GROWTH ENGINE WITH ADMIN AUTH ============
const { ViralEngine } = require('./services/viral-engine');
const { ViralAnalytics } = require('./services/viral-analytics');
// crypto already required at top of file

const viralEngine = new ViralEngine();
const viralAnalytics = new ViralAnalytics();

// Admin credentials for viral dashboard
const VIRAL_ADMIN = {
    username: 'admin',
    password: process.env.ADMIN_PASSWORD || process.env.VIRAL_ADMIN_PASSWORD,
    tokens: new Map() // token -> { expires, username }
};

// Generate admin token
function generateViralToken(username) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
    VIRAL_ADMIN.tokens.set(token, { expires, username });
    return token;
}

// Verify admin token
function verifyViralToken(token) {
    if (!token) return false;
    const data = VIRAL_ADMIN.tokens.get(token);
    if (!data) return false;
    if (Date.now() > data.expires) {
        VIRAL_ADMIN.tokens.delete(token);
        return false;
    }
    return true;
}

// Admin auth middleware
function viralAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7);
    if (!verifyViralToken(token)) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    next();
}

// Viral admin login
app.post('/api/viral/login', express.json(), (req, res) => {
    const { username, password } = req.body;
    if (username === VIRAL_ADMIN.username && password === VIRAL_ADMIN.password) {
        const token = generateViralToken(username);
        console.log('[Viral] Admin logged in');
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

// Verify token endpoint
app.get('/api/viral/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.json({ valid: false });
    }
    const token = authHeader.slice(7);
    res.json({ valid: verifyViralToken(token) });
});

// Protected: Get viral dashboard data
app.get('/api/viral/dashboard', viralAdminAuth, (req, res) => {
    res.json(viralAnalytics.getDashboard());
});

// Protected: Get viral stats
app.get('/api/viral/stats', viralAdminAuth, (req, res) => {
    res.json(viralAnalytics.getRealtimeStats());
});

// Protected: Trigger viral campaign manually
app.post('/api/viral/run', viralAdminAuth, async (req, res) => {
    try {
        console.log('[Viral] Manual viral campaign triggered by admin');
        const stats = await viralEngine.runFullCampaign();
        viralAnalytics.recordCycle(stats);
        res.json({ success: true, stats });
    } catch (err) {
        console.error('[Viral] Campaign error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// WebSocket for real-time viral updates
const viralWsClients = new Set();

// Auto-run viral campaign every 5 minutes
let viralCycleRunning = false;
async function runViralCycle() {
    if (viralCycleRunning) return;
    viralCycleRunning = true;

    try {
        console.log('[Viral] Starting automatic cycle...');
        const stats = await viralEngine.runFullCampaign();
        viralAnalytics.recordCycle(stats);

        // Broadcast to WebSocket clients
        const dashData = viralAnalytics.getDashboard();
        viralWsClients.forEach(ws => {
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'dashboard', data: dashData }));
                ws.send(JSON.stringify({ type: 'cycle-complete', cycle: stats.totalSubmissions, success: stats.successful, failed: stats.failed }));
            }
        });

        console.log(`[Viral] Cycle complete: ${stats.successful} success, ${stats.failed} failed`);
    } catch (err) {
        console.error('[Viral] Cycle error:', err.message);
    }

    viralCycleRunning = false;
}

// Start viral engine after 60 seconds, run every 5 minutes
setTimeout(() => {
    console.log('[Viral] Starting continuous viral engine (every 5 minutes)...');
    runViralCycle();
    setInterval(runViralCycle, 5 * 60 * 1000);
}, 60000);

// Broadcast viral dashboard every 15 seconds (skip if no clients connected)
setInterval(() => {
    if (viralWsClients.size === 0) return;
    const dashData = viralAnalytics.getDashboard();
    viralWsClients.forEach(ws => {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'dashboard', data: dashData }));
        }
    });
}, 15000);

// Broadcast stats every 30 seconds (was 10s)
setInterval(broadcastStats, 30000);

// ============ APP DASHBOARD CONNECTIONS (for real-time order notifications) ============
const appDashboards = new Set();

// Broadcast new order to all connected app dashboards
function broadcastNewOrder(order) {
    const message = JSON.stringify({
        type: 'new_order',
        order: {
            id: order.id,
            customerName: order.customerName || order.email || 'Customer',
            email: order.email,
            plan: order.plan || 'Pro',
            amount: order.amount || 9.99,
            status: order.status || 'active',
            timestamp: Date.now()
        }
    });

    // Broadcast to app dashboards via the main WebSocket
    connectedUsers.forEach((user) => {
        if (user.type === 'dashboard' && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    });

    // Also broadcast to analytics WebSocket clients (admin dashboards connect here)
    if (typeof analyticsWss !== 'undefined' && analyticsWss.clients) {
        analyticsWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
        console.log(`[WS App] Broadcasted new order to ${analyticsWss.clients.size} analytics clients`);
    }

    // Also broadcast to admin WebSocket clients
    if (typeof adminWss !== 'undefined' && adminWss.clients) {
        adminWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    console.log(`[WS App] Broadcasted new order to dashboards`);
}

// Export for use in payment webhooks
global.broadcastNewOrder = broadcastNewOrder;

// ============ ADMIN NOTIFICATION WEBSOCKET ============
const adminWss = new WebSocket.Server({ noServer: true });
const adminConnections = new Map(); // adminId -> { ws, user, subscribedAt }

adminWss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${HOST}`);
    const token = url.searchParams.get('token');

    // Verify admin token
    const tokenData = securityService.verifyToken(token);
    if (!tokenData) {
        ws.close(4001, 'Invalid or expired token');
        return;
    }

    // Get admin user
    const admin = adminService.get(tokenData.userId);
    if (!admin) {
        ws.close(4002, 'Admin not found');
        return;
    }

    const connectionId = uuidv4();

    adminConnections.set(connectionId, {
        ws,
        user: admin,
        subscribedAt: Date.now()
    });

    console.log(`[WS Admin] ${admin.username} connected - Total: ${adminConnections.size}`);

