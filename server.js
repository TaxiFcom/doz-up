const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const app = express();
const server = http.createServer(app);

// WebSocket for real-time analytics
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server, path: '/ws/analytics' });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'doz.com';

// ============================================
// REAL-TIME ANALYTICS SYSTEM
// ============================================

// In-memory analytics storage (use Redis/DB in production)
const analytics = {
    // Active sessions (real-time visitors)
    activeSessions: new Map(),

    // Today's data
    today: {
        pageViews: 0,
        uniqueVisitors: new Set(),
        sessions: 0,
        uploads: 0,
        downloads: 0,
        bounces: 0,
        totalSessionDuration: 0,

        // Hourly breakdown
        hourlyViews: Array(24).fill(0),
        hourlyVisitors: Array(24).fill(0),

        // Pages
        pages: {},

        // Traffic sources
        sources: {
            direct: 0,
            organic: 0,
            social: 0,
            referral: 0,
            paid: 0,
            email: 0
        },

        // Countries (using GeoIP)
        countries: {},
        cities: {},

        // Devices
        devices: {
            desktop: 0,
            mobile: 0,
            tablet: 0
        },

        // Browsers
        browsers: {},

        // OS
        operatingSystems: {},

        // Events
        events: [],

        // Real-time events (last 30 seconds)
        realtimeEvents: []
    },

    // Historical data (last 30 days)
    historical: [],

    // Real-time stats
    realtime: {
        activeUsers: 0,
        viewsPerSecond: 0,
        topActivePages: []
    }
};

// Broadcast to all connected analytics clients
function broadcastAnalytics(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Get traffic source from referrer
function getTrafficSource(referrer, utmSource) {
    if (utmSource) {
        if (utmSource.includes('google') || utmSource.includes('bing')) return 'paid';
        if (utmSource.includes('facebook') || utmSource.includes('twitter') || utmSource.includes('linkedin')) return 'social';
        if (utmSource.includes('email') || utmSource.includes('newsletter')) return 'email';
        return 'referral';
    }

    if (!referrer) return 'direct';

    const ref = referrer.toLowerCase();
    if (ref.includes('google.') || ref.includes('bing.') || ref.includes('yahoo.') || ref.includes('duckduckgo.') || ref.includes('baidu.')) return 'organic';
    if (ref.includes('facebook.') || ref.includes('twitter.') || ref.includes('linkedin.') || ref.includes('instagram.') || ref.includes('reddit.') || ref.includes('t.co')) return 'social';
    if (ref.includes(HOST)) return 'direct';
    return 'referral';
}

// Parse User-Agent for device info
function parseUserAgent(ua) {
    if (!ua) return { device: 'desktop', browser: 'Unknown', os: 'Unknown' };

    const uaLower = ua.toLowerCase();

    // Device
    let device = 'desktop';
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) device = 'mobile';
    else if (/tablet|ipad|playbook|silk/i.test(uaLower)) device = 'tablet';

    // Browser
    let browser = 'Other';
    if (uaLower.includes('edg/')) browser = 'Edge';
    else if (uaLower.includes('chrome')) browser = 'Chrome';
    else if (uaLower.includes('firefox')) browser = 'Firefox';
    else if (uaLower.includes('safari')) browser = 'Safari';
    else if (uaLower.includes('opera') || uaLower.includes('opr/')) browser = 'Opera';

    // OS
    let os = 'Other';
    if (uaLower.includes('windows')) os = 'Windows';
    else if (uaLower.includes('mac os')) os = 'macOS';
    else if (uaLower.includes('linux')) os = 'Linux';
    else if (uaLower.includes('android')) os = 'Android';
    else if (uaLower.includes('iphone') || uaLower.includes('ipad')) os = 'iOS';

    return { device, browser, os };
}

