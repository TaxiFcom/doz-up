'use strict';

/**
 * memory-fixes.js — Event Listener & Memory Leak Fixes for DOZ UP
 * ================================================================
 * Addresses two root causes of unbounded heap growth identified in the
 * DOZ UP gateway:
 *
 *   A. EventListenerManager — tracks every event listener added during a
 *      request lifecycle and removes them automatically when the response
 *      finishes.  Prevents the "78 listeners added, 0 removed" leak pattern.
 *
 *   B. MemoryMonitor — polls process.memoryUsage() on a configurable interval,
 *      keeps a rolling history, logs structured warnings at 80% / 95% heap
 *      thresholds, and exposes an Express health-check handler for load-balancer
 *      readiness probes.
 *
 * NOTE — Analytics in-memory fix (AnalyticsService) is intentionally excluded
 * here because it requires deeper refactoring of server.js (Prisma schema
 * addition, Redis client wiring).  See /doz-up-fixes/04-memory-leak-fixes.js
 * Section B for the full AnalyticsService implementation.
 *
 * ─── Quick start ──────────────────────────────────────────────────────────────────────────────
 *
 *   // In gateway.js or server.js (after app is created):
 *   const {
 *     EventListenerManager,
 *     createRequestScopeMiddleware,
 *     MemoryMonitor,
 *   } = require('./src/memory-fixes');
 *
 *   // A. Event listener tracking
 *   const listenerManager = new EventListenerManager({ warnThreshold: 50 });
 *   app.use(createRequestScopeMiddleware(listenerManager));
 *
 *   // B. Memory monitoring + health endpoint
 *   const memMonitor = new MemoryMonitor();
 *   memMonitor.start();
 *   app.get('/api/admin/health/memory', memMonitor.healthHandler());
 *
 *   // Graceful shutdown
 *   process.on('SIGTERM', () => {
 *     listenerManager.cleanupAll();
 *     memMonitor.stop();
 *   });
 */

// ─────────────────────────────────────────────────────────────────────────────────
// Section A — EventListenerManager
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Tracks EventEmitter listeners keyed by a named scope (e.g. a request ID).
 * Call cleanup(scope) when the scope is done to remove every registered listener
 * at once, preventing the unbounded accumulation seen in the DOZ UP upload routes.
 *
 * Problem pattern (gateway.js upload routes):
 *   req.on('data', handler);   // ← added per request, never removed
 *   req.on('end',  handler);   // ← same
 *
 * Fixed pattern (using this class):
 *   req.addListener(req, 'data', handler);  // auto-removed on res.finish / res.close
 *   req.addListener(req, 'end',  handler);
 */
class EventListenerManager {
    /**
     * @param {object}  [options]
     * @param {number}  [options.warnThreshold=50]  Log a warning when total
     *                                               active listeners reaches this number.
     */
    constructor(options = {}) {
        /** Maximum active listeners before a warning is emitted. */
        this.warnThreshold = options.warnThreshold || 50;

        /**
         * Registry: scope string → Array<{ emitter, event, handler }>
         * @type {Map<string, Array<{emitter: NodeJS.EventEmitter, event: string, handler: Function}>>}
         */
        this._registry = new Map();

        /** Running count of all active listeners across every scope. */
        this._totalCount = 0;
    }

    /**
     * Register an event listener under a named scope.
     *
     * @param {string}                  scope    - Scope identifier (e.g. 'upload-route', 'req-abc123')
     * @param {NodeJS.EventEmitter}     emitter  - The EventEmitter to listen on
     * @param {string}                  event    - Event name
     * @param {Function}                handler  - Listener function
     * @param {{ once?: boolean }}      [opts]   - Pass `{ once: true }` to use emitter.once()
     */
    add(scope, emitter, event, handler, opts = {}) {
        if (typeof scope   !== 'string')   throw new TypeError('[EventListenerManager] scope must be a string');
        if (!emitter || typeof emitter.on !== 'function') {
            throw new TypeError('[EventListenerManager] emitter must be an EventEmitter');
        }
        if (typeof handler !== 'function') throw new TypeError('[EventListenerManager] handler must be a function');

        if (!this._registry.has(scope)) {
            this._registry.set(scope, []);
        }

        if (opts.once) {
            emitter.once(event, handler);
        } else {
            emitter.on(event, handler);
        }

        this._registry.get(scope).push({ emitter, event, handler });
        this._totalCount++;

        this._checkThreshold(scope);
    }

    /**
     * Remove all listeners registered under `scope`.
     * Safe to call even if the scope never registered any listeners.
     *
     * @param {string} scope
     */
    cleanup(scope) {
        const listeners = this._registry.get(scope);
        if (!listeners || listeners.length === 0) return;

        for (const { emitter, event, handler } of listeners) {
            try {
                emitter.removeListener(event, handler);
            } catch (err) {
                // Emitter may have already been destroyed (e.g. closed socket) — safe to ignore.
                console.warn('[EventListenerManager] removeListener error during cleanup:', err.message);
            }
            this._totalCount = Math.max(0, this._totalCount - 1);
        }

        this._registry.delete(scope);
    }

