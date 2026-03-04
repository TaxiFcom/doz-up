/**
 * Shared Database Utility
 * Replaces 17+ duplicate loadJSON/saveJSON implementations
 * Features: Caching, async I/O, write debouncing, TTL support
 */

const fs = require('fs').promises;
const path = require('path');

// Cache configuration
const cache = new Map();
const CACHE_TTL = 30000; // 30 second default TTL
const MAX_CACHE_SIZE = 100;

// Write debounce tracking
const pendingWrites = new Map();
const WRITE_DEBOUNCE_MS = 500;

/**
 * Load JSON file with caching
 * @param {string} filePath - Path to JSON file
 * @param {object} defaultValue - Default value if file doesn't exist
 * @param {number} ttl - Cache TTL in ms (default 30s)
 */
async function loadJSON(filePath, defaultValue = {}, ttl = CACHE_TTL) {
    const cacheKey = path.resolve(filePath);
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data;
    }

    try {
        const data = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);

        // Update cache
        cache.set(cacheKey, { data: parsed, timestamp: Date.now() });

        // Limit cache size
        if (cache.size > MAX_CACHE_SIZE) {
            const oldest = [...cache.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) cache.delete(oldest[0]);
        }

        return parsed;
    } catch (err) {
        if (err.code === 'ENOENT') {
            // File doesn't exist, return default and cache it
            cache.set(cacheKey, { data: defaultValue, timestamp: Date.now() });
            return defaultValue;
        }
        console.error(`[db] Error loading ${filePath}:`, err.message);
        return defaultValue;
    }
}

/**
 * Save JSON file with debouncing
 * @param {string} filePath - Path to JSON file
 * @param {object} data - Data to save
 * @param {boolean} immediate - Skip debounce and write immediately
 */
async function saveJSON(filePath, data, immediate = false) {
    const cacheKey = path.resolve(filePath);

    // Update cache immediately
    cache.set(cacheKey, { data, timestamp: Date.now() });

    if (immediate) {
        return writeFile(filePath, data);
    }

    // Debounced write
    const pending = pendingWrites.get(cacheKey);
    if (pending) {
        pending.data = data;
        return pending.promise;
    }

    const writePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(async () => {
            const pendingData = pendingWrites.get(cacheKey);
            pendingWrites.delete(cacheKey);

            try {
                await writeFile(filePath, pendingData.data);
                resolve();
            } catch (err) {
                reject(err);
            }
        }, WRITE_DEBOUNCE_MS);

        pendingWrites.set(cacheKey, {
            data,
            promise: writePromise,
            timeoutId
        });
    });

    return writePromise;
}

/**
 * Internal write function
 */
async function writeFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        const content = JSON.stringify(data, null, 2);
        await fs.writeFile(filePath, content, 'utf8');
    } catch (err) {
        console.error(`[db] Error saving ${filePath}:`, err.message);
        throw err;
    }
}

/**
 * Invalidate cache for a specific file
 */
function invalidateCache(filePath) {
    const cacheKey = path.resolve(filePath);
    cache.delete(cacheKey);
}

/**
 * Clear all cache
 */
function clearCache() {
    cache.clear();
}

/**
 * Flush all pending writes immediately
 */
async function flushWrites() {
    const promises = [];

    for (const [key, pending] of pendingWrites) {
        clearTimeout(pending.timeoutId);
        promises.push(writeFile(key, pending.data));
    }

    pendingWrites.clear();
    await Promise.all(promises);
}

/**
 * Check if file exists (async)
 */
async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get file stats (async with caching)
 */
const statsCache = new Map();
const STATS_TTL = 60000; // 1 minute

async function getStats(filePath) {
    const cacheKey = path.resolve(filePath);
    const cached = statsCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < STATS_TTL) {
        return cached.data;
    }

    try {
        const stats = await fs.stat(filePath);
        const result = {
            exists: true,
            size: stats.size,
            sizeKB: Math.round(stats.size / 1024),
            modified: stats.mtime,
            isDirectory: stats.isDirectory()
        };

        statsCache.set(cacheKey, { data: result, timestamp: Date.now() });

        // Limit stats cache
        if (statsCache.size > MAX_CACHE_SIZE) {
            const oldest = [...statsCache.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) statsCache.delete(oldest[0]);
        }

        return result;
    } catch {
        return { exists: false, size: 0, sizeKB: 0, modified: null, isDirectory: false };
    }
}

/**
 * Read directory (async)
 */
async function readDir(dirPath) {
    try {
        return await fs.readdir(dirPath);
    } catch {
        return [];
    }
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get cache stats for debugging
 */
function getCacheStats() {
    return {
        jsonCacheSize: cache.size,
        statsCacheSize: statsCache.size,
        pendingWrites: pendingWrites.size
    };
}

module.exports = {
    loadJSON,
    saveJSON,
    invalidateCache,
    clearCache,
    flushWrites,
    exists,
    getStats,
    readDir,
    ensureDir,
    getCacheStats,

    // Constants for external use
    CACHE_TTL,
    WRITE_DEBOUNCE_MS
};
