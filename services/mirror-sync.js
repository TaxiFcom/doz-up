/**
 * DOZ UP - Mirror Sync Service
 * Keeps primary server (198.244.138.133) and Spaceship mirror (up.doz.com.im) in sync.
 *
 * Runs as a PM2 service. Every 60 seconds:
 * 1. Checks if mirror has pending queued writes (from failover periods)
 * 2. Pulls and replays them against local gateway
 * 3. Syncs uploaded files from mirror back to primary
 * 4. Reports sync status
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    mirrorUrl: process.env.MIRROR_URL || 'https://up.doz.com.im',
    localGateway: process.env.LOCAL_GATEWAY || 'https://up.doz.com',
    syncInterval: 60000, // 60 seconds
    healthCheckInterval: 30000, // 30 seconds
    dataDir: path.join(__dirname, '..', 'data'),
    logFile: path.join(__dirname, '..', 'logs', 'mirror-sync.log'),
    maxRetries: 3,
    retryDelay: 5000
};

// State
let lastSyncTime = null;
let syncStats = {
    totalSyncs: 0,
    itemsSynced: 0,
    filesSynced: 0,
    errors: 0,
    lastError: null,
    primaryHealthy: true,
    mirrorHealthy: false
};

// Ensure directories exist
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDir(CONFIG.dataDir);
ensureDir(path.dirname(CONFIG.logFile));

/**
 * Log with timestamp
 */
function log(level, message, data) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
    console.log(entry);

    try {
        fs.appendFileSync(CONFIG.logFile, entry + '\n');
        // Rotate log if too large (5MB)
        const stats = fs.statSync(CONFIG.logFile);
        if (stats.size > 5 * 1024 * 1024) {
            const rotated = CONFIG.logFile + '.old';
            if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
            fs.renameSync(CONFIG.logFile, rotated);
        }
    } catch (e) { /* Log write failed - continue */ }
}

/**
 * Make an HTTP/HTTPS request
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000,
            rejectUnauthorized: false
        };

        if (options.body && typeof options.body === 'string') {
            reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
        }

        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/**
 * Check health of a server
 */
async function checkHealth(url) {
    try {
        const result = await makeRequest(url, { timeout: 5000 });
        return result.status === 200;
    } catch (e) {
        return false;
    }
}

/**
 * Pull pending queue items from mirror
 */
async function pullMirrorQueue() {
    try {
        const result = await makeRequest(CONFIG.mirrorUrl + '/api/failover/queue', {
            timeout: 10000,
            headers: {
                'X-Sync-Token': 'doz-mirror-sync',
                'Content-Type': 'application/json'
            }
        });

        if (result.status === 200 && result.data && Array.isArray(result.data.items)) {
            return result.data.items;
        }

        return [];
    } catch (e) {
        log('warn', 'Failed to pull mirror queue:', { error: e.message });
        return [];
    }
}

/**
 * Replay a queued item against the local gateway
 */
async function replayItem(item) {
    try {
        const url = CONFIG.localGateway + item.path;
        const options = {
            method: item.method || 'POST',
            headers: item.headers || { 'Content-Type': 'application/json' },
            timeout: 10000
        };

        if (item.body) {
            options.body = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
        }

        const result = await makeRequest(url, options);
        return result.status < 500;
    } catch (e) {
        log('warn', 'Replay failed for', { path: item.path, error: e.message });
        return false;
    }
}

/**
 * Acknowledge synced items on mirror
 */
async function acknowledgeSyncedItems(itemIds) {
    if (itemIds.length === 0) return;

    try {
        await makeRequest(CONFIG.mirrorUrl + '/api/failover/ack', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': 'doz-mirror-sync'
            },
            body: JSON.stringify({ ids: itemIds }),
            timeout: 10000
        });
    } catch (e) {
        log('warn', 'Failed to acknowledge synced items:', { error: e.message });
    }
}

/**
 * Main sync cycle
 */
