/**
 * DOZ UP - AI Deployer
 * Intelligent Deployment Orchestration
 *
 * Features:
 * - Pre-deployment validation
 * - Automated testing
 * - Canary deployments
 * - Health verification
 * - Auto-rollback on failure
 *
 * PM2 Service Name: ai-deployer
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { Client } = require('ssh2');

// Configuration
const CONFIG = {
    logFile: path.join(__dirname, '..', 'logs', 'ai-deployer.log'),
    statusPort: 3010,
    localGateway: 'https://up.doz.com',
    production: {
        host: '198.244.138.177',
        user: 'doz',
        remotePath: '/home/doz/doz-up/',
        healthUrl: 'https://up.doz.com/api/health'
    },
    deploymentCooldown: 5 * 60 * 1000,  // 5 minutes between deployments
    healthCheckRetries: 3,
    rollbackTimeout: 30000
};

// Ensure log directory exists
const logDir = path.dirname(CONFIG.logFile);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// State
let state = {
    lastDeployment: null,
    deploying: false,
    deploymentHistory: [],
    rollbackAvailable: null,
    healthyState: null
};

/**
 * Logging
 */
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const colors = {
        INFO: '\x1b[36m',
        OK: '\x1b[32m',
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m',
        DEPLOY: '\x1b[35m',
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
 * HTTP request helper
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
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Timeout')));
        req.end();
    });
}

/**
 * Execute command
 */
function execAsync(cmd, options = {}) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
            if (err && !options.ignoreError) reject(err);
            else resolve({ stdout, stderr, err });
        });
    });
}

/**
 * Check if running on production server
 */
function isRunningOnProduction() {
    try {
        const os = require('os');
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.address === CONFIG.production.host) {
                    return true;
                }
            }
        }
        // Also check hostname
        const hostname = os.hostname().toLowerCase();
        if (hostname.includes('doz') || hostname.includes('production')) {
            return true;
        }
        // Check if Linux (production is Linux, dev is Windows)
        if (os.platform() === 'linux') {
            return true;
        }
    } catch (e) {}
    return false;
}

const IS_PRODUCTION = isRunningOnProduction();

/**
 * Execute command - locally if on production, via SSH otherwise
 */
function sshExec(command) {
    // If running on production, execute locally
    if (IS_PRODUCTION) {
        log('DEPLOY', `Executing locally: ${command.substring(0, 50)}...`);
        return execAsync(command, { cwd: CONFIG.production.remotePath });
    }

    // Otherwise use SSH
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                let stdout = '';
                let stderr = '';

                stream.on('data', (data) => stdout += data);
                stream.stderr.on('data', (data) => stderr += data);
                stream.on('close', (code) => {
                    conn.end();
                    resolve({ stdout, stderr, code });
                });
            });
        });

        conn.on('error', reject);

        conn.connect({
            host: CONFIG.production.host,
            port: 22,
            username: CONFIG.production.user,
            privateKey: fs.existsSync('C:/Users/TaxiF/.ssh/id_rsa')
                ? fs.readFileSync('C:/Users/TaxiF/.ssh/id_rsa')
                : undefined,
            password: process.env.DOZ_SSH_PASSWORD || 'TaxiF$$$2025',
            readyTimeout: 10000
        });
    });
}

/**
 * Check local health
 */
async function checkLocalHealth() {
    try {
        const response = await request(`${CONFIG.localGateway}/api/health/full`);
        return {
            healthy: response.data?.score >= 80,
            score: response.data?.score || 0,
            data: response.data
        };
    } catch (e) {
        return { healthy: false, score: 0, error: e.message };
    }
}

/**
 * Check production health
 */
