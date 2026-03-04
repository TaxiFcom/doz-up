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

// ============ SECURITY PATCHES (auth, CSRF, helmet, cookies, logging) ============
const { centralErrorHandler } = require('./src/gateway-patch')(app);

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
