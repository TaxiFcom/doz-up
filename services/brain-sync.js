/**
 * DOZ UP Brain - Neural Mesh Sync System
 * Real-time encrypted sync across all devices
 * Target latency: 333ms
 */

const crypto = require('crypto');
const WebSocket = require('ws');

// Encryption configuration
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Sync configuration
const SYNC_LATENCY_TARGET = 333; // milliseconds
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const RECONNECT_BASE_DELAY = 1000; // 1 second base for exponential backoff

class BrainSync {
    constructor() {
        // Connected devices mesh
        this.mesh = new Map(); // deviceId -> { ws, userId, platform, encryptionKey, lastSync }

        // User device groups
        this.userDevices = new Map(); // userId -> Set<deviceId>

        // Sync queues for offline devices
        this.syncQueues = new Map(); // deviceId -> Array<syncEvent>

        // Performance metrics
        this.metrics = {
            totalSyncs: 0,
            averageLatency: 0,
            connectedDevices: 0
        };

        console.log('[Brain] DOZ UP Brain initialized - Neural Mesh Sync System');
    }

    /**
     * Generate encryption key for device pairing
     */
    generateDeviceKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Encrypt payload with AES-256-GCM
     */
    encrypt(data, keyHex) {
        const key = Buffer.from(keyHex, 'hex');
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        return {
            iv: iv.toString('hex'),
            data: encrypted,
            tag: authTag.toString('hex')
        };
    }

    /**
     * Decrypt payload with AES-256-GCM
     */
    decrypt(encryptedPayload, keyHex) {
        try {
            const key = Buffer.from(keyHex, 'hex');
            const iv = Buffer.from(encryptedPayload.iv, 'hex');
            const authTag = Buffer.from(encryptedPayload.tag, 'hex');

            const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encryptedPayload.data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return JSON.parse(decrypted);
        } catch (error) {
            console.error('[Brain] Decryption failed:', error.message);
            return null;
        }
    }

    /**
     * Register device to the mesh network
     */
    registerDevice(ws, deviceId, userId, platform, encryptionKey) {
        const device = {
            ws,
            userId,
            platform,
            encryptionKey: encryptionKey || this.generateDeviceKey(),
            lastSync: Date.now(),
            connectedAt: Date.now()
        };

        this.mesh.set(deviceId, device);

        // Add to user's device group
        if (!this.userDevices.has(userId)) {
            this.userDevices.set(userId, new Set());
        }
        this.userDevices.get(userId).add(deviceId);

        this.metrics.connectedDevices = this.mesh.size;

        console.log(`[Brain] Device registered: ${deviceId} (${platform}) for user ${userId}`);
        console.log(`[Brain] Mesh size: ${this.mesh.size} devices`);

        // Process queued sync events
        this.processQueue(deviceId);

        // Return encryption key for secure communication
        return device.encryptionKey;
    }

    /**
     * Unregister device from mesh
     */
    unregisterDevice(deviceId) {
        const device = this.mesh.get(deviceId);
        if (device) {
            const userDevices = this.userDevices.get(device.userId);
            if (userDevices) {
                userDevices.delete(deviceId);
                if (userDevices.size === 0) {
                    this.userDevices.delete(device.userId);
                }
            }
            this.mesh.delete(deviceId);
            this.metrics.connectedDevices = this.mesh.size;
            console.log(`[Brain] Device unregistered: ${deviceId}`);
        }
    }

    /**
     * Broadcast sync event to all user's devices
     */
    broadcastToUser(userId, event, excludeDeviceId = null) {
        const startTime = Date.now();
        const userDevices = this.userDevices.get(userId);

        if (!userDevices || userDevices.size === 0) {
            console.log(`[Brain] No devices online for user ${userId}`);
            return 0;
        }

        let sentCount = 0;

        for (const deviceId of userDevices) {
            if (deviceId === excludeDeviceId) continue;

            const device = this.mesh.get(deviceId);
            if (device && device.ws.readyState === WebSocket.OPEN) {
                try {
                    // Encrypt the event payload
                    const encrypted = this.encrypt(event, device.encryptionKey);

                    device.ws.send(JSON.stringify({
                        type: 'sync',
                        encrypted: true,
                        payload: encrypted,
                        timestamp: Date.now()
                    }));

                    sentCount++;
                    device.lastSync = Date.now();
                } catch (error) {
                    console.error(`[Brain] Failed to send to device ${deviceId}:`, error.message);
                }
            } else {
                // Queue for offline device
                this.queueEvent(deviceId, event);
            }
        }

        // Track latency
        const latency = Date.now() - startTime;
        this.updateLatencyMetrics(latency);

        this.metrics.totalSyncs++;

        console.log(`[Brain] Broadcast to ${sentCount}/${userDevices.size} devices in ${latency}ms`);

        return sentCount;
    }

