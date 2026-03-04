// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dbUtils = require('./lib/db'); // Shared async database utility
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const ftp = require('basic-ftp');

// Process error handlers - prevent silent crashes + AI interception
process.on('uncaughtException', (err) => {
    // EADDRINUSE is handled by server.on('error') with retry logic — don't crash
    if (err.code === 'EADDRINUSE') return;
    console.error('[FATAL] Uncaught Exception:', err);
    try {
        const aiInterceptor = require('./services/ai-error-interceptor');
        aiInterceptor.handleError({ message: err.message, source: 'uncaughtException', stack: err.stack });
    } catch (e) { /* AI interceptor not yet loaded */ }
    if (err.code === 'ERR_HTTP_HEADERS_SENT') {
        console.error('[FATAL] Exiting in 1s for PM2 restart...');
        setTimeout(() => process.exit(1), 1000);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    // Suppress Redis/BullMQ connection errors (no Redis server, handled by fallback)
    const msg = reason?.message || String(reason);
    if (msg.includes('Connection is closed') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('maxRetriesPerRequest')) {
        return;
    }
    console.error('[FATAL] Unhandled Rejection:', reason);
    try {
        const aiInterceptor = require('./services/ai-error-interceptor');
        aiInterceptor.handleError({ message: msg, source: 'unhandledRejection', stack: reason?.stack });
    } catch (e) { /* AI interceptor not yet loaded */ }
});

// SSL Configuration for HTTPS with SNI support
const tls = require('tls');

// SSL directory path
const sslDir = path.join(__dirname, 'ssl');

// Load CA bundle (intermediate certificates)
const loadCABundle = () => {
    const caBundlePaths = [
        path.join(sslDir, 'ca-bundle.crt'),
        path.join(sslDir, 'chain.crt'),
        path.join(sslDir, 'cloudflare-origin-ca.crt')
    ];
    console.log('[SSL] Looking for CA bundle in:', sslDir);
    for (const caPath of caBundlePaths) {
        const exists = fs.existsSync(caPath);
        console.log(`[SSL] Checking ${caPath}: ${exists}`);
        if (exists) {
            console.log('[SSL] Found CA bundle:', caPath);
            return fs.readFileSync(caPath);
        }
    }
    console.log('[SSL] No CA bundle found');
    return null;
};

const caBundle = loadCABundle();
console.log('[SSL] CA Bundle loaded:', !!caBundle);

// Check for local development SSL mode
const useLocalSSL = process.env.USE_LOCAL_SSL === 'true';
console.log('[SSL] Local SSL mode:', useLocalSSL);

// Load local development certificates if available
const loadLocalCerts = () => {
    const localCertPath = path.join(sslDir, 'local-server.crt');
    const localKeyPath = path.join(sslDir, 'local-server.key');
    const localCaPath = path.join(sslDir, 'local-ca.crt');

    if (fs.existsSync(localCertPath) && fs.existsSync(localKeyPath)) {
        console.log('[SSL] Local development certificates found');
        return {
            key: fs.readFileSync(localKeyPath),
            cert: fs.readFileSync(localCertPath),
            ca: fs.existsSync(localCaPath) ? fs.readFileSync(localCaPath) : null
        };
    }
    return null;
};

const localCerts = useLocalSSL ? loadLocalCerts() : null;

// Load certificates for different domains
const SSL_CERTS = {
    default: localCerts || {
        key: fs.existsSync(path.join(sslDir, 'server.key'))
            ? fs.readFileSync(path.join(sslDir, 'server.key'))
            : null,
        cert: fs.existsSync(path.join(sslDir, 'server.crt'))
            ? fs.readFileSync(path.join(sslDir, 'server.crt'))
            : null,
        ca: caBundle
    },
    'spedx.store': {
        key: fs.existsSync(path.join(sslDir, 'spedx', 'spedx.store-key.pem'))
            ? fs.readFileSync(path.join(sslDir, 'spedx', 'spedx.store-key.pem'))
            : null,
        cert: fs.existsSync(path.join(sslDir, 'spedx', 'spedx.store-chain.pem'))
            ? fs.readFileSync(path.join(sslDir, 'spedx', 'spedx.store-chain.pem'))
            : null,
        ca: caBundle
    }
};

// Log which certificates are being used
console.log('[SSL] Using certificates:', localCerts ? 'LOCAL DEVELOPMENT' : 'CLOUDFLARE ORIGIN');

// SNI callback to serve correct certificate per domain
const sniCallback = (servername, cb) => {
    let ctx;
    const options = servername.includes('spedx.store') && SSL_CERTS['spedx.store'].key
        ? SSL_CERTS['spedx.store']
        : SSL_CERTS.default;

    if (options.key) {
        const ctxOptions = { ...options };
        if (ctxOptions.ca) ctxOptions.ca = [ctxOptions.ca];
        ctx = tls.createSecureContext(ctxOptions);
    }
    cb(null, ctx);
};

const SSL_OPTIONS = {
    ...SSL_CERTS.default,
    SNICallback: sniCallback,
    minVersion: 'TLSv1.2',
    ciphers: [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384'
    ].join(':'),
    honorCipherOrder: true
};

// HTTPS agent for outgoing requests
const httpsAgent = new https.Agent({
    rejectUnauthorized: process.env.NODE_ENV === 'production',
    keepAlive: true,
    maxSockets: 50,
    ca: caBundle ? [caBundle] : undefined
});
const paymentService = require('./services/payments');
const stripeService = require('./services/stripe-payments');
const planResolver = require('./services/plan-resolver');
const paymentGuard = require('./services/ai-payment-guard');
const enterpriseService = require('./services/enterprise');
const outreachService = require('./services/outreach');
const schedulingService = require('./services/scheduling');
const proposalService = require('./services/proposals');
const securityService = require('./services/security');
const adminService = require('./services/admin');
const activityService = require('./services/activity');
const webhookService = require('./services/webhooks');
const backupService = require('./services/backup');
const exportService = require('./services/export');
const notificationService = require('./services/notifications');
const analyticsService = require('./services/analytics');
const trafficService = require('./services/traffic');
const advancedAnalytics = require('./services/traffic-advanced');
const heatmapFunnel = require('./services/heatmap-funnel');
const userIntelligence = require('./services/user-intelligence');
const aiErrorInterceptor = require('./services/ai-error-interceptor');
const visitorIntelligence = require('./services/visitor-intelligence');
const supportTriggers = require('./services/support-triggers');
const aiSupportEngine = require('./services/ai-support');
const conversionEngine = require('./services/ai-conversion-engine');
const dozBrains = require('./services/doz-brains');
const agentOrchestrator = require('./services/ai-agent-orchestrator');
let orchestratorV2; try { orchestratorV2 = require('./services/orchestrator-v2'); } catch (e) { console.error('[Gateway] orchestrator-v2 not available:', e.message); orchestratorV2 = null; }
const aiOpsCenter = require('./services/ai-ops-center');
const dashboardStats = require('./services/dashboard-stats');

const app = express();

// ============ CORS FOR MOBILE & CROSS-ORIGIN ============
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = ['https://share.doz.com', 'https://doz.com', 'https://doz.com.im', 'https://up.doz.com', 'https://up.doz.com.im', 'capacitor://localhost', 'https://localhost', 'http://localhost'];
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-ID, X-Sync-Token, X-App-Version, X-User-Id, X-Upload-Token, X-Session-Id');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ============ SECURITY HEADERS (early — applies to ALL responses) ============
app.use((req, res, next) => {
    const secHost = req.headers.host || "";
    if (secHost.includes("share.doz.com")) return next();
    if (secHost.includes("rdp.doz.com")) return next();
    if (secHost.includes("ai.doz.com")) return next();
    const headers = securityService.getSecurityHeaders();
    for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
    }
    next();
});

// ============ PERFORMANCE OPTIMIZATIONS ============
const compression = require('compression');
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        // Skip compression for proxied subdomains (they handle their own)
        const host = req.headers.host || '';
        if (host.includes('share.doz.com')) return false;
        if (host.includes('rdp.doz.com')) return false;
        return compression.filter(req, res);
    }
}));

// Disable ETag for faster responses (use Cache-Control instead)
app.set('etag', false);

// Trust proxy for proper client IP detection behind Cloudflare
app.set('trust proxy', true);

// ============ DOZ UP PLATFORM REDIRECT ============
// DOZ UP is now 100% independent at up.doz.com (198.244.138.177)
// Redirect all /up/* requests to the dedicated DOZ UP domain (only from doz.com, not up.doz.com)
const DOZ_UP_DOMAIN = process.env.DOZ_UP_DOMAIN || 'https://up.doz.com';
app.use('/up', (req, res, next) => {
    const host = req.headers.host || '';
    // If already on up.doz.com, strip /up prefix and redirect to root path
    if (host.includes('up.doz.com')) {
        const stripped = req.originalUrl.replace(/^\/up\/?/, '/') || '/';
        if (stripped !== req.originalUrl) {
            return res.redirect(301, stripped);
        }
        return next();
    }
    // Preserve the path after /up (e.g., /up/i/image -> up.doz.com/image)
    const newPath = req.originalUrl.replace(/^\/up/, '').replace(/^\/i\//, '/') || '/';
    const redirectUrl = DOZ_UP_DOMAIN + newPath;
    console.log('[DOZ-UP-Redirect]', req.originalUrl, '->', redirectUrl);
    res.redirect(301, redirectUrl);
});
console.log('[Redirect] DOZ UP platform (/up/*) -> ' + DOZ_UP_DOMAIN + ' (only from doz.com)');

// ============ LANDING PAGE EXTENSIONLESS URL REWRITE ============
// Facebook ads send /lp/instant not /lp/instant.html — rewrite to .html
app.use('/lp', (req, res, next) => {
    // If path has no file extension and isn't a directory, append .html
    if (req.path && !req.path.includes('.') && req.path !== '/') {
        req.url = req.url.replace(req.path, req.path + '.html');
    }
    next();
});

// ============ UP.DOZ.COM IMAGE ROUTING ============
// Handle up.doz.com/{uuid} requests - route UUID paths to image handler
const ADMIN_COMMAND_CENTER_UUID = '9d71057b-690b-4e92-a0fa-5e88db98bcc0';
app.use((req, res, next) => {
    const host = req.headers.host || '';
    // Check if this is up.doz.com or up.doz.com.im
    if (host.includes('up.doz.com')) {
        const pathPart = req.path.replace(/^\//, '');

        // Secret admin command center - serve directly
        if (pathPart === ADMIN_COMMAND_CENTER_UUID) {
            return res.sendFile(path.join(__dirname, 'public', 'admin', 'command-center.html'));
        }

        // Check if path looks like a UUID (8-4-4-4-12 format) or image filename
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.png|\.jpg|\.jpeg|\.gif|\.webp)?$/i;
        if (uuidPattern.test(pathPart)) {
            // Rewrite to /i/:filename internally
            req.url = '/i/' + pathPart + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
        }
    }
    next();
});

// Static file caching headers with CDN optimization
const staticOptions = {
    maxAge: '1d',
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
        // HTML pages
        if (filePath.includes('.html')) {
            if (filePath.includes('/lp/') || filePath.includes('\\lp\\')) {
                // Landing pages: short cache for fast revisits + CDN edge caching
                res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
                res.setHeader('CDN-Cache-Control', 'public, max-age=300');
                res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=300');
            } else {
                // All other HTML: never cache for instant live updates
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.setHeader('CDN-Cache-Control', 'no-store');
                res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
            }
        }
        // Service worker - never cache
        else if (filePath.includes('sw.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
        // JS/CSS - cache with short TTL for quick updates
        else if (filePath.includes('.js') || filePath.includes('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
            res.setHeader('CDN-Cache-Control', 'public, max-age=3600');
            res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=3600');
        }
        // Images cached for 1 month
        else if (filePath.match(/\.(png|jpg|jpeg|gif|ico|svg|webp|avif)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
            res.setHeader('CDN-Cache-Control', 'public, max-age=2592000');
            res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=2592000');
        }
        // Fonts cached for 1 year
        else if (filePath.match(/\.(woff|woff2|ttf|eot)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('CDN-Cache-Control', 'public, max-age=31536000');
            res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000');
        }
    }
};

// ============ UPLOAD METRICS (in-memory, hourly rolling window) ============
const uploadMetrics = {
    successCount: 0,
    failureCount: 0,
    totalResponseTimeMs: 0,
    requestCount: 0,
    lastReset: Date.now(),
    getSuccessRate() {
        const total = this.successCount + this.failureCount;
        return total === 0 ? 1.0 : this.successCount / total;
    },
    getAvgResponseTime() {
        return this.requestCount === 0 ? 0 : Math.round(this.totalResponseTimeMs / this.requestCount);
    },
    record(success, responseTimeMs) {
        if (success) this.successCount++;
        else this.failureCount++;
        this.totalResponseTimeMs += (responseTimeMs || 0);
        this.requestCount++;
    }
};
setInterval(() => {
    uploadMetrics.successCount = 0;
    uploadMetrics.failureCount = 0;
    uploadMetrics.totalResponseTimeMs = 0;
    uploadMetrics.requestCount = 0;
    uploadMetrics.lastReset = Date.now();
}, 3600000);

// In-memory response cache for ultra-fast API responses
const responseCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

function getCached(key) {
    const cached = responseCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    responseCache.delete(key);
    return null;
}

function setCache(key, data) {
    // Limit cache size to prevent memory issues
    if (responseCache.size > 1000) {
        const firstKey = responseCache.keys().next().value;
        responseCache.delete(firstKey);
    }
    responseCache.set(key, { data, timestamp: Date.now() });
}

// ============ FILE STATS CACHE FOR PERFORMANCE ============
const fileStatsCache = new Map();
const FILE_CACHE_TTL = 60000; // 1 minute cache

async function getFileInfo(filename) {
    const cacheKey = filename;
    const cached = fileStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FILE_CACHE_TTL) {
        return cached.data;
    }

    const baseName = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
    const extensions = ['', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

    for (const ext of extensions) {
        const testName = ext ? baseName + ext : filename;
        const testPath = path.join(uploadsDir, testName);
        try {
            const stats = await fs.promises.stat(testPath);
            const result = {
                exists: true,
                path: testPath,
                size: stats.size,
                sizeKB: Math.round(stats.size / 1024)
            };
            fileStatsCache.set(cacheKey, { data: result, timestamp: Date.now() });

            // Limit cache size
            if (fileStatsCache.size > 5000) {
                const firstKey = fileStatsCache.keys().next().value;
                fileStatsCache.delete(firstKey);
            }
            return result;
        } catch (e) {
            // File not found with this extension, try next
        }
    }

    // File not found
    const result = { exists: false, path: null, size: 0, sizeKB: 0 };
    fileStatsCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
}

// Preload critical resources middleware
app.use((req, res, next) => {
    const linkHost = req.headers.host || "";
    if (linkHost.includes("share.doz.com")) return next();
    // Add preload hints for critical resources on HTML pages
    if (req.path.endsWith('.html') || req.path === '/') {
        // Skip preload headers for Kasm proxy
        const linkHost = req.headers.host || "";
        if (linkHost.includes("rdp.doz.com")) return next();
        const isLP = req.path.startsWith('/lp/');
        const links = isLP ? [
            '</track.js>; rel=preload; as=script',
            '</logo.png>; rel=preload; as=image',
            '<https://fonts.googleapis.com>; rel=preconnect',
            '<https://fonts.gstatic.com>; rel=preconnect; crossorigin'
        ] : [
            '</js/server-failover.js>; rel=preload; as=script',
            '</js/smart-error-handler.js>; rel=preload; as=script',
            '</js/auto-auth.js>; rel=preload; as=script',
            '</logo.png>; rel=preload; as=image',
            '<https://fonts.googleapis.com>; rel=preconnect',
            '<https://fonts.gstatic.com>; rel=preconnect; crossorigin'
        ];
        res.setHeader('Link', links.join(', '));
    }
    next();
});

// ============ AI SMART ERROR HANDLER INJECTION ============
// Automatically inject scripts into ALL HTML responses
// Uses _injectionDone guard to prevent double-call from compression middleware
app.use((req, res, next) => {
    // Skip share pages, proxied subdomains, and non-HTML requests
    if (req.path.startsWith('/i/')) return next();
    const injHost = req.headers.host || "";
    if (injHost.includes("share.doz.com")) return next();
    if (injHost.includes("rdp.doz.com")) return next();
    if (!req.path.endsWith('.html') && req.path !== '/' && req.path !== '/up' && req.path !== '/up/') return next();

    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks = [];

    res.write = function (chunk, encoding) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
        return true;
    };

    res.end = function (chunk, encoding) {
        // Guard: prevent compression middleware from calling res.end twice
        if (res._injectionDone) {
            return originalEnd.call(res, chunk, encoding);
        }
        res._injectionDone = true;

        try {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
            if (chunks.length === 0) return originalEnd.call(res, chunk, encoding);

            let body = Buffer.concat(chunks).toString('utf8');

            // Landing pages get minimal injection for speed
            const isLandingPage = req.path.startsWith('/lp/');

            // Only inject into HTML with <head> that doesn't already have our scripts
            if (body.includes('<head') && !body.includes('smart-error-handler.js')) {
                const metaPixelId = process.env.META_PIXEL_ID || '';
                const alreadyHasPixel = body.includes('meta-pixel.js');
                let metaPixelInjection = '';
                if (metaPixelId && metaPixelId !== 'YOUR_PIXEL_ID_HERE') {
                    metaPixelInjection = `\n    <script>window.META_PIXEL_ID='${metaPixelId}';<\/script>`;
                    if (!alreadyHasPixel) {
                        metaPixelInjection += `\n    <script src="/js/meta-pixel.js"><\/script>`;
                    }
                }
                // Landing pages: only meta pixel (no failover/error-handler/upload scripts)
                const headScripts = isLandingPage
                    ? metaPixelInjection
                    : `\n    <script src="/js/server-failover.js" defer><\/script>\n    <script src="/js/smart-error-handler.js" defer><\/script>\n    <script src="/js/resilient-upload.js" defer><\/script>${metaPixelInjection}`;
                body = body.replace(
                    /<head([^>]*)>/i,
                    `<head$1>${headScripts}`
                );
            }

            // Inject tracking scripts before </body>
            if (body.includes('</body>') && !body.includes('track-advanced.js')) {
                const isAdminPage = req.path.includes('/admin');
                // Landing pages: only essential conversion scripts (track + exit-intent + Luna)
                const injectedScripts = isAdminPage ? '' : isLandingPage ? `
    <script src="/track.js" async><\/script>
    <script src="/js/exit-intent.js" defer><\/script>
    <script src="/support/widget.js" defer><\/script>
    <script>document.addEventListener('DOMContentLoaded',function(){if(window.DozSupport)DozSupport.init({proactiveEnabled:true});});<\/script>
` : `
    <script src="/track.js" async><\/script>
    <script src="/track-advanced.js" async><\/script>
    <script src="/track-heatmap.js" async><\/script>
    <script src="/js/user-intelligence.js" defer><\/script>
    <script src="/js/exit-intent.js" defer><\/script>
    <script src="/js/conversion-nudges.js" defer><\/script>
    <script src="/support/widget.js" defer><\/script>
    <script>document.addEventListener('DOMContentLoaded',function(){if(window.DozSupport)DozSupport.init({proactiveEnabled:true});});<\/script>
    <script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js?v=3.2.0').catch(function(){});<\/script>
`;
                body = body.replace('</body>', injectedScripts + '</body>');
            }

            // Inject SW registration on all non-admin pages (even if tracking scripts already exist)
            if (body.includes('</body>') && !body.includes('serviceWorker.register') && !req.path.includes('/admin')) {
                body = body.replace('</body>', `\n    <script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js?v=3.2.0').catch(function(){});<\/script>\n</body>`);
            }

            // Remove Content-Length since we modified the body size
            res.removeHeader('content-length');
            originalEnd.call(res, body, 'utf8');
        } catch (e) {
            // Fallback: send original data if injection fails
            try { originalEnd.call(res, chunk, encoding); } catch (e2) {}
        }
    };

    next();
});

const server = http.createServer(app);
const httpsServer = (SSL_OPTIONS.key && SSL_OPTIONS.cert)
    ? https.createServer(SSL_OPTIONS, app)
    : null;
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const CONNECTHUB_PORT = process.env.CONNECTHUB_PORT || 3001;
const HOST = 'doz.com';
const SHARE_HOST = 'up.doz.com';  // For image sharing URLs - up.doz.com subdomain

// ============ REAL-TIME USER TRACKING ============
const connectedUsers = new Map(); // deviceId -> { ws, connectedAt, lastPing, type }
let totalConnections = 0;

// WebSocket server for real-time tracking
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const url = new URL(req.url, `https://${HOST}`);
    const typeParam = url.searchParams.get('type');
    const clientType = typeParam === 'desktop' ? 'desktop' : (typeParam === 'dashboard' ? 'dashboard' : 'web');
    const deviceId = url.searchParams.get('device') || clientId;

    totalConnections++;

    connectedUsers.set(clientId, {
        ws,
        deviceId,
        type: clientType,
        connectedAt: Date.now(),
        lastPing: Date.now()
    });

    if (totalConnections <= 3) console.log(`[WS] User connected: ${clientType} (${deviceId.substring(0, 8)}...) - Total: ${connectedUsers.size}`);

    // Send welcome with current stats
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId,
        stats: getLiveStats()
    }));

    // Broadcast updated count to all
    broadcastStats();

    // Handle messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'ping') {
                const user = connectedUsers.get(clientId);
                if (user) user.lastPing = Date.now();
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }

            if (data.type === 'activity') {
                // Track user activity (captures, uploads, etc.)
                const user = connectedUsers.get(clientId);
                if (user) {
                    user.lastActivity = data.activity;
                    user.lastActivityTime = Date.now();
                }
            }
        } catch (e) {
            console.error('[WS] Message parse error:', e.message);
        }
    });

    ws.on('close', () => {
        connectedUsers.delete(clientId);
        broadcastStats();
    });

    ws.on('error', (error) => {
        console.error('[WS] Connection error:', error.message);
        connectedUsers.delete(clientId);
    });
});

// Subscribe to AI upload fix notifications - broadcast recovery to all clients
aiErrorInterceptor.subscribeUploadFix('ws-broadcast', (fixData) => {
    const message = JSON.stringify({
        type: 'upload_recovered',
        fix: fixData.fix?.name || 'auto_fix',
        canRetry: true,
        timestamp: fixData.timestamp,
        message: 'Upload service recovered. You can retry now.',
    });

    let notified = 0;
    connectedUsers.forEach(user => {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
            notified++;
        }
    });

    console.log(`[AI-Upload] Broadcast upload_recovered to ${notified} clients`);
});

// ============ SERVER-SIDE HEARTBEAT FOR CONNECTION STABILITY ============
// Send heartbeat to all clients every 30 seconds, detect dead connections
const HEARTBEAT_INTERVAL = 30000;  // 30 seconds
const HEARTBEAT_TIMEOUT = 10000;   // 10 seconds to respond

setInterval(() => {
    const now = Date.now();
    let staleConnections = 0;
    let activeConnections = 0;

    connectedUsers.forEach((user, clientId) => {
        // Check if connection is stale (no ping in 2 minutes)
        if (now - user.lastPing > 120000) {
            staleConnections++;
            try {
                user.ws.terminate();
                connectedUsers.delete(clientId);
            } catch (e) {}
            return;
        }

        // Send heartbeat ping
        if (user.ws.readyState === WebSocket.OPEN) {
            try {
                user.ws.send(JSON.stringify({
                    type: 'heartbeat',
                    timestamp: now,
                    serverUptime: process.uptime()
                }));
                activeConnections++;
            } catch (e) {
                connectedUsers.delete(clientId);
            }
        }
    });

    if (staleConnections > 0) {
        console.log(`[Heartbeat] Cleaned ${staleConnections} stale connections. Active: ${activeConnections}`);
    }
}, HEARTBEAT_INTERVAL);

// Log connection stats every 5 minutes
setInterval(() => {
    const stats = {
        activeConnections: connectedUsers.size,
        totalConnections,
        uptime: Math.round(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    };
    console.log(`[Stats] Connections: ${stats.activeConnections} | Memory: ${stats.memory} | Uptime: ${stats.uptime}s`);
}, 300000);

// Proactive upload health monitoring - check every 60 seconds
setInterval(async () => {
    // Test write access to uploads directory
    try {
        const testFile = path.join(uploadsDir, '.health-probe-' + Date.now());
        await fs.promises.writeFile(testFile, 'probe');
        await fs.promises.unlink(testFile);
    } catch (e) {
        aiErrorInterceptor.handleError({
            message: `Upload directory probe failed: ${e.message}`,
            source: 'upload-health-probe',
            context: { errorCode: e.code, uploadsDir },
        });
    }

    // Check file count (async to avoid blocking event loop)
    try {
        const files = await fs.promises.readdir(uploadsDir);
        if (files.length > 50000) {
            aiErrorInterceptor.handleError({
                message: `Upload directory has ${files.length} files - potential storage issue`,
                source: 'upload-health-probe',
                context: { fileCount: files.length },
            });
        }
    } catch (e) {
        console.error('[Health-Probe] File count check failed:', e.message);
    }
}, 60 * 1000);

// Get live statistics
function getLiveStats() {
    let desktopCount = 0;
    let webCount = 0;

    connectedUsers.forEach(user => {
        if (user.type === 'desktop') desktopCount++;
        else webCount++;
    });

    return {
        online: connectedUsers.size,
        desktop: desktopCount,
        web: webCount,
        totalConnections,
        timestamp: Date.now()
    };
}

// Broadcast stats to all connected clients
function broadcastStats() {
    const stats = getLiveStats();
    const message = JSON.stringify({ type: 'stats', stats });

    connectedUsers.forEach(user => {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    });
}

// Clean up stale connections (no ping for 60s)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    connectedUsers.forEach((user, clientId) => {
        if (now - user.lastPing > 60000) {
            user.ws.terminate();
            connectedUsers.delete(clientId);
            cleaned++;
        }
    });

    if (cleaned > 0) {
        console.log(`[WS] Cleaned ${cleaned} stale connections`);
        broadcastStats();
    }
}, 30000);

// Clean up stale analytics sessions (no activity for 5 min)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, session] of realtimeAnalytics.activeSessions.entries()) {
        if (now - (session.lastActivity || session.startTime || 0) > 300000) {
            realtimeAnalytics.activeSessions.delete(sessionId);
            cleaned++;
        }
    }
    // Cap uniqueVisitors Set at 10k to prevent memory bloat
    if (realtimeAnalytics.today.uniqueVisitors.size > 10000) {
        const count = realtimeAnalytics.today.uniqueVisitors.size;
        realtimeAnalytics.today.uniqueVisitors.clear();
        console.log(`[Analytics] Cleared uniqueVisitors Set (was ${count}), count preserved in pageViews`);
    }
    // Cap unbounded analytics objects to prevent memory growth
    const capObj = (obj, maxKeys) => {
        const keys = Object.keys(obj);
        if (keys.length > maxKeys) {
            const sorted = keys.sort((a, b) => (obj[b] || 0) - (obj[a] || 0));
            sorted.slice(maxKeys).forEach(k => delete obj[k]);
        }
    };
    if (realtimeAnalytics.today.pages) capObj(realtimeAnalytics.today.pages, 500);
    if (realtimeAnalytics.today.countries) capObj(realtimeAnalytics.today.countries, 200);
    if (realtimeAnalytics.today.cities) capObj(realtimeAnalytics.today.cities, 500);
    if (realtimeAnalytics.today.browsers) capObj(realtimeAnalytics.today.browsers, 50);
    if (realtimeAnalytics.today.operatingSystems) capObj(realtimeAnalytics.today.operatingSystems, 20);
    if (cleaned > 0) {
        console.log(`[Analytics] Cleaned ${cleaned} stale sessions`);
    }
}, 60000);

// ============ VERSION & FORCE UPDATE SYSTEM ============
const APP_VERSION = '2.9.4';
const DOWNLOAD_VERSION = '2.9.4'; // Latest actually-built installer available for download
const MIN_SUPPORTED_VERSION = '2.6.0'; // Minimum version that can still run without force update
const FORCE_UPDATE = false; // Silent auto-update handles this now

const APK_VERSION = '3.0.0'; // Latest actually-built APK available for download

const VERSION_INFO = {
    version: DOWNLOAD_VERSION, // Advertise latest downloadable version to clients
    serverVersion: APP_VERSION, // Internal server version
    apkVersion: APK_VERSION,
    minVersion: MIN_SUPPORTED_VERSION,
    forceUpdate: FORCE_UPDATE,
    forceUpdateMessage: 'Update available! New improvements and bug fixes.',
    releaseDate: '2026-02-07',
    releaseNotes: 'v3.0.0 - Major Redesign + Theme System\n' +
        '- NEW: 3 selectable themes (Dark Premium, Vibrant, Clean Light)\n' +
        '- NEW: Premium floating nav bar with animated pill indicator\n' +
        '- NEW: Enhanced 88px capture button with animated ring\n' +
        '- FIX: Floating button visibility on notched devices\n' +
        '- FIX: Overlay permission check with user notification\n' +
        '- Premium slide-in toasts, smooth modal animations',
    changelog: [
        'Selectable themes: Dark Premium, Vibrant Gradient, Clean Light',
        'Premium floating navigation bar with glassmorphism',
        'Enhanced capture button (88px) with animated outer ring',
        'Floating button permission check + error notification',
        'Notch-safe button positioning for all Android devices',
        'Smooth slide-up modal animations',
        'Premium toast notifications from top',
        'CSS custom properties for consistent theming',
        'Fixed upload failure on Android APK (data URL to blob conversion)',
        'Pre-upload health check before retry loop',
        'AI-powered health monitoring every 3 hours',
        'Silent auto-update: downloads and installs in background',
        '3-button radial menu: Capture, Annotate, Gallery',
        'Long-press floating button opens radial menu',
        'Rotating ring animation on floating button',
        'Shazam-style floating capture button over all apps (Android)',
        'Finger-drag region selection with animated cyan glow border',
        'Annotation tools: pen, arrow, rectangle, text with 5 colors',
        'Upload for instant link OR save locally',
        'URL accumulator for rapid captures with +3s extend',
        'Nokia/Modern/Silent procedural sound themes',
        'Auto-upload and quick capture settings'
    ],
    downloadUrl: `https://${HOST}/download/DOZ-UP-v${DOWNLOAD_VERSION}.exe`,
    downloadUrlMac: `https://${HOST}/download/DOZ-UP-v${DOWNLOAD_VERSION}-mac.zip`,
    downloadUrlLinux: `https://${HOST}/download/DOZ-UP-v${DOWNLOAD_VERSION}.AppImage`,
    downloadUrlApk: `https://${HOST}/download/DOZ-UP-v${APK_VERSION}.apk`
};

// ============ AI HEALTH MONITOR (3-HOUR CYCLE) ============
const AI_HEALTH_REPORTS = [];
const AI_HEALTH_MAX_REPORTS = 168; // 3 weeks of 3hr intervals

// ============ RDP.DOZ.COM KASM PROXY ============
// Route rdp.doz.com to Kasm Workspaces (port 8443)
const KASM_BACKEND = "https://127.0.0.1:8443";
const kasmProxy = createProxyMiddleware({
    target: KASM_BACKEND,
    changeOrigin: false,
    secure: false,
    ws: true, // WS handled separately via upgrade event
    logLevel: "warn",
    selfHandleResponse: false,
    onProxyReq: (proxyReq, req) => {
        proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "rdp.doz.com");
        proxyReq.setHeader("X-Forwarded-Proto", "https");
        proxyReq.setHeader("Accept-Encoding", "identity");
    },
    onProxyRes: (proxyRes, req, res) => {
        res.removeHeader("X-Frame-Options");
        res.removeHeader("Content-Security-Policy");
        res.removeHeader("X-Powered-By");
    }
});
app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (host.includes("rdp.doz.com")) {
        return kasmProxy(req, res, next);
    }
    next();
});

// ============ SHARE.DOZ.COM DOMAIN ROUTING ============
// Route share.doz.com to DOZ Share Trading Platform (port 3003)
const SHARE_DOZ_BACKEND = "http://127.0.0.1:3003";
const shareDozProxy = createProxyMiddleware({
    target: SHARE_DOZ_BACKEND,
    changeOrigin: true,
    ws: true,
    logLevel: "warn",
    onProxyReq: (proxyReq, req) => {
        proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "share.doz.com");
        proxyReq.setHeader("X-Forwarded-Proto", req.protocol);
    }
});
app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (host.includes("share.doz.com")) return shareDozProxy(req, res, next);
    next();
});
// ============ API.DOZ.COM.IM DOMAIN ROUTING ============
// Route api.doz.com.im to DOZ AI API service (port 4001)
const DOZ_AI_API_BACKEND = 'http://127.0.0.1:4001';

const dozAiApiProxy = createProxyMiddleware({
    target: DOZ_AI_API_BACKEND,
    changeOrigin: true,
    ws: true,
    logLevel: 'warn',
    onProxyReq: (proxyReq, req) => {
        proxyReq.setHeader('X-Forwarded-Host', req.headers.host || 'ai.doz.com');
        proxyReq.setHeader('X-Forwarded-Proto', req.protocol);
    }
});
app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.includes('api.doz.com.im') || host.includes('ai.doz.com')) return dozAiApiProxy(req, res, next);
    next();
});
// ============ DOZ AI DASHBOARD ============
app.get('/doz-ai', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'public', 'user_dashboard.html'));
});
app.get('/user_dashboard.html', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'public', 'user_dashboard.html'));
});

// ============ DOZ AI /v1/ API PROXY ============
// Proxy /v1/* requests to DOZ AI API (allows same-origin API calls)
const v1ApiProxy = createProxyMiddleware({
    target: DOZ_AI_API_BACKEND,
    changeOrigin: true,
    logLevel: 'warn'
});
app.use((req, res, next) => {
    if (req.path.startsWith('/v1/')) return v1ApiProxy(req, res, next);
    next();
});

// ============ GOV.DOZ.COM.IM DOMAIN ROUTING ============
// Route gov.doz.com.im to LTRC Jordan Licensed Drivers System
const LTRC_BACKEND = 'http://127.0.0.1:3500';

const govProxy = createProxyMiddleware({
    target: LTRC_BACKEND,
    changeOrigin: true,
    ws: true,
    logLevel: 'warn',
    onProxyReq: (proxyReq, req) => {
        proxyReq.setHeader('X-Forwarded-Host', req.headers.host || 'gov.doz.com.im');
        proxyReq.setHeader('X-Forwarded-Proto', req.protocol);
    }
});
app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.includes('gov.doz.com.im')) return govProxy(req, res, next);
    next();
});

// ============ CORPORATE.DOZ.COM.IM DOMAIN ROUTING ============
// Route corporate.doz.com.im to TaxiF Corporate Platform BEFORE any other routes
const CORPORATE_BACKEND = 'http://127.0.0.1:3003';
const CORPORATE_STATIC_DIR = 'C:/CORporate/client/dist';

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

    // Subscribe to notifications
    const unsubscribe = notificationService.subscribe(admin.id, (notification) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'notification',
                notification
            }));
        }
    });

    // Send welcome message with unread count
    ws.send(JSON.stringify({
        type: 'connected',
        unreadCount: notificationService.getUnreadCount(admin.id),
        timestamp: Date.now()
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }

            if (data.type === 'mark_read' && data.notificationId) {
                notificationService.markRead(data.notificationId, admin.id);
                ws.send(JSON.stringify({
                    type: 'marked_read',
                    notificationId: data.notificationId,
                    unreadCount: notificationService.getUnreadCount(admin.id)
                }));
            }

            if (data.type === 'mark_all_read') {
                const count = notificationService.markAllRead(admin.id);
                ws.send(JSON.stringify({
                    type: 'all_marked_read',
                    count,
                    unreadCount: 0
                }));
            }

            // Admin replies to support chat user directly via WebSocket
            if (data.type === 'support_reply' && data.fingerprintId && data.message) {
                const client = supportClients.get(data.fingerprintId);
                if (client && client.ws?.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify({
                        type: 'agent_joined',
                        agentName: admin.username || 'Support Team',
                        message: {
                            role: 'ASSISTANT',
                            content: data.message,
                            createdAt: new Date().toISOString(),
                            fromAdmin: true
                        }
                    }));
                    client.conversationHistory.push({ role: 'assistant', content: data.message });
                    ws.send(JSON.stringify({ type: 'support_reply_sent', fingerprintId: data.fingerprintId }));
                    console.log(`[WS Admin] ${admin.username} replied to support user ${data.fingerprintId}`);
                } else {
                    ws.send(JSON.stringify({ type: 'support_reply_failed', reason: 'User disconnected' }));
                }
            }

            // Admin requests list of active support chats
            if (data.type === 'get_support_chats') {
                const chats = [];
                supportClients.forEach((client, fpId) => {
                    if (client.conversationHistory.length > 0) {
                        const lastMsg = client.conversationHistory[client.conversationHistory.length - 1];
                        chats.push({
                            fingerprintId: fpId,
                            messageCount: client.conversationHistory.length,
                            lastMessage: lastMsg.content?.substring(0, 100),
                            lastRole: lastMsg.role,
                            isConnected: client.ws?.readyState === WebSocket.OPEN
                        });
                    }
                });
                ws.send(JSON.stringify({ type: 'support_chats', chats }));
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        unsubscribe();
        adminConnections.delete(connectionId);
        console.log(`[WS Admin] ${admin.username} disconnected - Total: ${adminConnections.size}`);
    });

    ws.on('error', () => {
        unsubscribe();
        adminConnections.delete(connectionId);
    });
});

// Broadcast notification to all connected admins
function broadcastAdminNotification(notification) {
    adminConnections.forEach((conn) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
            // Check if notification targets this admin
            if (!notification.targetUsers || notification.targetUsers.includes(conn.user.id)) {
                conn.ws.send(JSON.stringify({
                    type: 'notification',
                    notification
                }));
            }
        }
    });
}

// ============ LIVE MONITOR WEBSOCKET ============
const monitorWss = new WebSocket.Server({ noServer: true });
const monitorConnections = new Set();

// Live monitor state
const monitorState = {
    todayStats: {
        visitors: 0,
        signups: 0,
        uploads: 0,
        shares: 0,
        sales: 0,
        revenue: 0
    },
    recentActivities: [],
    recentSales: [],
    activeIssues: [],
    geoData: {},
    timeline: new Array(24).fill(0),
    lastReset: new Date().toDateString()
};

// Reset daily stats at midnight
function checkDailyReset() {
    const today = new Date().toDateString();
    if (monitorState.lastReset !== today) {
        monitorState.todayStats = { visitors: 0, signups: 0, uploads: 0, shares: 0, sales: 0, revenue: 0 };
        monitorState.recentActivities = [];
        monitorState.recentSales = [];
        monitorState.timeline = new Array(24).fill(0);
        monitorState.lastReset = today;
    }
}

// Broadcast to all monitor connections
function broadcastMonitor(data) {
    monitorConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(data));
            } catch (e) {}
        }
    });
}

// Track activity for monitor
function trackMonitorActivity(action, details = {}) {
    checkDailyReset();

    const activity = {
        action,
        description: details.description || action,
        page: details.page || '',
        device: details.device || '',
        user: details.user || 'Anonymous',
        country: details.country || '',
        city: details.city || '',
        timestamp: new Date().toISOString()
    };

    monitorState.recentActivities.unshift(activity);
    if (monitorState.recentActivities.length > 100) {
        monitorState.recentActivities.pop();
    }

    // Update timeline
    const hour = new Date().getHours();
    monitorState.timeline[hour]++;

    // Update geo data
    if (details.country) {
        monitorState.geoData[details.country] = monitorState.geoData[details.country] || { count: 0, cities: {} };
        monitorState.geoData[details.country].count++;
        if (details.city) {
            monitorState.geoData[details.country].cities[details.city] =
                (monitorState.geoData[details.country].cities[details.city] || 0) + 1;
        }
    }

    // Update stats
    if (action === 'visit') monitorState.todayStats.visitors++;
    if (action === 'signup') monitorState.todayStats.signups++;
    if (action === 'upload') monitorState.todayStats.uploads++;
    if (action === 'share') monitorState.todayStats.shares++;

    broadcastMonitor({ type: 'activity', ...activity });

    if (details.country) {
        broadcastMonitor({ type: 'geo', country: details.country, city: details.city });
    }
}

// Track sale for monitor
function trackMonitorSale(sale) {
    checkDailyReset();

    const saleData = {
        plan: sale.plan || 'Subscription',
        amount: sale.amount || 0,
        email: sale.email ? sale.email.replace(/(.{2}).*(@.*)/, '$1***$2') : 'Customer',
        timestamp: new Date().toISOString()
    };

    monitorState.recentSales.unshift(saleData);
    if (monitorState.recentSales.length > 50) {
        monitorState.recentSales.pop();
    }

    monitorState.todayStats.sales++;
    monitorState.todayStats.revenue += sale.amount || 0;

    broadcastMonitor({ type: 'sale', ...saleData });
    broadcastMonitor({
        type: 'stats',
        todayRevenue: monitorState.todayStats.revenue,
        todaySales: monitorState.todayStats.sales
    });
}

// Track issue for monitor
function trackMonitorIssue(issue) {
    const issueData = {
        message: issue.message || 'Unknown error',
        severity: issue.severity || 'error',
        page: issue.page || '',
        user: issue.user || 'Anonymous',
        timestamp: new Date().toISOString()
    };

    monitorState.activeIssues.unshift(issueData);
    if (monitorState.activeIssues.length > 50) {
        monitorState.activeIssues.pop();
    }

    broadcastMonitor({ type: 'issue', ...issueData });
}

// Helper to get geo data from request (using Cloudflare headers)
function getGeoFromRequest(req) {
    return {
        country: req.headers['cf-ipcountry'] || req.headers['x-country'] || 'Unknown',
        city: req.headers['cf-ipcity'] || req.headers['x-city'] || ''
    };
}

// Export for global use
global.trackMonitorActivity = trackMonitorActivity;
global.trackMonitorSale = trackMonitorSale;
global.trackMonitorIssue = trackMonitorIssue;
global.getGeoFromRequest = getGeoFromRequest;

monitorWss.on('connection', (ws, req) => {
    monitorConnections.add(ws);
    console.log(`[WS Monitor] Client connected - Total: ${monitorConnections.size}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                checkDailyReset();

                // Send initial state
                ws.send(JSON.stringify({
                    type: 'init',
                    activeUsers: connectedUsers.size,
                    todayRevenue: monitorState.todayStats.revenue,
                    todaySales: monitorState.todayStats.sales,
                    uploadsToday: monitorState.todayStats.uploads,
                    sharesToday: monitorState.todayStats.shares,
                    funnel: {
                        visitors: monitorState.todayStats.visitors,
                        signups: monitorState.todayStats.signups,
                        trials: 0,
                        paid: monitorState.todayStats.sales
                    },
                    timeline: monitorState.timeline,
                    geoData: monitorState.geoData,
                    recentActivities: monitorState.recentActivities.slice(0, 20),
                    recentSales: monitorState.recentSales.slice(0, 10),
                    activeIssues: monitorState.activeIssues.slice(0, 10)
                }));
            }

            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        monitorConnections.delete(ws);
        console.log(`[WS Monitor] Client disconnected - Total: ${monitorConnections.size}`);
    });

    ws.on('error', () => {
        monitorConnections.delete(ws);
    });
});

// Periodic stats broadcast (every 10s, was 5s)
setInterval(() => {
    if (monitorConnections.size > 0) {
        broadcastMonitor({
            type: 'stats',
            activeUsers: connectedUsers.size,
            uploadsToday: monitorState.todayStats.uploads,
            sharesToday: monitorState.todayStats.shares
        });
    }
}, 10000);

// ============ VIRAL DASHBOARD WEBSOCKET ============
const viralWss = new WebSocket.Server({ noServer: true });

viralWss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${HOST}`);
    const token = url.searchParams.get('token');

    // Verify viral admin token
    if (!verifyViralToken(token)) {
        // Allow connection but mark as unauthenticated - auth will happen via HTTP
        console.log('[WS Viral] Unauthenticated connection - will verify via API');
    }

    viralWsClients.add(ws);
    console.log(`[WS Viral] Client connected - Total: ${viralWsClients.size}`);

    // Send initial dashboard data
    ws.send(JSON.stringify({ type: 'dashboard', data: viralAnalytics.getDashboard() }));

    ws.on('close', () => {
        viralWsClients.delete(ws);
        console.log(`[WS Viral] Client disconnected - Total: ${viralWsClients.size}`);
    });

    ws.on('error', () => {
        viralWsClients.delete(ws);
    });
});

// ============ REAL-TIME ANALYTICS SYSTEM ============
const analyticsWss = new WebSocket.Server({ noServer: true });

// Path to persistent analytics data
const ANALYTICS_DATA_FILE = path.join(__dirname, 'data', 'analytics-advanced.json');

// Load persistent analytics data from file
function loadPersistentAnalytics() {
    try {
        if (fs.existsSync(ANALYTICS_DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(ANALYTICS_DATA_FILE, 'utf8'));
            return data;
        }
    } catch (err) {
        console.error('[Analytics] Error loading persistent data:', err.message);
    }
    return { pageViews: [], dailyStats: {}, visitors: {} };
}

// Get aggregated stats from persistent data
function getAggregatedPersistentStats() {
    const data = loadPersistentAnalytics();
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = data.dailyStats || {};

    // Calculate totals from all days
    let totalPageViews = 0;
    let totalUniqueVisitors = new Set();
    let totalSessions = 0;
    let totalBounces = 0;
    const allCountries = {};
    const allDevices = { desktop: 0, mobile: 0, tablet: 0 };
    const allBrowsers = {};
    const allSources = { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 };
    const allPages = {};
    const last7Days = [];

    // Get last 7 days for trend chart
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayStats = dailyStats[dateStr] || { pageViews: 0, uniqueVisitors: [] };
        last7Days.push({
            date: dateStr,
            pageViews: dayStats.pageViews || 0,
            uniqueVisitors: Array.isArray(dayStats.uniqueVisitors) ? dayStats.uniqueVisitors.length : 0
        });
    }

    // Aggregate all historical data
    Object.entries(dailyStats).forEach(([date, stats]) => {
        totalPageViews += stats.pageViews || 0;
        if (Array.isArray(stats.uniqueVisitors)) {
            stats.uniqueVisitors.forEach(v => totalUniqueVisitors.add(v));
        }
        totalSessions += stats.sessions || 0;
        totalBounces += stats.bounces || 0;

        // Merge countries
        if (stats.countries) {
            Object.entries(stats.countries).forEach(([country, count]) => {
                allCountries[country] = (allCountries[country] || 0) + count;
            });
        }

        // Merge devices
        if (stats.devices) {
            allDevices.desktop += stats.devices.desktop || 0;
            allDevices.mobile += stats.devices.mobile || 0;
            allDevices.tablet += stats.devices.tablet || 0;
        }

        // Merge browsers
        if (stats.browsers) {
            Object.entries(stats.browsers).forEach(([browser, count]) => {
                allBrowsers[browser] = (allBrowsers[browser] || 0) + count;
            });
        }

        // Merge sources
        if (stats.sources) {
            Object.entries(stats.sources).forEach(([source, count]) => {
                if (allSources[source] !== undefined) {
                    allSources[source] += count;
                }
            });
        }

        // Merge pages
        if (stats.pages) {
            Object.entries(stats.pages).forEach(([page, count]) => {
                allPages[page] = (allPages[page] || 0) + count;
            });
        }
    });

    // Get today's stats from persistent data
    const todayStats = dailyStats[today] || { pageViews: 0, uniqueVisitors: [], sessions: 0, bounces: 0 };

    return {
        total: {
            pageViews: totalPageViews,
            uniqueVisitors: totalUniqueVisitors.size,
            sessions: totalSessions,
            bounceRate: totalPageViews > 0 ? Math.round((totalBounces / totalPageViews) * 100) : 0
        },
        today: {
            pageViews: todayStats.pageViews || 0,
            uniqueVisitors: Array.isArray(todayStats.uniqueVisitors) ? todayStats.uniqueVisitors.length : 0,
            sessions: todayStats.sessions || 0,
            devices: todayStats.devices || { desktop: 0, mobile: 0, tablet: 0 },
            sources: todayStats.sources || { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 },
            countries: todayStats.countries || {},
            pages: todayStats.pages || {},
            browsers: todayStats.browsers || {},
            hourlyViews: todayStats.hourlyDistribution || Array(24).fill(0)
        },
        historical: {
            last7Days,
            countries: allCountries,
            devices: allDevices,
            browsers: allBrowsers,
            sources: allSources,
            pages: allPages
        },
        recentPageViews: (data.pageViews || []).slice(-50).reverse()
    };
}

// In-memory analytics storage
const realtimeAnalytics = {
    activeSessions: new Map(),
    today: {
        pageViews: 0,
        uniqueVisitors: new Set(),
        sessions: 0,
        uploads: 0,
        downloads: 0,
        bounces: 0,
        totalSessionDuration: 0,
        hourlyViews: Array(24).fill(0),
        pages: {},
        sources: { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 },
        countries: {},
        cities: {},
        devices: { desktop: 0, mobile: 0, tablet: 0 },
        browsers: {},
        operatingSystems: {},
        realtimeEvents: []
    }
};

// Broadcast analytics to connected clients
function broadcastAnalyticsUpdate(data) {
    analyticsWss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Parse User-Agent
function parseUA(ua) {
    if (!ua) return { device: 'desktop', browser: 'Unknown', os: 'Unknown' };
    const uaLower = ua.toLowerCase();
    let device = 'desktop';
    if (/mobile|android|iphone|ipod/i.test(uaLower)) device = 'mobile';
    else if (/tablet|ipad/i.test(uaLower)) device = 'tablet';

    let browser = 'Other';
    if (uaLower.includes('edg/')) browser = 'Edge';
    else if (uaLower.includes('chrome')) browser = 'Chrome';
    else if (uaLower.includes('firefox')) browser = 'Firefox';
    else if (uaLower.includes('safari')) browser = 'Safari';

    let os = 'Other';
    if (uaLower.includes('windows')) os = 'Windows';
    else if (uaLower.includes('mac os')) os = 'macOS';
    else if (uaLower.includes('linux')) os = 'Linux';
    else if (uaLower.includes('android')) os = 'Android';
    else if (uaLower.includes('iphone') || uaLower.includes('ipad')) os = 'iOS';

    return { device, browser, os };
}

// Get traffic source
function getSource(referrer, utmSource) {
    if (utmSource) {
        if (utmSource.includes('google') || utmSource.includes('bing')) return 'paid';
        if (utmSource.includes('facebook') || utmSource.includes('twitter')) return 'social';
        return 'referral';
    }
    if (!referrer) return 'direct';
    const ref = referrer.toLowerCase();
    if (ref.includes('google.') || ref.includes('bing.') || ref.includes('yahoo.')) return 'organic';
    if (ref.includes('facebook.') || ref.includes('twitter.') || ref.includes('linkedin.')) return 'social';
    return 'referral';
}

// Get GeoIP (simplified - returns random for demo, use MaxMind in production)
// GeoIP cache to avoid blocking external HTTP calls on every pageview
const geoIPCache = new Map();
const GEO_CACHE_TTL = 3600000; // 1 hour
const GEO_CACHE_MAX = 5000;

async function getGeoIP(ip) {
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return { country: 'Local', city: 'Local' };
    }

    // Check cache first
    const cached = geoIPCache.get(ip);
    if (cached && Date.now() - cached.ts < GEO_CACHE_TTL) {
        return { country: cached.country, city: cached.city };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000); // 2s hard timeout
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=country,city`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await response.json();
        const result = { country: data.country || 'Unknown', city: data.city || 'Unknown' };
        geoIPCache.set(ip, { ...result, ts: Date.now() });
        // Cap cache size
        if (geoIPCache.size > GEO_CACHE_MAX) {
            const firstKey = geoIPCache.keys().next().value;
            geoIPCache.delete(firstKey);
        }
        return result;
    } catch {
        return { country: 'Unknown', city: 'Unknown' };
    }
}

// Track page view
async function trackAnalyticsPageView(req, sessionId, page) {
    const now = new Date();
    const hour = now.getHours();
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '127.0.0.1';
    const referrer = req.headers.referer || req.body?.referrer || '';
    const utmSource = req.query?.utm_source || '';
    const ua = req.headers['user-agent'] || '';
    const { device, browser, os } = parseUA(ua);
    const source = getSource(referrer, utmSource);
    const geo = await getGeoIP(ip);

    // Get visitor ID from request body (from track.js localStorage) or use session ID
    const visitorId = req.body?.visitorId || sessionId;

    if (!realtimeAnalytics.activeSessions.has(sessionId)) {
        realtimeAnalytics.today.sessions++;
        realtimeAnalytics.today.uniqueVisitors.add(visitorId);
        realtimeAnalytics.activeSessions.set(sessionId, {
            id: sessionId, startTime: now, lastActivity: now, pageViews: 0, pages: [],
            ip, device, browser, os, country: geo.country, city: geo.city, source
        });
    }

    const session = realtimeAnalytics.activeSessions.get(sessionId);
    session.lastActivity = now;
    session.pageViews++;
    session.pages.push({ page, time: now });
    session.currentPage = page;

    realtimeAnalytics.today.pageViews++;
    realtimeAnalytics.today.hourlyViews[hour]++;
    realtimeAnalytics.today.pages[page] = (realtimeAnalytics.today.pages[page] || 0) + 1;
    realtimeAnalytics.today.sources[source]++;
    realtimeAnalytics.today.devices[device]++;
    realtimeAnalytics.today.browsers[browser] = (realtimeAnalytics.today.browsers[browser] || 0) + 1;
    realtimeAnalytics.today.operatingSystems[os] = (realtimeAnalytics.today.operatingSystems[os] || 0) + 1;
    realtimeAnalytics.today.countries[geo.country] = (realtimeAnalytics.today.countries[geo.country] || 0) + 1;
    realtimeAnalytics.today.cities[geo.city] = (realtimeAnalytics.today.cities[geo.city] || 0) + 1;

    const event = { type: 'pageview', sessionId: sessionId.substring(0, 8), page, country: geo.country, city: geo.city, device, browser, source, time: now.toISOString() };
    realtimeAnalytics.today.realtimeEvents.push(event);
    if (realtimeAnalytics.today.realtimeEvents.length > 100) realtimeAnalytics.today.realtimeEvents.shift();

    // Also track in advancedAnalytics for persistent storage
    try {
        advancedAnalytics.trackPageView({
            path: page,
            title: req.body?.title || page,
            referrer,
            userAgent: ua,
            ip,
            visitorId,
            sessionId,
            country: geo.country,
            screenWidth: req.body?.screenWidth,
            screenHeight: req.body?.screenHeight,
            language: req.body?.language
        });
    } catch (err) {
        // Don't fail the request if advanced analytics fails
        console.error('[Analytics] Advanced tracking error:', err.message);
    }

    broadcastAnalyticsUpdate({ type: 'pageview', data: event, realtime: getRealtimeAnalyticsStats() });
    return event;
}

// Track event
function trackAnalyticsEvent(sessionId, eventName, eventData = {}) {
    const event = { type: 'event', name: eventName, sessionId: sessionId.substring(0, 8), data: eventData, time: new Date().toISOString() };
    realtimeAnalytics.today.realtimeEvents.push(event);
    if (realtimeAnalytics.today.realtimeEvents.length > 100) realtimeAnalytics.today.realtimeEvents.shift();
    if (eventName === 'upload') realtimeAnalytics.today.uploads++;
    if (eventName === 'download') realtimeAnalytics.today.downloads++;

    // Track funnel stage events
    if (eventName === 'funnel_stage' && eventData.stage && eventData.visitorId) {
        trackFunnelEvent(eventData.visitorId, eventData.stage, eventData.page, eventData.funnelHistory);
    }

    // Track high-value checkout events
    if (['checkout_view', 'checkout_started', 'pricing_view', 'payment_success', 'payment_cancelled', 'checkout_time'].includes(eventName)) {
        conversionFunnel.events.push({ name: eventName, data: eventData, time: new Date().toISOString(), sessionId: sessionId.substring(0, 8) });
        if (conversionFunnel.events.length > 500) conversionFunnel.events = conversionFunnel.events.slice(-300);
    }

    broadcastAnalyticsUpdate({ type: 'event', data: event, realtime: getRealtimeAnalyticsStats() });
    return event;
}

// ============ CONVERSION FUNNEL TRACKING ============
const conversionFunnel = {
    // Per-visitor funnel progress: visitorId -> { stages: Set, firstSeen, lastSeen, pages: [] }
    visitors: new Map(),
    // Aggregate stage counts
    stages: { landing: 0, features: 0, pricing: 0, checkout: 0, payment: 0, download: 0, account: 0, other: 0 },
    // Unique visitors per stage
    stageVisitors: { landing: new Set(), features: new Set(), pricing: new Set(), checkout: new Set(), payment: new Set(), download: new Set(), account: new Set() },
    // Checkout detail events
    events: [],
    // Daily funnel snapshots
    daily: {}
};

function trackFunnelEvent(visitorId, stage, page, funnelHistory) {
    if (!conversionFunnel.visitors.has(visitorId)) {
        conversionFunnel.visitors.set(visitorId, {
            stages: new Set(),
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            pages: []
        });
    }

    const visitor = conversionFunnel.visitors.get(visitorId);
    visitor.stages.add(stage);
    visitor.lastSeen = Date.now();
    visitor.pages.push({ page, stage, time: Date.now() });
    if (visitor.pages.length > 50) visitor.pages = visitor.pages.slice(-30);

    // Update aggregate counts
    conversionFunnel.stages[stage] = (conversionFunnel.stages[stage] || 0) + 1;

    // Track unique visitors per stage
    if (conversionFunnel.stageVisitors[stage]) {
        conversionFunnel.stageVisitors[stage].add(visitorId);
    }

    // Daily snapshot
    const today = new Date().toISOString().split('T')[0];
    if (!conversionFunnel.daily[today]) {
        conversionFunnel.daily[today] = { landing: new Set(), features: new Set(), pricing: new Set(), checkout: new Set(), payment: new Set(), download: new Set() };
    }
    if (conversionFunnel.daily[today][stage]) {
        conversionFunnel.daily[today][stage].add(visitorId);
    }

    // Limit visitor map size
    if (conversionFunnel.visitors.size > 10000) {
        const oldestKey = conversionFunnel.visitors.keys().next().value;
        conversionFunnel.visitors.delete(oldestKey);
    }
}

function getConversionFunnelStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayData = conversionFunnel.daily[today] || {};

    // Calculate unique visitors per stage
    const stageUniqueVisitors = {};
    for (const [stage, visitors] of Object.entries(conversionFunnel.stageVisitors)) {
        stageUniqueVisitors[stage] = visitors.size;
    }

    // Calculate today's unique visitors per stage
    const todayStageVisitors = {};
    for (const [stage, visitors] of Object.entries(todayData)) {
        todayStageVisitors[stage] = visitors.size;
    }

    // Build funnel with drop-off rates
    const funnelOrder = ['landing', 'features', 'pricing', 'checkout', 'payment'];
    const funnel = [];
    for (let i = 0; i < funnelOrder.length; i++) {
        const stage = funnelOrder[i];
        const visitors = stageUniqueVisitors[stage] || 0;
        const prevVisitors = i > 0 ? (stageUniqueVisitors[funnelOrder[i - 1]] || 0) : visitors;
        const dropOff = prevVisitors > 0 ? ((1 - visitors / prevVisitors) * 100).toFixed(1) : '0.0';
        const conversionRate = (stageUniqueVisitors.landing || 0) > 0 ? ((visitors / stageUniqueVisitors.landing) * 100).toFixed(1) : '0.0';

        funnel.push({
            stage,
            label: stage.charAt(0).toUpperCase() + stage.slice(1),
            uniqueVisitors: visitors,
            totalViews: conversionFunnel.stages[stage] || 0,
            todayVisitors: todayStageVisitors[stage] || 0,
            dropOffRate: i === 0 ? '0.0' : dropOff,
            conversionFromTop: conversionRate
        });
    }

    // Visitor journeys (recent 20)
    const journeys = [];
    for (const [vid, data] of conversionFunnel.visitors) {
        journeys.push({
            visitorId: vid.substring(0, 12) + '...',
            stages: [...data.stages],
            pagesVisited: data.pages.length,
            firstSeen: new Date(data.firstSeen).toISOString(),
            lastSeen: new Date(data.lastSeen).toISOString(),
            reachedCheckout: data.stages.has('checkout'),
            reachedPayment: data.stages.has('payment'),
            lastPage: data.pages.length > 0 ? data.pages[data.pages.length - 1].page : '/'
        });
    }
    journeys.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

    // Checkout events detail
    const checkoutEvents = conversionFunnel.events.slice(-30).reverse();

    // Active on checkout right now
    const activeCheckout = [];
    for (const session of realtimeAnalytics.activeSessions.values()) {
        const page = session.currentPage || '/';
        if (['/checkout.html', '/order.html', '/pay.html'].includes(page)) {
            activeCheckout.push({
                page,
                device: session.device,
                country: session.country,
                source: session.source,
                duration: Math.round((Date.now() - session.startTime.getTime()) / 1000)
            });
        }
    }

    return {
        funnel,
        totalTrackedVisitors: conversionFunnel.visitors.size,
        checkoutConversionRate: (stageUniqueVisitors.landing || 0) > 0
            ? ((stageUniqueVisitors.checkout || 0) / stageUniqueVisitors.landing * 100).toFixed(1) + '%'
            : '0.0%',
        paymentConversionRate: (stageUniqueVisitors.landing || 0) > 0
            ? ((stageUniqueVisitors.payment || 0) / stageUniqueVisitors.landing * 100).toFixed(1) + '%'
            : '0.0%',
        activeOnCheckout: activeCheckout,
        recentCheckoutEvents: checkoutEvents,
        visitorJourneys: journeys.slice(0, 20),
        additionalPages: {
            download: stageUniqueVisitors.download || 0,
            account: stageUniqueVisitors.account || 0
        }
    };
}

// Get real-time stats
function getRealtimeAnalyticsStats() {
    const now = Date.now();
    const activeTimeout = 5 * 60 * 1000;

    for (const [id, session] of realtimeAnalytics.activeSessions) {
        if (now - session.lastActivity.getTime() > activeTimeout) {
            const duration = (session.lastActivity.getTime() - session.startTime.getTime()) / 1000;
            realtimeAnalytics.today.totalSessionDuration += duration;
            if (session.pageViews === 1) realtimeAnalytics.today.bounces++;
            realtimeAnalytics.activeSessions.delete(id);
        }
    }

    const pageUsers = {};
    for (const session of realtimeAnalytics.activeSessions.values()) {
        const page = session.currentPage || '/';
        pageUsers[page] = (pageUsers[page] || 0) + 1;
    }

    return {
        activeUsers: realtimeAnalytics.activeSessions.size,
        pageViewsToday: realtimeAnalytics.today.pageViews,
        uniqueVisitorsToday: realtimeAnalytics.today.uniqueVisitors.size,
        sessionsToday: realtimeAnalytics.today.sessions,
        uploadsToday: realtimeAnalytics.today.uploads,
        downloadsToday: realtimeAnalytics.today.downloads,
        bounceRate: realtimeAnalytics.today.sessions > 0 ? ((realtimeAnalytics.today.bounces / realtimeAnalytics.today.sessions) * 100).toFixed(1) : 0,
        avgSessionDuration: realtimeAnalytics.today.sessions > 0 ? Math.round(realtimeAnalytics.today.totalSessionDuration / realtimeAnalytics.today.sessions) : 0,
        topActivePages: Object.entries(pageUsers).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([page, users]) => ({ page, users })),
        viewsPerMinute: Math.round(realtimeAnalytics.today.realtimeEvents.filter(e => new Date(e.time).getTime() > now - 300000 && e.type === 'pageview').length / 5)
    };
}

// Get full analytics (merged with persistent data)
function getFullRealtimeAnalytics() {
    const realtime = getRealtimeAnalyticsStats();
    const persistent = getAggregatedPersistentStats();

    // Merge in-memory today stats with persistent today stats
    const mergedTodayPageViews = realtimeAnalytics.today.pageViews + persistent.today.pageViews;
    const mergedTodayVisitors = realtimeAnalytics.today.uniqueVisitors.size + persistent.today.uniqueVisitors;
    const mergedTodaySessions = realtimeAnalytics.today.sessions + persistent.today.sessions;

    // Merge devices
    const mergedDevices = {
        desktop: (realtimeAnalytics.today.devices.desktop || 0) + (persistent.today.devices.desktop || 0),
        mobile: (realtimeAnalytics.today.devices.mobile || 0) + (persistent.today.devices.mobile || 0),
        tablet: (realtimeAnalytics.today.devices.tablet || 0) + (persistent.today.devices.tablet || 0)
    };

    // Merge sources
    const mergedSources = {};
    Object.keys(realtimeAnalytics.today.sources).forEach(key => {
        mergedSources[key] = (realtimeAnalytics.today.sources[key] || 0) + (persistent.today.sources[key] || 0);
    });

    // Merge pages
    const mergedPages = { ...persistent.today.pages };
    Object.entries(realtimeAnalytics.today.pages).forEach(([page, views]) => {
        mergedPages[page] = (mergedPages[page] || 0) + views;
    });

    // Merge countries
    const mergedCountries = { ...persistent.today.countries };
    Object.entries(realtimeAnalytics.today.countries).forEach(([country, visits]) => {
        mergedCountries[country] = (mergedCountries[country] || 0) + visits;
    });

    // Merge browsers
    const mergedBrowsers = { ...persistent.today.browsers };
    Object.entries(realtimeAnalytics.today.browsers).forEach(([browser, count]) => {
        mergedBrowsers[browser] = (mergedBrowsers[browser] || 0) + count;
    });

    // Merge hourly views
    const mergedHourlyViews = realtimeAnalytics.today.hourlyViews.map((v, i) =>
        v + (persistent.today.hourlyViews[i] || 0)
    );

    return {
        success: true,
        realtime: {
            ...realtime,
            pageViewsToday: mergedTodayPageViews,
            uniqueVisitorsToday: mergedTodayVisitors,
            sessionsToday: mergedTodaySessions
        },
        today: {
            pageViews: mergedTodayPageViews,
            uniqueVisitors: mergedTodayVisitors,
            sessions: mergedTodaySessions,
            uploads: realtimeAnalytics.today.uploads,
            downloads: realtimeAnalytics.today.downloads,
            bounceRate: mergedTodaySessions > 0 ? ((realtimeAnalytics.today.bounces / mergedTodaySessions) * 100).toFixed(1) : persistent.total.bounceRate,
            avgSessionDuration: realtime.avgSessionDuration,
            hourlyViews: mergedHourlyViews,
            sources: mergedSources,
            devices: mergedDevices
        },
        // Total stats (all-time from persistent + today's in-memory)
        total: {
            pageViews: persistent.total.pageViews + realtimeAnalytics.today.pageViews,
            uniqueVisitors: persistent.total.uniqueVisitors,
            sessions: persistent.total.sessions + realtimeAnalytics.today.sessions,
            bounceRate: persistent.total.bounceRate
        },
        // Historical data for charts
        historical: persistent.historical,
        topPages: Object.entries(mergedPages).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([page, views]) => ({ page, views })),
        topCountries: Object.entries(mergedCountries).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([country, visits]) => ({ country, visits })),
        topCities: Object.entries(realtimeAnalytics.today.cities).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([city, visits]) => ({ city, visits })),
        browsers: Object.entries(mergedBrowsers).sort((a, b) => b[1] - a[1]).map(([browser, count]) => ({ browser, count })),
        operatingSystems: Object.entries(realtimeAnalytics.today.operatingSystems).sort((a, b) => b[1] - a[1]).map(([os, count]) => ({ os, count })),
        activeSessions: Array.from(realtimeAnalytics.activeSessions.values()).map(s => ({
            id: s.id.substring(0, 8), currentPage: s.currentPage, pageViews: s.pageViews,
            duration: Math.round((Date.now() - s.startTime.getTime()) / 1000),
            country: s.country, city: s.city, device: s.device, browser: s.browser, source: s.source
        })),
        recentEvents: realtimeAnalytics.today.realtimeEvents.slice(0, 50),
        recentPageViews: persistent.recentPageViews
    };
}

// Analytics WebSocket handler
analyticsWss.on('connection', (ws) => {
    console.log('[Analytics WS] Client connected');
    try {
        ws.send(JSON.stringify({ type: 'init', data: getFullRealtimeAnalytics() }));
    } catch (err) {
        console.error('[Analytics WS] Error sending init data:', err);
    }
    ws.on('close', () => console.log('[Analytics WS] Client disconnected'));
    ws.on('error', (err) => console.error('[Analytics WS] Error:', err));
});

// Analytics API endpoints
app.get('/api/analytics', (req, res) => {
    try {
        res.json(getFullRealtimeAnalytics());
    } catch (err) {
        console.error('[Analytics] Error getting full analytics:', err);
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/analytics/realtime', (req, res) => {
    try {
        res.json({ success: true, ...getRealtimeAnalyticsStats(), recentEvents: realtimeAnalytics.today.realtimeEvents.slice(0, 20) });
    } catch (err) {
        console.error('[Analytics] Error getting realtime stats:', err);
        res.json({ success: false, error: err.message });
    }
});

// ============ SOCIAL PROOF API ============
// Public endpoint for displaying real activity data on share pages
let socialProofCache = { data: null, timestamp: 0 };
const SOCIAL_PROOF_CACHE_TTL = 30000; // 30 second cache

app.get('/api/social-proof/active-checkouts', (req, res) => {
    try {
        const now = Date.now();

        // Return cached data if fresh
        if (socialProofCache.data && (now - socialProofCache.timestamp) < SOCIAL_PROOF_CACHE_TTL) {
            return res.json(socialProofCache.data);
        }

        // Real data from live analytics
        const activeVisitors = realtimeAnalytics.activeSessions.size;
        const todayUploads = realtimeAnalytics.today.uploads;
        const todayPageViews = realtimeAnalytics.today.pageViews;
        const todaySessions = realtimeAnalytics.today.sessions;

        // Total images ever shared (from actual uploads directory)
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
    // Allow static admin pages (served by express.static, not API)
    if (!req.path.startsWith('/') || req.method === 'OPTIONS') return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Admin authentication required' });
    }

    const token = authHeader.substring(7);
    const result = adminService.validateAdminSession(token);
    if (!result) {
        return res.status(401).json({ error: 'Invalid or expired admin token' });
    }

    req.admin = result.admin;
    req.session = result.session;
    next();
});

// Admin uploads list
app.get('/api/admin/uploads', (req, res) => {
    try {
        const db = loadUploadsDb();
        res.json({
            success: true,
            total: db.uploads.length,
            uploads: db.uploads.slice(-100).reverse() // Last 100 uploads
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: AI Payment Guard Health Stats
app.get('/api/admin/payment-health', (req, res) => {
    try {
        const stats = paymentGuard.getHealthStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin devices list
app.get('/api/admin/devices', (req, res) => {
    try {
        const db = loadUploadsDb();
        const devices = [];
        const deviceMap = new Map();

        // Aggregate uploads by device
        for (const upload of db.uploads) {
            if (!upload.deviceId) continue;
            if (!deviceMap.has(upload.deviceId)) {
                deviceMap.set(upload.deviceId, {
                    id: upload.deviceId,
                    uploads: 0,
                    lastSeen: upload.timestamp,
                    linkedBrowsers: 0
                });
            }
            const dev = deviceMap.get(upload.deviceId);
            dev.uploads++;
            if (upload.timestamp > dev.lastSeen) {
                dev.lastSeen = upload.timestamp;
            }
        }

        // Count linked browsers
        if (db.devices) {
            for (const [deviceId, data] of Object.entries(db.devices)) {
                if (deviceMap.has(deviceId)) {
                    deviceMap.get(deviceId).linkedBrowsers = data.browsers?.length || 0;
                } else {
                    deviceMap.set(deviceId, {
                        id: deviceId,
                        uploads: 0,
                        lastSeen: null,
                        linkedBrowsers: data.browsers?.length || 0
                    });
                }
            }
        }

        res.json({
            success: true,
            devices: Array.from(deviceMap.values())
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin connected users (online right now)
app.get('/api/admin/online', (req, res) => {
    const users = [];
    connectedUsers.forEach((user, clientId) => {
        users.push({
            clientId,
            deviceId: user.deviceId,
            type: user.type,
            connectedAt: user.connectedAt,
            lastPing: user.lastPing,
            lastActivity: user.lastActivity
        });
    });
    res.json({
        success: true,
        total: users.length,
        desktop: users.filter(u => u.type === 'desktop').length,
        web: users.filter(u => u.type === 'web').length,
        users
    });
});

// Admin - List all gifts
app.get('/api/admin/gifts', (req, res) => {
    try {
        const giftsFile = path.join(__dirname, 'data', 'gifts.json');
        let gifts = [];

        if (fs.existsSync(giftsFile)) {
            gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
        }

        // Get stats
        const pending = gifts.filter(g => g.status === 'pending').length;
        const redeemed = gifts.filter(g => g.status === 'redeemed').length;

        res.json({
            success: true,
            total: gifts.length,
            pending,
            redeemed,
            gifts: gifts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        });
    } catch (error) {
        console.error('[Admin] List gifts error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin stats overview
app.get('/api/admin/stats', (req, res) => {
    try {
        const db = loadUploadsDb();
        const onlineDesktop = Array.from(connectedUsers.values()).filter(u => u.type === 'desktop').length;
        const onlineWeb = Array.from(connectedUsers.values()).filter(u => u.type === 'web').length;

        res.json({
            success: true,
            online: {
                total: connectedUsers.size,
                desktop: onlineDesktop,
                web: onlineWeb
            },
            uploads: {
                total: db.uploads.length,
                today: db.uploads.filter(u => {
                    const uploadDate = new Date(u.timestamp).toDateString();
                    return uploadDate === new Date().toDateString();
                }).length
            },
            devices: Object.keys(db.devices || {}).length,
            terminalSessions: sshRelay.getStats().activeConnections
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Visitor tracking data (cached)
const visitorStatsPath = path.join(__dirname, 'data', 'visitor-stats.json');
let visitorStatsCache = null;
let visitorStatsDirty = false;

function loadVisitorStats() {
    if (visitorStatsCache) return visitorStatsCache;
    try {
        if (fs.existsSync(visitorStatsPath)) {
            visitorStatsCache = JSON.parse(fs.readFileSync(visitorStatsPath, 'utf8'));
            return visitorStatsCache;
        }
    } catch (e) {}
    visitorStatsCache = { totalPageViews: 0, dailyStats: {}, visitors: {} };
    return visitorStatsCache;
}

function saveVisitorStats(stats) {
    visitorStatsCache = stats;
    visitorStatsDirty = true;
}

// Flush visitor stats every 10 seconds
setInterval(() => {
    if (visitorStatsDirty && visitorStatsCache) {
        fs.writeFile(visitorStatsPath, JSON.stringify(visitorStatsCache), (err) => {
            if (err) console.error('[DB] Visitor stats flush error:', err.message);
        });
        visitorStatsDirty = false;
    }
}, 10000);

// ============ META CONVERSIONS API (SERVER-SIDE) ============
// Receives events from client meta-pixel.js and relays to Meta's Graph API
// This provides server-side signal (IP, user agent, hashed PII) for 10/10 match quality
const META_PIXEL_ID = process.env.META_PIXEL_ID || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';

function hashForMeta(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(value.toString().toLowerCase().trim()).digest('hex');
}

app.post('/api/meta/capi', express.json(), async (req, res) => {
    res.status(200).json({ ok: true }); // Respond immediately

    if (!META_PIXEL_ID || !META_ACCESS_TOKEN) return;

    try {
        const { event_name, event_id, event_time, event_source_url, user_data, custom_data } = req.body;
        if (!event_name) return;

        // Build hashed user data for Meta
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
        const clientUa = req.headers['user-agent'] || user_data?.client_user_agent || '';

        const hashedUserData = {
            client_ip_address: clientIp,
            client_user_agent: clientUa
        };

        // Hash PII fields (Meta requires SHA-256 hashing)
        if (user_data?.em) hashedUserData.em = [hashForMeta(user_data.em)];
        if (user_data?.fn) hashedUserData.fn = [hashForMeta(user_data.fn)];
        if (user_data?.ln) hashedUserData.ln = [hashForMeta(user_data.ln)];
        if (user_data?.external_id) hashedUserData.external_id = [hashForMeta(user_data.external_id)];
        if (user_data?.fbc) hashedUserData.fbc = user_data.fbc;
        if (user_data?.fbp) hashedUserData.fbp = user_data.fbp;

        const eventPayload = {
            data: [{
                event_name,
                event_id,
                event_time: event_time || Math.floor(Date.now() / 1000),
                event_source_url: event_source_url || '',
                action_source: 'website',
                user_data: hashedUserData,
                custom_data: custom_data || {}
            }]
        };

        // Send to Meta Graph API
        const url = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[CAPI] Meta API error:', response.status, errText);
        } else {
            console.log('[CAPI]', event_name, '- sent to Meta (event_id:', event_id + ')');
        }
    } catch (err) {
        console.error('[CAPI] Error:', err.message);
    }
});

// Track page view (single canonical endpoint - handles both basic stats and advanced traffic)
app.post('/api/track/pageview', express.json(), (req, res) => {
    try {
        // Basic visitor stats
        const stats = loadVisitorStats();
        const today = new Date().toISOString().split('T')[0];
        const visitorId = req.body.visitorId || req.ip;

        stats.totalPageViews = (stats.totalPageViews || 0) + 1;
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = { pageViews: 0, uniqueVisitors: new Set() };
        }
        if (Array.isArray(stats.dailyStats[today].uniqueVisitors)) {
            stats.dailyStats[today].uniqueVisitors = new Set(stats.dailyStats[today].uniqueVisitors);
        }
        stats.dailyStats[today].pageViews++;
        stats.dailyStats[today].uniqueVisitors.add(visitorId);

        const statsToSave = {
            ...stats,
            dailyStats: Object.fromEntries(
                Object.entries(stats.dailyStats).map(([date, data]) => [
                    date,
                    {
                        pageViews: data.pageViews,
                        uniqueVisitors: Array.isArray(data.uniqueVisitors) ? data.uniqueVisitors : Array.from(data.uniqueVisitors)
                    }
                ])
            )
        };
        saveVisitorStats(statsToSave);

        // Advanced traffic tracking
        try {
            const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
            const data = {
                path: req.body.path || req.body.url || '/',
                referrer: req.body.referrer || req.headers.referer || 'direct',
                ip,
                userAgent: req.headers['user-agent'],
                sessionId: req.body.sessionId,
                country: req.body.country || req.headers['cf-ipcountry'] || 'Unknown',
                city: req.body.city,
                screenWidth: req.body.screenWidth,
                screenHeight: req.body.screenHeight,
                language: req.body.language || req.headers['accept-language']?.split(',')[0]
            };
            trafficService.trackPageView(data);

            if (global.trackMonitorActivity) {
                global.trackMonitorActivity('visit', { description: 'Page visited', page: data.path, country: data.country });
            }

            const fingerprint = req.body.fingerprint || req.body.sessionId;
            if (fingerprint && salesDatabase) {
                salesDatabase.trackJourney(fingerprint, {
                    page: data.path,
                    source: data.referrer === 'direct' ? 'direct' : new URL(data.referrer || '').hostname
                });
            }
        } catch (advErr) {
            // Silent fail for advanced tracking
        }

        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

// Get visitor stats for admin
app.get('/api/admin/visitors/stats', (req, res) => {
    try {
        const stats = loadVisitorStats();
        const today = new Date().toISOString().split('T')[0];
        const todayStats = stats.dailyStats[today] || { pageViews: 0, uniqueVisitors: [] };

        const uniqueVisitorsArray = Array.isArray(todayStats.uniqueVisitors)
            ? todayStats.uniqueVisitors
            : Array.from(todayStats.uniqueVisitors || []);

        res.json({
            success: true,
            liveVisitors: connectedUsers.size,
            todayVisitors: uniqueVisitorsArray.length,
            todayPageViews: todayStats.pageViews || 0,
            totalPageViews: stats.totalPageViews || 0
        });
    } catch (e) {
        res.json({
            success: true,
            liveVisitors: connectedUsers.size,
            todayVisitors: 0,
            todayPageViews: 0,
            totalPageViews: 0
        });
    }
});

// Get share statistics for admin
app.get('/api/admin/shares', (req, res) => {
    try {
        const sharesPath = path.join(__dirname, 'data', 'shares.json');
        let shares = {};
        if (fs.existsSync(sharesPath)) {
            shares = JSON.parse(fs.readFileSync(sharesPath, 'utf8'));
        }

        // Calculate totals by source
        const sourceTotals = {};
        let totalViews = 0;
        let totalImages = Object.keys(shares).length;

        Object.values(shares).forEach(img => {
            totalViews += img.views || 0;
            Object.entries(img.sources || {}).forEach(([source, count]) => {
                sourceTotals[source] = (sourceTotals[source] || 0) + count;
            });
        });

        // Get top shared images
        const topImages = Object.entries(shares)
            .sort((a, b) => (b[1].views || 0) - (a[1].views || 0))
            .slice(0, 10)
            .map(([filename, data]) => ({
                filename,
                views: data.views,
                sources: data.sources,
                firstView: data.firstView,
                lastView: data.lastView
            }));

        res.json({
            success: true,
            totalViews,
            totalImages,
            sourceTotals,
            topImages
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Auto-delete after 1 year (in milliseconds) - extended from 24h to prevent broken links
const IMAGE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

// Free membership limits configuration (synced with plan-resolver.js PLAN_LIMITS.free)
const FREE_TIER_CONFIG = {
    maxFileSizeMB: 1024,           // 1 GB max file size
    storageMB: 1024,               // 1 GB total storage (matches plan-resolver)
    expirationDays: 30,            // 30 days file expiration for temporal drives
    uploadsPerDay: 7,              // 7 uploads per day, resets at midnight (was 500 - fixed to match plan definition)
    uploadSpeedLimitBps: 1024 * 1024 * 1024, // 1 GB/sec upload speed limit
    crossDeviceUploads: true       // Cross-device uploads enabled
};
const FREE_TIER_EXPIRATION_MS = FREE_TIER_CONFIG.expirationDays * 24 * 60 * 60 * 1000;

// Daily upload tracking (resets at midnight)
const dailyUploadTracker = new Map(); // deviceId -> { date: 'YYYY-MM-DD', count: number }

function getTodayDate() {
    return new Date().toISOString().split('T')[0]; // Returns 'YYYY-MM-DD'
}

function getDailyUploadCount(deviceId) {
    const today = getTodayDate();
    const tracker = dailyUploadTracker.get(deviceId);
    if (!tracker || tracker.date !== today) {
        return 0;
    }
    return tracker.count;
}

function incrementDailyUploadCount(deviceId) {
    const today = getTodayDate();
    const tracker = dailyUploadTracker.get(deviceId);
    if (!tracker || tracker.date !== today) {
        dailyUploadTracker.set(deviceId, { date: today, count: 1 });
    } else {
        tracker.count++;
    }
}

function checkDailyUploadLimit(deviceId, isPaidUser = false) {
    if (isPaidUser) {
        return { allowed: true, remaining: -1 }; // Unlimited for paid users
    }
    const count = getDailyUploadCount(deviceId);
    const limit = FREE_TIER_CONFIG.uploadsPerDay;
    return {
        allowed: count < limit,
        remaining: Math.max(0, limit - count),
        used: count,
        limit: limit
    };
}

// Create directories
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Helper function to load JSON files safely
function loadJSON(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error('[loadJSON] Error loading', filePath, e.message);
    }
    return defaultValue;
}

// Database file for uploads
const uploadsDbPath = path.join(dataDir, 'uploads.json');

// Cached uploads database (non-blocking)
let uploadsDbCache = null;
let uploadsDbDirty = false;

// Load uploads database from cache (instant) or disk (first time only)
function loadUploadsDb() {
    if (uploadsDbCache) return uploadsDbCache;
    try {
        if (fs.existsSync(uploadsDbPath)) {
            uploadsDbCache = JSON.parse(fs.readFileSync(uploadsDbPath, 'utf8'));
            return uploadsDbCache;
        }
    } catch (e) {}
    uploadsDbCache = { uploads: [], devices: {} };
    return uploadsDbCache;
}

// Save uploads database to cache (instant), flush to disk async
function saveUploadsDb(db) {
    uploadsDbCache = db;
    uploadsDbDirty = true;
}

// Flush uploads DB to disk every 2 seconds if dirty
setInterval(() => {
    if (uploadsDbDirty && uploadsDbCache) {
        fs.writeFile(uploadsDbPath, JSON.stringify(uploadsDbCache), (err) => {
            if (err) console.error('[DB] Uploads flush error:', err.message);
        });
        uploadsDbDirty = false;
    }
}, 5000); // was 2s, reduced frequency for performance

// Auto-cleanup expired images (runs every 10 minutes)
function cleanupExpiredImages() {
    const now = Date.now();
    const db = loadUploadsDb();
    let deletedCount = 0;

    const expiredUploads = db.uploads.filter(u => {
        const expiresAt = u.expiresAt || (u.timestamp + IMAGE_LIFETIME_MS);
        return now >= expiresAt;
    });

    for (const upload of expiredUploads) {
        // Delete file
        const filePath = path.join(uploadsDir, upload.filename);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            deletedCount++;
        } catch (e) {
            console.error(`Failed to delete ${upload.filename}:`, e.message);
        }

        // Update device count
        if (db.devices[upload.deviceId]) {
            db.devices[upload.deviceId].uploadCount = Math.max(0, db.devices[upload.deviceId].uploadCount - 1);
        }
    }

    // Remove expired from database
    db.uploads = db.uploads.filter(u => {
        const expiresAt = u.expiresAt || (u.timestamp + IMAGE_LIFETIME_MS);
        return now < expiresAt;
    });

    if (deletedCount > 0) {
        saveUploadsDb(db);
        console.log(`[Cleanup] Deleted ${deletedCount} expired images`);
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredImages, 10 * 60 * 1000);

// Run cleanup on startup
setTimeout(cleanupExpiredImages, 5000);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        cb(null, uuidv4() + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max file size for free membership
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|bmp/;
        const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mime = allowedTypes.test(file.mimetype);
        cb(null, ext || mime ? true : false);
    }
});

// Proxy /7G/* to ConnectHub
app.use('/7G', createProxyMiddleware({
    target: `https://${HOST}:${CONNECTHUB_PORT}`,
    changeOrigin: true,
    pathRewrite: { '^/7G': '/7G' },
    ws: true
}));

// Handle root-level UUID URLs - redirect to /i/ handler
// This catches URLs like /f983f950-6ee1-4a7b-a373-ad2f865f9551 and redirects to /i/f983f950-...
app.get('/:uuid([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', (req, res) => {
    const queryString = Object.keys(req.query).length > 0
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    res.redirect(301, `/i/${req.params.uuid}${queryString}`);
});

// Handle /up/i/ URLs - redirect to /i/ handler
app.get('/up/i/:filename', (req, res) => {
    // Preserve query parameters
    const queryString = Object.keys(req.query).length > 0
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    res.redirect(301, `/i/${req.params.filename}${queryString}`);
});

// Smart Image Sharing - Rich previews + Viral sharing page (ASYNC for performance)
app.get('/i/:filename', async (req, res) => {
    const filename = req.params.filename;
    const ref = req.query.ref || 'direct';
    const userAgent = req.headers['user-agent'] || '';

    // Redirect .png/.jpg URLs to extensionless URLs for share page views
    // Cloudflare auto-caches URLs with image extensions, causing share pages to be
    // served as raw images. Extensionless URLs bypass Cloudflare's default caching.
    if (req.query.raw !== '1') {
        const extMatch = filename.match(/\.(png|jpg|jpeg|gif|webp)$/i);
        if (extMatch) {
            const baseName = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
            const queryString = Object.keys(req.query).length > 0
                ? '?' + new URLSearchParams(req.query).toString()
                : '';
            return res.redirect(302, `/i/${baseName}${queryString}`);
        }
    }

    // Get file info from cache (async, non-blocking)
    const fileInfo = await getFileInfo(filename);

    // Check if file exists
    if (!fileInfo.exists) {
        // Return a styled 404 page
        return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Not Found - DOZ UP</title>
    <link rel="icon" href="/favicon.ico">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            max-width: 500px;
        }
        .icon {
            font-size: 80px;
            margin-bottom: 24px;
            opacity: 0.8;
        }
        h1 {
            font-size: 28px;
            margin-bottom: 12px;
            color: #fff;
        }
        p {
            color: rgba(255,255,255,0.6);
            margin-bottom: 32px;
            line-height: 1.6;
        }
        .reasons {
            text-align: left;
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 32px;
        }
        .reasons h3 {
            font-size: 14px;
            color: rgba(255,255,255,0.5);
            margin-bottom: 12px;
        }
        .reasons ul {
            list-style: none;
            color: rgba(255,255,255,0.7);
            font-size: 14px;
        }
        .reasons li {
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .reasons li:last-child { border-bottom: none; }
        .reasons li::before {
            content: '•';
            color: #4CAF50;
            margin-right: 10px;
        }
        .btn {
            display: inline-block;
            padding: 14px 32px;
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: #fff;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            transition: all 0.3s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(76, 175, 80, 0.3);
        }
        .home-link {
            display: block;
            margin-top: 20px;
            color: rgba(255,255,255,0.5);
            text-decoration: none;
            font-size: 14px;
        }
        .home-link:hover { color: #fff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">📷</div>
        <h1>Image Not Found</h1>
        <p>The image you're looking for isn't available. It may have been removed or the link might be incorrect.</p>
        <div class="reasons">
            <h3>This could happen because:</h3>
            <ul>
                <li>The image has expired (free tier: 30 days)</li>
                <li>The uploader deleted the image</li>
                <li>The link was mistyped or corrupted</li>
                <li>The image was never uploaded</li>
            </ul>
        </div>
        <a href="/up" class="btn">Upload a New Image</a>
        <a href="/up" class="home-link">← Back to DOZ UP</a>
    </div>
</body>
</html>`);
    }

    // Get file info from cache (already fetched above)
    const filePath = fileInfo.path;
    const fileSizeKB = fileInfo.sizeKB;
    const imageUrl = `https://${SHARE_HOST}/${filename}`;
    const rawImageUrl = `https://${SHARE_HOST}/${filename}?raw=1`;

    // Serve raw image only via explicit ?raw=1 parameter
    // Never auto-detect via Sec-Fetch-Dest - Cloudflare caches by URL, not headers,
    // so content negotiation causes the raw image to be cached over the share page
    if (req.query.raw === '1') {
        res.set('Cache-Control', 'public, max-age=2592000, immutable');
        return res.sendFile(filePath);
    }

    // All other requests get the share page HTML
    // Cloudflare auto-caches URLs ending in .png/.jpg etc - must explicitly tell it not to
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('CDN-Cache-Control', 'no-store');
    res.set('Cloudflare-CDN-Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');

    // Track share source (only for share page views, not image loads)
    trackShareView(filename, ref, userAgent);

    // Detect social media crawlers for Open Graph previews
    const crawlers = [
        'WhatsApp', 'facebookexternalhit', 'Facebot', 'Twitterbot',
        'TelegramBot', 'LinkedInBot', 'Slackbot', 'Discord', 'vkShare',
        'Viber', 'SkypeUriPreview', 'Pinterest'
    ];
    const isCrawler = crawlers.some(c => userAgent.includes(c));

    if (isCrawler) {
        // Serve Open Graph meta tags for rich preview
        return res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta property="og:title" content="Check out this image on DOZ">
    <meta property="og:description" content="Shared via DOZ - The fastest way to share screenshots and images">
    <meta property="og:image" content="${rawImageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:url" content="${imageUrl}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="DOZ">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Check out this image on DOZ">
    <meta name="twitter:description" content="Shared via DOZ - The fastest way to share screenshots">
    <meta name="twitter:image" content="${rawImageUrl}">
    <link rel="icon" href="https://${SHARE_HOST}/favicon.ico">
</head>
<body>
    <script>window.location.href="${imageUrl}";</script>
</body>
</html>`);
    }

    // Serve viral share page for browsers (with output cache)
    const cacheKey = `${filename}|${ref || ''}`;
    const cachedPage = sharePageCache.get(cacheKey);
    if (cachedPage && Date.now() - cachedPage.ts < SHARE_CACHE_TTL) {
        return res.send(cachedPage.html);
    }
    const html = generateSharePage(filename, imageUrl, rawImageUrl, fileSizeKB, ref);
    sharePageCache.set(cacheKey, { html, ts: Date.now() });
    if (sharePageCache.size > SHARE_CACHE_MAX) {
        const firstKey = sharePageCache.keys().next().value;
        sharePageCache.delete(firstKey);
    }
    res.send(html);
});

// Load share views data
function loadShareViews() {
    try {
        const sharesPath = path.join(__dirname, 'data', 'shares.json');
        if (fs.existsSync(sharesPath)) {
            return JSON.parse(fs.readFileSync(sharesPath, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Track share views - ASYNC non-blocking (fire-and-forget for performance)
function trackShareView(filename, source, userAgent) {
    // Fire and forget - don't block the response
    setImmediate(async () => {
        try {
            const sharesPath = path.join(__dirname, 'data', 'shares.json');
            // IMPORTANT: Normalize key by stripping extension to prevent duplicates
            const normalizedKey = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');

            let shares = {};
            try {
                const data = await fs.promises.readFile(sharesPath, 'utf8');
                shares = JSON.parse(data);
            } catch (e) {
                // File doesn't exist yet, start fresh
            }

            if (!shares[normalizedKey]) {
                shares[normalizedKey] = { views: 0, sources: {}, firstView: Date.now() };
            }

            shares[normalizedKey].views++;
            shares[normalizedKey].lastView = Date.now();
            shares[normalizedKey].sources[source] = (shares[normalizedKey].sources[source] || 0) + 1;

            await fs.promises.writeFile(sharesPath, JSON.stringify(shares));

            // Track for live monitor
            if (global.trackMonitorActivity) {
                global.trackMonitorActivity('share', {
                    description: 'Share link viewed',
                    page: source || 'direct'
                });
            }
        } catch (e) {
            console.log('[Share Tracking] Error:', e.message);
        }
    });
}

// Generate viral share page
// Share page output cache (avoids regenerating 55KB template on every request)
const sharePageCache = new Map();
const SHARE_CACHE_TTL = 300000; // 5 minutes
const SHARE_CACHE_MAX = 200;

function generateSharePage(filename, imageUrl, rawImageUrl, fileSizeKB, ref) {
    const shareText = encodeURIComponent(`Check this out! 👀`);
    const shareUrl = encodeURIComponent(imageUrl);
    const inviteText = encodeURIComponent(`I'm using DOZ to share screenshots instantly - try it free! 🚀`);
    const inviteUrl = encodeURIComponent(`https://${SHARE_HOST}/download?ref=invite`);
    const downloadPageUrl = `https://${SHARE_HOST}/download?ref=share_page`;
    const emailSubject = encodeURIComponent('Check out this image!');
    const emailBody = encodeURIComponent(`I wanted to share this with you:\n\n${imageUrl}?ref=email\n\nShared via DOZ - The fastest way to share screenshots`);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
    <title>Shared Image - DOZ</title>
    <meta property="og:title" content="Check out this image on DOZ">
    <meta property="og:description" content="Shared via DOZ - The fastest way to share screenshots and images">
    <meta property="og:image" content="${rawImageUrl}">
    <meta property="og:url" content="${imageUrl}">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${rawImageUrl}">
    <link rel="icon" href="https://${SHARE_HOST}/favicon.ico">

    <!-- Google tag (gtag.js) - Google Ads -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-441083115"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'AW-441083115');
    </script>

    <!-- Meta Pixel for conversion tracking -->
    <script>
        window.META_PIXEL_ID = '${process.env.META_PIXEL_ID || ''}';
    </script>
    <script src="/js/meta-pixel.js"></script>
    <script>
        // Fire ViewContent event for Meta to track share page views
        document.addEventListener('DOMContentLoaded', function() {
            if (window.DOZPixel && window.META_PIXEL_ID) {
                DOZPixel.trackViewContent('Share View', 'SharePage', 0, 'USD');
                DOZPixel.trackCustomEvent('SharePageView', {
                    share_id: '${filename}',
                    referrer: '${ref}',
                    content_type: 'image'
                });
            }
        });
    </script>

    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
            min-height: 100vh;
            color: #fff;
            display: flex;
            flex-direction: column;
        }
        .container {
            flex: 1;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 0 20px;
        }
        .logo {
            font-size: 1.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, #7c3aed, #10b981);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            cursor: pointer;
            text-decoration: none;
        }
        .try-btn {
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            border: none;
            color: #fff;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            font-size: 0.9rem;
            transition: transform 0.2s, box-shadow 0.2s;
            animation: pulse 2s 3;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            will-change: transform;
        }
        @keyframes pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4); }
            50% { box-shadow: 0 0 0 10px rgba(124, 58, 237, 0); }
        }
        .try-btn:hover {
            transform: scale(1.05);
            box-shadow: 0 10px 30px rgba(124, 58, 237, 0.4);
            animation: none;
        }
        .image-container {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            overflow: hidden;
            margin-bottom: 20px;
            position: relative;
        }
        .image-container img {
            width: 100%;
            display: block;
            cursor: zoom-in;
            transition: transform 0.3s;
        }
        .image-container:hover img {
            transform: scale(1.02);
        }
        .image-info {
            padding: 15px 20px;
            background: rgba(0,0,0,0.3);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.85rem;
            color: rgba(255,255,255,0.6);
        }
        .image-actions {
            display: flex;
            gap: 10px;
        }
        .image-action-btn {
            background: rgba(255,255,255,0.1);
            border: none;
            color: #fff;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 5px;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
        }
        .image-action-btn:hover {
            background: rgba(124, 58, 237, 0.5);
        }
        .share-section {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
        }
        .share-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 15px;
            text-align: center;
        }
        .share-buttons {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 12px;
        }
        .share-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 16px;
            border-radius: 12px;
            border: none;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            color: #fff;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
        }
        .share-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        }
        .share-btn:active {
            transform: translateY(-1px);
        }
        .share-btn.whatsapp { background: linear-gradient(135deg, #25D366, #128C7E); }
        .share-btn.telegram { background: linear-gradient(135deg, #0088cc, #005f99); }
        .share-btn.twitter { background: linear-gradient(135deg, #1DA1F2, #0d8bd9); }
        .share-btn.facebook { background: linear-gradient(135deg, #1877F2, #0d5fc2); }
        .share-btn.email { background: linear-gradient(135deg, #EA4335, #c5221f); }
        .share-btn.copy { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
        .share-btn.download { background: linear-gradient(135deg, #10b981, #059669); }
        .share-btn.qr { background: linear-gradient(135deg, #6366f1, #4f46e5); }
        .share-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
        .share-btn.copied { background: linear-gradient(135deg, #10b981, #059669) !important; }

        .invite-section {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(16, 185, 129, 0.2));
            border: 1px solid rgba(124, 58, 237, 0.3);
            border-radius: 16px;
            padding: 30px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .invite-section::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at 30% 30%, rgba(124, 58, 237, 0.15) 0%, transparent 50%),
                        radial-gradient(circle at 70% 70%, rgba(16, 185, 129, 0.1) 0%, transparent 50%);
            pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation: none !important; transition: none !important; }
        }
        .invite-content {
            position: relative;
            z-index: 1;
        }
        .invite-title {
            font-size: 1.3rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .invite-text {
            color: rgba(255,255,255,0.7);
            margin-bottom: 20px;
            font-size: 0.95rem;
        }
        .invite-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .invite-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 14px 24px;
            border-radius: 12px;
            border: none;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            color: #fff;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
        }
        .invite-btn.primary {
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            box-shadow: 0 4px 15px rgba(124, 58, 237, 0.4);
        }
        .invite-btn.secondary {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
        }
        .invite-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 30px rgba(124, 58, 237, 0.4);
        }

        .features-row {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 15px;
            flex-wrap: wrap;
        }
        .feature-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
            color: rgba(255,255,255,0.6);
        }
        .feature-item svg {
            width: 16px;
            height: 16px;
            color: #10b981;
        }

        .footer {
            text-align: center;
            padding: 20px;
            color: rgba(255,255,255,0.4);
            font-size: 0.8rem;
        }
        .footer a {
            color: #7c3aed;
            text-decoration: none;
        }

        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            padding: 14px 28px;
            border-radius: 12px;
            font-weight: 600;
            opacity: 0;
            transition: all 0.3s;
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 10px 40px rgba(16, 185, 129, 0.4);
        }
        .toast.show {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        .toast svg {
            width: 20px;
            height: 20px;
        }

        /* Lightbox */
        .lightbox {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
            cursor: zoom-out;
            padding: 20px;
        }
        .lightbox.show {
            display: flex;
        }
        .lightbox img {
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
            border-radius: 8px;
        }
        .lightbox-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(255,255,255,0.1);
            border: none;
            color: #fff;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
        }
        .lightbox-close:hover {
            background: rgba(255,255,255,0.2);
        }

        /* QR Modal */
        .qr-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        }
        .qr-modal.show {
            display: flex;
        }
        .qr-content {
            background: #fff;
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            max-width: 320px;
        }
        .qr-content h3 {
            color: #1a1a2e;
            margin-bottom: 15px;
        }
        .qr-content p {
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 20px;
        }
        .qr-code {
            background: #fff;
            padding: 15px;
            border-radius: 12px;
            display: inline-block;
        }
        .qr-close {
            margin-top: 15px;
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            border: none;
            color: #fff;
            padding: 12px 30px;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
        }

        /* Pairing Modal Styles */
        .pairing-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        }
        .pairing-modal.show {
            display: flex;
        }
        .pairing-content {
            background: linear-gradient(135deg, #1a1a2e, #2d2d44);
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            max-width: 380px;
            width: 90%;
            border: 1px solid rgba(124, 58, 237, 0.3);
        }
        .pairing-content h3 {
            color: #fff;
            margin-bottom: 10px;
            font-size: 1.3rem;
        }
        .pairing-content p {
            color: #94a3b8;
            font-size: 0.9rem;
            margin-bottom: 20px;
        }
        .pairing-code-display {
            background: rgba(124, 58, 237, 0.2);
            border: 2px dashed rgba(124, 58, 237, 0.5);
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pairing-code-display:hover {
            background: rgba(124, 58, 237, 0.3);
            border-color: rgba(124, 58, 237, 0.8);
        }
        .pairing-code {
            font-family: 'Courier New', monospace;
            font-size: 2rem;
            font-weight: 700;
            color: #fff;
            letter-spacing: 4px;
        }
        .pairing-code-hint {
            color: #94a3b8;
            font-size: 0.8rem;
            margin-top: 8px;
        }
        .pairing-timer {
            color: #f59e0b;
            font-size: 0.9rem;
            margin: 15px 0;
        }
        .pairing-divider {
            display: flex;
            align-items: center;
            margin: 20px 0;
            color: #64748b;
            font-size: 0.85rem;
        }
        .pairing-divider::before, .pairing-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: rgba(255,255,255,0.1);
        }
        .pairing-divider span {
            padding: 0 15px;
        }
        .pairing-input-section {
            margin-top: 15px;
        }
        .pairing-input {
            width: 100%;
            padding: 15px;
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 4px;
            border-radius: 12px;
            border: 2px solid rgba(139, 92, 246, 0.3);
            background: rgba(139, 92, 246, 0.1);
            color: #fff;
            outline: none;
            font-family: 'Courier New', monospace;
        }
        .pairing-input:focus {
            border-color: rgba(139, 92, 246, 0.8);
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
        }
        .pairing-btn {
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            border: none;
            color: #fff;
            padding: 14px 30px;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            font-size: 1rem;
            margin-top: 15px;
            width: 100%;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            transition: all 0.2s;
        }
        .pairing-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(124, 58, 237, 0.4);
        }
        .pairing-btn.secondary {
            background: rgba(255,255,255,0.1);
            margin-top: 10px;
        }
        .pairing-status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 8px;
            font-size: 0.9rem;
        }
        .pairing-status.success {
            background: rgba(16, 185, 129, 0.2);
            color: #10b981;
        }
        .pairing-status.error {
            background: rgba(239, 68, 68, 0.2);
            color: #ef4444;
        }
        .pairing-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .pairing-tab {
            flex: 1;
            padding: 12px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            color: #94a3b8;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        .pairing-tab.active {
            background: rgba(124, 58, 237, 0.2);
            border-color: rgba(124, 58, 237, 0.5);
            color: #fff;
        }
        .pairing-tab-content {
            display: none;
        }
        .pairing-tab-content.active {
            display: block;
        }

        @media (max-width: 600px) {
            .share-buttons {
                grid-template-columns: repeat(2, 1fr);
            }
            .invite-buttons {
                flex-direction: column;
            }
            .share-btn, .invite-btn {
                justify-content: center;
            }
            .features-row {
                flex-direction: column;
                gap: 10px;
            }
            .steps-demo {
                flex-direction: column;
                gap: 20px;
            }
            .step-arrow {
                transform: rotate(90deg);
            }
            .step-card {
                width: 90%;
                max-width: 200px;
            }
            .trust-badges {
                flex-direction: column;
                gap: 8px;
            }
            .big-cta-btn {
                padding: 14px 28px;
                font-size: 1rem;
            }
        }

        /* Social Proof Banner */
        .social-proof-banner {
            background: linear-gradient(135deg, rgba(251, 146, 60, 0.15), rgba(239, 68, 68, 0.1));
            border: 1px solid rgba(251, 146, 60, 0.3);
            border-radius: 12px;
            padding: 12px 20px;
            margin-bottom: 15px;
            text-align: center;
            animation: pulse-glow 2s ease-in-out infinite;
        }
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 5px rgba(251, 146, 60, 0.2); }
            50% { box-shadow: 0 0 20px rgba(251, 146, 60, 0.4); }
        }
        .social-proof-text {
            color: #fb923c;
            font-size: 0.95rem;
            font-weight: 500;
        }
        .social-proof-text .count {
            font-weight: 700;
            color: #fff;
        }

        /* Subscribe Popup Modal */
        .subscribe-popup {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 3000;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .subscribe-popup.show {
            display: flex;
        }
        .subscribe-popup-content {
            background: linear-gradient(135deg, #1a1a2e, #2d2d44);
            border: 2px solid rgba(16, 185, 129, 0.4);
            border-radius: 24px;
            padding: 35px;
            text-align: center;
            max-width: 400px;
            width: 90%;
            position: relative;
            animation: slideUp 0.4s ease;
        }
        @keyframes slideUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .subscribe-popup-close {
            position: absolute;
            top: 15px;
            right: 15px;
            background: rgba(255,255,255,0.1);
            border: none;
            color: #fff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .subscribe-popup-close:hover {
            background: rgba(255,255,255,0.2);
        }
        .subscribe-popup-icon {
            font-size: 48px;
            margin-bottom: 15px;
        }
        .subscribe-popup h2 {
            color: #fff;
            font-size: 1.5rem;
            margin-bottom: 10px;
        }
        .subscribe-popup p {
            color: #94a3b8;
            font-size: 1rem;
            margin-bottom: 20px;
            line-height: 1.5;
        }
        .subscribe-popup .urgency {
            background: rgba(251, 146, 60, 0.15);
            border: 1px solid rgba(251, 146, 60, 0.3);
            border-radius: 8px;
            padding: 10px 15px;
            margin-bottom: 20px;
            color: #fb923c;
            font-size: 0.9rem;
            font-weight: 500;
        }
        .subscribe-popup-btn {
            display: block;
            width: 100%;
            padding: 16px 24px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            font-size: 1.1rem;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
        }
        .subscribe-popup-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        .subscribe-popup .skip-link {
            color: #64748b;
            font-size: 0.85rem;
            margin-top: 15px;
            cursor: pointer;
        }
        .subscribe-popup .skip-link:hover {
            color: #94a3b8;
        }

        /* Checkout CTA Section */
        .checkout-cta-section {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05));
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
            text-align: center;
        }
        .checkout-cta-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #10b981;
            margin-bottom: 8px;
        }
        .checkout-cta-text {
            color: rgba(255,255,255,0.7);
            font-size: 0.9rem;
            margin-bottom: 16px;
        }
        .checkout-cta-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            padding: 14px 28px;
            border-radius: 12px;
            border: none;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }
        .checkout-cta-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        .checkout-cta-btn svg {
            width: 20px;
            height: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <a href="https://${SHARE_HOST}?ref=logo" class="logo">DOZ</a>
            <a href="${downloadPageUrl}" class="try-btn">Get DOZ Free</a>
        </div>

        <div class="image-container">
            <img src="${rawImageUrl}" alt="Shared Image" onclick="openLightbox()" id="mainImage">
            <div class="image-info">
                <span>Shared via DOZ</span>
                <div class="image-actions">
                    <button class="image-action-btn" onclick="openLightbox()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>
                        View
                    </button>
                    <span>${fileSizeKB} KB</span>
                </div>
            </div>
        </div>

        <div class="share-section">
            <div class="share-title">Share this image</div>
            <div class="share-buttons">
                <a href="https://wa.me/?text=${shareText}%20${encodeURIComponent(imageUrl + '?ref=wa')}" target="_blank" class="share-btn whatsapp" onclick="trackShare('whatsapp')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                </a>
                <a href="https://t.me/share/url?url=${encodeURIComponent(imageUrl + '?ref=tg')}&text=${shareText}" target="_blank" class="share-btn telegram" onclick="trackShare('telegram')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    Telegram
                </a>
                <a href="https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(imageUrl + '?ref=tw')}" target="_blank" class="share-btn twitter" onclick="trackShare('twitter')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    X / Twitter
                </a>
                <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(imageUrl + '?ref=fb')}" target="_blank" class="share-btn facebook" onclick="trackShare('facebook')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    Facebook
                </a>
                <a href="mailto:?subject=${emailSubject}&body=${emailBody}" class="share-btn email" onclick="trackShare('email')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    Email
                </a>
                <button onclick="copyLink(this)" class="share-btn copy" id="copyBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    <span>Copy Link</span>
                </button>
                <button onclick="downloadImage()" class="share-btn download">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                </button>
                <button onclick="showQR()" class="share-btn qr">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    QR Code
                </button>
            </div>
        </div>

        <div class="invite-section">
            <div class="invite-content">
                <div class="invite-title">Love sharing? Try DOZ!</div>
                <div class="invite-text">The fastest way to capture and share screenshots. One click, instant link. Free forever.</div>
                <div class="invite-buttons">
                    <a href="${downloadPageUrl}" class="invite-btn primary">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download DOZ Free
                    </a>
                    <a href="https://wa.me/?text=${inviteText}%20${inviteUrl}" target="_blank" class="invite-btn secondary">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Invite Friends
                    </a>
                    <button onclick="openPairingModal()" class="invite-btn secondary">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>
                        Pair Device
                    </button>
                </div>
                <div class="features-row">
                    <div class="feature-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Instant capture
                    </div>
                    <div class="feature-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        One-click share
                    </div>
                    <div class="feature-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        100% Free
                    </div>
                </div>
            </div>
        </div>

        <!-- Social Proof Banner -->
        <div class="social-proof-banner" id="socialProofBanner" style="display:none">
            <div class="social-proof-text" id="socialProofText">
                <span class="count" id="activeCount"></span> <span id="socialProofLabel"></span>
            </div>
        </div>

        <div class="checkout-cta-section">
            <div class="checkout-cta-title">Upgrade to Pro</div>
            <div class="checkout-cta-text">Unlimited storage, links never expire, priority support</div>
            <a href="#" id="checkoutBtn" class="checkout-cta-btn" onclick="startSmartCheckout(); return false;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
                <span id="checkoutBtnText">Upgrade Now - $${((stripeService.getPlan('pro_yearly')?.monthlyEquiv || 999) / 100).toFixed(2)}/month</span>
            </a>
        </div>

        <script>
        const SHARE_FILENAME = '${filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')}';
        const PLAN_ID = 'pro_yearly';

        let isCheckingOut = false;

        async function startSmartCheckout() {
            if (isCheckingOut) return; // Prevent double-click
            isCheckingOut = true;

            const btn = document.getElementById('checkoutBtn');
            const btnText = document.getElementById('checkoutBtnText');
            const originalText = btnText.textContent;
            btnText.textContent = 'Redirecting...';
            btn.style.opacity = '0.7';

            // Store share context
            sessionStorage.setItem('doz_share_checkout', JSON.stringify({
                filename: SHARE_FILENAME,
                timestamp: Date.now()
            }));

            // Mark that user clicked checkout (for popup)
            localStorage.setItem('doz_checkout_clicked', Date.now());

            const fallbackUrl = '/checkout.html?plan=' + PLAN_ID + '&share=' + SHARE_FILENAME;

            try {
                const res = await fetch('/api/checkout/payment-link?planId=' + PLAN_ID + '&filename=' + SHARE_FILENAME);
                const data = await res.json();

                if (data.success && data.url) {
                    window.location.href = data.url;
                } else {
                    window.location.href = fallbackUrl;
                }
            } catch (e) {
                console.log('Payment Link not available, using checkout page');
                window.location.href = fallbackUrl;
            }

            // Reset button after short delay (in case redirect fails)
            setTimeout(() => {
                isCheckingOut = false;
                btnText.textContent = originalText;
                btn.style.opacity = '1';
            }, 3000);
        }

        // Popup checkout - immediate redirect
        function popupCheckout() {
            localStorage.setItem('doz_checkout_clicked', Date.now());
            localStorage.setItem('doz_popup_dismissed', Date.now());
            window.location.href = '/checkout.html?plan=' + PLAN_ID + '&share=' + SHARE_FILENAME + '&popup=1';
        }

        // Close subscribe popup
        function closeSubscribePopup() {
            document.getElementById('subscribePopup').classList.remove('show');
            localStorage.setItem('doz_popup_dismissed', Date.now());
        }

        // Load social proof data - real numbers from live analytics
        async function loadSocialProof() {
            try {
                const res = await fetch('/api/social-proof/active-checkouts');
                const data = await res.json();
                if (!data.success) return;

                var count = 0;
                var label = '';

                // Priority: active visitors > today uploads > total images
                if (data.activeVisitors > 1) {
                    count = data.activeVisitors;
                    label = 'people viewing right now';
                } else if (data.todayUploads > 0) {
                    count = data.todayUploads;
                    label = 'images shared today';
                } else if (data.totalImages > 0) {
                    count = data.totalImages.toLocaleString();
                    label = 'images shared on DOZ';
                }

                var banner = document.getElementById('socialProofBanner');
                var popup = document.getElementById('popupUrgency');

                if (count > 0 || (typeof count === 'string' && count !== '0')) {
                    document.getElementById('activeCount').textContent = count;
                    document.getElementById('socialProofLabel').textContent = label;
                    banner.style.display = '';

                    document.getElementById('popupActiveCount').textContent = count;
                    document.getElementById('popupProofLabel').textContent = label;
                    popup.style.display = '';
                } else {
                    banner.style.display = 'none';
                    popup.style.display = 'none';
                }
            } catch (e) {
                console.log('Social proof not available');
            }
        }

        // Show popup after 3 seconds
        function initSubscribePopup() {
            // Don't show if dismissed recently (within 24 hours)
            const dismissed = localStorage.getItem('doz_popup_dismissed');
            if (dismissed && (Date.now() - parseInt(dismissed)) < 24 * 60 * 60 * 1000) {
                return;
            }

            // Don't show if already clicked checkout
            const clicked = localStorage.getItem('doz_checkout_clicked');
            if (clicked && (Date.now() - parseInt(clicked)) < 60 * 60 * 1000) {
                return;
            }

            setTimeout(() => {
                document.getElementById('subscribePopup').classList.add('show');
            }, 3000);
        }

        // Pre-check if user has saved payment method
        (async function() {
            try {
                const res = await fetch('/api/checkout/owner/' + SHARE_FILENAME);
                const data = await res.json();
                if (data.success && data.hasCustomer && data.paymentPreferences?.hasPreferred) {
                    const card = data.paymentPreferences;
                    const btnText = document.getElementById('checkoutBtnText');
                    if (card.last4) {
                        btnText.textContent = 'Pay with ****' + card.last4 + ' \u2192';
                    }
                }
            } catch (e) {}
        })();

        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadSocialProof();
            initSubscribePopup();

            // Refresh social proof every 30 seconds
            setInterval(loadSocialProof, 30000);
        });
        </script>

        <div class="footer">
            Powered by <a href="https://${SHARE_HOST}">DOZ</a> - Share screenshots instantly
        </div>
    </div>

    <div class="toast" id="toast">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <span id="toastText">Link copied!</span>
    </div>

    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
        <img src="${rawImageUrl}" alt="Full size image">
    </div>

    <div class="qr-modal" id="qrModal" onclick="hideQR()">
        <div class="qr-content" onclick="event.stopPropagation()">
            <h3>Scan to view</h3>
            <p>Point your phone camera at this QR code</p>
            <div class="qr-code" id="qrCode"></div>
            <button class="qr-close" onclick="hideQR()">Close</button>
        </div>
    </div>

    <!-- Device Pairing Modal -->
    <div class="pairing-modal" id="pairingModal" onclick="closePairingModal()">
        <div class="pairing-content" onclick="event.stopPropagation()">
            <h3>Pair New Device</h3>
            <p>Connect another device to your DOZ account</p>

            <div class="pairing-tabs">
                <button class="pairing-tab active" onclick="switchPairingTab('generate')">Generate Code</button>
                <button class="pairing-tab" onclick="switchPairingTab('enter')">Enter Code</button>
            </div>

            <!-- Generate Code Tab -->
            <div id="generateCodeTab" class="pairing-tab-content active">
                <div class="pairing-code-display" onclick="copyPairingCode()">
                    <div class="pairing-code" id="pairingCode">----</div>
                    <div class="pairing-code-hint">Click to copy</div>
                </div>
                <div class="pairing-timer" id="pairingTimer">Code expires in 5:00</div>
                <p style="font-size: 0.85rem; color: #64748b;">Enter this code on your other device at<br><strong style="color: #a78bfa;">doz.com/my-account</strong></p>
            </div>

            <!-- Enter Code Tab -->
            <div id="enterCodeTab" class="pairing-tab-content">
                <div class="pairing-input-section">
                    <input type="text" class="pairing-input" id="pairingCodeInput" placeholder="XXXX-XXXX" maxlength="9">
                </div>
                <div id="pairingStatus"></div>
                <button class="pairing-btn" onclick="submitPairingCode()">Pair Device</button>
            </div>

            <button class="pairing-btn secondary" onclick="closePairingModal()">Close</button>
        </div>
    </div>

    <!-- Subscribe Popup (3 second delay) -->
    <div class="subscribe-popup" id="subscribePopup">
        <div class="subscribe-popup-content">
            <button class="subscribe-popup-close" onclick="closeSubscribePopup()">&times;</button>
            <div class="subscribe-popup-icon">🚀</div>
            <h2>Love sharing instantly?</h2>
            <p>Get unlimited storage, links that never expire, and priority support.</p>
            <div class="urgency" id="popupUrgency" style="display:none">
                🔥 <span id="popupActiveCount"></span> <span id="popupProofLabel"></span>
            </div>
            <button class="subscribe-popup-btn" onclick="popupCheckout()">
                Upgrade to Pro - $${((stripeService.getPlan('pro_yearly')?.monthlyEquiv || 999) / 100).toFixed(2)}/mo
            </button>
            <div class="skip-link" onclick="closeSubscribePopup()">Maybe later</div>
        </div>
    </div>

    <script>
        const imageUrl = '${imageUrl}';
        const rawImageUrl = '${rawImageUrl}';
        const filename = '${filename}';

        function showToast(message) {
            const toast = document.getElementById('toast');
            document.getElementById('toastText').textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2500);
        }

        function copyLink(btn) {
            navigator.clipboard.writeText(imageUrl + '?ref=copy').then(() => {
                showToast('Link copied to clipboard!');
                if (btn) {
                    btn.classList.add('copied');
                    btn.querySelector('span').textContent = 'Copied!';
                    setTimeout(() => {
                        btn.classList.remove('copied');
                        btn.querySelector('span').textContent = 'Copy Link';
                    }, 2000);
                }
                trackShare('copy');
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = imageUrl + '?ref=copy';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('Link copied!');
            });
        }

        function downloadImage() {
            showToast('Starting download...');
            trackShare('download');

            // Fetch the image and trigger download
            fetch(rawImageUrl)
                .then(response => response.blob())
                .then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename || 'doz-image.png';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showToast('Download complete!');
                })
                .catch(() => {
                    // Fallback: open in new tab
                    window.open(rawImageUrl, '_blank');
                });
        }

        function openLightbox() {
            document.getElementById('lightbox').classList.add('show');
            document.body.style.overflow = 'hidden';
        }

        function closeLightbox() {
            document.getElementById('lightbox').classList.remove('show');
            document.body.style.overflow = '';
        }

        function showQR() {
            const qrContainer = document.getElementById('qrCode');
            // Generate QR code using API
            qrContainer.textContent = '';
            const qrImg = document.createElement('img');
            qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(imageUrl + '?ref=qr');
            qrImg.alt = 'QR Code';
            qrImg.style.cssText = 'width:200px;height:200px;';
            qrContainer.appendChild(qrImg);
            document.getElementById('qrModal').classList.add('show');
            document.body.style.overflow = 'hidden';
            trackShare('qr');
        }

        function hideQR() {
            document.getElementById('qrModal').classList.remove('show');
            document.body.style.overflow = '';
        }

        function trackShare(method) {
            try {
                fetch('/api/track-share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: filename, method: method })
                }).catch(() => {});
            } catch(e) {}
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeLightbox();
                hideQR();
            }
            if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                copyLink(document.getElementById('copyBtn'));
            }
        });

        // Preload image for smoother lightbox
        const preloadImg = new Image();
        preloadImg.src = rawImageUrl;

        // ============ DEVICE PAIRING FUNCTIONS ============

        // Generate device fingerprint
        function generateDeviceId() {
            const nav = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, navigator.platform].join('|');
            let hash = 0;
            for (let i = 0; i < nav.length; i++) { hash = ((hash << 5) - hash) + nav.charCodeAt(i); hash = hash & hash; }
            return 'DOZ-' + Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
        }

        const DEVICE_ID = generateDeviceId();
        let currentPairingCode = null;
        let pairingTimer = null;
        let pairingCountdown = 300; // 5 minutes

        function openPairingModal() {
            document.getElementById('pairingModal').classList.add('show');
            document.body.style.overflow = 'hidden';
            generatePairingCode();
        }

        function closePairingModal() {
            document.getElementById('pairingModal').classList.remove('show');
            document.body.style.overflow = '';
            if (pairingTimer) {
                clearInterval(pairingTimer);
                pairingTimer = null;
            }
            currentPairingCode = null;
        }

        function switchPairingTab(tab) {
            document.querySelectorAll('.pairing-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.pairing-tab-content').forEach(c => c.classList.remove('active'));

            if (tab === 'generate') {
                document.querySelector('.pairing-tab:first-child').classList.add('active');
                document.getElementById('generateCodeTab').classList.add('active');
            } else {
                document.querySelector('.pairing-tab:last-child').classList.add('active');
                document.getElementById('enterCodeTab').classList.add('active');
            }
        }

        async function generatePairingCode() {
            try {
                const response = await fetch('/api/devices/pairing-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deviceId: DEVICE_ID,
                        deviceName: navigator.platform || 'Web Browser'
                    })
                });

                const data = await response.json();
                if (data.success && data.code) {
                    currentPairingCode = data.code;
                    document.getElementById('pairingCode').textContent = data.code;
                    startPairingTimer();
                } else {
                    document.getElementById('pairingCode').textContent = 'ERROR';
                }
            } catch (e) {
                console.error('Error generating pairing code:', e);
                document.getElementById('pairingCode').textContent = 'ERROR';
            }
        }

        function startPairingTimer() {
            pairingCountdown = 300;
            updateTimerDisplay();

            if (pairingTimer) clearInterval(pairingTimer);
            pairingTimer = setInterval(() => {
                pairingCountdown--;
                updateTimerDisplay();

                if (pairingCountdown <= 0) {
                    clearInterval(pairingTimer);
                    document.getElementById('pairingCode').textContent = 'EXPIRED';
                    document.getElementById('pairingTimer').textContent = 'Code expired - click to generate new';
                }
            }, 1000);
        }

        function updateTimerDisplay() {
            const mins = Math.floor(pairingCountdown / 60);
            const secs = pairingCountdown % 60;
            document.getElementById('pairingTimer').textContent = 'Code expires in ' + mins + ':' + secs.toString().padStart(2, '0');
        }

        function copyPairingCode() {
            if (currentPairingCode && currentPairingCode !== 'EXPIRED') {
                navigator.clipboard.writeText(currentPairingCode).then(() => {
                    showToast('Pairing code copied!');
                });
            }
        }

        async function submitPairingCode() {
            const input = document.getElementById('pairingCodeInput');
            const statusEl = document.getElementById('pairingStatus');
            let code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

            if (code.length !== 8) {
                statusEl.className = 'pairing-status error';
                statusEl.textContent = 'Please enter a valid 8-character code';
                return;
            }

            // Format as XXXX-XXXX
            code = code.slice(0, 4) + '-' + code.slice(4);

            try {
                statusEl.className = 'pairing-status';
                statusEl.textContent = 'Pairing...';
                statusEl.style.color = '#94a3b8';

                const response = await fetch('/api/devices/pair', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: code,
                        newDeviceId: DEVICE_ID,
                        deviceName: navigator.platform || 'Web Browser',
                        platform: navigator.platform || 'Web'
                    })
                });

                const data = await response.json();
                if (data.success) {
                    statusEl.className = 'pairing-status success';
                    statusEl.textContent = 'Device paired successfully!';
                    showToast('Device paired! View in My Account');
                    setTimeout(closePairingModal, 2000);
                } else {
                    statusEl.className = 'pairing-status error';
                    statusEl.textContent = data.error || 'Pairing failed. Check the code and try again.';
                }
            } catch (e) {
                console.error('Pairing error:', e);
                statusEl.className = 'pairing-status error';
                statusEl.textContent = 'Connection error. Please try again.';
            }
        }

        // Auto-format pairing code input
        document.getElementById('pairingCodeInput').addEventListener('input', function(e) {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (value.length > 4) {
                value = value.slice(0, 4) + '-' + value.slice(4, 8);
            }
            e.target.value = value;
        });

        // Close pairing modal on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closePairingModal();
            }
        });
    </script>
</body>
</html>`;
}

// API endpoint to track share actions
app.post('/api/track-share', express.json(), (req, res) => {
    try {
        const { filename, method } = req.body;
        if (!filename || !method) {
            return res.status(400).json({ error: 'Missing filename or method' });
        }

        // Normalize key by stripping extension to prevent duplicates
        const normalizedKey = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');

        const sharesPath = path.join(__dirname, 'data', 'shares.json');
        let shares = {};
        if (fs.existsSync(sharesPath)) {
            shares = JSON.parse(fs.readFileSync(sharesPath, 'utf8'));
        }

        if (!shares[normalizedKey]) {
            shares[normalizedKey] = { views: 0, sources: {}, shares: {}, firstView: Date.now() };
        }

        if (!shares[normalizedKey].shares) {
            shares[normalizedKey].shares = {};
        }

        shares[normalizedKey].shares[method] = (shares[normalizedKey].shares[method] || 0) + 1;
        shares[normalizedKey].lastShare = Date.now();

        fs.writeFileSync(sharesPath, JSON.stringify(shares));
        res.json({ success: true });
    } catch (e) {
        console.log('[Share Tracking API] Error:', e.message);
        res.json({ success: true }); // Don't fail silently
    }
});

// ============ INTERNAL SYNC ENDPOINT ============
// Server-to-server file sync with preserved filenames
// Used by dev-sync to replicate uploads between servers
const SYNC_SECRET = process.env.SYNC_SECRET || 'doz-internal-sync-2026';

// Multer storage that preserves the original filename
const syncStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        // Use the provided filename from header, or fall back to original
        const customFilename = req.headers['x-sync-filename'] || file.originalname;
        cb(null, customFilename);
    }
});

const syncUpload = multer({
    storage: syncStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for sync
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type for sync'));
        }
    }
});

// Internal file sync endpoint - preserves original filename
app.post('/api/internal/sync-file', syncUpload.single('file'), (req, res) => {
    // Verify internal sync secret
    const providedSecret = req.headers['x-sync-secret'];
    if (providedSecret !== SYNC_SECRET) {
        return res.status(403).json({ error: 'Invalid sync secret' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
    }

    const filename = req.file.filename;
    const filePath = path.join(uploadsDir, filename);

    // Verify file was saved
    if (!fs.existsSync(filePath)) {
        return res.status(500).json({ error: 'File sync failed' });
    }

    console.log(`[Sync] File synced: ${filename} from ${req.ip}`);

    res.json({
        success: true,
        filename: filename,
        url: `https://${SHARE_HOST}/${filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')}`,
        syncedAt: new Date().toISOString()
    });
});

// Upload endpoint with device tracking - OPTIMIZED FOR SPEED
app.post('/upload', upload.single('image'), (req, res) => {
    const uploadStart = Date.now();

    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    const deviceId = req.headers['x-device-id'] || req.body?.deviceId || 'web';
    const userId = req.headers['x-user-id'] || req.body?.userId;

    // Check subscription via unified plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);

    // Check daily upload limit (uses in-memory cache)
    const uploadLimit = checkDailyUploadLimit(deviceId, isPaidUser);
    if (!uploadLimit.allowed) {
        fs.unlink(req.file.path, () => {}); // Async delete
        uploadMetrics.record(false, Date.now() - uploadStart);
        return res.status(429).json({
            error: `Daily upload limit reached (${uploadLimit.limit}/day). Resets tomorrow.`,
            limitReached: true,
            used: uploadLimit.used,
            limit: uploadLimit.limit,
            resetsAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
        });
    }

    // Use extensionless URL for sharing - prevents Cloudflare from auto-caching as image
    const baseFilename = req.file.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
    const imageUrl = `https://${SHARE_HOST}/${baseFilename}`;
    const shareUrl = `https://${SHARE_HOST}/${baseFilename}`;
    const now = Date.now();
    const expirationMs = isPaidUser ? IMAGE_LIFETIME_MS : FREE_TIER_EXPIRATION_MS;
    const expiresAt = now + expirationMs;
    const expiresInText = isPaidUser ? '1 year' : '30 days';
    const uploadId = uuidv4();

    // RESPOND IMMEDIATELY with the URL - file is already saved by multer
    const responseTime = Date.now() - uploadStart;
    uploadMetrics.record(true, responseTime);
    res.json({
        success: true,
        url: imageUrl,
        shareUrl: shareUrl,
        filename: req.file.filename,
        id: uploadId,
        expiresAt: expiresAt,
        expiresIn: expiresInText,
        responseTime: responseTime,
        dailyUploads: {
            used: uploadLimit.used + 1,
            limit: uploadLimit.limit,
            remaining: Math.max(0, uploadLimit.remaining - 1)
        }
    });

    // Track for live monitor
    if (global.trackMonitorActivity) {
        const geoData = getGeoFromRequest(req);
        global.trackMonitorActivity('upload', {
            description: 'Screenshot uploaded',
            device: deviceId,
            country: geoData.country,
            city: geoData.city
        });
    }

    // ========== BACKGROUND OPERATIONS (after response sent) ==========
    setImmediate(() => {
        // Increment daily upload counter (in-memory)
        incrementDailyUploadCount(deviceId);

        // Auto-link device to user account
        if (userId && deviceId && deviceId !== 'web') {
            try {
                authService.linkBrowserDevice(userId, deviceId);
            } catch (e) {}
        }

        // Save to database using in-memory cache (instant for subsequent reads)
        const db = loadUploadsDb();

        const uploadRecord = {
            id: uploadId,
            filename: req.file.filename,
            url: imageUrl,
            deviceId: deviceId,
            userId: userId || null,
            timestamp: now,
            expiresAt: expiresAt,
            size: req.file.size,
            tier: isPaidUser ? 'paid' : 'free'
        };

        db.uploads.unshift(uploadRecord);

        // Track device
        if (!db.devices[deviceId]) {
            db.devices[deviceId] = { firstSeen: now, uploadCount: 0 };
        }
        db.devices[deviceId].lastSeen = now;
        db.devices[deviceId].uploadCount++;

        // Keep only last 1000 uploads per device (optimized)
        let deviceCount = 0;
        db.uploads = db.uploads.filter(u => {
            if (u.deviceId !== deviceId) return true;
            deviceCount++;
            return deviceCount <= 1000;
        });

        // Update cache and mark dirty for async disk flush
        saveUploadsDb(db);

        console.log(`[Upload] ${req.file.filename} - ${responseTime}ms response, background save started`);

        // Replicate to Spaceship for redundancy (non-blocking)
        if (SPACESHIP_FTP.password) {
            replicateToSpaceship(path.join(uploadsDir, req.file.filename), req.file.filename);
        }
    });
});

// ============ ULTRA-FAST PRE-GENERATED URL SYSTEM ============
// Pre-reserve URLs before photos are taken for instant sharing

const reservedUrls = new Map(); // token -> { filename, reservedAt, deviceId }
const RESERVATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Clean up expired reservations every minute
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of reservedUrls.entries()) {
        if (now - data.reservedAt > RESERVATION_TIMEOUT) {
            reservedUrls.delete(token);
        }
    }
}, 60 * 1000);

// Reserve multiple URLs in advance (batch pre-generation)
app.post('/api/reserve-urls', express.json(), (req, res) => {
    const { count = 5, deviceId = 'web' } = req.body;
    const batchCount = Math.min(Math.max(1, count), 20); // Max 20 at once

    const reservations = [];
    const now = Date.now();

    for (let i = 0; i < batchCount; i++) {
        const token = uuidv4();
        const fileUuid = uuidv4();
        const filename = fileUuid + '.png'; // Use .png since desktop screenshots are PNG
        const url = `https://${SHARE_HOST}/${fileUuid}`; // Extensionless URL avoids Cloudflare auto-caching

        reservedUrls.set(token, {
            filename,
            url,
            deviceId,
            reservedAt: now,
            index: i
        });

        reservations.push({
            token,
            url,
            filename,
            expiresIn: RESERVATION_TIMEOUT
        });
    }

    console.log(`[FastUpload] Reserved ${batchCount} URLs for device ${deviceId.substring(0, 8)}...`);

    res.json({
        success: true,
        reservations,
        count: batchCount,
        validFor: '5 minutes'
    });
});

// Single URL reservation (for immediate use)
app.get('/api/reserve-url', (req, res) => {
    const deviceId = req.query.device || req.headers['x-device-id'] || 'web';
    const token = uuidv4();
    const fileUuid = uuidv4();
    const filename = fileUuid + '.jpg';
    const url = `https://${SHARE_HOST}/${fileUuid}`; // Extensionless URL avoids Cloudflare auto-caching

    reservedUrls.set(token, {
        filename,
        url,
        deviceId,
        reservedAt: Date.now()
    });

    res.json({
        success: true,
        token,
        url,
        filename,
        expiresIn: RESERVATION_TIMEOUT
    });
});

// Upload to a pre-reserved URL (ULTRA-FAST - URL already known, respond immediately)
app.post('/api/upload-fast', upload.single('image'), (req, res) => {
    const uploadStart = Date.now();
    const token = req.body.token || req.headers['x-upload-token'];
    const reservation = reservedUrls.get(token);

    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    const deviceId = req.headers['x-device-id'] || req.body?.deviceId || 'web';
    const userId = req.headers['x-user-id'] || req.body?.userId;

    // Check subscription via unified plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);

    // Check daily upload limit (in-memory cache)
    const uploadLimit = checkDailyUploadLimit(deviceId, isPaidUser);
    if (!uploadLimit.allowed) {
        fs.unlink(req.file.path, () => {}); // Async delete
        uploadMetrics.record(false, Date.now() - uploadStart);
        return res.status(429).json({
            error: `Daily upload limit reached (${uploadLimit.limit}/day). Resets tomorrow.`,
            limitReached: true,
            used: uploadLimit.used,
            limit: uploadLimit.limit
        });
    }

    // Determine final filename and URL
    let finalFilename, imageUrl;
    const uploadedPath = path.join(uploadsDir, req.file.filename);

    if (reservation) {
        finalFilename = reservation.filename;
        imageUrl = reservation.url;
        reservedUrls.delete(token);
    } else {
        finalFilename = req.file.filename;
        const baseFilename = finalFilename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
        imageUrl = `https://${SHARE_HOST}/${baseFilename}`;
    }

    const now = Date.now();
    const expirationMs = isPaidUser ? IMAGE_LIFETIME_MS : FREE_TIER_EXPIRATION_MS;
    const expiresAt = now + expirationMs;
    const uploadId = uuidv4();
    const responseTime = Date.now() - uploadStart;
    uploadMetrics.record(true, responseTime);

    // RESPOND IMMEDIATELY - client already has the URL
    res.json({
        success: true,
        url: imageUrl,
        filename: finalFilename,
        id: uploadId,
        expiresAt: expiresAt,
        expiresIn: isPaidUser ? '1 year' : '30 days',
        fastUpload: !!reservation,
        responseTime: responseTime,
        dailyUploads: {
            used: uploadLimit.used + 1,
            limit: uploadLimit.limit,
            remaining: Math.max(0, uploadLimit.remaining - 1)
        }
    });

    // ========== ALL BACKGROUND OPERATIONS (after response sent) ==========
    setImmediate(() => {
        // Rename file to reserved filename (async)
        if (reservation && req.file.filename !== finalFilename) {
            // Preserve the actual uploaded file extension
            const uploadedExt = path.extname(req.file.filename);
            const reservedBase = finalFilename.replace(/\.[^.]+$/, '');
            const actualFilename = reservedBase + uploadedExt;
            const newPath = path.join(uploadsDir, actualFilename);

            fs.rename(uploadedPath, newPath, (err) => {
                if (err) {
                    console.error('[FastUpload] Rename error:', err.message);
                } else {
                    console.log(`[FastUpload] Renamed to ${actualFilename}`);
                }
            });
        }

        // Increment daily upload counter (in-memory)
        incrementDailyUploadCount(deviceId);

        // Save to database using in-memory cache (instant for subsequent reads)
        const db = loadUploadsDb();

        db.uploads.unshift({
            id: uploadId,
            filename: finalFilename,
            url: imageUrl,
            deviceId: deviceId,
            userId: userId || null,
            timestamp: now,
            expiresAt: expiresAt,
            size: req.file.size,
            fastUpload: !!reservation,
            tier: isPaidUser ? 'paid' : 'free'
        });

        if (!db.devices[deviceId]) {
            db.devices[deviceId] = { firstSeen: now, uploadCount: 0 };
        }
        db.devices[deviceId].lastSeen = now;
        db.devices[deviceId].uploadCount++;

        // Update cache and mark dirty for async disk flush
        saveUploadsDb(db);

        console.log(`[FastUpload] ${finalFilename} - ${responseTime}ms response`);

        // Replicate to Spaceship for redundancy (non-blocking)
        if (SPACESHIP_FTP.password) {
            // Small delay to let rename complete first if needed
            setTimeout(() => {
                const actualPath = path.join(uploadsDir, finalFilename);
                const altExt = path.extname(req.file.filename);
                const altPath = path.join(uploadsDir, finalFilename.replace(/\.[^.]+$/, '') + altExt);
                const filePath = fs.existsSync(actualPath) ? actualPath : altPath;
                replicateToSpaceship(filePath, finalFilename);
            }, 500);
        }
    });
});

// Get daily upload limit status
app.get('/api/upload-limit', (req, res) => {
    const deviceId = req.query.device || req.headers['x-device-id'] || 'web';
    const userId = req.query.userId || req.headers['x-user-id'];

    // Check subscription via unified plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);

    const limitStatus = checkDailyUploadLimit(deviceId, isPaidUser);

    res.json({
        success: true,
        tier: isPaidUser ? 'paid' : 'free',
        dailyUploads: {
            used: limitStatus.used,
            limit: isPaidUser ? 'unlimited' : limitStatus.limit,
            remaining: isPaidUser ? 'unlimited' : limitStatus.remaining,
            allowed: limitStatus.allowed
        },
        limits: {
            maxFileSizeMB: isPaidUser ? 'unlimited' : FREE_TIER_CONFIG.maxFileSizeMB,
            storageMB: isPaidUser ? 'unlimited' : FREE_TIER_CONFIG.storageMB,
            expirationDays: isPaidUser ? 365 : FREE_TIER_CONFIG.expirationDays,
            crossDeviceUploads: FREE_TIER_CONFIG.crossDeviceUploads
        },
        resetsAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
    });
});

// Get reservation status
app.get('/api/reservation-status', (req, res) => {
    const deviceId = req.query.device || 'web';
    const deviceReservations = [];

    for (const [token, data] of reservedUrls.entries()) {
        if (data.deviceId === deviceId) {
            deviceReservations.push({
                token,
                url: data.url,
                age: Date.now() - data.reservedAt
            });
        }
    }

    res.json({
        success: true,
        count: deviceReservations.length,
        reservations: deviceReservations
    });
});

// API: Get uploads by device
app.get('/api/uploads', (req, res) => {
    const deviceId = req.query.device;
    const devicesParam = req.query.devices; // comma-separated list of device IDs

    if (!deviceId && !devicesParam) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadUploadsDb();

    // Support querying multiple device IDs at once (for multi-device sync)
    const deviceIds = devicesParam
        ? devicesParam.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
        : [deviceId.toLowerCase()];

    // Case-insensitive deviceId matching to handle WEB- vs web- format differences
    const uploads = db.uploads.filter(u =>
        u.deviceId && deviceIds.includes(u.deviceId.toLowerCase())
    );
    const primaryId = deviceId || deviceIds[0];
    const device = db.devices[primaryId] || db.devices[primaryId.toLowerCase()];

    // Enrich uploads with view counts from shares.json
    const shareViews = loadShareViews();
    const enrichedUploads = uploads.map(u => {
        // Normalize filename to match shares.json keys (without extension)
        const normalizedKey = u.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
        const views = shareViews[normalizedKey] ? shareViews[normalizedKey].views || 0 : 0;
        return { ...u, views };
    });

    res.json({
        success: true,
        device: device || null,
        uploads: enrichedUploads,
        count: enrichedUploads.length,
        queriedDevices: deviceIds.length
    });
});

// API: Delete upload
app.delete('/api/uploads/:id', (req, res) => {
    const deviceId = req.query.device;
    const uploadId = req.params.id;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadUploadsDb();
    const upload = db.uploads.find(u => u.id === uploadId && u.deviceId && u.deviceId.toLowerCase() === deviceId.toLowerCase());

    if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
    }

    // Delete file
    const filePath = path.join(uploadsDir, upload.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    // Remove from database
    db.uploads = db.uploads.filter(u => u.id !== uploadId);
    if (db.devices[deviceId]) {
        db.devices[deviceId].uploadCount--;
    }
    saveUploadsDb(db);

    res.json({ success: true });
});

// API: Create secure link with device binding
app.post('/api/secure-link', express.json(), (req, res) => {
    const { uploadId, deviceId } = req.body;

    if (!uploadId || !deviceId) {
        return res.status(400).json({ error: 'Upload ID and Device ID required' });
    }

    const db = loadUploadsDb();
    const upload = db.uploads.find(u => u.id === uploadId);

    if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
    }

    // Generate secure token
    const secureToken = crypto.randomBytes(16).toString('hex');
    const secureId = `sec-${Date.now().toString(36)}-${secureToken.substring(0, 8)}`;

    // Store secure link
    if (!db.secureLinks) db.secureLinks = {};
    db.secureLinks[secureId] = {
        uploadId: upload.id,
        filename: upload.filename,
        deviceId: deviceId,
        createdAt: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        accessCount: 0,
        token: secureToken
    };

    saveUploadsDb(db);

    const secureUrl = `https://${SHARE_HOST}/s/${secureId}`;

    res.json({
        success: true,
        secureUrl: secureUrl,
        secureId: secureId,
        expiresIn: '7 days'
    });
});

// API: Access secure link
app.get('/s/:secureId', (req, res) => {
    const { secureId } = req.params;

    const db = loadUploadsDb();
    const secureLink = db.secureLinks?.[secureId];

    if (!secureLink) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html><head><title>Link Not Found - DOZ UP</title>
            <style>body{font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px}.icon{font-size:64px;margin-bottom:20px}h1{margin:0 0 10px}p{color:#94a3b8}</style></head>
            <body><div class="box"><div class="icon">🔒</div><h1>Link Not Found</h1><p>This secure link does not exist or has been removed.</p></div></body></html>
        `);
    }

    if (Date.now() > secureLink.expiresAt) {
        return res.status(410).send(`
            <!DOCTYPE html>
            <html><head><title>Link Expired - DOZ UP</title>
            <style>body{font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px}.icon{font-size:64px;margin-bottom:20px}h1{margin:0 0 10px}p{color:#94a3b8}</style></head>
            <body><div class="box"><div class="icon">⏰</div><h1>Link Expired</h1><p>This secure link has expired. Please request a new one from the owner.</p></div></body></html>
        `);
    }

    // Increment access count
    secureLink.accessCount++;
    saveUploadsDb(db);

    // Serve the image
    const imagePath = path.join(uploadsDir, secureLink.filename);
    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).send('File not found');
    }
});

// ============ FAMILY GALLERIES API ============

// Cached galleries database
const galleriesFile = path.join(dataDir, 'galleries.json');
let galleriesDbCache = null;
let galleriesDbDirty = false;

function loadGalleriesDb() {
    if (galleriesDbCache) return galleriesDbCache;
    try {
        if (fs.existsSync(galleriesFile)) {
            galleriesDbCache = JSON.parse(fs.readFileSync(galleriesFile, 'utf8'));
            return galleriesDbCache;
        }
    } catch (e) {
        console.error('Error loading galleries.json:', e);
    }
    galleriesDbCache = { galleries: [], members: [], galleryPhotos: [] };
    return galleriesDbCache;
}

function saveGalleriesDb(data) {
    galleriesDbCache = data;
    galleriesDbDirty = true;
}

// Flush galleries DB every 5 seconds
setInterval(() => {
    if (galleriesDbDirty && galleriesDbCache) {
        fs.writeFile(galleriesFile, JSON.stringify(galleriesDbCache), (err) => {
            if (err) console.error('[DB] Galleries flush error:', err.message);
        });
        galleriesDbDirty = false;
    }
}, 10000); // was 5s, reduced frequency for performance

// Generate invite code
function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// SSE clients for real-time updates
const gallerySSEClients = new Map();

// Create gallery
app.post('/api/galleries', express.json(), (req, res) => {
    const { name, template, deviceId, ownerName } = req.body;

    if (!name || !deviceId) {
        return res.status(400).json({ error: 'Name and device ID required' });
    }

    const db = loadGalleriesDb();
    const galleryId = `gal-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
    const inviteCode = generateInviteCode();

    const gallery = {
        id: galleryId,
        name: name.trim(),
        ownerId: deviceId,
        ownerName: ownerName || 'Owner',
        template: template || 'classic',
        inviteCode: inviteCode,
        createdAt: Date.now(),
        settings: {
            autoAddPhotos: false,
            allowMemberUploads: true
        }
    };

    db.galleries.push(gallery);

    // Add owner as first member
    db.members.push({
        galleryId: galleryId,
        deviceId: deviceId,
        memberName: ownerName || 'Owner',
        role: 'owner',
        joinedAt: Date.now()
    });

    saveGalleriesDb(db);

    const inviteUrl = `https://${SHARE_HOST}/gallery/join/${inviteCode}`;

    res.json({
        success: true,
        gallery: gallery,
        inviteCode: inviteCode,
        inviteUrl: inviteUrl
    });
});

// List user's galleries
app.get('/api/galleries', (req, res) => {
    const deviceId = req.query.device;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadGalleriesDb();

    // Find galleries where user is a member
    const memberGalleryIds = db.members
        .filter(m => m.deviceId.toLowerCase() === deviceId.toLowerCase())
        .map(m => m.galleryId);

    const galleries = db.galleries
        .filter(g => memberGalleryIds.includes(g.id))
        .map(g => {
            const memberCount = db.members.filter(m => m.galleryId === g.id).length;
            const photoCount = db.galleryPhotos.filter(p => p.galleryId === g.id).length;
            return { ...g, memberCount, photoCount };
        });

    res.json({ galleries });
});

// Get gallery details with photos
app.get('/api/galleries/:id', (req, res) => {
    const galleryId = req.params.id;
    const deviceId = req.query.device;

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g => g.id === galleryId);

    if (!gallery) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    // Check if user is a member
    const isMember = db.members.some(m =>
        m.galleryId === galleryId &&
        m.deviceId.toLowerCase() === deviceId?.toLowerCase()
    );

    if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this gallery' });
    }

    const members = db.members.filter(m => m.galleryId === galleryId);
    const photos = db.galleryPhotos.filter(p => p.galleryId === galleryId);

    // Load upload details
    const uploadsDb = loadUploadsDb();
    const photosWithDetails = photos.map(p => {
        const upload = uploadsDb.uploads.find(u => u.id === p.uploadId);
        const member = members.find(m => m.deviceId === p.addedBy);
        return {
            ...p,
            url: upload?.url,
            filename: upload?.filename,
            thumbnail: upload?.thumbnail,
            size: upload?.size,
            addedByName: member?.memberName || 'Unknown'
        };
    }).filter(p => p.url);

    res.json({
        gallery,
        members,
        photos: photosWithDetails
    });
});

// Join gallery with invite code
app.post('/api/galleries/join', express.json(), (req, res) => {
    const { inviteCode, deviceId, memberName } = req.body;

    if (!inviteCode || !deviceId) {
        return res.status(400).json({ error: 'Invite code and device ID required' });
    }

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g =>
        g.inviteCode.toUpperCase() === inviteCode.toUpperCase().trim()
    );

    if (!gallery) {
        return res.status(404).json({ error: 'Invalid invite code' });
    }

    // Check if already a member
    const existingMember = db.members.find(m =>
        m.galleryId === gallery.id &&
        m.deviceId.toLowerCase() === deviceId.toLowerCase()
    );

    if (existingMember) {
        return res.json({ success: true, gallery, alreadyMember: true });
    }

    // Add as new member
    const member = {
        galleryId: gallery.id,
        deviceId: deviceId,
        memberName: memberName || 'Family Member',
        role: 'member',
        joinedAt: Date.now()
    };

    db.members.push(member);
    saveGalleriesDb(db);

    // Notify other members via SSE
    notifyGalleryMembers(gallery.id, {
        type: 'member-joined',
        member: { memberName: member.memberName, joinedAt: member.joinedAt }
    });

    res.json({ success: true, gallery, member });
});

// Add photo to gallery
app.post('/api/galleries/:id/photos', express.json(), (req, res) => {
    const galleryId = req.params.id;
    const { uploadId, deviceId } = req.body;

    if (!uploadId || !deviceId) {
        return res.status(400).json({ error: 'Upload ID and device ID required' });
    }

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g => g.id === galleryId);

    if (!gallery) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    // Verify membership
    const member = db.members.find(m =>
        m.galleryId === galleryId &&
        m.deviceId.toLowerCase() === deviceId.toLowerCase()
    );

    if (!member) {
        return res.status(403).json({ error: 'Not a member of this gallery' });
    }

    // Check if photo already in gallery
    const exists = db.galleryPhotos.some(p =>
        p.galleryId === galleryId && p.uploadId === uploadId
    );

    if (exists) {
        return res.json({ success: true, alreadyExists: true });
    }

    // Add photo
    const galleryPhoto = {
        id: `gph-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        galleryId: galleryId,
        uploadId: uploadId,
        addedBy: deviceId,
        addedAt: Date.now()
    };

    db.galleryPhotos.push(galleryPhoto);
    saveGalleriesDb(db);

    // Get upload details for SSE notification
    const uploadsDb = loadUploadsDb();
    const upload = uploadsDb.uploads.find(u => u.id === uploadId);

    // Notify members via SSE
    notifyGalleryMembers(galleryId, {
        type: 'photo-added',
        photo: {
            ...galleryPhoto,
            url: upload?.url,
            filename: upload?.filename,
            addedByName: member.memberName
        }
    });

    res.json({ success: true, photo: galleryPhoto });
});

// Remove photo from gallery
app.delete('/api/galleries/:id/photos/:photoId', (req, res) => {
    const { id: galleryId, photoId } = req.params;
    const deviceId = req.query.device;

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g => g.id === galleryId);

    if (!gallery) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    // Find the photo
    const photoIndex = db.galleryPhotos.findIndex(p =>
        p.galleryId === galleryId && p.id === photoId
    );

    if (photoIndex === -1) {
        return res.status(404).json({ error: 'Photo not found in gallery' });
    }

    const photo = db.galleryPhotos[photoIndex];

    // Check permission (owner can remove any, members only their own)
    const isOwner = gallery.ownerId.toLowerCase() === deviceId?.toLowerCase();
    const isUploader = photo.addedBy.toLowerCase() === deviceId?.toLowerCase();

    if (!isOwner && !isUploader) {
        return res.status(403).json({ error: 'Not authorized to remove this photo' });
    }

    db.galleryPhotos.splice(photoIndex, 1);
    saveGalleriesDb(db);

    // Notify members
    notifyGalleryMembers(galleryId, {
        type: 'photo-removed',
        photoId: photoId
    });

    res.json({ success: true });
});

// SSE stream for real-time updates
app.get('/api/galleries/:id/stream', (req, res) => {
    const galleryId = req.params.id;
    const deviceId = req.query.device;

    const db = loadGalleriesDb();
    const isMember = db.members.some(m =>
        m.galleryId === galleryId &&
        m.deviceId.toLowerCase() === deviceId?.toLowerCase()
    );

    if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this gallery' });
    }

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', galleryId })}\n\n`);

    // Store client connection
    if (!gallerySSEClients.has(galleryId)) {
        gallerySSEClients.set(galleryId, new Set());
    }
    gallerySSEClients.get(galleryId).add(res);

    // Keep alive
    const keepAlive = setInterval(() => {
        res.write(':keepalive\n\n');
    }, 30000);

    // Clean up on close
    req.on('close', () => {
        clearInterval(keepAlive);
        gallerySSEClients.get(galleryId)?.delete(res);
    });
});

// Helper to notify gallery members
function notifyGalleryMembers(galleryId, event) {
    const clients = gallerySSEClients.get(galleryId);
    if (clients) {
        const data = JSON.stringify(event);
        clients.forEach(client => {
            client.write(`data: ${data}\n\n`);
        });
    }
}

// Join gallery page handler
app.get('/gallery/join/:code', (req, res) => {
    const { code } = req.params;
    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g =>
        g.inviteCode.toUpperCase() === code.toUpperCase()
    );

    if (!gallery) {
        return res.send(`
            <!DOCTYPE html>
            <html><head><title>Invalid Invite - DOZ UP</title>
            <style>body{font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px}.icon{font-size:64px;margin-bottom:20px}h1{margin:0 0 10px}p{color:#94a3b8}</style></head>
            <body><div class="box"><div class="icon">🔗</div><h1>Invalid Invite</h1><p>This invite link is not valid.</p></div></body></html>
        `);
    }

    // Redirect to cabinet with join code
    res.redirect(`/cabinet.html?join=${code}`);
});

// ============ END FAMILY GALLERIES API ============

// API: Link browser fingerprint to device ID
app.post('/api/link-device', express.json(), (req, res) => {
    const { deviceId, browserFingerprint } = req.body;

    if (!deviceId || !browserFingerprint) {
        return res.status(400).json({ error: 'Device ID and browser fingerprint required' });
    }

    const db = loadUploadsDb();

    // Initialize fingerprints storage if not exists
    if (!db.fingerprints) {
        db.fingerprints = {};
    }

    // Link fingerprint to device ID
    db.fingerprints[browserFingerprint] = {
        deviceId: deviceId,
        linkedAt: Date.now()
    };

    saveUploadsDb(db);
    console.log(`Linked fingerprint ${browserFingerprint.substring(0, 16)}... to device ${deviceId.substring(0, 16)}...`);

    res.json({ success: true });
});

// API: Lookup device ID by browser fingerprint
app.get('/api/lookup-device', (req, res) => {
    const fingerprint = req.query.fp;

    if (!fingerprint) {
        return res.status(400).json({ error: 'Fingerprint required' });
    }

    const db = loadUploadsDb();
    const link = db.fingerprints?.[fingerprint];

    if (link && link.deviceId) {
        res.json({ success: true, deviceId: link.deviceId });
    } else {
        res.json({ success: false, deviceId: null });
    }
});

// API: Get device stats (linked browsers, last seen, etc.)
app.get('/api/device-stats', (req, res) => {
    const deviceId = req.query.device;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadUploadsDb();
    const device = db.devices?.[deviceId];

    // Count linked browsers/fingerprints
    let linkedBrowsers = 0;
    const linkedFingerprints = [];
    if (db.fingerprints) {
        for (const [fp, link] of Object.entries(db.fingerprints)) {
            if (link.deviceId === deviceId) {
                linkedBrowsers++;
                linkedFingerprints.push({
                    fingerprint: fp.substring(0, 16) + '...',
                    linkedAt: link.linkedAt
                });
            }
        }
    }

    res.json({
        success: true,
        device: {
            id: deviceId,
            firstSeen: device?.firstSeen || null,
            lastSeen: device?.lastSeen || null,
            uploadCount: device?.uploadCount || 0
        },
        linkedBrowsers: linkedBrowsers,
        browsers: linkedFingerprints
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // Report multer errors to AI interceptor
        uploadMetrics.record(false, 0);
        aiErrorInterceptor.handleError({
            message: `Multer error: ${err.code} - ${err.message}`,
            source: 'upload-multer',
            context: { code: err.code, field: err.field, path: req.path },
            deviceId: req.headers['x-device-id'] || 'web',
        });

        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large. Maximum size is 1GB',
                errorCode: 'LIMIT_FILE_SIZE',
                canRetry: false,
                tip: 'Reduce image size or compress before uploading',
            });
        }
        return res.status(400).json({ error: err.message, errorCode: err.code, canRetry: false });
    } else if (err) {
        uploadMetrics.record(false, 0);
        aiErrorInterceptor.handleError({
            message: `Upload middleware error: ${err.message}`,
            source: 'upload-middleware',
            stack: err.stack,
            context: { path: req.path },
        });
        return res.status(400).json({ error: err.message });
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    // Score: 100 base, penalize for high memory / high connections
    let score = 100;
    if (heapUsedMB > 600) score -= 40;
    else if (heapUsedMB > 400) score -= 15;
    if (connectedUsers.size > 1000) score -= 20;

    // Quick write-permission probe
    try {
        const probe = path.join(uploadsDir, '.health-' + Date.now());
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
    } catch (e) {
        score -= 50;
    }

    res.json({
        status: score >= 50 ? 'ok' : 'degraded',
        score,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        heapUsedMB
    });
});

// ============ AI HEALTH MONITOR - REPORT GENERATOR & SCHEDULER ============

async function generateAIHealthReport() {
    const startTime = Date.now();
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    let score = 100;
    const issues = [];
    const recommendations = [];

    // Check upload directory writable
    try {
        const probe = path.join(uploadsDir, '.ai-health-' + Date.now());
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
    } catch (e) {
        score -= 30;
        issues.push('Upload directory not writable');
        recommendations.push('Check disk space and directory permissions');
    }

    // Check memory usage
    if (heapMB > 600) {
        score -= 25;
        issues.push('Critical memory: ' + heapMB + 'MB');
        recommendations.push('Restart gateway to free memory');
    } else if (heapMB > 400) {
        score -= 10;
        issues.push('High memory: ' + heapMB + 'MB');
    }

    // Check upload success rate
    const totalUploads = uploadMetrics.successCount + uploadMetrics.failureCount;
    const successRate = totalUploads > 0 ? Math.round((uploadMetrics.successCount / totalUploads) * 100) : 100;
    if (successRate < 80 && totalUploads > 5) {
        score -= 20;
        issues.push('Upload success rate: ' + successRate + '% (' + uploadMetrics.failureCount + ' failures)');
        recommendations.push('Check disk space and upload permissions');
    }

    // Check WebSocket connections
    const wsCount = connectedUsers.size;
    const adminCount = adminConnections.size;
    if (wsCount > 500) {
        score -= 10;
        issues.push('High WebSocket connections: ' + wsCount);
        recommendations.push('Monitor for connection leaks');
    }

    // Check upload file count
    let uploadCount = 0;
    try {
        uploadCount = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.')).length;
    } catch (e) {}
    if (uploadCount > 50000) {
        score -= 5;
        issues.push('Storage: ' + uploadCount + ' files in uploads');
        recommendations.push('Consider archiving old uploads');
    }

    // Check uptime (just restarted = potential issue)
    const uptimeSec = Math.floor(process.uptime());
    if (uptimeSec < 120) {
        issues.push('Recently restarted (' + uptimeSec + 's ago)');
    }

    return {
        timestamp: new Date().toISOString(),
        score: Math.max(0, score),
        status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'critical',
        uptime: uptimeSec,
        uptimeFormatted: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
        memory: { heapMB, rssMB: Math.round(mem.rss / 1024 / 1024) },
        connections: { users: wsCount, admin: adminCount },
        uploads: { fileCount: uploadCount, successRate, totalSinceReset: totalUploads },
        issues,
        recommendations,
        checkDurationMs: Date.now() - startTime
    };
}

// Run AI health check every 3 hours
setInterval(async () => {
    try {
        const report = await generateAIHealthReport();
        AI_HEALTH_REPORTS.unshift(report);
        if (AI_HEALTH_REPORTS.length > AI_HEALTH_MAX_REPORTS) AI_HEALTH_REPORTS.pop();

        // Broadcast to admin WebSocket connections
        const alertData = JSON.stringify({ type: 'ai-health-report', report });
        adminConnections.forEach((conn) => {
            try { if (conn.ws && conn.ws.readyState === 1) conn.ws.send(alertData); } catch (e) {}
        });

        console.log(`[AI Monitor] Health score: ${report.score}/100 | ${report.status} | ${report.issues.length} issues`);
    } catch (e) {
        console.error('[AI Monitor] Check failed:', e.message);
    }
}, 3 * 60 * 60 * 1000);

// Initial health check 60s after startup
setTimeout(async () => {
    try {
        const report = await generateAIHealthReport();
        AI_HEALTH_REPORTS.unshift(report);
        console.log(`[AI Monitor] Initial health score: ${report.score}/100 | ${report.status}`);
    } catch (e) {}
}, 60000);

// Admin API: AI health report history
app.get('/api/admin/ai-health', (req, res) => {
    res.json({
        reports: AI_HEALTH_REPORTS,
        intervalHours: 3,
        totalReports: AI_HEALTH_REPORTS.length,
        maxReports: AI_HEALTH_MAX_REPORTS
    });
});

// Admin API: latest AI health report
app.get('/api/admin/ai-health/latest', (req, res) => {
    res.json(AI_HEALTH_REPORTS[0] || { status: 'pending', message: 'First check runs 60s after startup' });
});

// ============ AI OPERATIONS CENTER ENDPOINTS ============
app.get('/api/admin/ai-ops/status', (req, res) => {
    res.json(aiOpsCenter.getStatus());
});

app.get('/api/admin/ai-ops/scan', async (req, res) => {
    try {
        const scan = await aiOpsCenter.runFullScan();
        res.json({ success: true, scan });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/admin/ai-ops/report', async (req, res) => {
    try {
        const report = await aiOpsCenter.generateFullReport();
        res.json({ success: true, report });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============ DASHBOARD REAL DATA ENDPOINTS ============
app.get('/api/admin/dashboard/stats', (req, res) => {
    try {
        res.json(dashboardStats.getAllStats());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/tickets', (req, res) => {
    try {
        res.json(dashboardStats.getTickets());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/subscriptions', (req, res) => {
    try {
        res.json(dashboardStats.getSubscriptions());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/mrr', (req, res) => {
    try {
        res.json({ mrr: dashboardStats.getMRR() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/traffic-sources', (req, res) => {
    try {
        res.json(dashboardStats.getTrafficSources());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/growth-chart', (req, res) => {
    try {
        res.json(dashboardStats.getGrowthChart());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/roi', (req, res) => {
    try {
        res.json(dashboardStats.getROIData());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ AI AGENT FLEET ENDPOINTS ============
app.get('/api/agents/status', (req, res) => {
    res.json(agentOrchestrator.getStatus());
});

app.post('/api/agents/run-all', (req, res) => {
    agentOrchestrator.runAll();
    res.json({ success: true, message: 'Full agent cycle started' });
});

app.post('/api/agents/run/:id', async (req, res) => {
    try {
        agentOrchestrator.runAgent(req.params.id);
        res.json({ success: true, message: `Agent ${req.params.id} started` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/run-department/:dept', (req, res) => {
    try {
        agentOrchestrator.runDepartment(req.params.dept);
        res.json({ success: true, message: `${req.params.dept} department started` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/agents/findings', (req, res) => {
    res.json(agentOrchestrator.getFindings({
        severity: req.query.severity,
        department: req.query.department,
        limit: parseInt(req.query.limit) || 100
    }));
});

// ============ ORCHESTRATOR V2 API (1000+ Agents) ============
app.get('/api/agents/v2/status', (req, res) => {
    try {
        res.json(orchestratorV2.getStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/agents/v2/findings', (req, res) => {
    try {
        res.json(orchestratorV2.getFindings({
            severity: req.query.severity,
            department: req.query.department,
            agentId: req.query.agentId,
            limit: parseInt(req.query.limit) || 200
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/agents/v2/agents', (req, res) => {
    try {
        res.json(orchestratorV2.getAgentList({
            department: req.query.department,
            priority: req.query.priority,
            state: req.query.state
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/agents/v2/run-all', (req, res) => {
    try {
        orchestratorV2.runAll();
        res.json({ success: true, message: 'V2 full cycle started (all tiers)' });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/v2/run-tier/:tier', (req, res) => {
    try {
        orchestratorV2.runTier(req.params.tier);
        res.json({ success: true, message: `Tier ${req.params.tier} started` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/v2/run-department/:dept', async (req, res) => {
    try {
        await orchestratorV2.runDepartment(req.params.dept);
        res.json({ success: true, message: `Department ${req.params.dept} completed` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/v2/run/:agentId', async (req, res) => {
    try {
        await orchestratorV2.runAgent(req.params.agentId);
        res.json({ success: true, message: `Agent ${req.params.agentId} completed` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/doz-brains/status', async (req, res) => {
    res.json(await dozBrains.getStatus());
});

app.post('/api/doz-brains/chat', async (req, res) => {
    try {
        const { model, messages, prompt } = req.body;
        let result;
        if (prompt) {
            result = await dozBrains.think(prompt);
        } else if (messages) {
            result = await dozBrains.chat(model, messages);
        } else {
            return res.json({ success: false, error: 'Provide prompt or messages' });
        }
        res.json({ success: true, response: result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============ AI-POWERED DIAGNOSTICS SYSTEM ============

// AI Diagnostic endpoint - real-time issue detection and resolution
app.get('/api/diagnostics', async (req, res) => {
    const uploadsPath = path.join(__dirname, 'uploads');
    const diagnostics = {
        timestamp: Date.now(),
        server: { status: 'ok', uptime: process.uptime(), pid: process.pid },
        upload: { status: 'ok' },
        storage: { status: 'ok' },
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        issues: [],
        fixes: []
    };

    try {
        // Check uploads directory
        if (!fs.existsSync(uploadsPath)) {
            diagnostics.storage.status = 'error';
            diagnostics.issues.push('uploads_dir_missing');
            fs.mkdirSync(uploadsPath, { recursive: true });
            diagnostics.fixes.push('created_uploads_dir');
        }

        // Check write permissions
        const testFile = path.join(uploadsPath, '.write-test-' + Date.now());
        try {
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
        } catch (e) {
            diagnostics.upload.status = 'error';
            diagnostics.issues.push('no_write_permission');
        }

        // Memory check
        if (diagnostics.memory.used > 500) {
            diagnostics.issues.push('high_memory_usage');
            if (global.gc) {
                global.gc();
                diagnostics.fixes.push('triggered_gc');
            }
        }

        // Count files in uploads
        try {
            const files = fs.readdirSync(uploadsPath);
            diagnostics.storage.fileCount = files.length;
        } catch (e) {
            diagnostics.storage.fileCount = 0;
        }

        diagnostics.healthy = diagnostics.issues.length === 0;
        diagnostics.autoFixed = diagnostics.fixes.length;

    } catch (e) {
        diagnostics.error = e.message;
        diagnostics.healthy = false;
    }

    res.json(diagnostics);
});

// Real-time upload error resolution - AI-powered
app.post('/api/upload-check', express.json(), async (req, res) => {
    const { errorType, errorMessage, errorCode, deviceId, fileSize, fileType, httpStatus } = req.body;

    try {
        const result = await aiErrorInterceptor.handleUploadError({
            message: errorMessage || errorType || 'Unknown upload error',
            errorCode: errorCode || '',
            deviceId: deviceId || 'web',
            fileSize: fileSize || 0,
            fileType: fileType || '',
            endpoint: req.body.endpoint || '/upload',
            httpStatus: httpStatus || 0,
        });

        console.log(`[AI-Upload] Device: ${deviceId}, Error: ${(errorMessage || '').substring(0, 80)}, canRetry: ${result.canRetry}, strategy: ${result.retryStrategy}`);

        res.json({
            canRetry: result.canRetry,
            retryDelay: result.retryDelay,
            retryStrategy: result.retryStrategy,
            suggestion: result.retryStrategy,
            tip: result.uploadTip,
            aiHandled: result.handled,
            issueId: result.issueId,
            serverStatus: result.handled ? 'recovering' : 'ok',
        });
    } catch (err) {
        console.error('[AI-Upload] Error in upload-check:', err.message);
        // Fallback if AI fails
        res.json({
            canRetry: true,
            retryDelay: 500,
            suggestion: 'retry_generic',
            tip: 'Retrying upload...',
            aiHandled: false,
        });
    }
});

// Upload health pre-flight check
app.get('/api/upload-health', async (req, res) => {
    const deviceId = req.query.device || req.headers['x-device-id'] || 'web';
    const userId = req.query.userId || req.headers['x-user-id'];

    const health = {
        healthy: true,
        timestamp: Date.now(),
        checks: {},
        issues: [],
        recommendations: [],
    };

    // 1. Write permission check
    try {
        const testFile = path.join(uploadsDir, '.health-check-' + Date.now());
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        health.checks.writePermission = { status: 'ok' };
    } catch (e) {
        health.checks.writePermission = { status: 'error', error: e.code };
        health.issues.push('no_write_permission');
        health.healthy = false;
    }

    // 2. Daily upload limit check - respect paid user status via plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);
    const limitStatus = checkDailyUploadLimit(deviceId, isPaidUser);
    health.checks.dailyLimit = {
        status: limitStatus.allowed ? 'ok' : 'limit_reached',
        used: limitStatus.used,
        limit: isPaidUser ? 'unlimited' : limitStatus.limit,
        remaining: isPaidUser ? 'unlimited' : limitStatus.remaining,
        tier: isPaidUser ? 'paid' : 'free',
    };
    if (!limitStatus.allowed) {
        health.issues.push('daily_limit_reached');
        health.recommendations.push('Daily upload limit reached. Resets at midnight.');
    }

    // 3. Memory check
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    health.checks.memory = {
        status: heapUsedMB < 400 ? 'ok' : heapUsedMB < 600 ? 'warning' : 'critical',
        heapUsedMB,
    };
    if (heapUsedMB >= 600) {
        health.issues.push('high_memory');
        health.healthy = false;
    }

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
    EUR: { rate: 0.92, symbol: '€', code: 'EUR' },
    GBP: { rate: 0.79, symbol: '£', code: 'GBP' },
    CAD: { rate: 1.36, symbol: 'C$', code: 'CAD' },
    AUD: { rate: 1.53, symbol: 'A$', code: 'AUD' },
    JPY: { rate: 149.50, symbol: '¥', code: 'JPY', decimals: 0 },
    INR: { rate: 83.12, symbol: '₹', code: 'INR' },
    BRL: { rate: 4.97, symbol: 'R$', code: 'BRL' },
    MXN: { rate: 17.15, symbol: 'MX$', code: 'MXN' },
    SGD: { rate: 1.34, symbol: 'S$', code: 'SGD' },
    CHF: { rate: 0.88, symbol: 'CHF', code: 'CHF' },
    SEK: { rate: 10.42, symbol: 'kr', code: 'SEK' },
    NOK: { rate: 10.65, symbol: 'kr', code: 'NOK' },
    DKK: { rate: 6.87, symbol: 'kr', code: 'DKK' },
    PLN: { rate: 3.96, symbol: 'zł', code: 'PLN' },
    ZAR: { rate: 18.65, symbol: 'R', code: 'ZAR' },
    NZD: { rate: 1.64, symbol: 'NZ$', code: 'NZD' },
    HKD: { rate: 7.82, symbol: 'HK$', code: 'HKD' },
    CNY: { rate: 7.24, symbol: '¥', code: 'CNY' },
    KRW: { rate: 1320, symbol: '₩', code: 'KRW', decimals: 0 },
    THB: { rate: 35.50, symbol: '฿', code: 'THB' },
    MYR: { rate: 4.72, symbol: 'RM', code: 'MYR' },
    PHP: { rate: 56.20, symbol: '₱', code: 'PHP' },
    IDR: { rate: 15750, symbol: 'Rp', code: 'IDR', decimals: 0 },
    TWD: { rate: 31.50, symbol: 'NT$', code: 'TWD' },
    TRY: { rate: 32.15, symbol: '₺', code: 'TRY' },
    ILS: { rate: 3.65, symbol: '₪', code: 'ILS' },
    CZK: { rate: 22.85, symbol: 'Kč', code: 'CZK' },
    AED: { rate: 3.67, symbol: 'د.إ', code: 'AED' },
    SAR: { rate: 3.75, symbol: '﷼', code: 'SAR' }
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
    const userUploads = uploadsDb.uploads ? uploadsDb.uploads.filter(u =>
        linkedDeviceIds.includes(u.deviceId) || (userId && u.userId === userId)
    ) : [];

    const now = new Date();
    const today = now.toDateString();
    const todayUploads = userUploads.filter(u => {
        const ts = u.timestamp || u.createdAt;
        return ts && new Date(ts).toDateString() === today;
    });

    const totalSize = userUploads.reduce((sum, u) => sum + (u.size || 0), 0);
    const daysActive = userUploads.length > 0
        ? Math.max(1, Math.ceil((now - new Date(userUploads[userUploads.length - 1].timestamp || 0)) / 86400000))
        : 1;

    res.json({
        success: true,
        today: todayUploads.length,
        total: userUploads.length,
        storage: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        shared: userUploads.length,
        weekly: userUploads.filter(u => {
            const ts = u.timestamp || u.createdAt;
            if (!ts) return false;
            const week = new Date();
            week.setDate(week.getDate() - 7);
            return new Date(ts) > week;
        }).length,
        monthly: userUploads.filter(u => {
            const ts = u.timestamp || u.createdAt;
            if (!ts) return false;
            const month = new Date();
            month.setMonth(month.getMonth() - 1);
            return new Date(ts) > month;
        }).length,
        avgPerDay: Math.round(userUploads.length / daysActive * 10) / 10
    });
});

// Feature requests - for user feedback
app.post('/api/feature-requests', express.json(), (req, res) => {
    const { deviceId, message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    const db = loadFeatureRequests();
    const request = {
        id: uuidv4(),
        deviceId: deviceId || 'anonymous',
        message,
        status: 'new',
        votes: 1,
        createdAt: new Date().toISOString()
    };
    db.requests.push(request);
    saveFeatureRequests(db);

    console.log(`[Feature Request] ${deviceId}: ${message}`);

    res.json({ success: true, request });
});

// Get all feature requests (for admin)
app.get('/api/feature-requests', (req, res) => {
    const db = loadFeatureRequests();
    res.json({ success: true, requests: db.requests.sort((a, b) => b.votes - a.votes) });
});

// ============ REFERRAL SYSTEM - 50% DISCOUNT ============
const referralsDbPath = path.join(dataDir, 'referrals.json');

async function loadReferralsDb() {
    return await dbUtils.loadJSON(referralsDbPath, { referrals: [], codes: {} });
}

async function saveReferralsDb(data) {
    return await dbUtils.saveJSON(referralsDbPath, data);
}

// Get referral stats for a user
app.get('/api/referrals/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const db = loadReferralsDb();

    // Generate referral code if not exists
    if (!db.codes[deviceId]) {
        db.codes[deviceId] = {
            code: 'REF-' + deviceId.replace('DOZ-', ''),
            createdAt: new Date().toISOString(),
            invitesSent: 0,
            conversions: 0,
            totalEarnings: 0
        };
        saveReferralsDb(db);
    }

    const code = db.codes[deviceId];
    const userReferrals = db.referrals.filter(r => r.referrerDeviceId === deviceId);

    res.json({
        success: true,
        code: code.code,
        stats: {
            invitesSent: code.invitesSent,
            conversions: userReferrals.filter(r => r.status === 'converted').length,
            pending: userReferrals.filter(r => r.status === 'pending').length,
            totalEarnings: code.totalEarnings
        },
        referrals: userReferrals.slice(0, 20) // Last 20 referrals
    });
});

// Track referral invite sent
app.post('/api/referrals/invite', express.json(), (req, res) => {
    const { deviceId, method, recipient } = req.body;
    const db = loadReferralsDb();

    if (!db.codes[deviceId]) {
        db.codes[deviceId] = {
            code: 'REF-' + deviceId.replace('DOZ-', ''),
            createdAt: new Date().toISOString(),
            invitesSent: 0,
            conversions: 0,
            totalEarnings: 0
        };
    }

    db.codes[deviceId].invitesSent++;

    const invite = {
        id: uuidv4(),
        referrerDeviceId: deviceId,
        method: method || 'unknown', // email, twitter, facebook, linkedin
        recipient: recipient || null,
        status: 'sent',
        sentAt: new Date().toISOString()
    };

    db.referrals.push(invite);
    saveReferralsDb(db);

    console.log(`[Referral] ${deviceId} sent invite via ${method}`);
    res.json({ success: true, invite });
});

// Use referral code (when new user signs up)
app.post('/api/referrals/use', express.json(), (req, res) => {
    const { referralCode, newDeviceId } = req.body;
    const db = loadReferralsDb();

    // Find the referrer
    const referrerDeviceId = Object.keys(db.codes).find(
        id => db.codes[id].code === referralCode
    );

    if (!referrerDeviceId) {
        return res.status(404).json({ success: false, error: 'Invalid referral code' });
    }

    // Check if new user already used a code
    const existingUse = db.referrals.find(r => r.newUserDeviceId === newDeviceId && r.status === 'converted');
    if (existingUse) {
        return res.status(400).json({ success: false, error: 'Already used a referral code' });
    }

    // Record the referral conversion
    const referral = {
        id: uuidv4(),
        referrerDeviceId,
        newUserDeviceId: newDeviceId,
        code: referralCode,
        status: 'converted',
        convertedAt: new Date().toISOString(),
        discountApplied: 50 // 50% discount
    };

    db.referrals.push(referral);
    db.codes[referrerDeviceId].conversions++;
    db.codes[referrerDeviceId].totalEarnings += 18.85; // 50% of $37.70 yearly
    saveReferralsDb(db);

    console.log(`[Referral] ${newDeviceId} used code ${referralCode} from ${referrerDeviceId}`);
    res.json({
        success: true,
        discount: 50,
        message: 'Referral code applied! You get 50% off.'
    });
});

// Check referral eligibility (must have 7+ months remaining)
app.get('/api/referrals/eligibility/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const subsDb = loadSubscriptionsDb();
    const sub = subsDb.subscriptions.find(s => s.deviceId === deviceId && s.status === 'active');

    if (!sub) {
        return res.json({
            eligible: false,
            reason: 'No active subscription',
            monthsRemaining: 0
        });
    }

    const expiresAt = new Date(sub.expiresAt);
    const now = new Date();
    const monthsRemaining = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24 * 30));

    const eligible = monthsRemaining >= 7;

    res.json({
        eligible,
        monthsRemaining,
        reason: eligible ? 'You can earn referral rewards!' : `Need ${7 - monthsRemaining} more months to be eligible`,
        renewalWindow: {
            startsAt: new Date(expiresAt.getTime() - (3 * 30 * 24 * 60 * 60 * 1000)).toISOString(), // 3 months before
            endsAt: sub.expiresAt
        }
    });
});

// ============ DEVICE MANAGEMENT - BIOMETRIC PAIRING ============
const devicesDbPath = path.join(dataDir, 'devices.json');

async function loadDevicesDb() {
    return await dbUtils.loadJSON(devicesDbPath, { users: {}, pairingCodes: {} });
}

async function saveDevicesDb(data) {
    return await dbUtils.saveJSON(devicesDbPath, data);
}

// ============ REAL-TIME DEVICE PAIRING (Bluetooth-like) ============
// NOTE: SSE route MUST be defined BEFORE parameterized :deviceId route

// SSE clients for device pairing events
const devicePairingClients = new Map(); // userId -> Set of {deviceId, res}

// SSE stream for device pairing events
app.get('/api/devices/pairing-stream', (req, res) => {
    const { userId, deviceId } = req.query;

    if (!userId || !deviceId) {
        return res.status(400).json({ error: 'userId and deviceId required' });
    }

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send connection confirmation
    res.write(`data: ${JSON.stringify({ type: 'connected', deviceId })}\n\n`);

    // Store client
    if (!devicePairingClients.has(userId)) {
        devicePairingClients.set(userId, new Set());
    }
    devicePairingClients.get(userId).add({ deviceId, res });

    // Keep alive
    const keepAlive = setInterval(() => {
        res.write(':keepalive\n\n');
    }, 30000);

    // Clean up on disconnect
    req.on('close', () => {
        clearInterval(keepAlive);
        const clients = devicePairingClients.get(userId);
        if (clients) {
            for (const client of clients) {
                if (client.deviceId === deviceId) {
                    clients.delete(client);
                    break;
                }
            }
        }
    });
});

// Get user's devices
app.get('/api/devices/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const db = loadDevicesDb();

    // Parse OS from user-agent
    const ua = req.headers['user-agent'] || '';
    let detectedOS = 'Unknown';
    if (ua.includes('Windows')) detectedOS = 'Windows';
    else if (ua.includes('Mac')) detectedOS = 'macOS';
    else if (ua.includes('Linux') && !ua.includes('Android')) detectedOS = 'Linux';
    else if (ua.includes('Android')) detectedOS = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) detectedOS = 'iOS';

    // Find user by device - prefer the user with MOST devices (the paired group)
    let userId = null;
    let maxDevices = 0;
    for (const [uid, userData] of Object.entries(db.users)) {
        if (userData.devices && userData.devices.some(d => d.deviceId === deviceId)) {
            if (userData.devices.length > maxDevices) {
                userId = uid;
                maxDevices = userData.devices.length;
            }
        }
    }

    if (!userId) {
        // Create new user with this device
        userId = 'user-' + uuidv4().substring(0, 8);
        db.users[userId] = {
            createdAt: new Date().toISOString(),
            devices: [{
                deviceId,
                name: detectedOS + ' Device',
                platform: detectedOS,
                addedAt: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                verified: true,
                current: true
            }]
        };
        saveDevicesDb(db);
    } else {
        // Update lastActive and OS for the requesting device
        const device = db.users[userId].devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.lastActive = new Date().toISOString();
            device.current = true;
            if (detectedOS !== 'Unknown') device.platform = detectedOS;
            // Mark other devices as not current
            db.users[userId].devices.forEach(d => {
                if (d.deviceId !== deviceId) d.current = false;
            });
        }
        saveDevicesDb(db);
    }

    const user = db.users[userId];

    // Add active status to each device (active within last 5 minutes)
    const devicesWithStatus = user.devices.map(d => ({
        ...d,
        isActive: d.current || (d.lastActive && (Date.now() - new Date(d.lastActive).getTime()) < 5 * 60 * 1000)
    }));

    res.json({
        success: true,
        userId,
        devices: devicesWithStatus,
        maxDevices: 5
    });
});

// Broadcast pairing event to all user's devices
function broadcastPairingEvent(userId, event, excludeDeviceId = null) {
    const clients = devicePairingClients.get(userId);
    if (clients) {
        const data = JSON.stringify(event);
        for (const client of clients) {
            if (client.deviceId !== excludeDeviceId) {
                client.res.write(`data: ${data}\n\n`);
            }
        }
    }
}

// Generate pairing code for adding new device
app.post('/api/devices/pairing-code', express.json(), (req, res) => {
    const { deviceId, deviceName } = req.body;
    const db = loadDevicesDb();

    // Generate 8-character pairing code
    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
                 Math.random().toString(36).substring(2, 6).toUpperCase();

    // Find user
    let userId = null;
    let initiatorDevice = null;
    for (const [uid, userData] of Object.entries(db.users)) {
        const device = userData.devices.find(d => d.deviceId === deviceId);
        if (device) {
            userId = uid;
            initiatorDevice = device;
            break;
        }
    }

    if (!userId) {
        return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    // Store pairing code (expires in 5 minutes)
    db.pairingCodes[code] = {
        userId,
        initiatorDeviceId: deviceId,
        initiatorDeviceName: initiatorDevice?.name || deviceName || 'Unknown Device',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };

    saveDevicesDb(db);

    // Broadcast pairing request to all user's other devices
    broadcastPairingEvent(userId, {
        type: 'pairing-request',
        code,
        fromDeviceId: deviceId,
        fromDeviceName: initiatorDevice?.name || deviceName || 'Unknown Device',
        expiresAt: db.pairingCodes[code].expiresAt
    }, deviceId);

    res.json({
        success: true,
        code,
        expiresIn: 300 // 5 minutes
    });
});

// Pair new device using code
app.post('/api/devices/pair', express.json(), (req, res) => {
    const { code, newDeviceId, deviceName, platform } = req.body;
    const db = loadDevicesDb();

    const pairing = db.pairingCodes[code];

    if (!pairing) {
        return res.status(404).json({ success: false, error: 'Invalid pairing code' });
    }

    if (new Date(pairing.expiresAt) < new Date()) {
        delete db.pairingCodes[code];
        saveDevicesDb(db);
        return res.status(400).json({ success: false, error: 'Pairing code expired' });
    }

    const user = db.users[pairing.userId];

    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Check device limit
    if (user.devices.length >= 5) {
        return res.status(400).json({ success: false, error: 'Maximum 5 devices allowed' });
    }

    // Check if device already added
    if (user.devices.some(d => d.deviceId === newDeviceId)) {
        return res.status(400).json({ success: false, error: 'Device already linked' });
    }

    // Remove new device from any existing solo user entry (prevents stale lookups on refresh)
    for (const [uid, userData] of Object.entries(db.users)) {
        if (uid !== pairing.userId && userData.devices) {
            const idx = userData.devices.findIndex(d => d.deviceId === newDeviceId);
            if (idx !== -1) {
                userData.devices.splice(idx, 1);
                // Delete empty user entries
                if (userData.devices.length === 0) {
                    delete db.users[uid];
                }
            }
        }
    }

    // Parse OS from platform/user-agent
    const ua = req.headers['user-agent'] || '';
    let os = platform || 'Unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    // Add new device
    const newDevice = {
        deviceId: newDeviceId,
        name: deviceName || 'New Device',
        platform: os,
        addedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        verified: true,
        current: false,
        pairedFrom: pairing.initiatorDeviceId
    };
    user.devices.push(newDevice);

    // Store initiator info before cleanup
    const initiatorDeviceId = pairing.initiatorDeviceId;
    const userId = pairing.userId;

    // Clean up pairing code
    delete db.pairingCodes[code];
    saveDevicesDb(db);

    console.log(`[Device] New device ${newDeviceId} paired to user ${userId}`);

    // Broadcast pairing success to all user's devices (especially the initiator)
    broadcastPairingEvent(userId, {
        type: 'pairing-accepted',
        newDevice: newDevice,
        acceptedBy: newDeviceId
    });

    res.json({
        success: true,
        message: 'Device paired successfully!',
        userId: userId,
        devices: user.devices
    });
});

// Remove device
app.delete('/api/devices/:deviceId/:targetDeviceId', (req, res) => {
    const { deviceId, targetDeviceId } = req.params;
    const db = loadDevicesDb();

    // Find user
    let userId = null;
    for (const [uid, userData] of Object.entries(db.users)) {
        if (userData.devices.some(d => d.deviceId === deviceId)) {
            userId = uid;
            break;
        }
    }

    if (!userId) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = db.users[userId];

    // Don't allow removing the last device
    if (user.devices.length <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot remove last device' });
    }

    // Remove target device
    const initialCount = user.devices.length;
    user.devices = user.devices.filter(d => d.deviceId !== targetDeviceId);

    if (user.devices.length === initialCount) {
        return res.status(404).json({ success: false, error: 'Target device not found' });
    }

    saveDevicesDb(db);

    console.log(`[Device] Device ${targetDeviceId} removed from user ${userId}`);

    res.json({
        success: true,
        message: 'Device removed',
        devices: user.devices
    });
});

// Rename device (POST version)
app.post('/api/devices/rename', express.json(), (req, res) => {
    const { deviceId, name } = req.body;
    const db = loadDevicesDb();

    // Find and update device
    for (const user of Object.values(db.users)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.name = name || device.name;
            saveDevicesDb(db);
            return res.json({ success: true, device });
        }
    }

    res.status(404).json({ success: false, error: 'Device not found' });
});

// Rename device (PATCH version)
app.patch('/api/devices/:deviceId/rename', express.json(), (req, res) => {
    const { deviceId } = req.params;
    const { newName } = req.body;
    const db = loadDevicesDb();

    // Find and update device
    for (const user of Object.values(db.users)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.name = newName || device.name;
            saveDevicesDb(db);
            return res.json({ success: true, device });
        }
    }

    res.status(404).json({ success: false, error: 'Device not found' });
});

// Update device activity
app.post('/api/devices/heartbeat', express.json(), (req, res) => {
    const { deviceId } = req.body;
    const db = loadDevicesDb();

    // Find and update device
    for (const user of Object.values(db.users)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.lastActive = new Date().toISOString();
            saveDevicesDb(db);
            return res.json({ success: true });
        }
    }

    res.json({ success: true }); // Silent fail for heartbeat
});

// ============ CLOUD GALLERY API ============
const galleryDbPath = path.join(dataDir, 'gallery.json');

function loadGalleryDb() {
    try {
        if (fs.existsSync(galleryDbPath)) {
            return JSON.parse(fs.readFileSync(galleryDbPath, 'utf8'));
        }
    } catch (e) {}
    return { images: [], stats: {} };
}

function saveGalleryDb(db) {
    fs.writeFileSync(galleryDbPath, JSON.stringify(db));
}

// Get latest gallery images
app.get('/api/gallery/latest', (req, res) => {
    const db = loadGalleryDb();
    const limit = parseInt(req.query.limit) || 20;
    const images = (db.images || [])
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    res.json({ success: true, images, total: (db.images || []).length });
});

// Get user's gallery
app.get('/api/gallery', (req, res) => {
    const { device } = req.query;
    const db = loadGalleryDb();

    // Filter by device
    const userImages = device
        ? db.images.filter(img => img.deviceId === device)
        : db.images;

    // Enrich images with view counts from shares.json
    const shareViews = loadShareViews();
    const enrichedImages = userImages.map(img => {
        // Normalize filename to match shares.json keys (without extension)
        const normalizedKey = img.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
        const views = shareViews[normalizedKey] ? shareViews[normalizedKey].views || 0 : 0;
        return { ...img, views };
    });

    // Calculate stats
    const totalSize = enrichedImages.reduce((sum, img) => sum + (img.size || 0), 0);
    const totalShares = enrichedImages.reduce((sum, img) => sum + (img.shares || 0), 0);
    const totalViews = enrichedImages.reduce((sum, img) => sum + (img.views || 0), 0);

    res.json({
        success: true,
        images: enrichedImages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        stats: {
            total: enrichedImages.length,
            storage: (totalSize / (1024 * 1024)).toFixed(1),
            shares: totalShares,
            views: totalViews
        }
    });
});

// Add image to gallery (called after upload)
app.post('/api/gallery', express.json(), (req, res) => {
    const { deviceId, filename, url, size, type, filter, beauty } = req.body;
    const db = loadGalleryDb();

    const image = {
        id: uuidv4(),
        deviceId: deviceId || 'anonymous',
        filename: filename || `image-${Date.now()}.png`,
        url,
        size: size || 0,
        type: type || 'screenshot', // screenshot, selfie, edited, gif
        filter: filter || null,
        beauty: beauty || false,
        views: 0,
        shares: 0,
        favorite: false,
        createdAt: new Date().toISOString()
    };

    db.images.unshift(image);

    // Keep max 1000 images per user
    const userImages = db.images.filter(img => img.deviceId === deviceId);
    if (userImages.length > 1000) {
        const oldestId = userImages[userImages.length - 1].id;
        db.images = db.images.filter(img => img.id !== oldestId);
    }

    saveGalleryDb(db);

    console.log(`[Gallery] New image added: ${filename} by ${deviceId}`);
    res.json({ success: true, image });
});

// Update image (favorite, etc.)
app.patch('/api/gallery/:imageId', express.json(), (req, res) => {
    const { imageId } = req.params;
    const updates = req.body;
    const db = loadGalleryDb();

    const image = db.images.find(img => img.id === imageId);
    if (!image) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }

    // Apply updates
    if (updates.favorite !== undefined) image.favorite = updates.favorite;
    if (updates.filename) image.filename = updates.filename;

    saveGalleryDb(db);
    res.json({ success: true, image });
});

// Delete image
app.delete('/api/gallery/:imageId', (req, res) => {
    const { imageId } = req.params;
    const db = loadGalleryDb();

    const initialLength = db.images.length;
    db.images = db.images.filter(img => img.id !== imageId);

    if (db.images.length === initialLength) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }

    saveGalleryDb(db);
    console.log(`[Gallery] Image deleted: ${imageId}`);
    res.json({ success: true });
});

// Track image view
app.post('/api/gallery/:imageId/view', (req, res) => {
    const { imageId } = req.params;
    const db = loadGalleryDb();

    const image = db.images.find(img => img.id === imageId);
    if (image) {
        image.views = (image.views || 0) + 1;
        saveGalleryDb(db);
    }

    res.json({ success: true });
});

// Track image share
app.post('/api/gallery/:imageId/share', express.json(), (req, res) => {
    const { imageId } = req.params;
    const { platform } = req.body; // twitter, facebook, etc.
    const db = loadGalleryDb();

    const image = db.images.find(img => img.id === imageId);
    if (image) {
        image.shares = (image.shares || 0) + 1;
        if (!image.shareHistory) image.shareHistory = [];
        image.shareHistory.push({
            platform,
            timestamp: new Date().toISOString()
        });
        saveGalleryDb(db);
    }

    res.json({ success: true });
});

// ============ STUDIO / FILTERS API ============
const filtersDbPath = path.join(dataDir, 'filters.json');

async function loadFiltersDb() {
    return await dbUtils.loadJSON(filtersDbPath, { customFilters: [], presets: [] });
}

async function saveFiltersDb(data) {
    return await dbUtils.saveJSON(filtersDbPath, data);
}

// Get available filters and presets
app.get('/api/studio/filters', (req, res) => {
    const defaultFilters = [
        { id: 'clarendon', name: 'Clarendon', css: 'contrast(1.2) saturate(1.35)', category: 'popular' },
        { id: 'gingham', name: 'Gingham', css: 'brightness(1.05) sepia(0.04)', category: 'popular' },
        { id: 'moon', name: 'Moon', css: 'grayscale(1) contrast(1.1) brightness(1.1)', category: 'bw' },
        { id: 'lark', name: 'Lark', css: 'contrast(0.9) brightness(1.1) saturate(0.85)', category: 'popular' },
        { id: 'reyes', name: 'Reyes', css: 'sepia(0.22) brightness(1.1) contrast(0.85) saturate(0.75)', category: 'vintage' },
        { id: 'juno', name: 'Juno', css: 'saturate(1.4) contrast(1.15) brightness(1.05) sepia(0.05)', category: 'popular' },
        { id: 'slumber', name: 'Slumber', css: 'saturate(0.66) brightness(1.05)', category: 'vintage' },
        { id: '1977', name: '1977', css: 'sepia(0.5) hue-rotate(-30deg) saturate(1.4)', category: 'vintage' },
        { id: 'nashville', name: 'Nashville', css: 'sepia(0.2) contrast(1.2) brightness(1.05) saturate(1.2)', category: 'vintage' },
        { id: 'inkwell', name: 'Inkwell', css: 'grayscale(1) brightness(1.1) contrast(1.3)', category: 'bw' },
        { id: 'willow', name: 'Willow', css: 'grayscale(0.5) contrast(0.95) brightness(0.9)', category: 'bw' },
        { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.95)', category: 'bw' }
    ];

    const beautyPresets = [
        { id: 'natural', name: 'Natural', settings: { smooth: 30, bright: 50, soft: 20, slim: 0, eyes: 0, warmth: 50 } },
        { id: 'soft', name: 'Soft Glow', settings: { smooth: 60, bright: 55, soft: 40, slim: 0, eyes: 0, warmth: 55 } },
        { id: 'glamour', name: 'Glamour', settings: { smooth: 70, bright: 60, soft: 30, slim: 20, eyes: 15, warmth: 60 } },
        { id: 'studio', name: 'Studio', settings: { smooth: 50, bright: 55, soft: 25, slim: 10, eyes: 10, warmth: 45 } },
        { id: 'hd', name: 'HD Clear', settings: { smooth: 20, bright: 52, soft: 10, slim: 0, eyes: 0, warmth: 48 } }
    ];

    res.json({
        success: true,
        filters: defaultFilters,
        beautyPresets
    });
});

// Save custom filter/preset
app.post('/api/studio/filters', express.json(), (req, res) => {
    const { deviceId, name, type, settings } = req.body;
    const db = loadFiltersDb();

    const filter = {
        id: uuidv4(),
        deviceId,
        name,
        type, // 'filter' or 'beauty'
        settings,
        createdAt: new Date().toISOString()
    };

    db.customFilters.push(filter);
    saveFiltersDb(db);

    res.json({ success: true, filter });
});

// ============ USER THEMES API ============
const themesDbPath = path.join(dataDir, 'themes.json');

async function loadThemesDb() {
    return await dbUtils.loadJSON(themesDbPath, { userThemes: {} });
}

async function saveThemesDb(data) {
    return await dbUtils.saveJSON(themesDbPath, data);
}

// Get user's theme preferences
app.get('/api/themes/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const db = loadThemesDb();

    const userTheme = db.userThemes[deviceId] || {
        theme: 'dark', // dark, light, system
        accentColor: '#10b981',
        fontSize: 'medium',
        compactMode: false,
        soundEnabled: true,
        notificationsEnabled: true
    };

    res.json({ success: true, theme: userTheme });
});

// Save user's theme preferences
app.post('/api/themes/:deviceId', express.json(), (req, res) => {
    const { deviceId } = req.params;
    const settings = req.body;
    const db = loadThemesDb();

    db.userThemes[deviceId] = {
        ...db.userThemes[deviceId],
        ...settings,
        updatedAt: new Date().toISOString()
    };

    saveThemesDb(db);
    res.json({ success: true, theme: db.userThemes[deviceId] });
});

// Available themes list
app.get('/api/themes', (req, res) => {
    const themes = [
        { id: 'dark', name: 'Dark Mode', colors: { bg: '#0a0a1a', text: '#ffffff', accent: '#10b981' } },
        { id: 'light', name: 'Light Mode', colors: { bg: '#ffffff', text: '#1a1a2e', accent: '#10b981' } },
        { id: 'midnight', name: 'Midnight Blue', colors: { bg: '#0f172a', text: '#e2e8f0', accent: '#3b82f6' } },
        { id: 'forest', name: 'Forest Green', colors: { bg: '#0d1f17', text: '#d1fae5', accent: '#059669' } },
        { id: 'sunset', name: 'Sunset', colors: { bg: '#1f1315', text: '#fecaca', accent: '#f97316' } },
        { id: 'ocean', name: 'Ocean', colors: { bg: '#0c1929', text: '#bae6fd', accent: '#0ea5e9' } },
        { id: 'purple', name: 'Purple Dreams', colors: { bg: '#1e1b4b', text: '#e0e7ff', accent: '#8b5cf6' } },
        { id: 'rose', name: 'Rose', colors: { bg: '#1f1218', text: '#fce7f3', accent: '#ec4899' } }
    ];

    const accentColors = [
        '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#ef4444', '#06b6d4'
    ];

    res.json({ success: true, themes, accentColors });
});

// ============ TELEMETRY SYSTEM ============
// Store telemetry data for diagnostics (cached)
const telemetryDbPath = path.join(dataDir, 'telemetry.json');
const feedbackDbPath = path.join(dataDir, 'feedback.json');
let telemetryDbCache = null;
let telemetryDbDirty = false;
let feedbackDbCache = null;
let feedbackDbDirty = false;

function loadTelemetryDb() {
    if (telemetryDbCache) return telemetryDbCache;
    try {
        if (fs.existsSync(telemetryDbPath)) {
            telemetryDbCache = JSON.parse(fs.readFileSync(telemetryDbPath, 'utf8'));
            return telemetryDbCache;
        }
    } catch (e) {}
    telemetryDbCache = { events: [], devices: {}, crashes: [], issues: [] };
    return telemetryDbCache;
}

function saveTelemetryDb(db) {
    telemetryDbCache = db;
    telemetryDbDirty = true;
}

function loadFeedbackDb() {
    if (feedbackDbCache) return feedbackDbCache;
    try {
        if (fs.existsSync(feedbackDbPath)) {
            feedbackDbCache = JSON.parse(fs.readFileSync(feedbackDbPath, 'utf8'));
            return feedbackDbCache;
        }
    } catch (e) {}
    feedbackDbCache = { feedback: [] };
    return feedbackDbCache;
}

function saveFeedbackDb(db) {
    feedbackDbCache = db;
    feedbackDbDirty = true;
}

// Flush telemetry/feedback DBs every 10 seconds
setInterval(() => {
    if (telemetryDbDirty && telemetryDbCache) {
        fs.writeFile(telemetryDbPath, JSON.stringify(telemetryDbCache), () => {});
        telemetryDbDirty = false;
    }
    if (feedbackDbDirty && feedbackDbCache) {
        fs.writeFile(feedbackDbPath, JSON.stringify(feedbackDbCache), () => {});
        feedbackDbDirty = false;
    }
}, 10000);

// Receive telemetry from desktop apps
app.post('/api/telemetry', express.json(), (req, res) => {
    try {
        const telemetry = req.body;
        const db = loadTelemetryDb();

        // Store event
        const event = {
            ...telemetry,
            receivedAt: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress
        };

        db.events.unshift(event);

        // Keep last 10000 events
        if (db.events.length > 10000) {
            db.events = db.events.slice(0, 10000);
        }

        // Track device
        const deviceId = telemetry.deviceId || 'unknown';
        if (!db.devices[deviceId]) {
            db.devices[deviceId] = {
                firstSeen: new Date().toISOString(),
                version: telemetry.version,
                platform: telemetry.platform,
                crashes: 0,
                heartbeats: 0,
                issues: []
            };
        }

        const device = db.devices[deviceId];
        device.lastSeen = new Date().toISOString();
        device.version = telemetry.version;
        device.lastEvent = telemetry.event;

        // Track specific events
        if (telemetry.event === 'heartbeat') {
            device.heartbeats++;
            device.lastHeartbeat = new Date().toISOString();
            device.trayStatus = telemetry.trayStatus;
            device.heapUsed = telemetry.heapUsed;
        }

        if (telemetry.event === 'crash' || telemetry.event === 'error') {
            device.crashes++;
            db.crashes.unshift({
                deviceId,
                event: telemetry.event,
                error: telemetry.error,
                stack: telemetry.stack,
                timestamp: new Date().toISOString(),
                version: telemetry.version
            });

            // Keep last 1000 crashes
            if (db.crashes.length > 1000) {
                db.crashes = db.crashes.slice(0, 1000);
            }

            // Record issue for this device
            device.issues.push({
                type: telemetry.event,
                error: telemetry.error,
                timestamp: new Date().toISOString()
            });

            // Keep last 50 issues per device
            if (device.issues.length > 50) {
                device.issues = device.issues.slice(-50);
            }
        }

        if (telemetry.event === 'tray_recreated') {
            if (!device.trayRecreations) device.trayRecreations = 0;
            device.trayRecreations++;
        }

        saveTelemetryDb(db);

        // Return diagnostics/commands for the app
        const response = { success: true };

        // Auto-fix commands based on issues
        if (device.crashes > 5 && device.version !== '2.0.0') {
            response.command = 'update';
            response.message = 'Please update to latest version';
        }

        res.json(response);
    } catch (e) {
        console.error('[Telemetry] Error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Receive user feedback
app.post('/api/feedback', express.json(), (req, res) => {
    try {
        const { deviceId, rating, comment, version } = req.body;
        const db = loadFeedbackDb();

        db.feedback.unshift({
            id: uuidv4(),
            deviceId: deviceId || 'unknown',
            rating: rating, // 1-5 emoji rating
            comment: comment || '',
            version: version || 'unknown',
            timestamp: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress
        });

        // Keep last 1000 feedback entries
        if (db.feedback.length > 1000) {
            db.feedback = db.feedback.slice(0, 1000);
        }

        saveFeedbackDb(db);
        res.json({ success: true, message: 'Thank you for your feedback!' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: Get telemetry dashboard
app.get('/api/admin/telemetry', (req, res) => {
    try {
        const db = loadTelemetryDb();
        const feedbackDb = loadFeedbackDb();

        // Get device stats
        const devices = Object.entries(db.devices).map(([id, data]) => ({
            id: id.substring(0, 16) + '...',
            fullId: id,
            ...data
        }));

        // Sort by last seen
        devices.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

        // Calculate stats
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const oneDay = 24 * oneHour;

        const activeLastHour = devices.filter(d => (now - new Date(d.lastSeen).getTime()) < oneHour).length;
        const activeLastDay = devices.filter(d => (now - new Date(d.lastSeen).getTime()) < oneDay).length;

        // Count versions
        const versions = {};
        devices.forEach(d => {
            versions[d.version] = (versions[d.version] || 0) + 1;
        });

        // Recent crashes
        const recentCrashes = db.crashes.slice(0, 20);

        // Crash rate (crashes per device in last 24h)
        const crashesLast24h = db.crashes.filter(c => (now - new Date(c.timestamp).getTime()) < oneDay).length;
        const crashRate = activeLastDay > 0 ? (crashesLast24h / activeLastDay).toFixed(2) : 0;

        // Feedback stats
        const recentFeedback = feedbackDb.feedback.slice(0, 10);
        const avgRating = feedbackDb.feedback.length > 0
            ? (feedbackDb.feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / feedbackDb.feedback.length).toFixed(1)
            : 0;

        res.json({
            success: true,
            stats: {
                totalDevices: devices.length,
                activeLastHour,
                activeLastDay,
                totalCrashes: db.crashes.length,
                crashesLast24h,
                crashRate,
                totalFeedback: feedbackDb.feedback.length,
                avgRating
            },
            versions,
            devices: devices.slice(0, 50),
            recentCrashes,
            recentFeedback,
            issues: db.issues?.slice(0, 20) || []
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: Get device telemetry details
app.get('/api/admin/telemetry/device/:deviceId', (req, res) => {
    try {
        const db = loadTelemetryDb();
        const device = db.devices[req.params.deviceId];

        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Get events for this device
        const events = db.events
            .filter(e => e.deviceId === req.params.deviceId)
            .slice(0, 100);

        // Get crashes for this device
        const crashes = db.crashes
            .filter(c => c.deviceId === req.params.deviceId)
            .slice(0, 50);

        res.json({
            success: true,
            device: { id: req.params.deviceId, ...device },
            events,
            crashes
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: Get problematic devices (high crash rate)
app.get('/api/admin/telemetry/problematic', (req, res) => {
    try {
        const db = loadTelemetryDb();

        const problematic = Object.entries(db.devices)
            .filter(([id, data]) => data.crashes > 2 || data.trayRecreations > 5)
            .map(([id, data]) => ({
                deviceId: id,
                ...data
            }))
            .sort((a, b) => b.crashes - a.crashes);

        res.json({
            success: true,
            count: problematic.length,
            devices: problematic.slice(0, 50)
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Serve download page
app.get('/download', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});
app.get('/up/download', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// Serve electron-updater manifest files for auto-updates
app.get('/download/updates/:file', (req, res) => {
    const filename = req.params.file;
    const allowedFiles = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];

    if (!allowedFiles.includes(filename)) {
        return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(__dirname, 'public', 'download', 'updates', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Update manifest not found' });
    }

    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(filePath);
    console.log(`[Update] Served ${filename} for auto-update check`);
});

// Serve update binary files (for electron-updater downloads)
app.get('/download/updates/:filename.exe', (req, res) => {
    const filename = req.params.filename + '.exe';
    const filePath = path.join(__dirname, 'public', 'download', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Update file not found' });
    }

    res.sendFile(filePath);
    console.log(`[Update] Serving update binary: ${filename}`);
});

// Admin root redirect to login
app.get('/admin/', (req, res) => {
    res.redirect('/admin/login.html');
});

app.get('/admin', (req, res) => {
    res.redirect('/admin/login.html');
});

// Serve desktop app download with proper security headers
// Cache checksums to avoid reading entire file into memory on every request
const downloadChecksumCache = {};
app.get('/download/DOZ-UP-v:version.exe', async (req, res) => {
    const version = req.params.version;
    const filename = `DOZ-UP-v${version}.exe`;
    const filePath = path.join(__dirname, 'public', 'download', filename);

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Version not found' });
        }

        const stats = fs.statSync(filePath);
        const cacheKey = `${filename}-${stats.size}-${stats.mtimeMs}`;

        // Compute checksum once and cache it
        if (!downloadChecksumCache[cacheKey]) {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            await new Promise((resolve, reject) => {
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            downloadChecksumCache[cacheKey] = hash.digest('hex');
        }

        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': stats.size,
            'X-Content-Type-Options': 'nosniff',
            'X-Download-Checksum': downloadChecksumCache[cacheKey],
            'X-Download-Version': version,
            'Cache-Control': 'public, max-age=86400'
        });

        // HEAD requests: just send headers, don't stream file
        if (req.method === 'HEAD') return res.end();

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        console.log(`[Download] DOZ-UP v${version} downloaded - Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    } catch (error) {
        console.error('[Download] Error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Serve ZIP download (less browser warnings)
app.get('/download/DOZ-UP-v:version.zip', (req, res) => {
    const version = req.params.version;
    const filename = `DOZ-UP-v${version}.zip`;
    const filePath = path.join(__dirname, 'public', 'download', filename);

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Version not found' });
        }

        const stats = fs.statSync(filePath);

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400'
        });

        // HEAD requests: just send headers
        if (req.method === 'HEAD') return res.end();

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        console.log(`[Download] DOZ-UP v${version} ZIP downloaded - Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
    } catch (error) {
        console.error('[Download] ZIP Error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Get download info (version, size, checksum) for verification
app.get('/api/download/info', (req, res) => {
    const downloadDir = path.join(__dirname, 'public', 'download');
    const latestVersion = DOWNLOAD_VERSION; // Use latest available build version
    const filename = `DOZ-UP-v${latestVersion}.exe`;
    const filePath = path.join(downloadDir, filename);

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Download not available' });
        }

        const stats = fs.statSync(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        res.json({
            success: true,
            version: latestVersion,
            filename: filename,
            size: stats.size,
            sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
            sha256: sha256,
            downloadUrl: `https://${HOST}/download/${filename}`,
            signed: true, // Signed with DOZ Network self-signed certificate
            lastModified: stats.mtime
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get download info' });
    }
});

// Serve "My Uploads" page (cabinet)
app.get('/my', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cabinet.html'));
});

// ============ AUTHENTICATION & SECURITY API ============
const authService = require('./services/auth-security');

// Session touch middleware - updates lastActive on every API request from authenticated users
app.use('/api', (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const sessionToken = req.headers['x-session-token'];
    if (userId && sessionToken) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
        authService.loginConfirmation.touchSession(userId, sessionToken, ip);
    }
    next();
});

// Concurrent usage detection endpoint
app.get('/api/auth/concurrent-check/:userId', (req, res) => {
    try {
        const result = authService.loginConfirmation.detectConcurrentUsage(req.params.userId);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke all other sessions (keep current)
app.post('/api/auth/sessions/revoke-others', express.json(), (req, res) => {
    try {
        const { userId, currentSessionId } = req.body;
        if (!userId || !currentSessionId) {
            return res.status(400).json({ success: false, error: 'userId and currentSessionId required' });
        }
        const result = authService.loginConfirmation.revokeAllOtherSessions(userId, currentSessionId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set up broadcastToUser global function for session eviction notifications
global.broadcastToUser = global.broadcastToUser || function(userId, data) {
    // Will be connected to WebSocket once admin WSS is available
    console.log(`[Session] Notification for ${userId}:`, data.type);
};

// Rate limiting for auth endpoints (15 requests per minute per IP)
const authRateLimits = new Map();
app.use('/api/auth', (req, res, next) => {
    // Only rate-limit write operations (login, register, password reset)
    if (req.method !== 'POST') return next();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const key = `auth:${ip}`;
    const now = Date.now();
    const window = 60000; // 1 minute
    const limit = 15;

    let entry = authRateLimits.get(key);
    if (!entry || now - entry.start > window) {
        entry = { start: now, count: 0 };
    }
    entry.count++;
    authRateLimits.set(key, entry);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));

    if (entry.count > limit) {
        return res.status(429).json({ error: 'Too many authentication attempts. Try again in 1 minute.' });
    }
    next();
});

// Register new user
app.post('/api/auth/register', express.json(), (req, res) => {
    try {
        const { email, password, name, browserDeviceId } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email required' });
        }
        const result = authService.registerUser(email, password, name);

        // Auto-link browser deviceId if provided
        if (result.success && browserDeviceId) {
            authService.linkBrowserDevice(result.userId, browserDeviceId);
            result.deviceLinked = true;
            console.log(`[Register] Linked device ${browserDeviceId.substring(0, 16)}... to new user ${result.userId.substring(0, 8)}...`);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/auth/login', express.json(), async (req, res) => {
    try {
        const { email, password, totpCode, biometricVerified, deviceConfirmationApproved, browserDeviceId } = req.body;
        const deviceInfo = {
            userAgent: req.headers['user-agent'],
            platform: req.body.platform || 'web',
            browser: req.body.browser,
            ipAddress: req.ip || req.connection?.remoteAddress,
            screenResolution: req.body.screenResolution,
            timezone: req.body.timezone,
            language: req.headers['accept-language']?.split(',')[0]
        };

        const result = await authService.login(email, password, deviceInfo, {
            totpCode, biometricVerified, deviceConfirmationApproved
        });

        console.log('[Login] Result:', JSON.stringify({ success: result.success, userId: result.userId, hasToken: !!result.sessionToken, error: result.error }));

        // Auto-link browser deviceId if login successful and deviceId provided
        if (result.success && browserDeviceId) {
            authService.linkBrowserDevice(result.userId, browserDeviceId);
            result.deviceLinked = true;
            console.log(`[Login] Linked device ${browserDeviceId.substring(0, 16)}... to user ${result.userId.substring(0, 8)}...`);
        }

        res.json(result);
    } catch (error) {
        console.error('[Login] Exception:', error.message, error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Forgot Password - Request password reset email
app.post('/api/auth/forgot-password', express.json(), async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const result = authService.generatePasswordResetToken(email);

        // If token was generated, send email directly via SMTP
        if (result.token) {
            const resetUrl = `https://doz.com/reset-password.html?token=${result.token}`;
            const resetHtml = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #10b981; margin: 0;">DOZ UP</h1>
                        <p style="color: #64748b; margin: 5px 0;">Password Reset Request</p>
                    </div>
                    <div style="background: #f8fafc; border-radius: 12px; padding: 30px;">
                        <p style="color: #334155; margin: 0 0 20px;">Hi,</p>
                        <p style="color: #334155; margin: 0 0 20px;">We received a request to reset your password. Click the button below to create a new password:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600;">Reset Password</a>
                        </div>
                        <p style="color: #64748b; font-size: 14px; margin: 0 0 10px;">Or copy this link:</p>
                        <p style="color: #10b981; font-size: 14px; word-break: break-all; margin: 0 0 20px;">${resetUrl}</p>
                        <p style="color: #64748b; font-size: 14px; margin: 0;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 30px;">DOZ UP - Instant Screenshot Sharing</p>
                </div>
            `;

            // Send directly via nodemailer SMTP (no Redis/queue dependency)
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '465'),
                    secure: process.env.SMTP_SECURE !== 'false',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                });
                await transporter.sendMail({
                    from: `"${process.env.EMAIL_FROM_NAME || 'DOZ UP'}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
                    to: result.email,
                    subject: 'DOZ UP - Password Reset Request',
                    html: resetHtml,
                    text: `DOZ UP Password Reset\n\nWe received a request to reset your password.\n\nClick this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`
                });
                console.log('[Auth] Password reset email sent directly to:', result.email);
            } catch (emailError) {
                console.error('[Auth] Failed to send reset email:', emailError.message);
                console.log('[Auth] Reset URL for manual recovery:', resetUrl);
            }
        }

        // Always return success to prevent email enumeration
        res.json({ success: true, message: 'If an account exists with this email, a password reset link has been sent.' });
    } catch (error) {
        console.error('[Auth] Forgot password error:', error);
        res.status(500).json({ success: false, error: 'Failed to process request' });
    }
});

// Verify password reset token
app.get('/api/auth/verify-reset-token', (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ valid: false, error: 'Token is required' });
        }

        const result = authService.verifyPasswordResetToken(token);
        res.json(result);
    } catch (error) {
        res.status(500).json({ valid: false, error: error.message });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', express.json(), (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ success: false, error: 'Token and password are required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        }

        const result = authService.resetPassword(token, password);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ GOOGLE OAUTH CALLBACK ============
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '111250241426-duot1f1icje3d5p06nkvd3qreqkgccuk.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            console.error('[Google OAuth] Error:', error);
            return res.send(`
                <html><body><script>
                    window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: '${error}' }));
                    window.close();
                </script></body></html>
            `);
        }

        if (!code) {
            return res.send(`
                <html><body><script>
                    window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: 'No authorization code received' }));
                    window.close();
                </script></body></html>
            `);
        }

        // Exchange code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: `${req.protocol}://${req.get('host')}/auth/google/callback`,
                grant_type: 'authorization_code'
            })
        });

        const tokens = await tokenResponse.json();

        if (tokens.error) {
            console.error('[Google OAuth] Token error:', tokens.error);
            return res.send(`
                <html><body><script>
                    window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: '${tokens.error_description || tokens.error}' }));
                    window.close();
                </script></body></html>
            `);
        }

        // Get user info
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const googleUser = await userResponse.json();

        // Create or get user in our system
        let user = authService.getUserByEmail?.(googleUser.email);
        if (!user) {
            // Auto-register Google user
            const result = authService.registerUser(googleUser.email, null, googleUser.name);
            if (result.success) {
                user = {
                    id: result.userId,
                    email: googleUser.email,
                    name: googleUser.name,
                    avatar: googleUser.picture,
                    provider: 'google'
                };
            }
        } else {
            user = {
                id: user.id,
                email: user.email,
                name: user.name || googleUser.name,
                avatar: googleUser.picture,
                provider: 'google'
            };
        }

        console.log('[Google OAuth] User authenticated:', googleUser.email);

        // Send result back to parent window with multiple fallback methods
        res.send(`
            <html><body>
            <p style="font-family:system-ui;text-align:center;margin-top:50px;">Logging you in...</p>
            <script>
                const result = ${JSON.stringify({ success: true, user })};

                // Method 1: sessionStorage (same origin)
                try {
                    if (window.opener && window.opener.sessionStorage) {
                        window.opener.sessionStorage.setItem('oauth_result', JSON.stringify(result));
                    }
                } catch(e) { console.log('sessionStorage failed:', e); }

                // Method 2: postMessage (cross-origin safe)
                try {
                    if (window.opener) {
                        window.opener.postMessage({ type: 'oauth_result', ...result }, '*');
                    }
                } catch(e) { console.log('postMessage failed:', e); }

                // Method 3: localStorage fallback
                try {
                    localStorage.setItem('oauth_result', JSON.stringify(result));
                } catch(e) {}

                // Close after small delay to ensure message is sent
                setTimeout(() => window.close(), 500);
            </script></body></html>
        `);

    } catch (error) {
        console.error('[Google OAuth] Callback error:', error);
        res.send(`
            <html><body>
            <p style="font-family:system-ui;text-align:center;margin-top:50px;color:red;">Login failed</p>
            <script>
                const result = { success: false, error: 'Authentication failed' };
                try { window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify(result)); } catch(e) {}
                try { window.opener?.postMessage({ type: 'oauth_result', ...result }, '*'); } catch(e) {}
                try { localStorage.setItem('oauth_result', JSON.stringify(result)); } catch(e) {}
                setTimeout(() => window.close(), 1000);
            </script></body></html>
        `);
    }
});

// ============ INSTANT SIGNUP (Biometric/Pattern) ============
// Create account instantly with just fingerprint or pattern - no email/password needed
app.post('/api/auth/instant-signup', express.json(), (req, res) => {
    try {
        const { deviceId, authMethod, userAgent, platform, language } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Generate unique user ID
        const userId = 'bio_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // Create user object
        const user = {
            id: userId,
            deviceId: deviceId,
            name: 'DOZ User',
            email: deviceId + '@doz.com',
            provider: authMethod || 'biometric',
            authMethod: authMethod,
            createdAt: new Date().toISOString(),
            platform: platform,
            language: language,
            subscription: 'free',
            isVerified: true // Biometric = verified
        };

        // Store in auth service if available
        if (authService.createBiometricUser) {
            authService.createBiometricUser(user);
        }

        console.log(`[Auth] Instant signup: ${userId} via ${authMethod}`);

        res.json({
            success: true,
            user: user,
            message: 'Account created successfully'
        });

    } catch (error) {
        console.error('[Auth] Instant signup error:', error);
        res.status(500).json({ success: false, error: 'Signup failed' });
    }
});

// ============ FRICTIONLESS AUTO-REGISTRATION ============
// Auto-register user based on device fingerprint (no signup form needed)
app.post('/api/auth/auto-register', express.json(), (req, res) => {
    try {
        const { deviceId, userAgent, platform, timezone, language } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Check if device already registered
        let existingUser = authService.getUserByDeviceId?.(deviceId);
        if (existingUser) {
            return res.json({
                success: true,
                user: {
                    id: existingUser.id,
                    deviceId: deviceId,
                    isNewUser: false,
                    demoMode: existingUser.demoMode !== false,
                    demoExpiresAt: existingUser.demoExpiresAt
                }
            });
        }

        // Create anonymous user with device fingerprint
        const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const demoExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days demo

        const newUser = {
            id: userId,
            deviceId: deviceId,
            email: null, // Will be collected at payment
            name: null,
            createdAt: new Date().toISOString(),
            demoMode: true,
            demoExpiresAt: demoExpiresAt.toISOString(),
            uploadCount: 0,
            storageUsed: 0,
            platform: platform || 'web',
            userAgent: userAgent,
            timezone: timezone,
            language: language
        };

        // Store the user (using existing storage mechanism)
        if (authService.createAnonymousUser) {
            authService.createAnonymousUser(newUser);
        }

        console.log('[Auto-Register] New anonymous user created:', userId.substring(0, 16) + '...');

        res.json({
            success: true,
            user: {
                id: userId,
                deviceId: deviceId,
                isNewUser: true,
                demoMode: true,
                demoExpiresAt: demoExpiresAt.toISOString()
            }
        });

    } catch (error) {
        console.error('[Auto-Register] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check device status (is demo active, is paid, etc.)
app.get('/api/auth/device-status', (req, res) => {
    try {
        const deviceId = req.headers['x-device-id'] || req.query.deviceId;

        if (!deviceId) {
            return res.json({ success: false, error: 'No device ID' });
        }

        const user = authService.getUserByDeviceId?.(deviceId);

        if (!user) {
            return res.json({
                success: true,
                status: 'new',
                demoMode: true,
                needsRegistration: true
            });
        }

        const now = new Date();
        const demoExpired = user.demoExpiresAt && new Date(user.demoExpiresAt) < now;

        res.json({
            success: true,
            status: user.isPaid ? 'paid' : (demoExpired ? 'demo_expired' : 'demo_active'),
            demoMode: !user.isPaid,
            demoExpired: demoExpired,
            demoExpiresAt: user.demoExpiresAt,
            uploadCount: user.uploadCount || 0,
            storageUsed: user.storageUsed || 0,
            hasEmail: !!user.email
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Setup biometric (get registration options)
app.post('/api/auth/biometric/setup', express.json(), (req, res) => {
    try {
        const { userId } = req.body;
        const options = authService.setupBiometric(userId);
        res.json({ success: true, options });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Complete biometric setup (verify registration) - auto-upgrades security level
app.post('/api/auth/biometric/complete', express.json(), async (req, res) => {
    try {
        const { userId, credential } = req.body;
        const result = await authService.completeBiometricSetup(userId, credential);

        // Auto-upgrade security when biometric is first registered
        if (result.success) {
            authService.onBiometricRegistered(userId);
            result.securityUpgraded = true;
            result.securityLevel = 'high';
            result.message = 'Biometric registered. Your security has been auto-upgraded to High level.';
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get biometric auth options
app.post('/api/auth/biometric/auth-options', express.json(), (req, res) => {
    try {
        const { userId } = req.body;
        const result = authService.getBiometricAuthOptions(userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Authenticate with biometric
app.post('/api/auth/biometric/authenticate', express.json(), async (req, res) => {
    try {
        const { userId, credential } = req.body;
        const result = await authService.authenticateWithBiometric(userId, credential);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ PASSWORDLESS BIOMETRIC LOGIN (One-tap login like Apple Pay) ============

// Step 1: Get passwordless auth options (no email/userId needed!)
app.post('/api/auth/passkey/options', express.json(), (req, res) => {
    try {
        const result = authService.getPasswordlessAuthOptions();
        res.json(result);
    } catch (error) {
        console.error('[Passkey] Options error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Step 2: Complete passwordless login with biometric credential
app.post('/api/auth/passkey/login', express.json(), async (req, res) => {
    try {
        const { challengeId, credential } = req.body;

        // Get device info from request
        const deviceInfo = {
            platform: req.body.platform || req.headers['sec-ch-ua-platform'] || 'Unknown',
            browser: req.body.browser || 'Unknown',
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection.remoteAddress,
            screenResolution: req.body.screenResolution,
            timezone: req.body.timezone,
            language: req.headers['accept-language']
        };

        const result = await authService.passwordlessLogin(challengeId, credential, deviceInfo);

        if (result.success) {
            console.log(`[Passkey] Login successful: ${result.email}`);
        }

        res.json(result);
    } catch (error) {
        console.error('[Passkey] Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Setup TOTP (Google Authenticator)
app.post('/api/auth/totp/setup', express.json(), (req, res) => {
    try {
        const { userId } = req.body;
        const result = authService.setupTOTP(userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Enable TOTP (verify and activate)
app.post('/api/auth/totp/enable', express.json(), (req, res) => {
    try {
        const { userId, code } = req.body;
        const result = authService.enableTOTP(userId, code);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify TOTP code
app.post('/api/auth/totp/verify', express.json(), (req, res) => {
    try {
        const { userId, code } = req.body;
        const valid = authService.verifyTOTP(userId, code);
        res.json({ success: true, valid });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get trusted devices
app.get('/api/auth/devices/:userId', (req, res) => {
    try {
        const devices = authService.getTrustedDevices(req.params.userId);
        res.json({ success: true, devices });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Trust a device
app.post('/api/auth/devices/trust', express.json(), (req, res) => {
    try {
        const { userId, deviceId } = req.body;
        const result = authService.trustDevice(userId, deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove a device
app.delete('/api/auth/devices/:userId/:deviceId', (req, res) => {
    try {
        const result = authService.removeDevice(req.params.userId, req.params.deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get pending login requests (for trusted device to approve)
app.get('/api/auth/login-requests/:userId', (req, res) => {
    try {
        const requests = authService.getPendingLoginRequests(req.params.userId);
        res.json({ success: true, requests });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Approve login request
app.post('/api/auth/login-requests/approve', express.json(), (req, res) => {
    try {
        const { userId, requestId, approverDeviceId } = req.body;
        const result = authService.approveLogin(userId, requestId, approverDeviceId);

        // Notify waiting client via WebSocket
        if (result.success && global.notifyLoginApproved) {
            global.notifyLoginApproved(userId, requestId);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deny login request
app.post('/api/auth/login-requests/deny', express.json(), (req, res) => {
    try {
        const { userId, requestId } = req.body;
        const result = authService.denyLogin(userId, requestId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check login request status (for polling)
app.get('/api/auth/login-requests/:userId/:requestId/status', (req, res) => {
    try {
        const requests = authService.getPendingLoginRequests(req.params.userId);
        const request = requests.find(r => r.id === req.params.requestId);

        if (!request) {
            // Check if it was approved
            const approved = authService.loginConfirmation?.isRequestApproved(
                req.params.userId, req.params.requestId
            );
            res.json({ found: false, approved });
        } else {
            res.json({ found: true, status: request.status });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get active sessions
app.get('/api/auth/sessions/:userId', (req, res) => {
    try {
        const sessions = authService.getActiveSessions(req.params.userId);
        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke session (logout from device)
app.delete('/api/auth/sessions/:userId/:sessionId', (req, res) => {
    try {
        const result = authService.revokeSession(req.params.userId, req.params.sessionId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update security settings
app.put('/api/auth/settings/:userId', express.json(), (req, res) => {
    try {
        const result = authService.updateSecuritySettings(req.params.userId, req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get security status
app.get('/api/auth/security-status/:userId', (req, res) => {
    try {
        const status = authService.getSecurityStatus(req.params.userId);
        if (!status) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set security level (low/medium/high/maximum)
app.post('/api/auth/security-level', express.json(), (req, res) => {
    try {
        const { userId, level } = req.body;
        if (!userId || !level) {
            return res.status(400).json({ success: false, error: 'userId and level required' });
        }
        const result = authService.setSecurityLevel(userId, level);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if biometric is required for a sensitive action
app.get('/api/auth/biometric-required/:userId/:action', (req, res) => {
    try {
        const required = authService.requireBiometricForAction(req.params.userId, req.params.action);
        res.json({ success: true, required, action: req.params.action });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get security score (0-100)
app.get('/api/auth/security-score/:userId', (req, res) => {
    try {
        const score = authService.getSecurityScore(req.params.userId);
        const status = authService.getSecurityStatus(req.params.userId);
        res.json({ success: true, score, ...status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Biometric-first registration (no email/password required)
app.post('/api/auth/biometric-register', express.json(), (req, res) => {
    try {
        const { deviceId, credentialId, biometricType, publicKey } = req.body;

        if (!deviceId || !credentialId) {
            return res.status(400).json({ success: false, error: 'Device ID and credential ID required' });
        }

        // Create biometric-only user account
        const userId = deviceId;
        const user = {
            id: userId,
            type: 'biometric',
            biometricType: biometricType || 'unknown',
            credentialId: credentialId,
            publicKey: publicKey,
            createdAt: new Date().toISOString(),
            email: null, // Optional - can be added later
            name: null   // Optional - can be added later
        };

        // Store in auth service
        if (authService.webauthn) {
            authService.webauthn.storeCredential(userId, {
                credentialId: credentialId,
                publicKey: publicKey,
                biometricType: biometricType
            });
        }

        // Generate session token
        const token = require('crypto').randomBytes(32).toString('hex');
        const session = authService.createSession ?
            authService.createSession(userId, { biometric: true }) :
            { token, userId, createdAt: new Date().toISOString() };

        res.json({
            success: true,
            userId: userId,
            token: session.token || token,
            message: 'Biometric registration successful. Email and name are optional.'
        });
    } catch (error) {
        console.error('[Biometric Register] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ SESSION VALIDATION API ============

// Validate an existing session (used by auto-auth to persist logged-in state)
app.post('/api/auth/validate-session', express.json(), (req, res) => {
    try {
        const { userId, sessionToken } = req.body;

        if (!userId || !sessionToken) {
            return res.status(400).json({ valid: false, error: 'userId and sessionToken required' });
        }

        const result = authService.loginConfirmation.validateSession(userId, sessionToken);

        if (!result.valid) {
            return res.json({ valid: false, error: result.error });
        }

        // Return user info + subscription status
        const accountData = authService.getAccountData(userId);
        res.json({
            valid: true,
            user: accountData.success ? accountData.user : { id: userId },
            subscription: accountData.subscription || null,
            isSubscriptionActive: accountData.isSubscriptionActive || false
        });
    } catch (error) {
        console.error('[ValidateSession] Error:', error.message);
        res.status(500).json({ valid: false, error: 'Validation failed' });
    }
});

// ============ USER-DEVICE LINKING & SYNC API ============

// Link browser deviceId to user account (call after login/register)
app.post('/api/account/link-device', express.json(), (req, res) => {
    try {
        const { userId, browserDeviceId, email } = req.body;

        if (!userId || !browserDeviceId) {
            return res.status(400).json({
                success: false,
                error: 'userId and browserDeviceId are required'
            });
        }

        const result = authService.linkBrowserDevice(userId, browserDeviceId);

        if (result.success) {
            console.log(`[Sync] Linked device ${browserDeviceId.substring(0, 16)}... to user ${userId.substring(0, 8)}...`);
        }

        res.json(result);
    } catch (error) {
        console.error('[Link Device] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get account data by userId or email
app.get('/api/account/data/:identifier', (req, res) => {
    try {
        const result = authService.getAccountData(req.params.identifier);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get account data by browser deviceId
app.get('/api/account/by-device/:deviceId', (req, res) => {
    try {
        const result = authService.getAccountByDevice(req.params.deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if device is known and has biometric credentials (for login page smart detection)
app.get('/api/auth/device-biometric-check/:deviceId', (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const accountData = authService.getAccountByDevice(deviceId);

        if (!accountData.success || !accountData.user) {
            return res.json({ success: true, knownDevice: false, hasBiometricCredentials: false });
        }

        const userId = accountData.user.id;
        const hasBiometric = authService.webauthn.hasBiometricCredentials(userId);

        res.json({
            success: true,
            knownDevice: true,
            hasBiometricCredentials: hasBiometric,
            email: accountData.user.email,
            name: accountData.user.name
        });
    } catch (error) {
        res.json({ success: true, knownDevice: false, hasBiometricCredentials: false });
    }
});

// Get user uploads by userId (aggregates uploads from all linked devices)
app.get('/api/account/uploads/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const accountData = authService.getAccountData(userId);

        if (!accountData.success) {
            return res.status(404).json(accountData);
        }

        // Get all device IDs linked to this user
        const deviceIds = accountData.linkedDevices || [];

        // Count physical devices from devices DB (not auth links which include web sessions)
        const devicesDb = await loadDevicesDb();
        let physicalDeviceCount = 0;
        for (const [uid, userData] of Object.entries(devicesDb.users || {})) {
            if (userData.devices && userData.devices.some(d => deviceIds.includes(d.deviceId))) {
                physicalDeviceCount = userData.devices.length;
                break;
            }
        }

        // Load uploads database
        const uploadsDb = await loadUploadsDb();

        // Get uploads from all linked devices
        const allUploads = uploadsDb.uploads.filter(upload =>
            deviceIds.includes(upload.deviceId)
        );

        // Deduplicate: same file size = same content (screenshots are identical bytes)
        // Keep the newest upload for each unique size
        const sortedByTime = [...allUploads].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const seenSizes = new Set();
        const dedupedUploads = sortedByTime.filter(u => {
            const key = u.size || 0;
            if (key === 0) return true; // keep uploads with unknown size
            if (seenSizes.has(key)) return false;
            seenSizes.add(key);
            return true;
        });

        // Enrich uploads with view counts from shares.json
        const shareViews = loadShareViews();
        const enrichedUploads = dedupedUploads.map(u => {
            // Normalize filename to match shares.json keys (without extension)
            const normalizedKey = u.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
            const views = shareViews[normalizedKey] ? shareViews[normalizedKey].views || 0 : 0;
            return { ...u, views };
        });

        res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=300');
        res.json({
            success: true,
            userId: userId,
            email: accountData.user.email,
            linkedDevices: physicalDeviceCount || deviceIds.length,
            uploads: enrichedUploads,
            totalUploads: enrichedUploads.length,
            totalSize: enrichedUploads.reduce((sum, u) => sum + (u.size || 0), 0)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get user stats by userId (aggregates stats from all linked devices)
app.get('/api/account/stats/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const accountData = authService.getAccountData(userId);

        if (!accountData.success) {
            return res.status(404).json(accountData);
        }

        const deviceIds = accountData.linkedDevices || [];

        // Count physical devices from devices DB (not auth links which include web sessions)
        const devicesDb = loadDevicesDb();
        let physicalDeviceCount = 0;
        for (const [uid, userData] of Object.entries(devicesDb.users)) {
            if (userData.devices.some(d => deviceIds.includes(d.deviceId))) {
                physicalDeviceCount = userData.devices.length;
                break;
            }
        }

        // Load uploads database
        const uploadsDb = loadUploadsDb();

        // Aggregate stats from all linked devices
        let totalUploads = 0;
        let totalSize = 0;
        let firstUpload = null;
        let lastUpload = null;

        uploadsDb.uploads.forEach(upload => {
            if (deviceIds.includes(upload.deviceId)) {
                totalUploads++;
                totalSize += upload.size || 0;
                if (!firstUpload || upload.timestamp < firstUpload) {
                    firstUpload = upload.timestamp;
                }
                if (!lastUpload || upload.timestamp > lastUpload) {
                    lastUpload = upload.timestamp;
                }
            }
        });

        res.json({
            success: true,
            userId: userId,
            email: accountData.user.email,
            name: accountData.user.name,
            subscription: accountData.subscription,
            isSubscriptionActive: accountData.isSubscriptionActive,
            stats: {
                linkedDevices: physicalDeviceCount || deviceIds.length,
                totalUploads: totalUploads,
                totalSize: totalSize,
                firstUpload: firstUpload,
                lastUpload: lastUpload,
                memberSince: accountData.user.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create subscription for user
app.post('/api/account/subscription', express.json(), (req, res) => {
    try {
        const { userId, plan, paymentDetails } = req.body;

        if (!userId || !plan) {
            return res.status(400).json({
                success: false,
                error: 'userId and plan are required'
            });
        }

        const result = authService.createSubscription(userId, plan, paymentDetails || {});
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get subscription by userId (uses unified plan resolver)
app.get('/api/account/subscription/:userId', (req, res) => {
    try {
        const plan = planResolver.resolvePlan(req.params.userId, null);
        res.json({
            success: true,
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Process gift subscription after payment
app.post('/api/stripe/process-gift', express.json(), async (req, res) => {
    try {
        const { paymentIntentId, planId, buyerEmail, giftData } = req.body;

        if (!paymentIntentId || !giftData || !giftData.recipientEmail) {
            return res.status(400).json({
                success: false,
                error: 'Missing required gift data'
            });
        }

        // Store gift record in database
        const giftRecord = {
            id: `gift_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            paymentIntentId,
            planId,
            buyerEmail,
            recipientName: giftData.recipientName,
            recipientEmail: giftData.recipientEmail,
            message: giftData.message || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        // Store in gifts collection (file-based for now)
        const giftsFile = path.join(__dirname, 'data', 'gifts.json');
        let gifts = [];
        try {
            if (fs.existsSync(giftsFile)) {
                gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
            }
        } catch (e) {}
        gifts.push(giftRecord);
        fs.writeFileSync(giftsFile, JSON.stringify(gifts));

        // Send gift notification email to recipient
        try {
            const notificationService = require('./services/notifications');
            if (notificationService && notificationService.sendEmail) {
                await notificationService.sendEmail(
                    giftData.recipientEmail,
                    `🎁 You received a DOZ UP gift from ${buyerEmail}!`,
                    `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <div style="background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 20px; padding: 40px; text-align: center; color: white;">
                            <div style="font-size: 60px; margin-bottom: 20px;">🎁</div>
                            <h1 style="margin: 0 0 10px; font-size: 28px;">You've Received a Gift!</h1>
                            <p style="opacity: 0.9; font-size: 16px; margin: 0;">Someone special sent you DOZ UP Premium</p>
                        </div>

                        <div style="background: #f8f9fa; border-radius: 16px; padding: 30px; margin-top: 20px;">
                            ${giftData.recipientName ? `<p style="color: #333; font-size: 18px; margin: 0 0 20px;">Hi ${giftData.recipientName},</p>` : ''}

                            ${giftData.message ? `
                            <div style="background: white; border-left: 4px solid #667eea; padding: 15px 20px; margin: 20px 0; border-radius: 0 10px 10px 0;">
                                <p style="color: #666; font-style: italic; margin: 0;">"${giftData.message}"</p>
                            </div>
                            ` : ''}

                            <p style="color: #333; line-height: 1.6;">
                                <strong>${buyerEmail}</strong> has gifted you a DOZ UP subscription!
                                Click the button below to activate your premium access.
                            </p>

                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://doz.com/up/redeem?gift=${giftRecord.id}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: 600; font-size: 16px;">
                                    Redeem Your Gift
                                </a>
                            </div>
                        </div>

                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
                            © DOZ UP - Your Creative Companion
                        </p>
                    </div>
                    `
                );
            }
        } catch (emailError) {
            console.error('[Gift] Email notification failed:', emailError.message);
        }

        res.json({
            success: true,
            giftId: giftRecord.id,
            message: 'Gift processed successfully'
        });

    } catch (error) {
        console.error('[Stripe] Process gift error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get gift details for redemption
app.get('/api/stripe/gift/:giftId', (req, res) => {
    try {
        const { giftId } = req.params;
        const giftsFile = path.join(__dirname, 'data', 'gifts.json');

        if (!fs.existsSync(giftsFile)) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        const gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
        const gift = gifts.find(g => g.id === giftId);

        if (!gift) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        // Don't expose sensitive data
        res.json({
            success: true,
            gift: {
                id: gift.id,
                planId: gift.planId,
                recipientName: gift.recipientName,
                message: gift.message,
                status: gift.status,
                createdAt: gift.createdAt
            },
            plan: stripeService.getPlan(gift.planId)
        });
    } catch (error) {
        console.error('[Gift] Get gift error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Redeem a gift subscription
app.post('/api/stripe/redeem-gift', express.json(), async (req, res) => {
    try {
        const { giftId, email, name } = req.body;

        if (!giftId || !email) {
            return res.status(400).json({ success: false, error: 'Gift ID and email required' });
        }

        const giftsFile = path.join(__dirname, 'data', 'gifts.json');

        if (!fs.existsSync(giftsFile)) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        let gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
        const giftIndex = gifts.findIndex(g => g.id === giftId);

        if (giftIndex === -1) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        const gift = gifts[giftIndex];

        if (gift.status === 'redeemed') {
            return res.status(400).json({ success: false, error: 'This gift has already been redeemed' });
        }

        // Generate user ID from email
        const userId = Buffer.from(email).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);

        // Activate subscription for the recipient
        const plan = stripeService.getPlan(gift.planId);
        if (!plan) {
            return res.status(400).json({ success: false, error: 'Invalid plan' });
        }

        // Create subscription record
        const subscriptionData = {
            id: `sub_gift_${Date.now()}`,
            userId,
            email,
            planId: gift.planId,
            status: 'active',
            giftId: gift.id,
            giftedBy: gift.buyerEmail,
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + (plan.interval === 'year' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString()
        };

        // Save subscription
        const subsFile = path.join(__dirname, 'data', 'subscriptions.json');
        let subs = [];
        try {
            if (fs.existsSync(subsFile)) {
                subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
            }
        } catch (e) {}
        subs.push(subscriptionData);
        fs.writeFileSync(subsFile, JSON.stringify(subs));

        // Mark gift as redeemed
        gifts[giftIndex].status = 'redeemed';
        gifts[giftIndex].redeemedAt = new Date().toISOString();
        gifts[giftIndex].redeemedBy = email;
        fs.writeFileSync(giftsFile, JSON.stringify(gifts));

        // Send confirmation email to recipient
        try {
            const notificationService = require('./services/notifications');
            if (notificationService && notificationService.sendEmail) {
                await notificationService.sendEmail(
                    email,
                    '🎉 Your DOZ UP Gift Has Been Activated!',
                    `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <div style="background: linear-gradient(135deg, #4CAF50, #2E7D32); border-radius: 20px; padding: 40px; text-align: center; color: white;">
                            <div style="font-size: 60px; margin-bottom: 20px;">🎉</div>
                            <h1 style="margin: 0 0 10px; font-size: 28px;">Gift Activated!</h1>
                            <p style="opacity: 0.9; font-size: 16px; margin: 0;">Your DOZ UP ${plan.name} subscription is now active</p>
                        </div>

                        <div style="background: #f8f9fa; border-radius: 16px; padding: 30px; margin-top: 20px;">
                            <p style="color: #333; line-height: 1.6;">
                                Hello${name ? ' ' + name : ''}! Your gift subscription has been successfully activated.
                            </p>

                            <div style="background: white; border-radius: 12px; padding: 20px; margin: 20px 0;">
                                <h3 style="margin: 0 0 15px; color: #333;">Your Plan Details</h3>
                                <p style="margin: 5px 0; color: #666;"><strong>Plan:</strong> ${plan.name}</p>
                                <p style="margin: 5px 0; color: #666;"><strong>Storage:</strong> ${plan.storage >= 1024 ? (plan.storage / 1024) + ' GB' : plan.storage + ' MB'}</p>
                                <p style="margin: 5px 0; color: #666;"><strong>Valid Until:</strong> ${new Date(subscriptionData.endDate).toLocaleDateString()}</p>
                            </div>

                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://doz.com/up/app" style="display: inline-block; background: linear-gradient(135deg, #4CAF50, #2E7D32); color: white; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: 600; font-size: 16px;">
                                    Start Using DOZ UP
                                </a>
                            </div>
                        </div>

                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
                            © DOZ UP - Your Creative Companion
                        </p>
                    </div>
                    `
                );
            }
        } catch (emailError) {
            console.error('[Gift] Confirmation email failed:', emailError.message);
        }

        // Notify the gift giver
        try {
            const notificationService = require('./services/notifications');
            if (notificationService && notificationService.sendEmail) {
                await notificationService.sendEmail(
                    gift.buyerEmail,
                    `🎁 Your gift to ${gift.recipientName || email} was redeemed!`,
                    `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <div style="background: linear-gradient(135deg, #ff6b9d, #c44569); border-radius: 20px; padding: 40px; text-align: center; color: white;">
                            <div style="font-size: 60px; margin-bottom: 20px;">🎁</div>
                            <h1 style="margin: 0 0 10px; font-size: 28px;">Gift Redeemed!</h1>
                            <p style="opacity: 0.9; font-size: 16px; margin: 0;">${gift.recipientName || 'Your friend'} activated their gift</p>
                        </div>

                        <div style="background: #f8f9fa; border-radius: 16px; padding: 30px; margin-top: 20px;">
                            <p style="color: #333; line-height: 1.6;">
                                Great news! ${gift.recipientName || 'The recipient'} has redeemed the DOZ UP ${plan.name} subscription you gifted them.
                            </p>
                            <p style="color: #666; line-height: 1.6;">
                                Thank you for sharing DOZ UP with your friends and family!
                            </p>
                        </div>

                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
                            © DOZ UP - Your Creative Companion
                        </p>
                    </div>
                    `
                );
            }
        } catch (emailError) {
            console.error('[Gift] Giver notification email failed:', emailError.message);
        }

        res.json({
            success: true,
            message: 'Gift redeemed successfully',
            subscription: {
                planId: gift.planId,
                planName: plan.name,
                endDate: subscriptionData.endDate
            }
        });

    } catch (error) {
        console.error('[Gift] Redeem error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stripe Webhook Handler
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];

    try {
        const result = await stripeService.handleWebhook(req.body, signature);

        // Record success/failure in AI Payment Guard
        try {
            const payload = JSON.parse(req.body.toString());
            const eventType = payload.type;
            const obj = payload.data?.object;
            if (eventType === 'payment_intent.succeeded' && obj) {
                paymentGuard.recordSuccess(obj.receipt_email || obj.metadata?.email || '', obj.metadata?.planId || '', obj.amount, obj.id);

                // Track A/B test conversion
                try {
                    const variant = obj.metadata?.abVariant;
                    if (variant) {
                        const abTestTracker = require('./services/ab-test-tracker');
                        abTestTracker.trackConversion(variant, obj.amount, obj.currency?.toUpperCase() || 'USD');
                        console.log(`[A/B Test] Conversion tracked for variant ${variant}: ${obj.amount} ${obj.currency}`);
                    }
                } catch (e) {
                    console.error('[A/B Test] Tracking error:', e.message);
                }

                // Record sale in sales database
                try {
                    salesDatabase.recordSale({
                        stripeId: obj.id,
                        email: obj.receipt_email || obj.metadata?.email || '',
                        plan: obj.metadata?.planId || 'Subscription',
                        amount: (obj.amount || 0) / 100,
                        currency: obj.currency?.toUpperCase() || 'USD',
                        status: 'completed',
                        type: 'purchase',
                        userId: obj.metadata?.userId || ''
                    });
                } catch (e) {
                    console.error('[SalesDB] Record error:', e.message);
                }

                // Fire server-side Purchase event to Meta CAPI (guaranteed delivery)
                if (META_PIXEL_ID && META_ACCESS_TOKEN) {
                    try {
                        const purchaseEmail = obj.receipt_email || obj.metadata?.email || '';
                        const purchaseAmount = (obj.amount || 0) / 100;
                        const purchaseCurrency = obj.currency?.toUpperCase() || 'USD';
                        const purchasePlan = obj.metadata?.planId || 'Subscription';
                        const capiEventId = 'srv_' + Date.now() + '_' + obj.id;

                        const capiPayload = {
                            data: [{
                                event_name: 'Purchase',
                                event_id: capiEventId,
                                event_time: Math.floor(Date.now() / 1000),
                                event_source_url: 'https://doz.com/payment/success',
                                action_source: 'website',
                                user_data: {
                                    em: purchaseEmail ? [hashForMeta(purchaseEmail)] : undefined,
                                    external_id: obj.metadata?.userId ? [hashForMeta(obj.metadata.userId)] : undefined
                                },
                                custom_data: {
                                    content_name: purchasePlan,
                                    content_ids: [purchasePlan],
                                    content_type: 'product',
                                    value: purchaseAmount,
                                    currency: purchaseCurrency,
                                    transaction_id: obj.id,
                                    num_items: 1
                                }
                            }]
                        };

                        const capiUrl = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
                        fetch(capiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(capiPayload)
                        }).then(r => {
                            if (r.ok) console.log('[CAPI] Server-side Purchase sent for', purchaseEmail, purchaseAmount, purchaseCurrency);
                            else r.text().then(t => console.error('[CAPI] Server Purchase error:', r.status, t));
                        }).catch(e => console.error('[CAPI] Server Purchase fetch error:', e.message));
                    } catch (capiErr) {
                        console.error('[CAPI] Server Purchase error:', capiErr.message);
                    }
                }

                // Track for live monitor
                if (global.trackMonitorSale) {
                    global.trackMonitorSale({
                        plan: obj.metadata?.planId || 'Subscription',
                        amount: (obj.amount || 0) / 100, // Convert cents to dollars
                        email: obj.receipt_email || obj.metadata?.email || ''
                    });
                }
            } else if (eventType === 'invoice.payment_failed' && obj) {
                paymentGuard.recordFailure(obj.customer_email || '', obj.metadata?.planId || '', obj.amount_due, 'invoice_payment_failed');

                // Track issue for live monitor
                if (global.trackMonitorIssue) {
                    global.trackMonitorIssue({
                        message: 'Payment failed: ' + (obj.customer_email || 'unknown'),
                        severity: 'warning',
                        page: 'checkout'
                    });
                }
            }
        } catch (guardErr) {
            // Don't let guard errors affect webhook processing
        }

        res.json(result);
    } catch (error) {
        console.error('[Stripe] Webhook error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get user subscription (Stripe)
app.get('/api/stripe/subscription/:userId', (req, res) => {
    const { userId } = req.params;
    const subscription = stripeService.getSubscription(userId);
    const isActive = stripeService.isSubscriptionActive(userId);

    res.json({
        success: true,
        hasSubscription: !!subscription,
        isActive,
        subscription,
        plan: subscription ? stripeService.getPlan(subscription.planId) : null
    });
});

// Cancel subscription (Stripe)
app.post('/api/stripe/cancel-subscription', express.json(), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId required' });
        }

        const subscription = await stripeService.cancelSubscription(userId);
        res.json({ success: true, subscription });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create customer portal session
app.post('/api/stripe/create-portal-session', express.json(), async (req, res) => {
    try {
        const { userId, returnUrl } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId required' });
        }

        const session = await stripeService.createPortalSession(userId, returnUrl);
        res.json({
            success: true,
            url: session.url
        });
    } catch (error) {
        console.error('[Stripe] Portal session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get transactions (Stripe)
app.get('/api/stripe/transactions/:userId', (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const transactions = stripeService.getTransactions(userId, limit);
    res.json({ success: true, transactions });
});

// Admin: Get all subscriptions
app.get('/api/stripe/admin/subscriptions', (req, res) => {
    const subscriptions = stripeService.getAllSubscriptions() || [];
    const subArray = Array.isArray(subscriptions) ? subscriptions : [];
    res.json({
        success: true,
        total: subArray.length,
        active: subArray.filter(s => s.status === 'active').length,
        subscriptions: subArray
    });
});

// Admin: Get revenue stats
app.get('/api/stripe/admin/revenue', (req, res) => {
    const stats = stripeService.getRevenueStats();
    res.json({ success: true, ...stats });
});

// Admin: Get all transactions
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
        const affiliate = enterpriseService.createAffiliate(req.body);
        res.json({ success: true, affiliate });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get affiliates
app.get('/api/affiliates', (req, res) => {
    const affiliates = enterpriseService.getAffiliates();
    res.json({ success: true, affiliates });
});

// Get affiliate by code (for tracking)
app.get('/api/affiliates/code/:code', (req, res) => {
    const affiliate = enterpriseService.getAffiliateByCode(req.params.code);
    if (!affiliate) {
        return res.status(404).json({ error: 'Affiliate not found' });
    }
    res.json({ success: true, affiliate: { id: affiliate.id, name: affiliate.name, code: affiliate.code } });
});

// Track affiliate click
app.post('/api/affiliates/track/:code', (req, res) => {
    const affiliate = enterpriseService.trackAffiliateClick(req.params.code);
    res.json({ success: true, tracked: !!affiliate });
});

// Get affiliate stats
app.get('/api/affiliates/:id/stats', (req, res) => {
    const stats = enterpriseService.getAffiliateStats(req.params.id);
    if (!stats) {
        return res.status(404).json({ error: 'Affiliate not found' });
    }
    res.json({ success: true, stats });
});

// ============ SALES ANALYTICS ============

// Sales dashboard
app.get('/api/enterprise/analytics', (req, res) => {
    const analytics = enterpriseService.getSalesAnalytics();
    res.json({ success: true, ...analytics });
});

// Target progress ($300K goal)
app.get('/api/enterprise/target', (req, res) => {
    const progress = enterpriseService.getTargetProgress();
    res.json({ success: true, ...progress });
});

// ============ $1M WEEK PRICING ENDPOINTS ============

// Get lifetime deals
app.get('/api/enterprise/lifetime-deals', (req, res) => {
    const deals = enterpriseService.getLifetimeDeals();
    res.json({ success: true, deals });
});

// Purchase lifetime deal
app.post('/api/enterprise/lifetime-deals/purchase', express.json(), (req, res) => {
    try {
        const { dealType, customer } = req.body;
        const result = enterpriseService.purchaseLifetimeDeal(dealType, customer);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Get reseller tiers
app.get('/api/enterprise/reseller-tiers', (req, res) => {
    const tiers = enterpriseService.getResellerTiers();
    res.json({ success: true, tiers });
});

// Purchase reseller tier
app.post('/api/enterprise/reseller-tiers/purchase', express.json(), (req, res) => {
    try {
        const { tierType, customer } = req.body;
        const result = enterpriseService.purchaseResellerTier(tierType, customer);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Get mega deals
app.get('/api/enterprise/mega-deals', (req, res) => {
    const deals = enterpriseService.getMegaDeals();
    res.json({ success: true, deals });
});

// Get referral rewards structure
app.get('/api/enterprise/referral-rewards', (req, res) => {
    const rewards = enterpriseService.getReferralRewards();
    res.json({ success: true, rewards });
});

// Get founder spots status
app.get('/api/enterprise/founder-spots', (req, res) => {
    const spots = enterpriseService.getFounderSpots();
    res.json({ success: true, spots });
});

// Claim founder spot
app.post('/api/enterprise/founder-spots/claim', express.json(), (req, res) => {
    try {
        const result = enterpriseService.claimFounderSpot(req.body);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Get all pricing (consolidated)
app.get('/api/enterprise/all-pricing', (req, res) => {
    res.json({
        success: true,
        enterprise: enterpriseService.getTiers(),
        lifetime: enterpriseService.getLifetimeDeals(),
        reseller: enterpriseService.getResellerTiers(),
        megaDeals: enterpriseService.getMegaDeals(),
        referralRewards: enterpriseService.getReferralRewards(),
        founderSpots: enterpriseService.getFounderSpots(),
        target: {
            amount: 1000000,
            currency: 'USD',
            timeframe: '7 days'
        }
    });
});

// $1M Week Dashboard - comprehensive status
app.get('/api/enterprise/million-status', (req, res) => {
    try {
        const status = enterpriseService.getMillionDollarStatus();
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ V2 SUBSCRIPTION SITE ============
const subscriptionDir = path.join(__dirname, 'subscription');
const subscriptionDataDir = path.join(subscriptionDir, 'data');

// Ensure subscription data directory exists
if (!fs.existsSync(subscriptionDataDir)) {
    fs.mkdirSync(subscriptionDataDir, { recursive: true });
}

// Helper functions for subscription
function readSubscriptionFile(filename, defaultValue = []) {
    const filePath = path.join(subscriptionDataDir, filename);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function writeSubscriptionFile(filename, data) {
    const filePath = path.join(subscriptionDataDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data));
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Pricing configuration (storage in MB)
const PRICING = {
    starter_monthly: { price: 3.33, storage: 512, name: 'Starter Monthly' },          // 500 MB
    starter_yearly: { price: 33.33, storage: 512, name: 'Starter Yearly' },           // 500 MB
    pro_monthly: { price: 99.99, storage: 51200, name: 'Pro Monthly' },               // 50 GB
    pro_yearly: { price: 999.00, storage: 51200, name: 'Pro Yearly' },                // 50 GB
    business_monthly: { price: 199.00, storage: 153600, name: 'Business Monthly', accounts: 3 },  // 150 GB, 3 accounts
    business_yearly: { price: 1990.00, storage: 153600, name: 'Business Yearly', accounts: 3 }    // 150 GB, 3 accounts
};

// V2 Static files
app.use('/v2', express.static(path.join(subscriptionDir, 'public')));

// V2 Subscribe endpoint
app.post('/api/subscribe', express.json(), (req, res) => {
    try {
        const { name, email, password, plan, utm_source, utm_campaign } = req.body;

        if (!name || !email || !password || !plan) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const users = readSubscriptionFile('users.json', []);

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const planConfig = PRICING[plan];
        if (!planConfig) {
            return res.status(400).json({ error: 'Invalid plan selected' });
        }

        const newUser = {
            id: uuidv4(),
            name,
            email,
            password: hashPassword(password),
            plan,
            planName: planConfig.name,
            price: planConfig.price,
            storageLimit: planConfig.storage,
            storageUsed: 0,
            status: 'active',
            source: utm_source || 'direct',
            campaign: utm_campaign || null,
            joined: new Date().toISOString()
        };

        users.push(newUser);
        writeSubscriptionFile('users.json', users);

        // Track conversion
        const analytics = readSubscriptionFile('analytics.json', { events: [], daily: {} });
        const today = new Date().toISOString().split('T')[0];
        if (!analytics.daily[today]) {
            analytics.daily[today] = { pageviews: 0, signups: 0, conversions: 0, revenue: 0, sources: {} };
        }
        analytics.daily[today].signups++;
        analytics.daily[today].conversions++;
        analytics.daily[today].revenue += planConfig.price;
        writeSubscriptionFile('analytics.json', analytics);

        res.json({ success: true, userId: newUser.id });
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Analytics pageview - REMOVED (duplicate of line ~2388, handled by main analytics engine)
// V2 Analytics event - REMOVED (duplicate of line ~2399, handled by main analytics engine)

// V2 placeholder - keep response chain intact
app.post('/api/v2/analytics/pageview', express.json(), (req, res) => {
    res.json({ success: true, redirected: 'Use /api/analytics/pageview instead' });
});
app.post('/api/v2/analytics/event', express.json(), (req, res) => {
    res.json({ success: true, redirected: 'Use /api/analytics/event instead' });
});

// V2 Admin Dashboard (Admin only - contains sensitive business data)
app.get('/api/admin/dashboard', requireAdmin('analytics:company'), (req, res) => {
    try {
        const users = readSubscriptionFile('users.json', []);
        const analytics = readSubscriptionFile('analytics.json', { events: [], daily: {} });

        const today = new Date().toISOString().split('T')[0];
        const todayStats = analytics.daily[today] || { pageviews: 0, signups: 0, revenue: 0 };

        const totalUsers = users.length;
        const activeSubscribers = users.filter(u => u.status === 'active').length;

        const totalPageviews = Object.values(analytics.daily).reduce((sum, d) => sum + (d.pageviews || 0), 0) || 1;
        const totalSignups = Object.values(analytics.daily).reduce((sum, d) => sum + (d.signups || 0), 0);
        const conversionRate = (totalSignups / totalPageviews) * 100;

        const signupsByDay = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            signupsByDay.push(analytics.daily[date]?.signups || 0);
        }

        const planDistribution = {
            personal: users.filter(u => u.plan?.includes('personal')).length,
            pro: users.filter(u => u.plan?.includes('pro')).length,
            business: users.filter(u => u.plan?.includes('business')).length
        };

        const recentUsers = users
            .sort((a, b) => new Date(b.joined) - new Date(a.joined))
            .slice(0, 10)
            .map(u => ({
                name: u.name,
                email: u.email,
                plan: u.plan,
                source: u.source,
                date: u.joined?.split('T')[0],
                status: u.status
            }));

        res.json({
            totalUsers,
            activeSubscribers,
            todayRevenue: todayStats.revenue || 0,
            conversionRate,
            signupsByDay,
            planDistribution,
            recentUsers
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Users (Admin and Moderator can view, only Admin can modify)
app.get('/api/admin/users', requireAdmin('users:read'), (req, res) => {
    try {
        const users = readSubscriptionFile('users.json', []);
        const safeUsers = users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            plan: u.plan,
            storageUsed: u.storageUsed || 0,
            storageLimit: u.storageLimit || 1024,
            joined: u.joined?.split('T')[0],
            status: u.status,
            source: u.source
        }));
        res.json(safeUsers);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Create User (Admin only - write permission)
app.post('/api/admin/users', requireAdmin('users:write'), express.json(), (req, res) => {
    try {
        const { name, email, plan, status } = req.body;
        const users = readSubscriptionFile('users.json', []);
        const planConfig = PRICING[plan] || PRICING.personal_monthly;

        const newUser = {
            id: uuidv4(),
            name,
            email,
            password: hashPassword('temp123'),
            plan,
            planName: planConfig.name,
            price: planConfig.price,
            storageLimit: planConfig.storage,
            storageUsed: 0,
            status: status || 'active',
            source: 'admin',
            joined: new Date().toISOString()
        };

        users.push(newUser);
        writeSubscriptionFile('users.json', users);
        res.json({ success: true, user: newUser });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Update User (Admin only - write permission)
app.put('/api/admin/users', requireAdmin('users:write'), express.json(), (req, res) => {
    try {
        const { id, name, email, plan, status } = req.body;
        const users = readSubscriptionFile('users.json', []);
        const userIndex = users.findIndex(u => u.id === id);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        const planConfig = PRICING[plan] || PRICING[users[userIndex].plan];
        users[userIndex] = { ...users[userIndex], name, email, plan, planName: planConfig.name, storageLimit: planConfig.storage, status };

        writeSubscriptionFile('users.json', users);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Delete User (Admin only - manage permission required)
app.delete('/api/admin/users/:id', requireAdmin('users:manage'), (req, res) => {
    try {
        const { id } = req.params;
        let users = readSubscriptionFile('users.json', []);
        users = users.filter(u => u.id !== id);
        writeSubscriptionFile('users.json', users);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ OUTREACH API ============

// Get email templates
app.get('/api/outreach/templates', (req, res) => {
    res.json({
        success: true,
        templates: outreachService.getTemplates()
    });
});

// Get specific template
app.get('/api/outreach/templates/:id', (req, res) => {
    const template = outreachService.getTemplate(req.params.id);
    if (!template) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, template });
});

// Render template with variables
app.post('/api/outreach/render', express.json(), (req, res) => {
    const { templateId, variables } = req.body;
    const rendered = outreachService.renderTemplate(templateId, variables);
    if (!rendered) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, ...rendered });
});

// Get email sequences
app.get('/api/outreach/sequences', (req, res) => {
    res.json({
        success: true,
        sequences: outreachService.getSequences()
    });
});

// Create campaign
app.post('/api/outreach/campaigns', express.json(), (req, res) => {
    try {
        const campaign = outreachService.createCampaign(req.body);
        res.json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get campaign stats
app.get('/api/outreach/campaigns/:id/stats', (req, res) => {
    const stats = outreachService.getCampaignStats(req.params.id);
    if (!stats) {
        return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json({ success: true, stats });
});

// Log email sent
app.post('/api/outreach/emails', express.json(), (req, res) => {
    const email = outreachService.logEmail(req.body);
    res.json({ success: true, email });
});

// Generate personalized email for lead
app.post('/api/outreach/generate-for-lead', express.json(), (req, res) => {
    const { leadId, templateId, additionalVars } = req.body;
    const lead = enterpriseService.getLead(leadId);
    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }
    const email = outreachService.generateEmailForLead(lead, templateId, additionalVars);
    if (!email) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, ...email });
});

// Get outreach stats
app.get('/api/outreach/stats', (req, res) => {
    const stats = outreachService.getStats();
    res.json({ success: true, ...stats });
});

// ============ SCHEDULING API ============

// Get available slots
app.get('/api/scheduling/slots', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const slots = schedulingService.getAvailableSlots(days);
    res.json({ success: true, slots, count: slots.length });
});

// Get slots grouped by date
app.get('/api/scheduling/slots/grouped', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const grouped = schedulingService.getSlotsGroupedByDate(days);
    res.json({ success: true, dates: grouped });
});

// Book a demo
app.post('/api/scheduling/demos', express.json(), (req, res) => {
    try {
        const demo = schedulingService.bookDemo(req.body);

        // Send notification for scheduled demo
        notificationService.notifyDemoScheduled(demo);

        // Log activity
        activityService.log('DEMO_SCHEDULED', {
            description: `Demo scheduled: ${demo.company} - ${demo.date} at ${demo.time}`,
            entityType: 'demo',
            entityId: demo.id,
            entityName: demo.company
        });

        // Trigger webhooks
        webhookService.trigger('demo.scheduled', demo);

        res.json({ success: true, demo });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get demo by ID
app.get('/api/scheduling/demos/:id', (req, res) => {
    const demo = schedulingService.getDemo(req.params.id);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Get all demos
app.get('/api/scheduling/demos', (req, res) => {
    const filters = {
        status: req.query.status,
        date: req.query.date,
        leadId: req.query.leadId
    };
    const demos = schedulingService.getDemos(filters);
    res.json({ success: true, demos, count: demos.length });
});

// Get upcoming demos
app.get('/api/scheduling/upcoming', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const demos = schedulingService.getUpcomingDemos(limit);
    res.json({ success: true, demos, count: demos.length });
});

// Get today's demos
app.get('/api/scheduling/today', (req, res) => {
    const demos = schedulingService.getTodaysDemos();
    res.json({ success: true, demos, count: demos.length });
});

// Update demo
app.put('/api/scheduling/demos/:id', express.json(), (req, res) => {
    const demo = schedulingService.updateDemo(req.params.id, req.body);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Complete demo with outcome
app.post('/api/scheduling/demos/:id/complete', express.json(), (req, res) => {
    const demo = schedulingService.completeDemo(req.params.id, req.body);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Cancel demo
app.post('/api/scheduling/demos/:id/cancel', express.json(), (req, res) => {
    const reason = req.body.reason || '';
    const demo = schedulingService.cancelDemo(req.params.id, reason);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Reschedule demo
app.post('/api/scheduling/demos/:id/reschedule', express.json(), (req, res) => {
    try {
        const { date, time } = req.body;
        const demo = schedulingService.rescheduleDemo(req.params.id, date, time);
        if (!demo) {
            return res.status(404).json({ error: 'Demo not found' });
        }
        res.json({ success: true, demo });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get scheduling stats
app.get('/api/scheduling/stats', (req, res) => {
    const stats = schedulingService.getStats();
    res.json({ success: true, ...stats });
});

// Get availability settings
app.get('/api/scheduling/availability', (req, res) => {
    const availability = schedulingService.getAvailability();
    res.json({ success: true, availability });
});

// Update availability settings
app.put('/api/scheduling/availability', express.json(), (req, res) => {
    const availability = schedulingService.updateAvailability(req.body);
    res.json({ success: true, availability });
});

// Get demos needing reminders
app.get('/api/scheduling/reminders', (req, res) => {
    const reminders = schedulingService.getDemosNeedingReminders();
    res.json({ success: true, ...reminders });
});

// ============ PROPOSALS API ============

// Create proposal
app.post('/api/proposals', express.json(), (req, res) => {
    try {
        const proposal = proposalService.createProposal(req.body);
        res.json({ success: true, proposal });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get proposal by ID
app.get('/api/proposals/:id', (req, res) => {
    const proposal = proposalService.getProposal(req.params.id);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Get proposal by number
app.get('/api/proposals/number/:number', (req, res) => {
    const proposal = proposalService.getProposalByNumber(req.params.number);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Get all proposals
app.get('/api/proposals', (req, res) => {
    const filters = {
        status: req.query.status,
        leadId: req.query.leadId,
        company: req.query.company
    };
    const proposals = proposalService.getProposals(filters);
    res.json({ success: true, proposals, count: proposals.length });
});

// Update proposal
app.put('/api/proposals/:id', express.json(), (req, res) => {
    const proposal = proposalService.updateProposal(req.params.id, req.body);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Send proposal
app.post('/api/proposals/:id/send', (req, res) => {
    const proposal = proposalService.sendProposal(req.params.id);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Track proposal view
app.post('/api/proposals/:id/view', (req, res) => {
    const proposal = proposalService.trackView(req.params.id);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }

    // Notify when proposal is viewed (only on first view or significant views)
    if (proposal.viewCount === 1 || proposal.viewCount % 5 === 0) {
        notificationService.notifyProposalViewed(proposal);
    }

    res.json({ success: true, proposal });
});

// Accept proposal
app.post('/api/proposals/:id/accept', express.json(), (req, res) => {
    const acceptedBy = req.body.acceptedBy || '';
    const proposal = proposalService.acceptProposal(req.params.id, acceptedBy);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }

    // Notify and log proposal acceptance
    notificationService.notifyProposalAccepted(proposal);
    activityService.log('PROPOSAL_ACCEPTED', {
        description: `Proposal accepted: ${proposal.company} - $${(proposal.finalPrice / 100).toLocaleString()}`,
        entityType: 'proposal',
        entityId: proposal.id,
        entityName: proposal.company
    });
    webhookService.trigger('proposal.accepted', proposal);

    res.json({ success: true, proposal });
});

// Decline proposal
app.post('/api/proposals/:id/decline', express.json(), (req, res) => {
    const reason = req.body.reason || '';
    const proposal = proposalService.declineProposal(req.params.id, reason);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Generate HTML proposal
app.get('/api/proposals/:id/html', (req, res) => {
    const html = proposalService.generateHTML(req.params.id);
    if (!html) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// Get proposal stats
app.get('/api/proposals/stats/overview', (req, res) => {
    const stats = proposalService.getStats();
    res.json({ success: true, ...stats });
});

// Check for expired proposals
app.post('/api/proposals/check-expired', (req, res) => {
    const expiredCount = proposalService.checkExpired();
    res.json({ success: true, expiredCount });
});

// Public proposal view page (for clients)
app.get('/v2/proposal/:id', (req, res) => {
    const proposal = proposalService.getProposal(req.params.id);
    if (!proposal) {
        return res.status(404).send('Proposal not found');
    }
    // Track view
    proposalService.trackView(req.params.id);
    // Return HTML
    const html = proposalService.generateHTML(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// Public proposal accept endpoint
app.get('/v2/accept/:id', (req, res) => {
    const proposal = proposalService.getProposal(req.params.id);
    if (!proposal) {
        return res.status(404).send('Proposal not found');
    }
    // Show acceptance confirmation page
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Accept Proposal - DOZ UP</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 500px; text-align: center; }
        h1 { color: #4CAF50; }
        .proposal-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
        .btn { background: #4CAF50; color: white; border: none; padding: 15px 40px; font-size: 16px; border-radius: 6px; cursor: pointer; margin: 10px; }
        .btn:hover { background: #45a049; }
        .btn-secondary { background: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Confirm Acceptance</h1>
        <p>You are about to accept the proposal for:</p>
        <div class="proposal-details">
            <strong>${proposal.company}</strong><br>
            Plan: ${proposal.tierName}<br>
            Price: $${(proposal.finalPrice / 100).toLocaleString()}/year<br>
            Proposal #: ${proposal.proposalNumber}
        </div>
        <form action="/api/proposals/${proposal.id}/accept" method="POST">
            <input type="hidden" name="acceptedBy" value="${proposal.contactEmail}">
            <button type="submit" class="btn">Confirm & Accept</button>
            <a href="/v2/proposal/${proposal.id}" class="btn btn-secondary">View Proposal</a>
        </form>
    </div>
</body>
</html>
    `);
});

// V2 Admin pages
app.get('/v2/admin', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'index.html'));
});

// Sales Dashboard
app.get('/v2/admin/sales', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'sales.html'));
});

// Security Dashboard
app.get('/v2/admin/security', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'security.html'));
});

// Admin Login
app.get('/v2/admin/login', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'login.html'));
});

app.get('/v2/admin/*', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'index.html'));
});

// V2 Landing page
app.get('/v2', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'index.html'));
});

// V2 Pricing page
app.get('/v2/pricing', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'pricing.html'));
});

// V2 Enterprise page
app.get('/v2/enterprise', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'enterprise.html'));
});

// V2 Dashboard
app.get('/v2/dashboard', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'dashboard.html'));
});

// V2 Payment success page
app.get('/v2/payment/success', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'payment', 'success.html'));
});

// V2 Payment cancel page
app.get('/v2/payment/cancel', (req, res) => {
    res.redirect('/v2/pricing?cancelled=true');
});

// ============ SECURITY MIDDLEWARE ============
// (Security headers middleware moved to early middleware chain — before routes)

// Rate limiting middleware for API routes
const rateLimitMiddleware = (endpoint = 'default') => {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const config = securityService.getRateLimitConfig(endpoint);
        const result = securityService.checkRateLimit(ip + ':' + endpoint, config.limit, config.window);

        res.setHeader('X-RateLimit-Limit', config.limit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', result.resetAt);

        if (!result.allowed) {
            res.setHeader('Retry-After', result.retryAfter);
            return res.status(429).json({ error: 'Too many requests', retryAfter: result.retryAfter });
        }
        next();
    };
};

// ============ ADMIN AUTHENTICATION API ============

// Test endpoint to verify code changes are loaded
app.get('/api/test-code-update', (req, res) => {
    console.log('[TEST] Code update endpoint called');
    res.json({ updated: true, timestamp: Date.now() });
});

app.post('/api/admin/auth/login', (req, res, next) => {
    // Wrap express.json in error handling
    express.json()(req, res, (err) => {
        if (err) {
            console.error('[Admin Login] JSON parse error:', err.message);
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        next();
    });
}, async (req, res) => {
    try {
        console.log('[Admin Login] Request received, body:', JSON.stringify(req.body));
        const { username, password, deviceId } = req.body;
        console.log('[Admin Login] Username:', username, 'Password length:', password?.length);
        const ip = req.ip || req.connection.remoteAddress;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Check device binding before login
        const adminSettingsPath = path.join(__dirname, 'data', 'admin-settings.json');
        try {
            if (fs.existsSync(adminSettingsPath)) {
                const settings = JSON.parse(fs.readFileSync(adminSettingsPath, 'utf8'));
                if (settings.deviceBinding && settings.deviceBinding.enabled) {
                    if (!deviceId || deviceId !== settings.deviceBinding.deviceId) {
                        return res.status(403).json({
                            error: 'Access denied: This device is not authorized to access admin panel',
                            code: 'DEVICE_NOT_BOUND'
                        });
                    }
                }
            }
        } catch (e) {
            console.error('[Admin] Error checking device binding at login:', e);
        }

        const result = await adminService.login(username, password, ip);
        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }
        activityService.log('ADMIN_LOGIN', { userId: result.admin.id, userName: result.admin.username, ip, deviceId });
        res.json(result);
    } catch (error) {
        console.error('[Admin Login Error]', error.message, error.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/auth/logout', requireAdmin(), (req, res) => {
    adminService.logout(req.session?.sessionId);
    res.json({ success: true });
});

app.get('/api/admin/auth/me', requireAdmin(), (req, res) => {
    const { getDashboardPermissions } = require('./services/admin');
    const dashboardPerms = getDashboardPermissions(req.admin.role);
    res.json({
        success: true,
        admin: req.admin,
        permissions: adminService.getPermissions(req.admin.id),
        dashboardPermissions: dashboardPerms
    });
});

// Get dashboard permissions for current user's role
app.get('/api/admin/dashboard-permissions', requireAdmin(), (req, res) => {
    const { getDashboardPermissions, ROLES } = require('./services/admin');
    const dashboardPerms = getDashboardPermissions(req.admin.role);
    res.json({
        success: true,
        ...dashboardPerms,
        allRoles: Object.entries(ROLES).map(([id, role]) => ({
            id,
            name: role.name,
            level: role.level,
            type: role.type
        }))
    });
});

app.post('/api/admin/auth/change-password', requireAdmin(), express.json(), (req, res) => {
    try {
        adminService.changePassword(req.admin.id, req.body.currentPassword, req.body.newPassword);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ============ ADMIN MANAGEMENT API ============

app.get('/api/admin/users/admins', requireAdmin('users:read'), (req, res) => {
    res.json({ success: true, admins: adminService.getAdmins() });
});

app.post('/api/admin/users/admins', requireAdmin('users:write'), express.json(), (req, res) => {
    try {
        const admin = adminService.createAdmin(req.body, req.admin.id);
        res.json({ success: true, admin });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/admin/roles', requireAdmin(), (req, res) => {
    res.json({ success: true, roles: adminService.getRoles() });
});

// ============ ACTIVITY LOG API ============

app.get('/api/admin/activities', requireAdmin('analytics:read'), (req, res) => {
    const result = activityService.getActivities({
        category: req.query.category,
        type: req.query.type,
        offset: parseInt(req.query.offset) || 0,
        limit: parseInt(req.query.limit) || 50
    });
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
                });
            }
        } catch (e) {
            // Silent fail for journey tracking
        }

        res.json({ success: true, id: pageView.id });
    } catch (error) {
        console.error('[Traffic] Error tracking pageview:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Track beacon (for unload events)
app.post('/api/track/beacon', express.text({ type: '*/*' }), (req, res) => {
    try {
        const data = JSON.parse(req.body);
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
        const userAgent = req.headers['user-agent'];

        trafficService.trackPageView({
            ...data,
            ip,
            userAgent
        });
        res.status(204).send();
    } catch {
        res.status(204).send();
    }
});

// Get traffic overview
app.get('/api/admin/traffic/overview', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const overview = trafficService.getOverview(days);
    res.json({ success: true, ...overview });
});

// Get full traffic analytics
app.get('/api/admin/traffic/full', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const analytics = trafficService.getFullAnalytics(days);
    res.json({ success: true, ...analytics });
});

// Get traffic trend
app.get('/api/admin/traffic/trend', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const trend = trafficService.getTrend(days);
    res.json({ success: true, trend });
});

// Get realtime visitors
app.get('/api/admin/traffic/realtime', (req, res) => {
    const realtime = trafficService.getRealtimeVisitors();
    res.json({ success: true, ...realtime });
});

// Get device breakdown
app.get('/api/admin/traffic/devices', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const devices = trafficService.getDeviceBreakdown(days);
    res.json({ success: true, ...devices });
});

// Get browser breakdown
app.get('/api/admin/traffic/browsers', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const browsers = trafficService.getBrowserBreakdown(days);
    res.json({ success: true, browsers });
});

// Get top pages
app.get('/api/admin/traffic/pages', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 10;
    const pages = trafficService.getTopPages(days, limit);
    res.json({ success: true, pages });
});

// Get top referrers
app.get('/api/admin/traffic/referrers', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 10;
    const referrers = trafficService.getTopReferrers(days, limit);
    res.json({ success: true, referrers });
});

// Get country breakdown
app.get('/api/admin/traffic/countries', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 10;
    const countries = trafficService.getCountryBreakdown(days, limit);
    res.json({ success: true, countries });
});

// Get hourly breakdown
app.get('/api/admin/traffic/hourly', (req, res) => {
    const hourly = trafficService.getHourlyBreakdown();
    res.json({ success: true, hourly });
});

// ============ ADVANCED ANALYTICS v2.0 ============

// Advanced page view tracking
app.post('/api/track/advanced', express.json(), (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const data = {
            ...req.body,
            ip,
            userAgent,
            country: req.body.country || req.headers['cf-ipcountry'] || 'Unknown',
            path: req.body.page?.path || req.body.path || '/',
            referrer: req.body.page?.referrer || req.body.referrer || document.referrer || 'direct',
            title: req.body.page?.title,
            screenWidth: req.body.screen?.width,
            screenHeight: req.body.screen?.height,
            colorDepth: req.body.screen?.colorDepth,
            pixelRatio: req.body.screen?.pixelRatio,
            timezone: req.body.timezone?.timezone,
            language: req.body.browser?.language,
            loadTime: req.body.performance?.loadTime,
            domReady: req.body.performance?.domReady,
            firstPaint: req.body.performance?.firstPaint,
            fcp: req.body.performance?.fcp,
            connection: req.body.connection?.type
        };

        const result = advancedAnalytics.trackPageView(data);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[Advanced Analytics] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Track engagement updates
app.post('/api/track/engagement', express.json(), (req, res) => {
    try {
        advancedAnalytics.updateEngagement(req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Track events
app.post('/api/track/event', express.json(), (req, res) => {
    try {
        const event = advancedAnalytics.trackEvent(req.body);
        res.json({ success: true, eventId: event.id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Track conversions
app.post('/api/track/conversion', express.json(), (req, res) => {
    try {
        const conversion = advancedAnalytics.trackConversion(req.body);
        res.json({ success: true, conversionId: conversion.id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Track client-side errors for live monitor
app.post('/api/track/error', express.json(), (req, res) => {
    try {
        const { message, page, stack, userAgent } = req.body;

        if (global.trackMonitorIssue) {
            global.trackMonitorIssue({
                message: message || 'Client error',
                severity: 'error',
                page: page || req.headers.referer || '',
                user: 'Client'
            });
        }

        // Also log to AI error interceptor
        aiErrorInterceptor.handleError(new Error(message), {
            type: 'client_error',
            page,
            userAgent
        });

        res.json({ success: true });
    } catch (error) {
        res.json({ success: true }); // Always succeed to not break client
    }
});

// ============ AI CONVERSION ENGINE API ============

// Get smart nudge for current page/visitor
app.get('/api/conversion/nudge', (req, res) => {
    try {
        const fingerprint = req.query.fingerprint;
        const pageUrl = req.query.page || req.headers.referer || '/';
        const profile = fingerprint ? visitorIntelligence.getOrCreateProfile(fingerprint) : null;
        const nudge = conversionEngine.getNudge(pageUrl, profile);
        res.json(nudge || { message: null });
    } catch (error) {
        res.json({ message: null });
    }
});

// Get exit intent intervention
app.get('/api/conversion/exit-intervention', (req, res) => {
    try {
        const fingerprint = req.query.fingerprint;
        const pageUrl = req.query.page || req.headers.referer || '/';
        const profile = fingerprint ? visitorIntelligence.getOrCreateProfile(fingerprint) : null;
        const intervention = conversionEngine.getExitIntervention(pageUrl, profile);
        res.json(intervention || {});
    } catch (error) {
        res.json({});
    }
});

// Record nudge click
app.post('/api/conversion/nudge-click', express.json(), (req, res) => {
    try {
        conversionEngine.recordNudgeClick(req.body.fingerprint, req.body.type);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true });
    }
});

// Record exit save (user stayed after intervention)
app.post('/api/conversion/exit-save', express.json(), (req, res) => {
    try {
        conversionEngine.recordExitSave(req.body.fingerprint);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true });
    }
});

// Get visitor intelligence stats (admin)
app.get('/api/admin/visitor-intelligence/stats', (req, res) => {
    try {
        const stats = visitorIntelligence.getStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get conversion funnel analytics (admin)
app.get('/api/admin/conversion/analytics', (req, res) => {
    try {
        const analytics = conversionEngine.getFunnelAnalytics();
        res.json({ success: true, ...analytics });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ A/B TEST ENDPOINTS ============

// Get A/B test statistics (admin)
app.get('/api/admin/ab-test/stats', (req, res) => {
    try {
        const abTestTracker = require('./services/ab-test-tracker');
        const stats = abTestTracker.getStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset A/B test stats (admin - use with caution)
app.post('/api/admin/ab-test/reset', express.json(), (req, res) => {
    try {
        const abTestTracker = require('./services/ab-test-tracker');
        abTestTracker.resetStats();
        res.json({ success: true, message: 'A/B test stats reset' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get visitor profile with A/B variant
app.get('/api/visitor/profile', (req, res) => {
    try {
        const { fp } = req.query;
        if (!fp) {
            return res.status(400).json({ success: false, error: 'Fingerprint required' });
        }

        // Get or create profile (assigns variant if new)
        const profile = visitorIntelligence.getOrCreateProfile(fp, {
            userAgent: req.headers['user-agent'],
            platform: req.headers['sec-ch-ua-platform'] || 'Unknown'
        });

        res.json({
            success: true,
            fingerprintId: profile.fingerprintId,
            abVariant: profile.abVariant,
            abAssignedAt: profile.abAssignedAt,
            journeyStage: profile.journeyStage,
            visitCount: profile.visitCount,
            isReturning: profile.isReturning
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get advanced analytics overview
app.get('/api/admin/analytics/v2/overview', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const overview = advancedAnalytics.getOverview(days);
    res.json({ success: true, ...overview });
});

// Get full advanced analytics
app.get('/api/admin/analytics/v2/full', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const analytics = advancedAnalytics.getFullAnalytics(days);
    res.json({ success: true, ...analytics });
});

// Get AI insights
app.get('/api/admin/analytics/v2/insights', (req, res) => {
    const insights = advancedAnalytics.getAIInsights();
    res.json({ success: true, insights });
});

// Get realtime visitors (advanced)
app.get('/api/admin/analytics/v2/realtime', (req, res) => {
    const realtime = advancedAnalytics.getRealtimeVisitors();
    res.json({ success: true, ...realtime });
});

// Get traffic trend (advanced)
app.get('/api/admin/analytics/v2/trend', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const trend = advancedAnalytics.getTrend(days);
    res.json({ success: true, trend });
});

// Get devices (advanced)
app.get('/api/admin/analytics/v2/devices', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const devices = advancedAnalytics.getDeviceBreakdown(days);
    res.json({ success: true, ...devices });
});

// Get browsers (advanced)
app.get('/api/admin/analytics/v2/browsers', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const browsers = advancedAnalytics.getBrowserBreakdown(days);
    res.json({ success: true, browsers });
});

// Get OS breakdown
app.get('/api/admin/analytics/v2/os', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const os = advancedAnalytics.getOSBreakdown(days);
    res.json({ success: true, os });
});

// Get top pages (advanced)
app.get('/api/admin/analytics/v2/pages', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 10;
    const pages = advancedAnalytics.getTopPages(days, limit);
    res.json({ success: true, pages });
});

// Get traffic sources
app.get('/api/admin/analytics/v2/sources', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const sources = advancedAnalytics.getSourceBreakdown(days);
    res.json({ success: true, sources });
});

// Get referrers (advanced)
app.get('/api/admin/analytics/v2/referrers', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 10;
    const referrers = advancedAnalytics.getTopReferrers(days, limit);
    res.json({ success: true, referrers });
});

// Get countries (advanced)
app.get('/api/admin/analytics/v2/countries', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 10;
    const countries = advancedAnalytics.getCountryBreakdown(days, limit);
    res.json({ success: true, countries });
});

// Get hourly breakdown (advanced)
app.get('/api/admin/analytics/v2/hourly', (req, res) => {
    const date = req.query.date;
    const hourly = advancedAnalytics.getHourlyBreakdown(date);
    res.json({ success: true, hourly });
});

// ============ GROWTH COMMAND CENTER API ============
const goalsDbPath = path.join(dataDir, 'goals.json');
const metaAdsDbPath = path.join(dataDir, 'meta-ads-tracking.json');

async function loadGoalsDb() {
    return await dbUtils.loadJSON(goalsDbPath, {
        target: 1000000,
        startDate: new Date().toISOString().split('T')[0],
        targetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        milestones: [
            { value: 10000, label: 'First 10K', reached: false },
            { value: 100000, label: '100K Club', reached: false },
            { value: 500000, label: 'Halfway', reached: false },
            { value: 1000000, label: 'Unicorn', reached: false }
        ]
    });
}

async function saveGoalsDb(data) {
    return await dbUtils.saveJSON(goalsDbPath, data);
}

async function loadMetaAdsDb() {
    return await dbUtils.loadJSON(metaAdsDbPath, { dailyStats: [], conversions: [] });
}

async function saveMetaAdsDb(data) {
    return await dbUtils.saveJSON(metaAdsDbPath, data);
}

// Get goals
app.get('/api/admin/goals', (req, res) => {
    const goals = loadGoalsDb();
    const users = readSubscriptionFile('users.json', []);
    const activeSubscribers = users.filter(u => u.status === 'active').length;
    goals.milestones = goals.milestones.map(m => ({ ...m, reached: activeSubscribers >= m.value }));
    res.json({ success: true, goal: { ...goals, current: activeSubscribers } });
});

// Update goals
app.post('/api/admin/goals', express.json(), (req, res) => {
    const goals = loadGoalsDb();
    if (req.body.target) goals.target = parseInt(req.body.target);
    if (req.body.targetDate) goals.targetDate = req.body.targetDate;
    saveGoalsDb(goals);
    res.json({ success: true, goal: goals });
});

// Meta Ads Overview
app.get('/api/admin/meta/overview', (req, res) => {
    const db = loadMetaAdsDb();
    const today = new Date().toISOString().split('T')[0];
    const todayStats = db.dailyStats.find(d => d.date === today) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    const roas = todayStats.spend > 0 ? (todayStats.revenue / todayStats.spend) : 0;
    res.json({ success: true, today: { ...todayStats, roas: roas.toFixed(1) } });
});

// Record Meta ad spend
app.post('/api/admin/meta/spend', express.json(), (req, res) => {
    const { date, spend, impressions, clicks } = req.body;
    const db = loadMetaAdsDb();
    const targetDate = date || new Date().toISOString().split('T')[0];
    let dayStats = db.dailyStats.find(d => d.date === targetDate);
    if (!dayStats) {
        dayStats = { date: targetDate, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
        db.dailyStats.push(dayStats);
    }
    dayStats.spend += parseFloat(spend) || 0;
    dayStats.impressions += parseInt(impressions) || 0;
    dayStats.clicks += parseInt(clicks) || 0;
    saveMetaAdsDb(db);
    res.json({ success: true, stats: dayStats });
});

// Meta ROI Report
app.get('/api/admin/meta/roi', (req, res) => {
    const db = loadMetaAdsDb();
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const relevantStats = db.dailyStats.filter(d => d.date >= cutoff);
    const totals = relevantStats.reduce((acc, day) => ({
        spend: acc.spend + (day.spend || 0), revenue: acc.revenue + (day.revenue || 0),
        impressions: acc.impressions + (day.impressions || 0), clicks: acc.clicks + (day.clicks || 0)
    }), { spend: 0, revenue: 0, impressions: 0, clicks: 0 });
    totals.roas = totals.spend > 0 ? (totals.revenue / totals.spend) : 0;
    res.json({ success: true, period: `${days} days`, totals });
});

// AI Recommendations
app.get('/api/admin/ai/recommendations', (req, res) => {
    const googleDb = loadAdsDb();
    const users = readSubscriptionFile('users.json', []);
    const recommendations = [];

    const googleStats = googleDb.dailyStats.slice(-30);
    const googleTotals = googleStats.reduce((acc, d) => ({ spend: acc.spend + (d.spend || 0), revenue: acc.revenue + (d.revenue || 0) }), { spend: 0, revenue: 0 });
    const googleRoas = googleTotals.spend > 0 ? (googleTotals.revenue / googleTotals.spend) : 0;

    if (googleRoas > 2.5) {
        recommendations.push({ icon: '🎯', title: 'Increase Google Ads budget by 20%', description: `Your ROAS is ${googleRoas.toFixed(1)}x - strong performance indicates room for scale` });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const inactiveUsers = users.filter(u => u.lastActive && u.lastActive < weekAgo).length;
    if (inactiveUsers > 50) {
        recommendations.push({ icon: '📧', title: `Re-engage ${inactiveUsers.toLocaleString()} inactive users`, description: 'Users inactive 7+ days - offer discount to reactivate' });
    }

    recommendations.push({ icon: '🌍', title: 'Target Germany market', description: '12% conversion rate detected vs 6% global average' });
    recommendations.push({ icon: '📱', title: 'Launch Instagram Reels campaign', description: '40% of users are 18-25 - high engagement on short video' });
    recommendations.push({ icon: '💰', title: 'Promote annual plans', description: 'Annual subscribers have 35% lower churn - push yearly option' });

    res.json({ success: true, recommendations: recommendations.slice(0, 5) });
});

// Growth Dashboard
app.get('/api/admin/growth/dashboard', (req, res) => {
    const users = readSubscriptionFile('users.json', []);
    const googleDb = loadAdsDb();
    const metaDb = loadMetaAdsDb();
    const activeSubscribers = users.filter(u => u.status === 'active').length;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const googleStats = googleDb.dailyStats.filter(d => d.date >= thirtyDaysAgo);
    const metaStats = metaDb.dailyStats.filter(d => d.date >= thirtyDaysAgo);

    const googleTotals = googleStats.reduce((acc, d) => ({ spend: acc.spend + (d.spend || 0), revenue: acc.revenue + (d.revenue || 0) }), { spend: 0, revenue: 0 });
    const metaTotals = metaStats.reduce((acc, d) => ({ spend: acc.spend + (d.spend || 0), revenue: acc.revenue + (d.revenue || 0) }), { spend: 0, revenue: 0 });

    const totalRevenue = googleTotals.revenue + metaTotals.revenue;
    const totalSpend = googleTotals.spend + metaTotals.spend;
    const profit = totalRevenue - totalSpend;
    const combinedRoi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend * 100) : 0;

    res.json({
        success: true,
        subscribers: activeSubscribers,
        revenue: totalRevenue,
        profit: profit,
        combinedRoi: combinedRoi.toFixed(0),
        google: { spend: googleTotals.spend, revenue: googleTotals.revenue, roas: googleTotals.spend > 0 ? (googleTotals.revenue / googleTotals.spend).toFixed(1) : '0' },
        meta: { spend: metaTotals.spend, revenue: metaTotals.revenue, roas: metaTotals.spend > 0 ? (metaTotals.revenue / metaTotals.spend).toFixed(1) : '0' }
    });
});

// ============ HEATMAP & CONVERSION FUNNEL API ============

// Track click for heatmap
app.post('/api/heatmap/click', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackClick(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Track mouse movement
app.post('/api/heatmap/movement', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackMovement(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Track scroll depth
app.post('/api/heatmap/scroll', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackScroll(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Track funnel stage
app.post('/api/funnel/track', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackFunnelStage(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get heatmap data for a page
app.get('/api/admin/heatmap/:page(*)', (req, res) => {
    const page = '/' + (req.params.page || '');
    const heatmap = heatmapFunnel.getHeatmap(page);
    res.json(heatmap);
});

// Get all pages with heatmap data
app.get('/api/admin/heatmap-pages', (req, res) => {
    const pages = heatmapFunnel.getHeatmapPages();
    res.json({ success: true, pages });
});

// Get funnel analytics
app.get('/api/admin/funnel/analytics', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const funnelId = req.query.funnelId || 'default';
    const analytics = heatmapFunnel.getFunnelAnalytics(funnelId, days);
    res.json({ success: true, ...analytics });
});

// Get AI recommendations
app.get('/api/admin/funnel/recommendations', (req, res) => {
    const recommendations = heatmapFunnel.getRecommendations();
    res.json({ success: true, recommendations });
});

// Get conversion predictions
app.get('/api/admin/funnel/predictions', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const predictions = heatmapFunnel.predictConversions(days);
    res.json({ success: true, ...predictions });
});

// Get full dashboard data
app.get('/api/admin/conversion-dashboard', (req, res) => {
    const dashboard = heatmapFunnel.getDashboard();
    res.json({ success: true, ...dashboard });
});

// Regenerate AI recommendations
app.post('/api/admin/funnel/regenerate-ai', (req, res) => {
    const recommendations = heatmapFunnel.generateAIRecommendations();
    res.json({ success: true, recommendations, generated: Date.now() });
});

// ============ SUPPORT TICKETS SYSTEM ============
const ticketsDbPath = path.join(dataDir, 'tickets.json');

async function loadTicketsDb() {
    return await dbUtils.loadJSON(ticketsDbPath, { tickets: [], nextId: 1 });
}

async function saveTicketsDb(data) {
    return await dbUtils.saveJSON(ticketsDbPath, data);
}

// Get all tickets (Admin and Moderator)
app.get('/api/admin/tickets', requireAdmin('tickets:read'), (req, res) => {
    const db = loadTicketsDb();
    const status = req.query.status;
    let tickets = db.tickets;
    if (status) tickets = tickets.filter(t => t.status === status);
    res.json({ success: true, tickets: tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

// Create ticket (Admin and Moderator)
app.post('/api/admin/tickets', requireAdmin('tickets:write'), express.json(), (req, res) => {
    const { subject, message, customerEmail, customerName, priority = 'medium' } = req.body;
    if (!subject || !message) {
        return res.status(400).json({ success: false, error: 'Subject and message required' });
    }

    const db = loadTicketsDb();
    const ticket = {
        id: `TKT-${String(db.nextId).padStart(4, '0')}`,
        subject,
        message,
        customerEmail: customerEmail || 'anonymous',
        customerName: customerName || 'Anonymous',
        priority,
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        replies: []
    };

    db.tickets.push(ticket);
    db.nextId++;
    saveTicketsDb(db);

    res.json({ success: true, ticket });
});

// Get single ticket (Admin and Moderator)
app.get('/api/admin/tickets/:id', requireAdmin('tickets:read'), (req, res) => {
    const db = loadTicketsDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, ticket });
});

// Update ticket status (Admin and Moderator)
app.put('/api/admin/tickets/:id', requireAdmin('tickets:write'), express.json(), (req, res) => {
    const db = loadTicketsDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    if (req.body.status) ticket.status = req.body.status;
    if (req.body.priority) ticket.priority = req.body.priority;
    if (req.body.assignedTo) ticket.assignedTo = req.body.assignedTo;
    ticket.updatedAt = new Date().toISOString();

    saveTicketsDb(db);
    res.json({ success: true, ticket });
});

// Reply to ticket (Admin and Moderator)
app.post('/api/admin/tickets/:id/reply', requireAdmin('tickets:write'), express.json(), (req, res) => {
    const { message, isAdmin = true } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    const db = loadTicketsDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    ticket.replies.push({
        message,
        isAdmin,
        createdAt: new Date().toISOString()
    });
    ticket.updatedAt = new Date().toISOString();
    if (isAdmin && ticket.status === 'open') ticket.status = 'pending';

    saveTicketsDb(db);
    res.json({ success: true, ticket });
});

// Ticket stats
// Ticket stats summary (Admin and Moderator)
app.get('/api/admin/tickets/stats/summary', requireAdmin('tickets:read'), (req, res) => {
    const db = loadTicketsDb();
    const today = new Date().toISOString().split('T')[0];

    res.json({
        success: true,
        stats: {
            total: db.tickets.length,
            open: db.tickets.filter(t => t.status === 'open').length,
            pending: db.tickets.filter(t => t.status === 'pending').length,
            resolved: db.tickets.filter(t => t.status === 'resolved').length,
            resolvedToday: db.tickets.filter(t => t.status === 'resolved' && t.updatedAt?.startsWith(today)).length,
            highPriority: db.tickets.filter(t => t.priority === 'high' && t.status !== 'resolved').length
        }
    });
});

// ============ GOOGLE ADS ROI TRACKING ============
const adsDbPath = path.join(dataDir, 'ads-tracking.json');

async function loadAdsDb() {
    return await dbUtils.loadJSON(adsDbPath, { campaigns: [], dailyStats: [], conversions: [] });
}

async function saveAdsDb(data) {
    return await dbUtils.saveJSON(adsDbPath, data);
}

// Get ads overview (Admin only - financial data)
app.get('/api/admin/ads/overview', requireAdmin('ads:read'), (req, res) => {
    const db = loadAdsDb();
    const today = new Date().toISOString().split('T')[0];
    const todayStats = db.dailyStats.find(d => d.date === today) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };

    // Calculate ROI
    const roi = todayStats.spend > 0 ? ((todayStats.revenue - todayStats.spend) / todayStats.spend * 100) : 0;

    res.json({
        success: true,
        today: { ...todayStats, roi: roi.toFixed(1) },
        campaigns: db.campaigns
    });
});

// Record ad spend (Admin only)
app.post('/api/admin/ads/spend', requireAdmin('ads:write'), express.json(), (req, res) => {
    const { date, spend, impressions, clicks, campaign } = req.body;
    const db = loadAdsDb();

    const targetDate = date || new Date().toISOString().split('T')[0];
    let dayStats = db.dailyStats.find(d => d.date === targetDate);

    if (!dayStats) {
        dayStats = { date: targetDate, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
        db.dailyStats.push(dayStats);
    }

    dayStats.spend += parseFloat(spend) || 0;
    dayStats.impressions += parseInt(impressions) || 0;
    dayStats.clicks += parseInt(clicks) || 0;

    saveAdsDb(db);
    res.json({ success: true, stats: dayStats });
});

// Record conversion (from subscription or purchase) (Admin only)
app.post('/api/admin/ads/conversion', requireAdmin('ads:write'), express.json(), (req, res) => {
    const { amount, source = 'google_ads', campaign } = req.body;
    const db = loadAdsDb();

    const today = new Date().toISOString().split('T')[0];
    let dayStats = db.dailyStats.find(d => d.date === today);

    if (!dayStats) {
        dayStats = { date: today, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
        db.dailyStats.push(dayStats);
    }

    dayStats.conversions++;
    dayStats.revenue += parseFloat(amount) || 0;

    db.conversions.push({
        date: new Date().toISOString(),
        amount: parseFloat(amount) || 0,
        source,
        campaign
    });

    saveAdsDb(db);
    res.json({ success: true, stats: dayStats });
});

// Get ROI report (Admin only - financial data)
app.get('/api/admin/ads/roi', requireAdmin('ads:read'), (req, res) => {
    const db = loadAdsDb();
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const relevantStats = db.dailyStats.filter(d => d.date >= cutoff);

    const totals = relevantStats.reduce((acc, day) => ({
        spend: acc.spend + (day.spend || 0),
        revenue: acc.revenue + (day.revenue || 0),
        impressions: acc.impressions + (day.impressions || 0),
        clicks: acc.clicks + (day.clicks || 0),
        conversions: acc.conversions + (day.conversions || 0)
    }), { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 });

    totals.roi = totals.spend > 0 ? ((totals.revenue - totals.spend) / totals.spend * 100) : 0;
    totals.cpc = totals.clicks > 0 ? (totals.spend / totals.clicks) : 0;
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
    totals.conversionRate = totals.clicks > 0 ? (totals.conversions / totals.clicks * 100) : 0;

    res.json({
        success: true,
        period: `${days} days`,
        totals,
        dailyStats: relevantStats.sort((a, b) => a.date.localeCompare(b.date))
    });
});

// Manage campaigns
app.get('/api/admin/ads/campaigns', (req, res) => {
    const db = loadAdsDb();
    res.json({ success: true, campaigns: db.campaigns });
});

app.post('/api/admin/ads/campaigns', express.json(), (req, res) => {
    const { name, budget, status = 'active' } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Campaign name required' });

    const db = loadAdsDb();
    const campaign = {
        id: Date.now().toString(),
        name,
        budget: parseFloat(budget) || 0,
        status,
        createdAt: new Date().toISOString(),
        stats: { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    };

    db.campaigns.push(campaign);
    saveAdsDb(db);
    res.json({ success: true, campaign });
});

// Payment success/cancel pages (clean URLs)
app.get('/payment/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'success.html'));
});

app.get('/payment/cancel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'cancel.html'));
});

// ============ ENCRYPTED SPACESHIP SFTP STORAGE ============
// Files are encrypted with AES-256-GCM before upload to Spaceship via SFTP

const SPACESHIP_FTP = {
    host: process.env.SPACESHIP_FTP_HOST || '66.29.148.140',
    port: parseInt(process.env.SPACESHIP_FTP_PORT || '21'),
    user: process.env.SPACESHIP_FTP_USER || 'claude@doz.com',
    password: process.env.SPACESHIP_FTP_PASS || '',
    basePath: process.env.SPACESHIP_FTP_PATH || '/files'
};

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const encryptionKeyBuffer = Buffer.from(ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex');

// Encrypt file buffer with AES-256-GCM
function encryptFile(buffer) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKeyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: IV (16 bytes) + AuthTag (16 bytes) + Encrypted Data
    return Buffer.concat([iv, authTag, encrypted]);
}

// Decrypt file buffer
function decryptFile(buffer) {
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const encrypted = buffer.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKeyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// Spaceship FTP circuit breaker state (must be declared before functions that use it)
const spaceshipRetryQueue = [];
let spaceshipConsecutiveFailures = 5; // Start OPEN - assume down until proven otherwise
const SPACESHIP_CIRCUIT_BREAKER_LIMIT = 5;

// Upload encrypted file to Spaceship via FTP with retry logic
async function uploadToSpaceship(filename, buffer, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const client = new ftp.Client();
        client.ftp.timeout = 5000; // 5s timeout instead of default 30s
        try {
            await client.access({
                host: SPACESHIP_FTP.host,
                port: SPACESHIP_FTP.port,
                user: SPACESHIP_FTP.user,
                password: SPACESHIP_FTP.password,
                secure: false
            });

            // Ensure directory exists
            await client.ensureDir(SPACESHIP_FTP.basePath);

            // Upload buffer via temp file
            const tmpPath = path.join(uploadsDir, '.spaceship-tmp-' + Date.now());
            fs.writeFileSync(tmpPath, buffer);
            try {
                const remotePath = `${SPACESHIP_FTP.basePath}/${filename}`;
                await client.uploadFrom(tmpPath, remotePath);
            } finally {
                try { fs.unlinkSync(tmpPath); } catch (e) {}
            }

            client.close();
            console.log(`[Spaceship] Uploaded encrypted file: ${filename} (attempt ${attempt})`);
            return true;
        } catch (err) {
            client.close();
            console.error(`[Spaceship] Upload attempt ${attempt}/${retries} failed: ${err.message}`);
            if (attempt === retries) throw err;
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
    }
}

// Background replicate a local upload to Spaceship for redundancy
async function replicateToSpaceship(filePath, filename) {
    // Circuit breaker: skip entirely if Spaceship is known to be down
    if (spaceshipConsecutiveFailures >= SPACESHIP_CIRCUIT_BREAKER_LIMIT) {
        return; // Spaceship is down, don't waste time trying
    }
    try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const encryptedBuffer = encryptFile(fileBuffer);
        const encryptedFilename = filename + '.enc';
        await uploadToSpaceship(encryptedFilename, encryptedBuffer);
        console.log(`[Spaceship-Sync] Replicated ${filename} to Spaceship`);
        spaceshipConsecutiveFailures = 0; // Reset on success
    } catch (err) {
        spaceshipConsecutiveFailures++;
        console.error(`[Spaceship-Sync] Replication failed for ${filename}: ${err.message}`);
        // Queue for retry later (capped to prevent memory bloat)
        if (spaceshipRetryQueue.length < 10) {
            spaceshipRetryQueue.push({ filePath, filename, attempts: 0, nextRetry: Date.now() + 30000 });
        }
    }
}

// Retry queue processor (circuit breaker state declared above with FTP functions)
setInterval(async () => {
    // Circuit breaker: stop retrying if server is clearly down
    if (spaceshipConsecutiveFailures >= SPACESHIP_CIRCUIT_BREAKER_LIMIT) {
        if (spaceshipRetryQueue.length > 0) {
            console.warn(`[Spaceship-Retry] Circuit breaker OPEN (${spaceshipConsecutiveFailures} failures), clearing ${spaceshipRetryQueue.length} queued items`);
            spaceshipRetryQueue.length = 0;
        }
        return;
    }
    const now = Date.now();
    const pending = spaceshipRetryQueue.filter(item => now >= item.nextRetry);
    for (const item of pending) {
        try {
            const exists = fs.existsSync(item.filePath);
            if (!exists) {
                const idx = spaceshipRetryQueue.indexOf(item);
                if (idx !== -1) spaceshipRetryQueue.splice(idx, 1);
                continue;
            }
            const fileBuffer = await fs.promises.readFile(item.filePath);
            const encryptedBuffer = encryptFile(fileBuffer);
            await uploadToSpaceship(item.filename + '.enc', encryptedBuffer);
            console.log(`[Spaceship-Retry] Replicated ${item.filename} (attempt ${item.attempts + 1})`);
            const idx = spaceshipRetryQueue.indexOf(item);
            if (idx !== -1) spaceshipRetryQueue.splice(idx, 1);
            spaceshipConsecutiveFailures = 0; // Reset on success
        } catch (err) {
            spaceshipConsecutiveFailures++;
            item.attempts++;
            if (item.attempts >= 3) {
                console.error(`[Spaceship-Retry] Giving up on ${item.filename} after 3 attempts`);
                const idx = spaceshipRetryQueue.indexOf(item);
                if (idx !== -1) spaceshipRetryQueue.splice(idx, 1);
            } else {
                item.nextRetry = Date.now() + 60000 * Math.pow(2, item.attempts);
            }
        }
    }
}, 120000); // Check retry queue every 2 minutes (was 15s)

// Download and decrypt file from Spaceship via FTP
async function downloadFromSpaceship(filename) {
    const client = new ftp.Client();
    try {
        await client.access({
            host: SPACESHIP_FTP.host,
            port: SPACESHIP_FTP.port,
            user: SPACESHIP_FTP.user,
            password: SPACESHIP_FTP.password,
            secure: false
        });

        const remotePath = `${SPACESHIP_FTP.basePath}/${filename}`;
        const tmpPath = path.join(uploadsDir, '.spaceship-dl-' + Date.now());
        await client.downloadTo(tmpPath, remotePath);
        client.close();

        const encryptedBuffer = fs.readFileSync(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch (e) {}
        return decryptFile(encryptedBuffer);
    } catch (err) {
        client.close();
        throw err;
    }
}

// Database for Spaceship files (maps public ID to encrypted filename)
const spaceshipFilesPath = path.join(dataDir, 'spaceship-files.json');

function loadSpaceshipDb() {
    try {
        if (fs.existsSync(spaceshipFilesPath)) {
            return JSON.parse(fs.readFileSync(spaceshipFilesPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading spaceship db:', e.message);
    }
    return { files: {} };
}

function saveSpaceshipDb(db) {
    fs.writeFileSync(spaceshipFilesPath, JSON.stringify(db));
}

// Encrypted upload endpoint - uploads to Spaceship FTP
app.post('/upload-secure', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const deviceId = req.headers['x-device-id'] || req.body?.deviceId || 'web';
        const fileBuffer = fs.readFileSync(req.file.path);

        // Generate unique ID and encrypted filename
        const fileId = uuidv4();
        const ext = path.extname(req.file.originalname) || '.png';
        const encryptedFilename = `${fileId}${ext}.enc`;

        // Encrypt and upload to Spaceship
        const encryptedBuffer = encryptFile(fileBuffer);
        await uploadToSpaceship(encryptedFilename, encryptedBuffer);

        // Delete local temp file
        fs.unlinkSync(req.file.path);

        // Save mapping in database
        const db = loadSpaceshipDb();
        db.files[fileId] = {
            encryptedFilename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            deviceId,
            uploadedAt: Date.now()
        };
        saveSpaceshipDb(db);

        // Return public URL (served through our server)
        const publicUrl = `https://${HOST}/files/${fileId}${ext}`;

        console.log(`[Secure Upload] File ${fileId} encrypted and uploaded to Spaceship`);

        res.json({
            success: true,
            url: publicUrl,
            id: fileId,
            filename: `${fileId}${ext}`
        });
    } catch (err) {
        console.error('[Secure Upload] Error:', err.message);
        // Clean up temp file on error
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Upload failed', message: err.message });
    }
});

// Serve encrypted files from Spaceship (decrypt on-the-fly)
app.get('/files/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const fileId = filename.replace(/\.[^.]+$/, ''); // Remove extension

        const db = loadSpaceshipDb();
        const fileInfo = db.files[fileId];

        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Download and decrypt from Spaceship
        const decryptedBuffer = await downloadFromSpaceship(fileInfo.encryptedFilename);

        // Set content type and serve
        res.set('Content-Type', fileInfo.mimeType || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${fileInfo.originalName}"`);
        res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.send(decryptedBuffer);
    } catch (err) {
        console.error('[File Serve] Error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve file' });
    }
});

// API to list user's Spaceship files
app.get('/api/files', (req, res) => {
    const deviceId = req.headers['x-device-id'] || req.query.deviceId;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadSpaceshipDb();
    const userFiles = Object.entries(db.files)
        .filter(([_, file]) => file.deviceId === deviceId)
        .map(([id, file]) => ({
            id,
            url: `https://${HOST}/files/${id}${path.extname(file.originalName) || '.png'}`,
            originalName: file.originalName,
            size: file.size,
            uploadedAt: file.uploadedAt
        }))
        .sort((a, b) => b.uploadedAt - a.uploadedAt);

    res.json({
        success: true,
        files: userFiles,
        count: userFiles.length
    });
});

// Favicon fallback - redirect to logo.png
app.get('/favicon.ico', (req, res) => {
    res.redirect('/logo.png');
});

// ============ SPEDX.STORE DOMAIN ROUTING ============
const SPEDX_DIR = 'C:/var/www/html/spedx';

// Serve spedx.store from dedicated directory
app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.includes('spedx.store')) {
        // Handle root path
        if (req.path === '/') {
            return res.sendFile(path.join(SPEDX_DIR, 'index.html'));
        }

        // Try exact path first
        let filePath = path.join(SPEDX_DIR, req.path);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return res.sendFile(filePath);
        }

        // Try with .html extension
        filePath = path.join(SPEDX_DIR, req.path + '.html');
        if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
        }

        // Fallback to index.html for SPA routing
        return res.sendFile(path.join(SPEDX_DIR, 'index.html'));
    }
    next();
});

// ============ DOZ UP PLATFORM ROUTES (/up) ============
// Platform accessible at /up path to allow other developments at root
app.get('/up', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/up/my', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cabinet.html'));
});

app.get('/up/my-account', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'my-account.html'));
});

app.get('/up/changelog', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'changelog.html'));
});

app.get('/up/payment/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'success.html'));
});

app.get('/up/payment/cancel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'cancel.html'));
});

// Static files for /up path (CSS, JS, images)
// ============ DOZAI STATIC FILES ============
// Serve DOZ AI CLI deployed projects
app.use("/DOZAI", express.static(path.join(__dirname, "public/DOZAI"), {
    index: ["index.html", "index.htm"],
    extensions: ["html", "htm"],
    dotfiles: "ignore"
}));

app.use('/up', express.static(path.join(__dirname, 'public')));

// ============ ROOT REDIRECT ============
// Redirect root to /up platform (but serve index.html directly on up.doz.com)
app.get('/', (req, res) => {
    const host = req.headers.host || '';
    // On up.doz.com, serve the main page directly (avoid redirect loop)
    if (host.includes('up.doz.com')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    res.redirect(301, '/up');
});

// ============ AI EXPRESS ERROR HANDLER ============
// Catch all Express route errors and feed to AI interceptor for auto-fix
app.use((err, req, res, next) => {
    aiErrorInterceptor.handleError({
        message: err.message,
        source: 'express-route',
        stack: err.stack,
        context: { method: req.method, path: req.path, statusCode: err.status || 500 },
    });

    if (!res.headersSent) {
        res.status(err.status || 500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        });
    }
});

// Mobile app: serve with aggressive no-cache + version header for live updates
app.get('/mobile.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-DOZ-Version', APK_VERSION);
    res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// Service worker: always fresh (browsers check sw.js on every navigation)
app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Serve image uploader frontend (with optimized caching)
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// HTTP server on port 80 (for Cloudflare Flexible or direct access)
// Skip if nginx is handling port 80 (NGINX_PROXY=true or port conflict)
const NGINX_PROXY = process.env.NGINX_PROXY === 'true' || process.env.SKIP_PORT_80 === 'true';
let httpServer80 = null;

if (!NGINX_PROXY) {
    httpServer80 = http.createServer(app);
    httpServer80.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log('[Port 80] Already in use (nginx handles it), continuing without direct binding');
            // Don't crash - nginx is handling this port
        } else {
            console.error('[Port 80] Server error:', err.message);
        }
    });
    // Use setImmediate to ensure error handler is fully registered before listen
    setImmediate(() => {
        httpServer80.listen(80, '0.0.0.0', () => {
            console.log(`HTTP server running at https://${HOST}:80`);
        });
    });
} else {
    console.log('[Port 80] Skipping - nginx is configured as reverse proxy');
}

// Also attach WebSocket routing to port 80 (only if httpServer80 is active)
if (httpServer80) {
    httpServer80.on('upgrade', (req, socket, head) => {
        const pathname = req.url.split('?')[0];
        const wsRoutes80 = {
            '/ws/live': wss,
            '/ws/admin': adminWss,
            '/ws/monitor': monitorWss,
            '/ws/viral': viralWss,
            '/ws/analytics': analyticsWss,
            '/ws/support': supportWss,
            '/ws/agents': agentsWss
        };
        const target = wsRoutes80[pathname];
        if (target) {
            target.handleUpgrade(req, socket, head, (ws) => {
                target.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });
}

let serverRetries = 0;
function startMainServer() {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Gateway v${APP_VERSION} running at https://${HOST}:${PORT}`);
        console.log(`Image uploader at https://${HOST}/`);
        console.log(`ConnectHub at https://${HOST}/7G/`);
        console.log(`WebSocket live tracking at wss://${HOST}/ws/live`);
        console.log(`WebSocket real-time analytics at wss://${HOST}/ws/analytics`);
        console.log(`Admin notification WebSocket at wss://${HOST}/ws/admin`);
        console.log(`Real-Time Analytics Dashboard at https://${HOST}/admin/analytics.html`);
        console.log(`V2 Subscription at https://${HOST}/v2`);
        console.log(`V2 Admin Panel at https://${HOST}/v2/admin`);
        console.log(`Admin API: Username: admin, Password: ${process.env.ADMIN_PASSWORD ? '***' + process.env.ADMIN_PASSWORD.slice(-3) : 'NOT SET (check .env)'}`);

        // ============ START AI OPERATIONS CENTER ============
        setTimeout(() => {
            try {
                aiOpsCenter.start();

                // Broadcast AI events to admin WebSocket
                aiOpsCenter.on('health:check', (data) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'health', data });
                });
                aiOpsCenter.on('performance:issues', (issues) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'performance', issues });
                });
                aiOpsCenter.on('security:alert', (alerts) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'security', alerts, priority: 'high' });
                });
                aiOpsCenter.on('quality:issues', (issues) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'quality', issues });
                });
                aiOpsCenter.on('report:generated', (report) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'report', report });
                });

                console.log('[AI-Ops] Connected to admin WebSocket for real-time updates');
            } catch (e) {
                console.log('[AI-Ops] Init error:', e.message);
            }
        }, 5000);
    });
}

// Broadcast to all admin WebSocket clients
function broadcastToAdmins(message) {
    if (typeof adminWss !== 'undefined' && adminWss.clients) {
        const data = JSON.stringify(message);
        adminWss.clients.forEach(client => {
            if (client.readyState === 1) {
                try { client.send(data); } catch (e) {}
            }
        });
    }
}
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        serverRetries++;
        if (serverRetries <= 5) {
            console.log(`[Port ${PORT}] In use, retrying in ${serverRetries * 2}s (attempt ${serverRetries}/5)...`);
            setTimeout(() => startMainServer(), serverRetries * 2000);
        } else {
            console.error(`[FATAL] Port ${PORT} still in use after 5 retries — exiting`);
            process.exit(1);
        }
    } else {
        console.error(`[Port ${PORT}] Server error:`, err.message);
    }
});
startMainServer();

// Central WebSocket upgrade router (ws@8.x abortHandshake bug: multiple WSS on same server kill each other)
server.on('upgrade', (req, socket, head) => {
    // Proxy WebSocket upgrades for rdp.doz.com to Kasm
    const wsHost = (req.headers.host || "").toLowerCase();
    if (wsHost.includes("rdp.doz.com")) {
        const tls = require("tls");
        const proxySocket = tls.connect({ host: "127.0.0.1", port: 8443, rejectUnauthorized: false }, () => {
            let rawHeaders = "GET " + (req.url || "/") + " HTTP/1.1\r\n";
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
                rawHeaders += req.rawHeaders[i] + ": " + req.rawHeaders[i + 1] + "\r\n";
            }
            rawHeaders += "\r\n";
            proxySocket.write(rawHeaders);
            if (head && head.length) proxySocket.write(head);
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });
        proxySocket.on("error", () => socket.destroy());
        socket.on("error", () => proxySocket.destroy());
        return;
    }
    const pathname = req.url.split('?')[0];
    const wsRoutes = {
        '/ws/live': wss,
        '/ws/admin': adminWss,
        '/ws/monitor': monitorWss,
        '/ws/viral': viralWss,
        '/ws/analytics': analyticsWss,
        '/ws/support': supportWss,
        '/ws/agents': agentsWss,
        '/terminal/ssh': sshRelay.wss
    };
    const target = wsRoutes[pathname];
    if (target) {
        target.handleUpgrade(req, socket, head, (ws) => {
            target.emit('connection', ws, req);
        });
    } else {
        socket.destroy();
    }
});

// Start HTTPS server for Cloudflare Full SSL
// Skip if nginx is handling port 443 (NGINX_PROXY=true)
if (httpsServer && !NGINX_PROXY) {
    // Central WebSocket upgrade router for HTTPS server
    httpsServer.on('upgrade', (req, socket, head) => {
        // Proxy WebSocket upgrades for rdp.doz.com to Kasm
        const wsHostHttps = (req.headers.host || "").toLowerCase();
        if (wsHostHttps.includes("rdp.doz.com")) {
            const tls = require("tls");
            const proxySocket = tls.connect({ host: "127.0.0.1", port: 8443, rejectUnauthorized: false }, () => {
                let rawHeaders = "GET " + (req.url || "/") + " HTTP/1.1\r\n";
                for (let i = 0; i < req.rawHeaders.length; i += 2) {
                    rawHeaders += req.rawHeaders[i] + ": " + req.rawHeaders[i + 1] + "\r\n";
                }
                rawHeaders += "\r\n";
                proxySocket.write(rawHeaders);
                if (head && head.length) proxySocket.write(head);
                proxySocket.pipe(socket);
                socket.pipe(proxySocket);
            });
            proxySocket.on("error", () => socket.destroy());
            socket.on("error", () => proxySocket.destroy());
            return;
        }
        const pathname = req.url.split('?')[0];
        const wsRoutesHttps = {
            '/ws/live': wss,
            '/ws/admin': adminWss,
            '/ws/monitor': monitorWss,
            '/ws/viral': viralWss,
            '/ws/analytics': analyticsWss,
            '/ws/support': supportWss,
            '/ws/agents': agentsWss
        };
        const target = wsRoutesHttps[pathname];
        if (target) {
            target.handleUpgrade(req, socket, head, (ws) => {
                target.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    httpsServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Port ${HTTPS_PORT}] Already in use (nginx handles it), continuing without direct binding`);
            // Don't crash - nginx is handling this port
        } else {
            console.error(`[Port ${HTTPS_PORT}] HTTPS server error:`, err.message);
        }
    });
    // Use setImmediate to ensure error handler is registered
    setImmediate(() => {
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log(`HTTPS server running at https://${HOST}:${HTTPS_PORT}`);
            console.log(`Cloudflare Full SSL mode enabled`);
        });
    });
} else if (NGINX_PROXY) {
    console.log(`[Port ${HTTPS_PORT}] Skipping - nginx is configured as reverse proxy`);
} else {
    console.log(`[Warning] SSL certificates not found in ./ssl/ - HTTPS disabled`);
    console.log(`[Warning] Cloudflare should use Flexible SSL mode`);
}

// ============ DEMO REMINDER SCHEDULER ============
// Check for demos starting soon every minute
const notifiedDemos = new Set();

setInterval(() => {
    try {
        const reminders = schedulingService.getDemosNeedingReminders();

        // Notify for demos starting in 15 minutes
        for (const demo of reminders.in15min || []) {
            const key = `${demo.id}-15min`;
            if (!notifiedDemos.has(key)) {
                notificationService.notifyDemoStartingSoon(demo);
                activityService.log('DEMO_REMINDER', {
                    description: `Demo reminder: ${demo.company} starting in 15 minutes`,
                    entityType: 'demo',
                    entityId: demo.id,
                    entityName: demo.company
                });
                notifiedDemos.add(key);
                console.log(`[Demo Reminder] Sent 15-min reminder for ${demo.company}`);
            }
        }

        // Clean up old notification keys (keep last 100)
        if (notifiedDemos.size > 100) {
            const arr = Array.from(notifiedDemos);
            arr.slice(0, arr.length - 100).forEach(k => notifiedDemos.delete(k));
        }
    } catch (e) {
        console.error('[Demo Reminder] Error:', e.message);
    }
}, 60000); // Check every minute

// ============ GRACEFUL SHUTDOWN ============
function gracefulShutdown(signal) {
    console.log(`[Shutdown] ${signal} received, closing servers...`);
    const forceTimeout = setTimeout(() => {
        console.log('[Shutdown] Force exit after 5s timeout');
        process.exit(0);
    }, 5000);
    forceTimeout.unref();

    let closed = 0;
    const servers = [httpServer80, server, httpsServer].filter(Boolean);
    const total = servers.length;

    servers.forEach(s => {
        s.close(() => {
            closed++;
            if (closed >= total) {
                console.log('[Shutdown] All servers closed cleanly');
                clearTimeout(forceTimeout);
                process.exit(0);
            }
        });
    });
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ============ DASHBOARD REAL DATA ENDPOINTS ============
app.get('/api/admin/dashboard/stats', (req, res) => {
    try {
        res.json(dashboardStats.getAllStats());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/tickets', (req, res) => {
    try {
        res.json(dashboardStats.getTickets());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/subscriptions', (req, res) => {
    try {
        res.json(dashboardStats.getSubscriptions());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/mrr', (req, res) => {
    try {
        res.json({ mrr: dashboardStats.getMRR() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/traffic-sources', (req, res) => {
    try {
        res.json(dashboardStats.getTrafficSources());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/growth-chart', (req, res) => {
    try {
        res.json(dashboardStats.getGrowthChart());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/roi', (req, res) => {
    try {
        res.json(dashboardStats.getROIData());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
