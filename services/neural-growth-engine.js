/**
 * DOZ UP - Neural Growth Engine
 * Central AI Brain for Autonomous Development
 *
 * This service coordinates all AI systems and enables:
 * - Self-learning from fixes and deployments
 * - Predictive issue detection
 * - Autonomous code improvements
 * - Continuous evolution of capabilities
 *
 * PM2 Service Name: neural-growth
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

// Configuration
const CONFIG = {
    knowledgeFile: path.join(__dirname, '..', 'data', 'ai-knowledge.json'),
    logFile: path.join(__dirname, '..', 'logs', 'neural-growth.log'),
    checkInterval: 5 * 60 * 1000,        // 5 minutes
    learningInterval: 30 * 60 * 1000,    // 30 minutes
    reportInterval: 60 * 60 * 1000,      // 1 hour
    localGateway: 'https://up.doz.com',
    productionGateway: 'https://up.doz.com',
    statusPort: 3009
};

// Ensure directories exist
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
ensureDir(path.dirname(CONFIG.logFile));

// State
let knowledge = loadKnowledge();
let state = {
    running: true,
    lastCheck: null,
    lastLearning: null,
    lastReport: null,
    activeGoals: [],
    pendingActions: [],
    healthTrend: [],
    errorTrend: []
};

/**
 * Logging with timestamp
 */
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const colors = {
        INFO: '\x1b[36m',
        OK: '\x1b[32m',
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m',
        BRAIN: '\x1b[35m',
        RESET: '\x1b[0m'
    };
    const color = colors[level] || colors.INFO;
    const entry = `${color}[${timestamp}] [${level}] ${message}${colors.RESET}${data ? ' ' + JSON.stringify(data) : ''}`;
    console.log(entry);

    try {
        fs.appendFileSync(CONFIG.logFile, `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
    } catch (e) {}
}

/**
 * Load knowledge base
 */
function loadKnowledge() {
    try {
        if (fs.existsSync(CONFIG.knowledgeFile)) {
            return JSON.parse(fs.readFileSync(CONFIG.knowledgeFile, 'utf8'));
        }
    } catch (e) {
        log('WARN', 'Failed to load knowledge base, using defaults', { error: e.message });
    }
    return {
        version: '1.0.0',
        fixes: { successful: [], failed: [], patterns: {} },
        deployments: { history: [], successRate: 0 },
        performance: { benchmarks: {}, optimizations: [] },
        errors: { recurring: {}, resolved: {} },
        learnings: { codePatterns: {}, bestPractices: [] },
        metrics: { totalAutoFixes: 0, totalDeployments: 0, healthScore: 100 },
        goals: { current: [], completed: [] },
        evolution: { generation: 1, improvements: [], capabilities: [] }
    };
}

/**
 * Save knowledge base
 */
function saveKnowledge() {
    try {
        knowledge.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CONFIG.knowledgeFile, JSON.stringify(knowledge, null, 2));
    } catch (e) {
        log('ERROR', 'Failed to save knowledge', { error: e.message });
    }
}

/**
 * Make HTTP request
 */
function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000,
            rejectUnauthorized: false
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        if (options.body) req.write(options.body);
        req.end();
    });
}

/**
 * Execute command
 */
function execAsync(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
        });
    });
}

/**
 * Gather system intelligence
 */
async function gatherIntelligence() {
    log('BRAIN', '=== Gathering System Intelligence ===');
    const intel = {
        timestamp: new Date().toISOString(),
        health: null,
        aiStatus: null,
        devSync: null,
        pm2: null,
        errors: []
    };

    try {
        // Health check
        const health = await request(`${CONFIG.localGateway}/api/health/full`);
        intel.health = health.data;
        log('INFO', `Health score: ${health.data?.score || 'unknown'}/100`);

        // AI interceptor status
        const aiStatus = await request(`${CONFIG.localGateway}/api/ai/interceptor/status`);
        intel.aiStatus = aiStatus.data;
        log('INFO', `AI Interceptor: ${aiStatus.data?.stats?.totalFixed || 0} auto-fixes`);

        // Dev-sync status
        const DEV_SYNC_URL = process.env.DEV_SYNC_URL || 'https://up.doz.com:3008';
        try {
            const devSync = await request(`${DEV_SYNC_URL}/status`);
            intel.devSync = devSync.data;
            log('INFO', `Dev-Sync: ${devSync.data?.filesSynced || 0} files synced`);
        } catch (e) {
            intel.devSync = { status: 'unavailable' };
        }

        // PM2 status
        try {
            const pm2Result = await execAsync('pm2 jlist');
            intel.pm2 = JSON.parse(pm2Result.stdout);
            log('INFO', `PM2: ${intel.pm2.length} processes`);
        } catch (e) {
            intel.pm2 = [];
        }

    } catch (e) {
        log('ERROR', 'Intelligence gathering failed', { error: e.message });
        intel.errors.push(e.message);
    }

    return intel;
}

/**
 * Analyze patterns and learn
 */
function analyzeAndLearn(intel) {
    log('BRAIN', '=== Analyzing Patterns ===');

    // Track health trend
    if (intel.health?.score) {
        state.healthTrend.push({
            timestamp: intel.timestamp,
            score: intel.health.score
        });
        // Keep last 100 data points
        if (state.healthTrend.length > 100) {
            state.healthTrend = state.healthTrend.slice(-100);
        }
    }

    // Learn from AI interceptor
    if (intel.aiStatus?.stats) {
        const stats = intel.aiStatus.stats;
        knowledge.metrics.totalAutoFixes = stats.totalAutoFixed || 0;

        // Record successful fix patterns
        if (intel.aiStatus.recentFixes) {
            for (const fix of intel.aiStatus.recentFixes) {
                if (fix.success) {
                    const pattern = `${fix.category}:${fix.fix}`;
                    knowledge.fixes.patterns[pattern] = (knowledge.fixes.patterns[pattern] || 0) + 1;
                }
            }
        }
    }

    // Learn from deployments
    if (intel.devSync?.filesSynced) {
        knowledge.metrics.totalDeployments = intel.devSync.syncCount || 0;
        if (intel.devSync.healthy) {
            knowledge.deployments.successRate = Math.round(
                (knowledge.deployments.successRate * 0.9) + (100 * 0.1)
            );
        }
    }

    // Detect degradation trends
    if (state.healthTrend.length >= 5) {
        const recent = state.healthTrend.slice(-5);
        const avgScore = recent.reduce((a, b) => a + b.score, 0) / 5;
        if (avgScore < 90) {
            log('WARN', 'Health degradation detected', { avgScore });
            knowledge.goals.current.push({
                type: 'fix_degradation',
                priority: 'high',
                createdAt: new Date().toISOString(),
                context: { avgScore, trend: recent }
            });
        }
    }

    // Update metrics
    knowledge.metrics.healthScore = intel.health?.score || knowledge.metrics.healthScore;

    saveKnowledge();
    log('BRAIN', 'Learning complete', {
        patterns: Object.keys(knowledge.fixes.patterns).length,
        deployments: knowledge.metrics.totalDeployments,
        healthScore: knowledge.metrics.healthScore
    });
}

/**
 * Decide on autonomous actions
 */
async function decideActions(intel) {
    log('BRAIN', '=== Decision Making ===');
    const actions = [];

    // Check if services need restart
    if (intel.pm2) {
        for (const proc of intel.pm2) {
            if (proc.pm2_env?.status !== 'online') {
                actions.push({
                    type: 'restart_service',
                    service: proc.name,
                    reason: `Status: ${proc.pm2_env?.status}`
                });
            }
            // Check memory usage
            const memMB = (proc.monit?.memory || 0) / 1024 / 1024;
            if (memMB > 500) {
                actions.push({
                    type: 'restart_service',
                    service: proc.name,
                    reason: `High memory: ${Math.round(memMB)}MB`
                });
            }
        }
    }

    // Check if health score is low
    if (intel.health?.score < 80) {
        actions.push({
            type: 'trigger_healing',
            reason: `Low health score: ${intel.health.score}`
        });
    }

    // Check for failing pages
    if (intel.health?.checks?.pages?.failed > 0) {
        actions.push({
            type: 'investigate_pages',
            pages: intel.health.checks.pages.failedList,
            reason: `${intel.health.checks.pages.failed} pages failing`
        });
    }

    return actions;
}

/**
 * Execute autonomous actions
 */
async function executeActions(actions) {
    if (actions.length === 0) {
        log('INFO', 'No actions needed');
        return;
    }

    log('BRAIN', `Executing ${actions.length} autonomous actions`);

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'restart_service':
                    log('BRAIN', `Restarting ${action.service}`, { reason: action.reason });
                    await execAsync(`pm2 restart ${action.service}`);
                    knowledge.fixes.successful.push({
                        type: 'service_restart',
                        target: action.service,
                        timestamp: new Date().toISOString()
                    });
                    break;

                case 'trigger_healing':
                    log('BRAIN', 'Triggering self-healing', { reason: action.reason });
                    await request(`${CONFIG.localGateway}/api/diagnostics`);
                    break;

                case 'investigate_pages':
                    log('BRAIN', 'Investigating failing pages', { pages: action.pages });
                    // Record for future analysis
                    knowledge.errors.recurring['page_failures'] = {
                        pages: action.pages,
                        lastSeen: new Date().toISOString(),
                        count: (knowledge.errors.recurring['page_failures']?.count || 0) + 1
                    };
                    break;
            }
        } catch (e) {
            log('ERROR', `Action failed: ${action.type}`, { error: e.message });
            knowledge.fixes.failed.push({
                type: action.type,
                error: e.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    saveKnowledge();
}

/**
 * Generate progress report
 */
function generateReport() {
    log('BRAIN', '=== Generating Progress Report ===');

    const report = {
        timestamp: new Date().toISOString(),
        generation: knowledge.evolution.generation,
        metrics: {
            healthScore: knowledge.metrics.healthScore,
            totalAutoFixes: knowledge.metrics.totalAutoFixes,
            totalDeployments: knowledge.metrics.totalDeployments,
            deploymentSuccessRate: knowledge.deployments.successRate,
            learnedPatterns: Object.keys(knowledge.fixes.patterns).length
        },
        recentActivity: {
            successfulFixes: knowledge.fixes.successful.slice(-10),
            failedFixes: knowledge.fixes.failed.slice(-5)
        },
        capabilities: knowledge.evolution.capabilities,
        healthTrend: state.healthTrend.slice(-10),
        activeGoals: knowledge.goals.current.length
    };

    log('BRAIN', '=== AUTONOMOUS DEVELOPMENT REPORT ===');
    log('INFO', `Generation: ${report.generation}`);
    log('INFO', `Health Score: ${report.metrics.healthScore}/100`);
    log('INFO', `Auto-Fixes Applied: ${report.metrics.totalAutoFixes}`);
    log('INFO', `Deployments: ${report.metrics.totalDeployments} (${report.metrics.deploymentSuccessRate}% success)`);
    log('INFO', `Learned Patterns: ${report.metrics.learnedPatterns}`);
    log('INFO', `Active Goals: ${report.activeGoals}`);
    log('BRAIN', '=====================================');

    // Save report
    try {
        const reportsDir = path.join(__dirname, '..', 'logs', 'reports');
        ensureDir(reportsDir);
        const reportFile = path.join(reportsDir, `report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    } catch (e) {}

    return report;
}

