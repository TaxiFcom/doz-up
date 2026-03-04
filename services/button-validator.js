/**
 * Button Validator Service
 * Tests all critical API endpoints that buttons depend on
 * Auto-reports failures and triggers fixes
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    testInterval: 300000,  // 5 minutes
    timeout: 10000,
    logFile: path.join(__dirname, '..', 'logs', 'button-validator.log'),
    resultsFile: path.join(__dirname, '..', 'data', 'button-test-results.json'),
    host: process.env.HOST || 'up.doz.com',
    internalHost: '127.0.0.1',
    port: 3000,
    useInternal: true  // Use internal IP for reliable local checks
};

// All button-dependent endpoints to test
const BUTTON_ENDPOINTS = [
    // Health & Status
    { name: 'Health Check', path: '/health', method: 'GET', expected: 200, critical: true },
    { name: 'Root Page', path: '/', method: 'GET', expected: [200, 301, 302], critical: true },

    // Stripe/Payment Buttons
    { name: 'Stripe Config', path: '/api/stripe/config', method: 'GET', expected: 200, critical: true },
    { name: 'Plans List', path: '/api/stripe/plans', method: 'GET', expected: 200, critical: true },

    // Checkout Pages
    { name: 'Checkout Page', path: '/checkout.html', method: 'GET', expected: 200, critical: true },
    { name: 'Success Page', path: '/success.html', method: 'GET', expected: [200, 404], critical: false },

    // Admin Endpoints
    { name: 'Admin Dashboard', path: '/admin/analytics.html', method: 'GET', expected: [200, 401], critical: false },

    // Static Assets (checking if they exist)
    { name: 'Widget Script', path: '/widget.js', method: 'GET', expected: [200, 404], critical: false },

    // V2 Subscription
    { name: 'V2 Landing', path: '/v2', method: 'GET', expected: [200, 301, 302], critical: false },
    { name: 'V2 Admin', path: '/v2/admin', method: 'GET', expected: [200, 301, 302, 401], critical: false },

    // Image Upload
    { name: 'Upload Page', path: '/index.html', method: 'GET', expected: 200, critical: true },

    // Mobile
    { name: 'Mobile Page', path: '/mobile.html', method: 'GET', expected: 200, critical: false }
];

class ButtonValidator {
    constructor() {
        this.results = this.loadResults();
        this.lastRun = null;
    }

    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        console.log(`[ButtonValidator] [${level}] ${message}`, data);
        try {
            fs.appendFileSync(CONFIG.logFile, `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}\n`);
        } catch (e) {}
    }

    loadResults() {
        try {
            if (fs.existsSync(CONFIG.resultsFile)) {
                return JSON.parse(fs.readFileSync(CONFIG.resultsFile, 'utf8'));
            }
        } catch (e) {}
        return { history: [], lastFullTest: null };
    }

    saveResults() {
        try {
            const dir = path.dirname(CONFIG.resultsFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG.resultsFile, JSON.stringify(this.results, null, 2));
        } catch (e) {}
    }

    // Test a single endpoint - uses internal IP for reliable local checks
    async testEndpoint(endpoint) {
        return new Promise((resolve) => {
            const start = Date.now();
            // Use internal IP (127.0.0.1) with HTTP for local checks
            const url = CONFIG.useInternal
                ? `http://${CONFIG.internalHost}:${CONFIG.port}${endpoint.path}`
                : `https://${CONFIG.host}${endpoint.path}`;
            const protocol = CONFIG.useInternal ? http : https;

            const req = protocol.get(url, { timeout: CONFIG.timeout }, (res) => {
                const latency = Date.now() - start;
                const expectedCodes = Array.isArray(endpoint.expected) ? endpoint.expected : [endpoint.expected];
                const ok = expectedCodes.includes(res.statusCode);

                resolve({
                    name: endpoint.name,
                    path: endpoint.path,
                    ok,
                    statusCode: res.statusCode,
                    latency,
                    critical: endpoint.critical,
                    error: ok ? null : `Unexpected status: ${res.statusCode}`
                });
            });

            req.on('error', (e) => {
                resolve({
                    name: endpoint.name,
                    path: endpoint.path,
                    ok: false,
                    statusCode: 0,
                    latency: Date.now() - start,
                    critical: endpoint.critical,
                    error: e.message
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    name: endpoint.name,
                    path: endpoint.path,
                    ok: false,
                    statusCode: 0,
                    latency: CONFIG.timeout,
                    critical: endpoint.critical,
                    error: 'Timeout'
                });
            });
        });
    }

    // Run full test suite
    async runFullTest() {
        this.log('INFO', 'Starting full button validation test');
        const startTime = Date.now();

        const results = await Promise.all(BUTTON_ENDPOINTS.map(ep => this.testEndpoint(ep)));

        const summary = {
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            total: results.length,
            passed: results.filter(r => r.ok).length,
            failed: results.filter(r => !r.ok).length,
            criticalFailed: results.filter(r => !r.ok && r.critical).length,
            results: results
        };

        // Calculate pass rate
        summary.passRate = Math.round((summary.passed / summary.total) * 100);

        // Log failures
        const failures = results.filter(r => !r.ok);
        if (failures.length > 0) {
            this.log('WARN', 'Button endpoints failing', {
                count: failures.length,
                critical: summary.criticalFailed,
                endpoints: failures.map(f => f.name)
            });
        } else {
            this.log('INFO', 'All button endpoints healthy', { passRate: `${summary.passRate}%` });
        }

        // Store results
        this.results.history.push({
            timestamp: summary.timestamp,
            passRate: summary.passRate,
            failed: failures.map(f => f.path)
        });

        // Keep only last 100 tests
        if (this.results.history.length > 100) {
            this.results.history = this.results.history.slice(-100);
        }

        this.results.lastFullTest = summary;
        this.lastRun = summary;
        this.saveResults();

        // Trigger fixes for critical failures
        if (summary.criticalFailed > 0) {
            await this.triggerAutoFix(failures.filter(f => f.critical));
        }

        return summary;
    }

    // Trigger auto-fix for failures
    async triggerAutoFix(failures) {
        this.log('INFO', 'Triggering auto-fix for critical failures', { count: failures.length });

        // Call self-healer (using internal IP 127.0.0.1 for service-to-service)
        try {
            const result = await new Promise((resolve) => {
                const req = http.request({
                    hostname: '127.0.0.1',
                    port: 3012,
                    path: '/fix/restart-gateway',
                    method: 'POST',
                    timeout: 30000
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(JSON.parse(data)));
                });
                req.on('error', () => resolve({ success: false }));
                req.end();
            });

            this.log('INFO', 'Auto-fix result', result);
        } catch (e) {
            this.log('ERROR', 'Auto-fix failed', { error: e.message });
        }
    }

    // Get current status
    getStatus() {
        return {
            lastRun: this.lastRun,
            history: this.results.history.slice(-10),
            averagePassRate: this.results.history.length > 0
                ? Math.round(this.results.history.reduce((a, b) => a + b.passRate, 0) / this.results.history.length)
                : 100,
            endpointsMonitored: BUTTON_ENDPOINTS.length,
            criticalEndpoints: BUTTON_ENDPOINTS.filter(e => e.critical).length
        };
    }

    // Start validation loop
    start() {
        this.log('INFO', 'Button Validator starting', { interval: CONFIG.testInterval / 1000 + 's' });

        // Run immediately
        this.runFullTest();

        // Then run on interval
        setInterval(() => this.runFullTest(), CONFIG.testInterval);
    }
}

// Create HTTP status server
const validator = new ButtonValidator();

const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/status') {
        res.writeHead(200);
        res.end(JSON.stringify(validator.getStatus()));
    } else if (req.url === '/test' && req.method === 'POST') {
        const result = await validator.runFullTest();
        res.writeHead(result.criticalFailed > 0 ? 500 : 200);
        res.end(JSON.stringify(result));
    } else if (req.url === '/endpoints') {
        res.writeHead(200);
        res.end(JSON.stringify(BUTTON_ENDPOINTS));
    } else {
        res.writeHead(200);
        res.end(JSON.stringify({
            service: 'Button Validator',
            status: 'running',
            endpoints: {
                '/status': 'GET - View validation status',
                '/test': 'POST - Run full test now',
                '/endpoints': 'GET - List monitored endpoints'
            }
        }));
    }
});

server.listen(3013, () => {
    console.log('Button Validator running on port 3013 (up.doz.com)');
});

validator.start();

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           BUTTON VALIDATOR - STARTED                           ║
╠════════════════════════════════════════════════════════════════╣
║  Endpoints Monitored: ${BUTTON_ENDPOINTS.length.toString().padEnd(40)}║
║  Critical Endpoints: ${BUTTON_ENDPOINTS.filter(e => e.critical).length.toString().padEnd(41)}║
║  Test Interval: ${(CONFIG.testInterval / 1000) + 's'.padEnd(46)}║
║  Status: https://up.doz.com:3013/status                         ║
╚════════════════════════════════════════════════════════════════╝
`);