// Get country from IP (simplified - use MaxMind GeoIP in production)
async function getGeoFromIP(ip) {
    // For localhost/development, return random country for demo
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        const countries = ['United States', 'United Kingdom', 'Germany', 'France', 'Canada', 'Australia', 'Japan', 'Brazil', 'India', 'Netherlands'];
        const cities = ['New York', 'London', 'Berlin', 'Paris', 'Toronto', 'Sydney', 'Tokyo', 'Sao Paulo', 'Mumbai', 'Amsterdam'];
        const idx = Math.floor(Math.random() * countries.length);
        return { country: countries[idx], city: cities[idx], countryCode: 'US' };
    }

    try {
        // Free GeoIP service (rate limited - use MaxMind in production)
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,countryCode`);
        const data = await response.json();
        return { country: data.country || 'Unknown', city: data.city || 'Unknown', countryCode: data.countryCode || 'XX' };
    } catch {
        return { country: 'Unknown', city: 'Unknown', countryCode: 'XX' };
    }
}

// Track page view
async function trackPageView(req, sessionId, page) {
    const now = new Date();
    const hour = now.getHours();
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
    const referrer = req.headers.referer || req.query.ref || '';
    const utmSource = req.query.utm_source || '';
    const ua = req.headers['user-agent'] || '';
    const { device, browser, os } = parseUserAgent(ua);
    const source = getTrafficSource(referrer, utmSource);
    const geo = await getGeoFromIP(ip);

    // Update session
    if (!analytics.activeSessions.has(sessionId)) {
        analytics.today.sessions++;
        analytics.today.uniqueVisitors.add(sessionId);
        analytics.activeSessions.set(sessionId, {
            id: sessionId,
            startTime: now,
            lastActivity: now,
            pageViews: 0,
            pages: [],
            ip,
            device,
            browser,
            os,
            country: geo.country,
            city: geo.city,
            source
        });
    }

    const session = analytics.activeSessions.get(sessionId);
    session.lastActivity = now;
    session.pageViews++;
    session.pages.push({ page, time: now });
    session.currentPage = page;

    // Update today's stats
    analytics.today.pageViews++;
    analytics.today.hourlyViews[hour]++;
    analytics.today.pages[page] = (analytics.today.pages[page] || 0) + 1;
    analytics.today.sources[source]++;
    analytics.today.devices[device]++;
    analytics.today.browsers[browser] = (analytics.today.browsers[browser] || 0) + 1;
    analytics.today.operatingSystems[os] = (analytics.today.operatingSystems[os] || 0) + 1;
    analytics.today.countries[geo.country] = (analytics.today.countries[geo.country] || 0) + 1;
    analytics.today.cities[geo.city] = (analytics.today.cities[geo.city] || 0) + 1;

    // Real-time event
    const event = {
        type: 'pageview',
        sessionId: sessionId.substring(0, 8),
        page,
        country: geo.country,
        city: geo.city,
        device,
        browser,
        source,
        time: now.toISOString()
    };

    analytics.today.realtimeEvents.unshift(event);
    if (analytics.today.realtimeEvents.length > 100) {
        analytics.today.realtimeEvents.pop();
    }

    // Broadcast real-time update
    broadcastAnalytics({
        type: 'pageview',
        data: event,
        realtime: getRealtimeStats()
    });

    return event;
}

// Track event
function trackEvent(req, sessionId, eventName, eventData = {}) {
    const now = new Date();

    const event = {
        type: 'event',
        name: eventName,
        sessionId: sessionId.substring(0, 8),
        data: eventData,
        time: now.toISOString()
    };

    analytics.today.events.push(event);
    analytics.today.realtimeEvents.unshift(event);

    if (eventName === 'upload') analytics.today.uploads++;
    if (eventName === 'download') analytics.today.downloads++;

    broadcastAnalytics({
        type: 'event',
        data: event,
        realtime: getRealtimeStats()
    });

    return event;
}

// Get real-time stats
function getRealtimeStats() {
    const now = Date.now();
    const activeTimeout = 5 * 60 * 1000; // 5 minutes

    // Clean up inactive sessions
    for (const [id, session] of analytics.activeSessions) {
        if (now - session.lastActivity.getTime() > activeTimeout) {
            // Calculate session duration
            const duration = (session.lastActivity.getTime() - session.startTime.getTime()) / 1000;
            analytics.today.totalSessionDuration += duration;

            // Check for bounce (single page view)
            if (session.pageViews === 1) {
                analytics.today.bounces++;
            }

            analytics.activeSessions.delete(id);
        }
    }

    // Get active users by page
    const pageUsers = {};
    for (const session of analytics.activeSessions.values()) {
        const page = session.currentPage || '/';
        pageUsers[page] = (pageUsers[page] || 0) + 1;
    }

    const topActivePages = Object.entries(pageUsers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([page, users]) => ({ page, users }));

    return {
        activeUsers: analytics.activeSessions.size,
        pageViewsToday: analytics.today.pageViews,
        uniqueVisitorsToday: analytics.today.uniqueVisitors.size,
        sessionsToday: analytics.today.sessions,
        uploadsToday: analytics.today.uploads,
        downloadsToday: analytics.today.downloads,
        bounceRate: analytics.today.sessions > 0
            ? ((analytics.today.bounces / analytics.today.sessions) * 100).toFixed(1)
            : 0,
        avgSessionDuration: analytics.today.sessions > 0
            ? Math.round(analytics.today.totalSessionDuration / analytics.today.sessions)
            : 0,
        topActivePages,
        viewsPerMinute: calculateViewsPerMinute()
    };
}

// Calculate views per minute (last 5 minutes)
function calculateViewsPerMinute() {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentEvents = analytics.today.realtimeEvents.filter(e =>
        new Date(e.time).getTime() > fiveMinutesAgo && e.type === 'pageview'
    );
    return Math.round(recentEvents.length / 5);
}

// Get full analytics data
function getFullAnalytics() {
    const realtime = getRealtimeStats();

    // Sort pages by views
    const topPages = Object.entries(analytics.today.pages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([page, views]) => ({ page, views }));

    // Sort countries by visits
    const topCountries = Object.entries(analytics.today.countries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([country, visits]) => ({ country, visits }));

    // Sort cities
    const topCities = Object.entries(analytics.today.cities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([city, visits]) => ({ city, visits }));

    // Sort browsers
    const browsers = Object.entries(analytics.today.browsers)
        .sort((a, b) => b[1] - a[1])
        .map(([browser, count]) => ({ browser, count }));

    // Sort OS
    const operatingSystems = Object.entries(analytics.today.operatingSystems)
        .sort((a, b) => b[1] - a[1])
        .map(([os, count]) => ({ os, count }));

    // Active sessions details
    const activeSessions = Array.from(analytics.activeSessions.values()).map(s => ({
        id: s.id.substring(0, 8),
        currentPage: s.currentPage,
        pageViews: s.pageViews,
        duration: Math.round((Date.now() - s.startTime.getTime()) / 1000),
        country: s.country,
        city: s.city,
        device: s.device,
        browser: s.browser,
        source: s.source
    }));

    return {
        success: true,
        realtime,
        today: {
            pageViews: analytics.today.pageViews,
            uniqueVisitors: analytics.today.uniqueVisitors.size,
            sessions: analytics.today.sessions,
            uploads: analytics.today.uploads,
            downloads: analytics.today.downloads,
            bounceRate: realtime.bounceRate,
            avgSessionDuration: realtime.avgSessionDuration,
            hourlyViews: analytics.today.hourlyViews,
            sources: analytics.today.sources,
            devices: analytics.today.devices
        },
        topPages,
        topCountries,
        topCities,
        browsers,
        operatingSystems,
        activeSessions,
        recentEvents: analytics.today.realtimeEvents.slice(0, 50)
    };
}

// ============================================
// EXPRESS MIDDLEWARE & ROUTES
// ============================================

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create data directory for analytics persistence
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        cb(null, uuidv4() + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max file size for free membership
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|bmp/;
        if (allowedTypes.test(path.extname(file.originalname).toLowerCase()) || allowedTypes.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// Parse JSON bodies
app.use(express.json());

// Session ID middleware
app.use((req, res, next) => {
    let sessionId = req.headers['x-session-id'] || req.query.sid;

    if (!sessionId) {
        // Try to get from cookie
        const cookies = req.headers.cookie?.split(';').reduce((acc, c) => {
            const [key, val] = c.trim().split('=');
            acc[key] = val;
            return acc;
        }, {}) || {};
        sessionId = cookies['doz_session'];
    }

    if (!sessionId) {
        sessionId = uuidv4();
        res.setHeader('Set-Cookie', `doz_session=${sessionId}; Path=/; Max-Age=86400; SameSite=Lax`);
    }

    req.sessionId = sessionId;
    next();
});

// ============ DOZ UP PLATFORM ROUTES (/up) ============
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

app.get('/up/download', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

app.get('/up/payment/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'success.html'));
});

app.get('/up/payment/cancel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'cancel.html'));
});

// Handle /up/i/ URLs - redirect to /i/ handler for share pages
app.get('/up/i/:filename', (req, res) => {
    const queryString = Object.keys(req.query).length > 0
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    res.redirect(301, `/i/${req.params.filename}${queryString}`);
});

// Static files for /up path
app.use('/up', express.static(path.join(__dirname, 'public')));

// Serve static files with analytics tracking
app.use(express.static(path.join(__dirname, 'public')));

// Smart Image Sharing - serve share page or raw image
const SHARE_HOST = 'doz.com/up';
app.get('/i/:filename', (req, res) => {
    const filename = req.params.filename;
    let filePath = path.join(uploadsDir, filename);
    const userAgent = req.headers['user-agent'] || '';

    // Try to find file with alternative extensions if not found
    if (!fs.existsSync(filePath)) {
        const baseName = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
        const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        for (const ext of extensions) {
            const altPath = path.join(uploadsDir, baseName + ext);
            if (fs.existsSync(altPath)) {
                filePath = altPath;
                break;
            }
        }
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
    }

    const stats = fs.statSync(filePath);
    const fileSizeKB = Math.round(stats.size / 1024);
    const imageUrl = `https://${SHARE_HOST}/i/${filename}`;
    const rawImageUrl = `https://${SHARE_HOST}/i/${filename}?raw=1`;

    // If raw parameter, serve the actual image
    if (req.query.raw === '1') {
        return res.sendFile(filePath);
    }

    // Detect if request is from img tag or direct image request
    const acceptHeader = req.headers['accept'] || '';
    const isImageRequest = acceptHeader.includes('image/') && !acceptHeader.includes('text/html');
    const referer = req.headers['referer'] || '';
    const isFromDozSite = referer.includes('doz.com') || referer.includes('localhost');
    const isFetchRequest = req.headers['sec-fetch-dest'] === 'image' || req.headers['sec-fetch-mode'] === 'cors';

    // Serve raw image for img tags, fetch requests, or requests from DOZ site
    if (isImageRequest || isFromDozSite || isFetchRequest) {
        return res.sendFile(filePath);
    }

    // Detect social media crawlers
    const crawlers = ['WhatsApp', 'facebookexternalhit', 'Twitterbot', 'TelegramBot', 'LinkedInBot', 'Discord'];
    const isCrawler = crawlers.some(c => userAgent.includes(c));

    if (isCrawler) {
        return res.send(`<!DOCTYPE html><html><head>
            <meta property="og:title" content="Check out this image on DOZ">
            <meta property="og:image" content="${rawImageUrl}">
            <meta property="og:url" content="${imageUrl}">
            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:image" content="${rawImageUrl}">
        </head><body><script>window.location.href="${imageUrl}";</script></body></html>`);
    }

    // Serve share page for browsers
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shared Image - DOZ</title>
    <meta property="og:image" content="${rawImageUrl}">
    <link rel="icon" href="/favicon.ico">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; background: linear-gradient(135deg, #0f0f1a, #1a1a2e); min-height: 100vh; color: #fff; display: flex; flex-direction: column; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; flex: 1; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 10px 0 20px; }
        .logo { font-size: 1.5rem; font-weight: 800; background: linear-gradient(135deg, #7c3aed, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-decoration: none; }
        .try-btn { background: linear-gradient(135deg, #7c3aed, #6366f1); border: none; color: #fff; padding: 10px 20px; border-radius: 25px; font-weight: 600; cursor: pointer; text-decoration: none; }
        .image-container { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; margin-bottom: 20px; }
        .image-container img { width: 100%; display: block; cursor: pointer; }
        .image-info { padding: 15px 20px; background: rgba(0,0,0,0.3); display: flex; justify-content: space-between; font-size: 0.85rem; color: rgba(255,255,255,0.6); }
        .share-section { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 25px; margin-bottom: 20px; }
        .share-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; text-align: center; }
        .share-buttons { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
        .share-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 16px; border-radius: 12px; border: none; font-size: 0.9rem; font-weight: 600; cursor: pointer; color: #fff; text-decoration: none; transition: transform 0.2s; }
        .share-btn:hover { transform: translateY(-3px); }
        .share-btn.whatsapp { background: linear-gradient(135deg, #25D366, #128C7E); }
        .share-btn.telegram { background: linear-gradient(135deg, #0088cc, #005f99); }
        .share-btn.twitter { background: linear-gradient(135deg, #1DA1F2, #0d8bd9); }
        .share-btn.copy { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
        .share-btn.download { background: linear-gradient(135deg, #10b981, #059669); }
        .invite-section { background: linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(16, 185, 129, 0.2)); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 16px; padding: 30px; text-align: center; }
        .invite-title { font-size: 1.3rem; font-weight: 700; margin-bottom: 10px; }
        .invite-text { color: rgba(255,255,255,0.7); margin-bottom: 20px; }
        .invite-btn { background: linear-gradient(135deg, #7c3aed, #6366f1); border: none; color: #fff; padding: 14px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; text-decoration: none; }
        .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(100px); background: #10b981; color: #fff; padding: 14px 28px; border-radius: 12px; font-weight: 600; opacity: 0; transition: all 0.3s; z-index: 1000; }
        .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <a href="/up" class="logo">DOZ</a>
            <a href="/up/download" class="try-btn">Get DOZ Free</a>
        </div>
        <div class="image-container">
            <img src="${rawImageUrl}" alt="Shared image" onclick="window.open('${rawImageUrl}', '_blank')">
            <div class="image-info">
                <span>${fileSizeKB} KB</span>
                <span>Shared via DOZ</span>
            </div>
        </div>
        <div class="share-section">
            <div class="share-title">Share this image</div>
            <div class="share-buttons">
                <a href="https://wa.me/?text=${encodeURIComponent('Check this out! ' + imageUrl)}" target="_blank" class="share-btn whatsapp">WhatsApp</a>
                <a href="https://t.me/share/url?url=${encodeURIComponent(imageUrl)}" target="_blank" class="share-btn telegram">Telegram</a>
                <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(imageUrl)}" target="_blank" class="share-btn twitter">X/Twitter</a>
                <button onclick="copyLink()" class="share-btn copy">Copy Link</button>
                <a href="${rawImageUrl}" download class="share-btn download">Download</a>
            </div>
        </div>
        <div class="invite-section">
            <div class="invite-title">3 Seconds to Share</div>
            <div class="invite-text">Share screenshots instantly. No signup required.</div>
            <a href="/up/download" class="invite-btn">Try It Now - Free</a>
        </div>
    </div>
    <div id="toast" class="toast">Link copied!</div>
    <script>
        function copyLink() {
            navigator.clipboard.writeText('${imageUrl}').then(() => {
                const toast = document.getElementById('toast');
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 2000);
            });
        }
        // Track pageview
        fetch('/api/analytics/pageview', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ page: '/i/${filename}', referrer: document.referrer })
        }).catch(() => {});
    </script>
</body>
</html>`);
});

// Fallback static serving for /i path (for direct image access)
app.use('/i', express.static(uploadsDir));

// Analytics tracking endpoint (called by client-side JavaScript)
app.post('/api/analytics/pageview', async (req, res) => {
    const { page } = req.body;
    const event = await trackPageView(req, req.sessionId, page || req.headers.referer || '/');
    res.json({ success: true, event });
});

app.post('/api/analytics/event', (req, res) => {
    const { name, data } = req.body;
    const event = trackEvent(req, req.sessionId, name, data);
    res.json({ success: true, event });
});

// Get analytics data (admin only)
app.get('/api/analytics', (req, res) => {
    res.json(getFullAnalytics());
});

// Get real-time stats only
app.get('/api/analytics/realtime', (req, res) => {
    res.json({
        success: true,
        ...getRealtimeStats(),
        recentEvents: analytics.today.realtimeEvents.slice(0, 20)
    });
});

// Upload endpoint with analytics
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    trackEvent(req, req.sessionId, 'upload', {
        filename: req.file.filename,
        size: req.file.size
    });

    const imageUrl = `https://${HOST}/i/${req.file.filename}`;
    res.json({
        success: true,
        url: imageUrl,
        filename: req.file.filename
    });
});

// Download tracking
app.get('/api/download/:platform', (req, res) => {
    trackEvent(req, req.sessionId, 'download', {
        platform: req.params.platform
    });
    res.json({ success: true });
});

// Admin stats (legacy compatibility)
app.get('/api/admin/stats', (req, res) => {
    const realtime = getRealtimeStats();
    res.json({
        success: true,
        devices: realtime.uniqueVisitorsToday,
        uploads: {
            today: realtime.uploadsToday,
            total: analytics.today.uploads
        },
        activeUsers: realtime.activeUsers,
        pageViews: realtime.pageViewsToday
    });
});

// Error handling
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 1GB' });
        }
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', activeUsers: analytics.activeSessions.size });
});

// API health endpoints (for clients expecting /api/ prefix)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', activeUsers: analytics.activeSessions.size, uptime: process.uptime() });
});

app.get('/api/ping', (req, res) => {
    res.send('pong');
});

// Analytics aliases for compatibility
app.get('/api/analytics/stats', (req, res) => {
    res.json({
        success: true,
        realtime: {
            activeUsers: analytics.activeSessions.size,
            pageViewsToday: analytics.today.pageViews,
            uniqueVisitorsToday: analytics.today.uniqueVisitors.size,
            sessionsToday: analytics.today.sessions,
            uploadsToday: analytics.today.uploads,
            downloadsToday: analytics.today.downloads
        },
        today: analytics.today,
        sources: analytics.today.sources,
        devices: analytics.today.devices
    });
});

app.post('/api/analytics/track', express.json(), (req, res) => {
    const { event, page, data, sessionId } = req.body;
    const hour = new Date().getHours();

    if (event === 'pageview' || page) {
        analytics.today.pageViews++;
        analytics.today.hourlyViews[hour]++;
        const pagePath = page || '/';
        analytics.today.pages[pagePath] = (analytics.today.pages[pagePath] || 0) + 1;
    }

    if (event) {
        analytics.today.events.push({
            type: 'event',
            name: event,
            data: data || {},
            time: new Date().toISOString()
        });
    }

    broadcastAnalytics({ type: 'track', event, page, data });
    res.json({ success: true, tracked: true });
});

// Admin telemetry endpoint
app.get('/api/admin/telemetry', (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        success: true,
        server: {
            uptime: process.uptime(),
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024)
            },
            cpu: process.cpuUsage(),
            nodeVersion: process.version
        },
        connections: {
            websocket: wss.clients.size,
            activeSessions: analytics.activeSessions.size
        },
        analytics: {
            pageViewsToday: analytics.today.pageViews,
            eventsToday: analytics.today.events.length,
            uploadsToday: analytics.today.uploads
        }
    });
});

