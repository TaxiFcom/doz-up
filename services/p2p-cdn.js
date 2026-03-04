/**
 * P2P CDN Service
 * Provides torrent-style file distribution via WebRTC
 * Files are chunked and distributed across peers for faster delivery
 */

const crypto = require('crypto');
const EventEmitter = require('events');

// Chunk size for P2P transfer (64KB)
const CHUNK_SIZE = 64 * 1024;

// Peer timeout (5 minutes)
const PEER_TIMEOUT = 5 * 60 * 1000;

// Maximum peers per file
const MAX_PEERS_PER_FILE = 50;

class P2PCDN extends EventEmitter {
    constructor() {
        super();
        // Map of fileId -> Set of peer info
        this.filePeers = new Map();
        // Map of peerId -> peer connection info
        this.peers = new Map();
        // Map of fileId -> file metadata
        this.fileMetadata = new Map();
        // Statistics
        this.stats = {
            totalPeers: 0,
            totalFiles: 0,
            bytesTransferredP2P: 0,
            bytesTransferredServer: 0,
            p2pHits: 0,
            serverFallbacks: 0
        };

        // Cleanup stale peers every minute
        setInterval(() => this.cleanupStalePeers(), 60 * 1000);
    }

    /**
     * Generate file ID from content hash
     */
    generateFileId(buffer) {
        return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 32);
    }

    /**
     * Calculate chunk hashes for integrity verification
     */
    calculateChunkHashes(buffer) {
        const chunks = [];
        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, Math.min(i + CHUNK_SIZE, buffer.length));
            chunks.push({
                index: Math.floor(i / CHUNK_SIZE),
                hash: crypto.createHash('sha256').update(chunk).digest('hex'),
                size: chunk.length
            });
        }
        return chunks;
    }

    /**
     * Register a file for P2P distribution
     */
    registerFile(fileId, metadata) {
        if (!this.fileMetadata.has(fileId)) {
            this.fileMetadata.set(fileId, {
                ...metadata,
                registeredAt: Date.now(),
                downloadCount: 0
            });
            this.filePeers.set(fileId, new Set());
            this.stats.totalFiles++;
            console.log(`[P2P-CDN] Registered file: ${fileId}`);
        }
        return this.fileMetadata.get(fileId);
    }

    /**
     * Announce that a peer has chunks of a file
     */
    announceChunks(peerId, fileId, availableChunks, peerInfo = {}) {
        // Register peer
        this.peers.set(peerId, {
            id: peerId,
            lastSeen: Date.now(),
            files: new Map(),
            ...peerInfo
        });

        // Update peer's file chunks
        const peer = this.peers.get(peerId);
        peer.files.set(fileId, {
            chunks: new Set(availableChunks),
            announcedAt: Date.now()
        });
        peer.lastSeen = Date.now();

        // Add peer to file's peer list
        if (!this.filePeers.has(fileId)) {
            this.filePeers.set(fileId, new Set());
        }
        const filePeers = this.filePeers.get(fileId);
        if (filePeers.size < MAX_PEERS_PER_FILE) {
            filePeers.add(peerId);
        }

        this.stats.totalPeers = this.peers.size;

        return {
            success: true,
            peersForFile: filePeers.size,
            yourChunks: availableChunks.length
        };
    }

    /**
     * Get list of peers that have a specific file
     */
    getPeersForFile(fileId, requestingPeerId = null) {
        const filePeers = this.filePeers.get(fileId);
        if (!filePeers || filePeers.size === 0) {
            return [];
        }

        const peerList = [];
        for (const peerId of filePeers) {
            if (peerId === requestingPeerId) continue;

            const peer = this.peers.get(peerId);
            if (!peer) continue;

            const fileInfo = peer.files.get(fileId);
            if (!fileInfo) continue;

            // Check if peer is still active
            if (Date.now() - peer.lastSeen > PEER_TIMEOUT) {
                continue;
            }

            peerList.push({
                peerId: peer.id,
                chunks: Array.from(fileInfo.chunks),
                chunkCount: fileInfo.chunks.size,
                lastSeen: peer.lastSeen
            });
        }

        // Sort by chunk count (peers with more chunks first)
        peerList.sort((a, b) => b.chunkCount - a.chunkCount);

        return peerList.slice(0, 10); // Return top 10 peers
    }

    /**
     * Get optimal download strategy
     */
    getDownloadStrategy(fileId, requestingPeerId = null) {
        const metadata = this.fileMetadata.get(fileId);
        const peers = this.getPeersForFile(fileId, requestingPeerId);

        if (!metadata) {
            return {
                strategy: 'server',
                reason: 'File not registered for P2P'
            };
        }

        if (peers.length === 0) {
            this.stats.serverFallbacks++;
            return {
                strategy: 'server',
                reason: 'No peers available',
                serverUrl: metadata.serverUrl
            };
        }

        // Calculate which chunks are available from peers
        const availableChunks = new Map();
        for (const peer of peers) {
            for (const chunkIndex of peer.chunks) {
                if (!availableChunks.has(chunkIndex)) {
                    availableChunks.set(chunkIndex, []);
                }
                availableChunks.get(chunkIndex).push(peer.peerId);
            }
        }

        const totalChunks = metadata.chunkCount || Math.ceil(metadata.size / CHUNK_SIZE);
        const p2pCoverage = availableChunks.size / totalChunks;

        if (p2pCoverage >= 0.8) {
            // 80%+ chunks available from peers - use P2P primarily
            this.stats.p2pHits++;
            return {
                strategy: 'p2p',
                reason: `${Math.round(p2pCoverage * 100)}% available from peers`,
                peers: peers,
                chunkMap: Object.fromEntries(availableChunks),
                missingChunks: this.getMissingChunks(availableChunks, totalChunks),
                serverFallbackUrl: metadata.serverUrl
            };
        } else if (p2pCoverage >= 0.3) {
            // Partial P2P - use hybrid approach
            return {
                strategy: 'hybrid',
                reason: `${Math.round(p2pCoverage * 100)}% from peers, rest from server`,
                peers: peers,
                chunkMap: Object.fromEntries(availableChunks),
                missingChunks: this.getMissingChunks(availableChunks, totalChunks),
                serverFallbackUrl: metadata.serverUrl
            };
        } else {
            // Not enough peers - server fallback
            this.stats.serverFallbacks++;
            return {
                strategy: 'server',
                reason: 'Insufficient peer coverage',
                serverUrl: metadata.serverUrl,
                p2pCoverage: Math.round(p2pCoverage * 100)
            };
        }
    }

    /**
     * Get missing chunks not available from peers
     */
    getMissingChunks(availableChunks, totalChunks) {
        const missing = [];
        for (let i = 0; i < totalChunks; i++) {
            if (!availableChunks.has(i)) {
                missing.push(i);
            }
        }
        return missing;
    }

    /**
     * Record successful P2P transfer
     */
    recordP2PTransfer(fileId, fromPeerId, toPeerId, bytes) {
        this.stats.bytesTransferredP2P += bytes;

        // Update file download count
        const metadata = this.fileMetadata.get(fileId);
        if (metadata) {
            metadata.downloadCount++;
        }

        this.emit('p2p-transfer', {
            fileId,
            fromPeerId,
            toPeerId,
            bytes,
            timestamp: Date.now()
        });
    }

    /**
     * Record server fallback transfer
     */
    recordServerTransfer(fileId, bytes) {
        this.stats.bytesTransferredServer += bytes;
    }

    /**
     * Handle WebRTC signaling
     */
    handleSignal(fromPeerId, toPeerId, signal) {
        const targetPeer = this.peers.get(toPeerId);
        if (targetPeer && targetPeer.ws) {
            targetPeer.ws.send(JSON.stringify({
                type: 'p2p-signal',
                fromPeerId,
                signal
            }));
            return { success: true };
        }
        return { success: false, error: 'Target peer not found' };
    }

    /**
     * Remove a peer
     */
    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            // Remove from all file peer lists
            for (const fileId of peer.files.keys()) {
                const filePeers = this.filePeers.get(fileId);
                if (filePeers) {
                    filePeers.delete(peerId);
                }
            }
            this.peers.delete(peerId);
            this.stats.totalPeers = this.peers.size;
        }
    }

    /**
     * Cleanup stale peers
     */
    cleanupStalePeers() {
        const now = Date.now();
        let cleaned = 0;

        for (const [peerId, peer] of this.peers.entries()) {
            if (now - peer.lastSeen > PEER_TIMEOUT) {
                this.removePeer(peerId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[P2P-CDN] Cleaned up ${cleaned} stale peers`);
        }
    }

    /**
     * Get CDN statistics
     */
    getStats() {
        const p2pRatio = this.stats.bytesTransferredP2P + this.stats.bytesTransferredServer > 0
            ? this.stats.bytesTransferredP2P / (this.stats.bytesTransferredP2P + this.stats.bytesTransferredServer)
            : 0;

        return {
            ...this.stats,
            p2pRatio: Math.round(p2pRatio * 100),
            activePeers: this.peers.size,
            registeredFiles: this.fileMetadata.size,
            bytesTransferredP2PMB: Math.round(this.stats.bytesTransferredP2P / 1024 / 1024 * 100) / 100,
            bytesTransferredServerMB: Math.round(this.stats.bytesTransferredServer / 1024 / 1024 * 100) / 100,
            bandwidthSaved: Math.round(this.stats.bytesTransferredP2P / 1024 / 1024 * 100) / 100 + ' MB'
        };
    }

    /**
     * Get file info for client
     */
    getFileInfo(fileId) {
        const metadata = this.fileMetadata.get(fileId);
        if (!metadata) {
            return null;
        }

        const peers = this.getPeersForFile(fileId);
        return {
            fileId,
            ...metadata,
            peerCount: peers.length,
            p2pAvailable: peers.length > 0
        };
    }
}

// Singleton instance
const p2pCDN = new P2PCDN();

module.exports = p2pCDN;
module.exports.P2PCDN = P2PCDN;
module.exports.CHUNK_SIZE = CHUNK_SIZE;
