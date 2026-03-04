/**
 * DOZ UP - Leader Election Service
 * Prevents duplicate scheduled tasks across PM2 cluster instances
 * Uses Redis for distributed locking with file-based fallback
 */

const fs = require('fs');
const path = require('path');

// Try to load Redis, fall back to file-based locking if not available
let redis = null;
try {
    const redisModule = require('../infrastructure/cache/redis');
    redis = redisModule.redis;
} catch (e) {
    console.log('[LeaderElection] Redis not available, using file-based fallback');
}

const dataDir = path.join(__dirname, '..', 'data');
const lockDir = path.join(dataDir, 'locks');

// Ensure lock directory exists for file-based fallback
if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
}

class LeaderElection {
    /**
     * Create a leader election instance
     * @param {string} name - Unique name for this leadership group (e.g., 'scheduler')
     * @param {number} ttl - Lock TTL in milliseconds (default 30 seconds)
     */
    constructor(name, ttl = 30000) {
        this.name = name;
        this.lockKey = `leader:${name}`;
        this.ttl = ttl;
        this.isLeader = false;
        this.heartbeatInterval = null;
        this.instanceId = `${process.pid}-${Date.now()}`;
        this.lockFilePath = path.join(lockDir, `${name}.lock`);
    }

    /**
     * Try to become the leader
     * @returns {Promise<boolean>} True if this instance is now the leader
     */
    async tryBecomeLeader() {
        try {
            if (redis && redis.status === 'ready') {
                return await this._tryRedisLock();
            } else {
                return this._tryFileLock();
            }
        } catch (error) {
            console.error(`[LeaderElection] Error acquiring lock for ${this.name}:`, error.message);
            return false;
        }
    }

    /**
     * Redis-based distributed lock
     */
    async _tryRedisLock() {
        // Use SET NX PX for atomic lock acquisition
        const acquired = await redis.set(
            this.lockKey,
            this.instanceId,
            'NX',
            'PX',
            this.ttl
        );

        if (acquired === 'OK') {
            if (!this.isLeader) {
                this.isLeader = true;
                this._startHeartbeat();
                console.log(`[LeaderElection] Instance ${this.instanceId} is now leader for ${this.name}`);
            }
            return true;
        }

        // Check if we're already the leader
        const currentLeader = await redis.get(this.lockKey);
        if (currentLeader === this.instanceId) {
            // Refresh our lock
            await redis.pexpire(this.lockKey, this.ttl);
            return true;
        }

        this.isLeader = false;
        return false;
    }

    /**
     * File-based lock fallback (single node only)
     */
    _tryFileLock() {
        try {
            // Check if lock file exists and is still valid
            if (fs.existsSync(this.lockFilePath)) {
                const lockData = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf8'));
                const lockAge = Date.now() - lockData.timestamp;

                // Lock is still valid and held by another process
                if (lockAge < this.ttl && lockData.instanceId !== this.instanceId) {
                    // Check if the process is still alive
                    try {
                        process.kill(parseInt(lockData.instanceId.split('-')[0]), 0);
                        this.isLeader = false;
                        return false;
                    } catch (e) {
                        // Process is dead, take over the lock
                    }
                }
            }

            // Acquire or refresh the lock
            fs.writeFileSync(this.lockFilePath, JSON.stringify({
                instanceId: this.instanceId,
                timestamp: Date.now()
            }));

            if (!this.isLeader) {
                this.isLeader = true;
                this._startHeartbeat();
                console.log(`[LeaderElection] Instance ${this.instanceId} is now leader for ${this.name} (file lock)`);
            }
            return true;

        } catch (error) {
            console.error(`[LeaderElection] File lock error:`, error.message);
            return false;
        }
    }

    /**
     * Start heartbeat to maintain leadership
     */
    _startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // Heartbeat at half the TTL interval
        this.heartbeatInterval = setInterval(async () => {
            if (!this.isLeader) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
                return;
            }

            try {
                if (redis && redis.status === 'ready') {
                    await redis.pexpire(this.lockKey, this.ttl);
                } else {
                    fs.writeFileSync(this.lockFilePath, JSON.stringify({
                        instanceId: this.instanceId,
                        timestamp: Date.now()
                    }));
                }
            } catch (error) {
                console.error(`[LeaderElection] Heartbeat error for ${this.name}:`, error.message);
            }
        }, this.ttl / 2);
    }

    /**
     * Release leadership
     */
    async release() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (!this.isLeader) {
            return;
        }

        try {
            if (redis && redis.status === 'ready') {
                // Only delete if we're the current holder
                const currentLeader = await redis.get(this.lockKey);
                if (currentLeader === this.instanceId) {
                    await redis.del(this.lockKey);
                }
            } else {
                // File lock - only delete if we're the holder
                if (fs.existsSync(this.lockFilePath)) {
                    const lockData = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf8'));
                    if (lockData.instanceId === this.instanceId) {
                        fs.unlinkSync(this.lockFilePath);
                    }
                }
            }

            console.log(`[LeaderElection] Instance ${this.instanceId} released leadership for ${this.name}`);
        } catch (error) {
            console.error(`[LeaderElection] Release error for ${this.name}:`, error.message);
        }

        this.isLeader = false;
    }

    /**
     * Check if this instance is currently the leader
     */
    isCurrentLeader() {
        return this.isLeader;
    }
}

/**
 * Utility: Run a function only if this instance is the leader
 * @param {LeaderElection} election - Leader election instance
 * @param {function} fn - Function to run if leader
 */
async function runIfLeader(election, fn) {
    if (await election.tryBecomeLeader()) {
        try {
            await fn();
        } catch (error) {
            console.error(`[LeaderElection] Leader task error:`, error.message);
        }
    }
}

module.exports = {
    LeaderElection,
    runIfLeader
};
