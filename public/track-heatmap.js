/**
 * DOZ UP - Heatmap & Conversion Funnel Tracking Script
 * Captures user behavior for AI-powered conversion optimization
 * Include: <script src="/track-heatmap.js" async></script>
 */

(function() {
    'use strict';

    const CONFIG = {
        CLICK_ENDPOINT: '/api/heatmap/click',
        MOVEMENT_ENDPOINT: '/api/heatmap/movement',
        SCROLL_ENDPOINT: '/api/heatmap/scroll',
        FUNNEL_ENDPOINT: '/api/funnel/track',
        MOVEMENT_SAMPLE_RATE: 50,    // Sample every 50ms
        MOVEMENT_BATCH_SIZE: 20,     // Send batch of 20 positions
        SCROLL_DEBOUNCE: 500,        // Debounce scroll tracking
        DEBUG: false
    };

    // Session and visitor IDs
    function getSessionId() {
        let id = sessionStorage.getItem('doz_hm_session');
        if (!id) {
            id = 'hms_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('doz_hm_session', id);
        }
        return id;
    }

    function getVisitorId() {
        let id = localStorage.getItem('doz_hm_visitor');
        if (!id) {
            id = 'hmv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('doz_hm_visitor', id);
        }
        return id;
    }

    const sessionId = getSessionId();
    const visitorId = getVisitorId();
    const pageLoadTime = Date.now();

    // ============ VIEWPORT & PAGE INFO ============
    function getViewport() {
        return {
            width: window.innerWidth,
            height: window.innerHeight
        };
    }

    function getDocumentHeight() {
        return Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
    }

    function getScrollDepth() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const docHeight = getDocumentHeight();
        const winHeight = window.innerHeight;
        if (docHeight <= winHeight) return 100;
        return Math.min(100, Math.round((scrollTop / (docHeight - winHeight)) * 100));
    }

    // ============ CLICK TRACKING ============
    let clickCount = 0;

    function trackClick(e) {
        clickCount++;

        const target = e.target;
        const rect = target.getBoundingClientRect();

        const data = {
            page: window.location.pathname,
            x: e.clientX,
            y: e.clientY,
            pageX: e.pageX,
            pageY: e.pageY,
            element: {
                tag: target.tagName,
                id: target.id || null,
                class: target.className?.split?.(' ')?.[0] || null,
                text: target.textContent?.slice(0, 50) || null,
                href: target.href || target.closest('a')?.href || null
            },
            viewport: getViewport(),
            sessionId,
            visitorId,
            timestamp: Date.now()
        };

        sendData(CONFIG.CLICK_ENDPOINT, data);

        // Track funnel stage on click
        checkFunnelTrigger('click', target);

        if (CONFIG.DEBUG) console.log('[Heatmap] Click tracked:', data);
    }

    // ============ MOVEMENT TRACKING ============
    let movementBuffer = [];
    let lastMovementSend = Date.now();

    function trackMovement(e) {
        movementBuffer.push({
            x: e.clientX,
            y: e.clientY,
            t: Date.now() - pageLoadTime
        });

        if (movementBuffer.length >= CONFIG.MOVEMENT_BATCH_SIZE) {
            flushMovements();
        }
    }

    function flushMovements() {
        if (movementBuffer.length === 0) return;

        const data = {
            page: window.location.pathname,
            positions: movementBuffer,
            viewport: getViewport(),
            sessionId
        };

        sendData(CONFIG.MOVEMENT_ENDPOINT, data);
        movementBuffer = [];
        lastMovementSend = Date.now();
    }

    // ============ SCROLL TRACKING ============
    let maxScrollDepth = 0;
    let scrollTimeout = null;
    let scrollMilestones = { 25: false, 50: false, 75: false, 100: false };

    function trackScroll() {
        const depth = getScrollDepth();

        if (depth > maxScrollDepth) {
            maxScrollDepth = depth;

            // Check milestones
            [25, 50, 75, 100].forEach(milestone => {
                if (depth >= milestone && !scrollMilestones[milestone]) {
                    scrollMilestones[milestone] = true;
                    checkFunnelTrigger('scroll_' + milestone);
                }
            });
        }

        // Debounce sending
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const data = {
                page: window.location.pathname,
                depth,
                maxDepth: maxScrollDepth,
                sessionId,
                visitorId
            };

            sendData(CONFIG.SCROLL_ENDPOINT, data);

            if (CONFIG.DEBUG) console.log('[Heatmap] Scroll tracked:', depth + '%');
        }, CONFIG.SCROLL_DEBOUNCE);
    }

    // ============ CONVERSION FUNNEL ============
    let currentFunnelStage = 'landing';
    let stageTimestamps = { landing: Date.now() };
    let ctaInteracted = false;
    let formFocused = false;

    const FUNNEL_STAGES = ['landing', 'engagement', 'interest', 'intent', 'action', 'conversion'];

    function advanceFunnel(stage) {
        const stageIndex = FUNNEL_STAGES.indexOf(stage);
        const currentIndex = FUNNEL_STAGES.indexOf(currentFunnelStage);

        if (stageIndex > currentIndex) {
            currentFunnelStage = stage;
            stageTimestamps[stage] = Date.now();

            const data = {
                funnelId: 'default',
                stage,
                sessionId,
                visitorId,
                page: window.location.pathname,
                metadata: {
                    timeToStage: Date.now() - pageLoadTime,
                    scrollDepth: maxScrollDepth,
                    clicks: clickCount
                }
            };

            sendData(CONFIG.FUNNEL_ENDPOINT, data);

            if (CONFIG.DEBUG) console.log('[Funnel] Advanced to:', stage);
        }
    }

    function checkFunnelTrigger(trigger, element = null) {
        // Landing - tracked on page load
        if (currentFunnelStage === 'landing') {
            // Engagement: scroll > 25% OR click
            if (trigger === 'click' || trigger === 'scroll_25') {
                advanceFunnel('engagement');
            }
        }

        if (currentFunnelStage === 'engagement') {
            // Interest: time > 30s OR scroll > 50%
            if (trigger === 'scroll_50' || (Date.now() - pageLoadTime > 30000)) {
                advanceFunnel('interest');
            }
        }

        if (currentFunnelStage === 'interest') {
            // Intent: CTA hover/click OR form focus
            if (trigger === 'cta_interaction' || trigger === 'form_focus') {
                advanceFunnel('intent');
            }
        }

        if (currentFunnelStage === 'intent') {
            // Action: form submit OR CTA click
            if (trigger === 'form_submit' || trigger === 'cta_click') {
                advanceFunnel('action');
            }
        }

        // Check element-based triggers
        if (element) {
            const tag = element.tagName?.toLowerCase();
            const classes = element.className || '';
            const text = element.textContent?.toLowerCase() || '';

            // CTA detection
            const isCTA = tag === 'button' ||
                         (tag === 'a' && (classes.includes('btn') || classes.includes('cta'))) ||
                         text.includes('buy') || text.includes('sign up') ||
                         text.includes('subscribe') || text.includes('get started') ||
                         text.includes('add to cart') || text.includes('checkout');

            if (isCTA) {
                if (!ctaInteracted) {
                    ctaInteracted = true;
                    checkFunnelTrigger('cta_interaction');
                }
                if (trigger === 'click') {
                    checkFunnelTrigger('cta_click');
                }
            }
        }
    }

    // Track form interactions
    function trackFormFocus(e) {
        if (!formFocused) {
            formFocused = true;
            checkFunnelTrigger('form_focus');
        }
    }

    function trackFormSubmit(e) {
        checkFunnelTrigger('form_submit');

        // Check if this is a conversion form
        const form = e.target;
        const action = form.action || '';
        const isConversion = action.includes('checkout') ||
                            action.includes('subscribe') ||
                            action.includes('signup') ||
                            action.includes('order') ||
                            form.classList.contains('conversion-form');

        if (isConversion) {
            advanceFunnel('conversion');
        }
    }

    // ============ DATA SENDING ============
    function sendData(endpoint, data) {
        const payload = JSON.stringify(data);

        // Use sendBeacon for reliability
        if (navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, payload);
        } else {
            fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true
            }).catch(() => {});
        }
    }

    // ============ INTEREST CHECK ============
    function checkInterestTime() {
        if (currentFunnelStage === 'engagement' && Date.now() - pageLoadTime > 30000) {
            advanceFunnel('interest');
        }
    }

    // ============ EXIT TRACKING ============
    function trackExit() {
        // Flush any remaining movement data
        flushMovements();

        // Send final scroll data
        const data = {
            page: window.location.pathname,
            depth: getScrollDepth(),
            maxDepth: maxScrollDepth,
            sessionId,
            visitorId,
            isExit: true
        };
        sendData(CONFIG.SCROLL_ENDPOINT, data);
    }

    // ============ INITIALIZATION ============
    function init() {
        // Click tracking
        document.addEventListener('click', trackClick, { passive: true });

        // Movement tracking (throttled)
        let lastMove = 0;
        document.addEventListener('mousemove', function(e) {
            const now = Date.now();
            if (now - lastMove >= CONFIG.MOVEMENT_SAMPLE_RATE) {
                trackMovement(e);
                lastMove = now;
            }
        }, { passive: true });

        // Scroll tracking
        window.addEventListener('scroll', trackScroll, { passive: true });

        // Form tracking
        document.addEventListener('focusin', function(e) {
            if (e.target.matches('input, textarea, select')) {
                trackFormFocus(e);
            }
        }, { passive: true });

        document.addEventListener('submit', trackFormSubmit, { passive: true });

        // CTA hover tracking
        document.addEventListener('mouseenter', function(e) {
            const target = e.target;
            if (target.matches('button, .btn, .cta, [data-cta]')) {
                checkFunnelTrigger('cta_interaction');
            }
        }, { capture: true, passive: true });

        // Exit tracking
        window.addEventListener('beforeunload', trackExit);
        window.addEventListener('pagehide', trackExit);

        // Periodic flush and interest check
        setInterval(flushMovements, 5000);
        setInterval(checkInterestTime, 10000);

        // Track initial page view as landing
        advanceFunnel('landing');

        if (CONFIG.DEBUG) console.log('[Heatmap] Initialized');
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose API for manual conversion tracking
    window.dozFunnel = {
        trackConversion: function(type, value, metadata) {
            advanceFunnel('conversion');
            sendData(CONFIG.FUNNEL_ENDPOINT, {
                funnelId: 'default',
                stage: 'conversion',
                sessionId,
                visitorId,
                page: window.location.pathname,
                metadata: {
                    conversionType: type,
                    value,
                    ...metadata
                }
            });
        },
        trackAction: function(action, metadata) {
            advanceFunnel('action');
            sendData(CONFIG.FUNNEL_ENDPOINT, {
                funnelId: 'default',
                stage: 'action',
                sessionId,
                visitorId,
                page: window.location.pathname,
                metadata: { action, ...metadata }
            });
        },
        getCurrentStage: function() {
            return currentFunnelStage;
        }
    };
})();