    /**
     * Queue sync event for offline device
     */
    queueEvent(deviceId, event) {
        if (!this.syncQueues.has(deviceId)) {
            this.syncQueues.set(deviceId, []);
        }

        const queue = this.syncQueues.get(deviceId);
        queue.push({
            event,
            timestamp: Date.now()
        });

        // Limit queue size (keep last 100 events)
        if (queue.length > 100) {
            queue.shift();
        }
    }

    /**
     * Process queued events when device reconnects
     */
    processQueue(deviceId) {
        const queue = this.syncQueues.get(deviceId);
        if (!queue || queue.length === 0) return;

        const device = this.mesh.get(deviceId);
        if (!device || device.ws.readyState !== WebSocket.OPEN) return;

        console.log(`[Brain] Processing ${queue.length} queued events for device ${deviceId}`);

        // Send all queued events
        for (const item of queue) {
            try {
                const encrypted = this.encrypt(item.event, device.encryptionKey);
                device.ws.send(JSON.stringify({
                    type: 'sync-queue',
                    encrypted: true,
                    payload: encrypted,
                    originalTimestamp: item.timestamp,
                    timestamp: Date.now()
                }));
            } catch (error) {
                console.error(`[Brain] Failed to send queued event:`, error.message);
            }
        }

        // Clear queue
        this.syncQueues.delete(deviceId);
    }

    /**
     * Update latency metrics
     */
    updateLatencyMetrics(latency) {
        const alpha = 0.1; // Exponential moving average factor
        this.metrics.averageLatency =
            this.metrics.averageLatency * (1 - alpha) + latency * alpha;
    }

    /**
     * Handle incoming sync event from device
     */
    handleSyncEvent(deviceId, encryptedPayload) {
        const device = this.mesh.get(deviceId);
        if (!device) {
            console.error(`[Brain] Unknown device: ${deviceId}`);
            return false;
        }

        // Decrypt the payload
        const event = this.decrypt(encryptedPayload, device.encryptionKey);
        if (!event) {
            console.error(`[Brain] Failed to decrypt event from ${deviceId}`);
            return false;
        }

        // Broadcast to other devices of the same user
        this.broadcastToUser(device.userId, event, deviceId);

        return true;
    }

    /**
     * Sync specific data types
     */
    syncUpload(userId, uploadData, sourceDeviceId) {
        const event = {
            type: 'upload',
            data: uploadData,
            source: sourceDeviceId,
            timestamp: Date.now()
        };
        return this.broadcastToUser(userId, event, sourceDeviceId);
    }

    syncSettings(userId, settings, sourceDeviceId) {
        const event = {
            type: 'settings',
            data: settings,
            source: sourceDeviceId,
            timestamp: Date.now()
        };
        return this.broadcastToUser(userId, event, sourceDeviceId);
    }

    syncClipboard(userId, clipboardData, sourceDeviceId) {
        const event = {
            type: 'clipboard',
            data: clipboardData,
            source: sourceDeviceId,
            timestamp: Date.now()
        };
        return this.broadcastToUser(userId, event, sourceDeviceId);
    }

    syncActivity(userId, activity, sourceDeviceId) {
        const event = {
            type: 'activity',
            data: activity,
            source: sourceDeviceId,
            timestamp: Date.now()
        };
        return this.broadcastToUser(userId, event, sourceDeviceId);
    }

    /**
     * Get mesh status
     */
    getStatus() {
        return {
            connectedDevices: this.mesh.size,
            activeUsers: this.userDevices.size,
            totalSyncs: this.metrics.totalSyncs,
            averageLatency: Math.round(this.metrics.averageLatency),
            targetLatency: SYNC_LATENCY_TARGET,
            queuedEvents: Array.from(this.syncQueues.values()).reduce((sum, q) => sum + q.length, 0)
        };
    }

    /**
     * Get user's connected devices
     */
    getUserDevices(userId) {
        const deviceIds = this.userDevices.get(userId);
        if (!deviceIds) return [];

        return Array.from(deviceIds).map(deviceId => {
            const device = this.mesh.get(deviceId);
            return {
                deviceId,
                platform: device?.platform,
                lastSync: device?.lastSync,
                connectedAt: device?.connectedAt,
                online: device?.ws.readyState === WebSocket.OPEN
            };
        });
    }
}

// Singleton instance
const brainSync = new BrainSync();

module.exports = brainSync;
