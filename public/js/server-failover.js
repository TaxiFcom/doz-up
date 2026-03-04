/**
 * DOZ UP - Server Failover Module
 * Automatic failover between primary server and Spaceship mirror.
 * Works in Browser, Electron, and Chrome Extension contexts.
 *
 * Primary: up.doz.com (198.244.138.177) - DOZ UP Production Server
 * Mirror:  up.doz.com.im (Spaceship cPanel) - Backup/Failover
 *
 * Behavior:
 * - Health-checks primary every 15s
 * - Switches to mirror after 1 consecutive failure (fast failover)
 * - Switches back after 2 consecutive primary successes
 * - Wraps fetch to auto-route API calls to active server
 * - Queues failed writes for replay on recovery
 */

(function(root) {
    'use strict';

    // ============ CONFIGURATION ============
    var FAILOVER_CONFIG = {
        servers: [
            {
                id: 'primary',
                name: 'DOZ UP',
                baseUrl: 'https://up.doz.com',
                healthPath: '/health',
                priority: 1
            },
            {
                id: 'mirror',
                name: 'Mirror',
                baseUrl: 'https://up.doz.com.im',
                healthPath: '/health',
                priority: 2
            }
        ],
        healthCheckInterval: 15000,    // Check every 15s (was 30s) for faster detection
        healthCheckTimeout: 5000,
        failThreshold: 1,              // Switch after 1 failure (was 2) for instant failover
        recoveryThreshold: 2,          // Recover after 2 successes (was 3) for faster recovery
        maxQueueSize: 500,             // Larger queue (was 100) to buffer more during outage
        queueTTL: 7200000,            // 2 hours (was 1 hour) - more time to replay
        storageKey: 'doz_failover_state',
        queueKey: 'doz_failover_queue'
    };

    // ============ STATE ============
    var activeServerIndex = 0;
    var failCounts = {};
    var recoveryCounts = {};
    var healthInterval = null;
    var listeners = {};
    var offlineQueue = [];
    var initialized = false;
    var isNode = typeof module !== 'undefined' && module.exports;
    var hasLocalStorage = false;

    try {
        hasLocalStorage = typeof localStorage !== 'undefined' && localStorage !== null;
    } catch (e) {
        hasLocalStorage = false;
    }

    // ============ FAILOVER CLASS ============
    var ServerFailover = {

        /**
         * Initialize the failover system
         */
        init: function() {
            if (initialized) return;
            initialized = true;

            // Initialize fail/recovery counters
            FAILOVER_CONFIG.servers.forEach(function(s) {
                failCounts[s.id] = 0;
                recoveryCounts[s.id] = 0;
            });

            // Restore persisted state
            this._restoreState();

            // Load offline queue
            this._loadQueue();

            // Start health monitoring
            this._startHealthLoop();

            // Try replaying queued items
            this._replayQueue();

            console.log('[Failover] Initialized. Active server:', this.getActiveServer().name,
                '(' + this.getActiveServer().baseUrl + ')');
        },

        /**
         * Get the currently active server config
         */
        getActiveServer: function() {
            return FAILOVER_CONFIG.servers[activeServerIndex];
        },

        /**
         * Get full URL for a path on the active server
         */
        getServerUrl: function(path) {
            var server = this.getActiveServer();
            if (path.startsWith('http')) return path;
            return server.baseUrl + (path.startsWith('/') ? path : '/' + path);
        },

        /**
         * Check if currently on the mirror server
         */
        isOnMirror: function() {
            return activeServerIndex > 0;
        },

        /**
         * Check if currently on the primary server
         */
        isOnPrimary: function() {
            return activeServerIndex === 0;
        },

        /**
         * Get status of all servers
         */
        getStatus: function() {
            var self = this;
            return {
                activeServer: self.getActiveServer().id,
                servers: FAILOVER_CONFIG.servers.map(function(s) {
                    return {
                        id: s.id,
                        name: s.name,
                        url: s.baseUrl,
                        failCount: failCounts[s.id] || 0,
                        recoveryCount: recoveryCounts[s.id] || 0
                    };
                }),
                queueSize: offlineQueue.length,
                initialized: initialized
            };
        },

        /**
         * Failover-aware fetch wrapper
         * Automatically routes to active server and handles failover
         */
        fetch: function(path, options) {
            var self = this;
            options = options || {};

            // Build URL for active server
            var url = self.getServerUrl(path);

            return fetch(url, options).then(function(response) {
                // Success on active server - reset fail count
                var server = self.getActiveServer();
                failCounts[server.id] = 0;
                return response;
            }).catch(function(error) {
                // Active server failed
                var server = self.getActiveServer();
                failCounts[server.id] = (failCounts[server.id] || 0) + 1;
                console.warn('[Failover] Request failed on', server.name, '(' + failCounts[server.id] + '/' + FAILOVER_CONFIG.failThreshold + ')');

                // Check if we should switch
                if (failCounts[server.id] >= FAILOVER_CONFIG.failThreshold) {
                    self._switchToNext('fetch_failure');
                }

                // Try the other server
                var altUrl = self._getAlternateUrl(path);
                if (altUrl && altUrl !== url) {
                    console.log('[Failover] Retrying on alternate server:', altUrl);
                    return fetch(altUrl, options).catch(function(altError) {
                        // Both servers failed - queue writes for later
                        if (options.method && options.method !== 'GET') {
                            self._queueRequest(path, options);
                        }
                        throw altError;
                    });
                }

                // Queue write operations for later
                if (options.method && options.method !== 'GET') {
                    self._queueRequest(path, options);
                }
                throw error;
            });
        },

        /**
         * Force switch to a specific server
         */
        forceSwitch: function(serverId) {
            var idx = -1;
            FAILOVER_CONFIG.servers.forEach(function(s, i) {
                if (s.id === serverId) idx = i;
            });
            if (idx >= 0 && idx !== activeServerIndex) {
                var from = this.getActiveServer();
                activeServerIndex = idx;
                var to = this.getActiveServer();
                console.log('[Failover] Forced switch:', from.name, '->', to.name);
                this._emit('serverSwitch', { from: from, to: to, reason: 'manual' });
                this._persistState();
            }
        },

        /**
         * Register event listener
         */
        on: function(event, callback) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(callback);
        },

        /**
         * Remove event listener
         */
        off: function(event, callback) {
            if (!listeners[event]) return;
            listeners[event] = listeners[event].filter(function(cb) { return cb !== callback; });
        },

        /**
         * Destroy the failover system (cleanup)
         */
        destroy: function() {
            if (healthInterval) {
                clearInterval(healthInterval);
                healthInterval = null;
            }
            listeners = {};
            initialized = false;
        },

        // ============ INTERNAL METHODS ============

        /**
         * Start periodic health check loop
         */
        _startHealthLoop: function() {
            var self = this;
            if (healthInterval) clearInterval(healthInterval);

            // Initial check after 5s (don't block page load)
            setTimeout(function() { self._runHealthCheck(); }, 5000);

            healthInterval = setInterval(function() {
                self._runHealthCheck();
            }, FAILOVER_CONFIG.healthCheckInterval);
        },

        /**
         * Run a single health check cycle
         */
        _runHealthCheck: function() {
            var self = this;
            var primary = FAILOVER_CONFIG.servers[0];

            self._checkHealth(primary).then(function(result) {
                if (result.healthy) {
                    failCounts[primary.id] = 0;
                    recoveryCounts[primary.id] = (recoveryCounts[primary.id] || 0) + 1;

                    self._emit('healthUpdate', {
                        server: primary,
                        healthy: true,
                        latency: result.latency
                    });

                    // If on mirror and primary has recovered enough, switch back
                    if (self.isOnMirror() && recoveryCounts[primary.id] >= FAILOVER_CONFIG.recoveryThreshold) {
                        self._switchToPrimary();
                    }
                } else {
                    failCounts[primary.id] = (failCounts[primary.id] || 0) + 1;
                    recoveryCounts[primary.id] = 0;

                    self._emit('healthUpdate', {
                        server: primary,
                        healthy: false,
                        latency: result.latency
                    });

                    // If on primary and failing, switch to mirror
                    if (self.isOnPrimary() && failCounts[primary.id] >= FAILOVER_CONFIG.failThreshold) {
                        self._switchToNext('health_check_failure');
                    }
                }
            });
        },

        /**
         * Check health of a single server
         */
        _checkHealth: function(server) {
            var start = Date.now();
            var url = server.baseUrl + server.healthPath;

            // Use AbortController for timeout if available
            var controller = null;
            var signal = null;
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                signal = controller.signal;
                setTimeout(function() { controller.abort(); }, FAILOVER_CONFIG.healthCheckTimeout);
            }

            var fetchOpts = {
                method: 'GET',
                mode: 'cors',
                cache: 'no-store'
            };
            if (signal) fetchOpts.signal = signal;

            return fetch(url, fetchOpts).then(function(response) {
                var latency = Date.now() - start;
                if (response.ok) {
                    return { healthy: true, latency: latency };
                }
                return { healthy: false, latency: latency };
            }).catch(function() {
                return { healthy: false, latency: Date.now() - start };
            });
        },

        /**
         * Switch to the next available server
         */
        _switchToNext: function(reason) {
            var from = this.getActiveServer();
            var nextIndex = (activeServerIndex + 1) % FAILOVER_CONFIG.servers.length;

            if (nextIndex === activeServerIndex) return; // Only one server

            activeServerIndex = nextIndex;
            var to = this.getActiveServer();

            // Reset counters
            recoveryCounts[from.id] = 0;

            console.log('[Failover] SWITCHING:', from.name, '->', to.name, '(reason:', reason + ')');
            this._emit('serverSwitch', { from: from, to: to, reason: reason });
            this._persistState();
        },

        /**
         * Switch back to primary server
         */
        _switchToPrimary: function() {
            if (this.isOnPrimary()) return;

            var from = this.getActiveServer();
            activeServerIndex = 0;
            var to = this.getActiveServer();

            // Reset all counters
            FAILOVER_CONFIG.servers.forEach(function(s) {
                failCounts[s.id] = 0;
                recoveryCounts[s.id] = 0;
            });

            console.log('[Failover] RECOVERED: Back to', to.name);
            this._emit('serverRecovery', { from: from, to: to });
            this._persistState();

            // Replay any queued requests
            this._replayQueue();
        },

        /**
         * Get URL for the alternate (non-active) server
         */
        _getAlternateUrl: function(path) {
            var altIndex = (activeServerIndex + 1) % FAILOVER_CONFIG.servers.length;
            if (altIndex === activeServerIndex) return null;
            var altServer = FAILOVER_CONFIG.servers[altIndex];
            if (path.startsWith('http')) {
                // Replace domain
                var active = this.getActiveServer();
                return path.replace(active.baseUrl, altServer.baseUrl);
            }
            return altServer.baseUrl + (path.startsWith('/') ? path : '/' + path);
        },

        /**
         * Queue a failed write request for later replay
         */
        _queueRequest: function(path, options) {
            if (offlineQueue.length >= FAILOVER_CONFIG.maxQueueSize) {
                // Remove oldest
                offlineQueue.shift();
            }

            var item = {
                path: path,
                method: options.method || 'POST',
                headers: {},
                body: null,
                timestamp: Date.now()
            };

            // Copy serializable headers
            if (options.headers) {
                if (options.headers instanceof Headers) {
                    options.headers.forEach(function(value, key) {
                        item.headers[key] = value;
                    });
                } else {
                    item.headers = Object.assign({}, options.headers);
                }
            }

            // Only queue text/JSON bodies (not FormData/Blob)
            if (options.body && typeof options.body === 'string') {
                item.body = options.body;
            }

            offlineQueue.push(item);
            this._saveQueue();
            console.log('[Failover] Queued request:', item.method, item.path, '(queue size:', offlineQueue.length + ')');
        },

        /**
         * Replay queued requests against the active server
         */
        _replayQueue: function() {
            if (offlineQueue.length === 0) return;
            if (!this.isOnPrimary()) return; // Only replay on primary

            var self = this;
            var queue = offlineQueue.slice(); // Copy
            offlineQueue = [];
            self._saveQueue();

            var now = Date.now();
            var replayed = 0;
            var expired = 0;

            queue.forEach(function(item) {
                // Skip expired items
                if (now - item.timestamp > FAILOVER_CONFIG.queueTTL) {
                    expired++;
                    return;
                }

                replayed++;
                var url = self.getServerUrl(item.path);
                var opts = {
                    method: item.method,
                    headers: item.headers
                };
                if (item.body) opts.body = item.body;

                fetch(url, opts).catch(function(err) {
                    console.warn('[Failover] Queue replay failed for', item.path, err.message);
                    // Re-queue if still failing
                    offlineQueue.push(item);
                    self._saveQueue();
                });
            });

            if (replayed > 0 || expired > 0) {
                console.log('[Failover] Queue replay: ' + replayed + ' replayed, ' + expired + ' expired');
            }
        },

        /**
         * Persist failover state to storage
         */
        _persistState: function() {
            if (!hasLocalStorage) return;
            try {
                localStorage.setItem(FAILOVER_CONFIG.storageKey, JSON.stringify({
                    activeServerIndex: activeServerIndex,
                    timestamp: Date.now()
                }));
            } catch (e) { /* Storage full or unavailable */ }
        },

        /**
         * Restore failover state from storage
         */
        _restoreState: function() {
            if (!hasLocalStorage) return;
            try {
                var saved = localStorage.getItem(FAILOVER_CONFIG.storageKey);
                if (saved) {
                    var state = JSON.parse(saved);
                    // Only restore if saved within the last 5 minutes
                    if (Date.now() - state.timestamp < 300000) {
                        activeServerIndex = state.activeServerIndex || 0;
                        if (activeServerIndex > 0) {
                            console.log('[Failover] Restored state: using', this.getActiveServer().name);
                        }
                    }
                }
            } catch (e) { /* Corrupt storage */ }
        },

        /**
         * Save offline queue to storage
         */
        _saveQueue: function() {
            if (!hasLocalStorage) return;
            try {
                localStorage.setItem(FAILOVER_CONFIG.queueKey, JSON.stringify(offlineQueue));
            } catch (e) { /* Storage full */ }
        },

        /**
         * Load offline queue from storage
         */
        _loadQueue: function() {
            if (!hasLocalStorage) return;
            try {
                var saved = localStorage.getItem(FAILOVER_CONFIG.queueKey);
                if (saved) {
                    offlineQueue = JSON.parse(saved) || [];
                }
            } catch (e) {
                offlineQueue = [];
            }
        },

        /**
         * Emit an event to all listeners
         */
        _emit: function(event, data) {
            if (!listeners[event]) return;
            listeners[event].forEach(function(cb) {
                try { cb(data); } catch (e) { console.error('[Failover] Event handler error:', e); }
            });

            // Also dispatch DOM event for page scripts
            if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
                window.dispatchEvent(new CustomEvent('doz:failover:' + event, { detail: data }));
            }
        }
    };

    // ============ AUTO-INITIALIZE ============
    if (typeof window !== 'undefined') {
        // Browser or Electron renderer
        window.DOZFailover = ServerFailover;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { ServerFailover.init(); });
        } else {
            ServerFailover.init();
        }
    }

    // Node.js / Electron main process export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServerFailover;
    }

})(typeof window !== 'undefined' ? window : global);
