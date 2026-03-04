/**
 * DOZ UP - Smart Conversion Nudges
 * Shows contextual, non-intrusive nudge bars to guide users toward conversion.
 * Adapts based on page type and visitor journey stage.
 */
(function() {
    'use strict';

    if (window.DozNudges) return;

    const DozNudges = {
        initialized: false,
        nudgeElement: null,
        shownKey: 'doz_nudges_shown',
        maxPerSession: 3,
        delayMs: 5000, // Show nudge after 5 seconds
        dismissedKey: 'doz_nudge_dismissed',

        init: function() {
            if (this.initialized) return;

            // Don't run on admin pages
            if (window.location.pathname.includes('/admin')) return;

            // Check session limit
            const shown = parseInt(sessionStorage.getItem(this.shownKey) || '0');
            if (shown >= this.maxPerSession) return;

            // Check if user dismissed within last hour
            const dismissed = localStorage.getItem(this.dismissedKey);
            if (dismissed && (Date.now() - parseInt(dismissed)) < 60 * 60 * 1000) return;

            // Delay before showing nudge
            setTimeout(() => this.fetchAndShow(), this.delayMs);

            this.initialized = true;
        },

        fetchAndShow: function() {
            const fingerprint = localStorage.getItem('doz_fingerprint') || '';
            const pageUrl = window.location.href;

            fetch('/api/conversion/nudge?' + new URLSearchParams({
                page: pageUrl,
                fingerprint: fingerprint
            }))
            .then(r => r.json())
            .then(data => {
                if (data && data.message) {
                    this.showNudge(data);
                }
            })
            .catch(() => {
                // Silent fail - nudges are non-critical
            });
        },

        showNudge: function(nudge) {
            // Increment session counter
            const shown = parseInt(sessionStorage.getItem(this.shownKey) || '0');
            sessionStorage.setItem(this.shownKey, (shown + 1).toString());

            // Inject styles if not already present
            if (!document.getElementById('doz-nudge-styles')) {
                const style = document.createElement('style');
                style.id = 'doz-nudge-styles';
                style.textContent = `
                    .doz-nudge-bar {
                        position: fixed;
                        bottom: 80px;
                        left: 50%;
                        transform: translateX(-50%) translateY(100px);
                        background: linear-gradient(135deg, rgba(26,26,46,0.95), rgba(22,33,62,0.95));
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(0,212,255,0.2);
                        border-radius: 12px;
                        padding: 12px 20px;
                        display: flex;
                        align-items: center;
                        gap: 14px;
                        max-width: 520px;
                        width: 92%;
                        z-index: 99999;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                        transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s;
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                        opacity: 0;
                    }
                    .doz-nudge-bar.visible {
                        transform: translateX(-50%) translateY(0);
                        opacity: 1;
                    }
                    .doz-nudge-bar.hiding {
                        transform: translateX(-50%) translateY(100px);
                        opacity: 0;
                    }
                    .doz-nudge-icon {
                        font-size: 24px;
                        flex-shrink: 0;
                    }
                    .doz-nudge-text {
                        color: rgba(255,255,255,0.9);
                        font-size: 14px;
                        line-height: 1.4;
                        flex: 1;
                    }
                    .doz-nudge-cta {
                        background: linear-gradient(135deg, #00d4ff, #7b2ff7);
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        padding: 8px 16px;
                        font-size: 13px;
                        font-weight: 600;
                        cursor: pointer;
                        white-space: nowrap;
                        transition: transform 0.2s, box-shadow 0.2s;
                        flex-shrink: 0;
                    }
                    .doz-nudge-cta:hover {
                        transform: scale(1.05);
                        box-shadow: 0 4px 15px rgba(0,212,255,0.4);
                    }
                    .doz-nudge-close {
                        background: none;
                        border: none;
                        color: rgba(255,255,255,0.3);
                        font-size: 18px;
                        cursor: pointer;
                        padding: 0 4px;
                        flex-shrink: 0;
                        transition: color 0.2s;
                    }
                    .doz-nudge-close:hover {
                        color: rgba(255,255,255,0.7);
                    }
                    @media (max-width: 480px) {
                        .doz-nudge-bar { bottom: 70px; padding: 10px 14px; gap: 10px; }
                        .doz-nudge-text { font-size: 13px; }
                        .doz-nudge-cta { padding: 6px 12px; font-size: 12px; }
                    }
                `;
                document.head.appendChild(style);
            }

            // Create nudge bar
            const bar = document.createElement('div');
            bar.className = 'doz-nudge-bar';
            bar.innerHTML = `
                <span class="doz-nudge-icon">${this.getIcon(nudge.type)}</span>
                <span class="doz-nudge-text">${this.escapeHtml(nudge.message)}</span>
                ${nudge.cta ? `<button class="doz-nudge-cta">${this.escapeHtml(nudge.cta)}</button>` : ''}
                <button class="doz-nudge-close" aria-label="Close">&times;</button>
            `;

            document.body.appendChild(bar);
            this.nudgeElement = bar;

            // Animate in after brief delay
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    bar.classList.add('visible');
                });
            });

            // Track impression
            this.trackEvent('nudge_shown', { type: nudge.type, page: nudge.pageType });

            // Auto-dismiss after 15 seconds
            const autoDismiss = setTimeout(() => this.dismiss(), 15000);

            // Close button
            bar.querySelector('.doz-nudge-close').addEventListener('click', () => {
                clearTimeout(autoDismiss);
                this.dismiss();
                localStorage.setItem(this.dismissedKey, Date.now().toString());
            });

            // CTA button
            const ctaBtn = bar.querySelector('.doz-nudge-cta');
            if (ctaBtn) {
                ctaBtn.addEventListener('click', () => {
                    clearTimeout(autoDismiss);
                    this.trackEvent('nudge_cta_clicked', { type: nudge.type, page: nudge.pageType });

                    // Record nudge click
                    fetch('/api/conversion/nudge-click', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fingerprint: localStorage.getItem('doz_fingerprint') || '',
                            type: nudge.type
                        })
                    }).catch(() => {});

                    if (nudge.ctaUrl) {
                        window.location.href = nudge.ctaUrl;
                    } else {
                        this.dismiss();
                    }
                });
            }
        },

        dismiss: function() {
            if (this.nudgeElement) {
                this.nudgeElement.classList.remove('visible');
                this.nudgeElement.classList.add('hiding');
                setTimeout(() => {
                    if (this.nudgeElement && this.nudgeElement.parentNode) {
                        this.nudgeElement.parentNode.removeChild(this.nudgeElement);
                    }
                    this.nudgeElement = null;
                }, 500);
            }
        },

        getIcon: function(type) {
            switch (type) {
                case 'social-proof': return '🌟';
                case 'urgency': return '🔥';
                case 'trust': return '🔒';
                case 'reassurance': return '✅';
                case 'engagement': return '💡';
                case 'feature-discovery': return '✨';
                case 'welcome': return '👋';
                case 'encouragement': return '🎉';
                case 'info': return 'ℹ️';
                default: return '💡';
            }
        },

        escapeHtml: function(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        trackEvent: function(event, data = {}) {
            try {
                fetch('/api/track/event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event,
                        ...data,
                        page: window.location.pathname,
                        timestamp: new Date().toISOString()
                    })
                }).catch(() => {});
            } catch (e) {}
        }
    };

    window.DozNudges = DozNudges;

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => DozNudges.init());
    } else {
        DozNudges.init();
    }
})();
