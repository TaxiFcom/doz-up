/**
 * AI Health Supervisor - Central Brain for Self-Healing
 * Monitors connections, tests endpoints, and auto-fixes issues
 */

const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    checkInterval: 30000,           // 30 seconds
    endpointTestInterval: 300000,   // 5 minutes
    maxFixAttempts: 3,
    fixCooldown: 60000,             // 1 minute between fix attempts
    logFile: path.join(__dirname, '..', 'logs', 'ai-supervisor.log'),
    learningsFile: path.join(__dirname, '..', 'data', 'supervisor-learnings.json'),
    host: process.env.HOST || 'up.doz.com',
    internalHost: '127.0.0.1',      // Internal IP for local checks (not localhost string)
    port: process.env.PORT || 3000,
    useInternal: true               // Use internal IP for health checks
};

// Endpoints to monitor
const ENDPOINTS = [
    { path: '/health', method: 'GET', expected: { status: 200, body: { status: 'ok' } } },
    { path: '/api/stripe/config', method: 'GET', expected: { status: 200, hasKey: 'publishableKey' } },
    { path: '/', method: 'GET', expected: { status: 200 } },
    { path: '/checkout.html', method: 'GET', expected: { status: 200 } }
];

// WebSocket endpoints to monitor
const WS_ENDPOINTS = [
    { path: '/ws/live', name: 'Live Tracking' },
    { path: '/ws/admin', name: 'Admin Notifications' },
    { path: '/ws/analytics', name: 'Real-time Analytics' }
];

