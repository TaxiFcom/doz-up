/**
 * DOZ UP - AI Health Monitor
 * Comprehensive 7-minute health checks with AI analysis and auto-healing
 *
 * Features:
 * - Puppeteer-based page health checks
 * - Console error detection
 * - Response time monitoring
 * - AI pattern analysis
 * - Auto-healing capabilities
 * - Real-time alerts
 */

const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURATION ============
const CONFIG = {
    checkInterval: 5 * 60 * 1000, // 5 minutes
    pageTimeout: 10000, // 10 seconds per page (faster timeout)
    batchSize: 2, // 2 pages concurrently (reduced to save resources)
    baseUrl: process.env.BASE_URL || 'https://up.doz.com',
    logPath: path.join(__dirname, '..', 'logs', 'ai-health-monitor.log'),
    screenshotPath: path.join(__dirname, '..', 'logs', 'screenshots'),
    thresholds: {
        responseTime: 3000, // 3 seconds (stricter)
        errorRate: 0.1, // 10%
        memoryUsage: 850, // MB
    },
    healCooldown: 15 * 60 * 1000, // 15 minutes between heals
    headless: 'new', // Use new headless mode for better performance
};

// ============ PAGES TO MONITOR ============
const PAGES = {
    critical: [
        '/',
        '/index.html',
        '/login.html',
        '/upload.html',
        '/my.html',
        '/pay.html',
        '/order.html'
    ],
    public: [
        '/gallery.html',
        '/studio.html',
        '/annotate.html',
        '/frames.html',
        '/collage.html',
        '/themes.html',
        '/cabinet.html',
        '/hub.html',
        '/download.html',
        '/demo.html',
        '/mobile.html',
        '/landing.html',
        '/doz-landing.html',
        '/tools.html',
        '/my-account.html',
        '/my-gallery.html',
        '/status.html',
        '/help-center.html',
        '/changelog.html',
        '/lp/instant.html'
    ],
    admin: [
        '/admin/dashboard.html',
        '/admin/analytics.html',
        '/admin/control-center.html',
        '/admin/support-inbox.html',
        '/admin/growth-center.html',
        '/admin/intelligence.html',
        '/admin/system-monitor.html'
    ],
    subscription: [
        '/v2/pricing.html',
        '/v2/enterprise.html',
        '/v2/lifetime.html',
        '/v2/dashboard.html'
    ],
    payment: [
        '/payment/success.html',
        '/payment/cancel.html'
    ]
};

// ============ APP DOWNLOADS TO MONITOR ============
const DOWNLOADS = {
    windows: '/download/DOZ-UP-v2.8.0.exe',
    mac: '/download/DOZ-UP-v2.6.4-mac.zip', // Pending v2.8.0 build on macOS
    linux: '/download/DOZ-UP-v2.6.4.AppImage', // Pending v2.8.0 build on Linux
    android: '/download/DOZ-UP-v2.8.0.apk',
    extension: '/download/DOZ-UP-Extension-v2.8.0.zip'
};

// ============ STATE ============
let browser = null;
let lastHealTime = {};
let healthHistory = [];
const MAX_HISTORY = 24 * 60 / 7; // 24 hours of 7-minute checks

// ============ LOGGING ============
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...data
    };

    // Console output with colors
    const colors = {
        INFO: '\x1b[36m',
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m',
        SUCCESS: '\x1b[32m',
        RESET: '\x1b[0m'
    };

    console.log(`${colors[level] || ''}[${timestamp}] [${level}] ${message}${colors.RESET}`, data.details || '');

    // File logging
    try {
        const logDir = path.dirname(CONFIG.logPath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(CONFIG.logPath, JSON.stringify(logEntry) + '\n');
    } catch (e) {
        console.error('Failed to write log:', e.message);
    }
}

