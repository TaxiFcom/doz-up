/**
 * DOZ UP - AI Operations Center
 * 24/7 Non-stop AI monitoring, auto-healing, and platform optimization
 *
 * Departments:
 * 1. Health & Uptime - Continuous endpoint monitoring
 * 2. Performance - Memory, response times, bottlenecks
 * 3. Security - Threat detection, anomaly alerts
 * 4. Quality - Error tracking, data integrity
 * 5. Conversion - A/B tests, user experience
 * 6. Support - Auto-responses, escalation
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============ CONFIGURATION ============
const CONFIG = {
    baseUrl: process.env.BASE_URL || 'https://up.doz.com',
    localUrl: 'http://localhost:3000',
    intervals: {
        health: 60 * 1000,        // Health check every 1 minute
        performance: 5 * 60 * 1000, // Performance scan every 5 minutes
        security: 15 * 60 * 1000,   // Security scan every 15 minutes
        quality: 10 * 60 * 1000,    // Quality check every 10 minutes
        fullReport: 60 * 60 * 1000  // Full AI report every hour
    },
    thresholds: {
        responseTime: 3000,    // 3 seconds max
        memoryMB: 500,         // 500MB max heap
        errorRate: 0.05,       // 5% max error rate
        uptimePercent: 99.5    // 99.5% uptime required
    }
};

// ============ DATA STORAGE ============
const dataDir = path.join(__dirname, '..', 'data');
const opsLogPath = path.join(dataDir, 'ai-ops-log.json');

// In-memory metrics
const metrics = {
    startTime: Date.now(),
    healthChecks: 0,
    issuesDetected: 0,
    issuesFixed: 0,
    lastCheck: null,
    endpoints: {},
    errors: [],
    fixes: [],
    alerts: []
};

// ============ AI OPS CENTER CLASS ============
class AIOpsCenter extends EventEmitter {
    constructor() {
        super();
        this.running = false;
        this.timers = {};
        this.departments = {
            health: { status: 'idle', lastRun: null, issues: 0, description: 'Endpoint uptime & availability' },
            performance: { status: 'idle', lastRun: null, issues: 0, description: 'Memory, CPU, response times' },
            security: { status: 'idle', lastRun: null, issues: 0, description: 'Threat detection & anomalies' },
            quality: { status: 'idle', lastRun: null, issues: 0, description: 'Data integrity & validation' },
            conversion: { status: 'idle', lastRun: null, issues: 0, description: 'A/B tests & funnel analysis' },
            support: { status: 'idle', lastRun: null, issues: 0, description: 'Customer tickets & AI responses' },
            growth: { status: 'idle', lastRun: null, issues: 0, description: 'Traffic, SEO, marketing' },
            revenue: { status: 'idle', lastRun: null, issues: 0, description: 'Payments, subscriptions, MRR' },
            infrastructure: { status: 'idle', lastRun: null, issues: 0, description: 'Storage, backups, resources' },
            experience: { status: 'idle', lastRun: null, issues: 0, description: 'UX metrics, error rates' }
        };
    }

    // ============ MAIN START/STOP ============
    start() {
        if (this.running) return;
        this.running = true;

        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║          DOZ UP - AI Operations Center                   ║');
        console.log('║              24/7 Non-Stop Monitoring                    ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');

        // Start all department monitors
        this.startHealthMonitor();
        this.startPerformanceMonitor();
        this.startSecurityMonitor();
        this.startQualityMonitor();
        this.startConversionMonitor();
        this.startSupportMonitor();
        this.startGrowthMonitor();
        this.startRevenueMonitor();
        this.startInfrastructureMonitor();
        this.startExperienceMonitor();

        // Start hourly full report
        this.timers.fullReport = setInterval(() => this.generateFullReport(), CONFIG.intervals.fullReport);

        // Initial full scan after 10 seconds
        setTimeout(() => this.runFullScan(), 10000);

        this.emit('started', { timestamp: Date.now() });
        console.log('[AI-Ops] All departments activated. Running 24/7.\n');
    }

    stop() {
        this.running = false;
        Object.values(this.timers).forEach(t => clearInterval(t));
        this.timers = {};
        console.log('[AI-Ops] All departments stopped.');
        this.emit('stopped', { timestamp: Date.now() });
    }

    // ============ HEALTH DEPARTMENT ============
    startHealthMonitor() {
        console.log('[Health] Starting continuous health monitoring...');

        const endpoints = [
            '/',
            '/api/upload-health',
            '/api/admin/stats',
            '/checkout.html',
            '/cabinet.html',
            '/hub.html',
            '/mobile.html',
            '/studio.html'
        ];

        const checkHealth = async () => {
            this.departments.health.status = 'running';
            const results = { passed: 0, failed: 0, issues: [] };

            for (const endpoint of endpoints) {
                try {
                    const start = Date.now();
                    const response = await this.httpGet(CONFIG.localUrl + endpoint);
                    const duration = Date.now() - start;

                    metrics.endpoints[endpoint] = {
                        status: response.statusCode,
                        responseTime: duration,
                        lastCheck: Date.now()
                    };

                    if (response.statusCode >= 200 && response.statusCode < 400) {
                        results.passed++;
                        if (duration > CONFIG.thresholds.responseTime) {
                            results.issues.push({
                                type: 'slow_response',
                                endpoint,
                                duration,
                                severity: 'warning'
                            });
                        }
                    } else {
                        results.failed++;
                        results.issues.push({
                            type: 'endpoint_error',
                            endpoint,
                            status: response.statusCode,
                            severity: 'critical'
                        });
                    }
                } catch (err) {
                    results.failed++;
                    results.issues.push({
                        type: 'endpoint_down',
                        endpoint,
                        error: err.message,
                        severity: 'critical'
                    });
                }
            }

            metrics.healthChecks++;
            metrics.lastCheck = Date.now();
            this.departments.health.lastRun = Date.now();
            this.departments.health.issues = results.issues.length;
            this.departments.health.status = 'idle';

            // Auto-heal critical issues
            for (const issue of results.issues.filter(i => i.severity === 'critical')) {
                await this.autoHeal(issue);
            }

            this.emit('health:check', results);
        };

        checkHealth(); // Initial check
        this.timers.health = setInterval(checkHealth, CONFIG.intervals.health);
    }

    // ============ PERFORMANCE DEPARTMENT ============
    startPerformanceMonitor() {
        console.log('[Performance] Starting performance monitoring...');

        const checkPerformance = async () => {
            this.departments.performance.status = 'running';
            const issues = [];

            try {
                // Check server stats
                const statsRes = await this.httpGet(CONFIG.localUrl + '/api/admin/stats');
                if (statsRes.statusCode === 200) {
                    const stats = JSON.parse(statsRes.body);

                    // Check connection count
                    if (stats.online?.total > 100) {
                        issues.push({
                            type: 'high_connections',
                            value: stats.online.total,
                            threshold: 100,
                            severity: 'warning'
                        });
                    }
                }

                // Check upload health for memory
                const healthRes = await this.httpGet(CONFIG.localUrl + '/api/upload-health');
                if (healthRes.statusCode === 200) {
                    const health = JSON.parse(healthRes.body);

                    if (health.checks?.memory?.heapUsedMB > CONFIG.thresholds.memoryMB) {
                        issues.push({
                            type: 'high_memory',
                            value: health.checks.memory.heapUsedMB,
                            threshold: CONFIG.thresholds.memoryMB,
                            severity: 'warning'
                        });
                    }
                }

            } catch (err) {
                issues.push({
                    type: 'performance_check_failed',
                    error: err.message,
                    severity: 'warning'
                });
            }

            this.departments.performance.lastRun = Date.now();
            this.departments.performance.issues = issues.length;
            this.departments.performance.status = 'idle';

            if (issues.length > 0) {
                metrics.issuesDetected += issues.length;
                this.emit('performance:issues', issues);
            }
        };

        setTimeout(checkPerformance, 30000); // First check after 30s
        this.timers.performance = setInterval(checkPerformance, CONFIG.intervals.performance);
    }

    // ============ SECURITY DEPARTMENT ============
    startSecurityMonitor() {
        console.log('[Security] Starting security monitoring...');

        const checkSecurity = async () => {
            this.departments.security.status = 'running';
            const issues = [];

            try {
                // Check for suspicious patterns in recent errors
                const errLog = path.join(__dirname, '..', 'data', 'ai-error-telemetry.json');
                if (fs.existsSync(errLog)) {
                    const errors = JSON.parse(fs.readFileSync(errLog, 'utf8'));
                    const recentErrors = (errors.errors || []).filter(
                        e => Date.now() - e.timestamp < 3600000 // Last hour
                    );

                    // Check for injection attempts
                    const suspiciousPatterns = recentErrors.filter(e =>
                        e.message && (
                            e.message.includes('<script') ||
                            e.message.includes('SELECT') ||
                            e.message.includes('DROP TABLE') ||
                            e.message.includes('../')
                        )
                    );

                    if (suspiciousPatterns.length > 0) {
                        issues.push({
                            type: 'suspicious_activity',
                            count: suspiciousPatterns.length,
                            severity: 'critical'
                        });
                    }

                    // Check for brute force (many errors from same source)
                    const errorsByDevice = {};
                    recentErrors.forEach(e => {
                        const key = e.deviceId || 'unknown';
                        errorsByDevice[key] = (errorsByDevice[key] || 0) + 1;
                    });

                    for (const [device, count] of Object.entries(errorsByDevice)) {
                        if (count > 50) {
                            issues.push({
                                type: 'possible_brute_force',
                                device,
                                errorCount: count,
                                severity: 'warning'
                            });
                        }
                    }
                }

            } catch (err) {
                // Ignore security check errors silently
            }

            this.departments.security.lastRun = Date.now();
            this.departments.security.issues = issues.length;
            this.departments.security.status = 'idle';

            if (issues.length > 0) {
                metrics.issuesDetected += issues.length;
                this.emit('security:alert', issues);
            }
        };

        setTimeout(checkSecurity, 60000); // First check after 1 min
        this.timers.security = setInterval(checkSecurity, CONFIG.intervals.security);
    }

    // ============ QUALITY DEPARTMENT ============
    startQualityMonitor() {
        console.log('[Quality] Starting quality monitoring...');

        const checkQuality = async () => {
            this.departments.quality.status = 'running';
            const issues = [];

            try {
                // Check data integrity
                const dataFiles = [
                    'uploads.json',
                    'devices.json',
                    'shares.json',
                    'auth-users.json'
                ];

                for (const file of dataFiles) {
                    const filePath = path.join(dataDir, file);
                    if (fs.existsSync(filePath)) {
                        try {
                            const content = fs.readFileSync(filePath, 'utf8');
                            JSON.parse(content); // Validate JSON
                        } catch (parseErr) {
                            issues.push({
                                type: 'corrupted_data_file',
                                file,
                                error: parseErr.message,
                                severity: 'critical'
                            });
                        }
                    }
                }

                // Check for stale data (files not updated in 24 hours that should be)
                const activityFiles = ['traffic.json', 'analytics-advanced.json'];
                for (const file of activityFiles) {
                    const filePath = path.join(dataDir, file);
                    if (fs.existsSync(filePath)) {
                        const stats = fs.statSync(filePath);
                        const ageHours = (Date.now() - stats.mtimeMs) / 3600000;
                        if (ageHours > 24) {
                            issues.push({
                                type: 'stale_data',
                                file,
                                hoursOld: Math.round(ageHours),
                                severity: 'warning'
                            });
                        }
                    }
                }

            } catch (err) {
                // Ignore quality check errors
            }

            this.departments.quality.lastRun = Date.now();
            this.departments.quality.issues = issues.length;
            this.departments.quality.status = 'idle';

            // Auto-heal corrupted files
            for (const issue of issues.filter(i => i.type === 'corrupted_data_file')) {
                await this.autoHeal(issue);
            }

            if (issues.length > 0) {
                this.emit('quality:issues', issues);
            }
        };

        setTimeout(checkQuality, 45000);
        this.timers.quality = setInterval(checkQuality, CONFIG.intervals.quality);
    }

    // ============ CONVERSION DEPARTMENT ============
    startConversionMonitor() {
        console.log('[Conversion] Starting conversion monitoring...');

        const checkConversion = async () => {
            this.departments.conversion.status = 'running';

            try {
                // Check A/B test stats
                const abRes = await this.httpGet(CONFIG.localUrl + '/api/admin/ab-test/stats');
                if (abRes.statusCode === 200) {
                    const stats = JSON.parse(abRes.body);

                    // Emit conversion data for dashboard
                    this.emit('conversion:stats', {
                        test: stats.test,
                        variants: stats.variants,
                        conversions: stats.conversions
                    });
                }

                // Check conversion engine stats
                const convRes = await this.httpGet(CONFIG.localUrl + '/api/admin/conversion/analytics');
                if (convRes.statusCode === 200) {
                    const conv = JSON.parse(convRes.body);
                    this.emit('conversion:funnel', conv);
                }

            } catch (err) {
                // Ignore conversion check errors
            }

            this.departments.conversion.lastRun = Date.now();
            this.departments.conversion.status = 'idle';
        };

        setTimeout(checkConversion, 120000); // First check after 2 min
        this.timers.conversion = setInterval(checkConversion, CONFIG.intervals.performance);
    }

    // ============ SUPPORT DEPARTMENT ============
    startSupportMonitor() {
        console.log('[Support] Starting support monitoring...');

        const checkSupport = async () => {
            this.departments.support.status = 'running';

            try {
                // Check for unanswered support conversations
                const convPath = path.join(dataDir, 'support-conversations.json');
                if (fs.existsSync(convPath)) {
                    const convs = JSON.parse(fs.readFileSync(convPath, 'utf8'));
                    const unanswered = Object.values(convs).filter(c =>
                        c.status === 'open' &&
                        Date.now() - c.lastActivity > 300000 // 5 min without response
                    );

                    if (unanswered.length > 0) {
                        this.emit('support:pending', {
                            count: unanswered.length,
                            oldest: Math.max(...unanswered.map(c => Date.now() - c.lastActivity))
                        });
                    }
                }

            } catch (err) {
                // Ignore support check errors
            }

            this.departments.support.lastRun = Date.now();
            this.departments.support.status = 'idle';
        };

        setTimeout(checkSupport, 90000);
        this.timers.support = setInterval(checkSupport, CONFIG.intervals.performance);
    }

    // ============ GROWTH DEPARTMENT ============
    startGrowthMonitor() {
        console.log('[Growth] Starting growth & marketing monitoring...');

        const checkGrowth = async () => {
            this.departments.growth.status = 'running';

            try {
                // Check traffic trends
                const trafficPath = path.join(dataDir, 'traffic.json');
                if (fs.existsSync(trafficPath)) {
                    const traffic = JSON.parse(fs.readFileSync(trafficPath, 'utf8'));
                    const todayViews = (traffic.pageViews || []).filter(
                        pv => Date.now() - pv.timestamp < 86400000
                    ).length;

                    this.emit('growth:traffic', {
                        todayViews,
                        visitors: Object.keys(traffic.visitors || {}).length
                    });
                }

                // Check viral stats
                const viralPath = path.join(dataDir, 'viral-stats.json');
                if (fs.existsSync(viralPath)) {
                    const viral = JSON.parse(fs.readFileSync(viralPath, 'utf8'));
                    this.emit('growth:viral', viral);
                }

            } catch (err) {}

            this.departments.growth.lastRun = Date.now();
            this.departments.growth.status = 'idle';
        };

        setTimeout(checkGrowth, 150000);
        this.timers.growth = setInterval(checkGrowth, CONFIG.intervals.performance);
    }

    // ============ REVENUE DEPARTMENT ============
    startRevenueMonitor() {
        console.log('[Revenue] Starting revenue & payment monitoring...');

        const checkRevenue = async () => {
            this.departments.revenue.status = 'running';

            try {
                // Check sales stats
                const salesRes = await this.httpGet(CONFIG.localUrl + '/api/admin/sales/stats');
                if (salesRes.statusCode === 200) {
                    const sales = JSON.parse(salesRes.body);
                    this.emit('revenue:sales', sales);
                }

                // Check subscription health
                const subsPath = path.join(dataDir, 'subscriptions.json');
                if (fs.existsSync(subsPath)) {
                    const subs = JSON.parse(fs.readFileSync(subsPath, 'utf8'));
                    const active = Object.values(subs).filter(s => s.status === 'active').length;
                    this.emit('revenue:subscriptions', { active });
                }

            } catch (err) {}

            this.departments.revenue.lastRun = Date.now();
            this.departments.revenue.status = 'idle';
        };

        setTimeout(checkRevenue, 180000);
        this.timers.revenue = setInterval(checkRevenue, CONFIG.intervals.performance);
    }

    // ============ INFRASTRUCTURE DEPARTMENT ============
    startInfrastructureMonitor() {
        console.log('[Infrastructure] Starting infrastructure monitoring...');

        const checkInfra = async () => {
            this.departments.infrastructure.status = 'running';
            const issues = [];

            try {
                // Check uploads directory size
                const uploadsDir = path.join(__dirname, '..', 'public', 'up');
                if (fs.existsSync(uploadsDir)) {
                    const files = fs.readdirSync(uploadsDir);
                    const totalFiles = files.length;

                    if (totalFiles > 10000) {
                        issues.push({
                            type: 'high_file_count',
                            count: totalFiles,
                            severity: 'warning'
                        });
                    }

                    this.emit('infrastructure:storage', { files: totalFiles });
                }

                // Check data directory sizes
                const dataFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
                let totalDataSize = 0;
                for (const file of dataFiles) {
                    try {
                        const stats = fs.statSync(path.join(dataDir, file));
                        totalDataSize += stats.size;
                    } catch (e) {}
                }

                this.emit('infrastructure:data', {
                    files: dataFiles.length,
                    totalSizeMB: Math.round(totalDataSize / 1024 / 1024 * 10) / 10
                });

            } catch (err) {}

            this.departments.infrastructure.lastRun = Date.now();
            this.departments.infrastructure.issues = issues.length;
            this.departments.infrastructure.status = 'idle';

            if (issues.length > 0) {
                this.emit('infrastructure:issues', issues);
            }
        };

        setTimeout(checkInfra, 200000);
        this.timers.infrastructure = setInterval(checkInfra, CONFIG.intervals.security);
    }

    // ============ USER EXPERIENCE DEPARTMENT ============
    startExperienceMonitor() {
        console.log('[Experience] Starting UX monitoring...');

        const checkExperience = async () => {
            this.departments.experience.status = 'running';

            try {
                // Check heatmap/funnel data
                const funnelPath = path.join(dataDir, 'heatmap-funnel.json');
                if (fs.existsSync(funnelPath)) {
                    const funnel = JSON.parse(fs.readFileSync(funnelPath, 'utf8'));

                    // Calculate average session duration
                    const sessions = Object.values(funnel.sessions || {});
                    if (sessions.length > 0) {
                        const avgDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / sessions.length;
                        this.emit('experience:sessions', {
                            count: sessions.length,
                            avgDurationSec: Math.round(avgDuration / 1000)
                        });
                    }
                }

                // Check error telemetry for UX issues
                const errPath = path.join(dataDir, 'ai-error-telemetry.json');
                if (fs.existsSync(errPath)) {
                    const errors = JSON.parse(fs.readFileSync(errPath, 'utf8'));
                    const recentErrors = (errors.errors || []).filter(
                        e => Date.now() - e.timestamp < 3600000
                    );

                    // Group by page
                    const errorsByPage = {};
                    recentErrors.forEach(e => {
                        const page = e.page || 'unknown';
                        errorsByPage[page] = (errorsByPage[page] || 0) + 1;
                    });

                    this.emit('experience:errors', {
                        total: recentErrors.length,
                        byPage: errorsByPage
                    });
                }

            } catch (err) {}

            this.departments.experience.lastRun = Date.now();
            this.departments.experience.status = 'idle';
        };

        setTimeout(checkExperience, 120000);
        this.timers.experience = setInterval(checkExperience, CONFIG.intervals.quality);
    }

    // ============ AUTO-HEAL SYSTEM ============
    async autoHeal(issue) {
        console.log(`[Auto-Heal] Attempting to fix: ${issue.type}`);
        metrics.issuesDetected++;

        try {
            switch (issue.type) {
                case 'endpoint_down':
                case 'endpoint_error':
                    // Try to restart the service
                    console.log('[Auto-Heal] Endpoint issue - service should self-recover');
                    break;

                case 'high_memory':
                    // Trigger garbage collection hint
                    if (global.gc) {
                        global.gc();
                        console.log('[Auto-Heal] Triggered garbage collection');
                    }
                    break;

                case 'corrupted_data_file':
                    // Try to restore from backup
                    const backupPath = path.join(dataDir, issue.file + '.bak');
                    const originalPath = path.join(dataDir, issue.file);
                    if (fs.existsSync(backupPath)) {
                        fs.copyFileSync(backupPath, originalPath);
                        console.log(`[Auto-Heal] Restored ${issue.file} from backup`);
                        metrics.issuesFixed++;
                    }
                    break;

                default:
                    console.log(`[Auto-Heal] No auto-fix available for: ${issue.type}`);
            }

            metrics.fixes.push({
                timestamp: Date.now(),
                issue: issue.type,
                status: 'attempted'
            });

        } catch (err) {
            console.log(`[Auto-Heal] Fix failed: ${err.message}`);
        }
    }

    // ============ FULL SCAN ============
    async runFullScan() {
        console.log('\n[AI-Ops] Running full system scan...');

        const scan = {
            timestamp: Date.now(),
            departments: {},
            overallHealth: 'healthy'
        };

        for (const [dept, data] of Object.entries(this.departments)) {
            scan.departments[dept] = {
                status: data.status,
                lastRun: data.lastRun,
                issues: data.issues
            };
            if (data.issues > 0) {
                scan.overallHealth = 'degraded';
            }
        }

        console.log('[AI-Ops] Full scan complete. Status:', scan.overallHealth);
        this.emit('scan:complete', scan);
        return scan;
    }

    // ============ GENERATE REPORT ============
    async generateFullReport() {
        const report = {
            timestamp: Date.now(),
            uptime: Date.now() - metrics.startTime,
            healthChecks: metrics.healthChecks,
            issuesDetected: metrics.issuesDetected,
            issuesFixed: metrics.issuesFixed,
            departments: this.departments,
            endpoints: metrics.endpoints,
            recentAlerts: metrics.alerts.slice(0, 10)
        };

        // Save to file
        try {
            fs.writeFileSync(opsLogPath, JSON.stringify(report, null, 2));
        } catch (err) {}

        console.log('\n[AI-Ops] Hourly Report Generated');
        console.log(`  Health checks: ${report.healthChecks}`);
        console.log(`  Issues detected: ${report.issuesDetected}`);
        console.log(`  Issues fixed: ${report.issuesFixed}`);
        console.log(`  Uptime: ${Math.round(report.uptime / 60000)} minutes\n`);

        this.emit('report:generated', report);
        return report;
    }

    // ============ HTTP HELPER ============
    httpGet(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, { timeout: 10000 }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, body }));
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    // ============ STATUS ============
    getStatus() {
        return {
            running: this.running,
            uptime: Date.now() - metrics.startTime,
            metrics,
            departments: this.departments,
            realTimeStats: this.getRealTimeStats()
        };
    }

    // ============ REAL-TIME STATS FROM ALL DATA SOURCES ============
    getRealTimeStats() {
        const stats = {
            traffic: { todayViews: 0, totalVisitors: 0, activeSessions: 0 },
            uploads: { total: 0, today: 0, thisWeek: 0 },
            users: { total: 0, active: 0, new24h: 0 },
            shares: { total: 0, totalViews: 0 },
            revenue: { activeSubscriptions: 0, mrr: 0 },
            support: { openTickets: 0, avgResponseTime: 0 },
            performance: { avgResponseTime: 0, errorRate: 0 }
        };

        try {
            // Traffic stats
            const trafficPath = path.join(dataDir, 'traffic.json');
            if (fs.existsSync(trafficPath)) {
                const traffic = JSON.parse(fs.readFileSync(trafficPath, 'utf8'));
                const now = Date.now();
                const dayAgo = now - 86400000;

                const pageViews = traffic.pageViews || [];
                stats.traffic.todayViews = pageViews.filter(pv => pv.timestamp > dayAgo).length;
                stats.traffic.totalVisitors = Object.keys(traffic.visitors || {}).length;

                const sessions = traffic.sessions || {};
                stats.traffic.activeSessions = Object.values(sessions).filter(s =>
                    now - (s.lastActivity || s.start || 0) < 300000
                ).length;
            }

            // Upload stats
            const uploadsPath = path.join(dataDir, 'uploads.json');
            if (fs.existsSync(uploadsPath)) {
                const uploads = JSON.parse(fs.readFileSync(uploadsPath, 'utf8'));
                const uploadsList = Array.isArray(uploads) ? uploads : Object.values(uploads);
                const now = Date.now();
                const dayAgo = now - 86400000;
                const weekAgo = now - 604800000;

                stats.uploads.total = uploadsList.length;
                stats.uploads.today = uploadsList.filter(u => {
                    const ts = u.timestamp || u.uploadedAt || 0;
                    return typeof ts === 'number' ? ts > dayAgo : new Date(ts).getTime() > dayAgo;
                }).length;
                stats.uploads.thisWeek = uploadsList.filter(u => {
                    const ts = u.timestamp || u.uploadedAt || 0;
                    return typeof ts === 'number' ? ts > weekAgo : new Date(ts).getTime() > weekAgo;
                }).length;
            }

            // User/Device stats
            const devicesPath = path.join(dataDir, 'devices.json');
            if (fs.existsSync(devicesPath)) {
                const devices = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
                const devicesList = Array.isArray(devices) ? devices : Object.values(devices);
                const now = Date.now();
                const dayAgo = now - 86400000;

                stats.users.total = devicesList.length;
                stats.users.active = devicesList.filter(d => {
                    const lastSeen = d.lastSeen || d.lastActive || 0;
                    return typeof lastSeen === 'number' ? lastSeen > dayAgo : new Date(lastSeen).getTime() > dayAgo;
                }).length;
                stats.users.new24h = devicesList.filter(d => {
                    const created = d.createdAt || d.firstSeen || 0;
                    return typeof created === 'number' ? created > dayAgo : new Date(created).getTime() > dayAgo;
                }).length;
            }

            // Share stats
            const sharesPath = path.join(dataDir, 'shares.json');
            if (fs.existsSync(sharesPath)) {
                const shares = JSON.parse(fs.readFileSync(sharesPath, 'utf8'));
                const sharesList = Object.values(shares);
                stats.shares.total = sharesList.length;
                stats.shares.totalViews = sharesList.reduce((sum, s) => sum + (s.views || 0), 0);
            }

            // Revenue/Subscription stats
            const subsPath = path.join(dataDir, 'subscriptions.json');
            if (fs.existsSync(subsPath)) {
                const subs = JSON.parse(fs.readFileSync(subsPath, 'utf8'));
                const subsList = Array.isArray(subs) ? subs : Object.values(subs);
                const activeSubs = subsList.filter(s => s.status === 'active');
                stats.revenue.activeSubscriptions = activeSubs.length;

                // Calculate MRR (Monthly Recurring Revenue)
                stats.revenue.mrr = activeSubs.reduce((sum, s) => {
                    const amount = s.amount || s.price || 0;
                    const interval = s.interval || 'month';
                    if (interval === 'year') return sum + (amount / 12);
                    return sum + amount;
                }, 0);
            }

            // Support stats
            const supportPath = path.join(dataDir, 'support-conversations.json');
            if (fs.existsSync(supportPath)) {
                const convs = JSON.parse(fs.readFileSync(supportPath, 'utf8'));
                const convsList = Object.values(convs);
                stats.support.openTickets = convsList.filter(c => c.status === 'open' || c.status === 'pending').length;
            }

            // Performance stats from endpoints
            const endpointTimes = Object.values(metrics.endpoints).map(e => e.responseTime || 0);
            if (endpointTimes.length > 0) {
                stats.performance.avgResponseTime = Math.round(
                    endpointTimes.reduce((a, b) => a + b, 0) / endpointTimes.length
                );
            }
            const errorEndpoints = Object.values(metrics.endpoints).filter(e => e.status >= 400).length;
            const totalEndpoints = Object.keys(metrics.endpoints).length;
            if (totalEndpoints > 0) {
                stats.performance.errorRate = Math.round((errorEndpoints / totalEndpoints) * 100);
            }

        } catch (err) {
            console.error('[AI-Ops] Error collecting real-time stats:', err.message);
        }

        return stats;
    }
}

// ============ SINGLETON EXPORT ============
const opsCenter = new AIOpsCenter();

module.exports = opsCenter;

// ============ STANDALONE EXECUTION ============
if (require.main === module) {
    console.log('Starting AI Operations Center as standalone service...');
    opsCenter.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down AI Operations Center...');
        opsCenter.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        opsCenter.stop();
        process.exit(0);
    });
}
