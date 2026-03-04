/**
 * DOZ UP - Health Monitor Service (7-Minute Interval)
 * Deep health checks with auto-restart and logging
 * Run with: pm2 start services/health-monitor-7min.js --name health-monitor
 */

const { exec, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG = {
    checkInterval: 420000,        // 7 minutes in milliseconds
    host: process.env.HOST || 'up.doz.com',
    gatewayPort: process.env.PORT || 3000,
    logFile: path.join(__dirname, '..', 'logs', 'health-monitor.log'),
    maxLogSize: 10 * 1024 * 1024, // 10MB max log size
    requestTimeout: 5000,          // 5 second timeout for HTTP requests
    memoryThreshold: 850,          // MB - restart if above this
    diskSpaceWarning: 1024,        // MB - warn if less than this
};

// ANSI colors for console
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
};

/**
 * Log message to console and file
 */
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;

    // Console output with colors
    let color = colors.reset;
    if (level === 'ERROR') color = colors.red;
    else if (level === 'WARN') color = colors.yellow;
    else if (level === 'OK') color = colors.green;
    else if (level === 'FIX') color = colors.cyan;

    console.log(`${color}${logLine}${colors.reset}`);

    // File output
    try {
        // Check log file size and rotate if needed
        if (fs.existsSync(CONFIG.logFile)) {
            const stats = fs.statSync(CONFIG.logFile);
            if (stats.size > CONFIG.maxLogSize) {
                const backupFile = CONFIG.logFile.replace('.log', `-${Date.now()}.log`);
                fs.renameSync(CONFIG.logFile, backupFile);
            }
        }
        fs.appendFileSync(CONFIG.logFile, logLine + '\n');
    } catch (e) {
        console.error('Failed to write to log file:', e.message);
    }
}

/**
 * Make HTTP request with timeout
 */
function httpGet(url, timeout = CONFIG.requestTimeout) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, { timeout, rejectUnauthorized: false }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, data, headers: res.headers });
            });
        });

        req.on('error', (e) => reject(e));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Check gateway health endpoint
 */