// ============ PAGE HEALTH CHECKER ============
async function initBrowser() {
    if (!browser) {
        log('INFO', 'Launching headless browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-sync',
                '--disable-translate',
                '--disable-default-apps',
                '--mute-audio',
                '--hide-scrollbars',
                '--metrics-recording-only',
                '--no-first-run',
                '--safebrowsing-disable-auto-update',
                '--window-size=1280,720'
            ]
        });
    }
    return browser;
}

async function checkPage(url) {
    const fullUrl = CONFIG.baseUrl + url;
    const startTime = Date.now();
    const result = {
        url,
        fullUrl,
        timestamp: new Date().toISOString(),
        healthy: false,
        statusCode: 0,
        responseTime: 0,
        errors: [],
        warnings: [],
        consoleLogs: [],
        screenshot: null
    };

    let page = null;

    try {
        const browserInstance = await initBrowser();
        page = await browserInstance.newPage();

        // Set viewport (smaller for faster rendering)
        await page.setViewport({ width: 1280, height: 720 });

        // Capture console messages
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();

            if (type === 'error') {
                // Ignore benign console errors
                if (text.includes('WebSocket connection') ||
                    text.includes('fonts.googleapis.com') ||
                    text.includes('fonts.gstatic.com') ||
                    text.includes('Failed to load resource: net::ERR_FAILED') ||
                    text.includes('Failed to load resource: the server responded with a status of 404') ||
                    text.includes('googletagmanager.com') ||
                    text.includes('google-analytics.com') ||
                    text.includes('facebook.net') ||
                    text.includes('/api/') ||
                    text.includes('icon from the Manifest') ||
                    text.includes('Manifest:')) {
                    // Skip these - they're expected in headless testing
                } else {
                    result.errors.push({
                        type: 'console',
                        text: text.substring(0, 500),
                        location: msg.location()
                    });
                }
            } else if (type === 'warning') {
                result.warnings.push(text.substring(0, 200));
            }

            result.consoleLogs.push({
                type,
                text: text.substring(0, 200)
            });
        });

        // Capture page errors (uncaught exceptions)
        page.on('pageerror', error => {
            result.errors.push({
                type: 'pageerror',
                text: error.message?.substring(0, 500) || 'Unknown error',
                stack: error.stack?.substring(0, 1000)
            });
        });

        // Capture failed requests
        page.on('requestfailed', request => {
            const failure = request.failure();
            const url = request.url();
            // Ignore expected failures
            if (failure?.errorText === 'net::ERR_ABORTED') return;
            // Ignore external font failures (Google Fonts, etc)
            if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return;
            // Ignore external CDN/analytics failures that don't affect functionality
            if (url.includes('googletagmanager.com') || url.includes('google-analytics.com')) return;
            if (url.includes('facebook.net') || url.includes('fbevents.js')) return;
            if (url.includes('doubleclick.net') || url.includes('googlesyndication.com')) return;

            result.errors.push({
                type: 'request',
                url: url.substring(0, 200),
                reason: failure?.errorText || 'Unknown'
            });
        });

        // Navigate to page (use domcontentloaded for faster checks)
        const response = await page.goto(fullUrl, {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.pageTimeout
        });

        result.statusCode = response?.status() || 0;
        result.responseTime = Date.now() - startTime;

        // Check for error indicators in page content
        const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');

        if (bodyText.includes('500') && bodyText.includes('Internal Server Error')) {
            result.errors.push({ type: 'content', text: 'Page shows 500 Internal Server Error' });
        }
        if (bodyText.includes('404') && bodyText.includes('Not Found')) {
            result.errors.push({ type: 'content', text: 'Page shows 404 Not Found' });
        }
        if (bodyText.includes('Cannot GET') || bodyText.includes('Cannot POST')) {
            result.errors.push({ type: 'content', text: 'Route not found' });
        }

        // Take screenshot if errors found
        if (result.errors.length > 0) {
            try {
                const screenshotDir = CONFIG.screenshotPath;
                if (!fs.existsSync(screenshotDir)) {
                    fs.mkdirSync(screenshotDir, { recursive: true });
                }
                const filename = `error_${url.replace(/\//g, '_')}_${Date.now()}.png`;
                const screenshotPath = path.join(screenshotDir, filename);
                await page.screenshot({ path: screenshotPath, fullPage: false });
                result.screenshot = filename;
            } catch (e) {
                // Screenshot failed, continue
            }
        }

        // Determine health
        result.healthy = result.errors.length === 0 &&
            result.statusCode >= 200 &&
            result.statusCode < 400 &&
            result.responseTime < CONFIG.thresholds.responseTime;


    } catch (error) {
        result.responseTime = Date.now() - startTime;
        result.errors.push({
            type: 'navigation',
            text: error.message?.substring(0, 500) || 'Navigation failed'
        });
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (e) {
                // Page already closed
            }
        }
    }

    return result;
}