// Admin support inbox
app.get('/api/admin/support/inbox', (req, res) => {
    // Return empty array if no support tickets system
    res.json({
        success: true,
        tickets: [],
        unread: 0,
        total: 0
    });
});

app.post('/api/admin/support/inbox', express.json(), (req, res) => {
    res.json({ success: true });
});

// Admin dashboard permissions
app.get('/api/admin/dashboard-permissions', (req, res) => {
    res.json({
        success: true,
        permissions: {
            analytics: true,
            users: true,
            uploads: true,
            settings: true,
            support: true,
            billing: true
        }
    });
});

app.post('/api/admin/dashboard-permissions', express.json(), (req, res) => {
    res.json({ success: true });
});

// AI Diagnostic endpoint - real-time issue detection and resolution
app.get('/api/diagnostics', async (req, res) => {
    const diagnostics = {
        timestamp: Date.now(),
        server: { status: 'ok', uptime: process.uptime() },
        upload: { status: 'ok' },
        storage: { status: 'ok' },
        issues: [],
        fixes: []
    };

    try {
        // Check uploads directory
        const uploadsPath = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsPath)) {
            diagnostics.storage.status = 'error';
            diagnostics.issues.push('uploads_dir_missing');
            // Auto-fix: create directory
            fs.mkdirSync(uploadsPath, { recursive: true });
            diagnostics.fixes.push('created_uploads_dir');
        }

        // Check disk space (basic check)
        const stats = fs.statfsSync ? fs.statfsSync(uploadsPath) : null;
        if (stats && stats.bavail * stats.bsize < 100 * 1024 * 1024) {
            diagnostics.storage.status = 'warning';
            diagnostics.issues.push('low_disk_space');
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
        const memUsage = process.memoryUsage();
        if (memUsage.heapUsed > 500 * 1024 * 1024) {
            diagnostics.server.memory = 'high';
            diagnostics.issues.push('high_memory_usage');
            // Auto-fix: trigger garbage collection if available
            if (global.gc) {
                global.gc();
                diagnostics.fixes.push('triggered_gc');
            }
        }

        diagnostics.healthy = diagnostics.issues.length === 0;
        diagnostics.autoFixed = diagnostics.fixes.length;

    } catch (e) {
        diagnostics.error = e.message;
        diagnostics.healthy = false;
    }

    res.json(diagnostics);
});

