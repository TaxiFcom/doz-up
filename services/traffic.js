/**
 * DOZ UP - Traffic Analytics Service
 * Real-time visitor tracking, page views, device analytics
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const trafficDbPath = path.join(dataDir, 'traffic.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadTrafficDb() {
    try {
        if (fs.existsSync(trafficDbPath)) {
            return JSON.parse(fs.readFileSync(trafficDbPath, 'utf8'));
        }
    } catch (e) {
        console.error('[Traffic] Error loading database:', e.message);
    }
    return {
        pageViews: [],
        visitors: {},
        sessions: {},
        realtime: [],
        dailyStats: {}
    };
}

function saveTrafficDb(db) {
    // Keep only last 30 days of detailed data
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    db.pageViews = db.pageViews.filter(pv => pv.timestamp > thirtyDaysAgo);
    db.realtime = db.realtime.filter(r => r.timestamp > Date.now() - (5 * 60 * 1000));

    // Clean up old sessions (older than 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const sessionId in db.sessions) {
        if (db.sessions[sessionId].lastSeen < oneDayAgo) {
            delete db.sessions[sessionId];
        }
    }

    fs.writeFileSync(trafficDbPath, JSON.stringify(db, null, 2));
}

class TrafficService {
    constructor() {
        this.db = loadTrafficDb();
        this.realtimeVisitors = new Map(); // In-memory for real-time tracking

        // Clean up realtime data periodically
        setInterval(() => {
            this.cleanupRealtime();
        }, 60000); // Every minute
    }

    // Generate visitor ID from IP and user agent
    generateVisitorId(ip, userAgent) {
        const hash = crypto.createHash('sha256');
        hash.update(`${ip}-${userAgent}`);
        return hash.digest('hex').substring(0, 16);
    }

    // Parse user agent for device info
    parseUserAgent(ua) {
        ua = ua || '';

        // Device type
        let deviceType = 'desktop';
        if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua)) {
            deviceType = 'mobile';
        } else if (/ipad|tablet|playbook|silk/i.test(ua)) {
            deviceType = 'tablet';
        }

        // Browser
        let browser = 'Other';
        if (/edg/i.test(ua)) browser = 'Edge';
        else if (/chrome/i.test(ua)) browser = 'Chrome';
        else if (/firefox/i.test(ua)) browser = 'Firefox';
        else if (/safari/i.test(ua)) browser = 'Safari';
        else if (/opera|opr/i.test(ua)) browser = 'Opera';
        else if (/msie|trident/i.test(ua)) browser = 'IE';

        // OS
        let os = 'Other';
        if (/windows/i.test(ua)) os = 'Windows';
        else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
        else if (/linux/i.test(ua)) os = 'Linux';
        else if (/android/i.test(ua)) os = 'Android';
        else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';

        return { deviceType, browser, os };
    }

    // Track a page view
    trackPageView(data) {
        const {
            path,
            referrer,
            ip,
            userAgent,
            sessionId,
            country,
            city,
            screenWidth,
            screenHeight,
            language
        } = data;

        const timestamp = Date.now();
        const visitorId = this.generateVisitorId(ip, userAgent);
        const deviceInfo = this.parseUserAgent(userAgent);
        const dateKey = new Date().toISOString().split('T')[0];

        // Page view record
        const pageView = {
            id: crypto.randomUUID(),
            timestamp,
            path: path || '/',
            referrer: referrer || 'direct',
            visitorId,
            sessionId,
            ip: this.hashIP(ip),
            ...deviceInfo,
            country: country || 'Unknown',
            city: city || 'Unknown',
            screenWidth,
            screenHeight,
            language: language || 'en'
        };

        this.db.pageViews.push(pageView);

        // Update visitor record
        if (!this.db.visitors[visitorId]) {
            this.db.visitors[visitorId] = {
                firstSeen: timestamp,
                lastSeen: timestamp,
                totalPageViews: 0,
                sessions: 0,
                ...deviceInfo,
                country: country || 'Unknown'
            };
        }
        this.db.visitors[visitorId].lastSeen = timestamp;
        this.db.visitors[visitorId].totalPageViews++;

        // Update session
        if (sessionId) {
            if (!this.db.sessions[sessionId]) {
                this.db.sessions[sessionId] = {
                    startTime: timestamp,
                    lastSeen: timestamp,
                    pageViews: 0,
                    visitorId,
                    ...deviceInfo
                };
                this.db.visitors[visitorId].sessions++;
            }
            this.db.sessions[sessionId].lastSeen = timestamp;
            this.db.sessions[sessionId].pageViews++;
        }

        // Update daily stats
        if (!this.db.dailyStats[dateKey]) {
            this.db.dailyStats[dateKey] = {
                pageViews: 0,
                uniqueVisitors: new Set(),
                sessions: 0,
                devices: { desktop: 0, mobile: 0, tablet: 0 },
                browsers: {},
                countries: {},
                pages: {},
                referrers: {}
            };
        }

        const daily = this.db.dailyStats[dateKey];
        daily.pageViews++;

        // Handle Set serialization
        if (Array.isArray(daily.uniqueVisitors)) {
            daily.uniqueVisitors = new Set(daily.uniqueVisitors);
        }
        daily.uniqueVisitors.add(visitorId);

        daily.devices[deviceInfo.deviceType] = (daily.devices[deviceInfo.deviceType] || 0) + 1;
        daily.browsers[deviceInfo.browser] = (daily.browsers[deviceInfo.browser] || 0) + 1;
        daily.countries[country || 'Unknown'] = (daily.countries[country || 'Unknown'] || 0) + 1;
        daily.pages[path || '/'] = (daily.pages[path || '/'] || 0) + 1;

        const refDomain = this.extractDomain(referrer);
        daily.referrers[refDomain] = (daily.referrers[refDomain] || 0) + 1;

        // Convert Set back to array for storage
        daily.uniqueVisitors = Array.from(daily.uniqueVisitors);

        // Update realtime
        this.realtimeVisitors.set(visitorId, {
            timestamp,
            path,
            ...deviceInfo,
            country
        });

        // Save periodically (every 10 page views)
        if (this.db.pageViews.length % 10 === 0) {
            saveTrafficDb(this.db);
        }

        return pageView;
    }

    // Hash IP for privacy
    hashIP(ip) {
        if (!ip) return 'unknown';
        return crypto.createHash('md5').update(ip).digest('hex').substring(0, 8);
    }

    // Extract domain from URL
    extractDomain(url) {
        if (!url || url === 'direct') return 'Direct';
        try {
            const parsed = new URL(url);
            return parsed.hostname.replace('www.', '');
        } catch {
            return 'Direct';
        }
    }

    // Clean up old realtime data
    cleanupRealtime() {
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [visitorId, data] of this.realtimeVisitors) {
            if (data.timestamp < fiveMinutesAgo) {
                this.realtimeVisitors.delete(visitorId);
            }
        }
    }

    // Get realtime visitors count
    getRealtimeVisitors() {
        this.cleanupRealtime();
        const visitors = Array.from(this.realtimeVisitors.values());

        return {
            count: visitors.length,
            visitors: visitors.map(v => ({
                path: v.path,
                deviceType: v.deviceType,
                country: v.country,
                secondsAgo: Math.floor((Date.now() - v.timestamp) / 1000)
            }))
        };
    }

    // Get traffic overview
    getOverview(days = 7) {
        const now = Date.now();
        const startTime = now - (days * 24 * 60 * 60 * 1000);

        const recentPageViews = this.db.pageViews.filter(pv => pv.timestamp > startTime);
        const uniqueVisitors = new Set(recentPageViews.map(pv => pv.visitorId));

        // Calculate averages
        const avgSessionDuration = this.calculateAvgSessionDuration(startTime);
        const bounceRate = this.calculateBounceRate(startTime);

        // Today's stats
        const todayKey = new Date().toISOString().split('T')[0];
        const todayStats = this.db.dailyStats[todayKey] || { pageViews: 0, uniqueVisitors: [] };

        // Yesterday's stats for comparison
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = yesterday.toISOString().split('T')[0];
        const yesterdayStats = this.db.dailyStats[yesterdayKey] || { pageViews: 0, uniqueVisitors: [] };

        // Calculate trends
        const todayPV = todayStats.pageViews || 0;
        const yesterdayPV = yesterdayStats.pageViews || 0;
        const pvTrend = yesterdayPV > 0 ? ((todayPV - yesterdayPV) / yesterdayPV * 100).toFixed(1) : 0;

        const todayUV = Array.isArray(todayStats.uniqueVisitors) ? todayStats.uniqueVisitors.length : 0;
        const yesterdayUV = Array.isArray(yesterdayStats.uniqueVisitors) ? yesterdayStats.uniqueVisitors.length : 0;
        const uvTrend = yesterdayUV > 0 ? ((todayUV - yesterdayUV) / yesterdayUV * 100).toFixed(1) : 0;

        return {
            realtime: this.getRealtimeVisitors().count,
            today: {
                pageViews: todayPV,
                uniqueVisitors: todayUV,
                pvTrend: parseFloat(pvTrend),
                uvTrend: parseFloat(uvTrend)
            },
            period: {
                days,
                pageViews: recentPageViews.length,
                uniqueVisitors: uniqueVisitors.size,
                avgSessionDuration,
                bounceRate
            }
        };
    }

    // Calculate average session duration
    calculateAvgSessionDuration(startTime) {
        let totalDuration = 0;
        let sessionCount = 0;

        for (const sessionId in this.db.sessions) {
            const session = this.db.sessions[sessionId];
            if (session.startTime > startTime && session.pageViews > 1) {
                totalDuration += session.lastSeen - session.startTime;
                sessionCount++;
            }
        }

        if (sessionCount === 0) return '0:00';

        const avgMs = totalDuration / sessionCount;
        const minutes = Math.floor(avgMs / 60000);
        const seconds = Math.floor((avgMs % 60000) / 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // Calculate bounce rate
    calculateBounceRate(startTime) {
        let singlePageSessions = 0;
        let totalSessions = 0;

        for (const sessionId in this.db.sessions) {
            const session = this.db.sessions[sessionId];
            if (session.startTime > startTime) {
                totalSessions++;
                if (session.pageViews === 1) {
                    singlePageSessions++;
                }
            }
        }

        if (totalSessions === 0) return 0;
        return Math.round((singlePageSessions / totalSessions) * 100);
    }

    // Get traffic trend data for charts
    getTrend(days = 7) {
        const trend = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            const dayStats = this.db.dailyStats[dateKey] || {
                pageViews: 0,
                uniqueVisitors: []
            };

            trend.push({
                date: dateKey,
                label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                pageViews: dayStats.pageViews || 0,
                uniqueVisitors: Array.isArray(dayStats.uniqueVisitors)
                    ? dayStats.uniqueVisitors.length
                    : 0
            });
        }

        return trend;
    }

    // Get device breakdown
    getDeviceBreakdown(days = 7) {
        const devices = { desktop: 0, mobile: 0, tablet: 0 };
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            const dayStats = this.db.dailyStats[dateKey];
            if (dayStats && dayStats.devices) {
                devices.desktop += dayStats.devices.desktop || 0;
                devices.mobile += dayStats.devices.mobile || 0;
                devices.tablet += dayStats.devices.tablet || 0;
            }
        }

        const total = devices.desktop + devices.mobile + devices.tablet;

        return {
            devices,
            percentages: {
                desktop: total > 0 ? Math.round((devices.desktop / total) * 100) : 0,
                mobile: total > 0 ? Math.round((devices.mobile / total) * 100) : 0,
                tablet: total > 0 ? Math.round((devices.tablet / total) * 100) : 0
            },
            total
        };
    }

    // Get browser breakdown
    getBrowserBreakdown(days = 7) {
        const browsers = {};
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            const dayStats = this.db.dailyStats[dateKey];
            if (dayStats && dayStats.browsers) {
                for (const [browser, count] of Object.entries(dayStats.browsers)) {
                    browsers[browser] = (browsers[browser] || 0) + count;
                }
            }
        }

        const total = Object.values(browsers).reduce((sum, c) => sum + c, 0);

        return Object.entries(browsers)
            .map(([browser, count]) => ({
                browser,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }

    // Get top pages
    getTopPages(days = 7, limit = 10) {
        const pages = {};
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            const dayStats = this.db.dailyStats[dateKey];
            if (dayStats && dayStats.pages) {
                for (const [page, count] of Object.entries(dayStats.pages)) {
                    pages[page] = (pages[page] || 0) + count;
                }
            }
        }

        return Object.entries(pages)
            .map(([page, views]) => ({ page, views }))
            .sort((a, b) => b.views - a.views)
            .slice(0, limit);
    }

    // Get top referrers
    getTopReferrers(days = 7, limit = 10) {
        const referrers = {};
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            const dayStats = this.db.dailyStats[dateKey];
            if (dayStats && dayStats.referrers) {
                for (const [referrer, count] of Object.entries(dayStats.referrers)) {
                    referrers[referrer] = (referrers[referrer] || 0) + count;
                }
            }
        }

        return Object.entries(referrers)
            .map(([source, visits]) => ({ source, visits }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, limit);
    }

    // Get country breakdown
    getCountryBreakdown(days = 7, limit = 10) {
        const countries = {};
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];

            const dayStats = this.db.dailyStats[dateKey];
            if (dayStats && dayStats.countries) {
                for (const [country, count] of Object.entries(dayStats.countries)) {
                    countries[country] = (countries[country] || 0) + count;
                }
            }
        }

        const total = Object.values(countries).reduce((sum, c) => sum + c, 0);

        return Object.entries(countries)
            .map(([country, visits]) => ({
                country,
                visits,
                percentage: total > 0 ? Math.round((visits / total) * 100) : 0
            }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, limit);
    }

    // Get hourly breakdown for today
    getHourlyBreakdown() {
        const hours = new Array(24).fill(0);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        this.db.pageViews
            .filter(pv => pv.timestamp >= todayStart.getTime())
            .forEach(pv => {
                const hour = new Date(pv.timestamp).getHours();
                hours[hour]++;
            });

        return hours.map((count, hour) => ({
            hour: `${hour.toString().padStart(2, '0')}:00`,
            views: count
        }));
    }

    // Save database
    save() {
        saveTrafficDb(this.db);
    }

    // Get full analytics data for dashboard
    getFullAnalytics(days = 7) {
        return {
            overview: this.getOverview(days),
            trend: this.getTrend(days),
            devices: this.getDeviceBreakdown(days),
            browsers: this.getBrowserBreakdown(days),
            topPages: this.getTopPages(days),
            topReferrers: this.getTopReferrers(days),
            countries: this.getCountryBreakdown(days),
            hourly: this.getHourlyBreakdown(),
            realtime: this.getRealtimeVisitors()
        };
    }
}

module.exports = new TrafficService();
