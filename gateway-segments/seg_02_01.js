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
