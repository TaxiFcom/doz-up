/**
 * DOZ UP - Backup Service
 * Automated data backups and recovery
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const backupDir = path.join(__dirname, '..', 'backups');
const backupIndexPath = path.join(backupDir, 'index.json');

// Ensure directories exist
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Files to backup
const BACKUP_FILES = [
    'uploads.json',
    'users.json',
    'enterprise-leads.json',
    'deals.json',
    'affiliates.json',
    'referrals.json',
    'proposals.json',
    'demos.json',
    'availability.json',
    'outreach.json',
    'sequences.json',
    'subscriptions.json',
    'transactions.json',
    'admins.json',
    'tokens.json',
    'sessions.json',
    'activity.json',
    'webhooks.json',
    'analytics.json'
];

class BackupService {
    constructor() {
        this.backupIndex = loadJSON(backupIndexPath, []);

        // Schedule automatic backups
        this.scheduleAutoBackups();
    }

    // ============ BACKUP CREATION ============

    createBackup(options = {}) {
        const backupId = uuidv4();
        const timestamp = new Date().toISOString();
        const backupData = {
            id: backupId,
            version: '1.0',
            createdAt: timestamp,
            type: options.type || 'manual', // manual, scheduled, pre-update
            description: options.description || '',
            files: {},
            stats: {
                totalFiles: 0,
                totalSize: 0,
                compressedSize: 0
            }
        };

        // Collect all data files
        for (const filename of BACKUP_FILES) {
            const filepath = path.join(dataDir, filename);
            if (fs.existsSync(filepath)) {
                try {
                    const content = fs.readFileSync(filepath, 'utf8');
                    backupData.files[filename] = {
                        content,
                        size: content.length,
                        checksum: this.calculateChecksum(content)
                    };
                    backupData.stats.totalFiles++;
                    backupData.stats.totalSize += content.length;
                } catch (e) {
                    console.error(`[Backup] Error reading ${filename}:`, e.message);
                }
            }
        }

        // Compress backup
        const backupJson = JSON.stringify(backupData);
        const compressed = zlib.gzipSync(backupJson);
        backupData.stats.compressedSize = compressed.length;

        // Save backup file
        const backupFilename = `backup_${timestamp.replace(/[:.]/g, '-')}_${backupId.substring(0, 8)}.gz`;
        const backupPath = path.join(backupDir, backupFilename);
        fs.writeFileSync(backupPath, compressed);

        // Update index
        const indexEntry = {
            id: backupId,
            filename: backupFilename,
            createdAt: timestamp,
            type: backupData.type,
            description: backupData.description,
            stats: backupData.stats,
            checksum: this.calculateChecksum(backupJson)
        };

        this.backupIndex.unshift(indexEntry);

        // Keep only last 50 backups in index
        if (this.backupIndex.length > 50) {
            const toRemove = this.backupIndex.splice(50);
            // Delete old backup files
            for (const old of toRemove) {
                const oldPath = path.join(backupDir, old.filename);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
        }

        saveJSON(backupIndexPath, this.backupIndex);

        console.log(`[Backup] Created backup ${backupId}: ${backupData.stats.totalFiles} files, ${this.formatSize(backupData.stats.compressedSize)}`);

        return indexEntry;
    }

    // ============ BACKUP RESTORATION ============

    restoreBackup(backupId, options = {}) {
        const indexEntry = this.backupIndex.find(b => b.id === backupId);
        if (!indexEntry) {
            throw new Error('Backup not found');
        }

        const backupPath = path.join(backupDir, indexEntry.filename);
        if (!fs.existsSync(backupPath)) {
            throw new Error('Backup file missing');
        }

        // Create pre-restore backup
        if (!options.skipPreBackup) {
            this.createBackup({
                type: 'pre-restore',
                description: `Pre-restore backup before restoring ${backupId}`
            });
        }

        // Read and decompress backup
        const compressed = fs.readFileSync(backupPath);
        const backupJson = zlib.gunzipSync(compressed).toString('utf8');
        const backupData = JSON.parse(backupJson);

        // Verify checksum
        if (indexEntry.checksum !== this.calculateChecksum(backupJson)) {
            throw new Error('Backup checksum mismatch - file may be corrupted');
        }

        // Restore files
        const restored = [];
        const failed = [];

        for (const [filename, fileData] of Object.entries(backupData.files)) {
            try {
                // Verify individual file checksum
                if (fileData.checksum !== this.calculateChecksum(fileData.content)) {
                    throw new Error('File checksum mismatch');
                }

                const filepath = path.join(dataDir, filename);
                fs.writeFileSync(filepath, fileData.content);
                restored.push(filename);
            } catch (e) {
                failed.push({ filename, error: e.message });
            }
        }

        console.log(`[Backup] Restored ${restored.length} files from backup ${backupId}`);

        return {
            success: failed.length === 0,
            backupId,
            restored,
            failed,
            restoredAt: new Date().toISOString()
        };
    }

    // ============ BACKUP MANAGEMENT ============

    getBackups(filters = {}) {
        let backups = [...this.backupIndex];

        if (filters.type) {
            backups = backups.filter(b => b.type === filters.type);
        }
        if (filters.from) {
            backups = backups.filter(b => new Date(b.createdAt) >= new Date(filters.from));
        }
        if (filters.to) {
            backups = backups.filter(b => new Date(b.createdAt) <= new Date(filters.to));
        }

        const offset = filters.offset || 0;
        const limit = filters.limit || 20;

        return {
            backups: backups.slice(offset, offset + limit),
            total: backups.length
        };
    }

    getBackup(backupId) {
        return this.backupIndex.find(b => b.id === backupId);
    }

    deleteBackup(backupId) {
        const index = this.backupIndex.findIndex(b => b.id === backupId);
        if (index === -1) return false;

        const backup = this.backupIndex[index];
        const backupPath = path.join(backupDir, backup.filename);

        // Delete file
        if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
        }

        // Remove from index
        this.backupIndex.splice(index, 1);
        saveJSON(backupIndexPath, this.backupIndex);

        return true;
    }

    // Download backup (returns buffer)
    downloadBackup(backupId) {
        const indexEntry = this.backupIndex.find(b => b.id === backupId);
        if (!indexEntry) {
            throw new Error('Backup not found');
        }

        const backupPath = path.join(backupDir, indexEntry.filename);
        if (!fs.existsSync(backupPath)) {
            throw new Error('Backup file missing');
        }

        return {
            filename: indexEntry.filename,
            data: fs.readFileSync(backupPath),
            contentType: 'application/gzip'
        };
    }

    // ============ SCHEDULED BACKUPS ============

    scheduleAutoBackups() {
        // Daily backup at 3 AM
        const scheduleDaily = () => {
            const now = new Date();
            const next3AM = new Date(now);
            next3AM.setHours(3, 0, 0, 0);
            if (next3AM <= now) {
                next3AM.setDate(next3AM.getDate() + 1);
            }

            const delay = next3AM.getTime() - now.getTime();

            setTimeout(() => {
                this.createBackup({
                    type: 'scheduled',
                    description: 'Daily automatic backup'
                });
                scheduleDaily(); // Schedule next
            }, delay);

            console.log(`[Backup] Next scheduled backup at ${next3AM.toISOString()}`);
        };

        scheduleDaily();

        // Also backup every 6 hours for safety
        setInterval(() => {
            this.createBackup({
                type: 'scheduled',
                description: '6-hour automatic backup'
            });
        }, 6 * 60 * 60 * 1000);
    }

    // ============ STATS ============

    getBackupStats() {
        let totalSize = 0;
        let totalCompressed = 0;

        for (const backup of this.backupIndex) {
            totalSize += backup.stats.totalSize;
            totalCompressed += backup.stats.compressedSize;
        }

        const latestBackup = this.backupIndex[0];
        const oldestBackup = this.backupIndex[this.backupIndex.length - 1];

        return {
            totalBackups: this.backupIndex.length,
            totalSize: this.formatSize(totalSize),
            totalCompressed: this.formatSize(totalCompressed),
            compressionRatio: totalSize > 0 ? ((1 - totalCompressed / totalSize) * 100).toFixed(1) + '%' : '0%',
            latestBackup: latestBackup?.createdAt || null,
            oldestBackup: oldestBackup?.createdAt || null,
            byType: {
                manual: this.backupIndex.filter(b => b.type === 'manual').length,
                scheduled: this.backupIndex.filter(b => b.type === 'scheduled').length,
                preUpdate: this.backupIndex.filter(b => b.type === 'pre-update').length,
                preRestore: this.backupIndex.filter(b => b.type === 'pre-restore').length
            }
        };
    }

    // ============ HELPERS ============

    calculateChecksum(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    }

    // Verify backup integrity
    verifyBackup(backupId) {
        const indexEntry = this.backupIndex.find(b => b.id === backupId);
        if (!indexEntry) {
            return { valid: false, error: 'Backup not found' };
        }

        const backupPath = path.join(backupDir, indexEntry.filename);
        if (!fs.existsSync(backupPath)) {
            return { valid: false, error: 'Backup file missing' };
        }

        try {
            const compressed = fs.readFileSync(backupPath);
            const backupJson = zlib.gunzipSync(compressed).toString('utf8');

            if (indexEntry.checksum !== this.calculateChecksum(backupJson)) {
                return { valid: false, error: 'Checksum mismatch' };
            }

            const backupData = JSON.parse(backupJson);

            // Verify each file checksum
            const fileErrors = [];
            for (const [filename, fileData] of Object.entries(backupData.files)) {
                if (fileData.checksum !== this.calculateChecksum(fileData.content)) {
                    fileErrors.push(filename);
                }
            }

            if (fileErrors.length > 0) {
                return { valid: false, error: `Corrupted files: ${fileErrors.join(', ')}` };
            }

            return {
                valid: true,
                stats: backupData.stats,
                fileCount: Object.keys(backupData.files).length
            };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
}

module.exports = new BackupService();
