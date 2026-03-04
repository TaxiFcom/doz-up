/**
 * DOZ UP P2P CDN Client
 * Browser-side WebRTC peer-to-peer file transfer
 */

class P2PClient {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || window.location.origin;
        this.peerId = options.peerId || this.generatePeerId();
        this.peers = new Map(); // peerId -> RTCPeerConnection
        this.dataChannels = new Map(); // peerId -> RTCDataChannel
        this.fileChunks = new Map(); // fileId -> Map(chunkIndex -> chunk)
        this.pendingRequests = new Map(); // requestId -> { resolve, reject }
        this.onProgress = options.onProgress || (() => {});
        this.onPeerConnected = options.onPeerConnected || (() => {});
        this.onPeerDisconnected = options.onPeerDisconnected || (() => {});

        this.CHUNK_SIZE = 64 * 1024; // 64KB chunks

        // ICE servers for NAT traversal
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];

        // Announce ourselves periodically
        this.announceInterval = setInterval(() => this.announceAllFiles(), 30000);

        console.log('[P2P] Client initialized with peerId:', this.peerId);
    }

    generatePeerId() {
        return 'peer-' + Math.random().toString(36).substring(2, 15) +
               Math.random().toString(36).substring(2, 15);
    }

    /**
     * Fetch with P2P optimization
     * Tries to get file from peers first, falls back to server
     */
    async fetchWithP2P(fileId, serverUrl) {
        try {
            // Get download strategy from server
            const strategyRes = await fetch(`${this.serverUrl}/api/p2p/strategy/${fileId}`, {
                headers: { 'X-Peer-Id': this.peerId }
            });
            const strategy = await strategyRes.json();

            console.log('[P2P] Download strategy:', strategy.strategy, '-', strategy.reason);

            if (strategy.strategy === 'p2p' || strategy.strategy === 'hybrid') {
                return await this.downloadFromPeers(fileId, strategy);
            } else {
                return await this.downloadFromServer(serverUrl || strategy.serverUrl);
            }
        } catch (error) {
            console.warn('[P2P] Strategy fetch failed, falling back to server:', error);
            return await this.downloadFromServer(serverUrl);
        }
    }

    /**
     * Download file from peers
     */
    async downloadFromPeers(fileId, strategy) {
        const totalChunks = Object.keys(strategy.chunkMap).length + strategy.missingChunks.length;
        const receivedChunks = new Map();
        let downloadedBytes = 0;

        // Download available chunks from peers
        for (const [chunkIndex, peerIds] of Object.entries(strategy.chunkMap)) {
            for (const peerId of peerIds) {
                try {
                    const chunk = await this.requestChunkFromPeer(peerId, fileId, parseInt(chunkIndex));
                    if (chunk) {
                        receivedChunks.set(parseInt(chunkIndex), chunk);
                        downloadedBytes += chunk.byteLength;
                        this.onProgress({
                            type: 'p2p',
                            fileId,
                            received: receivedChunks.size,
                            total: totalChunks,
                            bytes: downloadedBytes
                        });
                        break; // Got chunk, move to next
                    }
                } catch (e) {
                    console.warn(`[P2P] Failed to get chunk ${chunkIndex} from ${peerId}:`, e);
                }
            }
        }

        // Download missing chunks from server
        if (strategy.missingChunks.length > 0 && strategy.serverFallbackUrl) {
            console.log(`[P2P] Fetching ${strategy.missingChunks.length} missing chunks from server`);
            const serverData = await this.downloadFromServer(strategy.serverFallbackUrl);

            // Extract missing chunks
            for (const chunkIndex of strategy.missingChunks) {
                const start = chunkIndex * this.CHUNK_SIZE;
                const end = Math.min(start + this.CHUNK_SIZE, serverData.byteLength);
                receivedChunks.set(chunkIndex, serverData.slice(start, end));
            }
        }

        // Reassemble file
        const fileBuffer = this.reassembleFile(receivedChunks, totalChunks);

        // Announce that we now have this file
        this.announceFile(fileId, totalChunks);

        // Report transfer to server
        await fetch(`${this.serverUrl}/api/p2p/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileId,
                fromPeerId: 'multiple',
                toPeerId: this.peerId,
                bytes: downloadedBytes
            })
        }).catch(() => {});

        return fileBuffer;
    }

    /**
     * Download file from server
     */
    async downloadFromServer(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Server download failed: ${response.status}`);
        }
        return await response.arrayBuffer();
    }

    /**
     * Request a specific chunk from a peer
     */
    async requestChunkFromPeer(peerId, fileId, chunkIndex) {
        // Ensure connection to peer
        if (!this.peers.has(peerId)) {
            await this.connectToPeer(peerId);
        }

        const channel = this.dataChannels.get(peerId);
        if (!channel || channel.readyState !== 'open') {
            throw new Error('No open channel to peer');
        }

        return new Promise((resolve, reject) => {
            const requestId = `${fileId}-${chunkIndex}-${Date.now()}`;
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('Request timeout'));
            }, 10000);

            this.pendingRequests.set(requestId, {
                resolve: (data) => {
                    clearTimeout(timeout);
                    this.pendingRequests.delete(requestId);
                    resolve(data);
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    this.pendingRequests.delete(requestId);
                    reject(err);
                }
            });

            channel.send(JSON.stringify({
                type: 'request-chunk',
                requestId,
                fileId,
                chunkIndex
            }));
        });
    }

    /**
     * Connect to a peer via WebRTC
     */
    async connectToPeer(peerId) {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this.peers.set(peerId, pc);

        // Create data channel
        const channel = pc.createDataChannel('p2p-transfer');
        this.setupDataChannel(channel, peerId);

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(peerId, { type: 'ice', candidate: event.candidate });
            }
        };

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.sendSignal(peerId, { type: 'offer', sdp: pc.localDescription });

        // Wait for connection
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15000);
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'connected') {
                    clearTimeout(timeout);
                    this.onPeerConnected(peerId);
                    resolve();
                } else if (pc.connectionState === 'failed') {
                    clearTimeout(timeout);
                    reject(new Error('Connection failed'));
                }
            };
        });
    }

    /**
     * Handle incoming WebRTC signal
     */
    async handleSignal(fromPeerId, signal) {
        let pc = this.peers.get(fromPeerId);

        if (signal.type === 'offer') {
            pc = new RTCPeerConnection({ iceServers: this.iceServers });
            this.peers.set(fromPeerId, pc);

            pc.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, fromPeerId);
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendSignal(fromPeerId, { type: 'ice', candidate: event.candidate });
                }
            };

            await pc.setRemoteDescription(signal.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this.sendSignal(fromPeerId, { type: 'answer', sdp: pc.localDescription });
        } else if (signal.type === 'answer' && pc) {
            await pc.setRemoteDescription(signal.sdp);
        } else if (signal.type === 'ice' && pc) {
            await pc.addIceCandidate(signal.candidate);
        }
    }

    /**
     * Setup data channel handlers
     */
    setupDataChannel(channel, peerId) {
        channel.binaryType = 'arraybuffer';
        this.dataChannels.set(peerId, channel);

        channel.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const msg = JSON.parse(event.data);
                this.handleMessage(peerId, msg);
            } else {
                // Binary chunk data
                this.handleChunkData(peerId, event.data);
            }
        };

        channel.onclose = () => {
            this.dataChannels.delete(peerId);
            this.onPeerDisconnected(peerId);
        };
    }

    /**
     * Handle incoming messages
     */
    handleMessage(fromPeerId, msg) {
        if (msg.type === 'request-chunk') {
            this.sendChunk(fromPeerId, msg.fileId, msg.chunkIndex, msg.requestId);
        } else if (msg.type === 'chunk-response') {
            const pending = this.pendingRequests.get(msg.requestId);
            if (pending) {
                if (msg.error) {
                    pending.reject(new Error(msg.error));
                }
                // Actual data will come as binary
            }
        } else if (msg.type === 'chunk-data') {
            const pending = this.pendingRequests.get(msg.requestId);
            if (pending && this.pendingChunkData) {
                pending.resolve(this.pendingChunkData);
                this.pendingChunkData = null;
            }
        }
    }

    /**
     * Handle incoming chunk data
     */
    handleChunkData(fromPeerId, data) {
        this.pendingChunkData = data;
    }

    /**
     * Send a chunk to a peer
     */
    sendChunk(toPeerId, fileId, chunkIndex, requestId) {
        const fileChunks = this.fileChunks.get(fileId);
        const channel = this.dataChannels.get(toPeerId);

        if (!fileChunks || !fileChunks.has(chunkIndex) || !channel) {
            channel?.send(JSON.stringify({
                type: 'chunk-response',
                requestId,
                error: 'Chunk not available'
            }));
            return;
        }

        const chunk = fileChunks.get(chunkIndex);

        // Send metadata first
        channel.send(JSON.stringify({
            type: 'chunk-response',
            requestId,
            chunkIndex,
            size: chunk.byteLength
        }));

        // Send binary data
        channel.send(chunk);

        // Send completion
        channel.send(JSON.stringify({
            type: 'chunk-data',
            requestId
        }));
    }

    /**
     * Send WebRTC signal via server
     */
    async sendSignal(toPeerId, signal) {
        // This would use WebSocket in production
        // For now, we'll use a simple polling mechanism
        console.log('[P2P] Sending signal to', toPeerId, signal.type);
    }

    /**
     * Store a file for seeding
     */
    async seedFile(fileId, buffer) {
        const chunks = new Map();
        for (let i = 0; i < buffer.byteLength; i += this.CHUNK_SIZE) {
            const chunkIndex = Math.floor(i / this.CHUNK_SIZE);
            const chunk = buffer.slice(i, Math.min(i + this.CHUNK_SIZE, buffer.byteLength));
            chunks.set(chunkIndex, chunk);
        }
        this.fileChunks.set(fileId, chunks);

        // Announce to server
        await this.announceFile(fileId, chunks.size);

        console.log(`[P2P] Seeding file ${fileId} with ${chunks.size} chunks`);
    }

    /**
     * Announce file to server
     */
    async announceFile(fileId, chunkCount) {
        const chunks = Array.from({ length: chunkCount }, (_, i) => i);

        await fetch(`${this.serverUrl}/api/p2p/announce`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Peer-Id': this.peerId
            },
            body: JSON.stringify({
                fileId,
                chunks,
                peerInfo: {
                    userAgent: navigator.userAgent
                }
            })
        }).catch(e => console.warn('[P2P] Announce failed:', e));
    }

    /**
     * Announce all seeded files
     */
    async announceAllFiles() {
        for (const [fileId, chunks] of this.fileChunks) {
            await this.announceFile(fileId, chunks.size);
        }
    }

    /**
     * Reassemble file from chunks
     */
    reassembleFile(chunks, totalChunks) {
        const sortedChunks = [];
        for (let i = 0; i < totalChunks; i++) {
            if (chunks.has(i)) {
                sortedChunks.push(chunks.get(i));
            }
        }

        // Calculate total size
        const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const result = new Uint8Array(totalSize);

        let offset = 0;
        for (const chunk of sortedChunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        return result.buffer;
    }

    /**
     * Cleanup on disconnect
     */
    destroy() {
        clearInterval(this.announceInterval);

        // Close all peer connections
        for (const pc of this.peers.values()) {
            pc.close();
        }
        this.peers.clear();
        this.dataChannels.clear();

        // Notify server
        fetch(`${this.serverUrl}/api/p2p/leave`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Peer-Id': this.peerId
            },
            body: JSON.stringify({ peerId: this.peerId })
        }).catch(() => {});

        console.log('[P2P] Client destroyed');
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = P2PClient;
} else {
    window.P2PClient = P2PClient;
}
