/**
 * DOZ SSH Load Balancer - High Availability SSH Connection Manager
 * Ensures 100% uptime with multiple uplinks, health checks, and automatic failover
 */

const { Client } = require('ssh2');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// Load balancer configuration
const DEFAULT_CONFIG = {
    // Health check settings
    healthCheckInterval: 10000,      // 10 seconds
    healthCheckTimeout: 5000,        // 5 second timeout for health checks

    // Connection settings
    connectionTimeout: 15000,        // 15 seconds to establish connection
    keepaliveInterval: 5000,         // 5 second keepalive (aggressive)
    keepaliveCountMax: 3,            // 3 missed keepalives before disconnect

    // Reconnection settings
    reconnectDelay: 1000,            // 1 second initial delay
    reconnectDelayMax: 30000,        // 30 second max delay
    reconnectAttempts: Infinity,     // Never stop trying

    // Load balancing
    maxConnectionsPerUplink: 50,     // Max connections per uplink
    failoverThreshold: 3,            // Failed health checks before failover

    // Session persistence
    sessionPersistence: true,        // Try to maintain sessions across failovers

    // Logging
    logLevel: 'info'                 // debug, info, warn, error
};

class SSHUplink extends EventEmitter {
    constructor(config, id) {
        super();
        this.id = id;
        this.config = config;
        this.host = config.host;
        this.port = config.port || 22;
        this.username = config.username;
        this.password = config.password;
        this.privateKey = config.privateKey;
        this.priority = config.priority || 1;
        this.weight = config.weight || 1;

        // State tracking
        this.status = 'disconnected';      // disconnected, connecting, connected, unhealthy
        this.healthScore = 100;            // 0-100 health score
        this.lastHealthCheck = null;
        this.failedHealthChecks = 0;
        this.activeConnections = 0;
        this.totalConnections = 0;
        this.latency = 0;
        this.reconnectAttempts = 0;
        this.lastError = null;

        // Connection pool
        this.connectionPool = new Map();

        // Stats
        this.stats = {
            bytesTransferred: 0,
            successfulConnections: 0,
            failedConnections: 0,
            avgLatency: 0,
            uptime: 0,
            lastConnected: null
        };
    }

    getInfo() {
        return {
            id: this.id,
            host: this.host,
            port: this.port,
            status: this.status,
            healthScore: this.healthScore,
            activeConnections: this.activeConnections,
            latency: this.latency,
            priority: this.priority,
            stats: this.stats
        };
    }
}

