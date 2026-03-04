/**
 * Container Storage Service
 * Provides isolated storage containers per user/device
 * Each user's files are completely isolated from others
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

// Container configuration
const CONTAINER_SALT = process.env.CONTAINER_SALT || 'doz-up-container-salt-2026';
const DEFAULT_QUOTA_MB = 1024; // 1GB per user by default (free membership)
const MAX_FILES_PER_CONTAINER = 1000;
const DEFAULT_EXPIRATION_DAYS = 30; // 30 days file expiration for temporal drives
const DEFAULT_UPLOADS_PER_DAY = 7; // 7 uploads per day for free membership

class ContainerStorage {
    constructor(baseDir) {
        this.baseDir = baseDir || path.join(__dirname, '..', 'uploads', 'containers');
        this.containerCache = new Map(); // deviceId -> containerPath
        this.quotaCache = new Map(); // deviceId -> { used, limit }
        this.initBaseDir();
    }

    initBaseDir() {
        if (!fsSync.existsSync(this.baseDir)) {
            fsSync.mkdirSync(this.baseDir, { recursive: true });
            console.log(`[ContainerStorage] Created base directory: ${this.baseDir}`);
        }
    }

    /**
     * Generate container path from device ID
     * Uses SHA-256 hash for privacy - cannot reverse to get original deviceId
     */
    getContainerHash(deviceId) {
        return crypto.createHash('sha256')
            .update(deviceId + CONTAINER_SALT)
            .digest('hex')
            .substring(0, 16);
    }

    getContainerPath(deviceId) {
        // Check cache first
        if (this.containerCache.has(deviceId)) {
            return this.containerCache.get(deviceId);
        }

        const hash = this.getContainerHash(deviceId);
        const containerPath = path.join(this.baseDir, hash);

        // Cache the path
        this.containerCache.set(deviceId, containerPath);
        return containerPath;
    }

    /**
     * Initialize a new container for a device
     */
    async initContainer(deviceId) {
        const containerPath = this.getContainerPath(deviceId);
        const imagesPath = path.join(containerPath, 'images');

        try {
            await fs.mkdir(imagesPath, { recursive: true });

            // Create metadata file
            const metadata = {
                created: new Date().toISOString(),
                deviceId: this.getContainerHash(deviceId), // Store hash only, not real ID
                version: 1
            };
            await fs.writeFile(
                path.join(containerPath, 'metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Create quota file
            const quota = {
                limitMB: DEFAULT_QUOTA_MB,
                usedBytes: 0,
                fileCount: 0,
                lastUpdated: new Date().toISOString()
            };
            await fs.writeFile(
                path.join(containerPath, 'quota.json'),
                JSON.stringify(quota, null, 2)
            );

            console.log(`[ContainerStorage] Initialized container for device: ${this.getContainerHash(deviceId)}`);
            return { success: true, containerPath };
        } catch (error) {
            console.error(`[ContainerStorage] Error initializing container:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if container exists
     */
    async containerExists(deviceId) {
        const containerPath = this.getContainerPath(deviceId);
        try {
            await fs.access(containerPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Ensure container exists, create if not
     */
    async ensureContainer(deviceId) {
        if (!await this.containerExists(deviceId)) {
            return await this.initContainer(deviceId);
        }
        return { success: true, containerPath: this.getContainerPath(deviceId) };
    }

    /**
     * Get quota information for a container
     */
    async getQuota(deviceId) {
        // Check cache
        if (this.quotaCache.has(deviceId)) {
            const cached = this.quotaCache.get(deviceId);
            if (Date.now() - cached.timestamp < 60000) { // 1 minute cache
                return cached.quota;
            }
        }

        const containerPath = this.getContainerPath(deviceId);
        const quotaPath = path.join(containerPath, 'quota.json');

        try {
            const data = await fs.readFile(quotaPath, 'utf8');
            const quota = JSON.parse(data);

            // Cache the quota
            this.quotaCache.set(deviceId, { quota, timestamp: Date.now() });
            return quota;
        } catch {
            return { limitMB: DEFAULT_QUOTA_MB, usedBytes: 0, fileCount: 0 };
        }
    }

    /**
     * Update quota after file operation
     */
    async updateQuota(deviceId, bytesChange, fileCountChange) {
        const containerPath = this.getContainerPath(deviceId);
        const quotaPath = path.join(containerPath, 'quota.json');

        try {
            let quota = await this.getQuota(deviceId);
            quota.usedBytes = Math.max(0, (quota.usedBytes || 0) + bytesChange);
            quota.fileCount = Math.max(0, (quota.fileCount || 0) + fileCountChange);
            quota.lastUpdated = new Date().toISOString();

            await fs.writeFile(quotaPath, JSON.stringify(quota, null, 2));

            // Update cache
            this.quotaCache.set(deviceId, { quota, timestamp: Date.now() });
            return quota;
        } catch (error) {
            console.error(`[ContainerStorage] Error updating quota:`, error);
            return null;
        }
    }

    /**
     * Check if operation would exceed quota
     */
    async checkQuota(deviceId, additionalBytes) {
        const quota = await this.getQuota(deviceId);
        const limitBytes = quota.limitMB * 1024 * 1024;
        const wouldUse = quota.usedBytes + additionalBytes;

        return {
            allowed: wouldUse <= limitBytes && quota.fileCount < MAX_FILES_PER_CONTAINER,
            currentUsed: quota.usedBytes,
            limit: limitBytes,
            wouldUse,
            remaining: limitBytes - quota.usedBytes,
            fileCount: quota.fileCount,
            maxFiles: MAX_FILES_PER_CONTAINER
        };
    }

    /**
     * Save a file to user's container
     */
    async saveFile(deviceId, filename, buffer) {
        // Ensure container exists
        await this.ensureContainer(deviceId);

        // Check quota
        const quotaCheck = await this.checkQuota(deviceId, buffer.length);
        if (!quotaCheck.allowed) {
            return {
                success: false,
                error: 'quota_exceeded',
                message: `Storage quota exceeded. Used: ${Math.round(quotaCheck.currentUsed / 1024 / 1024)}MB / ${Math.round(quotaCheck.limit / 1024 / 1024)}MB`
            };
        }

        const containerPath = this.getContainerPath(deviceId);
        const filePath = path.join(containerPath, 'images', filename);

        try {
            await fs.writeFile(filePath, buffer);
            await this.updateQuota(deviceId, buffer.length, 1);

            console.log(`[ContainerStorage] Saved file ${filename} for device ${this.getContainerHash(deviceId)}`);
            return {
                success: true,
                path: filePath,
                size: buffer.length,
                containerHash: this.getContainerHash(deviceId)
            };
        } catch (error) {
            console.error(`[ContainerStorage] Error saving file:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get a file from user's container
     * CRITICAL: Only returns files from the user's own container
     */
    async getFile(deviceId, filename) {
        const containerPath = this.getContainerPath(deviceId);
        const filePath = path.join(containerPath, 'images', filename);

        // Security: Ensure path is within container (prevent directory traversal)
        const resolvedPath = path.resolve(filePath);
        const resolvedContainer = path.resolve(containerPath);
        if (!resolvedPath.startsWith(resolvedContainer)) {
            return { success: false, error: 'access_denied', message: 'Invalid file path' };
        }

        try {
            const buffer = await fs.readFile(filePath);
            return { success: true, buffer, path: filePath };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: false, error: 'not_found', message: 'File not found' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a file from user's container
     */
    async deleteFile(deviceId, filename) {
        const containerPath = this.getContainerPath(deviceId);
        const filePath = path.join(containerPath, 'images', filename);

        // Security check
        const resolvedPath = path.resolve(filePath);
        const resolvedContainer = path.resolve(containerPath);
        if (!resolvedPath.startsWith(resolvedContainer)) {
            return { success: false, error: 'access_denied' };
        }

        try {
            const stats = await fs.stat(filePath);
            await fs.unlink(filePath);
            await this.updateQuota(deviceId, -stats.size, -1);

            console.log(`[ContainerStorage] Deleted file ${filename} from device ${this.getContainerHash(deviceId)}`);
            return { success: true, freedBytes: stats.size };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: false, error: 'not_found' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * List files in user's container
     */
    async listFiles(deviceId) {
        const containerPath = this.getContainerPath(deviceId);
        const imagesPath = path.join(containerPath, 'images');

        try {
            const files = await fs.readdir(imagesPath);
            const fileInfos = await Promise.all(files.map(async (filename) => {
                const filePath = path.join(imagesPath, filename);
                const stats = await fs.stat(filePath);
                return {
                    filename,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            }));

            return { success: true, files: fileInfos, count: files.length };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: true, files: [], count: 0 };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Get container statistics
     */
    async getContainerStats(deviceId) {
        const quota = await this.getQuota(deviceId);
        const files = await this.listFiles(deviceId);

        return {
            containerHash: this.getContainerHash(deviceId),
            quota: {
                usedMB: Math.round(quota.usedBytes / 1024 / 1024 * 100) / 100,
                limitMB: quota.limitMB,
                usagePercent: Math.round(quota.usedBytes / (quota.limitMB * 1024 * 1024) * 100)
            },
            files: {
                count: files.count,
                maxFiles: MAX_FILES_PER_CONTAINER
            },
            lastUpdated: quota.lastUpdated
        };
    }

    /**
     * Clean up expired files in a container
     */
    async cleanupExpiredFiles(deviceId, maxAgeMs = 24 * 60 * 60 * 1000) {
        const files = await this.listFiles(deviceId);
        if (!files.success) return { success: false, cleaned: 0 };

        const now = Date.now();
        let cleaned = 0;
        let freedBytes = 0;

        for (const file of files.files) {
            const fileAge = now - new Date(file.created).getTime();
            if (fileAge > maxAgeMs) {
                const result = await this.deleteFile(deviceId, file.filename);
                if (result.success) {
                    cleaned++;
                    freedBytes += result.freedBytes;
                }
            }
        }

        return { success: true, cleaned, freedBytes };
    }
}

// Singleton instance
const containerStorage = new ContainerStorage();

module.exports = containerStorage;
module.exports.ContainerStorage = ContainerStorage;