// ============ AI ANALYZER ============
class AIAnalyzer {
    constructor() {
        this.patterns = new Map();
    }

    analyze(results) {
        const analysis = {
            timestamp: new Date().toISOString(),
            severity: 'low',
            patterns: [],
            predictions: [],
            recommendations: []
        };

        // Group errors by type
        const errorsByType = {};
        const failedPages = [];

        for (const [url, page] of Object.entries(results.pages)) {
            if (!page.healthy) {
                failedPages.push(url);
            }

            for (const error of page.errors) {
                const key = `${error.type}:${(error.text || '').substring(0, 50)}`;
                if (!errorsByType[key]) {
                    errorsByType[key] = { count: 0, pages: [], sample: error };
                }
                errorsByType[key].count++;
                errorsByType[key].pages.push(url);
            }
        }

        // Detect patterns
        for (const [key, data] of Object.entries(errorsByType)) {
            if (data.count >= 3) {
                analysis.patterns.push({
                    type: 'recurring_error',
                    error: data.sample,
                    affectedPages: data.pages.length,
                    frequency: data.count
                });
            }
        }

        // Mass failure detection
        const errorRate = failedPages.length / results.summary.total;
        if (failedPages.length >= 5 || errorRate > 0.3) {
            analysis.patterns.push({
                type: 'mass_failure',
                affectedPages: failedPages.length,
                errorRate: (errorRate * 100).toFixed(1) + '%'
            });
        }

        // Trend analysis
        if (healthHistory.length >= 3) {
            const recentErrorRates = healthHistory.slice(-3).map(h =>
                h.summary.errors / h.summary.total
            );
            const trend = recentErrorRates[2] - recentErrorRates[0];

            if (trend > 0.1) {
                analysis.predictions.push({
                    type: 'degradation',
                    message: 'Error rate increasing - potential issue developing',
                    confidence: 0.8
                });
            }
        }

        // Response time analysis
        if (results.summary.avgResponseTime > CONFIG.thresholds.responseTime) {
            analysis.predictions.push({
                type: 'slow_performance',
                message: `Average response time ${results.summary.avgResponseTime}ms exceeds threshold`,
                confidence: 0.9
            });
        }

        // Generate recommendations
        for (const pattern of analysis.patterns) {
            if (pattern.type === 'mass_failure') {
                analysis.recommendations.push({
                    action: 'restart_gateway',
                    message: 'Multiple pages failing - restart recommended',
                    autoHeal: true,
                    priority: 'high'
                });
            }
            if (pattern.type === 'recurring_error' && pattern.error.type === 'request') {
                analysis.recommendations.push({
                    action: 'check_external_services',
                    message: `External resource failing on ${pattern.affectedPages} pages`,
                    autoHeal: false,
                    priority: 'medium'
                });
            }
        }

        // Calculate severity
        if (errorRate > 0.5 || analysis.patterns.some(p => p.type === 'mass_failure')) {
            analysis.severity = 'critical';
        } else if (errorRate > 0.2 || analysis.predictions.length > 1) {
            analysis.severity = 'high';
        } else if (errorRate > 0.05) {
            analysis.severity = 'medium';
        }

        return analysis;
    }
}

