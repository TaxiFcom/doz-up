/**
 * DOZ UP - Traffic Tracking Script
 * Include this script on pages to track visitor analytics
 * Usage: <script src="/track.js" async></script>
 */

(function() {
    'use strict';

    // Generate or retrieve session ID
    function getSessionId() {
        let sessionId = sessionStorage.getItem('doz_session');
        if (!sessionId) {
            sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('doz_session', sessionId);
        }
        return sessionId;
    }

    // Generate or retrieve visitor ID (persists across sessions)
    function getVisitorId() {
        let visitorId = localStorage.getItem('doz_visitor');
        if (!visitorId) {
            visitorId = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('doz_visitor', visitorId);
        }
        return visitorId;
    }

    // Track page view
    function trackPageView() {
        const data = {
            page: window.location.pathname,
            referrer: document.referrer || 'direct',
            sessionId: getSessionId(),
            visitorId: getVisitorId(),
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            language: navigator.language || navigator.userLanguage
        };

        // Use sendBeacon for reliability, fallback to fetch
        const payload = JSON.stringify(data);
        const url = '/api/analytics/pageview';

        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
        } else {
            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': getSessionId()
                },
                body: payload,
                keepalive: true
            }).catch(() => {});
        }
    }

    // Track custom events
    window.dozTrackEvent = function(eventName, eventData) {
        const data = {
            name: eventName,
            data: eventData || {},
            sessionId: getSessionId()
        };

        fetch('/api/analytics/event', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': getSessionId()
            },
            body: JSON.stringify(data),
            keepalive: true
        }).catch(() => {});
    };

    // Track on page load
    if (document.readyState === 'complete') {
        trackPageView();
    } else {
        window.addEventListener('load', trackPageView);
    }

    // Track on navigation (for SPAs) - using efficient History API
    let lastPath = window.location.pathname;

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            trackPageView();
        }
    });

    // Intercept pushState/replaceState for SPA navigation (much more efficient than MutationObserver)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function() {
        originalPushState.apply(this, arguments);
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            trackPageView();
        }
    };

    history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        if (window.location.pathname !== lastPath) {
            lastPath = window.location.pathname;
            trackPageView();
        }
    };
})();
