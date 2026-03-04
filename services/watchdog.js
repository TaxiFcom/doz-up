/**
 * DOZ UP - Watchdog Service
 * Monitors nginx and gateway health, auto-restarts on failure
 * Run with: node services/watchdog.js
 */

const { exec, execSync } = require('child_process');
const http = require('http');
const path = require('path');

const CONFIG = {
    checkInterval: 30000,      // Check every 30 seconds
    nginxPath: 'C:\\nginx',
    gatewayHealthUrl: `https://${process.env.HOST || 'up.doz.com'}:${process.env.PORT || 3000}/health`,
    maxConsecutiveFailures: 3,
    restartCooldown: 60000,    // Wait 1 minute between restarts
};

let consecutiveNginxFailures = 0;
let consecutiveGatewayFailures = 0;
let lastNginxRestart = 0;
let lastGatewayRestart = 0;

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${colors[color]}${message}${colors.reset}`);
}

// Check if nginx is running
function checkNginx() {
    return new Promise((resolve) => {
        exec('tasklist /FI "IMAGENAME eq nginx.exe" /NH', (error, stdout) => {
            if (error || !stdout.includes('nginx.exe')) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

// Start nginx
function startNginx() {
    return new Promise((resolve) => {
        log('Starting nginx...', 'yellow');
        exec(`cd /d "${CONFIG.nginxPath}" && start nginx.exe`, (error) => {
            if (error) {
                log(`Failed to start nginx: ${error.message}`, 'red');
                resolve(false);
            } else {
                log('Nginx started successfully', 'green');
                resolve(true);
            }
        });
    });
}

// Check gateway health
function checkGatewayHealth() {
    return new Promise((resolve) => {
        const req = http.get(CONFIG.gatewayHealthUrl, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const health = JSON.parse(data);
                    const hasScore = typeof health.score === 'number';
                    const isHealthy = res.statusCode === 200 && (hasScore ? health.score >= 50 : health.status === 'ok');
                    resolve({
                        healthy: isHealthy,
                        score: health.score || (isHealthy ? 100 : 0),
                        status: health.status
                    });
                } catch (e) {
                    resolve({ healthy: false, error: 'parse_error' });
                }
            });
        });

        req.on('error', () => {
            resolve({ healthy: false, error: 'connection_error' });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ healthy: false, error: 'timeout' });
        });
    });
}

// Restart PM2 gateway
function restartGateway() {
    return new Promise((resolve) => {
        log('Restarting gateway via PM2...', 'yellow');
        exec('pm2 reload doz-gateway --update-env', { cwd: 'C:\\DOZ UP' }, (error) => {
            if (error) {
                log(`Failed to restart gateway: ${error.message}`, 'red');
                // Try harder restart
                exec('pm2 restart doz-gateway', { cwd: 'C:\\DOZ UP' }, (err2) => {
                    resolve(!err2);
                });
            } else {
                log('Gateway restarted successfully', 'green');
                resolve(true);
            }
        });
    });
}

// Check port 80 is responding
function checkPort80() {
    return new Promise((resolve) => {
        const req = http.get(`http://${process.env.HOST || 'doz.com'}/`, { timeout: 5000 }, (res) => {
            resolve(res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

// Main monitoring loop
async function monitor() {
    log('=== Health Check ===', 'cyan');

    // Check nginx
    const nginxRunning = await checkNginx();
    const port80Responding = await checkPort80();

    if (!nginxRunning || !port80Responding) {
        consecutiveNginxFailures++;
        log(`Nginx check failed (${consecutiveNginxFailures}/${CONFIG.maxConsecutiveFailures}) - Running: ${nginxRunning}, Port80: ${port80Responding}`, 'red');

        if (consecutiveNginxFailures >= CONFIG.maxConsecutiveFailures) {
            const now = Date.now();
            if (now - lastNginxRestart > CONFIG.restartCooldown) {
                await startNginx();
                lastNginxRestart = now;
                consecutiveNginxFailures = 0;
            } else {
                log('Nginx restart cooldown active, waiting...', 'yellow');
            }
        }
    } else {
        consecutiveNginxFailures = 0;
        log('Nginx: OK', 'green');
    }

    // Check gateway
    const gatewayHealth = await checkGatewayHealth();

    if (!gatewayHealth.healthy) {
        consecutiveGatewayFailures++;
        log(`Gateway check failed (${consecutiveGatewayFailures}/${CONFIG.maxConsecutiveFailures}) - ${gatewayHealth.error || gatewayHealth.status}`, 'red');

        if (consecutiveGatewayFailures >= CONFIG.maxConsecutiveFailures) {
            const now = Date.now();
            if (now - lastGatewayRestart > CONFIG.restartCooldown) {
                await restartGateway();
                lastGatewayRestart = now;
                consecutiveGatewayFailures = 0;
            } else {
                log('Gateway restart cooldown active, waiting...', 'yellow');
            }
        }
    } else {
        consecutiveGatewayFailures = 0;
        log(`Gateway: OK (score: ${gatewayHealth.score}, status: ${gatewayHealth.status})`, 'green');
    }

    log('');
}

// Start watchdog
console.log('');
console.log('='.repeat(50));
console.log('  DOZ UP - Watchdog Service');
console.log('='.repeat(50));
console.log(`  Check Interval: ${CONFIG.checkInterval / 1000}s`);
console.log(`  Max Failures: ${CONFIG.maxConsecutiveFailures}`);
console.log(`  Restart Cooldown: ${CONFIG.restartCooldown / 1000}s`);
console.log('='.repeat(50));
console.log('');

// Run immediately, then on interval
monitor();
setInterval(monitor, CONFIG.checkInterval);

// Handle process termination
process.on('SIGTERM', () => {
    log('Watchdog shutting down...', 'yellow');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('Watchdog shutting down...', 'yellow');
    process.exit(0);
});