async function checkGatewayHealth() {
    try {
        const url = `http://${CONFIG.host}:${CONFIG.gatewayPort}/health`;
        const response = await httpGet(url);

        if (response.statusCode === 200) {
            const data = JSON.parse(response.data);
            return { ok: true, status: data.status, uptime: data.uptime };
        }
        return { ok: false, error: `Status code: ${response.statusCode}` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Check detailed API health
 */
async function checkAPIHealth() {
    try {
        const url = `http://${CONFIG.host}:${CONFIG.gatewayPort}/api/health`;
        const response = await httpGet(url);

        if (response.statusCode === 200) {
            const data = JSON.parse(response.data);
            return {
                ok: true,
                status: data.status,
                memory: data.memory,
                connections: data.connections,
                uptime: data.uptime
            };
        }
        return { ok: false, error: `Status code: ${response.statusCode}` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Check live stats endpoint
 */
async function checkLiveStats() {
    try {
        const url = `http://${CONFIG.host}:${CONFIG.gatewayPort}/api/live-stats`;
        const response = await httpGet(url);

        if (response.statusCode === 200) {
            const data = JSON.parse(response.data);
            return {
                ok: true,
                online: data.online,
                desktop: data.desktop,
                web: data.web
            };
        }
        return { ok: false, error: `Status code: ${response.statusCode}` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Check PM2 process status
 */
function checkPM2Status() {
    return new Promise((resolve) => {
        exec('pm2 jlist', (error, stdout) => {
            if (error) {
                resolve({ ok: false, error: error.message });
                return;
            }

            try {
                const processes = JSON.parse(stdout);
                const gateway = processes.find(p => p.name === 'doz-gateway');

                if (!gateway) {
                    resolve({ ok: false, error: 'doz-gateway not found in PM2' });
                    return;
                }

                const memoryMB = Math.round(gateway.monit?.memory / 1024 / 1024) || 0;
                const cpu = gateway.monit?.cpu || 0;
                const status = gateway.pm2_env?.status || 'unknown';
                const restarts = gateway.pm2_env?.restart_time || 0;

                resolve({
                    ok: status === 'online',
                    status,
                    memory: memoryMB,
                    cpu,
                    restarts,
                    instances: processes.filter(p => p.name === 'doz-gateway').length
                });
            } catch (e) {
                resolve({ ok: false, error: 'Failed to parse PM2 output' });
            }
        });
    });
}

/**
 * Check if port is responding
 */
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`https://${CONFIG.host}:${port}/`, { timeout: 3000 }, (res) => {
            resolve({ ok: res.statusCode < 500, statusCode: res.statusCode });
        });
        req.on('error', () => resolve({ ok: false, error: 'Connection refused' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    });
}

/**
 * Check disk space
 */
function checkDiskSpace() {
    return new Promise((resolve) => {
        // Use PowerShell for more reliable disk info
        exec('powershell -command "Get-WmiObject Win32_LogicalDisk | Select-Object DeviceID,FreeSpace,Size | ConvertTo-Json"', (error, stdout) => {
            if (error) {
                resolve({ ok: true, disks: [], warning: null });
                return;
            }

            try {
                let diskData = JSON.parse(stdout);
                // Ensure it's an array
                if (!Array.isArray(diskData)) diskData = [diskData];

                const disks = diskData
                    .filter(d => d.Size && d.FreeSpace)
                    .map(d => ({
                        drive: d.DeviceID,
                        freeMB: Math.round(d.FreeSpace / 1024 / 1024),
                        totalMB: Math.round(d.Size / 1024 / 1024),
                        usedPercent: Math.round((1 - d.FreeSpace / d.Size) * 100)
                    }));

                const lowSpace = disks.filter(d => d.freeMB < CONFIG.diskSpaceWarning);
                resolve({
                    ok: lowSpace.length === 0,
                    disks,
                    warning: lowSpace.length > 0 ? `Low space on: ${lowSpace.map(d => d.drive).join(', ')}` : null
                });
            } catch (e) {
                resolve({ ok: true, disks: [], warning: null });
            }
        });
    });
}

/**
 * Restart gateway via PM2
 */
function restartGateway(method = 'reload') {
    return new Promise((resolve) => {
        const cmd = method === 'reload' ? 'pm2 reload doz-gateway --update-env' : 'pm2 restart doz-gateway';
        log(`Executing: ${cmd}`, 'FIX');

        exec(cmd, { cwd: 'C:\\DOZ UP' }, (error) => {
            if (error) {
                log(`Restart failed: ${error.message}`, 'ERROR');
                // Try harder restart
                exec('pm2 restart doz-gateway', (err2) => {
                    resolve(!err2);
                });
            } else {
                log('Gateway restarted successfully', 'FIX');
                resolve(true);
            }
        });
    });
}

/**
 * Run all health checks
 */
async function runHealthCheck() {
    const startTime = Date.now();
    const results = {
        timestamp: new Date().toISOString(),
        checks: {},
        issues: [],
        fixes: []
    };

    log('═'.repeat(60));
    log('HEALTH CHECK STARTED', 'INFO');
    log('═'.repeat(60));

    // 1. Gateway Health
    log('Checking gateway /health...', 'INFO');
    results.checks.gateway = await checkGatewayHealth();
    if (results.checks.gateway.ok) {
        log(`Gateway: OK (uptime: ${Math.round(results.checks.gateway.uptime)}s)`, 'OK');
    } else {
        log(`Gateway: FAILED - ${results.checks.gateway.error}`, 'ERROR');
        results.issues.push('Gateway health check failed');
    }

    // 2. API Health
    log('Checking /api/health...', 'INFO');
    results.checks.api = await checkAPIHealth();
    if (results.checks.api.ok) {
        const mem = results.checks.api.memory;
        log(`API Health: OK (memory: ${mem?.heapUsed || 'N/A'}MB)`, 'OK');
    } else {
        log(`API Health: FAILED - ${results.checks.api.error}`, 'ERROR');
        results.issues.push('API health check failed');
    }

    // 3. Live Stats
    log('Checking /api/live-stats...', 'INFO');
    results.checks.liveStats = await checkLiveStats();
    if (results.checks.liveStats.ok) {
        log(`Live Stats: OK (online: ${results.checks.liveStats.online}, desktop: ${results.checks.liveStats.desktop}, web: ${results.checks.liveStats.web})`, 'OK');
    } else {
        log(`Live Stats: FAILED - ${results.checks.liveStats.error}`, 'WARN');
    }

    // 4. PM2 Status
    log('Checking PM2 status...', 'INFO');
    results.checks.pm2 = await checkPM2Status();
    if (results.checks.pm2.ok) {
        log(`PM2: OK (status: ${results.checks.pm2.status}, memory: ${results.checks.pm2.memory}MB, instances: ${results.checks.pm2.instances})`, 'OK');

        // Check memory threshold
        if (results.checks.pm2.memory > CONFIG.memoryThreshold) {
            log(`Memory above threshold (${results.checks.pm2.memory}MB > ${CONFIG.memoryThreshold}MB)`, 'WARN');
            results.issues.push('High memory usage');
        }
    } else {
        log(`PM2: FAILED - ${results.checks.pm2.error}`, 'ERROR');
        results.issues.push('PM2 process not running properly');
    }

    // 5. Port 3000
    log('Checking port 3000...', 'INFO');
    results.checks.port3000 = await checkPort(3000);
    if (results.checks.port3000.ok) {
        log('Port 3000: OK', 'OK');
    } else {
        log(`Port 3000: FAILED - ${results.checks.port3000.error}`, 'ERROR');
        results.issues.push('Port 3000 not responding');
    }

    // 6. Disk Space
    log('Checking disk space...', 'INFO');
    results.checks.disk = await checkDiskSpace();
    if (results.checks.disk.ok && results.checks.disk.disks) {
        const mainDisk = results.checks.disk.disks.find(d => d.drive === 'C:');
        if (mainDisk) {
            log(`Disk C: OK (${Math.round(mainDisk.freeMB / 1024)}GB free, ${mainDisk.usedPercent}% used)`, 'OK');
        } else {
            log('Disk: OK', 'OK');
        }
    } else if (results.checks.disk.warning) {
        log(`Disk: WARNING - ${results.checks.disk.warning}`, 'WARN');
        results.issues.push(results.checks.disk.warning);
    } else {
        log('Disk: Check skipped', 'INFO');
    }

    // 7. COMPREHENSIVE AI HEALTH CHECK (calls /api/health/full)
    log('Running AI comprehensive health check...', 'INFO');
    let fullHealth = null;
    try {
        const fullResponse = await httpGet(`http://${CONFIG.host}:${CONFIG.gatewayPort}/api/health/full`, 15000);
        if (fullResponse.statusCode === 200) {
            fullHealth = JSON.parse(fullResponse.data);
            results.checks.fullHealth = {
                ok: fullHealth.score >= 70,
                score: fullHealth.score,
                overall: fullHealth.overall,
                pages: fullHealth.checks?.pages || {},
                apis: fullHealth.checks?.apis || {},
                filesystem: fullHealth.checks?.filesystem || {},
                memory: fullHealth.checks?.memory || {},
                aiServices: fullHealth.checks?.aiServices || {},
                autoFixes: fullHealth.autoFixes || []
            };

            // Log page health
            const pages = fullHealth.checks?.pages;
            if (pages) {
                log(`Pages: ${pages.passed}/${pages.total} OK (avg ${pages.avgResponseMs}ms)`, pages.failed > 0 ? 'WARN' : 'OK');
                if (pages.failedList && pages.failedList.length > 0) {
                    pages.failedList.forEach(p => {
                        log(`  FAIL: ${p.page} (status=${p.status} ${p.error || ''})`, 'ERROR');
                        results.issues.push(`Page failed: ${p.page}`);
                    });
                }
            }

            // Log API health
            const apis = fullHealth.checks?.apis;
            if (apis) {
                log(`APIs: ${apis.passed}/${apis.total} OK (avg ${apis.avgResponseMs}ms)`, apis.failed > 0 ? 'WARN' : 'OK');
                if (apis.failedList && apis.failedList.length > 0) {
                    apis.failedList.forEach(a => {
                        log(`  FAIL: ${a.endpoint} (status=${a.status} ${a.error || ''})`, 'ERROR');
                        results.issues.push(`API failed: ${a.endpoint}`);
                    });
                }
            }

            // Log AI services
            const ai = fullHealth.checks?.aiServices;
            if (ai) {
                log(`AI Services: ${ai.ok ? 'ACTIVE' : 'DOWN'} (issues handled: ${ai.totalIssues || 0}, permanent fixes: ${ai.permanentFixes || 0})`, ai.ok ? 'OK' : 'WARN');
            }

            // Log filesystem
            const fs_check = fullHealth.checks?.filesystem;
            if (fs_check) {
                log(`Filesystem: ${fs_check.ok ? 'OK' : 'FAIL'} (uploads: ${fs_check.uploadFileCount} files, writable: ${fs_check.writable})`, fs_check.ok ? 'OK' : 'ERROR');
            }

            // Log auto-fixes from full check
            if (fullHealth.autoFixes && fullHealth.autoFixes.length > 0) {
                fullHealth.autoFixes.forEach(fix => {
                    log(`Auto-fix: ${fix}`, 'FIX');
                    results.fixes.push(fix);
                });
            }

            log(`AI Health Score: ${fullHealth.score}/100 (${fullHealth.overall})`, fullHealth.score >= 90 ? 'OK' : fullHealth.score >= 70 ? 'WARN' : 'ERROR');
        } else {
            log(`Full health check failed: status ${fullResponse.statusCode}`, 'ERROR');
            results.issues.push('Full health check endpoint failed');
        }
    } catch (e) {
        log(`Full health check error: ${e.message}`, 'ERROR');
        results.issues.push('Full health check unreachable');
    }

    // AUTO-FIX: Restart gateway if needed
    if (results.issues.length > 0) {
        log('─'.repeat(60));
        log(`ISSUES DETECTED (${results.issues.length}) - AI AUTO-FIX ENGINE`, 'FIX');

        const needsRestart = results.issues.some(i =>
            i.includes('Gateway') ||
            i.includes('Port 3000') ||
            i.includes('PM2') ||
            i.includes('High memory') ||
            i.includes('Full health check unreachable')
        );

        if (needsRestart) {
            log('Restarting doz-gateway...', 'FIX');
            const restarted = await restartGateway('reload');
            if (restarted) {
                results.fixes.push('Gateway restarted via PM2 reload');

                // Wait and verify
                await new Promise(resolve => setTimeout(resolve, 5000));
                const recheckHealth = await checkGatewayHealth();
                if (recheckHealth.ok) {
                    log('Gateway recovery CONFIRMED', 'OK');
                    results.fixes.push('Gateway recovery verified');
                } else {
                    log('Gateway still failing - trying hard restart...', 'ERROR');
                    await restartGateway('restart');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    const recheck2 = await checkGatewayHealth();
                    if (recheck2.ok) {
                        log('Gateway recovered after hard restart', 'OK');
                        results.fixes.push('Hard restart recovery verified');
                    } else {
                        log('Gateway CRITICAL - needs manual intervention', 'ERROR');
                        // Try starting from ecosystem as last resort
                        exec('pm2 start ecosystem.config.js', { cwd: 'C:\\DOZ UP' }, () => {});
                        results.fixes.push('Attempted ecosystem restart');
                    }
                }
            }
        }

        // Fix failed pages by checking if they're static files
        const pageFails = results.issues.filter(i => i.includes('Page failed'));
        if (pageFails.length > 0 && !needsRestart) {
            log(`${pageFails.length} page(s) failing - may be missing static files`, 'WARN');
        }
    }

    // Summary
    const duration = Date.now() - startTime;
    log('─'.repeat(60));

    const allOk = results.issues.length === 0;
    const healthScore = fullHealth ? fullHealth.score : (allOk ? 100 : 50);
    const status = healthScore >= 90 ? 'HEALTHY' : healthScore >= 70 ? 'DEGRADED' : healthScore >= 50 ? 'UNHEALTHY' : 'CRITICAL';
    const statusColor = healthScore >= 90 ? 'OK' : healthScore >= 70 ? 'WARN' : 'ERROR';

    log(`STATUS: ${status} (score: ${healthScore}/100)`, statusColor);
    log(`Pages: ${fullHealth?.checks?.pages?.passed || '?'}/${fullHealth?.checks?.pages?.total || '?'} | APIs: ${fullHealth?.checks?.apis?.passed || '?'}/${fullHealth?.checks?.apis?.total || '?'}`, 'INFO');
    log(`Duration: ${duration}ms`, 'INFO');
    log(`Issues: ${results.issues.length}`, results.issues.length > 0 ? 'WARN' : 'OK');
    log(`Fixes applied: ${results.fixes.length}`, results.fixes.length > 0 ? 'FIX' : 'INFO');
    log(`Next check in: 7 minutes`, 'INFO');
    log('═'.repeat(60));
    log('');

    // Store latest result for API access
    latestHealthResult = results;
    latestHealthResult.score = healthScore;
    latestHealthResult.status = status;

    return results;
}

// Store latest result
let latestHealthResult = null;

// Main execution
console.log('');
console.log(`${colors.bold}${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}  DOZ UP Health Monitor - 7 Minute Interval${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
console.log(`  Check Interval: ${CONFIG.checkInterval / 1000 / 60} minutes`);
console.log(`  Log File: ${CONFIG.logFile}`);
console.log(`  Memory Threshold: ${CONFIG.memoryThreshold}MB`);
console.log(`${colors.bold}${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
console.log('');

// Ensure logs directory exists
const logsDir = path.dirname(CONFIG.logFile);
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Run immediately, then every 7 minutes
runHealthCheck();
setInterval(runHealthCheck, CONFIG.checkInterval);

// Handle process termination
process.on('SIGTERM', () => {
    log('Health Monitor shutting down...', 'INFO');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('Health Monitor shutting down...', 'INFO');
    process.exit(0);
});

log('Health Monitor started - checking every 7 minutes', 'INFO');
