
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
