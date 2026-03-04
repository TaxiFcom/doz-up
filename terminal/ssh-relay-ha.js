/**
 * DOZ Terminal - High Availability SSH Relay Service
 * WebSocket to SSH with load balancing and 100% uptime
 */

const WebSocket = require('ws');
const { getLoadBalancer } = require('../services/ssh-loadbalancer');

class SSHRelayHA {
    constructor(server, path = '/terminal/ssh') {
        this.wss = new WebSocket.Server({ server, path });
        this.loadBalancer = getLoadBalancer();
        this.connections = new Map(); // ws -> sessionId

        // Start load balancer
        this.loadBalancer.start();

        // Setup WebSocket server
        this.wss.on('connection', (ws) => this.handleConnection(ws));

        // Load balancer events
        this.loadBalancer.on('session:disconnected', ({ sessionId }) => {
            this._notifyReconnecting(sessionId);
        });

        this.loadBalancer.on('session:connected', ({ sessionId, uplink }) => {
            this._notifyConnected(sessionId, uplink);
        });

        console.log(`[SSH Relay HA] Started on ${path}`);
        console.log(`[SSH Relay HA] Load balancer initialized with ${this.loadBalancer.getUplinks().length} uplinks`);
    }

    handleConnection(ws) {
        const connectionId = Date.now().toString();
        let sessionId = null;

        console.log(`[SSH Relay HA] New WebSocket connection: ${connectionId}`);

        ws.on('message', async (message) => {
            try {
                const msg = JSON.parse(message);

                switch (msg.type) {
                    case 'connect':
                        sessionId = await this._handleConnect(ws, msg, connectionId);
                        if (sessionId) {
                            this.connections.set(ws, sessionId);
                        }
                        break;

                    case 'data':
                        if (sessionId) {
                            this.loadBalancer.writeToSession(sessionId, msg.data);
                        }
                        break;

                    case 'resize':
                        if (sessionId) {
                            this.loadBalancer.resizeSession(sessionId, msg.rows, msg.cols);
                        }
                        break;

                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                        break;
                }
            } catch (e) {
                console.error(`[SSH Relay HA] Message error:`, e.message);
                ws.send(JSON.stringify({ type: 'error', message: e.message }));
            }
        });

        ws.on('close', () => {
            console.log(`[SSH Relay HA] WebSocket closed: ${connectionId}`);
            if (sessionId) {
                this.loadBalancer.closeSession(sessionId);
                this.connections.delete(ws);
            }
        });

        ws.on('error', (err) => {
            console.error(`[SSH Relay HA] WebSocket error:`, err.message);
        });

        // Send ready status with uplink info
        ws.send(JSON.stringify({
            type: 'ready',
            uplinks: this.loadBalancer.getUplinks().map(u => ({
                host: u.host,
                status: u.status,
                healthScore: u.healthScore
            }))
        }));
    }

    async _handleConnect(ws, config, connectionId) {
        const { host, port, username, password, privateKey } = config;

        console.log(`[SSH Relay HA] Connecting ${username}@${host}:${port} (${connectionId})`);

        try {
            const sessionId = await this.loadBalancer.createSession({
                host,
                port: port || 22,
                username,
                password,
                privateKey
            }, ws);

            console.log(`[SSH Relay HA] Session created: ${sessionId}`);
            return sessionId;

        } catch (error) {
            console.error(`[SSH Relay HA] Connection failed:`, error.message);

            let errorMsg = error.message;

            // Friendly error messages
            if (error.message.includes('ECONNREFUSED')) {
                errorMsg = 'Connection refused - check host and port';
            } else if (error.message.includes('ETIMEDOUT')) {
                errorMsg = 'Connection timed out - host may be unreachable';
            } else if (error.message.includes('ENOTFOUND')) {
                errorMsg = 'Host not found - check the hostname';
            } else if (error.message.includes('authentication')) {
                errorMsg = 'Authentication failed - check username/password';
            } else if (error.message.includes('No healthy uplinks')) {
                errorMsg = 'No SSH servers available - please try again';
            }

            ws.send(JSON.stringify({ type: 'error', message: errorMsg }));
            return null;
        }
    }

    _notifyReconnecting(sessionId) {
        this.connections.forEach((sid, ws) => {
            if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'status',
                    status: 'reconnecting',
                    message: 'Connection lost, attempting to reconnect...'
                }));
            }
        });
    }

    _notifyConnected(sessionId, uplink) {
        this.connections.forEach((sid, ws) => {
            if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'status',
                    status: 'reconnected',
                    message: `Reconnected to ${uplink}`
                }));
            }
        });
    }

    getStats() {
        return {
            activeConnections: this.connections.size,
            loadBalancer: this.loadBalancer.getStats()
        };
    }

    // ============ UPLINK MANAGEMENT API ============

    addUplink(config) {
        return this.loadBalancer.addUplink(config);
    }

    removeUplink(id) {
        return this.loadBalancer.removeUplink(id);
    }

    getUplinks() {
        return this.loadBalancer.getUplinks();
    }
}

module.exports = SSHRelayHA;