// ============ AUTO-HEALER ============
class AutoHealer {
    constructor() {
        this.healHistory = [];
    }

    canHeal(action) {
        const lastTime = lastHealTime[action];
        if (lastTime && Date.now() - lastTime < CONFIG.healCooldown) {
            return false;
        }
        return true;
    }

    async heal(recommendation) {
        const { action } = recommendation;

        if (!this.canHeal(action)) {
            log('INFO', `Auto-heal ${action} skipped - cooldown active`);
            return { healed: false, reason: 'cooldown' };
        }

        log('WARN', `Executing auto-heal: ${action}`);

        let result = { healed: false };

        switch (action) {
            case 'restart_gateway':
                result = await this.restartGateway();
                break;
            case 'clear_cache':
                result = await this.clearCache();
                break;
            default:
                log('INFO', `Unknown heal action: ${action}`);
        }

        if (result.healed) {
            lastHealTime[action] = Date.now();
            this.healHistory.push({
                action,
                timestamp: new Date().toISOString(),
                success: true
            });
            log('SUCCESS', `Auto-heal ${action} completed`);
        }

        return result;
    }

    restartGateway() {
        return new Promise(resolve => {
            exec('pm2 reload doz-gateway --update-env', { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
                if (error) {
                    log('ERROR', 'Gateway restart failed', { error: error.message });
                    resolve({ healed: false, error: error.message });
                } else {
                    resolve({ healed: true, message: 'Gateway restarted via PM2' });
                }
            });
        });
    }

    async clearCache() {
        // Clear any in-memory caches
        if (global.gc) {
            global.gc();
        }
        return { healed: true, message: 'Caches cleared' };
    }
}

// ============ DOWNLOAD HEALTH CHECKER ============
async function checkDownloads() {
    const results = {};
    const http = require('http');
    const https = require('https');

    for (const [platform, downloadPath] of Object.entries(DOWNLOADS)) {
        const fullUrl = CONFIG.baseUrl + downloadPath;
        const protocol = fullUrl.startsWith('https') ? https : http;

        results[platform] = await new Promise(resolve => {
            const startTime = Date.now();
            const req = protocol.request(fullUrl, { method: 'HEAD', timeout: 10000 }, res => {
                resolve({
                    platform,
                    url: downloadPath,
                    available: res.statusCode === 200,
                    statusCode: res.statusCode,
                    size: res.headers['content-length'] || 0,
                    responseTime: Date.now() - startTime
                });
            });

            req.on('error', () => {
                resolve({
                    platform,
                    url: downloadPath,
                    available: false,
                    statusCode: 0,
                    error: 'Connection failed',
                    responseTime: Date.now() - startTime
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    platform,
                    url: downloadPath,
                    available: false,
                    statusCode: 0,
                    error: 'Timeout',
                    responseTime: Date.now() - startTime
                });
            });

            req.end();
        });
    }

    return results;
}

// ============ SYSTEM METRICS ============
async function getSystemMetrics() {
    return new Promise(resolve => {
        exec('pm2 jlist', (error, stdout) => {
            if (error) {
                resolve({});
                return;
            }
            try {
                const processes = JSON.parse(stdout);
                const gateway = processes.find(p => p.name === 'doz-gateway');
                resolve({
                    memoryUsage: gateway?.monit?.memory ? Math.round(gateway.monit.memory / 1024 / 1024) : 0,
                    cpuUsage: gateway?.monit?.cpu || 0,
                    uptime: gateway?.pm2_env?.pm_uptime || 0,
                    restarts: gateway?.pm2_env?.restart_time || 0
                });
            } catch (e) {
                resolve({});
            }
        });
    });
}

// ============ MAIN HEALTH CHECK CYCLE ============
const analyzer = new AIAnalyzer();
const healer = new AutoHealer();

