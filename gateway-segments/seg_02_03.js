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
    uploadSpeedLimitBps: 50 * 1024 * 1024, // 50 MB/sec - was 1 GB/sec
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
