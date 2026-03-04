/**
 * DOZ Development Server - One-Way Sync Service
 *
 * Syncs code changes from Development Server (198.244.138.133) to target servers.
 * Currently syncs to: DOZ UP Server (198.244.138.177)
 *
 * Features:
 * - Real-time file watching with chokidar
 * - Batched sync (debounced to prevent excessive syncs)
 * - SSH/SFTP-based file transfer
 * - Auto-restart of remote PM2 services after sync
 * - Status API for monitoring
 * - Manual sync trigger via API
 *
 * PM2 Service Name: dev-sync
 */

const chokidar = require('chokidar');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Load sync targets configuration
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'sync-targets.json');

// Default configuration
const DEFAULT_CONFIG = {
    targets: [
        {
            name: 'doz-up',
            host: '198.244.138.177',
            port: 22,
            user: 'TaxiF',
            password: process.env.DOZ_UP_SSH_PASSWORD || '',
            privateKey: process.env.DOZ_UP_SSH_KEY || '',
            remotePath: 'C:/DOZ UP/',
            localPath: path.join(__dirname, '..'),
            watch: [
                'gateway.js',
                'public/',
                'services/',
                'config/',
                'prisma/'
            ],
            exclude: [
                'node_modules/',
                'uploads/',
                '.git/',
                'data/',
                'logs/',
                '*.log',
                '.env',
                '.claude/'
            ],
            restartCommand: 'pm2 restart doz-gateway',
            enabled: true
        }
    ],
    syncDebounce: 5000,     // Wait 5 seconds after last change before syncing
    statusPort: 3008,        // Status API port
    maxRetries: 3,
    retryDelay: 5000
};

// Load or create config
let config = DEFAULT_CONFIG;
try {
    if (fs.existsSync(CONFIG_PATH)) {
        const loadedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        config = { ...DEFAULT_CONFIG, ...loadedConfig };
        console.log('[Dev-Sync] Loaded config from', CONFIG_PATH);
    } else {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
        console.log('[Dev-Sync] Created default config at', CONFIG_PATH);
    }
} catch (err) {
    console.error('[Dev-Sync] Config load error:', err.message);
}

// State
const state = {
    lastSync: null,
    syncCount: 0,
    filesSynced: 0,
    errors: [],
    pendingChanges: new Set(),
    syncing: false,
    targets: {}
};

// Initialize target states
config.targets.forEach(target => {
    state.targets[target.name] = {
        lastSync: null,
        syncCount: 0,
        healthy: false,
        lastError: null
    };
});

// Debounce timer
let syncTimer = null;

/**
 * Connect to SSH and execute command
 */