/**
 * Evolution - improve self over time
 */
function evolve() {
    log('BRAIN', '=== Evolution Check ===');

    // Check if we should evolve
    const successfulFixes = knowledge.fixes.successful.length;
    const threshold = knowledge.evolution.generation * 10;

    if (successfulFixes >= threshold) {
        knowledge.evolution.generation++;
        knowledge.evolution.improvements.push({
            generation: knowledge.evolution.generation,
            timestamp: new Date().toISOString(),
            trigger: `${successfulFixes} successful fixes`
        });
        log('BRAIN', `EVOLVED to Generation ${knowledge.evolution.generation}!`);
        saveKnowledge();
    }
}

/**
 * Main check cycle
 */
async function runCheckCycle() {
    if (!state.running) return;

    log('BRAIN', '========== Neural Growth Cycle Started ==========');
    state.lastCheck = new Date().toISOString();

    try {
        // Gather intelligence
        const intel = await gatherIntelligence();

        // Analyze and learn
        analyzeAndLearn(intel);

        // Decide on actions
        const actions = await decideActions(intel);

        // Execute actions
        await executeActions(actions);

        // Check for evolution
        evolve();

    } catch (e) {
        log('ERROR', 'Check cycle failed', { error: e.message });
    }

    log('BRAIN', '========== Neural Growth Cycle Complete ==========');
}