class AIHealthSupervisor {
    constructor() {
        this.checks = new Map();
        this.issues = new Map();
        this.fixes = new Map();
        this.learnings = this.loadLearnings();
        this.stats = {
            totalChecks: 0,
            issuesDetected: 0,
            autoFixesApplied: 0,
            successfulFixes: 0,
            startTime: Date.now()
        };
    }

    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}\n`;

        console.log(`[AI-Supervisor] [${level}] ${message}`, data);

        try {
            fs.appendFileSync(CONFIG.logFile, logEntry);
        } catch (e) {
            // Ignore log errors
        }
    }

    loadLearnings() {
        try {
            if (fs.existsSync(CONFIG.learningsFile)) {
                return JSON.parse(fs.readFileSync(CONFIG.learningsFile, 'utf8'));
            }
        } catch (e) {
            this.log('WARN', 'Could not load learnings', { error: e.message });
        }
        return {
            fixPatterns: {},
            issueHistory: [],
            successRates: {}
        };
    }

    saveLearnings() {
        try {
            const dir = path.dirname(CONFIG.learningsFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(CONFIG.learningsFile, JSON.stringify(this.learnings, null, 2));
        } catch (e) {
            this.log('WARN', 'Could not save learnings', { error: e.message });
        }
    }

    // HTTP endpoint check - uses internal IP for reliable local checks
    async checkEndpoint(endpoint) {
        return new Promise((resolve) => {
            const start = Date.now();
            // Use internal IP (127.0.0.1) with HTTP for local health checks
            const checkHost = CONFIG.useInternal ? CONFIG.internalHost : CONFIG.host;
            const protocol = CONFIG.useInternal ? http : https;
            const url = CONFIG.useInternal
                ? `http://${checkHost}:${CONFIG.port}${endpoint.path}`
                : `https://${CONFIG.host}${endpoint.path}`;

            const req = protocol.get(url, { timeout: 10000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const latency = Date.now() - start;
                    let ok = res.statusCode === endpoint.expected.status;

                    if (ok && endpoint.expected.hasKey) {
                        try {
                            const json = JSON.parse(data);
                            ok = json.hasOwnProperty(endpoint.expected.hasKey);
                        } catch (e) {
                            ok = false;
                        }
                    }

                    resolve({
                        endpoint: endpoint.path,
                        ok,
                        statusCode: res.statusCode,
                        latency,
                        error: ok ? null : `Expected ${endpoint.expected.status}, got ${res.statusCode}`
                    });
                });
            });

            req.on('error', (e) => {
                resolve({
                    endpoint: endpoint.path,
                    ok: false,
                    statusCode: 0,
                    latency: Date.now() - start,
                    error: e.message
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    endpoint: endpoint.path,
                    ok: false,
                    statusCode: 0,
                    latency: 10000,
                    error: 'Timeout'
                });
            });
        });
    }

    // WebSocket connection check - uses internal IP for reliable local checks
    async checkWebSocket(wsEndpoint) {
        return new Promise((resolve) => {
            const start = Date.now();
            // Use internal IP (127.0.0.1) with ws:// for local WebSocket checks
            const url = CONFIG.useInternal
                ? `ws://${CONFIG.internalHost}:${CONFIG.port}${wsEndpoint.path}`
                : `wss://${CONFIG.host}${wsEndpoint.path}`;

            try {
                const ws = new WebSocket(url, { timeout: 5000 });

                ws.on('open', () => {
                    const latency = Date.now() - start;
                    ws.close();
                    resolve({
                        endpoint: wsEndpoint.path,
                        name: wsEndpoint.name,
                        ok: true,
                        latency,
                        error: null
                    });
                });

                ws.on('error', (e) => {
                    resolve({
                        endpoint: wsEndpoint.path,
                        name: wsEndpoint.name,
                        ok: false,
                        latency: Date.now() - start,
                        error: e.message
                    });
                });

                setTimeout(() => {
                    if (ws.readyState !== WebSocket.OPEN) {
                        ws.terminate();
                        resolve({
                            endpoint: wsEndpoint.path,
                            name: wsEndpoint.name,
                            ok: false,
                            latency: 5000,
                            error: 'Connection timeout'
                        });
                    }
                }, 5000);
            } catch (e) {
                resolve({
                    endpoint: wsEndpoint.path,
                    name: wsEndpoint.name,
                    ok: false,
                    latency: 0,
                    error: e.message
                });
            }
        });
    }

    // Detect issues from check results
    detectIssues(results) {
        const issues = [];

        for (const result of results) {
            if (!result.ok) {
                const issueId = `${result.endpoint}-${Date.now()}`;
                issues.push({
                    id: issueId,
                    type: result.endpoint.startsWith('/ws') ? 'websocket' : 'http',
                    endpoint: result.endpoint,
                    error: result.error,
                    latency: result.latency,
                    timestamp: Date.now()
                });

                this.issues.set(issueId, {
                    ...issues[issues.length - 1],
                    fixAttempts: 0,
                    lastFixAttempt: 0
                });
            }
        }

        return issues;
    }

    // Find best fix for an issue based on learnings
    findBestFix(issue) {
        const fixPattern = this.learnings.fixPatterns[issue.endpoint];

        if (fixPattern && fixPattern.successRate > 0.5) {
            return fixPattern.action;
        }

        // Default fixes based on issue type
        if (issue.type === 'websocket') {
            return 'restart-gateway';
        }

        if (issue.endpoint === '/health') {
            return 'restart-gateway';
        }

        if (issue.endpoint.includes('stripe')) {
            return 'check-env-vars';
        }

        return 'restart-gateway';
    }

    // Apply a fix
    async applyFix(issue, fixAction) {
        const issueData = this.issues.get(issue.id);

        if (!issueData) return { success: false, reason: 'Issue not found' };

        // Check cooldown
        if (Date.now() - issueData.lastFixAttempt < CONFIG.fixCooldown) {
            return { success: false, reason: 'Cooldown active' };
        }

        // Check max attempts
        if (issueData.fixAttempts >= CONFIG.maxFixAttempts) {
            this.log('WARN', 'Max fix attempts reached', { issue: issue.endpoint });
            return { success: false, reason: 'Max attempts reached' };
        }

        issueData.fixAttempts++;
        issueData.lastFixAttempt = Date.now();

        this.log('INFO', 'Applying fix', { issue: issue.endpoint, action: fixAction });
        this.stats.autoFixesApplied++;

        try {
            switch (fixAction) {
                case 'restart-gateway':
                    await this.restartGateway();
                    break;
                case 'check-env-vars':
                    await this.checkEnvVars();
                    break;
                default:
                    this.log('WARN', 'Unknown fix action', { action: fixAction });
                    return { success: false, reason: 'Unknown action' };
            }

            // Verify fix worked
            await new Promise(r => setTimeout(r, 5000)); // Wait for service to restart
            const verifyResult = await this.checkEndpoint({ path: issue.endpoint, method: 'GET', expected: { status: 200 } });

            if (verifyResult.ok) {
                this.stats.successfulFixes++;
                this.recordLearning(issue.endpoint, fixAction, true);
                this.issues.delete(issue.id);
                this.log('INFO', 'Fix successful', { issue: issue.endpoint, action: fixAction });
                return { success: true };
            } else {
                this.recordLearning(issue.endpoint, fixAction, false);
                return { success: false, reason: 'Verification failed' };
            }
        } catch (e) {
            this.log('ERROR', 'Fix failed', { issue: issue.endpoint, error: e.message });
            return { success: false, reason: e.message };
        }
    }

    // Restart gateway via PM2
    async restartGateway() {
        return new Promise((resolve, reject) => {
            exec('pm2 restart doz-gateway --update-env', { cwd: 'C:\\DOZ UP' }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    this.log('INFO', 'Gateway restarted', { stdout: stdout.trim() });
                    resolve();
                }
            });
        });
    }

    // Check environment variables
    async checkEnvVars() {
        const required = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            this.log('WARN', 'Missing environment variables', { missing });
        }

        return missing.length === 0;
    }

    // Record learning from fix attempt
    recordLearning(endpoint, action, success) {
        if (!this.learnings.fixPatterns[endpoint]) {
            this.learnings.fixPatterns[endpoint] = {
                action,
                attempts: 0,
                successes: 0,
                successRate: 0
            };
        }

        const pattern = this.learnings.fixPatterns[endpoint];
        pattern.attempts++;
        if (success) pattern.successes++;
        pattern.successRate = pattern.successes / pattern.attempts;
        pattern.lastUsed = Date.now();

        this.learnings.issueHistory.push({
            endpoint,
            action,
            success,
            timestamp: Date.now()
        });

        // Keep only last 1000 entries
        if (this.learnings.issueHistory.length > 1000) {
            this.learnings.issueHistory = this.learnings.issueHistory.slice(-1000);
        }

        this.saveLearnings();
    }

    // Main health cycle
    async runHealthCycle() {
        this.stats.totalChecks++;
        this.log('INFO', 'Starting health cycle', { cycle: this.stats.totalChecks });

        // 1. Check all HTTP endpoints
        const httpResults = await Promise.all(ENDPOINTS.map(ep => this.checkEndpoint(ep)));

        // 2. Check all WebSocket endpoints
        const wsResults = await Promise.all(WS_ENDPOINTS.map(ws => this.checkWebSocket(ws)));

        // 3. Combine results
        const allResults = [...httpResults, ...wsResults];
        const healthyCount = allResults.filter(r => r.ok).length;
        const totalCount = allResults.length;

        this.log('INFO', 'Health check complete', {
            healthy: healthyCount,
            total: totalCount,
            percentage: Math.round((healthyCount / totalCount) * 100)
        });

        // 4. Detect issues
        const issues = this.detectIssues(allResults);
        this.stats.issuesDetected += issues.length;

        if (issues.length > 0) {
            this.log('WARN', 'Issues detected', { count: issues.length, issues: issues.map(i => i.endpoint) });

            // 5. Apply fixes
            for (const issue of issues) {
                const fix = this.findBestFix(issue);
                if (fix) {
                    await this.applyFix(issue, fix);
                }
            }
        }

        // 6. Report stats
        this.reportStats();
    }

    reportStats() {
        const uptime = Math.round((Date.now() - this.stats.startTime) / 1000 / 60);
        const fixRate = this.stats.autoFixesApplied > 0
            ? Math.round((this.stats.successfulFixes / this.stats.autoFixesApplied) * 100)
            : 100;

        this.log('STATS', 'Supervisor statistics', {
            uptime: `${uptime} minutes`,
            totalChecks: this.stats.totalChecks,
            issuesDetected: this.stats.issuesDetected,
            autoFixesApplied: this.stats.autoFixesApplied,
            successfulFixes: this.stats.successfulFixes,
            fixSuccessRate: `${fixRate}%`,
            activeIssues: this.issues.size,
            learnedPatterns: Object.keys(this.learnings.fixPatterns).length
        });
    }

    // Start the supervisor
    start() {
        this.log('INFO', 'AI Health Supervisor starting', {
            checkInterval: CONFIG.checkInterval,
            host: CONFIG.host
        });

        // Run immediately
        this.runHealthCycle();

        // Then run on interval
        setInterval(() => this.runHealthCycle(), CONFIG.checkInterval);

        // Detailed endpoint test less frequently
        setInterval(() => this.runDetailedEndpointTest(), CONFIG.endpointTestInterval);
    }

    // Detailed endpoint testing
    async runDetailedEndpointTest() {
        this.log('INFO', 'Running detailed endpoint test');

        const criticalEndpoints = [
            { path: '/api/stripe/create-checkout', method: 'POST', body: { test: true } },
            { path: '/api/stripe/webhook', method: 'POST', body: {} }
        ];

        for (const ep of criticalEndpoints) {
            const result = await this.checkEndpoint({ ...ep, expected: { status: 200 } });
            if (!result.ok) {
                this.log('WARN', 'Critical endpoint failing', { endpoint: ep.path, error: result.error });
            }
        }
    }
}

// Create status endpoint
const statusServer = http.createServer((req, res) => {
    if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'running',
            stats: supervisor.stats,
            activeIssues: Array.from(supervisor.issues.values()),
            learnings: {
                patterns: Object.keys(supervisor.learnings.fixPatterns).length,
                historySize: supervisor.learnings.issueHistory.length
            }
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Start
const supervisor = new AIHealthSupervisor();

statusServer.listen(3011, () => {
    console.log('AI Supervisor status endpoint at port 3011 (up.doz.com)');
});

supervisor.start();

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           AI HEALTH SUPERVISOR - STARTED                       ║
╠════════════════════════════════════════════════════════════════╣
║  Monitoring:  ${CONFIG.host}                                   ║
║  Check Interval: ${CONFIG.checkInterval / 1000}s                                      ║
║  Status: https://up.doz.com:3011/status                         ║
║                                                                ║
║  Endpoints Monitored: ${ENDPOINTS.length} HTTP + ${WS_ENDPOINTS.length} WebSocket               ║
║  Auto-Fix: Enabled                                             ║
║  Self-Learning: Enabled                                        ║
╚════════════════════════════════════════════════════════════════╝
`);