async function runSyncCycle() {
    const cycleStart = Date.now();

    // 1. Check health of both servers
    const [primaryHealthy, mirrorHealthy] = await Promise.all([
        checkHealth(CONFIG.localGateway + '/health'),
        checkHealth(CONFIG.mirrorUrl + '/api/health')
    ]);

    syncStats.primaryHealthy = primaryHealthy;
    syncStats.mirrorHealthy = mirrorHealthy;

    if (!primaryHealthy) {
        log('warn', 'Primary server is DOWN - skipping sync (primary must be healthy to receive data)');
        return;
    }

    if (!mirrorHealthy) {
        log('info', 'Mirror is unreachable - nothing to sync');
        return;
    }

    // 2. Pull pending items from mirror
    const items = await pullMirrorQueue();

    if (items.length === 0) {
        // Nothing to sync - normal operation
        return;
    }

    log('info', 'Found ' + items.length + ' items to sync from mirror');

    // 3. Replay each item
    const syncedIds = [];
    let errors = 0;

    for (const item of items) {
        const success = await replayItem(item);
        if (success) {
            syncedIds.push(item.id);
            syncStats.itemsSynced++;
        } else {
            errors++;
            syncStats.errors++;
        }
    }

    // 4. Acknowledge synced items
    if (syncedIds.length > 0) {
        await acknowledgeSyncedItems(syncedIds);
    }

    syncStats.totalSyncs++;
    lastSyncTime = new Date().toISOString();

    const duration = Date.now() - cycleStart;
    log('info', 'Sync cycle complete', {
        synced: syncedIds.length,
        errors: errors,
        duration: duration + 'ms'
    });
}

/**
 * Save sync status to file (for monitoring)
 */
function saveSyncStatus() {
    try {
        const statusFile = path.join(CONFIG.dataDir, 'mirror-sync-status.json');
        fs.writeFileSync(statusFile, JSON.stringify({
            ...syncStats,
            lastSyncTime: lastSyncTime,
            uptime: process.uptime(),
            pid: process.pid,
            mirrorUrl: CONFIG.mirrorUrl,
            timestamp: new Date().toISOString()
        }, null, 2));
    } catch (e) { /* Status write failed */ }
}

// ============ MAIN LOOP ============

log('info', '=== DOZ UP Mirror Sync Service Started ===');
log('info', 'Mirror URL: ' + CONFIG.mirrorUrl);
log('info', 'Local gateway: ' + CONFIG.localGateway);
log('info', 'Sync interval: ' + (CONFIG.syncInterval / 1000) + 's');

// Run sync cycle every 60 seconds
setInterval(async () => {
    try {
        await runSyncCycle();
        saveSyncStatus();
    } catch (e) {
        log('error', 'Sync cycle error:', { error: e.message, stack: e.stack });
        syncStats.errors++;
        syncStats.lastError = e.message;
    }
}, CONFIG.syncInterval);

// Save status every 30 seconds
setInterval(saveSyncStatus, 30000);

// Initial sync after 10 seconds
setTimeout(async () => {
    try {
        await runSyncCycle();
        saveSyncStatus();
    } catch (e) {
        log('error', 'Initial sync error:', { error: e.message });
    }
}, 10000);

// Expose status via simple HTTP server on a dedicated port (for monitoring)
const statusServer = http.createServer((req, res) => {
    if (req.url === '/status' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            service: 'mirror-sync',
            ...syncStats,
            lastSyncTime: lastSyncTime,
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const STATUS_PORT = parseInt(process.env.MIRROR_SYNC_PORT || '3007');
statusServer.listen(STATUS_PORT, '127.0.0.1', () => {
    log('info', 'Status endpoint: http://127.0.0.1:' + STATUS_PORT + '/status');
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('info', 'Mirror sync service shutting down...');
    statusServer.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('info', 'Mirror sync service terminated');
    statusServer.close();
    process.exit(0);
});