class SSHLoadBalancer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.uplinks = new Map();
        this.sessions = new Map();          // sessionId -> session data
        this.healthCheckTimer = null;
        this.isRunning = false;
        this.primaryUplink = null;

        // Stats
        this.globalStats = {
            totalConnections: 0,
            activeConnections: 0,
            failovers: 0,
            bytesTransferred: 0,
            startTime: Date.now()
        };

        // Load saved uplinks
        this._loadUplinkConfig();

        this.log('info', 'SSH Load Balancer initialized');
    }

    log(level, message, data = null) {
        const levels = ['debug', 'info', 'warn', 'error'];
        if (levels.indexOf(level) >= levels.indexOf(this.config.logLevel)) {
            const timestamp = new Date().toISOString();
            const logMsg = `[${timestamp}] [SSH-LB] [${level.toUpperCase()}] ${message}`;
            if (data) {
                console.log(logMsg, data);
            } else {
                console.log(logMsg);
            }
        }
    }

    // ============ UPLINK MANAGEMENT ============

    /**
     * Add a new SSH uplink
     */
    addUplink(config) {
        const id = config.id || `uplink-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        if (this.uplinks.has(id)) {
            this.log('warn', `Uplink ${id} already exists, updating config`);
            this.removeUplink(id);
        }

        const uplink = new SSHUplink(config, id);
        this.uplinks.set(id, uplink);

        this.log('info', `Added uplink: ${config.host}:${config.port} (${id})`);

        // Set as primary if first uplink or has highest priority
        if (!this.primaryUplink || config.priority > this.primaryUplink.priority) {
            this.primaryUplink = uplink;
        }

        // Start health check if running
        if (this.isRunning) {
            this._checkUplinkHealth(uplink);
        }

        this._saveUplinkConfig();
        this.emit('uplink:added', uplink.getInfo());

        return id;
    }

    /**
     * Remove an uplink
     */
    removeUplink(id) {
        const uplink = this.uplinks.get(id);
        if (!uplink) return false;

        // Close all connections on this uplink
        uplink.connectionPool.forEach((conn, connId) => {
            this._closeConnection(connId, 'uplink_removed');
        });

        this.uplinks.delete(id);

        // Update primary if needed
        if (this.primaryUplink && this.primaryUplink.id === id) {
            this._electPrimaryUplink();
        }

        this._saveUplinkConfig();
        this.emit('uplink:removed', id);

        this.log('info', `Removed uplink: ${id}`);
        return true;
    }

    /**
     * Get all uplinks info
     */
    getUplinks() {
        return Array.from(this.uplinks.values()).map(u => u.getInfo());
    }

    /**
     * Get best available uplink based on health, load, and priority
     */
    _getBestUplink() {
        let bestUplink = null;
        let bestScore = -1;

        this.uplinks.forEach(uplink => {
            if (uplink.status !== 'connected') return;
            if (uplink.activeConnections >= this.config.maxConnectionsPerUplink) return;

            // Calculate score: priority * health * (1 - load)
            const load = uplink.activeConnections / this.config.maxConnectionsPerUplink;
            const score = uplink.priority * (uplink.healthScore / 100) * (1 - load) * uplink.weight;

            if (score > bestScore) {
                bestScore = score;
                bestUplink = uplink;
            }
        });

        return bestUplink;
    }

    /**
     * Elect a new primary uplink
     */
    _electPrimaryUplink() {
        let best = null;
        let bestPriority = -1;

        this.uplinks.forEach(uplink => {
            if (uplink.status === 'connected' && uplink.priority > bestPriority) {
                best = uplink;
                bestPriority = uplink.priority;
            }
        });

        if (best !== this.primaryUplink) {
            this.primaryUplink = best;
            this.emit('primary:changed', best ? best.getInfo() : null);
            this.log('info', `Primary uplink changed to: ${best ? best.host : 'none'}`);
        }
    }

    // ============ HEALTH CHECKS ============

    /**
     * Start the load balancer
     */
    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.log('info', 'SSH Load Balancer started');

        // Initial health check for all uplinks
        this.uplinks.forEach(uplink => {
            this._checkUplinkHealth(uplink);
        });

        // Start periodic health checks
        this.healthCheckTimer = setInterval(() => {
            this._runHealthChecks();
        }, this.config.healthCheckInterval);

        this.emit('started');
    }

    /**
     * Stop the load balancer
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        // Close all sessions
        this.sessions.forEach((session, sessionId) => {
            this._closeSession(sessionId, 'load_balancer_stopped');
        });

        this.log('info', 'SSH Load Balancer stopped');
        this.emit('stopped');
    }

    /**
     * Run health checks on all uplinks
     */
    _runHealthChecks() {
        this.uplinks.forEach(uplink => {
            this._checkUplinkHealth(uplink);
        });
    }

    /**
     * Check health of a single uplink
     */
    async _checkUplinkHealth(uplink) {
        const startTime = Date.now();

        try {
            const isHealthy = await this._performHealthCheck(uplink);
            const latency = Date.now() - startTime;

            uplink.latency = latency;
            uplink.lastHealthCheck = Date.now();

            if (isHealthy) {
                uplink.failedHealthChecks = 0;
                uplink.healthScore = Math.min(100, uplink.healthScore + 10);

                if (uplink.status !== 'connected') {
                    uplink.status = 'connected';
                    uplink.stats.lastConnected = Date.now();
                    this.log('info', `Uplink ${uplink.host} is now healthy (${latency}ms)`);
                    this.emit('uplink:healthy', uplink.getInfo());
                    this._electPrimaryUplink();
                }
            } else {
                this._handleUnhealthyUplink(uplink);
            }
        } catch (error) {
            uplink.lastError = error.message;
            this._handleUnhealthyUplink(uplink);
        }
    }

    /**
     * Perform actual health check connection
     */
    _performHealthCheck(uplink) {
        return new Promise((resolve) => {
            const client = new Client();
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    client.end();
                    resolve(false);
                }
            }, this.config.healthCheckTimeout);

            client.on('ready', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    client.end();
                    resolve(true);
                }
            });

            client.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    uplink.lastError = err.message;
                    resolve(false);
                }
            });

            const connectOptions = {
                host: uplink.host,
                port: uplink.port,
                username: uplink.username,
                readyTimeout: this.config.healthCheckTimeout,
                keepaliveInterval: 0
            };

            if (uplink.privateKey) {
                connectOptions.privateKey = uplink.privateKey;
            } else if (uplink.password) {
                connectOptions.password = uplink.password;
            }

            try {
                client.connect(connectOptions);
            } catch (err) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(false);
                }
            }
        });
    }

    /**
     * Handle an unhealthy uplink
     */
    _handleUnhealthyUplink(uplink) {
        uplink.failedHealthChecks++;
        uplink.healthScore = Math.max(0, uplink.healthScore - 25);

        if (uplink.failedHealthChecks >= this.config.failoverThreshold) {
            if (uplink.status === 'connected') {
                uplink.status = 'unhealthy';
                this.log('warn', `Uplink ${uplink.host} marked unhealthy after ${uplink.failedHealthChecks} failed checks`);
                this.emit('uplink:unhealthy', uplink.getInfo());

                // Trigger failover for active sessions
                this._failoverSessions(uplink);
                this._electPrimaryUplink();
            }
        }
    }

    /**
     * Failover sessions from an unhealthy uplink
     */
    _failoverSessions(unhealthyUplink) {
        const sessionsToFailover = [];

        this.sessions.forEach((session, sessionId) => {
            if (session.uplinkId === unhealthyUplink.id) {
                sessionsToFailover.push(sessionId);
            }
        });

        if (sessionsToFailover.length > 0) {
            this.globalStats.failovers++;
            this.log('info', `Failing over ${sessionsToFailover.length} sessions from ${unhealthyUplink.host}`);

            sessionsToFailover.forEach(sessionId => {
                this._reconnectSession(sessionId);
            });
        }
    }

    // ============ SESSION MANAGEMENT ============

    /**
     * Create a new SSH session with automatic failover
     */
    async createSession(connectionConfig, ws) {
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Find best uplink
        const uplink = this._getBestUplink();

        if (!uplink) {
            throw new Error('No healthy uplinks available');
        }

        this.log('info', `Creating session ${sessionId} on uplink ${uplink.host}`);

        const session = {
            id: sessionId,
            uplinkId: uplink.id,
            connectionConfig,
            ws,
            sshClient: null,
            stream: null,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            reconnectAttempts: 0,
            status: 'connecting'
        };

        this.sessions.set(sessionId, session);

        try {
            await this._connectSession(session, uplink);
            this.globalStats.totalConnections++;
            this.globalStats.activeConnections++;
            return sessionId;
        } catch (error) {
            this.sessions.delete(sessionId);
            throw error;
        }
    }

    /**
     * Connect a session to an uplink
     */
    _connectSession(session, uplink) {
        return new Promise((resolve, reject) => {
            const sshClient = new Client();
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    sshClient.end();
                    reject(new Error('Connection timeout'));
                }
            }, this.config.connectionTimeout);

            sshClient.on('ready', () => {
                if (resolved) return;
                clearTimeout(timeout);

                sshClient.shell({ term: 'xterm-256color' }, (err, stream) => {
                    if (err) {
                        resolved = true;
                        sshClient.end();
                        reject(err);
                        return;
                    }

                    resolved = true;
                    session.sshClient = sshClient;
                    session.stream = stream;
                    session.status = 'connected';
                    session.lastActivity = Date.now();

                    uplink.activeConnections++;
                    uplink.totalConnections++;
                    uplink.stats.successfulConnections++;

                    this._setupStreamHandlers(session, stream, uplink);
                    this._setupKeepAlive(session, sshClient);

                    if (session.ws && session.ws.readyState === 1) {
                        session.ws.send(JSON.stringify({
                            type: 'connected',
                            sessionId: session.id,
                            uplink: uplink.host
                        }));
                    }

                    this.emit('session:connected', { sessionId: session.id, uplink: uplink.host });
                    resolve(session.id);
                });
            });

            sshClient.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    uplink.stats.failedConnections++;
                    reject(err);
                }
            });

            sshClient.on('close', () => {
                if (session.status === 'connected') {
                    this._handleSessionDisconnect(session);
                }
            });

            // Build connection options
            const { host, port, username, password, privateKey } = session.connectionConfig;
            const connectOptions = {
                host: host || uplink.host,
                port: port || uplink.port,
                username: username || uplink.username,
                readyTimeout: this.config.connectionTimeout,
                keepaliveInterval: this.config.keepaliveInterval,
                keepaliveCountMax: this.config.keepaliveCountMax
            };

            if (privateKey) {
                connectOptions.privateKey = privateKey;
            } else if (password) {
                connectOptions.password = password;
            } else if (uplink.privateKey) {
                connectOptions.privateKey = uplink.privateKey;
            } else if (uplink.password) {
                connectOptions.password = uplink.password;
            }

            connectOptions.tryKeyboard = true;

            sshClient.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
                finish([password || uplink.password]);
            });

            try {
                sshClient.connect(connectOptions);
            } catch (err) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(err);
                }
            }
        });
    }

    /**
     * Setup stream handlers for data transfer
     */
    _setupStreamHandlers(session, stream, uplink) {
        stream.on('data', (data) => {
            session.lastActivity = Date.now();
            uplink.stats.bytesTransferred += data.length;
            this.globalStats.bytesTransferred += data.length;

            if (session.ws && session.ws.readyState === 1) {
                session.ws.send(JSON.stringify({
                    type: 'data',
                    data: data.toString('utf8')
                }));
            }
        });

        stream.stderr.on('data', (data) => {
            session.lastActivity = Date.now();

            if (session.ws && session.ws.readyState === 1) {
                session.ws.send(JSON.stringify({
                    type: 'data',
                    data: data.toString('utf8')
                }));
            }
        });

        stream.on('close', () => {
            this._handleSessionDisconnect(session);
        });
    }

    /**
     * Setup aggressive keepalive for session
     */
    _setupKeepAlive(session, sshClient) {
        session.keepAliveTimer = setInterval(() => {
            if (session.status !== 'connected') {
                clearInterval(session.keepAliveTimer);
                return;
            }

            // Send keepalive
            try {
                sshClient.ping((err) => {
                    if (err) {
                        this.log('warn', `Keepalive failed for session ${session.id}`);
                        this._handleSessionDisconnect(session);
                    }
                });
            } catch (e) {
                this._handleSessionDisconnect(session);
            }
        }, this.config.keepaliveInterval);
    }

    /**
     * Handle session disconnect
     */
    _handleSessionDisconnect(session) {
        if (session.status === 'disconnected' || session.status === 'reconnecting') {
            return;
        }

        session.status = 'disconnected';

        const uplink = this.uplinks.get(session.uplinkId);
        if (uplink) {
            uplink.activeConnections = Math.max(0, uplink.activeConnections - 1);
        }

        this.globalStats.activeConnections = Math.max(0, this.globalStats.activeConnections - 1);

        if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
        }

        this.log('info', `Session ${session.id} disconnected`);
        this.emit('session:disconnected', { sessionId: session.id });

        // Attempt reconnection if configured
        if (this.config.sessionPersistence && session.reconnectAttempts < this.config.reconnectAttempts) {
            this._reconnectSession(session.id);
        } else {
            this._closeSession(session.id, 'max_reconnect_attempts');
        }
    }

    /**
     * Reconnect a session
     */
    async _reconnectSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.status = 'reconnecting';
        session.reconnectAttempts++;

        const delay = Math.min(
            this.config.reconnectDelay * Math.pow(2, session.reconnectAttempts - 1),
            this.config.reconnectDelayMax
        );

        this.log('info', `Reconnecting session ${sessionId} in ${delay}ms (attempt ${session.reconnectAttempts})`);

        if (session.ws && session.ws.readyState === 1) {
            session.ws.send(JSON.stringify({
                type: 'reconnecting',
                attempt: session.reconnectAttempts,
                delay
            }));
        }

        setTimeout(async () => {
            if (!this.sessions.has(sessionId)) return;

            const uplink = this._getBestUplink();
            if (!uplink) {
                this.log('warn', `No healthy uplinks for reconnection of session ${sessionId}`);
                setTimeout(() => this._reconnectSession(sessionId), this.config.reconnectDelay);
                return;
            }

            try {
                await this._connectSession(session, uplink);
                session.uplinkId = uplink.id;
                session.reconnectAttempts = 0;
                this.log('info', `Session ${sessionId} reconnected to ${uplink.host}`);
            } catch (error) {
                this.log('warn', `Reconnection failed for session ${sessionId}: ${error.message}`);
                this._reconnectSession(sessionId);
            }
        }, delay);
    }

    /**
     * Write data to a session
     */
    writeToSession(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.stream) {
            return false;
        }

        try {
            session.stream.write(data);
            session.lastActivity = Date.now();
            return true;
        } catch (e) {
            this.log('error', `Write failed for session ${sessionId}: ${e.message}`);
            return false;
        }
    }

    /**
     * Resize terminal for a session
     */
    resizeSession(sessionId, rows, cols) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.stream) {
            return false;
        }

        try {
            session.stream.setWindow(rows, cols, 480, 640);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Close a session
     */
    _closeSession(sessionId, reason = 'unknown') {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        session.status = 'closed';

        if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
        }

        if (session.sshClient) {
            try {
                session.sshClient.end();
            } catch (e) {}
        }

        if (session.ws && session.ws.readyState === 1) {
            session.ws.send(JSON.stringify({ type: 'close', reason }));
        }

        const uplink = this.uplinks.get(session.uplinkId);
        if (uplink) {
            uplink.activeConnections = Math.max(0, uplink.activeConnections - 1);
        }

        this.sessions.delete(sessionId);
        this.emit('session:closed', { sessionId, reason });

        this.log('info', `Session ${sessionId} closed: ${reason}`);
    }

    /**
     * Close session by ID (public method)
     */
    closeSession(sessionId) {
        this._closeSession(sessionId, 'user_requested');
    }

    // ============ CONFIGURATION PERSISTENCE ============

    _getConfigPath() {
        return path.join(__dirname, '..', 'config', 'ssh-uplinks.json');
    }

    _loadUplinkConfig() {
        try {
            const configPath = this._getConfigPath();
            if (fs.existsSync(configPath)) {
                const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (data.uplinks && Array.isArray(data.uplinks)) {
                    data.uplinks.forEach(config => {
                        this.addUplink(config);
                    });
                    this.log('info', `Loaded ${data.uplinks.length} uplinks from config`);
                }
            }
        } catch (e) {
            this.log('warn', `Failed to load uplink config: ${e.message}`);
        }
    }

    _saveUplinkConfig() {
        try {
            const configDir = path.join(__dirname, '..', 'config');
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            const uplinks = [];
            this.uplinks.forEach(uplink => {
                uplinks.push({
                    id: uplink.id,
                    host: uplink.host,
                    port: uplink.port,
                    username: uplink.username,
                    password: uplink.password,
                    privateKey: uplink.privateKey,
                    priority: uplink.priority,
                    weight: uplink.weight
                });
            });

            fs.writeFileSync(
                this._getConfigPath(),
                JSON.stringify({ uplinks, savedAt: new Date().toISOString() }, null, 2)
            );
        } catch (e) {
            this.log('error', `Failed to save uplink config: ${e.message}`);
        }
    }

    // ============ STATISTICS ============

    getStats() {
        const uplinks = this.getUplinks();
        const healthyUplinks = uplinks.filter(u => u.status === 'connected').length;

        return {
            isRunning: this.isRunning,
            uplinks: {
                total: uplinks.length,
                healthy: healthyUplinks,
                unhealthy: uplinks.length - healthyUplinks,
                list: uplinks
            },
            sessions: {
                active: this.globalStats.activeConnections,
                total: this.globalStats.totalConnections
            },
            failovers: this.globalStats.failovers,
            bytesTransferred: this.globalStats.bytesTransferred,
            uptime: Date.now() - this.globalStats.startTime,
            primaryUplink: this.primaryUplink ? this.primaryUplink.host : null
        };
    }
}

// Singleton instance
let instance = null;

function getLoadBalancer(config) {
    if (!instance) {
        instance = new SSHLoadBalancer(config);
    }
    return instance;
}

module.exports = {
    SSHLoadBalancer,
    SSHUplink,
    getLoadBalancer
};
