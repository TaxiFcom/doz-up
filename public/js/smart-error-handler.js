/**
 * DOZ UP - Smart Error Handler (Frontend)
 *
 * Replaces all browser alert() popups with intelligent, non-intrusive
 * toast notifications connected to the AI Error Interceptor backend.
 *
 * Features:
 * - Overrides window.alert globally
 * - Catches unhandled errors and promise rejections
 * - Sends errors to AI backend for real-time analysis & fixing
 * - Shows sleek toast notifications instead of ugly alerts
 * - Shows AI status ("Fixing...", "Resolved") for backend issues
 * - Suppresses technical errors that AI handles silently
 * - User-relevant errors (auth, payment, upload) still show clearly
 *
 * Usage: Include this script in <head> of every page:
 *   <script src="/js/smart-error-handler.js"></script>
 */

(function () {
    'use strict';

    // ============ CONFIGURATION ============
    const SEH_CONFIG = {
        apiEndpoint: '/api/ai/report-error',
        toastDuration: 4000,
        toastDurationLong: 6000,
        maxToasts: 3,
        debounceMs: 500,
        suppressDuplicateMs: 5000,
    };

    // Track recent messages to prevent duplicates
    const recentMessages = new Map();
    let toastContainer = null;
    let toastCount = 0;

    // ============ TOAST UI ============
    function ensureToastContainer() {
        if (toastContainer && document.body.contains(toastContainer)) return;

        toastContainer = document.createElement('div');
        toastContainer.id = 'doz-smart-toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
            max-width: 400px;
            width: calc(100% - 40px);
        `;
        document.body.appendChild(toastContainer);
    }

    function createToast(message, type = 'info', options = {}) {
        ensureToastContainer();

        // Limit visible toasts
        const existingToasts = toastContainer.querySelectorAll('.doz-smart-toast');
        if (existingToasts.length >= SEH_CONFIG.maxToasts) {
            existingToasts[0].remove();
        }

        const toast = document.createElement('div');
        toast.className = 'doz-smart-toast';

        const colors = {
            success: { bg: 'rgba(16, 185, 129, 0.95)', icon: '&#10003;' },
            error: { bg: 'rgba(239, 68, 68, 0.95)', icon: '&#10007;' },
            warning: { bg: 'rgba(245, 158, 11, 0.95)', icon: '&#9888;' },
            info: { bg: 'rgba(99, 102, 241, 0.95)', icon: '&#8505;' },
            ai: { bg: 'rgba(139, 92, 246, 0.95)', icon: '&#9881;' },
        };

        const style = colors[type] || colors.info;

        toast.style.cssText = `
            background: ${style.bg};
            color: white;
            padding: 14px 20px;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.4;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            pointer-events: auto;
            cursor: pointer;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            animation: dozToastIn 0.3s ease;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            max-width: 100%;
            word-break: break-word;
            opacity: 1;
            transition: opacity 0.3s ease, transform 0.3s ease;
        `;

        const iconEl = document.createElement('span');
        iconEl.innerHTML = style.icon;
        iconEl.style.cssText = `
            font-size: 18px;
            flex-shrink: 0;
            margin-top: 1px;
        `;

        const textEl = document.createElement('span');
        textEl.style.cssText = 'flex: 1;';
        textEl.textContent = message;

        // Add AI badge for AI-handled issues
        if (options.aiHandled) {
            const aiBadge = document.createElement('span');
            aiBadge.textContent = 'AI';
            aiBadge.style.cssText = `
                background: rgba(255,255,255,0.2);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.5px;
                flex-shrink: 0;
                margin-top: 2px;
            `;
            toast.appendChild(iconEl);
            toast.appendChild(textEl);
            toast.appendChild(aiBadge);
        } else {
            toast.appendChild(iconEl);
            toast.appendChild(textEl);
        }

        // Close on click
        toast.addEventListener('click', () => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        });

        toastContainer.appendChild(toast);

        // Auto-remove
        const duration = options.duration || (type === 'error' ? SEH_CONFIG.toastDurationLong : SEH_CONFIG.toastDuration);
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);

        return toast;
    }

    // Inject toast animation CSS
    function injectStyles() {
        if (document.getElementById('doz-smart-toast-styles')) return;
        const style = document.createElement('style');
        style.id = 'doz-smart-toast-styles';
        style.textContent = `
            @keyframes dozToastIn {
                from { opacity: 0; transform: translateX(100%) scale(0.8); }
                to { opacity: 1; transform: translateX(0) scale(1); }
            }
            @keyframes dozAiPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }

    // ============ ERROR REPORTING TO AI BACKEND ============
    async function reportToAI(message, source, extra = {}) {
        try {
            const body = {
                message: String(message).substring(0, 1000),
                source: source || 'frontend',
                page: window.location.pathname,
                url: window.location.href,
                deviceId: getDeviceId(),
                timestamp: Date.now(),
                context: {
                    userAgent: navigator.userAgent,
                    ...extra,
                },
            };

            const response = await fetch(SEH_CONFIG.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            // AI backend unavailable — fail silently
        }
        return null;
    }

    function getDeviceId() {
        try {
            return localStorage.getItem('deviceId') || sessionStorage.getItem('deviceId') || 'unknown';
        } catch (e) {
            return 'unknown';
        }
    }

    // ============ DUPLICATE PREVENTION ============
    function isDuplicate(message) {
        const key = String(message).toLowerCase().substring(0, 100);
        const now = Date.now();

        if (recentMessages.has(key) && (now - recentMessages.get(key)) < SEH_CONFIG.suppressDuplicateMs) {
            return true;
        }

        recentMessages.set(key, now);

        // Clean old entries
        if (recentMessages.size > 50) {
            for (const [k, t] of recentMessages) {
                if (now - t > SEH_CONFIG.suppressDuplicateMs * 2) {
                    recentMessages.delete(k);
                }
            }
        }

        return false;
    }

    // ============ MESSAGE CLASSIFICATION ============
    function classifyMessage(message) {
        const msg = String(message).toLowerCase();

        // SUCCESS messages — keep showing as success toast
        if (msg.includes('copied') || msg.includes('saved') || msg.includes('success') ||
            msg.includes('enabled') || msg.includes('uploaded') || msg.includes('created') ||
            msg.includes('approved') || msg.includes('deleted') || msg.includes('updated') ||
            msg.includes('link copied') || msg.includes('completed') || msg.includes('welcome') ||
            msg.includes('muted') || msg.includes('unmuted') || msg.includes('up to date')) {
            return 'success';
        }

        // INFO messages — user confirmations, not errors
        if (msg.includes('coming soon') || msg.includes('invite code') ||
            msg.includes('please confirm') || msg.includes('please enter') ||
            msg.includes('please fill') || msg.includes('please select') ||
            msg.includes('please sign up') || msg.includes('please start') ||
            msg.includes('please capture') || msg.includes('please log in') ||
            msg.includes('passwords do not match') || msg.includes('password must be') ||
            msg.includes('valid email') || msg.includes('not supported')) {
            return 'warning';
        }

        // TECHNICAL errors — send to AI, may suppress from user
        if (msg.includes('econnrefused') || msg.includes('redis') || msg.includes('queue') ||
            msg.includes('cannot read property') || msg.includes('undefined is not') ||
            msg.includes('is not a function') || msg.includes('syntax error') ||
            msg.includes('network error') || msg.includes('fetch failed') ||
            msg.includes('connection error') || msg.includes('form elements not found')) {
            return 'technical';
        }

        // ERROR messages — show to user
        if (msg.includes('failed') || msg.includes('error') || msg.includes('invalid') ||
            msg.includes('denied') || msg.includes('blocked') || msg.includes('could not')) {
            return 'error';
        }

        // Default — treat as info
        return 'info';
    }

    // ============ SMART ALERT REPLACEMENT ============
    const originalAlert = window.alert;

    window.alert = function (message) {
        if (isDuplicate(message)) return;

        const classification = classifyMessage(message);

        if (classification === 'technical') {
            // Send to AI — don't show to user
            reportToAI(message, 'alert').then(result => {
                if (result && result.userMessage) {
                    createToast(result.userMessage, 'ai', { aiHandled: true });
                }
                // Otherwise: completely silent
            });
            return;
        }

        if (classification === 'success') {
            createToast(message, 'success');
            return;
        }

        if (classification === 'warning') {
            createToast(message, 'warning');
            return;
        }

        if (classification === 'error') {
            // Show to user AND report to AI
            createToast(message, 'error');
            reportToAI(message, 'alert', { classification: 'error' });
            return;
        }

        // Info — show as info toast
        createToast(message, 'info');
    };

    // ============ GLOBAL ERROR HANDLER ============
    window.addEventListener('error', function (event) {
        const message = event.message || 'Unknown error';
        if (isDuplicate(message)) return;

        // Always report to AI — never show technical JS errors to users
        reportToAI(message, 'uncaught-error', {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack,
        });
        // Silent — AI handles it
    });

    // ============ UNHANDLED PROMISE REJECTION HANDLER ============
    window.addEventListener('unhandledrejection', function (event) {
        const message = event.reason?.message || String(event.reason) || 'Unhandled promise rejection';
        if (isDuplicate(message)) return;

        reportToAI(message, 'unhandled-rejection', {
            stack: event.reason?.stack,
        });
        // Silent — AI handles it
    });

    // ============ UPLOAD ERROR REPORTER ============
    async function reportUploadError(url, httpStatus, errorMessage, originalArgs) {
        try {
            var body = {
                errorMessage: errorMessage || ('HTTP ' + httpStatus),
                httpStatus: httpStatus,
                deviceId: getDeviceId(),
                endpoint: url,
                fileSize: 0,
                fileType: '',
            };

            // Extract file info from FormData if available
            if (originalArgs && originalArgs[1] && originalArgs[1].body instanceof FormData) {
                var file = originalArgs[1].body.get('image') || originalArgs[1].body.get('file');
                if (file) {
                    body.fileSize = file.size || 0;
                    body.fileType = file.type || '';
                }
            }

            var response = await originalFetch('/api/upload-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            // upload-check endpoint itself failed
        }
        return null;
    }

    function isUploadEndpoint(url) {
        return url && (url.includes('/upload') || url.includes('/api/upload-fast'));
    }

    // ============ FETCH ERROR INTERCEPTOR ============
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        try {
            const response = await originalFetch.apply(this, args);
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

            // Upload endpoint failure detection
            if (isUploadEndpoint(url) && !response.ok) {
                var resolution = await reportUploadError(url, response.status, null, args);
                if (resolution && resolution.canRetry && resolution.tip) {
                    createToast(resolution.tip, 'ai', { aiHandled: true, duration: 3000 });
                } else if (resolution && !resolution.canRetry && resolution.tip) {
                    createToast(resolution.tip, 'warning', { duration: 5000 });
                }
            }

            // Report 5xx server errors to AI
            if (response.status >= 500) {
                // Don't report AI endpoint errors to AI (infinite loop)
                if (!url.includes('/api/ai/') && !url.includes('/api/upload-check')) {
                    reportToAI('Server error ' + response.status + ' on ' + url, 'fetch-5xx', {
                        status: response.status,
                        url: url,
                    });
                }
            }

            return response;
        } catch (err) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

            // Upload-specific failure with AI guidance
            if (isUploadEndpoint(url)) {
                var resolution = await reportUploadError(url, 0, err.message, args);
                if (resolution && resolution.canRetry && resolution.tip) {
                    createToast(resolution.tip, 'ai', { aiHandled: true, duration: 4000 });
                }
            }

            // Don't report AI endpoint errors
            if (!url.includes('/api/ai/') && !url.includes('/api/upload-check')) {
                reportToAI('Fetch failed: ' + err.message + ' (' + url + ')', 'fetch-error', {
                    url: url,
                    error: err.message,
                });
            }
            throw err;
        }
    };

    // ============ CONSOLE.ERROR INTERCEPTOR ============
    const originalConsoleError = console.error;
    console.error = function (...args) {
        originalConsoleError.apply(console, args);

        // Report significant console errors to AI
        const message = args.map(a => {
            if (a instanceof Error) return a.message;
            if (typeof a === 'object') {
                try { return JSON.stringify(a).substring(0, 200); } catch (e) { return String(a); }
            }
            return String(a);
        }).join(' ');

        if (message.length > 10 && !message.includes('/api/ai/')) {
            reportToAI(message, 'console-error');
        }
    };

    // ============ DOZ ALERT API (for migration) ============
    /**
     * Smart alert replacement.
     * Use this instead of alert() in new code.
     *
     * @param {string} message - The message to show
     * @param {string} type - 'success' | 'error' | 'warning' | 'info' | 'ai'
     * @param {Object} options - { duration, aiHandled }
     */
    window.dozAlert = function (message, type, options = {}) {
        if (isDuplicate(message)) return;

        type = type || classifyMessage(message);

        if (type === 'technical') {
            reportToAI(message, 'dozAlert');
            return;
        }

        createToast(message, type, options);

        if (type === 'error') {
            reportToAI(message, 'dozAlert', { classification: 'error' });
        }
    };

    // ============ SHOWTOAST ENHANCEMENT ============
    // If the page already has a showToast function, enhance it to also report errors
    const originalShowToast = window.showToast;
    if (typeof originalShowToast === 'function') {
        window.showToast = function (message, type) {
            originalShowToast(message, type);
            if (type === 'error') {
                reportToAI(message, 'showToast-error');
            }
        };
    }

    // ============ SAFE MODE BANNER KILLER ============
    // Old cached performance-guard.js creates a red "Performance issue detected -
    // Running in safe mode" banner. This code removes it on sight AND prevents
    // the old code from ever creating it again.

    // 1. Override the old performance guard before it can act
    window.DOZ_PERF_GUARD = {
        getStatus: function () { return { status: 'disabled', freezeCount: 0 }; },
        reset: function () {},
        enableSafeMode: function () {},  // Block safe mode activation
        showBanner: function () {},       // Block banner creation
        disable: function () {},
    };

    // 2. Prevent any script from posting to performance-log (kills freeze event reporting)
    var _origSendBeacon = navigator.sendBeacon;
    if (_origSendBeacon) {
        navigator.sendBeacon = function (url, data) {
            if (typeof url === 'string' && url.includes('performance-log')) {
                return true; // Silently swallow
            }
            return _origSendBeacon.apply(navigator, arguments);
        };
    }

    // 3. Active banner scanner — removes any "safe mode" or "performance" banner/overlay
    function killSafeModeBanner() {
        // Target common banner patterns: fixed position red elements with performance text
        var allElements = document.querySelectorAll(
            '[style*="fixed"], [style*="position"], .safe-mode-banner, .perf-banner, ' +
            '.performance-banner, #safeModeOverlay, #perfBanner, #performanceBanner, ' +
            '#safe-mode-bar, .safe-mode-bar'
        );
        for (var i = 0; i < allElements.length; i++) {
            var el = allElements[i];
            var text = (el.textContent || '').toLowerCase();
            if ((text.includes('safe mode') || text.includes('performance issue') ||
                 text.includes('performance detected') || text.includes('running in safe')) &&
                (text.includes('reload') || text.includes('detected') || text.includes('running'))) {
                el.remove();
                reportToAI('Removed stale safe-mode banner from cached code', 'banner-killer');
            }
        }
    }

    // Run banner killer immediately, on DOM ready, and periodically for 30 seconds
    killSafeModeBanner();
    var _bannerKillCount = 0;
    var _bannerKillInterval = setInterval(function () {
        killSafeModeBanner();
        _bannerKillCount++;
        if (_bannerKillCount >= 30) clearInterval(_bannerKillInterval); // Stop after 30s
    }, 1000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            killSafeModeBanner();
            injectStyles();
        });
    } else {
        killSafeModeBanner();
        injectStyles();
    }

    // 4. MutationObserver: catch dynamically inserted banners in real-time
    if (window.MutationObserver) {
        var _bannerObserver = new MutationObserver(function (mutations) {
            for (var m = 0; m < mutations.length; m++) {
                var added = mutations[m].addedNodes;
                for (var n = 0; n < added.length; n++) {
                    var node = added[n];
                    if (node.nodeType === 1) {
                        var txt = (node.textContent || '').toLowerCase();
                        if ((txt.includes('safe mode') || txt.includes('performance issue')) &&
                            (txt.includes('reload') || txt.includes('detected'))) {
                            node.remove();
                            reportToAI('Blocked safe-mode banner insertion', 'banner-killer-observer');
                        }
                    }
                }
            }
        });

        function startBannerObserver() {
            if (document.body) {
                _bannerObserver.observe(document.body, { childList: true, subtree: true });
                // Stop observing after 60 seconds (performance)
                setTimeout(function () { _bannerObserver.disconnect(); }, 60000);
            }
        }

        if (document.body) {
            startBannerObserver();
        } else {
            document.addEventListener('DOMContentLoaded', startBannerObserver);
        }
    }

    // ============ WEBSOCKET: UPLOAD RECOVERY LISTENER ============
    function listenForUploadRecovery() {
        try {
            // Listen for upload_recovered messages on existing WS connections
            window.addEventListener('doz:upload:recovered', function (e) {
                createToast(
                    (e.detail && e.detail.message) || 'Upload service recovered. You can retry now.',
                    'ai',
                    { aiHandled: true, duration: 5000 }
                );
            });

            // Hook into the existing live WebSocket if present
            function hookExistingWS() {
                if (window.__dozLiveWS && window.__dozLiveWS.readyState === 1) {
                    var origHandler = window.__dozLiveWS.onmessage;
                    window.__dozLiveWS.addEventListener('message', function (event) {
                        try {
                            var data = JSON.parse(event.data);
                            if (data.type === 'upload_recovered') {
                                window.dispatchEvent(new CustomEvent('doz:upload:recovered', { detail: data }));
                            }
                        } catch (e) {}
                    });
                }
            }

            // Try immediately and also after a delay (WS may connect later)
            hookExistingWS();
            setTimeout(hookExistingWS, 3000);
            setTimeout(hookExistingWS, 10000);
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', listenForUploadRecovery);
    } else {
        listenForUploadRecovery();
    }

    // ============ INITIALIZATION ============
    if (document.readyState !== 'loading') {
        injectStyles();
    }

    // Mark as loaded
    window.__dozSmartErrorHandler = true;

})();