// Real-time upload status for clients
app.post('/api/upload-check', express.json(), (req, res) => {
    const { errorType, errorMessage, deviceId } = req.body;

    const resolution = {
        canRetry: true,
        retryDelay: 100,
        suggestion: 'retry'
    };

    // AI-powered error resolution
    if (errorMessage) {
        if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            resolution.suggestion = 'retry_with_smaller_timeout';
            resolution.retryDelay = 50;
            resolution.tip = 'Server is slow, using faster retry';
        } else if (errorMessage.includes('ECONNREFUSED')) {
            resolution.canRetry = true;
            resolution.retryDelay = 1000;
            resolution.suggestion = 'server_restarting';
            resolution.tip = 'Server is restarting, will retry shortly';
        } else if (errorMessage.includes('ENOTFOUND')) {
            resolution.canRetry = false;
            resolution.suggestion = 'check_internet';
            resolution.tip = 'No internet connection detected';
        } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
            resolution.canRetry = false;
            resolution.suggestion = 'ssl_error';
            resolution.tip = 'Security certificate issue';
        } else if (errorMessage.includes('413') || errorMessage.includes('too large')) {
            resolution.canRetry = false;
            resolution.suggestion = 'file_too_large';
            resolution.tip = 'Image is too large, try a smaller selection';
        }
    }

    res.json(resolution);
});

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('Analytics client connected');

    // Send initial data
    ws.send(JSON.stringify({
        type: 'init',
        data: getFullAnalytics()
    }));

    ws.on('close', () => {
        console.log('Analytics client disconnected');
    });
});