function sshExec(target, command) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            console.log(`[Dev-Sync] SSH connected to ${target.name}`);
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                let stdout = '';
                let stderr = '';

                stream.on('data', (data) => {
                    stdout += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                stream.on('close', (code) => {
                    conn.end();
                    if (code === 0) {
                        resolve({ stdout, stderr, code });
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${stderr}`));
                    }
                });
            });
        });

        conn.on('error', (err) => {
            reject(err);
        });

        // Handle keyboard-interactive authentication (Windows OpenSSH)
        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
            if (prompts.length > 0 && target.password) {
                finish([target.password]);
            } else {
                finish([]);
            }
        });

        const connConfig = {
            host: target.host,
            port: target.port || 22,
            username: target.user,
            readyTimeout: 30000,
            tryKeyboard: true  // Enable keyboard-interactive
        };

        if (target.privateKey) {
            connConfig.privateKey = fs.readFileSync(target.privateKey);
        } else if (target.password) {
            connConfig.password = target.password;
        }

        conn.connect(connConfig);
    });
}

/**
 * Transfer file via SFTP
 */
function sftpTransfer(target, localFile, remoteFile) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                // Ensure remote directory exists
                const remoteDir = path.dirname(remoteFile).replace(/\\/g, '/');

                sftp.mkdir(remoteDir, { recursive: true }, () => {
                    // Upload file
                    sftp.fastPut(localFile, remoteFile.replace(/\\/g, '/'), (err) => {
                        conn.end();
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
        });

        conn.on('error', reject);

        // Handle keyboard-interactive authentication (Windows OpenSSH)
        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
            if (prompts.length > 0 && target.password) {
                finish([target.password]);
            } else {
                finish([]);
            }
        });

        const connConfig = {
            host: target.host,
            port: target.port || 22,
            username: target.user,
            readyTimeout: 30000,
            tryKeyboard: true  // Enable keyboard-interactive
        };

        if (target.privateKey) {
            connConfig.privateKey = fs.readFileSync(target.privateKey);
        } else if (target.password) {
            connConfig.password = target.password;
        }

        conn.connect(connConfig);
    });
}

/**
 * Check if file should be excluded
 */
function shouldExclude(filePath, excludePatterns) {
    const normalizedPath = filePath.replace(/\\/g, '/');

    for (const pattern of excludePatterns) {
        if (pattern.endsWith('/')) {
            // Directory pattern
            if (normalizedPath.includes(pattern) || normalizedPath.startsWith(pattern)) {
                return true;
            }
        } else if (pattern.startsWith('*.')) {
            // Extension pattern
            if (normalizedPath.endsWith(pattern.substring(1))) {
                return true;
            }
        } else {
            // Exact match
            if (normalizedPath.includes(pattern)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Sync changed files to target
 */
async function syncToTarget(target, changedFiles) {
    if (!target.enabled) {
        console.log(`[Dev-Sync] Target ${target.name} is disabled, skipping`);
        return;
    }

    const targetState = state.targets[target.name];
    const filesToSync = [];

    // Filter files based on watch patterns and exclude patterns
    for (const file of changedFiles) {
        const relativePath = path.relative(target.localPath, file);

        if (shouldExclude(relativePath, target.exclude)) {
            continue;
        }

        // Check if file matches watch patterns
        let shouldWatch = false;
        for (const watchPattern of target.watch) {
            if (relativePath.startsWith(watchPattern.replace('/', path.sep)) ||
                relativePath === watchPattern ||
                relativePath.replace(/\\/g, '/').startsWith(watchPattern)) {
                shouldWatch = true;
                break;
            }
        }

        if (shouldWatch && fs.existsSync(file)) {
            filesToSync.push({
                local: file,
                remote: path.join(target.remotePath, relativePath)
            });
        }
    }

    if (filesToSync.length === 0) {
        console.log(`[Dev-Sync] No files to sync for ${target.name}`);
        return;
    }

    console.log(`[Dev-Sync] Syncing ${filesToSync.length} files to ${target.name}...`);

    let successCount = 0;
    let errorCount = 0;

    for (const file of filesToSync) {
        try {
            await sftpTransfer(target, file.local, file.remote);
            console.log(`[Dev-Sync] ✓ ${path.basename(file.local)}`);
            successCount++;
        } catch (err) {
            console.error(`[Dev-Sync] ✗ ${path.basename(file.local)}: ${err.message}`);
            errorCount++;
        }
    }

    // Restart remote service if files were synced
    if (successCount > 0 && target.restartCommand) {
        try {
            console.log(`[Dev-Sync] Restarting ${target.name} service...`);
            await sshExec(target, target.restartCommand);
            console.log(`[Dev-Sync] ✓ Service restarted`);
        } catch (err) {
            console.error(`[Dev-Sync] ✗ Restart failed: ${err.message}`);
        }
    }

    // Update state
    targetState.lastSync = new Date().toISOString();
    targetState.syncCount++;
    targetState.healthy = errorCount === 0;
    if (errorCount > 0) {
        targetState.lastError = `${errorCount} files failed to sync`;
    }

    state.filesSynced += successCount;

    console.log(`[Dev-Sync] Sync complete: ${successCount} synced, ${errorCount} failed`);
}

/**
 * Process pending changes
 */
async function processPendingChanges() {
    if (state.syncing || state.pendingChanges.size === 0) {
        return;
    }

    state.syncing = true;
    const changedFiles = Array.from(state.pendingChanges);
    state.pendingChanges.clear();

    console.log(`[Dev-Sync] Processing ${changedFiles.length} changed files...`);

    for (const target of config.targets) {
        try {
            await syncToTarget(target, changedFiles);
        } catch (err) {
            console.error(`[Dev-Sync] Error syncing to ${target.name}:`, err.message);
            state.errors.push({
                time: new Date().toISOString(),
                target: target.name,
                error: err.message
            });
        }
    }

    state.syncCount++;
    state.lastSync = new Date().toISOString();
    state.syncing = false;

    // Keep only last 100 errors
    if (state.errors.length > 100) {
        state.errors = state.errors.slice(-100);
    }
}

/**
 * Handle file change event
 */
function onFileChange(filePath, event) {
    console.log(`[Dev-Sync] File ${event}: ${path.basename(filePath)}`);

    state.pendingChanges.add(filePath);

    // Debounce sync
    if (syncTimer) {
        clearTimeout(syncTimer);
    }

    syncTimer = setTimeout(() => {
        processPendingChanges();
    }, config.syncDebounce);
}

/**
 * Start file watcher
 */
function startWatcher() {
    const watchPaths = [];

    for (const target of config.targets) {
        if (!target.enabled) continue;

        for (const watchPattern of target.watch) {
            const fullPath = path.join(target.localPath, watchPattern);
            watchPaths.push(fullPath);
        }
    }

    if (watchPaths.length === 0) {
        console.log('[Dev-Sync] No watch paths configured');
        return;
    }

    console.log('[Dev-Sync] Watching paths:');
    watchPaths.forEach(p => console.log(`  - ${p}`));

    const watcher = chokidar.watch(watchPaths, {
        ignored: [
            /node_modules/,
            /\.git/,
            /uploads/,
            /data/,
            /logs/,
            /\.env$/
        ],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        }
    });

    watcher.on('add', (path) => onFileChange(path, 'added'));
    watcher.on('change', (path) => onFileChange(path, 'changed'));
    watcher.on('unlink', (path) => console.log(`[Dev-Sync] File deleted: ${path}`));

    watcher.on('error', (err) => {
        console.error('[Dev-Sync] Watcher error:', err.message);
    });

    console.log('[Dev-Sync] File watcher started');
}

/**
 * Start status HTTP server
 */
function startStatusServer() {
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/status') {
            res.end(JSON.stringify({
                status: 'running',
                lastSync: state.lastSync,
                syncCount: state.syncCount,
                filesSynced: state.filesSynced,
                pendingChanges: state.pendingChanges.size,
                syncing: state.syncing,
                targets: state.targets,
                recentErrors: state.errors.slice(-10),
                uptime: process.uptime()
            }, null, 2));
        } else if (req.url === '/sync' && req.method === 'POST') {
            // Manual sync trigger
            console.log('[Dev-Sync] Manual sync triggered');

            // Add all watched files to pending
            for (const target of config.targets) {
                if (!target.enabled) continue;

                for (const watchPattern of target.watch) {
                    const fullPath = path.join(target.localPath, watchPattern);
                    if (fs.existsSync(fullPath)) {
                        if (fs.statSync(fullPath).isDirectory()) {
                            // Add all files in directory
                            const files = fs.readdirSync(fullPath, { recursive: true });
                            files.forEach(file => {
                                const filePath = path.join(fullPath, file);
                                if (fs.statSync(filePath).isFile()) {
                                    state.pendingChanges.add(filePath);
                                }
                            });
                        } else {
                            state.pendingChanges.add(fullPath);
                        }
                    }
                }
            }

            processPendingChanges();
            res.end(JSON.stringify({ status: 'sync_started', pendingFiles: state.pendingChanges.size }));
        } else if (req.url === '/config') {
            res.end(JSON.stringify(config, null, 2));
        } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(config.statusPort, '127.0.0.1', () => {
        console.log(`[Dev-Sync] Status API running at http://127.0.0.1:${config.statusPort}`);
        console.log(`  - GET /status - Sync status`);
        console.log(`  - POST /sync - Trigger manual sync`);
        console.log(`  - GET /config - View configuration`);
    });
}

// Main
console.log('============================================');
console.log('DOZ Development Server - One-Way Sync Service');
console.log('============================================');
console.log(`Targets: ${config.targets.map(t => t.name).join(', ')}`);
console.log(`Sync debounce: ${config.syncDebounce}ms`);
console.log('');

startWatcher();
startStatusServer();

// Health check for targets on startup
setTimeout(async () => {
    console.log('[Dev-Sync] Checking target connectivity...');

    for (const target of config.targets) {
        if (!target.enabled) continue;

        try {
            await sshExec(target, 'echo "Connection test"');
            state.targets[target.name].healthy = true;
            console.log(`[Dev-Sync] ✓ ${target.name} (${target.host}) - Connected`);
        } catch (err) {
            state.targets[target.name].healthy = false;
            state.targets[target.name].lastError = err.message;
            console.error(`[Dev-Sync] ✗ ${target.name} (${target.host}) - ${err.message}`);
        }
    }
}, 3000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Dev-Sync] Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[Dev-Sync] Shutting down...');
    process.exit(0);
});
