/**
 * DOZ UP - User Intelligence Client SDK
 *
 * Tracks user behavior, detects issues, applies personalization,
 * and receives remote fixes automatically.
 */

(function(window) {
    'use strict';

    const DOZ_INTELLIGENCE = {
        version: '2.7.0',
        apiBase: window.location.origin,
        userId: null,
        deviceId: null,
        sessionId: null,
        initialized: false,
        eventQueue: [],
        flushInterval: null,
        personalization: null,
        pendingFixes: [],

        // ============ INITIALIZATION ============

        init(options = {}) {
            if (this.initialized) return;

            this.userId = options.userId || this.getStoredUserId();
            this.deviceId = options.deviceId || this.getDeviceId();
            this.sessionId = this.generateSessionId();

            console.log('[DOZ Intelligence] Initializing...', {
                userId: this.userId,
                deviceId: this.deviceId
            });

            // Setup event listeners
            this.setupEventListeners();

            // Start event queue flushing
            this.flushInterval = setInterval(() => this.flushEvents(), 5000);

            // Check for pending fixes
            this.checkPendingFixes();
            setInterval(() => this.checkPendingFixes(), 30000);

            // Load personalization
            this.loadPersonalization();

            // Run initial diagnostics
            this.runDiagnostics();

            this.initialized = true;
            this.track('session_start', { page: window.location.pathname });

            console.log('[DOZ Intelligence] Ready');
        },

        // ============ BEHAVIOR TRACKING ============

        track(action, metadata = {}) {
            const event = {
                type: this.getEventType(action),
                action,
                target: metadata.target || null,
                metadata: {
                    ...metadata,
                    url: window.location.href,
                    referrer: document.referrer,
                    screenWidth: window.innerWidth,
                    screenHeight: window.innerHeight,
                    timestamp: Date.now()
                },
                page: window.location.pathname,
                component: metadata.component || null
            };

            this.eventQueue.push(event);

            // Immediate send for important events
            if (this.isImportantEvent(action)) {
                this.flushEvents();
            }

            // Check for frustration patterns
            this.detectFrustration(event);

            return event;
        },

        getEventType(action) {
            const types = {
                click: ['click', 'button_click', 'link_click'],
                navigation: ['page_view', 'navigate', 'back', 'forward'],
                capture: ['capture_start', 'capture_complete', 'capture_cancel', 'capture_error'],
                upload: ['upload_start', 'upload_complete', 'upload_error'],
                error: ['error', 'crash', 'exception'],
                engagement: ['scroll', 'focus', 'blur', 'idle']
            };

            for (const [type, actions] of Object.entries(types)) {
                if (actions.some(a => action.includes(a))) return type;
            }
            return 'interaction';
        },

        isImportantEvent(action) {
            const important = ['error', 'crash', 'capture_error', 'upload_error', 'frustration'];
            return important.some(i => action.includes(i));
        },

        async flushEvents() {
            if (this.eventQueue.length === 0) return;

            const events = [...this.eventQueue];
            this.eventQueue = [];

            for (const event of events) {
                try {
                    await fetch(`${this.apiBase}/api/intelligence/track`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: this.userId,
                            deviceId: this.deviceId,
                            event
                        })
                    });
                } catch (err) {
                    // Re-queue failed events
                    this.eventQueue.unshift(event);
                    console.warn('[DOZ Intelligence] Track failed, will retry');
                    break;
                }
            }
        },

        // ============ EVENT LISTENERS ============

        setupEventListeners() {
            // Page visibility
            document.addEventListener('visibilitychange', () => {
                this.track(document.hidden ? 'page_hidden' : 'page_visible');
            });

            // Click tracking
            document.addEventListener('click', (e) => {
                const target = e.target.closest('[data-track]') || e.target;
                const trackId = target.dataset?.track || target.id || target.className;
                this.track('click', {
                    target: trackId,
                    tagName: target.tagName,
                    text: target.textContent?.substring(0, 50)
                });
            });

            // Error tracking
            window.addEventListener('error', (e) => {
                this.track('error', {
                    message: e.message,
                    filename: e.filename,
                    lineno: e.lineno,
                    colno: e.colno,
                    signal: 'js_error'
                });
            });

            // Unhandled promise rejections
            window.addEventListener('unhandledrejection', (e) => {
                this.track('error', {
                    message: e.reason?.message || String(e.reason),
                    type: 'unhandled_rejection',
                    signal: 'promise_error'
                });
            });

            // Scroll tracking (debounced)
            let scrollTimeout;
            window.addEventListener('scroll', () => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    const scrollPercent = Math.round(
                        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
                    );
                    this.track('scroll', { scrollPercent });
                }, 500);
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.track('key_escape');
                }
                if (e.ctrlKey || e.metaKey) {
                    this.track('shortcut', { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey });
                }
            });

            // Page unload
            window.addEventListener('beforeunload', () => {
                this.track('session_end');
                this.flushEvents();
            });

            // Form interactions
            document.addEventListener('submit', (e) => {
                const form = e.target;
                this.track('form_submit', {
                    formId: form.id,
                    formAction: form.action
                });
            });

            // Idle detection
            this.setupIdleDetection();
        },

        setupIdleDetection() {
            let idleTime = 0;
            const idleThreshold = 60000; // 1 minute

            const resetIdle = () => {
                if (idleTime >= idleThreshold) {
                    this.track('user_returned', { idleDuration: idleTime });
                }
                idleTime = 0;
            };

            setInterval(() => {
                idleTime += 1000;
                if (idleTime === idleThreshold) {
                    this.track('user_idle', { signal: 'long_idle_time' });
                }
            }, 1000);

            ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'].forEach(event => {
                document.addEventListener(event, resetIdle, { passive: true });
            });
        },

        // ============ FRUSTRATION DETECTION ============

        recentClicks: [],
        recentActions: [],

        detectFrustration(event) {
            const now = Date.now();

            // Track recent clicks for rage-click detection
            if (event.action === 'click') {
                this.recentClicks.push(now);
                this.recentClicks = this.recentClicks.filter(t => now - t < 5000);

                // Rage click: more than 5 clicks in 3 seconds
                if (this.recentClicks.length >= 5) {
                    const span = this.recentClicks[this.recentClicks.length - 1] - this.recentClicks[0];
                    if (span < 3000) {
                        this.track('frustration_detected', {
                            type: 'rage_clicks',
                            clickCount: this.recentClicks.length,
                            signal: 'rage_clicks'
                        });
                        this.recentClicks = [];
                    }
                }
            }

            // Track recent actions for repetition detection
            this.recentActions.push({ action: event.action, time: now });
            this.recentActions = this.recentActions.filter(a => now - a.time < 30000);

            // Same action repeated many times
            const actionCounts = {};
            this.recentActions.forEach(a => {
                actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
            });
            const maxRepeat = Math.max(...Object.values(actionCounts));
            if (maxRepeat >= 5) {
                const repeatedAction = Object.keys(actionCounts).find(k => actionCounts[k] === maxRepeat);
                this.track('frustration_detected', {
                    type: 'repeated_action',
                    action: repeatedAction,
                    count: maxRepeat,
                    signal: 'error_retry_loop'
                });
            }
        },

        // ============ REMOTE FIXES ============

        async checkPendingFixes() {
            try {
                const res = await fetch(`${this.apiBase}/api/intelligence/fixes/${this.deviceId}`);
                const data = await res.json();

                if (data.success && data.fixes?.length > 0) {
                    for (const fix of data.fixes) {
                        await this.applyFix(fix);
                    }
                }
            } catch (err) {
                console.warn('[DOZ Intelligence] Failed to check fixes:', err.message);
            }
        },

        async applyFix(fix) {
            console.log('[DOZ Intelligence] Applying fix:', fix.fix.name);
            let result = { success: false };

            try {
                switch (fix.fix.type) {
                    case 'ui_action':
                        result = await this.applyUIAction(fix.fix.action);
                        break;
                    case 'config_push':
                        result = this.applyConfig(fix.fix.config);
                        break;
                    case 'remote_command':
                        result = await this.executeCommand(fix.fix.command);
                        break;
                    default:
                        console.warn('[DOZ Intelligence] Unknown fix type:', fix.fix.type);
                }

                result.success = true;
            } catch (err) {
                result.error = err.message;
            }

            // Report result
            await fetch(`${this.apiBase}/api/intelligence/fixes/${fix.id}/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result)
            });

            return result;
        },

        async applyUIAction(action) {
            switch (action.type) {
                case 'show_modal':
                    this.showHelperModal(action.modal);
                    break;
                case 'show_overlay':
                    this.showOverlay(action.overlay);
                    break;
                case 'spotlight':
                    this.spotlightFeature(action.target);
                    break;
                case 'show_tip':
                    this.showTip(action.tip);
                    break;
                case 'show_help_widget':
                    this.showHelpWidget(action.message);
                    break;
            }
            return { applied: action.type };
        },

        applyConfig(config) {
            // Store config for app to use
            localStorage.setItem('doz_config_override', JSON.stringify(config));
            return { configApplied: true };
        },

        async executeCommand(command) {
            // Commands are handled by desktop/mobile app
            // Dispatch custom event for app to handle
            window.dispatchEvent(new CustomEvent('doz-remote-command', {
                detail: command
            }));
            return { commandDispatched: command.action };
        },

        // ============ UI HELPERS ============

        showHelperModal(modalType) {
            const modal = document.createElement('div');
            modal.className = 'doz-helper-modal';
            modal.innerHTML = this.getModalContent(modalType);
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8); z-index: 99999;
                display: flex; align-items: center; justify-content: center;
            `;
            modal.onclick = (e) => {
                if (e.target === modal) modal.remove();
            };
            document.body.appendChild(modal);
        },

        getModalContent(modalType) {
            const content = {
                capture_tutorial: `
                    <div style="background:#1a1a2e;padding:30px;border-radius:15px;max-width:500px;color:#fff;">
                        <h2 style="margin:0 0 20px">How to Capture Screenshots</h2>
                        <ol style="line-height:2">
                            <li>Press <kbd style="background:#333;padding:5px 10px;border-radius:5px">Ctrl+Shift+S</kbd> to capture</li>
                            <li>Click and drag to select an area</li>
                            <li>Release to capture - link copied automatically!</li>
                        </ol>
                        <button onclick="this.parentElement.parentElement.remove()"
                            style="margin-top:20px;padding:10px 30px;background:linear-gradient(135deg,#ec4899,#8b5cf6);border:none;color:#fff;border-radius:10px;cursor:pointer">
                            Got it!
                        </button>
                    </div>
                `
            };
            return content[modalType] || '<div style="padding:20px;background:#fff;border-radius:10px">Help content</div>';
        },

        showOverlay(overlayType) {
            // Show navigation guide overlay
            console.log('[DOZ Intelligence] Showing overlay:', overlayType);
        },

        spotlightFeature(target) {
            // Highlight a feature element
            const element = document.querySelector(`[data-feature="${target}"]`) ||
                           document.querySelector(`#${target}`) ||
                           document.querySelector(`.${target}`);
            if (element) {
                element.style.boxShadow = '0 0 0 4px #ec4899, 0 0 20px rgba(236,72,153,0.5)';
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => element.style.boxShadow = '', 5000);
            }
        },

        showTip(tipId) {
            const tips = {
                quick_action_reminder: 'Tip: Press Ctrl+Shift+S for instant screenshot!'
            };
            this.showToast(tips[tipId] || 'Helpful tip here!');
        },

        showHelpWidget(message) {
            const widget = document.createElement('div');
            widget.innerHTML = `
                <div style="position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#ec4899,#8b5cf6);
                    padding:15px 25px;border-radius:25px;color:#fff;cursor:pointer;z-index:99999;
                    box-shadow:0 5px 20px rgba(0,0,0,0.3);animation:dozPulse 2s infinite">
                    ${message || 'Need help?'}
                </div>
            `;
            document.body.appendChild(widget);
            setTimeout(() => widget.remove(), 10000);
        },

        showToast(message) {
            const toast = document.createElement('div');
            toast.textContent = message;
            toast.style.cssText = `
                position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
                background:#333;color:#fff;padding:12px 24px;border-radius:8px;
                z-index:99999;animation:dozFadeIn 0.3s
            `;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        },

        // ============ PERSONALIZATION ============

        async loadPersonalization() {
            if (!this.userId) return;

            try {
                const res = await fetch(`${this.apiBase}/api/intelligence/personalization/${this.userId}`);
                const data = await res.json();

                if (data.success) {
                    this.personalization = data.profile;
                    this.applyPersonalization(data.profile);

                    if (data.recommendations?.length > 0) {
                        this.showRecommendations(data.recommendations);
                    }
                }
            } catch (err) {
                console.warn('[DOZ Intelligence] Failed to load personalization:', err.message);
            }
        },

        applyPersonalization(profile) {
            if (!profile) return;

            // Apply theme
            if (profile.ui?.theme === 'dark' ||
                (profile.ui?.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.body.classList.add('dark-mode');
            }

            // Apply density
            if (profile.ui?.density === 'compact') {
                document.body.classList.add('compact-ui');
            }

            // Disable animations if preferred
            if (profile.ui?.animations === false) {
                document.body.classList.add('reduce-motion');
            }

            // Adjust help level
            if (profile.behavior?.helpLevel === 'none') {
                document.querySelectorAll('.help-tooltip').forEach(el => el.style.display = 'none');
            }

            console.log('[DOZ Intelligence] Personalization applied');
        },

        showRecommendations(recommendations) {
            // Show recommendations after a delay
            setTimeout(() => {
                const rec = recommendations[0];
                if (rec && rec.type === 'theme' && rec.suggestion === 'dark') {
                    this.showToast(`Tip: ${rec.reason}. Try dark mode!`);
                }
            }, 5000);
        },

        // ============ DIAGNOSTICS ============

        async runDiagnostics() {
            const deviceInfo = {
                version: this.version,
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                screenWidth: screen.width,
                screenHeight: screen.height,
                colorDepth: screen.colorDepth,
                memory: navigator.deviceMemory,
                cores: navigator.hardwareConcurrency,
                connection: navigator.connection?.effectiveType,
                lastSeen: Date.now()
            };

            try {
                const res = await fetch(`${this.apiBase}/api/intelligence/diagnostics`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deviceId: this.deviceId,
                        deviceInfo
                    })
                });
                const data = await res.json();

                if (data.diagnostic?.recommendations?.length > 0) {
                    console.log('[DOZ Intelligence] Diagnostic recommendations:',
                        data.diagnostic.recommendations);
                }
            } catch (err) {
                console.warn('[DOZ Intelligence] Diagnostics failed:', err.message);
            }
        },

        // ============ FEEDBACK ============

        async submitFeedback(feedback) {
            try {
                const res = await fetch(`${this.apiBase}/api/intelligence/feedback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.userId,
                        deviceId: this.deviceId,
                        feedback: {
                            ...feedback,
                            page: window.location.pathname
                        }
                    })
                });
                const data = await res.json();
                return data.success;
            } catch (err) {
                console.error('[DOZ Intelligence] Feedback failed:', err);
                return false;
            }
        },

        // ============ UTILITIES ============

        getStoredUserId() {
            let userId = localStorage.getItem('doz_userId');
            if (!userId) {
                userId = 'anon_' + this.generateId();
                localStorage.setItem('doz_userId', userId);
            }
            return userId;
        },

        getDeviceId() {
            let deviceId = localStorage.getItem('doz_deviceId');
            if (!deviceId) {
                deviceId = 'web_' + this.generateId();
                localStorage.setItem('doz_deviceId', deviceId);
            }
            return deviceId;
        },

        generateSessionId() {
            return 'sess_' + this.generateId();
        },

        generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        }
    };

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes dozPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        @keyframes dozFadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .compact-ui { font-size: 14px !important; }
        .compact-ui .card, .compact-ui .panel { padding: 10px !important; }
        .reduce-motion * { animation: none !important; transition: none !important; }
    `;
    document.head.appendChild(style);

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => DOZ_INTELLIGENCE.init());
    } else {
        DOZ_INTELLIGENCE.init();
    }

    // Expose globally
    window.DOZ_INTELLIGENCE = DOZ_INTELLIGENCE;

})(window);