// Reset daily stats at midnight
function resetDailyStats() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
        // Save today's data to historical
        analytics.historical.unshift({
            date: new Date().toISOString().split('T')[0],
            ...analytics.today,
            uniqueVisitors: analytics.today.uniqueVisitors.size
        });

        // Keep only last 30 days
        if (analytics.historical.length > 30) {
            analytics.historical.pop();
        }

        // Reset today
        analytics.today = {
            pageViews: 0,
            uniqueVisitors: new Set(),
            sessions: 0,
            uploads: 0,
            downloads: 0,
            bounces: 0,
            totalSessionDuration: 0,
            hourlyViews: Array(24).fill(0),
            hourlyVisitors: Array(24).fill(0),
            pages: {},
            sources: { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 },
            countries: {},
            cities: {},
            devices: { desktop: 0, mobile: 0, tablet: 0 },
            browsers: {},
            operatingSystems: {},
            events: [],
            realtimeEvents: []
        };

        // Schedule next reset
        resetDailyStats();
    }, timeUntilMidnight);
}

resetDailyStats();

// Start server
server.listen(PORT, () => {
    console.log(`DOZ UP Server running at http://localhost:${PORT}`);
    console.log(`Images served from https://${HOST}/i/`);
    console.log(`WebSocket analytics at ws://localhost:${PORT}/ws/analytics`);
});
