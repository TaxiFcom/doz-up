/**
 * DOZ UP - Exit Intent Detection & Intervention
 * Detects when users are about to leave and shows targeted interventions
 * to recover potential conversions.
 */
(function() {
    'use strict';

    // Prevent multiple initializations
    if (window.DozExitIntent) return;

    const DozExitIntent = {
        initialized: false,
        shown: false,
        cooldownKey: 'doz_exit_intent_last',
        cooldownMs: 30 * 60 * 1000, // 30 minutes between exit intents
        overlay: null,

        init: function() {
            if (this.initialized) return;

            // Don't run on admin pages
            if (window.location.pathname.includes('/admin')) return;

            // Check cooldown
            const lastShown = localStorage.getItem(this.cooldownKey);
            if (lastShown && (Date.now() - parseInt(lastShown)) < this.cooldownMs) return;

            // Desktop: detect mouse leaving viewport from top
            if (!('ontouchstart' in window)) {
                document.addEventListener('mouseleave', (e) => {
                    if (e.clientY < 10 && !this.shown) {
                        this.triggerExitIntent();
                    }
                });
            }

            // Mobile: detect back button / tab switching after engagement
            let timeOnPage = 0;
            const timer = setInterval(() => { timeOnPage++; }, 1000);

            document.addEventListener('visibilitychange', () => {
                if (document.hidden && timeOnPage > 15 && !this.shown) {
                    // User switching away after 15+ seconds - store for when they return
                    this.pendingIntervention = true;
                }
                if (!document.hidden && this.pendingIntervention) {
                    this.pendingIntervention = false;
                    this.triggerExitIntent();
                }
            });

            this.initialized = true;
        },

        triggerExitIntent: function() {
            if (this.shown) return;
            this.shown = true;

            // Fetch intervention from server
            const fingerprint = localStorage.getItem('doz_fingerprint') || '';
            const pageUrl = window.location.href;

            fetch('/api/conversion/exit-intervention?' + new URLSearchParams({
                page: pageUrl,
                fingerprint: fingerprint
            }))
            .then(r => r.json())
            .then(data => {
                if (data && data.title) {
                    this.showOverlay(data);
                }
            })
            .catch(() => {
                // Fallback intervention if server unreachable
                this.showOverlay({
                    title: 'Before you go...',
                    message: 'Have a question? Our AI assistant can help you instantly.',
                    cta: 'Chat with Luna',
                    action: 'open-support',
                    type: 'engagement'
                });
            });
        },

        showOverlay: function(intervention) {
            // Set cooldown
            localStorage.setItem(this.cooldownKey, Date.now().toString());

            // Track
            this.trackEvent('exit_intent_shown', { type: intervention.type });

            // Create overlay
            const overlay = document.createElement('div');
            overlay.id = 'doz-exit-overlay';
            overlay.innerHTML = `
                <div class="doz-exit-backdrop"></div>
                <div class="doz-exit-modal">
                    <button class="doz-exit-close" aria-label="Close">&times;</button>
                    <div class="doz-exit-icon">${this.getIcon(intervention.type)}</div>
                    <h2 class="doz-exit-title">${this.escapeHtml(intervention.title)}</h2>
                    <p class="doz-exit-message">${this.escapeHtml(intervention.message)}</p>
                    ${intervention.cta ? `<button class="doz-exit-cta">${this.escapeHtml(intervention.cta)}</button>` : ''}
                    <button class="doz-exit-dismiss">No thanks, I'll leave</button>
                </div>
            `;

            // Inject styles
            const style = document.createElement('style');
            style.textContent = `
                #doz-exit-overlay { position: fixed; inset: 0; z-index: 999998; display: flex; align-items: center; justify-content: center; animation: dozExitFadeIn 0.3s ease; }
                @keyframes dozExitFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes dozExitSlideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                .doz-exit-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); }
                .doz-exit-modal { position: relative; background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px; max-width: 420px; width: 90%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); animation: dozExitSlideUp 0.4s ease 0.1s both; }
                .doz-exit-close { position: absolute; top: 12px; right: 16px; background: none; border: none; color: rgba(255,255,255,0.5); font-size: 24px; cursor: pointer; padding: 4px 8px; transition: color 0.2s; }
                .doz-exit-close:hover { color: #fff; }
                .doz-exit-icon { font-size: 48px; margin-bottom: 16px; }
                .doz-exit-title { color: #fff; font-size: 22px; font-weight: 700; margin: 0 0 12px; font-family: 'Inter', -apple-system, sans-serif; }
                .doz-exit-message { color: rgba(255,255,255,0.7); font-size: 15px; line-height: 1.6; margin: 0 0 24px; font-family: 'Inter', -apple-system, sans-serif; }
                .doz-exit-cta { display: block; width: 100%; padding: 14px 24px; background: linear-gradient(135deg, #00d4ff, #7b2ff7); color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; font-family: 'Inter', -apple-system, sans-serif; }
                .doz-exit-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,212,255,0.4); }
                .doz-exit-dismiss { display: block; width: 100%; margin-top: 12px; padding: 8px; background: none; border: none; color: rgba(255,255,255,0.4); font-size: 13px; cursor: pointer; font-family: 'Inter', -apple-system, sans-serif; }
                .doz-exit-dismiss:hover { color: rgba(255,255,255,0.6); }
            `;

            document.head.appendChild(style);
            document.body.appendChild(overlay);
            this.overlay = overlay;

            // Event handlers
            overlay.querySelector('.doz-exit-close').addEventListener('click', () => this.dismiss());
            overlay.querySelector('.doz-exit-backdrop').addEventListener('click', () => this.dismiss());
            overlay.querySelector('.doz-exit-dismiss').addEventListener('click', () => this.dismiss());

            const ctaBtn = overlay.querySelector('.doz-exit-cta');
            if (ctaBtn) {
                ctaBtn.addEventListener('click', () => {
                    this.trackEvent('exit_intent_cta_clicked', { type: intervention.type });

                    if (intervention.action === 'open-support' && window.DozSupport) {
                        this.dismiss();
                        DozSupport.open();
                    } else if (intervention.ctaUrl) {
                        window.location.href = intervention.ctaUrl;
                    } else {
                        this.dismiss();
                    }

                    // Record save
                    fetch('/api/conversion/exit-save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fingerprint: localStorage.getItem('doz_fingerprint') || '' })
                    }).catch(() => {});
                });
            }
        },

        dismiss: function() {
            if (this.overlay) {
                this.overlay.style.animation = 'dozExitFadeIn 0.2s ease reverse';
                setTimeout(() => {
                    if (this.overlay && this.overlay.parentNode) {
                        this.overlay.parentNode.removeChild(this.overlay);
                    }
                    this.overlay = null;
                }, 200);
            }
            this.trackEvent('exit_intent_dismissed');
        },

        getIcon: function(type) {
            switch (type) {
                case 'discount': return '🎁';
                case 'free-trial': return '🚀';
                case 'reassurance': return '🛡️';
                case 'engagement': return '💬';
                default: return '👋';
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

    window.DozExitIntent = DozExitIntent;

    // Auto-initialize after DOM load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => DozExitIntent.init());
    } else {
        DozExitIntent.init();
    }
})();
