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
