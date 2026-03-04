/**
 * DOZ UP - Frictionless Auto-Authentication
 * Zero-barrier entry: Users get instant access via device fingerprint
 * No signup forms, no passwords on first visit
 */

(function() {
    'use strict';

    const DOZAutoAuth = {
        deviceId: null,
        user: null,
        initialized: false,

        // Configuration
        config: {
            storagePrefix: 'doz_',
            autoRegisterEndpoint: '/api/auth/auto-register',
            deviceStatusEndpoint: '/api/auth/device-status',
            demoLimitUploads: 10,
            demoLimitStorageMB: 512
        },

        /**
         * Initialize auto-auth on page load
         */
        async init() {
            if (this.initialized) return;
            this.initialized = true;

            console.log('[AutoAuth] Initializing frictionless auth...');

            // Get or create device ID (fingerprint)
            this.deviceId = await this.getOrCreateDeviceId();

            // CHECK: Does the user already have a logged-in session?
            const existingSession = this.getLoggedInSession();
            if (existingSession) {
                console.log('[AutoAuth] Found existing login session, validating...');
                const validated = await this.validateExistingSession(existingSession);
                if (validated) {
                    // Session is valid - use the logged-in account, skip anonymous registration
                    console.log('[AutoAuth] Session valid, user:', existingSession.email || existingSession.id);
                    this.user = {
                        ...validated.user,
                        isPaid: validated.isSubscriptionActive || false,
                        subscription: validated.subscription
                    };
                    // Auto-link this browser's device fingerprint to the account
                    this.linkDeviceToAccount(existingSession.id, this.deviceId);
                    this.emitReady();
                    return;
                }
                // Session invalid/expired - clear it and fall through to anonymous
                console.log('[AutoAuth] Session expired/invalid, clearing...');
                this.clearLoggedInSession();
            }

            // No valid session - proceed with anonymous device auth
            const status = await this.checkDeviceStatus();

            if (status.needsRegistration) {
                // Auto-register this device
                await this.autoRegister();
            } else {
                // Device already registered
                this.user = status;
            }

            this.emitReady();
        },

        /**
         * Emit auth ready event
         */
        emitReady() {
            window.dispatchEvent(new CustomEvent('doz:auth:ready', {
                detail: { deviceId: this.deviceId, user: this.user }
            }));
            console.log('[AutoAuth] Ready:', this.deviceId?.substring(0, 16) + '...');
        },

        /**
         * Get logged-in session from localStorage
         */
        getLoggedInSession() {
            try {
                const sessionStr = localStorage.getItem('doz_user_session');
                const token = localStorage.getItem('dozup_session_token');
                const userId = localStorage.getItem('dozup_user_id') || localStorage.getItem('doz_userId');
                if (sessionStr && userId) {
                    const session = JSON.parse(sessionStr);
                    return { ...session, id: session.id || userId, token: token };
                }
            } catch (e) {
                console.error('[AutoAuth] Failed to read session:', e);
            }
            return null;
        },

        /**
         * Validate existing session with server
         */
        async validateExistingSession(session) {
            try {
                const response = await fetch('/api/auth/validate-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: session.id,
                        sessionToken: session.token
                    })
                });
                const result = await response.json();
                return result.valid ? result : null;
            } catch (error) {
                console.error('[AutoAuth] Session validation failed:', error);
                // Network error - keep session, don't clear (offline-friendly)
                return { valid: true, user: session, isSubscriptionActive: false, subscription: null };
            }
        },

        /**
         * Clear all logged-in session data
         */
        clearLoggedInSession() {
            localStorage.removeItem('doz_user_session');
            localStorage.removeItem('dozup_session_token');
            localStorage.removeItem('dozup_user_id');
            localStorage.removeItem('doz_userId');
            localStorage.removeItem('doz_email');
            localStorage.removeItem('doz_user');
        },

        /**
         * Link device fingerprint to account (fire-and-forget)
         */
        linkDeviceToAccount(userId, deviceId) {
            if (!userId || !deviceId) return;
            fetch('/api/account/link-device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, browserDeviceId: deviceId })
            }).then(r => r.json()).then(result => {
                if (result.success) {
                    console.log('[AutoAuth] Device fingerprint linked to account');
                }
            }).catch(() => {});
        },

        /**
         * Generate device fingerprint
         */
        async generateFingerprint() {
            const components = [];

            // Screen info
            components.push(screen.width + 'x' + screen.height);
            components.push(screen.colorDepth);
            components.push(window.devicePixelRatio);

            // Timezone
            components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

            // Language
            components.push(navigator.language);

            // Platform
            components.push(navigator.platform);

            // Hardware concurrency
            components.push(navigator.hardwareConcurrency || 'unknown');

            // WebGL renderer
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
                    }
                }
            } catch (e) {
                components.push('no-webgl');
            }

            // Canvas fingerprint
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.textBaseline = 'top';
                ctx.font = '14px Arial';
                ctx.fillText('DOZ UP Fingerprint', 2, 2);
                components.push(canvas.toDataURL().slice(-50));
            } catch (e) {
                components.push('no-canvas');
            }

            // Audio context fingerprint
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                components.push(audioCtx.sampleRate);
                audioCtx.close();
            } catch (e) {
                components.push('no-audio');
            }

            // User agent
            components.push(navigator.userAgent);

            // Generate hash
            const fingerprint = components.join('|');
            const hash = await this.hashString(fingerprint);

            return hash;
        },

        /**
         * Hash string using SHA-256
         */
        async hashString(str) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },

        /**
         * Get or create device ID
         */
        async getOrCreateDeviceId() {
            // Check localStorage first
            let deviceId = localStorage.getItem(this.config.storagePrefix + 'device_id');

            if (!deviceId) {
                // Generate new fingerprint-based device ID
                deviceId = await this.generateFingerprint();
                localStorage.setItem(this.config.storagePrefix + 'device_id', deviceId);
                console.log('[AutoAuth] New device ID generated');
            }

            return deviceId;
        },

        /**
         * Check device status with server
         */
        async checkDeviceStatus() {
            try {
                const response = await fetch(this.config.deviceStatusEndpoint, {
                    headers: { 'X-Device-ID': this.deviceId }
                });
                return await response.json();
            } catch (error) {
                console.error('[AutoAuth] Status check failed:', error);
                return { needsRegistration: true };
            }
        },

        /**
         * Auto-register device with server
         */
        async autoRegister() {
            try {
                const response = await fetch(this.config.autoRegisterEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deviceId: this.deviceId,
                        userAgent: navigator.userAgent,
                        platform: navigator.platform,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        language: navigator.language,
                        screenResolution: screen.width + 'x' + screen.height
                    })
                });

                const result = await response.json();

                if (result.success) {
                    this.user = result.user;
                    console.log('[AutoAuth] Auto-registered:', result.user.isNewUser ? 'new user' : 'existing user');

                    // Welcome toast removed — silent auto-auth, no interruption
                }

                return result;
            } catch (error) {
                console.error('[AutoAuth] Auto-register failed:', error);
                return { success: false, error: error.message };
            }
        },

        /**
         * Check if demo is still active
         */
        isDemoActive() {
            if (!this.user) return true;
            if (this.user.isPaid) return false;
            if (!this.user.demoExpiresAt) return true;

            return new Date(this.user.demoExpiresAt) > new Date();
        },

        /**
         * Check if feature is available (demo limits)
         */
        canUseFeature(feature) {
            // Always allow basic features
            const basicFeatures = ['upload', 'view', 'copy-link'];
            if (basicFeatures.includes(feature)) return true;

            // Check if paid or demo active
            if (this.user?.isPaid) return true;
            if (!this.isDemoActive()) return false;

            // Check demo limits
            switch (feature) {
                case 'annotate':
                case 'studio':
                case 'frames':
                case 'collage':
                    return true; // Available in demo
                case 'bulk-upload':
                case 'api-access':
                    return false; // Premium only
                default:
                    return true;
            }
        },

        /**
         * Get demo time remaining
         */
        getDemoTimeRemaining() {
            if (!this.user?.demoExpiresAt) return null;

            const remaining = new Date(this.user.demoExpiresAt) - new Date();
            if (remaining <= 0) return 0;

            return {
                days: Math.floor(remaining / (1000 * 60 * 60 * 24)),
                hours: Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
                total: remaining
            };
        },

        /**
         * Show upgrade prompt
         */
        showUpgradePrompt(reason = 'feature') {
            const messages = {
                'feature': 'Upgrade to unlock this feature',
                'demo_expired': 'Your free trial has ended',
                'storage_limit': 'You\'ve reached the storage limit',
                'upload_limit': 'You\'ve reached the upload limit'
            };

            // Check if upgrade modal exists
            const upgradeModal = document.getElementById('upgradeModal');
            if (upgradeModal) {
                const reasonEl = upgradeModal.querySelector('.upgrade-reason');
                if (reasonEl) reasonEl.textContent = messages[reason] || messages.feature;
                upgradeModal.classList.add('active');
            } else {
                // Redirect to pricing
                window.location.href = '/order.html?reason=' + reason;
            }
        },

        /**
         * Get current user
         */
        getUser() {
            return this.user;
        },

        /**
         * Get device ID
         */
        getDeviceId() {
            return this.deviceId;
        },

        /**
         * Check if user is authenticated (has device ID)
         */
        isAuthenticated() {
            return !!this.deviceId;
        },

        /**
         * Check if user has paid account
         */
        isPaid() {
            return this.user?.isPaid === true;
        },

        /**
         * Link email to anonymous account (during upgrade)
         */
        async linkEmail(email, name) {
            try {
                const response = await fetch('/api/auth/link-email', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Device-ID': this.deviceId
                    },
                    body: JSON.stringify({ email, name })
                });

                const result = await response.json();
                if (result.success) {
                    this.user = { ...this.user, email, name };
                }
                return result;
            } catch (error) {
                console.error('[AutoAuth] Link email failed:', error);
                return { success: false, error: error.message };
            }
        }
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => DOZAutoAuth.init());
    } else {
        DOZAutoAuth.init();
    }

    // Expose globally
    window.DOZAutoAuth = DOZAutoAuth;

})();
