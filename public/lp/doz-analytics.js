/**
 * DOZ Analytics - AI-driven visitor pattern learning
 * Lightweight (~4KB) behavioral tracking for conversion optimization
 *
 * Tracks: scroll depth, time on page, section views, CTA clicks, exit intent
 * Sends data via navigator.sendBeacon (non-blocking, survives page unloads)
 * Loads AI-optimized page config via Thompson Sampling
 */
(function(window, document) {
    'use strict';

    // ── Configuration ──
    var API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8080/api/analytics'
        : 'https://api.doz.com.im/api/analytics';
    var SESSION_KEY = 'doz_sid';
    var VISITOR_KEY = 'doz_vid';
    var HEARTBEAT_INTERVAL = 15000; // 15 seconds
    var MAX_HEARTBEATS = 40; // Stop after 10 minutes
    var SOCIAL_PROOF_REFRESH = 60000; // 60 seconds

    // ── State ──
    var sessionId, visitorId;
    var pageStartTime;
    var maxScrollDepth = 0;
    var sentScrollMarkers = {};
    var heartbeatCount = 0;
    var heartbeatTimer = null;
    var exitIntentFired = false;
    var variantConfig = null;

    // ── Initialization ──
    function init() {
        sessionId = sessionStorage.getItem(SESSION_KEY);
        if (!sessionId) {
            sessionId = generateId();
            sessionStorage.setItem(SESSION_KEY, sessionId);
        }
        visitorId = localStorage.getItem(VISITOR_KEY);
        if (!visitorId) {
            visitorId = generateId();
            localStorage.setItem(VISITOR_KEY, visitorId);
        }
        pageStartTime = Date.now();

        registerSession();
        trackScroll();
        trackSectionVisibility();
        trackCTAInteractions();
        trackExitIntent();
        startHeartbeat();
        loadPageConfig();
    }

    // ── Session Registration ──
    function registerSession() {
        var params = new URLSearchParams(window.location.search);
        var ua = navigator.userAgent.toLowerCase();
        var deviceType = /mobile|android|iphone|ipad/.test(ua) ? 'mobile' :
                         /tablet|ipad/.test(ua) ? 'tablet' : 'desktop';
        var browser = /chrome/.test(ua) ? 'chrome' :
                      /firefox/.test(ua) ? 'firefox' :
                      /safari/.test(ua) ? 'safari' :
                      /edge/.test(ua) ? 'edge' : 'other';

        sendJSON(API_BASE + '/session', {
            session_id: sessionId,
            visitor_id: visitorId,
            page_url: window.location.href,
            referrer: document.referrer || null,
            utm_source: params.get('utm_source') || null,
            utm_medium: params.get('utm_medium') || null,
            utm_campaign: params.get('utm_campaign') || null,
            utm_term: params.get('utm_term') || null,
            utm_content: params.get('utm_content') || null,
            device_type: deviceType,
            browser: browser,
            screen_width: screen.width,
            screen_height: screen.height
        });
    }

    // ── Scroll Tracking ──
    function trackScroll() {
        var markers = [25, 50, 75, 100];
        var throttled = false;

        window.addEventListener('scroll', function() {
            if (throttled) return;
            throttled = true;

            requestAnimationFrame(function() {
                var docHeight = Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight
                );
                var viewHeight = window.innerHeight;
                var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                var depth = Math.round((scrollTop + viewHeight) / docHeight * 100);

                if (depth > maxScrollDepth) {
                    maxScrollDepth = depth;
                }

                for (var i = 0; i < markers.length; i++) {
                    var m = markers[i];
                    if (depth >= m && !sentScrollMarkers[m]) {
                        sentScrollMarkers[m] = true;
                        sendEvent('scroll', { depth: m });
                    }
                }

                throttled = false;
            });
        }, { passive: true });
    }

    // ── Section Visibility Tracking ──
    function trackSectionVisibility() {
        if (!('IntersectionObserver' in window)) return;

        var observed = {};
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    var sectionId = entry.target.getAttribute('data-section');
                    if (sectionId && !observed[sectionId]) {
                        // Wait 1 second to confirm intent
                        setTimeout(function() {
                            if (!observed[sectionId]) {
                                observed[sectionId] = true;
                                sendEvent('section_view', {
                                    section_id: sectionId,
                                    visible_ms: 1000
                                });
                            }
                        }, 1000);
                    }
                }
            });
        }, { threshold: 0.5 });

        var sections = document.querySelectorAll('[data-section]');
        for (var i = 0; i < sections.length; i++) {
            observer.observe(sections[i]);
        }
    }

    // ── CTA Tracking ──
    function trackCTAInteractions() {
        var ctas = document.querySelectorAll('[data-cta]');
        for (var i = 0; i < ctas.length; i++) {
            (function(el) {
                var ctaId = el.getAttribute('data-cta');
                var hoverStart = 0;

                el.addEventListener('mouseenter', function() {
                    hoverStart = Date.now();
                });

                el.addEventListener('mouseleave', function() {
                    if (hoverStart) {
                        var duration = Date.now() - hoverStart;
                        if (duration > 300) { // Only track hovers > 300ms
                            sendEvent('cta_hover', {
                                button_id: ctaId,
                                duration_ms: duration
                            });
                        }
                        hoverStart = 0;
                    }
                });

                el.addEventListener('click', function() {
                    sendEvent('cta_click', {
                        button_id: ctaId,
                        text: (el.textContent || '').trim().substring(0, 50)
                    });
                });
            })(ctas[i]);
        }
    }

    // ── Exit Intent Detection ──
    function trackExitIntent() {
        document.addEventListener('mouseleave', function(e) {
            if (e.clientY < 10 && !exitIntentFired) {
                exitIntentFired = true;
                var timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);
                sendEvent('exit_intent', {
                    time_on_page_sec: timeOnPage,
                    scroll_depth: maxScrollDepth
                });

                // Show urgency overlay if configured
                if (variantConfig && variantConfig.variants && variantConfig.variants.show_urgency) {
                    showUrgencyOverlay();
                }
            }
        });
    }

    // ── Heartbeat ──
    function startHeartbeat() {
        heartbeatTimer = setInterval(function() {
            if (heartbeatCount >= MAX_HEARTBEATS) {
                clearInterval(heartbeatTimer);
                return;
            }
            heartbeatCount++;
            var timeOnPage = Math.round((Date.now() - pageStartTime) / 1000);
            sendEvent('heartbeat', {
                time_on_page_sec: timeOnPage,
                scroll_depth: maxScrollDepth,
                heartbeat_num: heartbeatCount
            });
        }, HEARTBEAT_INTERVAL);
    }

    // ── Page Config Loading (Thompson Sampling) ──
    function loadPageConfig() {
        var pageSlug = getPageSlug();

        fetch(API_BASE + '/page-config?page=' + pageSlug + '&session_id=' + sessionId)
            .then(function(r) { return r.json(); })
            .then(function(config) {
                variantConfig = config;
                applyVariants(config);
                loadSocialProof();
            })
            .catch(function() {
                // Config load failed - page works fine with defaults
                loadSocialProof();
            });
    }

    // ── Apply Variant Config to Page ──
    function applyVariants(config) {
        if (!config || !config.variants) return;
        var v = config.variants;

        // Apply CTA text
        if (v.cta_text) {
            var ctaEls = document.querySelectorAll('[data-cta-text]');
            for (var i = 0; i < ctaEls.length; i++) {
                ctaEls[i].textContent = v.cta_text;
            }
        }

        // Apply sticky CTA delay
        if (v.sticky_cta_delay !== undefined) {
            var delay = parseInt(v.sticky_cta_delay);
            var stickyEl = document.querySelector('[data-sticky-cta]');
            if (stickyEl && delay > 0) {
                stickyEl.style.display = 'none';
                setTimeout(function() {
                    stickyEl.style.display = '';
                }, delay * 1000);
            } else if (stickyEl && delay === 0) {
                stickyEl.style.display = 'none';
            }
        }
    }

    // ── Social Proof Widget ──
    function loadSocialProof() {
        // Check if social proof is enabled by variant config
        if (variantConfig && variantConfig.variants &&
            variantConfig.variants.show_social_proof === false) {
            return;
        }

        fetchSocialProof();
        setInterval(fetchSocialProof, SOCIAL_PROOF_REFRESH);
    }

    function fetchSocialProof() {
        var pageSlug = getPageSlug();
        fetch(API_BASE + '/social-proof?page=' + pageSlug)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                renderSocialProof(data);
            })
            .catch(function() {});
    }

    function renderSocialProof(data) {
        var container = document.querySelector('[data-social-proof]');
        if (!container) return;

        // Don't show if no meaningful data
        if (!data.purchases_today && !data.active_viewers) {
            container.style.display = 'none';
            return;
        }

        var parts = [];

        if (data.active_viewers > 1) {
            parts.push('<span class="sp-viewers">' + data.active_viewers + ' people viewing now</span>');
        }

        if (data.purchases_today > 0) {
            parts.push('<span class="sp-purchases">' + data.purchases_today + ' purchased today</span>');
        }

        if (data.last_purchase_minutes_ago && data.last_purchase_minutes_ago < 60) {
            parts.push('<span class="sp-recent">Last purchase ' + data.last_purchase_minutes_ago + 'min ago</span>');
        }

        if (data.total_customers > 10) {
            parts.push('<span class="sp-total">Join ' + data.total_customers + '+ users</span>');
        }

        if (parts.length > 0) {
            container.innerHTML =
                '<div class="doz-social-proof" style="' +
                'position:fixed;bottom:20px;left:20px;z-index:9999;' +
                'background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;' +
                'border-radius:10px;font-size:13px;max-width:300px;' +
                'backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);' +
                'animation:dozSpSlide 0.4s ease-out">' +
                parts.join(' &middot; ') +
                '</div>';
            container.style.display = '';

            // Add animation if not already added
            if (!document.getElementById('doz-sp-style')) {
                var style = document.createElement('style');
                style.id = 'doz-sp-style';
                style.textContent = '@keyframes dozSpSlide{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
                document.head.appendChild(style);
            }
        }
    }

    // ── Urgency Overlay ──
    function showUrgencyOverlay() {
        var el = document.querySelector('[data-urgency]');
        if (!el) {
            // Create one if not in HTML
            el = document.createElement('div');
            el.setAttribute('data-urgency', '');
            document.body.appendChild(el);
        }

        el.innerHTML =
            '<div style="' +
            'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;' +
            'background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;' +
            'animation:dozFadeIn 0.3s ease">' +
            '<div style="' +
            'background:#fff;border-radius:16px;padding:32px;max-width:400px;width:90%;' +
            'text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)">' +
            '<div style="font-size:24px;font-weight:700;margin-bottom:8px">Wait!</div>' +
            '<div style="color:#666;margin-bottom:20px">Get Pro free for 14 days - limited offer</div>' +
            '<a href="https://up.doz.com/checkout.html?plan=pro_yearly" style="' +
            'display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);' +
            'color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;' +
            'font-weight:600;font-size:16px">Try Pro Free</a>' +
            '<div style="margin-top:12px">' +
            '<button onclick="this.closest(\'[data-urgency]\').innerHTML=\'\'" style="' +
            'background:none;border:none;color:#999;cursor:pointer;font-size:13px">No thanks</button>' +
            '</div></div></div>';
        el.style.display = '';

        // Track exit intent with urgency shown
        sendEvent('exit_intent', { urgency_shown: true });

        // Add fade animation
        if (!document.getElementById('doz-urgency-style')) {
            var style = document.createElement('style');
            style.id = 'doz-urgency-style';
            style.textContent = '@keyframes dozFadeIn{from{opacity:0}to{opacity:1}}';
            document.head.appendChild(style);
        }
    }

    // ── Network ──
    function sendEvent(eventType, eventData) {
        var payload = JSON.stringify({
            session_id: sessionId,
            event_type: eventType,
            event_data: eventData,
            page_url: window.location.href,
            timestamp: new Date().toISOString()
        });

        // Prefer sendBeacon (survives page unload)
        if (navigator.sendBeacon) {
            navigator.sendBeacon(
                API_BASE + '/event',
                new Blob([payload], { type: 'application/json' })
            );
        } else {
            fetch(API_BASE + '/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true
            }).catch(function() {});
        }
    }

    function sendJSON(url, data) {
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).catch(function() {});
    }

    // ── Utilities ──
    function generateId() {
        if (window.crypto && crypto.getRandomValues) {
            var arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            return Array.from(arr, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        }
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
    }

    function getPageSlug() {
        var path = window.location.pathname;
        path = path.replace(/\/$/, '');
        var parts = path.split('/');
        var last = parts[parts.length - 1] || 'index';
        return last.replace(/\.html?$/, '') || 'index';
    }

    // ── Boot ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── Public API ──
    window.dozAnalytics = {
        trackConversion: function(type, value, orderId, email) {
            sendJSON(API_BASE + '/convert', {
                session_id: sessionId,
                conversion_type: type || 'purchase',
                conversion_value: value || 0,
                order_id: orderId || null,
                customer_email: email || null
            });
        },
        trackEvent: function(type, data) {
            sendEvent(type, data);
        },
        getSessionId: function() { return sessionId; },
        getConfig: function() { return variantConfig; }
    };

})(window, document);
