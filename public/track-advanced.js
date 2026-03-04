/**
 * DOZ UP - Advanced Traffic Analytics Tracking Script v2.0
 * High-accuracy visitor tracking with engagement metrics
 * Include: <script src="/track-advanced.js" async></script>
 */

(function() {
    'use strict';

    const TRACK_ENDPOINT = '/api/track/advanced';
    const BEACON_ENDPOINT = '/api/track/beacon';
    const ENGAGEMENT_INTERVAL = 5000; // Update engagement every 5 seconds
    const DEBUG = false;

    // ============ SESSION MANAGEMENT ============
    function getSessionId() {
        let sessionId = sessionStorage.getItem('doz_session_v2');
        if (!sessionId) {
            sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
            sessionStorage.setItem('doz_session_v2', sessionId);
        }
        return sessionId;
    }

    function getVisitorId() {
        let visitorId = localStorage.getItem('doz_visitor_v2');
        if (!visitorId) {
            visitorId = 'vis_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
            localStorage.setItem('doz_visitor_v2', visitorId);
        }
        return visitorId;
    }

    // ============ DATA COLLECTION ============
    function getScreenInfo() {
        return {
            width: window.screen.width,
            height: window.screen.height,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
            colorDepth: window.screen.colorDepth,
            pixelRatio: window.devicePixelRatio || 1,
            orientation: window.screen.orientation?.type || 'unknown'
        };
    }

    function getPerformanceMetrics() {
        const perf = window.performance;
        if (!perf || !perf.timing) return {};

        const timing = perf.timing;
        const navigation = perf.navigation;

        const metrics = {
            loadTime: timing.loadEventEnd - timing.navigationStart,
            domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
            firstByte: timing.responseStart - timing.navigationStart,
            dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,
            tcpConnect: timing.connectEnd - timing.connectStart,
            serverResponse: timing.responseEnd - timing.requestStart,
            domParsing: timing.domInteractive - timing.responseEnd,
            resourceLoad: timing.loadEventStart - timing.domContentLoadedEventEnd,
            redirectCount: navigation?.redirectCount || 0,
            navigationType: ['navigate', 'reload', 'back_forward', 'prerender'][navigation?.type] || 'unknown'
        };

        // Get paint metrics if available
        if (perf.getEntriesByType) {
            const paintEntries = perf.getEntriesByType('paint');
            paintEntries.forEach(entry => {
                if (entry.name === 'first-paint') {
                    metrics.firstPaint = Math.round(entry.startTime);
                } else if (entry.name === 'first-contentful-paint') {
                    metrics.fcp = Math.round(entry.startTime);
                }
            });

            // Get LCP if available
            try {
                const lcpEntries = perf.getEntriesByType('largest-contentful-paint');
                if (lcpEntries.length > 0) {
                    metrics.lcp = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
                }
            } catch (e) {}
        }

        return metrics;
    }

    function getConnectionInfo() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return { type: 'unknown' };

        return {
            type: conn.effectiveType || conn.type || 'unknown',
            downlink: conn.downlink,
            rtt: conn.rtt,
            saveData: conn.saveData || false
        };
    }

    function getBrowserInfo() {
        const ua = navigator.userAgent;
        const langs = navigator.languages || [navigator.language];

        return {
            language: navigator.language,
            languages: langs.slice(0, 3),
            platform: navigator.platform,
            vendor: navigator.vendor,
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack === '1',
            touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
            maxTouchPoints: navigator.maxTouchPoints || 0,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            pdfViewerEnabled: navigator.pdfViewerEnabled
        };
    }

    function getTimezoneInfo() {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions();
            return {
                timezone: tz.timeZone,
                offset: new Date().getTimezoneOffset(),
                locale: tz.locale
            };
        } catch (e) {
            return {
                offset: new Date().getTimezoneOffset()
            };
        }
    }

    function getPageInfo() {
        return {
            path: window.location.pathname,
            hash: window.location.hash,
            search: window.location.search,
            title: document.title,
            referrer: document.referrer || 'direct',
            protocol: window.location.protocol,
            host: window.location.host
        };
    }

    function getViewportInfo() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX || window.pageXOffset || 0,
            scrollY: window.scrollY || window.pageYOffset || 0,
            documentHeight: Math.max(
                document.body.scrollHeight,
                document.body.offsetHeight,
                document.documentElement.clientHeight,
                document.documentElement.scrollHeight,
                document.documentElement.offsetHeight
            )
        };
    }

    // ============ ENGAGEMENT TRACKING ============
    let engagement = {
        startTime: Date.now(),
        scrollDepth: 0,
        maxScrollDepth: 0,
        clicks: 0,
        keypresses: 0,
        mouseMoves: 0,
        touchEvents: 0,
        timeVisible: 0,
        lastActive: Date.now(),
        interactions: [],
        exitIntent: 0
    };

    let pageViewId = null;
    let isVisible = true;
    let visibleStartTime = Date.now();

    function calculateScrollDepth() {
        const viewport = getViewportInfo();
        const scrollTop = viewport.scrollY;
        const docHeight = viewport.documentHeight;
        const winHeight = viewport.height;

        if (docHeight <= winHeight) return 100;

        const scrollPercent = Math.round((scrollTop / (docHeight - winHeight)) * 100);
        return Math.min(100, Math.max(0, scrollPercent));
    }

    function updateEngagement() {
        const currentScroll = calculateScrollDepth();
        engagement.scrollDepth = currentScroll;
        engagement.maxScrollDepth = Math.max(engagement.maxScrollDepth, currentScroll);

        if (isVisible) {
            engagement.timeVisible = Date.now() - engagement.startTime;
        }
    }

    function trackClick(e) {
        engagement.clicks++;
        engagement.lastActive = Date.now();

        // Track click target for heatmap data
        const target = e.target;
        if (target) {
            engagement.interactions.push({
                type: 'click',
                tag: target.tagName,
                id: target.id || null,
                class: target.className?.split?.(' ')?.[0] || null,
                x: e.clientX,
                y: e.clientY,
                time: Date.now() - engagement.startTime
            });

            // Keep only last 50 interactions
            if (engagement.interactions.length > 50) {
                engagement.interactions = engagement.interactions.slice(-50);
            }
        }
    }

    function trackScroll() {
        updateEngagement();
        engagement.lastActive = Date.now();
    }

    function trackKeypress() {
        engagement.keypresses++;
        engagement.lastActive = Date.now();
    }

    function trackMouseMove() {
        engagement.mouseMoves++;
        engagement.lastActive = Date.now();
    }

    function trackTouch() {
        engagement.touchEvents++;
        engagement.lastActive = Date.now();
    }

    function trackExitIntent(e) {
        if (e.clientY < 10) {
            engagement.exitIntent++;
        }
    }

    function trackVisibility() {
        if (document.hidden) {
            if (isVisible) {
                engagement.timeVisible += Date.now() - visibleStartTime;
            }
            isVisible = false;
        } else {
            isVisible = true;
            visibleStartTime = Date.now();
        }
    }

    // ============ TRACKING FUNCTIONS ============
    function trackPageView() {
        const data = {
            sessionId: getSessionId(),
            visitorId: getVisitorId(),
            page: getPageInfo(),
            screen: getScreenInfo(),
            viewport: getViewportInfo(),
            performance: getPerformanceMetrics(),
            connection: getConnectionInfo(),
            browser: getBrowserInfo(),
            timezone: getTimezoneInfo(),
            timestamp: Date.now()
        };

        sendTrackingData(data, (response) => {
            if (response && response.pageViewId) {
                pageViewId = response.pageViewId;
                if (DEBUG) console.log('[Analytics] Page view tracked:', pageViewId);
            }
        });
    }

    function sendEngagementUpdate() {
        if (!pageViewId) return;

        updateEngagement();

        const data = {
            pageViewId,
            sessionId: getSessionId(),
            engagement: {
                scrollDepth: engagement.maxScrollDepth,
                timeOnPage: engagement.timeVisible,
                clicks: engagement.clicks,
                keypresses: engagement.keypresses,
                interactions: engagement.interactions.length,
                exitIntent: engagement.exitIntent,
                isActive: Date.now() - engagement.lastActive < 30000
            }
        };

        // Use sendBeacon for reliability
        const payload = JSON.stringify(data);
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/track/engagement', payload);
        }
    }

    function sendTrackingData(data, callback) {
        const payload = JSON.stringify(data);

        fetch(TRACK_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        })
        .then(res => res.json())
        .then(callback)
        .catch(err => {
            if (DEBUG) console.error('[Analytics] Error:', err);
        });
    }

    function sendBeacon(data) {
        const payload = JSON.stringify(data);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(BEACON_ENDPOINT, payload);
        }
    }

    // ============ EXIT TRACKING ============
    function trackExit() {
        updateEngagement();

        const exitData = {
            pageViewId,
            sessionId: getSessionId(),
            engagement: {
                scrollDepth: engagement.maxScrollDepth,
                timeOnPage: engagement.timeVisible,
                clicks: engagement.clicks,
                totalInteractions: engagement.clicks + engagement.keypresses + engagement.touchEvents
            },
            exitType: document.hidden ? 'tab_close' : 'navigation'
        };

        sendBeacon(exitData);
    }

    // ============ SPA SUPPORT ============
    let lastPath = window.location.pathname;

    function checkForNavigation() {
        if (window.location.pathname !== lastPath) {
            // Send exit data for previous page
            trackExit();

            // Reset engagement
            lastPath = window.location.pathname;
            engagement = {
                startTime: Date.now(),
                scrollDepth: 0,
                maxScrollDepth: 0,
                clicks: 0,
                keypresses: 0,
                mouseMoves: 0,
                touchEvents: 0,
                timeVisible: 0,
                lastActive: Date.now(),
                interactions: [],
                exitIntent: 0
            };
            pageViewId = null;

            // Track new page
            setTimeout(trackPageView, 100);
        }
    }

    // ============ INITIALIZATION ============
    function init() {
        // Event listeners
        document.addEventListener('click', trackClick, { passive: true });
        document.addEventListener('scroll', throttle(trackScroll, 500), { passive: true });
        document.addEventListener('keypress', throttle(trackKeypress, 1000), { passive: true });
        document.addEventListener('mousemove', throttle(trackMouseMove, 2000), { passive: true });
        document.addEventListener('touchstart', trackTouch, { passive: true });
        document.addEventListener('mouseout', trackExitIntent, { passive: true });
        document.addEventListener('visibilitychange', trackVisibility);

        // Exit tracking
        window.addEventListener('beforeunload', trackExit);
        window.addEventListener('pagehide', trackExit);

        // SPA navigation support
        window.addEventListener('popstate', checkForNavigation);
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        history.pushState = function() {
            originalPushState.apply(this, arguments);
            checkForNavigation();
        };
        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            checkForNavigation();
        };

        // History API interception above handles SPA navigation
        // MutationObserver removed - was causing performance issues by firing on every DOM change

        // Periodic engagement updates
        setInterval(sendEngagementUpdate, ENGAGEMENT_INTERVAL);

        // Initial page view
        if (document.readyState === 'complete') {
            trackPageView();
        } else {
            window.addEventListener('load', trackPageView);
        }

        if (DEBUG) console.log('[Analytics] Initialized');
    }

    // ============ UTILITIES ============
    function throttle(func, limit) {
        let lastFunc;
        let lastRan;
        return function(...args) {
            if (!lastRan) {
                func.apply(this, args);
                lastRan = Date.now();
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(() => {
                    if (Date.now() - lastRan >= limit) {
                        func.apply(this, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        };
    }

    // Start tracking
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose API for manual tracking
    window.dozAnalytics = {
        trackEvent: function(category, action, label, value) {
            sendTrackingData({
                type: 'event',
                sessionId: getSessionId(),
                visitorId: getVisitorId(),
                category,
                action,
                label,
                value,
                path: window.location.pathname,
                timestamp: Date.now()
            });
        },
        trackConversion: function(type, value, metadata) {
            sendTrackingData({
                type: 'conversion',
                sessionId: getSessionId(),
                visitorId: getVisitorId(),
                conversionType: type,
                value,
                metadata,
                path: window.location.pathname,
                timestamp: Date.now()
            });
        }
    };
})();
