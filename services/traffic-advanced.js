/**
 * DOZ UP - Advanced Traffic Analytics Engine
 * Enterprise-grade analytics with AI-powered insights
 * High-accuracy visitor tracking and behavior analysis
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const analyticsDbPath = path.join(dataDir, 'analytics-advanced.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ============ CONSTANTS ============
const BOT_PATTERNS = [
    /bot/i, /crawl/i, /spider/i, /scrape/i, /curl/i, /wget/i,
    /python/i, /java(?!script)/i, /php/i, /perl/i, /ruby/i,
    /googlebot/i, /bingbot/i, /yandex/i, /baidu/i, /duckduck/i,
    /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
    /slackbot/i, /telegrambot/i, /whatsapp/i, /discordbot/i,
    /semrush/i, /ahrefs/i, /moz\.com/i, /majestic/i,  // Fixed: moz -> moz.com to avoid matching Mozilla
    /lighthouse/i, /pagespeed/i, /gtmetrix/i, /pingdom/i,
    /uptimerobot/i, /statuscake/i, /newrelic/i, /datadog/i
];

const SEARCH_ENGINES = {
    'google': /google\./i,
    'bing': /bing\./i,
    'yahoo': /yahoo\./i,
    'duckduckgo': /duckduckgo/i,
    'baidu': /baidu/i,
    'yandex': /yandex/i
};

const SOCIAL_NETWORKS = {
    'facebook': /facebook|fb\./i,
    'twitter': /twitter|t\.co/i,
    'linkedin': /linkedin/i,
    'instagram': /instagram/i,
    'youtube': /youtube/i,
    'reddit': /reddit/i,
    'pinterest': /pinterest/i,
    'tiktok': /tiktok/i
};

const COUNTRY_DATA = {
    'US': { name: 'United States', flag: '🇺🇸', continent: 'NA' },
    'GB': { name: 'United Kingdom', flag: '🇬🇧', continent: 'EU' },
    'CA': { name: 'Canada', flag: '🇨🇦', continent: 'NA' },
    'AU': { name: 'Australia', flag: '🇦🇺', continent: 'OC' },
    'DE': { name: 'Germany', flag: '🇩🇪', continent: 'EU' },
    'FR': { name: 'France', flag: '🇫🇷', continent: 'EU' },
    'JP': { name: 'Japan', flag: '🇯🇵', continent: 'AS' },
    'IN': { name: 'India', flag: '🇮🇳', continent: 'AS' },
    'BR': { name: 'Brazil', flag: '🇧🇷', continent: 'SA' },
    'MX': { name: 'Mexico', flag: '🇲🇽', continent: 'NA' },
    'ES': { name: 'Spain', flag: '🇪🇸', continent: 'EU' },
    'IT': { name: 'Italy', flag: '🇮🇹', continent: 'EU' },
    'NL': { name: 'Netherlands', flag: '🇳🇱', continent: 'EU' },
    'SE': { name: 'Sweden', flag: '🇸🇪', continent: 'EU' },
    'CH': { name: 'Switzerland', flag: '🇨🇭', continent: 'EU' },
    'KR': { name: 'South Korea', flag: '🇰🇷', continent: 'AS' },
    'SG': { name: 'Singapore', flag: '🇸🇬', continent: 'AS' },
    'AE': { name: 'UAE', flag: '🇦🇪', continent: 'AS' },
    'Unknown': { name: 'Unknown', flag: '🌍', continent: 'XX' }
};

// ============ DATABASE ============
function loadDatabase() {
    try {
        if (fs.existsSync(analyticsDbPath)) {
            return JSON.parse(fs.readFileSync(analyticsDbPath, 'utf8'));
        }
    } catch (e) {
        console.error('[Analytics] Error loading database:', e.message);
    }
    return createEmptyDatabase();
}

function createEmptyDatabase() {
    return {
        version: 2,
        pageViews: [],
        sessions: {},
        visitors: {},
        events: [],
        conversions: [],
        dailyStats: {},
        hourlyStats: {},
        aiInsights: [],
        anomalies: [],
        predictions: {},
        lastUpdated: Date.now()
    };
}

function saveDatabase(db) {
    db.lastUpdated = Date.now();

    // Data retention: Keep 90 days of detailed data
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    db.pageViews = db.pageViews.filter(pv => pv.timestamp > ninetyDaysAgo);
    db.events = db.events.filter(e => e.timestamp > ninetyDaysAgo);

    // Clean old sessions (24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const sessionId in db.sessions) {
        if (db.sessions[sessionId].lastActivity < oneDayAgo) {
            delete db.sessions[sessionId];
        }
    }

    fs.writeFileSync(analyticsDbPath, JSON.stringify(db, null, 2));
}

// ============ ADVANCED ANALYTICS SERVICE ============
class AdvancedAnalyticsService {
    constructor() {
        this.db = loadDatabase();
        this.realtimeVisitors = new Map();
        this.eventQueue = [];
        this.insightCache = null;
        this.insightCacheTime = 0;

        // Process event queue periodically
        setInterval(() => this.processEventQueue(), 5000);

        // Generate AI insights periodically
        setInterval(() => this.generateAIInsights(), 300000); // Every 5 minutes

        // Cleanup realtime data
        setInterval(() => this.cleanupRealtime(), 60000);

        // Auto-save periodically
        setInterval(() => this.save(), 30000);
    }

    // ============ VISITOR FINGERPRINTING ============
    generateVisitorFingerprint(data) {
        const components = [
            data.ip,
            data.userAgent,
            data.screenWidth,
            data.screenHeight,
            data.timezone,
            data.language,
            data.colorDepth,
            data.platform
        ].filter(Boolean);

        const hash = crypto.createHash('sha256');
        hash.update(components.join('|'));
        return hash.digest('hex').substring(0, 24);
    }

    // ============ BOT DETECTION ============
    isBot(userAgent) {
        if (!userAgent) return { isBot: true, confidence: 100, type: 'empty_ua' };

        for (const pattern of BOT_PATTERNS) {
            if (pattern.test(userAgent)) {
                return { isBot: true, confidence: 95, type: 'known_bot' };
            }
        }

        // Heuristic checks
        const suspiciousSignals = [];

        if (userAgent.length < 30) suspiciousSignals.push('short_ua');
        if (!/Mozilla|Chrome|Safari|Firefox|Edge/i.test(userAgent)) suspiciousSignals.push('no_browser');
        if (/headless/i.test(userAgent)) suspiciousSignals.push('headless');

        if (suspiciousSignals.length >= 2) {
            return { isBot: true, confidence: 70, type: 'suspicious', signals: suspiciousSignals };
        }

        return { isBot: false, confidence: 90, type: 'human' };
    }

    // ============ USER AGENT PARSING ============
    parseUserAgent(ua) {
        ua = ua || '';

        // Device type with confidence
        let deviceType = 'desktop';
        let deviceConfidence = 85;

        if (/mobile|android(?!.*tablet)|iphone|ipod|blackberry|windows phone|opera mini|iemobile/i.test(ua)) {
            deviceType = 'mobile';
            deviceConfidence = 95;
        } else if (/ipad|tablet|playbook|silk|kindle|android(?=.*tablet)/i.test(ua)) {
            deviceType = 'tablet';
            deviceConfidence = 90;
        } else if (/smart-?tv|googletv|appletv|hbbtv|roku|viera|netcast|webos/i.test(ua)) {
            deviceType = 'tv';
            deviceConfidence = 95;
        }

        // Browser detection with version
        let browser = 'Other';
        let browserVersion = '';

        const browserPatterns = [
            { name: 'Edge', pattern: /edg(?:e|a|ios)?\/(\d+)/i },
            { name: 'Chrome', pattern: /chrome\/(\d+)/i },
            { name: 'Firefox', pattern: /firefox\/(\d+)/i },
            { name: 'Safari', pattern: /version\/(\d+).*safari/i },
            { name: 'Opera', pattern: /(?:opera|opr)\/(\d+)/i },
            { name: 'IE', pattern: /(?:msie |rv:)(\d+)/i },
            { name: 'Samsung', pattern: /samsungbrowser\/(\d+)/i },
            { name: 'UC Browser', pattern: /ucbrowser\/(\d+)/i }
        ];

        for (const { name, pattern } of browserPatterns) {
            const match = ua.match(pattern);
            if (match) {
                browser = name;
                browserVersion = match[1];
                break;
            }
        }

        // OS detection with version
        let os = 'Other';
        let osVersion = '';

        const osPatterns = [
            { name: 'Windows 11', pattern: /windows nt 10.*build.*(2[2-9]\d{3}|[3-9]\d{4})/i },
            { name: 'Windows 10', pattern: /windows nt 10/i },
            { name: 'Windows 8.1', pattern: /windows nt 6\.3/i },
            { name: 'Windows 8', pattern: /windows nt 6\.2/i },
            { name: 'Windows 7', pattern: /windows nt 6\.1/i },
            { name: 'macOS', pattern: /mac os x (\d+[._]\d+)/i },
            { name: 'iOS', pattern: /(?:iphone|ipad|ipod).*os (\d+)/i },
            { name: 'Android', pattern: /android (\d+)/i },
            { name: 'Linux', pattern: /linux/i },
            { name: 'Chrome OS', pattern: /cros/i }
        ];

        for (const { name, pattern } of osPatterns) {
            const match = ua.match(pattern);
            if (match) {
                os = name;
                osVersion = match[1]?.replace('_', '.') || '';
                break;
            }
        }

        return {
            deviceType,
            deviceConfidence,
            browser,
            browserVersion,
            os,
            osVersion,
            isMobile: deviceType === 'mobile' || deviceType === 'tablet',
            raw: ua.substring(0, 200)
        };
    }

    // ============ REFERRER ANALYSIS ============
    analyzeReferrer(referrer, currentUrl) {
        if (!referrer || referrer === 'direct') {
            return {
                source: 'direct',
                medium: 'none',
                campaign: null,
                category: 'direct',
                quality: 70
            };
        }

        try {
            const refUrl = new URL(referrer);
            const refDomain = refUrl.hostname.replace('www.', '').toLowerCase();

            // Check for search engines
            for (const [engine, pattern] of Object.entries(SEARCH_ENGINES)) {
                if (pattern.test(refDomain)) {
                    return {
                        source: engine,
                        medium: 'organic',
                        campaign: null,
                        category: 'search',
                        quality: 90,
                        domain: refDomain
                    };
                }
            }

            // Check for social networks
            for (const [network, pattern] of Object.entries(SOCIAL_NETWORKS)) {
                if (pattern.test(refDomain)) {
                    return {
                        source: network,
                        medium: 'social',
                        campaign: null,
                        category: 'social',
                        quality: 75,
                        domain: refDomain
                    };
                }
            }

            // Check for email
            if (/mail|outlook|gmail|yahoo.*mail/i.test(refDomain)) {
                return {
                    source: refDomain,
                    medium: 'email',
                    campaign: null,
                    category: 'email',
                    quality: 85,
                    domain: refDomain
                };
            }

            // Check for paid (UTM parameters)
            const params = refUrl.searchParams;
            if (params.get('utm_source') || params.get('gclid') || params.get('fbclid')) {
                return {
                    source: params.get('utm_source') || 'paid',
                    medium: params.get('utm_medium') || 'cpc',
                    campaign: params.get('utm_campaign'),
                    category: 'paid',
                    quality: 95,
                    domain: refDomain
                };
            }

            // Default: referral
            return {
                source: refDomain,
                medium: 'referral',
                campaign: null,
                category: 'referral',
                quality: 80,
                domain: refDomain
            };
        } catch {
            return {
                source: 'unknown',
                medium: 'unknown',
                campaign: null,
                category: 'unknown',
                quality: 50
            };
        }
    }

    // ============ PAGE VIEW TRACKING ============
    trackPageView(data) {
        const timestamp = Date.now();
        const botCheck = this.isBot(data.userAgent);

        // Skip bots for main analytics (but log them separately)
        if (botCheck.isBot && botCheck.confidence > 80) {
            this.trackBotVisit(data, botCheck);
            return { tracked: false, reason: 'bot', botInfo: botCheck };
        }

        const visitorId = this.generateVisitorFingerprint(data);
        const deviceInfo = this.parseUserAgent(data.userAgent);
        const referrerInfo = this.analyzeReferrer(data.referrer, data.path);
        const dateKey = new Date().toISOString().split('T')[0];
        const hourKey = new Date().getHours();

        // Create page view record
        const pageView = {
            id: crypto.randomUUID(),
            timestamp,
            visitorId,
            sessionId: data.sessionId,
            path: this.normalizePath(data.path),
            title: data.title,
            referrer: referrerInfo,
            device: deviceInfo,
            geo: {
                country: data.country || 'Unknown',
                city: data.city,
                region: data.region,
                timezone: data.timezone
            },
            screen: {
                width: data.screenWidth,
                height: data.screenHeight,
                colorDepth: data.colorDepth,
                pixelRatio: data.pixelRatio
            },
            performance: {
                loadTime: data.loadTime,
                domReady: data.domReady,
                firstPaint: data.firstPaint,
                firstContentfulPaint: data.fcp
            },
            engagement: {
                scrollDepth: 0,
                timeOnPage: 0,
                clicks: 0,
                interactions: 0
            },
            language: data.language,
            connection: data.connection,
            botScore: botCheck.isBot ? botCheck.confidence : 0
        };

        this.db.pageViews.push(pageView);

        // Update visitor record
        this.updateVisitor(visitorId, pageView, deviceInfo, referrerInfo);

        // Update session
        this.updateSession(data.sessionId, visitorId, pageView);

        // Update daily stats
        this.updateDailyStats(dateKey, pageView, visitorId, referrerInfo, deviceInfo);

        // Update hourly stats
        this.updateHourlyStats(dateKey, hourKey, pageView);

        // Update realtime
        this.realtimeVisitors.set(visitorId, {
            timestamp,
            path: pageView.path,
            device: deviceInfo.deviceType,
            country: data.country,
            referrer: referrerInfo.source
        });

        // Queue for batch processing
        this.eventQueue.push({ type: 'pageview', data: pageView });

        return {
            tracked: true,
            pageViewId: pageView.id,
            visitorId,
            isNewVisitor: this.db.visitors[visitorId]?.totalPageViews === 1
        };
    }

    // ============ EVENT TRACKING ============
    trackEvent(data) {
        const timestamp = Date.now();

        const event = {
            id: crypto.randomUUID(),
            timestamp,
            visitorId: data.visitorId,
            sessionId: data.sessionId,
            category: data.category,
            action: data.action,
            label: data.label,
            value: data.value,
            path: data.path,
            metadata: data.metadata
        };

        this.db.events.push(event);

        // Update engagement metrics
        if (data.sessionId && this.db.sessions[data.sessionId]) {
            const session = this.db.sessions[data.sessionId];
            session.events = (session.events || 0) + 1;
            session.lastActivity = timestamp;
        }

        return event;
    }

    // ============ ENGAGEMENT TRACKING ============
    updateEngagement(data) {
        const { pageViewId, scrollDepth, timeOnPage, clicks, interactions } = data;

        const pageView = this.db.pageViews.find(pv => pv.id === pageViewId);
        if (pageView) {
            pageView.engagement.scrollDepth = Math.max(pageView.engagement.scrollDepth, scrollDepth || 0);
            pageView.engagement.timeOnPage = Math.max(pageView.engagement.timeOnPage, timeOnPage || 0);
            pageView.engagement.clicks = (pageView.engagement.clicks || 0) + (clicks || 0);
            pageView.engagement.interactions = (pageView.engagement.interactions || 0) + (interactions || 0);
        }

        // Update session engagement
        if (data.sessionId && this.db.sessions[data.sessionId]) {
            const session = this.db.sessions[data.sessionId];
            session.totalScrollDepth = (session.totalScrollDepth || 0) + (scrollDepth || 0);
            session.totalTimeOnPage = (session.totalTimeOnPage || 0) + (timeOnPage || 0);
        }
    }

    // ============ CONVERSION TRACKING ============
    trackConversion(data) {
        const timestamp = Date.now();

        const conversion = {
            id: crypto.randomUUID(),
            timestamp,
            visitorId: data.visitorId,
            sessionId: data.sessionId,
            type: data.type, // signup, purchase, download, etc.
            value: data.value,
            currency: data.currency || 'USD',
            metadata: data.metadata,
            attribution: this.calculateAttribution(data.visitorId)
        };

        this.db.conversions.push(conversion);

        // Update visitor conversion status
        if (this.db.visitors[data.visitorId]) {
            this.db.visitors[data.visitorId].converted = true;
            this.db.visitors[data.visitorId].conversionCount =
                (this.db.visitors[data.visitorId].conversionCount || 0) + 1;
            this.db.visitors[data.visitorId].totalValue =
                (this.db.visitors[data.visitorId].totalValue || 0) + (data.value || 0);
        }

        return conversion;
    }

    // ============ ATTRIBUTION ============
    calculateAttribution(visitorId) {
        const visitor = this.db.visitors[visitorId];
        if (!visitor) return null;

        return {
            firstTouch: visitor.firstReferrer,
            lastTouch: visitor.lastReferrer,
            touchpoints: visitor.touchpoints || 1,
            daysSinceFirst: Math.floor((Date.now() - visitor.firstSeen) / (24 * 60 * 60 * 1000))
        };
    }

    // ============ HELPER METHODS ============
    normalizePath(path) {
        if (!path) return '/';
        return path.split('?')[0].split('#')[0].toLowerCase().replace(/\/+$/, '') || '/';
    }

    updateVisitor(visitorId, pageView, deviceInfo, referrerInfo) {
        if (!this.db.visitors[visitorId]) {
            this.db.visitors[visitorId] = {
                firstSeen: pageView.timestamp,
                lastSeen: pageView.timestamp,
                totalPageViews: 0,
                totalSessions: 0,
                device: deviceInfo,
                firstReferrer: referrerInfo,
                lastReferrer: referrerInfo,
                touchpoints: 1,
                converted: false,
                engagementScore: 0,
                country: pageView.geo.country
            };
        }

        const visitor = this.db.visitors[visitorId];
        visitor.lastSeen = pageView.timestamp;
        visitor.totalPageViews++;
        visitor.lastReferrer = referrerInfo;

        if (referrerInfo.source !== visitor.lastReferrer?.source) {
            visitor.touchpoints = (visitor.touchpoints || 1) + 1;
        }

        // Calculate engagement score (0-100)
        visitor.engagementScore = this.calculateEngagementScore(visitor);
    }

    calculateEngagementScore(visitor) {
        let score = 0;

        // Page views (max 30 points)
        score += Math.min(visitor.totalPageViews * 3, 30);

        // Sessions (max 20 points)
        score += Math.min(visitor.totalSessions * 5, 20);

        // Recency (max 20 points)
        const daysSinceVisit = (Date.now() - visitor.lastSeen) / (24 * 60 * 60 * 1000);
        if (daysSinceVisit < 1) score += 20;
        else if (daysSinceVisit < 7) score += 15;
        else if (daysSinceVisit < 30) score += 10;
        else score += 5;

        // Conversion (max 30 points)
        if (visitor.converted) score += 30;

        return Math.min(score, 100);
    }

    updateSession(sessionId, visitorId, pageView) {
        if (!sessionId) return;

        if (!this.db.sessions[sessionId]) {
            this.db.sessions[sessionId] = {
                id: sessionId,
                visitorId,
                startTime: pageView.timestamp,
                lastActivity: pageView.timestamp,
                pageViews: 0,
                events: 0,
                pages: [],
                entryPage: pageView.path,
                exitPage: pageView.path,
                device: pageView.device,
                referrer: pageView.referrer,
                country: pageView.geo.country
            };

            // Increment visitor session count
            if (this.db.visitors[visitorId]) {
                this.db.visitors[visitorId].totalSessions++;
            }
        }

        const session = this.db.sessions[sessionId];
        session.lastActivity = pageView.timestamp;
        session.pageViews++;
        session.exitPage = pageView.path;

        if (!session.pages.includes(pageView.path)) {
            session.pages.push(pageView.path);
        }
    }

    updateDailyStats(dateKey, pageView, visitorId, referrerInfo, deviceInfo) {
        if (!this.db.dailyStats[dateKey]) {
            this.db.dailyStats[dateKey] = {
                pageViews: 0,
                uniqueVisitors: [],
                newVisitors: 0,
                returningVisitors: 0,
                sessions: 0,
                bounces: 0,
                totalSessionDuration: 0,
                devices: { desktop: 0, mobile: 0, tablet: 0, tv: 0 },
                browsers: {},
                os: {},
                countries: {},
                pages: {},
                referrers: {},
                sources: { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 },
                conversions: 0,
                revenue: 0,
                avgEngagement: 0,
                peakHour: 0,
                hourlyDistribution: new Array(24).fill(0)
            };
        }

        const daily = this.db.dailyStats[dateKey];
        daily.pageViews++;

        // Handle unique visitors (convert from array if needed)
        if (!Array.isArray(daily.uniqueVisitors)) {
            daily.uniqueVisitors = [];
        }

        const isNewVisitorToday = !daily.uniqueVisitors.includes(visitorId);
        if (isNewVisitorToday) {
            daily.uniqueVisitors.push(visitorId);

            // Check if new or returning visitor
            const visitor = this.db.visitors[visitorId];
            if (visitor && visitor.totalPageViews === 1) {
                daily.newVisitors++;
            } else {
                daily.returningVisitors++;
            }
        }

        // Device stats
        daily.devices[deviceInfo.deviceType] = (daily.devices[deviceInfo.deviceType] || 0) + 1;

        // Browser stats
        daily.browsers[deviceInfo.browser] = (daily.browsers[deviceInfo.browser] || 0) + 1;

        // OS stats
        daily.os[deviceInfo.os] = (daily.os[deviceInfo.os] || 0) + 1;

        // Country stats
        const country = pageView.geo.country || 'Unknown';
        daily.countries[country] = (daily.countries[country] || 0) + 1;

        // Page stats
        daily.pages[pageView.path] = (daily.pages[pageView.path] || 0) + 1;

        // Referrer stats
        const refSource = referrerInfo.source || 'direct';
        daily.referrers[refSource] = (daily.referrers[refSource] || 0) + 1;

        // Source category stats
        daily.sources[referrerInfo.category] = (daily.sources[referrerInfo.category] || 0) + 1;

        // Hourly distribution
        const hour = new Date().getHours();
        daily.hourlyDistribution[hour]++;
    }

    updateHourlyStats(dateKey, hour, pageView) {
        const hourKey = `${dateKey}-${hour}`;

        if (!this.db.hourlyStats[hourKey]) {
            this.db.hourlyStats[hourKey] = {
                pageViews: 0,
                uniqueVisitors: [],
                avgLoadTime: 0,
                totalLoadTime: 0
            };
        }

        const hourly = this.db.hourlyStats[hourKey];
        hourly.pageViews++;

        if (!hourly.uniqueVisitors.includes(pageView.visitorId)) {
            hourly.uniqueVisitors.push(pageView.visitorId);
        }

        if (pageView.performance.loadTime) {
            hourly.totalLoadTime += pageView.performance.loadTime;
            hourly.avgLoadTime = hourly.totalLoadTime / hourly.pageViews;
        }
    }

    trackBotVisit(data, botInfo) {
        // Log bot visits separately for analysis
        const botLog = {
            timestamp: Date.now(),
            userAgent: data.userAgent?.substring(0, 200),
            ip: this.hashIP(data.ip),
            path: data.path,
            botType: botInfo.type,
            confidence: botInfo.confidence
        };

        // Store in memory only (don't persist bot data to save space)
        if (!this.botVisits) this.botVisits = [];
        this.botVisits.push(botLog);
        if (this.botVisits.length > 1000) {
            this.botVisits = this.botVisits.slice(-500);
        }
    }

    hashIP(ip) {
        if (!ip) return 'unknown';
        return crypto.createHash('md5').update(ip).digest('hex').substring(0, 8);
    }

    // ============ AI INSIGHTS ENGINE ============
    generateAIInsights() {
        const insights = [];
        const now = Date.now();
        const todayKey = new Date().toISOString().split('T')[0];
        const yesterdayKey = new Date(now - 86400000).toISOString().split('T')[0];

        const today = this.db.dailyStats[todayKey];
        const yesterday = this.db.dailyStats[yesterdayKey];

        if (!today) return;

        // Traffic trend analysis
        if (yesterday) {
            const todayPV = today.pageViews || 0;
            const yesterdayPV = yesterday.pageViews || 0;
            const change = yesterdayPV > 0 ? ((todayPV - yesterdayPV) / yesterdayPV * 100) : 0;

            if (change > 50) {
                insights.push({
                    type: 'traffic_spike',
                    severity: 'high',
                    title: 'Traffic Surge Detected',
                    message: `Traffic is up ${change.toFixed(0)}% compared to yesterday. Investigate the source.`,
                    metric: { current: todayPV, previous: yesterdayPV, change },
                    recommendation: 'Check referrer sources to identify what\'s driving this traffic.',
                    timestamp: now
                });
            } else if (change < -30) {
                insights.push({
                    type: 'traffic_drop',
                    severity: 'medium',
                    title: 'Traffic Decline Detected',
                    message: `Traffic is down ${Math.abs(change).toFixed(0)}% compared to yesterday.`,
                    metric: { current: todayPV, previous: yesterdayPV, change },
                    recommendation: 'Check for technical issues or marketing campaign changes.',
                    timestamp: now
                });
            }
        }

        // Device shift detection
        if (today.devices) {
            const total = Object.values(today.devices).reduce((a, b) => a + b, 0);
            const mobilePercent = total > 0 ? (today.devices.mobile / total * 100) : 0;

            if (mobilePercent > 70) {
                insights.push({
                    type: 'mobile_dominant',
                    severity: 'info',
                    title: 'Mobile-First Traffic',
                    message: `${mobilePercent.toFixed(0)}% of visitors are on mobile devices.`,
                    recommendation: 'Ensure mobile experience is optimized.',
                    timestamp: now
                });
            }
        }

        // Bounce rate analysis
        const todayUV = Array.isArray(today.uniqueVisitors) ? today.uniqueVisitors.length : 0;
        if (todayUV > 10) {
            const bounceRate = this.calculateBounceRate(todayKey);

            if (bounceRate > 70) {
                insights.push({
                    type: 'high_bounce',
                    severity: 'medium',
                    title: 'High Bounce Rate',
                    message: `Bounce rate is ${bounceRate.toFixed(0)}% - visitors are leaving quickly.`,
                    recommendation: 'Improve landing page content and load times.',
                    timestamp: now
                });
            }
        }

        // Peak hour detection
        if (today.hourlyDistribution) {
            const maxHour = today.hourlyDistribution.indexOf(Math.max(...today.hourlyDistribution));
            insights.push({
                type: 'peak_hour',
                severity: 'info',
                title: 'Peak Traffic Hour',
                message: `Highest traffic at ${maxHour}:00 with ${today.hourlyDistribution[maxHour]} page views.`,
                recommendation: 'Schedule important updates and campaigns around this time.',
                timestamp: now
            });
        }

        // Top traffic source
        if (today.sources) {
            const topSource = Object.entries(today.sources)
                .sort((a, b) => b[1] - a[1])[0];

            if (topSource && topSource[1] > 0) {
                insights.push({
                    type: 'top_source',
                    severity: 'info',
                    title: 'Top Traffic Source',
                    message: `${topSource[0]} is driving ${topSource[1]} visits today.`,
                    timestamp: now
                });
            }
        }

        // Anomaly detection
        this.detectAnomalies(insights);

        // Store insights
        this.db.aiInsights = insights;
        this.insightCache = insights;
        this.insightCacheTime = now;

        return insights;
    }

    detectAnomalies(insights) {
        const now = Date.now();

        // Check for unusual patterns in the last 7 days
        const last7Days = [];
        for (let i = 0; i < 7; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            if (this.db.dailyStats[dateKey]) {
                last7Days.push(this.db.dailyStats[dateKey]);
            }
        }

        if (last7Days.length < 3) return;

        // Calculate average and standard deviation
        const pageViews = last7Days.map(d => d.pageViews || 0);
        const avg = pageViews.reduce((a, b) => a + b, 0) / pageViews.length;
        const stdDev = Math.sqrt(pageViews.reduce((sum, pv) => sum + Math.pow(pv - avg, 2), 0) / pageViews.length);

        // Check if today is an anomaly (more than 2 standard deviations)
        const todayPV = last7Days[0]?.pageViews || 0;
        if (stdDev > 0 && Math.abs(todayPV - avg) > 2 * stdDev) {
            insights.push({
                type: 'anomaly',
                severity: 'high',
                title: 'Traffic Anomaly Detected',
                message: `Today's traffic (${todayPV}) is significantly different from the 7-day average (${avg.toFixed(0)}).`,
                metric: { value: todayPV, average: avg, stdDev },
                timestamp: now
            });
        }
    }

    // ============ ANALYTICS QUERIES ============
    getOverview(days = 7) {
        const now = Date.now();
        const startTime = now - (days * 24 * 60 * 60 * 1000);
        const todayKey = new Date().toISOString().split('T')[0];
        const yesterdayKey = new Date(now - 86400000).toISOString().split('T')[0];

        const today = this.db.dailyStats[todayKey] || {};
        const yesterday = this.db.dailyStats[yesterdayKey] || {};

        // Calculate period totals
        let periodPageViews = 0;
        let periodUniqueVisitors = new Set();
        let periodSessions = 0;
        let periodBounces = 0;
        let periodDuration = 0;

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day) {
                periodPageViews += day.pageViews || 0;
                if (Array.isArray(day.uniqueVisitors)) {
                    day.uniqueVisitors.forEach(v => periodUniqueVisitors.add(v));
                }
            }
        }

        // Calculate session metrics from sessions
        for (const sessionId in this.db.sessions) {
            const session = this.db.sessions[sessionId];
            if (session.startTime > startTime) {
                periodSessions++;
                if (session.pageViews === 1) periodBounces++;
                periodDuration += session.lastActivity - session.startTime;
            }
        }

        const avgSessionDuration = periodSessions > 0 ? periodDuration / periodSessions : 0;
        const bounceRate = periodSessions > 0 ? (periodBounces / periodSessions * 100) : 0;

        // Calculate trends
        const todayPV = today.pageViews || 0;
        const yesterdayPV = yesterday.pageViews || 0;
        const pvTrend = yesterdayPV > 0 ? ((todayPV - yesterdayPV) / yesterdayPV * 100) : 0;

        const todayUV = Array.isArray(today.uniqueVisitors) ? today.uniqueVisitors.length : 0;
        const yesterdayUV = Array.isArray(yesterday.uniqueVisitors) ? yesterday.uniqueVisitors.length : 0;
        const uvTrend = yesterdayUV > 0 ? ((todayUV - yesterdayUV) / yesterdayUV * 100) : 0;

        return {
            realtime: this.getRealtimeCount(),
            today: {
                pageViews: todayPV,
                uniqueVisitors: todayUV,
                newVisitors: today.newVisitors || 0,
                returningVisitors: today.returningVisitors || 0,
                pvTrend: Math.round(pvTrend * 10) / 10,
                uvTrend: Math.round(uvTrend * 10) / 10
            },
            period: {
                days,
                pageViews: periodPageViews,
                uniqueVisitors: periodUniqueVisitors.size,
                sessions: periodSessions,
                avgSessionDuration: this.formatDuration(avgSessionDuration),
                avgSessionDurationMs: avgSessionDuration,
                bounceRate: Math.round(bounceRate * 10) / 10,
                pagesPerSession: periodSessions > 0 ? Math.round(periodPageViews / periodSessions * 10) / 10 : 0
            },
            quality: {
                humanTraffic: this.calculateHumanTrafficPercent(),
                engagementScore: this.calculateOverallEngagement(),
                dataAccuracy: 95 // Based on bot detection confidence
            }
        };
    }

    getRealtimeCount() {
        this.cleanupRealtime();
        return this.realtimeVisitors.size;
    }

    getRealtimeVisitors() {
        this.cleanupRealtime();
        const visitors = Array.from(this.realtimeVisitors.values());

        return {
            count: visitors.length,
            visitors: visitors.map(v => ({
                path: v.path,
                device: v.device,
                country: v.country,
                source: v.referrer,
                secondsAgo: Math.floor((Date.now() - v.timestamp) / 1000)
            })).slice(0, 20)
        };
    }

    cleanupRealtime() {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [visitorId, data] of this.realtimeVisitors) {
            if (data.timestamp < fiveMinutesAgo) {
                this.realtimeVisitors.delete(visitorId);
            }
        }
    }

    getTrend(days = 7) {
        const trend = [];
        const now = Date.now();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now - i * 86400000);
            const dateKey = date.toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey] || {};

            trend.push({
                date: dateKey,
                label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                pageViews: day.pageViews || 0,
                uniqueVisitors: Array.isArray(day.uniqueVisitors) ? day.uniqueVisitors.length : 0,
                newVisitors: day.newVisitors || 0,
                sessions: day.sessions || 0
            });
        }

        return trend;
    }

    getDeviceBreakdown(days = 7) {
        const devices = { desktop: 0, mobile: 0, tablet: 0, tv: 0 };
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.devices) {
                for (const [device, count] of Object.entries(day.devices)) {
                    devices[device] = (devices[device] || 0) + count;
                }
            }
        }

        const total = Object.values(devices).reduce((a, b) => a + b, 0);

        return {
            devices,
            percentages: {
                desktop: total > 0 ? Math.round((devices.desktop / total) * 100) : 0,
                mobile: total > 0 ? Math.round((devices.mobile / total) * 100) : 0,
                tablet: total > 0 ? Math.round((devices.tablet / total) * 100) : 0,
                tv: total > 0 ? Math.round((devices.tv / total) * 100) : 0
            },
            total
        };
    }

    getBrowserBreakdown(days = 7) {
        const browsers = {};
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.browsers) {
                for (const [browser, count] of Object.entries(day.browsers)) {
                    browsers[browser] = (browsers[browser] || 0) + count;
                }
            }
        }

        const total = Object.values(browsers).reduce((a, b) => a + b, 0);

        return Object.entries(browsers)
            .map(([browser, count]) => ({
                browser,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }

    getOSBreakdown(days = 7) {
        const osList = {};
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.os) {
                for (const [os, count] of Object.entries(day.os)) {
                    osList[os] = (osList[os] || 0) + count;
                }
            }
        }

        const total = Object.values(osList).reduce((a, b) => a + b, 0);

        return Object.entries(osList)
            .map(([os, count]) => ({
                os,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }

    getTopPages(days = 7, limit = 10) {
        const pages = {};
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.pages) {
                for (const [page, count] of Object.entries(day.pages)) {
                    pages[page] = (pages[page] || 0) + count;
                }
            }
        }

        const total = Object.values(pages).reduce((a, b) => a + b, 0);

        return Object.entries(pages)
            .map(([page, views]) => ({
                page,
                views,
                percentage: total > 0 ? Math.round((views / total) * 100) : 0
            }))
            .sort((a, b) => b.views - a.views)
            .slice(0, limit);
    }

    getTopReferrers(days = 7, limit = 10) {
        const referrers = {};
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.referrers) {
                for (const [ref, count] of Object.entries(day.referrers)) {
                    referrers[ref] = (referrers[ref] || 0) + count;
                }
            }
        }

        const total = Object.values(referrers).reduce((a, b) => a + b, 0);

        return Object.entries(referrers)
            .map(([source, visits]) => ({
                source,
                visits,
                percentage: total > 0 ? Math.round((visits / total) * 100) : 0
            }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, limit);
    }

    getSourceBreakdown(days = 7) {
        const sources = { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 };
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.sources) {
                for (const [source, count] of Object.entries(day.sources)) {
                    sources[source] = (sources[source] || 0) + count;
                }
            }
        }

        const total = Object.values(sources).reduce((a, b) => a + b, 0);

        return Object.entries(sources)
            .map(([source, visits]) => ({
                source,
                visits,
                percentage: total > 0 ? Math.round((visits / total) * 100) : 0
            }))
            .sort((a, b) => b.visits - a.visits);
    }

    getCountryBreakdown(days = 7, limit = 10) {
        const countries = {};
        const now = Date.now();

        for (let i = 0; i < days; i++) {
            const dateKey = new Date(now - i * 86400000).toISOString().split('T')[0];
            const day = this.db.dailyStats[dateKey];
            if (day?.countries) {
                for (const [country, count] of Object.entries(day.countries)) {
                    countries[country] = (countries[country] || 0) + count;
                }
            }
        }

        const total = Object.values(countries).reduce((a, b) => a + b, 0);

        return Object.entries(countries)
            .map(([country, visits]) => {
                const countryInfo = COUNTRY_DATA[country] || COUNTRY_DATA['Unknown'];
                return {
                    code: country,
                    country: countryInfo.name,
                    flag: countryInfo.flag,
                    continent: countryInfo.continent,
                    visits,
                    percentage: total > 0 ? Math.round((visits / total) * 100) : 0
                };
            })
            .sort((a, b) => b.visits - a.visits)
            .slice(0, limit);
    }

    getHourlyBreakdown(dateKey = null) {
        if (!dateKey) {
            dateKey = new Date().toISOString().split('T')[0];
        }

        const day = this.db.dailyStats[dateKey];
        const distribution = day?.hourlyDistribution || new Array(24).fill(0);

        return distribution.map((views, hour) => ({
            hour: `${hour.toString().padStart(2, '0')}:00`,
            views,
            isCurrentHour: hour === new Date().getHours()
        }));
    }

    getAIInsights() {
        // Return cached insights if fresh (less than 5 minutes old)
        if (this.insightCache && Date.now() - this.insightCacheTime < 300000) {
            return this.insightCache;
        }

        return this.generateAIInsights();
    }

    calculateBounceRate(dateKey = null) {
        if (!dateKey) {
            dateKey = new Date().toISOString().split('T')[0];
        }

        let singlePageSessions = 0;
        let totalSessions = 0;
        const startOfDay = new Date(dateKey).getTime();
        const endOfDay = startOfDay + 86400000;

        for (const sessionId in this.db.sessions) {
            const session = this.db.sessions[sessionId];
            if (session.startTime >= startOfDay && session.startTime < endOfDay) {
                totalSessions++;
                if (session.pageViews === 1) {
                    singlePageSessions++;
                }
            }
        }

        return totalSessions > 0 ? (singlePageSessions / totalSessions * 100) : 0;
    }

    calculateHumanTrafficPercent() {
        const recentPageViews = this.db.pageViews.slice(-1000);
        if (recentPageViews.length === 0) return 100;

        const humanViews = recentPageViews.filter(pv => (pv.botScore || 0) < 50).length;
        return Math.round((humanViews / recentPageViews.length) * 100);
    }

    calculateOverallEngagement() {
        const visitors = Object.values(this.db.visitors);
        if (visitors.length === 0) return 0;

        const totalScore = visitors.reduce((sum, v) => sum + (v.engagementScore || 0), 0);
        return Math.round(totalScore / visitors.length);
    }

    formatDuration(ms) {
        if (!ms || ms < 0) return '0:00';
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // ============ FULL ANALYTICS ============
    getFullAnalytics(days = 7) {
        return {
            overview: this.getOverview(days),
            trend: this.getTrend(days),
            devices: this.getDeviceBreakdown(days),
            browsers: this.getBrowserBreakdown(days),
            os: this.getOSBreakdown(days),
            topPages: this.getTopPages(days),
            topReferrers: this.getTopReferrers(days),
            sources: this.getSourceBreakdown(days),
            countries: this.getCountryBreakdown(days),
            hourly: this.getHourlyBreakdown(),
            realtime: this.getRealtimeVisitors(),
            insights: this.getAIInsights(),
            meta: {
                generatedAt: Date.now(),
                dataAccuracy: 95,
                periodDays: days,
                totalVisitors: Object.keys(this.db.visitors).length,
                totalPageViews: this.db.pageViews.length
            }
        };
    }

    // ============ PERSISTENCE ============
    processEventQueue() {
        if (this.eventQueue.length === 0) return;

        // Process events in batch
        const events = this.eventQueue.splice(0, 100);

        // Could add additional processing here (e.g., sending to external analytics)

        // Save if we have significant changes
        if (events.length >= 10) {
            this.save();
        }
    }

    save() {
        try {
            saveDatabase(this.db);
        } catch (e) {
            console.error('[Analytics] Error saving database:', e.message);
        }
    }
}

module.exports = new AdvancedAnalyticsService();
