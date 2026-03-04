/**
 * DOZ Terminal - SSH Relay Service
 * Handles WebSocket to SSH connections
 */

const WebSocket = require('ws');
const { Client } = require('ssh2');

class SSHRelay {
    constructor(server, path = '/terminal/ssh') {
        this.wss = new WebSocket.Server({ server, path });
        this.connections = new Map();

        this.wss.on('connection', (ws) => this.handleConnection(ws));

        console.log(`[SSH Relay] Started on ${path}`);
    }

    handleConnection(ws) {
        const connectionId = Date.now().toString();
        let sshClient = null;
        let stream = null;

        console.log(`[SSH Relay] New WebSocket connection: ${connectionId}`);

        ws.on('message', (message) => {
            try {
                const msg = JSON.parse(message);

                switch (msg.type) {
                    case 'connect':
                        this.connectSSH(ws, msg, connectionId, (client, sshStream) => {
                            sshClient = client;
                            stream = sshStream;
                        });
                        break;

                    case 'data':
                        if (stream) {
                            stream.write(msg.data);
                        }
                        break;

                    case 'resize':
                        if (stream) {
                            stream.setWindow(msg.rows, msg.cols, 480, 640);
                        }
                        break;
                }
            } catch (e) {
                console.error(`[SSH Relay] Message error:`, e.message);
            }
        });

        ws.on('close', () => {
            console.log(`[SSH Relay] WebSocket closed: ${connectionId}`);
            if (sshClient) {
                sshClient.end();
            }
            this.connections.delete(connectionId);
        });

        ws.on('error', (err) => {
            console.error(`[SSH Relay] WebSocket error:`, err.message);
        });
    }

    connectSSH(ws, config, connectionId, callback) {
        const { host, port, username, password, privateKey } = config;

        console.log(`[SSH Relay] Connecting to ${username}@${host}:${port}`);

        const sshClient = new Client();

        sshClient.on('ready', () => {
            console.log(`[SSH Relay] SSH connected to ${host}`);

            sshClient.shell({ term: 'xterm-256color' }, (err, stream) => {
                if (err) {
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                    return;
                }

                ws.send(JSON.stringify({ type: 'connected' }));

                stream.on('data', (data) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'data', data: data.toString('utf8') }));
                    }
                });

                stream.on('close', () => {
                    ws.send(JSON.stringify({ type: 'close' }));
                    sshClient.end();
                });

                stream.stderr.on('data', (data) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'data', data: data.toString('utf8') }));
                    }
                });

                this.connections.set(connectionId, { sshClient, stream, ws });
                callback(sshClient, stream);
            });
        });

        sshClient.on('error', (err) => {
            console.error(`[SSH Relay] SSH error:`, err.message);
            let errorMsg = err.message;

            // Friendly error messages
            if (err.message.includes('ECONNREFUSED')) {
                errorMsg = 'Connection refused - check host and port';
            } else if (err.message.includes('ETIMEDOUT')) {
                errorMsg = 'Connection timed out - host may be unreachable';
            } else if (err.message.includes('ENOTFOUND')) {
                errorMsg = 'Host not found - check the hostname';
            } else if (err.message.includes('authentication')) {
                errorMsg = 'Authentication failed - check username/password';
            }

            ws.send(JSON.stringify({ type: 'error', message: errorMsg }));
        });

        sshClient.on('close', () => {
            console.log(`[SSH Relay] SSH closed for ${connectionId}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'close' }));
            }
        });

        // Connection options
        const connectOptions = {
            host,
            port: port || 22,
            username,
            readyTimeout: 10000,
            keepaliveInterval: 30000
        };

        // Add authentication
        if (privateKey) {
            connectOptions.privateKey = privateKey;
        } else if (password) {
            connectOptions.password = password;
        }

        // Try keyboard-interactive as fallback
        connectOptions.tryKeyboard = true;

        sshClient.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
            // Respond with password for keyboard-interactive
            finish([password]);
        });

        sshClient.connect(connectOptions);
    }

    getStats() {
        return {
            activeConnections: this.connections.size,
            connections: Array.from(this.connections.keys())
        };
    }
}

module.exports = SSHRelay;
