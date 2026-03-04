/**
 * DOZ UP Viral Analytics Engine
 * Real-time tracking of submissions and traffic
 */

const fs = require('fs');
const path = require('path');

class ViralAnalytics {
    constructor() {
        this.dataFile = path.join(__dirname, '../data/viral-stats.json');
        this.data = this.load();

        // Real-time stats
        this.realtime = {
            activeConnections: 0,
            submissionsPerMinute: 0,
            lastMinuteSubmissions: [],
            trafficSources: new Map(),
            currentCycle: 0,
        };

        // Auto-save every minute
        setInterval(() => this.save(), 60000);
    }

    load() {
        try {
            if (fs.existsSync(this.dataFile)) {
                return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            }
        } catch (e) {}

        return {
            startedAt: new Date().toISOString(),
            totalCycles: 0,
            totalSubmissions: 0,
            totalSuccess: 0,
            totalFailed: 0,
            totalTrafficGenerated: 0,

            // By category
            categories: {
                indexNow: { hits: 0, success: 0 },
                xmlRpc: { hits: 0, success: 0 },
                searchEngines: { hits: 0, success: 0 },
                social: { hits: 0, success: 0 },
                analyzers: { hits: 0, success: 0 },
                directories: { hits: 0, success: 0 },
                backlinks: { hits: 0, success: 0 },
                archives: { hits: 0, success: 0 },
                feeds: { hits: 0, success: 0 },
                shorteners: { hits: 0, success: 0 },
            },

            // Hourly stats
            hourlyStats: [],

            // Daily stats
            dailyStats: [],

            // Top referrers from viral
            topReferrers: {},

            // Recent cycles
            recentCycles: [],
        };
    }

    save() {
        try {
            const dir = path.dirname(this.dataFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('[Analytics] Save error:', e.message);
        }
    }

    // Record a submission
    recordSubmission(category, success, endpoint = '') {
        this.data.totalSubmissions++;
        if (success) this.data.totalSuccess++;
        else this.data.totalFailed++;

        if (this.data.categories[category]) {
            this.data.categories[category].hits++;
            if (success) this.data.categories[category].success++;
        }

        // Track per-minute rate
        this.realtime.lastMinuteSubmissions.push(Date.now());
        this.realtime.lastMinuteSubmissions = this.realtime.lastMinuteSubmissions.filter(
            t => Date.now() - t < 60000
        );
        this.realtime.submissionsPerMinute = this.realtime.lastMinuteSubmissions.length;
    }

    // Record cycle completion
    recordCycle(stats) {
        this.data.totalCycles++;
        this.realtime.currentCycle = this.data.totalCycles;

        // Update total counters from cycle stats
        this.data.totalSubmissions += stats.totalSubmissions || 0;
        this.data.totalSuccess += stats.successful || 0;
        this.data.totalFailed += stats.failed || 0;

        const cycleData = {
            cycle: this.data.totalCycles,
            timestamp: new Date().toISOString(),
            success: stats.successful || 0,
            failed: stats.failed || 0,
            total: stats.totalSubmissions || 0,
        };

        this.data.recentCycles.unshift(cycleData);
        if (this.data.recentCycles.length > 100) {
            this.data.recentCycles = this.data.recentCycles.slice(0, 100);
        }

        // Hourly aggregation
        const hour = new Date().toISOString().slice(0, 13);
        let hourStat = this.data.hourlyStats.find(h => h.hour === hour);
        if (!hourStat) {
            hourStat = { hour, cycles: 0, success: 0, failed: 0 };
            this.data.hourlyStats.push(hourStat);
        }
        hourStat.cycles++;
        hourStat.success += stats.successful || 0;
        hourStat.failed += stats.failed || 0;

        // Keep only last 72 hours
        this.data.hourlyStats = this.data.hourlyStats.slice(-72);

        this.save();
    }

    // Record incoming traffic from referrer
    recordTraffic(referrer, page) {
        this.data.totalTrafficGenerated++;

        if (referrer) {
            this.data.topReferrers[referrer] = (this.data.topReferrers[referrer] || 0) + 1;
            this.realtime.trafficSources.set(referrer,
                (this.realtime.trafficSources.get(referrer) || 0) + 1
            );
        }
    }

    // Get dashboard data
    getDashboard() {
        const now = Date.now();
        const successRate = this.data.totalSubmissions > 0
            ? ((this.data.totalSuccess / this.data.totalSubmissions) * 100).toFixed(1)
            : 0;

        // Calculate submissions per hour
        const lastHour = this.data.hourlyStats.slice(-1)[0];
        const submissionsLastHour = lastHour ? lastHour.success + lastHour.failed : 0;

        // Top referrers
        const topReferrers = Object.entries(this.data.topReferrers)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([source, count]) => ({ source, count }));

        return {
            // Overview
            overview: {
                startedAt: this.data.startedAt,
                runningFor: this.getRunningTime(),
                totalCycles: this.data.totalCycles,
                currentCycle: this.realtime.currentCycle,
                totalSubmissions: this.data.totalSubmissions,
                totalSuccess: this.data.totalSuccess,
                totalFailed: this.data.totalFailed,
                successRate: successRate + '%',
                totalTraffic: this.data.totalTrafficGenerated,
            },

            // Real-time
            realtime: {
                submissionsPerMinute: this.realtime.submissionsPerMinute,
                submissionsLastHour: submissionsLastHour,
                activeConnections: this.realtime.activeConnections,
            },

            // By category
            categories: this.data.categories,

            // Charts data
            hourlyChart: this.data.hourlyStats.slice(-24).map(h => ({
                hour: h.hour.slice(11, 13) + ':00',
                success: h.success,
                failed: h.failed,
            })),

            // Recent cycles
            recentCycles: this.data.recentCycles.slice(0, 20),

            // Top traffic sources
            topReferrers,
        };
    }

    getRunningTime() {
        const start = new Date(this.data.startedAt);
        const now = new Date();
        const diff = now - start;

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (days > 0) return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    // Get real-time stats for WebSocket
    getRealtimeStats() {
        return {
            cycle: this.realtime.currentCycle,
            submissionsPerMinute: this.realtime.submissionsPerMinute,
            totalSubmissions: this.data.totalSubmissions,
            totalSuccess: this.data.totalSuccess,
            successRate: this.data.totalSubmissions > 0
                ? ((this.data.totalSuccess / this.data.totalSubmissions) * 100).toFixed(1) + '%'
                : '0%',
            totalTraffic: this.data.totalTrafficGenerated,
            lastCycle: this.data.recentCycles[0] || null,
        };
    }
}

module.exports = { ViralAnalytics };
