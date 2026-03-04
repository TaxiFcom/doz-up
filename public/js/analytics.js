/**
 * DOZ UP Analytics Tracker
 * Include this script on all pages to track visitors and events
 *
 * Usage:
 *   <script src="/js/analytics.js" defer></script>
 *
 * API:
 *   dozAnalytics.trackEvent('event_name', { data: 'value' });
 *   dozAnalytics.trackPageView('/custom-page');
 */

(function() {
    'use strict';

    const DOZ_ANALYTICS = {
        endpoint: '/api/analytics',
        sessionKey: 'doz_session',
        lastPageView: null,
        initialized: false,

        // Get or create session ID
        getSessionId: function() {
            let sessionId = this.getCookie(this.sessionKey);
            if (!sessionId) {
                sessionId = this.generateUUID();
                this.setCookie(this.sessionKey, sessionId, 1); // 1 day
            }
            return sessionId;
        },

        // Generate UUID
        generateUUID: function() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

        // Cookie helpers
        getCookie: function(name) {
            const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
            return match ? match[2] : null;
        },

        setCookie: function(name, value, days) {
            const expires = new Date(Date.now() + days * 864e5).toUTCString();
            document.cookie = name + '=' + value + '; expires=' + expires + '; path=/; SameSite=Lax';
        },

        // Send tracking data
        send: function(type, data) {
            try {
                const payload = {
                    ...data,
                    sessionId: this.getSessionId(),
                    timestamp: new Date().toISOString(),
                    url: window.location.href,
                    referrer: document.referrer,
                    userAgent: navigator.userAgent,
                    screenWidth: window.screen.width,
                    screenHeight: window.screen.height,
                    language: navigator.language,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                };

                const jsonPayload = JSON.stringify(payload);
                const url = this.endpoint + '/' + type;

                // Use sendBeacon with Blob for reliability (works even on page unload)
                if (navigator.sendBeacon) {
                    const blob = new Blob([jsonPayload], { type: 'application/json' });
                    navigator.sendBeacon(url, blob);
                } else {
                    // Fallback to fetch
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: jsonPayload,
                        keepalive: true
                    }).catch(function() {});
                }
            } catch (e) {
                // Silently fail - don't break the page
                console.warn('[DOZ Analytics] Error sending data:', e);
            }
        },

        // Track page view
        trackPageView: function(customPage) {
            const page = customPage || window.location.pathname + window.location.search;

            // Avoid duplicate tracking for same page
            if (this.lastPageView === page) return;
            this.lastPageView = page;

            this.send('pageview', { page: page });
        },

        // Track custom event
        trackEvent: function(eventName, eventData) {
            this.send('event', {
                name: eventName,
                data: eventData || {}
            });
        },

        // Track outbound links
        trackOutbound: function(url) {
            this.trackEvent('outbound_click', { url: url });
        },

        // Track file downloads
        trackDownload: function(file) {
            this.trackEvent('download', { file: file });
        },

        // Track form submissions
        trackForm: function(formName) {
            this.trackEvent('form_submit', { form: formName });
        },

        // Track scroll depth
        trackScrollDepth: function() {
            let maxScroll = 0;
            let tracked = { 25: false, 50: false, 75: false, 100: false };

            const handler = () => {
                const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
                const scrollPercent = Math.round((window.scrollY / scrollHeight) * 100);

                if (scrollPercent > maxScroll) {
                    maxScroll = scrollPercent;

                    [25, 50, 75, 100].forEach(threshold => {
                        if (maxScroll >= threshold && !tracked[threshold]) {
                            tracked[threshold] = true;
                            this.trackEvent('scroll_depth', { depth: threshold });
                        }
                    });
                }
            };

            window.addEventListener('scroll', handler, { passive: true });
        },

        // Track time on page
        trackTimeOnPage: function() {
            const startTime = Date.now();

            window.addEventListener('beforeunload', () => {
                const timeSpent = Math.round((Date.now() - startTime) / 1000);
                this.trackEvent('time_on_page', { seconds: timeSpent });
            });
        },

        // Auto-track clicks
        trackClicks: function() {
            document.addEventListener('click', (e) => {
                const target = e.target.closest('a, button, [data-track]');
                if (!target) return;

                // Track outbound links
                if (target.tagName === 'A' && target.hostname !== window.location.hostname) {
                    this.trackOutbound(target.href);
                }

                // Track downloads
                if (target.tagName === 'A' && /\.(pdf|zip|exe|dmg|msi|doc|xls|ppt)$/i.test(target.href)) {
                    this.trackDownload(target.href);
                }

                // Track elements with data-track attribute
                if (target.dataset.track) {
                    this.trackEvent('click', {
                        element: target.dataset.track,
                        text: target.textContent?.substring(0, 50)
                    });
                }
            });
        },

        // Initialize
        init: function() {
            if (this.initialized) return;
            this.initialized = true;

            // Track initial page view
            this.trackPageView();

            // Track SPA navigation
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            const self = this;

            history.pushState = function() {
                originalPushState.apply(this, arguments);
                setTimeout(() => self.trackPageView(), 0);
            };

            history.replaceState = function() {
                originalReplaceState.apply(this, arguments);
                setTimeout(() => self.trackPageView(), 0);
            };

            window.addEventListener('popstate', () => {
                setTimeout(() => this.trackPageView(), 0);
            });

            // Auto-tracking features
            this.trackClicks();
            this.trackScrollDepth();
            this.trackTimeOnPage();

            // Track page visibility changes
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.trackEvent('page_focus', {});
                } else {
                    this.trackEvent('page_blur', {});
                }
            });

            console.log('[DOZ Analytics] Initialized');
        }
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => DOZ_ANALYTICS.init());
    } else {
        DOZ_ANALYTICS.init();
    }

    // Expose to global scope
    window.dozAnalytics = {
        trackEvent: DOZ_ANALYTICS.trackEvent.bind(DOZ_ANALYTICS),
        trackPageView: DOZ_ANALYTICS.trackPageView.bind(DOZ_ANALYTICS),
        trackDownload: DOZ_ANALYTICS.trackDownload.bind(DOZ_ANALYTICS),
        trackForm: DOZ_ANALYTICS.trackForm.bind(DOZ_ANALYTICS)
    };

})();