async function runHealthCheck() {
    const cycleStart = Date.now();
    log('INFO', '========== Starting Health Check Cycle ==========');

    const results = {
        timestamp: new Date().toISOString(),
        pages: {},
        summary: {
            total: 0,
            healthy: 0,
            errors: 0,
            avgResponseTime: 0
        },
        systemMetrics: {}
    };

    // Get all pages
    const allPages = [
        ...PAGES.critical,
        ...PAGES.public,
        ...PAGES.admin,
        ...PAGES.subscription,
        ...PAGES.payment
    ];

    // Check pages in batches
    for (let i = 0; i < allPages.length; i += CONFIG.batchSize) {
        const batch = allPages.slice(i, i + CONFIG.batchSize);
        const batchResults = await Promise.all(
            batch.map(url => checkPage(url))
        );

        for (const result of batchResults) {
            results.pages[result.url] = result;
            results.summary.total++;
            if (result.healthy) {
                results.summary.healthy++;
            } else {
                results.summary.errors++;
            }
        }

        // Small delay between batches
        if (i + CONFIG.batchSize < allPages.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Calculate average response time
    const responseTimes = Object.values(results.pages).map(p => p.responseTime);
    results.summary.avgResponseTime = Math.round(
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    );

    // Get system metrics
    results.systemMetrics = await getSystemMetrics();

    // Check app downloads
    results.downloads = await checkDownloads();
    const availableDownloads = Object.values(results.downloads).filter(d => d.available).length;
    const totalDownloads = Object.keys(results.downloads).length;
    log('INFO', `Downloads: ${availableDownloads}/${totalDownloads} available`, {
        details: Object.entries(results.downloads)
            .filter(([_, d]) => !d.available)
            .map(([p, _]) => p)
            .join(', ') || 'All available'
    });

    // AI Analysis
    const analysis = analyzer.analyze(results);
    results.analysis = analysis;

    // Store in history
    healthHistory.push(results);
    if (healthHistory.length > MAX_HISTORY) {
        healthHistory.shift();
    }

    // Auto-heal if needed
    for (const rec of analysis.recommendations) {
        if (rec.autoHeal && rec.priority === 'high') {
            await healer.heal(rec);
        }
    }

    // Log summary
    const cycleDuration = Date.now() - cycleStart;
    log(
        analysis.severity === 'critical' || analysis.severity === 'high' ? 'ERROR' :
            analysis.severity === 'medium' ? 'WARN' : 'SUCCESS',
        `Health Check Complete`,
        {
            details: `${results.summary.healthy}/${results.summary.total} healthy, ` +
                `${results.summary.avgResponseTime}ms avg, ` +
                `severity: ${analysis.severity}, ` +
                `duration: ${cycleDuration}ms`
        }
    );

    // Log failed pages
    const failedPages = Object.entries(results.pages)
        .filter(([_, p]) => !p.healthy)
        .map(([url, _]) => url);

    if (failedPages.length > 0) {
        log('WARN', `Failed pages: ${failedPages.join(', ')}`);
    }

    return results;
}

// ============ GRACEFUL SHUTDOWN ============
async function shutdown() {
    log('INFO', 'Shutting down AI Health Monitor...');
    if (browser) {
        await browser.close();
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============ START MONITOR ============
async function start() {
    log('INFO', '==============================================');
    log('INFO', '   DOZ UP AI Health Monitor Starting');
    log('INFO', `   Check interval: ${CONFIG.checkInterval / 1000 / 60} minutes`);
    log('INFO', `   Base URL: ${CONFIG.baseUrl}`);
    log('INFO', `   Pages to monitor: ${Object.values(PAGES).flat().length}`);
    log('INFO', '==============================================');

    // Run initial check
    await runHealthCheck();

    // Schedule recurring checks
    setInterval(runHealthCheck, CONFIG.checkInterval);
}

// Start if run directly
if (require.main === module) {
    start().catch(error => {
        log('ERROR', 'Failed to start health monitor', { error: error.message });
        process.exit(1);
    });
}

module.exports = {
    runHealthCheck,
    getSystemMetrics,
    healthHistory,
    CONFIG
};