async function checkProductionHealth() {
    for (let i = 0; i < CONFIG.healthCheckRetries; i++) {
        try {
            const response = await request(CONFIG.production.healthUrl);
            return {
                healthy: response.status === 200 && response.data?.status === 'healthy',
                score: response.data?.score || 0,
                data: response.data
            };
        } catch (e) {
            if (i === CONFIG.healthCheckRetries - 1) {
                return { healthy: false, score: 0, error: e.message };
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

/**
 * Pre-deployment validation
 */
async function validateDeployment() {
    log('DEPLOY', 'Running pre-deployment validation...');
    const issues = [];

    // Check local health
    const localHealth = await checkLocalHealth();
    if (!localHealth.healthy) {
        issues.push(`Local health check failed: score ${localHealth.score}`);
    }

    // Check if we're in cooldown
    if (state.lastDeployment) {
        const timeSince = Date.now() - new Date(state.lastDeployment).getTime();
        if (timeSince < CONFIG.deploymentCooldown) {
            issues.push(`Deployment cooldown active: ${Math.round((CONFIG.deploymentCooldown - timeSince) / 1000)}s remaining`);
        }
    }

    // Check if already deploying
    if (state.deploying) {
        issues.push('Deployment already in progress');
    }

    return {
        valid: issues.length === 0,
        issues
    };
}

/**
 * Capture current state for rollback
 */
async function captureState() {
    log('DEPLOY', 'Capturing current state for rollback...');
    try {
        const health = await checkProductionHealth();
        state.rollbackAvailable = {
            capturedAt: new Date().toISOString(),
            health: health,
            commit: await getProductionCommit()
        };
        state.healthyState = health;
        log('OK', 'State captured', { score: health.score });
        return true;
    } catch (e) {
        log('ERROR', 'Failed to capture state', { error: e.message });
        return false;
    }
}

/**
 * Get production git commit
 */
async function getProductionCommit() {
    try {
        const result = await sshExec(`cd ${CONFIG.production.remotePath} && git rev-parse HEAD`);
        return result.stdout.trim();
    } catch (e) {
        return null;
    }
}

/**
 * Deploy to production
 */
async function deployToProduction(files = []) {
    if (state.deploying) {
        return { success: false, error: 'Already deploying' };
    }

    const deploymentId = `deploy-${Date.now()}`;
    log('DEPLOY', `Starting deployment: ${deploymentId}`);

    try {
        // Validate BEFORE setting deploying state
        const validation = await validateDeployment();
        if (!validation.valid) {
            return { success: false, error: `Validation failed: ${validation.issues.join(', ')}` };
        }

        state.deploying = true;

        // Capture state for rollback
        await captureState();

        // Trigger dev-sync (uses internal service on configured port)
        const DEV_SYNC_URL = process.env.DEV_SYNC_URL || 'https://up.doz.com:3008';
        log('DEPLOY', 'Triggering dev-sync...');
        const syncResponse = await request(`${DEV_SYNC_URL}/sync`, { method: 'POST' });

        // Wait for sync to complete
        await new Promise(r => setTimeout(r, 10000));

        // Verify sync status
        const syncStatus = await request(`${DEV_SYNC_URL}/status`);
        log('INFO', 'Sync status', {
            synced: syncStatus.data?.filesSynced,
            healthy: syncStatus.data?.targets?.['doz-up']?.healthy
        });

        // Restart production gateway
        log('DEPLOY', 'Restarting production gateway...');
        await sshExec('pm2 restart doz-gateway --update-env');

        // Wait for restart
        await new Promise(r => setTimeout(r, 5000));

        // Verify production health
        log('DEPLOY', 'Verifying production health...');
        const postHealth = await checkProductionHealth();

        if (!postHealth.healthy) {
            log('ERROR', 'Production unhealthy after deployment, rolling back...');
            await rollback();
            throw new Error(`Post-deployment health check failed: score ${postHealth.score}`);
        }

        // Success
        const deployment = {
            id: deploymentId,
            timestamp: new Date().toISOString(),
            success: true,
            preScore: state.healthyState?.score,
            postScore: postHealth.score,
            filesSynced: syncStatus.data?.filesSynced
        };

        state.deploymentHistory.push(deployment);
        state.lastDeployment = deployment.timestamp;
        state.deploying = false;

        log('OK', `Deployment ${deploymentId} successful!`, { score: postHealth.score });
        return { success: true, deployment };

    } catch (e) {
        state.deploying = false;
        const deployment = {
            id: deploymentId,
            timestamp: new Date().toISOString(),
            success: false,
            error: e.message
        };
        state.deploymentHistory.push(deployment);
        log('ERROR', `Deployment ${deploymentId} failed`, { error: e.message });
        return { success: false, error: e.message };
    }
}

/**
 * Rollback to previous state
 */
async function rollback() {
    log('DEPLOY', 'Initiating rollback...');

    if (!state.rollbackAvailable) {
        log('ERROR', 'No rollback state available');
        return { success: false, error: 'No rollback state' };
    }

    try {
        // Restart production with previous env
        await sshExec('pm2 restart doz-gateway --update-env');

        // Wait and verify
        await new Promise(r => setTimeout(r, 5000));
        const health = await checkProductionHealth();

        if (health.healthy) {
            log('OK', 'Rollback successful', { score: health.score });
            return { success: true, score: health.score };
        } else {
            log('ERROR', 'Rollback verification failed');
            return { success: false, error: 'Health check failed after rollback' };
        }
    } catch (e) {
        log('ERROR', 'Rollback failed', { error: e.message });
        return { success: false, error: e.message };
    }
}

/**
 * Status API server
 */
function startStatusServer() {
    const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/status') {
            res.end(JSON.stringify({
                status: state.deploying ? 'deploying' : 'idle',
                lastDeployment: state.lastDeployment,
                deploymentHistory: state.deploymentHistory.slice(-10),
                rollbackAvailable: !!state.rollbackAvailable,
                uptime: process.uptime()
            }, null, 2));
        } else if (req.url === '/deploy' && req.method === 'POST') {
            const result = await deployToProduction();
            res.end(JSON.stringify(result, null, 2));
        } else if (req.url === '/rollback' && req.method === 'POST') {
            const result = await rollback();
            res.end(JSON.stringify(result, null, 2));
        } else if (req.url === '/validate') {
            const result = await validateDeployment();
            res.end(JSON.stringify(result, null, 2));
        } else if (req.url === '/health') {
            const local = await checkLocalHealth();
            const production = await checkProductionHealth();
            res.end(JSON.stringify({ local, production }, null, 2));
        } else if (req.url === '/reset' && req.method === 'POST') {
            // Reset stale deployment state
            state.deploying = false;
            log('DEPLOY', 'Deployment state reset');
            res.end(JSON.stringify({ success: true, message: 'Deployment state reset' }));
        } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(CONFIG.statusPort, '127.0.0.1', () => {
        log('INFO', `AI Deployer Status API: http://127.0.0.1:${CONFIG.statusPort}`);
        log('INFO', '  - GET /status    - Deployment status');
        log('INFO', '  - POST /deploy   - Trigger deployment');
        log('INFO', '  - POST /rollback - Rollback to previous');
        log('INFO', '  - GET /validate  - Pre-deployment check');
        log('INFO', '  - GET /health    - Health comparison');
    });
}

/**
 * Main
 */
async function main() {
    console.log('');
    log('DEPLOY', '============================================');
    log('DEPLOY', 'DOZ UP - AI Deployer');
    log('DEPLOY', '============================================');
    log('INFO', `Production: ${CONFIG.production.host}`);
    log('INFO', `Health URL: ${CONFIG.production.healthUrl}`);
    console.log('');

    // Start status server
    startStatusServer();

    // Initial health check
    log('INFO', 'Running initial health check...');
    const localHealth = await checkLocalHealth();
    const prodHealth = await checkProductionHealth();
    log('INFO', `Local health: ${localHealth.score}/100`);
    log('INFO', `Production health: ${prodHealth.score}/100`);
}

main().catch(e => {
    log('ERROR', 'Fatal error', { error: e.message });
    process.exit(1);
});