    /**
     * Remove ALL listeners from ALL scopes.
     * Call this during process shutdown (SIGTERM / SIGINT).
     */
    cleanupAll() {
        for (const scope of [...this._registry.keys()]) {
            this.cleanup(scope);
        }
        this._totalCount = 0;
    }

    /**
     * Returns a snapshot of active listener counts.
     *
     * @returns {{ total: number, scopes: number, byScope: Record<string, number> }}
     */
    stats() {
        const byScope = {};
        for (const [scope, listeners] of this._registry.entries()) {
            byScope[scope] = listeners.length;
        }
        return {
            total:   this._totalCount,
            scopes:  this._registry.size,
            byScope,
        };
    }

    /** @private */
    _checkThreshold(scope) {
        if (this._totalCount >= this.warnThreshold) {
            console.warn(
                `[EventListenerManager] WARNING: total active listeners reached ${this._totalCount}` +
                ` (last scope: "${scope}"). Ensure listeners are cleaned up after each request.`
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────
// createRequestScopeMiddleware
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Express middleware factory.
 *
 * Assigns a unique scope to each request and automatically calls
 * `manager.cleanup(scope)` when the response ends.  Also attaches
 * `req.addListener(emitter, event, handler, opts)` as a convenience shorthand.
 *
 * @param {EventListenerManager} manager - Shared manager instance
 * @returns {Function} Express middleware
 *
 * @example
 *   const listenerManager = new EventListenerManager();
 *   app.use(createRequestScopeMiddleware(listenerManager));
 *
 *   // Inside a route:
 *   router.post('/upload', (req, res) => {
 *     req.addListener(req, 'data', (chunk) => chunks.push(chunk));
 *     req.addListener(req, 'end',  () => processChunks(chunks, res));
 *   });
 */
function createRequestScopeMiddleware(manager) {
    if (!(manager instanceof EventListenerManager)) {
        throw new TypeError('[createRequestScopeMiddleware] manager must be an EventListenerManager instance');
    }

    return function requestScopeMiddleware(req, res, next) {
        // Unique scope per request — timestamp + random suffix is sufficient
        req.listenerScope = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Shorthand: req.addListener(emitter, event, handler, opts?)
        req.addListener = (emitter, event, handler, opts) => {
            manager.add(req.listenerScope, emitter, event, handler, opts);
        };

        // Cleanup on response end — 'finish' fires on normal completion,
        // 'close' fires if the connection is dropped before finish.
        const cleanup = () => manager.cleanup(req.listenerScope);
        res.once('finish', cleanup);
        res.once('close',  cleanup);

        next();
    };
}

// ─────────────────────────────────────────────────────────────────────────────────
// Section B — MemoryMonitor
// ─────────────────────────────────────────────────────────────────────────────────

// ── Parse heap ceiling from NODE_OPTIONS (e.g. --max-old-space-size=512) ─────
function _parseMaxHeapMB() {
    const opts  = process.env.NODE_OPTIONS || '';
    const match = opts.match(/--max-old-space-size=(\d+)/);
    return match ? parseInt(match[1], 10) : 512; // 512 MB default
}

const _MAX_HEAP_MB       = _parseMaxHeapMB();
const _WARN_PERCENT      = parseInt(process.env.MEMORY_WARN_PERCENT,      10) || 80;
const _CRITICAL_PERCENT  = parseInt(process.env.MEMORY_CRITICAL_PERCENT,  10) || 95;
const _CHECK_INTERVAL_MS = parseInt(process.env.MEMORY_CHECK_INTERVAL_MS, 10) || 15_000;

/**
 * Polls process.memoryUsage() on a regular interval, logs structured warnings
 * at configurable thresholds, and provides an Express route handler that returns
 * a health-check payload suitable for load-balancer readiness probes.
 *
 * Environment variables:
 *   MEMORY_WARN_PERCENT=80          (default 80)
 *   MEMORY_CRITICAL_PERCENT=95      (default 95)
 *   MEMORY_CHECK_INTERVAL_MS=15000  (default 15 s)
 *   NODE_OPTIONS="--max-old-space-size=512"  (used to derive the heap ceiling)
 */
class MemoryMonitor {
    constructor() {
        /**
         * Rolling history of the last `_maxHistoryLength` samples.
         * Each entry: { heapUsedMB, usagePercent, timestamp }
         * @type {Array<{heapUsedMB: number, usagePercent: number, timestamp: string}>}
         */
        this._history          = [];
        this._maxHistoryLength = 60; // 60 × 15 s = 15 minutes of history

        /** Consecutive check-cycles spent above warn or critical threshold. */
        this._consecutiveWarnings = 0;

        /** setInterval handle — null when stopped. */
        this._timer = null;
    }

    /**
     * Begin polling.  Safe to call multiple times — subsequent calls are no-ops.
     */
    start() {
        if (this._timer) return;

        this._timer = setInterval(() => this._check(), _CHECK_INTERVAL_MS);

        // Don't prevent process exit if everything else has shut down.
        if (this._timer.unref) this._timer.unref();

        // Take an immediate reading so the first health check has data.
        this._check();

        console.log(
            `[MemoryMonitor] Started (interval: ${_CHECK_INTERVAL_MS / 1000}s, ` +
            `heap ceiling: ${_MAX_HEAP_MB} MB, warn: ${_WARN_PERCENT}%, critical: ${_CRITICAL_PERCENT}%)`
        );
    }

    /**
     * Stop polling.  Health-check handler remains usable (returns last-known data).
     */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[MemoryMonitor] Stopped.');
        }
    }

    /**
     * Returns the current memory snapshot.
     *
     * @returns {{
     *   heapUsedMB:  number,
     *   heapTotalMB: number,
     *   rssMB:       number,
     *   externalMB:  number,
     *   maxHeapMB:   number,
     *   usagePercent: number,
     *   status:      'ok' | 'warning' | 'critical',
     *   timestamp:   string,
     * }}
     */
    currentStats() {
        const mem          = process.memoryUsage();
        const heapUsedMB   = Math.round(mem.heapUsed   / 1024 / 1024);
        const heapTotalMB  = Math.round(mem.heapTotal  / 1024 / 1024);
        const rssMB        = Math.round(mem.rss        / 1024 / 1024);
        const externalMB   = Math.round(mem.external   / 1024 / 1024);
        const usagePercent = Math.round((heapUsedMB / _MAX_HEAP_MB) * 100);

        return {
            heapUsedMB,
            heapTotalMB,
            rssMB,
            externalMB,
            maxHeapMB:    _MAX_HEAP_MB,
            usagePercent,
            status:       this._statusFromPercent(usagePercent),
            timestamp:    new Date().toISOString(),
        };
    }

    /**
     * Returns the last `n` history entries (most recent last).
     *
     * @param {number} [n=10]
     * @returns {Array}
     */
    recentHistory(n = 10) {
        return this._history.slice(-Math.abs(n));
    }

    /**
     * Express route handler for a memory health endpoint.
     *
     * HTTP 503 is returned when memory is critical (≥ CRITICAL_PERCENT) so that
     * load balancers can stop routing new traffic to the instance.
     * HTTP 200 is returned for both 'ok' and 'warning' states.
     *
     * Registration example:
     *   app.get('/api/admin/health/memory', requireAdmin(), memMonitor.healthHandler());
     *
     * @returns {Function} Express (req, res) => void
     */
    healthHandler() {
        const self = this;
        return function memoryHealthHandler(_req, res) {
            const stats      = self.currentStats();
            const history    = self.recentHistory(10);
            const statusCode = stats.status === 'critical' ? 503 : 200;

            res.status(statusCode).json({
                ok:          stats.status !== 'critical',
                memory:      stats,
                history,
                uptime:      Math.floor(process.uptime()),
                pid:         process.pid,
                nodeVersion: process.version,
                // Hint: run with --expose-gc to allow manual GC on critical
                gcAvailable: typeof global.gc === 'function',
            });
        };
    }

    // ── Private ────────────────────────────────────────────────────────────────────────────────────

    _check() {
        const stats = this.currentStats();

        // Record in rolling history
        this._history.push({
            heapUsedMB:   stats.heapUsedMB,
            usagePercent: stats.usagePercent,
            timestamp:    stats.timestamp,
        });
        if (this._history.length > this._maxHistoryLength) {
            this._history.shift();
        }

        // Threshold alerting
        if (stats.status === 'critical') {
            this._consecutiveWarnings++;
            console.error(
                `[MemoryMonitor] CRITICAL: heap at ${stats.usagePercent}%` +
                ` (${stats.heapUsedMB} MB / ${_MAX_HEAP_MB} MB)` +
                ` — consecutive alert #${this._consecutiveWarnings}`
            );
            // Hint the GC if --expose-gc was passed to Node
            if (typeof global.gc === 'function') {
                console.warn('[MemoryMonitor] Triggering manual GC...');
                global.gc();
            }

        } else if (stats.status === 'warning') {
            this._consecutiveWarnings++;
            // Throttle to 1 log per 4 checks to avoid log spam
            if (this._consecutiveWarnings % 4 === 1) {
                console.warn(
                    `[MemoryMonitor] WARNING: heap at ${stats.usagePercent}%` +
                    ` (${stats.heapUsedMB} MB / ${_MAX_HEAP_MB} MB)`
                );
            }

        } else {
            // Recovered — reset counter and log once
            if (this._consecutiveWarnings > 0) {
                console.log(
                    `[MemoryMonitor] Recovered to normal: heap at ${stats.usagePercent}%`
                );
            }
            this._consecutiveWarnings = 0;
        }
    }

    _statusFromPercent(percent) {
        if (percent >= _CRITICAL_PERCENT) return 'critical';
        if (percent >= _WARN_PERCENT)     return 'warning';
        return 'ok';
    }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────────

module.exports = {
    // Section A
    EventListenerManager,
    createRequestScopeMiddleware,

    // Section B
    MemoryMonitor,
};