/**
 * Status API server
 */
function startStatusServer() {
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/status') {
            res.end(JSON.stringify({
                status: 'running',
                generation: knowledge.evolution.generation,
                lastCheck: state.lastCheck,
                metrics: knowledge.metrics,
                healthTrend: state.healthTrend.slice(-10),
                capabilities: knowledge.evolution.capabilities,
                uptime: process.uptime()
            }, null, 2));
        } else if (req.url === '/knowledge') {
            res.end(JSON.stringify(knowledge, null, 2));
        } else if (req.url === '/report') {
            res.end(JSON.stringify(generateReport(), null, 2));
        } else if (req.url === '/evolve' && req.method === 'POST') {
            evolve();
            res.end(JSON.stringify({ success: true, generation: knowledge.evolution.generation }));
        } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(CONFIG.statusPort, '127.0.0.1', () => {
        log('INFO', `Neural Growth Engine Status API: http://127.0.0.1:${CONFIG.statusPort}`);
        log('INFO', '  - GET /status   - Current status');
        log('INFO', '  - GET /knowledge - Full knowledge base');
        log('INFO', '  - GET /report   - Generate report');
        log('INFO', '  - POST /evolve  - Force evolution');
    });
}

/**
 * Main entry point
 */
async function main() {
    console.log('');
    log('BRAIN', '============================================');
    log('BRAIN', 'DOZ UP - Neural Growth Engine');
    log('BRAIN', '============================================');
    log('INFO', `Generation: ${knowledge.evolution.generation}`);
    log('INFO', `Capabilities: ${knowledge.evolution.capabilities.join(', ')}`);
    log('INFO', `Check interval: ${CONFIG.checkInterval / 1000}s`);
    console.log('');

    // Start status server
    startStatusServer();

    // Initial check
    await runCheckCycle();

    // Schedule regular checks
    setInterval(runCheckCycle, CONFIG.checkInterval);

    // Schedule reports
    setInterval(generateReport, CONFIG.reportInterval);

    // Generate initial report
    generateReport();
}

// Start
main().catch(e => {
    log('ERROR', 'Fatal error', { error: e.message });
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Neural Growth Engine...');
    state.running = false;
    saveKnowledge();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Neural Growth Engine...');
    state.running = false;
    saveKnowledge();
    process.exit(0);
});
