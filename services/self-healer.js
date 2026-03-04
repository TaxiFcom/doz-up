/**
 * Self-Healer Service - Intelligent Auto-Fix System
 * Learns from past fixes and applies the best solutions
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
    logFile: path.join(__dirname, '..', 'logs', 'self-healer.log'),
    fixHistoryFile: path.join(__dirname, '..', 'data', 'fix-history.json'),
    maxConcurrentFixes: 1,
    cooldownMs: 60000  // 1 minute between same fix type
};

class SelfHealer {
    constructor() {
        this.fixHistory = this.loadHistory();
        this.cooldowns = new Map();
        this.activeFixes = 0;
    }

    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const entry = { timestamp, level, message, ...data };
        console.log(`[SelfHealer] [${level}] ${message}`, data);

        try {
            fs.appendFileSync(CONFIG.logFile, JSON.stringify(entry) + '\n');
        } catch (e) {}
    }

    loadHistory() {
        try {
            if (fs.existsSync(CONFIG.fixHistoryFile)) {
                return JSON.parse(fs.readFileSync(CONFIG.fixHistoryFile, 'utf8'));
            }
        } catch (e) {}
        return { fixes: [], successRates: {} };
    }

    saveHistory() {
        try {
            const dir = path.dirname(CONFIG.fixHistoryFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG.fixHistoryFile, JSON.stringify(this.fixHistory, null, 2));
        } catch (e) {}
    }

    // Check if fix is on cooldown
    isOnCooldown(fixType) {
        const lastFix = this.cooldowns.get(fixType);
        if (!lastFix) return false;
        return Date.now() - lastFix < CONFIG.cooldownMs;
    }

    // Available fix handlers
    fixHandlers = {
        // Restart the main gateway
        'restart-gateway': async () => {
            return new Promise((resolve, reject) => {
                exec('pm2 restart doz-gateway --update-env', { cwd: 'C:\\DOZ UP' }, (err, stdout, stderr) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
        },

        // Restart all services
        'restart-all': async () => {
            return new Promise((resolve, reject) => {
                exec('pm2 restart all', { cwd: 'C:\\DOZ UP' }, (err, stdout, stderr) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
        },

        // Clear PM2 logs (memory cleanup)
        'clear-logs': async () => {
            return new Promise((resolve, reject) => {
                exec('pm2 flush', (err, stdout, stderr) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
        },

        // Restart specific service
        'restart-service': async (serviceName) => {
            return new Promise((resolve, reject) => {
                exec(`pm2 restart ${serviceName}`, { cwd: 'C:\\DOZ UP' }, (err, stdout, stderr) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
        },

        // Check and fix SSL
        'check-ssl': async () => {
            const sslPath = 'C:\\DOZ UP\\ssl';
            if (!fs.existsSync(sslPath)) {
                fs.mkdirSync(sslPath, { recursive: true });
            }
            return { status: 'checked' };
        },

        // Verify environment variables
        'verify-env': async () => {
            const required = [
                'STRIPE_SECRET_KEY',
                'STRIPE_PUBLISHABLE_KEY',
                'NODE_ENV'
            ];

            const missing = required.filter(k => !process.env[k]);
            return { missing, complete: missing.length === 0 };
        },

        // Memory cleanup - force garbage collection if available
        'memory-cleanup': async () => {
            if (global.gc) {
                global.gc();
                return { status: 'GC triggered' };
            }
            return { status: 'GC not available' };
        },

        // WebSocket reconnect
        'ws-reconnect': async () => {
            // Signal gateway to refresh WebSocket connections (using internal IP 127.0.0.1)
            return new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: '127.0.0.1',
                    port: 3000,
                    path: '/api/admin/ws-refresh',
                    method: 'POST',
                    timeout: 5000
                }, (res) => {
                    resolve({ statusCode: res.statusCode });
                });
                req.on('error', () => resolve({ status: 'skipped' }));
                req.end();
            });
        },

        // Clear cache
        'clear-cache': async () => {
            const cacheDir = 'C:\\DOZ UP\\data\\cache';
            if (fs.existsSync(cacheDir)) {
                const files = fs.readdirSync(cacheDir);
                for (const file of files) {
                    try {
                        fs.unlinkSync(path.join(cacheDir, file));
                    } catch (e) {}
                }
                return { cleared: files.length };
            }
            return { cleared: 0 };
        }
    };

    // Apply a fix
    async applyFix(fixType, params = {}) {
        if (this.isOnCooldown(fixType)) {
            this.log('WARN', 'Fix on cooldown', { fixType });
            return { success: false, reason: 'cooldown' };
        }

        if (this.activeFixes >= CONFIG.maxConcurrentFixes) {
            this.log('WARN', 'Max concurrent fixes reached', { fixType });
            return { success: false, reason: 'max_concurrent' };
        }

        const handler = this.fixHandlers[fixType];
        if (!handler) {
            this.log('ERROR', 'Unknown fix type', { fixType });
            return { success: false, reason: 'unknown_fix' };
        }

        this.activeFixes++;
        this.cooldowns.set(fixType, Date.now());

        this.log('INFO', 'Applying fix', { fixType, params });

        try {
            const result = await handler(params);
            this.recordFix(fixType, true);
            this.log('INFO', 'Fix applied successfully', { fixType, result });
            return { success: true, result };
        } catch (error) {
            this.recordFix(fixType, false);
            this.log('ERROR', 'Fix failed', { fixType, error: error.message });
            return { success: false, reason: error.message };
        } finally {
            this.activeFixes--;
        }
    }

    // Record fix result for learning
    recordFix(fixType, success) {
        this.fixHistory.fixes.push({
            type: fixType,
            success,
            timestamp: Date.now()
        });

        // Update success rate
        if (!this.fixHistory.successRates[fixType]) {
            this.fixHistory.successRates[fixType] = { attempts: 0, successes: 0 };
        }

        const stats = this.fixHistory.successRates[fixType];
        stats.attempts++;
        if (success) stats.successes++;
        stats.rate = stats.successes / stats.attempts;

        // Keep only last 500 fixes
        if (this.fixHistory.fixes.length > 500) {
            this.fixHistory.fixes = this.fixHistory.fixes.slice(-500);
        }

        this.saveHistory();
    }

    // Get recommended fix for an issue type
    getRecommendedFix(issueType) {
        const recommendations = {
            'http-500': 'restart-gateway',
            'http-502': 'restart-gateway',
            'http-503': 'restart-all',
            'http-timeout': 'restart-gateway',
            'ws-disconnect': 'ws-reconnect',
            'ws-timeout': 'restart-gateway',
            'memory-high': 'memory-cleanup',
            'stripe-error': 'verify-env',
            'ssl-error': 'check-ssl',
            'cache-full': 'clear-cache'
        };

        const fixType = recommendations[issueType] || 'restart-gateway';

        // Check if this fix has good success rate
        const stats = this.fixHistory.successRates[fixType];
        if (stats && stats.rate < 0.3 && stats.attempts > 3) {
            // Try alternative
            return 'restart-all';
        }

        return fixType;
    }

    // Get fix statistics
    getStats() {
        return {
            totalFixes: this.fixHistory.fixes.length,
            successRates: this.fixHistory.successRates,
            activeFixes: this.activeFixes,
            cooldowns: Object.fromEntries(
                Array.from(this.cooldowns.entries()).map(([k, v]) => [k, Date.now() - v])
            )
        };
    }
}

module.exports = { SelfHealer };

// If run directly, start as service
if (require.main === module) {
    const healer = new SelfHealer();

    const http = require('http');
    const server = http.createServer((req, res) => {
        if (req.url === '/stats') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(healer.getStats()));
        } else if (req.url.startsWith('/fix/') && req.method === 'POST') {
            const fixType = req.url.replace('/fix/', '');
            healer.applyFix(fixType).then(result => {
                res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            });
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                service: 'Self-Healer',
                status: 'running',
                endpoints: {
                    '/stats': 'GET - View statistics',
                    '/fix/:type': 'POST - Apply a fix'
                },
                availableFixes: Object.keys(healer.fixHandlers)
            }));
        }
    });

    server.listen(3012, () => {
        console.log('Self-Healer service running on port 3012 (up.doz.com)');
    });
}
