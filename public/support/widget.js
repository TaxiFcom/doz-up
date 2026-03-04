/**
 * DOZ UP AI Support Widget
 * Enterprise-level embeddable chat widget
 *
 * Usage:
 * <script src="https://up.doz.com.im/support/widget.js"></script>
 * <script>DozSupport.init({ proactiveEnabled: true });</script>
 */

(function() {
    'use strict';

    // Prevent multiple initializations
    if (window.DozSupport && window.DozSupport.initialized) return;

    const DozSupport = {
        initialized: false,
        config: {
            apiUrl: '',
            wsUrl: '',
            position: 'bottom-right',
            theme: 'dark',
            language: 'en',
            proactiveEnabled: true,
            proactiveDelay: 30000, // 30 seconds before first trigger check
            primaryColor: '#00d4ff',
            accentColor: '#7b2ff7',
            agentName: 'Luna',
            agentAvatar: null,
            welcomeMessage: null
        },
        state: {
            isOpen: false,
            isMinimized: true,
            conversationId: null,
            messages: [],
            isTyping: false,
            unreadCount: 0,
            agentConnected: false,
            visitorId: null,
            sessionId: null,
            proactiveShown: false
        },
        ws: null,
        elements: {},
        behaviorTracking: {
            timeOnPage: 0,
            scrollDepth: 0,
            hasScrolled: false,
            hasInteracted: false,
            clickCount: 0,
            lastClickTime: 0,
            pageVisitCount: 1,
            formErrors: 0
        },

        init: function(options = {}) {
            if (this.initialized) return;

            // Merge options
            Object.assign(this.config, options);

            // Auto-detect URLs
            const currentHost = window.location.hostname;
            if (!this.config.apiUrl) {
                this.config.apiUrl = window.location.protocol + '//' + currentHost;
            }
            if (!this.config.wsUrl) {
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                this.config.wsUrl = wsProtocol + '//' + currentHost;
            }

            // Generate visitor/session IDs
            this.state.visitorId = this.getOrCreateVisitorId();
            this.state.sessionId = this.generateId();

            // Generate device fingerprint for returning user detection
            this.state.fingerprint = this.generateFingerprint();

            // Inject CSS
            this.injectStyles();

            // Create widget elements
            this.createWidget();

            // Setup event listeners
            this.setupEventListeners();

            // Connect WebSocket
            this.connect();

            // Start behavior tracking
            if (this.config.proactiveEnabled) {
                this.startBehaviorTracking();
            }

            // Load saved state
            this.loadState();

            this.initialized = true;
            console.log('[DOZ Support] Widget initialized with fingerprint');
        },

        // Generate device fingerprint for user identification
        generateFingerprint: function() {
            // Check for cached fingerprint
            const cached = localStorage.getItem('doz_fingerprint');
            if (cached) return cached;

            // Generate new fingerprint from device characteristics
            const components = [];

            // Basic browser info
            components.push(navigator.userAgent || '');
            components.push(navigator.platform || '');
            components.push(navigator.language || '');
            components.push(screen.width + 'x' + screen.height);
            components.push(screen.colorDepth || '');
            components.push(new Date().getTimezoneOffset());
            components.push(navigator.hardwareConcurrency || '');

            // Canvas fingerprint
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 200;
                canvas.height = 50;
                ctx.textBaseline = 'top';
                ctx.font = '14px Arial';
                ctx.fillStyle = '#f60';
                ctx.fillRect(0, 0, 200, 50);
                ctx.fillStyle = '#069';
                ctx.fillText('DOZ UP Fingerprint', 2, 15);
                ctx.strokeStyle = 'rgba(102, 204, 0, 0.7)';
                ctx.strokeText('DOZ UP Fingerprint', 4, 17);
                components.push(canvas.toDataURL().slice(-50));
            } catch (e) {
                components.push('canvas-unavailable');
            }

            // WebGL fingerprint
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        components.push(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '');
                        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
                    }
                }
            } catch (e) {
                components.push('webgl-unavailable');
            }

            // Create hash
            const fingerprint = this.simpleHash(components.join('|'));

            // Cache it
            localStorage.setItem('doz_fingerprint', fingerprint);

            return fingerprint;
        },

        // Simple hash function for fingerprint
        simpleHash: function(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32-bit integer
            }
            return Math.abs(hash).toString(16).padStart(8, '0');
        },

        injectStyles: function() {
            const styles = `
                .doz-support-widget * {
                    box-sizing: border-box;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .doz-support-launcher {
                    position: fixed;
                    ${this.config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
                    ${this.config.position.includes('bottom') ? 'bottom: 20px;' : 'top: 20px;'}
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, ${this.config.primaryColor}, ${this.config.accentColor});
                    box-shadow: 0 4px 20px rgba(0, 212, 255, 0.4);
                    cursor: pointer;
                    z-index: 999999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                    border: none;
                    outline: none;
                }

                .doz-support-launcher:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 30px rgba(0, 212, 255, 0.6);
                }

                .doz-support-launcher svg {
                    width: 28px;
                    height: 28px;
                    fill: white;
                    transition: transform 0.3s ease;
                }

                .doz-support-launcher.open svg {
                    transform: rotate(45deg);
                }

                .doz-support-badge {
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: #ef4444;
                    color: white;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    font-size: 12px;
                    font-weight: 600;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    border: 2px solid #0f0f1a;
                }

                .doz-support-badge.visible {
                    display: flex;
                }

                .doz-support-proactive {
                    position: fixed;
                    ${this.config.position.includes('right') ? 'right: 90px;' : 'left: 90px;'}
                    ${this.config.position.includes('bottom') ? 'bottom: 25px;' : 'top: 25px;'}
                    background: #1a1a2e;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 15px 20px;
                    max-width: 280px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                    z-index: 999998;
                    animation: dozSlideIn 0.3s ease;
                    display: none;
                }

                .doz-support-proactive.visible {
                    display: block;
                }

                .doz-support-proactive-close {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    width: 20px;
                    height: 20px;
                    background: transparent;
                    border: none;
                    color: rgba(255, 255, 255, 0.5);
                    cursor: pointer;
                    font-size: 16px;
                    line-height: 1;
                }

                .doz-support-proactive-message {
                    color: white;
                    font-size: 14px;
                    line-height: 1.5;
                    margin-bottom: 12px;
                }

                .doz-support-proactive-cta {
                    background: linear-gradient(135deg, ${this.config.primaryColor}, ${this.config.accentColor});
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .doz-support-proactive-cta:hover {
                    transform: translateY(-1px);
                }

                .doz-support-window {
                    position: fixed;
                    ${this.config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
                    ${this.config.position.includes('bottom') ? 'bottom: 90px;' : 'top: 90px;'}
                    width: 380px;
                    height: 520px;
                    background: #0f0f1a;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                    z-index: 999999;
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    animation: dozSlideUp 0.3s ease;
                }

                .doz-support-window.open {
                    display: flex;
                }

                @keyframes dozSlideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }

                @keyframes dozSlideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .doz-support-header {
                    background: linear-gradient(135deg, rgba(0, 212, 255, 0.1), rgba(123, 47, 247, 0.1));
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 15px 20px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .doz-support-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, ${this.config.primaryColor}, ${this.config.accentColor});
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                }

                .doz-support-header-info {
                    flex: 1;
                }

                .doz-support-header-name {
                    color: white;
                    font-weight: 600;
                    font-size: 15px;
                }

                .doz-support-header-status {
                    color: #10b981;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }

                .doz-support-header-status::before {
                    content: '';
                    width: 8px;
                    height: 8px;
                    background: #10b981;
                    border-radius: 50%;
                }

                .doz-support-close {
                    background: transparent;
                    border: none;
                    color: rgba(255, 255, 255, 0.5);
                    cursor: pointer;
                    padding: 5px;
                    font-size: 20px;
                    line-height: 1;
                }

                .doz-support-messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }

                .doz-support-message {
                    max-width: 85%;
                    animation: dozMessageIn 0.2s ease;
                }

                @keyframes dozMessageIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .doz-support-message.user {
                    align-self: flex-end;
                }

                .doz-support-message.assistant, .doz-support-message.agent, .doz-support-message.system {
                    align-self: flex-start;
                }

                .doz-support-message-bubble {
                    padding: 12px 16px;
                    border-radius: 16px;
                    font-size: 14px;
                    line-height: 1.5;
                    word-wrap: break-word;
                }

                .doz-support-message.user .doz-support-message-bubble {
                    background: linear-gradient(135deg, ${this.config.primaryColor}, ${this.config.accentColor});
                    color: white;
                    border-bottom-right-radius: 4px;
                }

                .doz-support-message.assistant .doz-support-message-bubble {
                    background: rgba(255, 255, 255, 0.08);
                    color: white;
                    border-bottom-left-radius: 4px;
                }

                .doz-support-message.agent .doz-support-message-bubble {
                    background: rgba(16, 185, 129, 0.15);
                    border: 1px solid rgba(16, 185, 129, 0.3);
                    color: white;
                    border-bottom-left-radius: 4px;
                }

                .doz-support-message.system .doz-support-message-bubble {
                    background: rgba(249, 115, 22, 0.15);
                    border: 1px solid rgba(249, 115, 22, 0.3);
                    color: rgba(255, 255, 255, 0.8);
                    font-size: 13px;
                    text-align: center;
                    align-self: center;
                    max-width: 100%;
                }

                .doz-support-message-time {
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.4);
                    margin-top: 5px;
                }

                .doz-support-message.user .doz-support-message-time {
                    text-align: right;
                }

                .doz-support-typing {
                    display: none;
                    align-self: flex-start;
                    padding: 12px 16px;
                    background: rgba(255, 255, 255, 0.08);
                    border-radius: 16px;
                    border-bottom-left-radius: 4px;
                }

                .doz-support-typing.visible {
                    display: flex;
                    gap: 4px;
                }

                .doz-support-typing span {
                    width: 8px;
                    height: 8px;
                    background: ${this.config.primaryColor};
                    border-radius: 50%;
                    animation: dozTyping 1.4s infinite;
                }

                .doz-support-typing span:nth-child(2) { animation-delay: 0.2s; }
                .doz-support-typing span:nth-child(3) { animation-delay: 0.4s; }

                @keyframes dozTyping {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1); }
                }

                .doz-support-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 10px;
                }

                .doz-support-action-btn {
                    padding: 8px 14px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 20px;
                    color: ${this.config.primaryColor};
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .doz-support-action-btn:hover {
                    background: rgba(0, 212, 255, 0.1);
                    border-color: ${this.config.primaryColor};
                }

                .doz-support-input-area {
                    padding: 15px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    display: flex;
                    gap: 10px;
                    align-items: flex-end;
                }

                .doz-support-input {
                    flex: 1;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 12px 15px;
                    color: white;
                    font-size: 14px;
                    resize: none;
                    min-height: 44px;
                    max-height: 120px;
                    outline: none;
                    transition: border-color 0.2s;
                }

                .doz-support-input:focus {
                    border-color: ${this.config.primaryColor};
                }

                .doz-support-input::placeholder {
                    color: rgba(255, 255, 255, 0.4);
                }

                .doz-support-send {
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    background: linear-gradient(135deg, ${this.config.primaryColor}, ${this.config.accentColor});
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }

                .doz-support-send:hover {
                    transform: scale(1.05);
                }

                .doz-support-send:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none;
                }

                .doz-support-send svg {
                    width: 20px;
                    height: 20px;
                    fill: white;
                }

                .doz-support-rating {
                    padding: 15px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    text-align: center;
                    display: none;
                }

                .doz-support-rating.visible {
                    display: block;
                }

                .doz-support-rating-title {
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 13px;
                    margin-bottom: 10px;
                }

                .doz-support-stars {
                    display: flex;
                    justify-content: center;
                    gap: 8px;
                }

                .doz-support-star {
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 28px;
                    color: rgba(255, 255, 255, 0.3);
                    transition: all 0.2s;
                }

                .doz-support-star:hover,
                .doz-support-star.active {
                    color: #fbbf24;
                    transform: scale(1.2);
                }

                .doz-support-powered {
                    padding: 10px;
                    text-align: center;
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.3);
                }

                .doz-support-powered a {
                    color: ${this.config.primaryColor};
                    text-decoration: none;
                }

                @media (max-width: 480px) {
                    .doz-support-window {
                        width: 100%;
                        height: 100%;
                        right: 0;
                        bottom: 0;
                        border-radius: 0;
                    }

                    .doz-support-launcher {
                        right: 15px;
                        bottom: 15px;
                    }
                }
            `;

            const styleElement = document.createElement('style');
            styleElement.textContent = styles;
            document.head.appendChild(styleElement);
        },

        createWidget: function() {
            // Create container
            const container = document.createElement('div');
            container.className = 'doz-support-widget';
            container.innerHTML = `
                <!-- Launcher Button -->
                <button class="doz-support-launcher" aria-label="Open support chat">
                    <svg viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-4h2v2h-2zm1.61-9.96c-2.06-.3-3.88.97-4.43 2.79-.18.58.26 1.17.87 1.17h.2c.41 0 .74-.29.88-.67.32-.89 1.27-1.5 2.3-1.28.95.2 1.65 1.13 1.57 2.1-.1 1.34-1.62 1.63-2.45 2.88 0 .01-.01.01-.01.02-.01.02-.02.03-.03.05-.09.15-.18.32-.25.5-.01.03-.03.05-.04.08-.01.02-.01.04-.02.07-.12.34-.2.75-.2 1.25h2c0-.42.11-.77.28-1.07.02-.03.03-.06.05-.09.08-.14.18-.27.28-.39.01-.01.02-.03.03-.04.1-.12.21-.23.33-.34.96-.91 2.26-1.65 1.99-3.56-.24-1.74-1.61-3.21-3.35-3.47z"/>
                    </svg>
                    <span class="doz-support-badge">0</span>
                </button>

                <!-- Proactive Popup -->
                <div class="doz-support-proactive">
                    <button class="doz-support-proactive-close">&times;</button>
                    <div class="doz-support-proactive-message"></div>
                    <button class="doz-support-proactive-cta">Chat with us</button>
                </div>

                <!-- Chat Window -->
                <div class="doz-support-window">
                    <div class="doz-support-header">
                        <div class="doz-support-avatar">
                            ${this.config.agentAvatar ? `<img src="${this.config.agentAvatar}" alt="" style="width:100%;height:100%;border-radius:50%;">` : '🤖'}
                        </div>
                        <div class="doz-support-header-info">
                            <div class="doz-support-header-name">${this.config.agentName}</div>
                            <div class="doz-support-header-status">Online</div>
                        </div>
                        <button class="doz-support-close">&times;</button>
                    </div>

                    <div class="doz-support-messages">
                        <div class="doz-support-typing">
                            <span></span><span></span><span></span>
                        </div>
                    </div>

                    <div class="doz-support-rating">
                        <div class="doz-support-rating-title">How was your experience?</div>
                        <div class="doz-support-stars">
                            <button class="doz-support-star" data-rating="1">★</button>
                            <button class="doz-support-star" data-rating="2">★</button>
                            <button class="doz-support-star" data-rating="3">★</button>
                            <button class="doz-support-star" data-rating="4">★</button>
                            <button class="doz-support-star" data-rating="5">★</button>
                        </div>
                    </div>

                    <div class="doz-support-input-area">
                        <textarea class="doz-support-input" placeholder="Type your message..." rows="1"></textarea>
                        <button class="doz-support-send">
                            <svg viewBox="0 0 24 24">
                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                            </svg>
                        </button>
                    </div>

                    <div class="doz-support-powered">
                        Powered by <a href="https://up.doz.com.im" target="_blank">DOZ UP</a>
                    </div>
                </div>
            `;

            document.body.appendChild(container);

            // Store element references
            this.elements = {
                container,
                launcher: container.querySelector('.doz-support-launcher'),
                badge: container.querySelector('.doz-support-badge'),
                proactive: container.querySelector('.doz-support-proactive'),
                proactiveMessage: container.querySelector('.doz-support-proactive-message'),
                proactiveClose: container.querySelector('.doz-support-proactive-close'),
                proactiveCta: container.querySelector('.doz-support-proactive-cta'),
                window: container.querySelector('.doz-support-window'),
                close: container.querySelector('.doz-support-close'),
                messages: container.querySelector('.doz-support-messages'),
                typing: container.querySelector('.doz-support-typing'),
                input: container.querySelector('.doz-support-input'),
                send: container.querySelector('.doz-support-send'),
                rating: container.querySelector('.doz-support-rating'),
                stars: container.querySelectorAll('.doz-support-star')
            };
        },

        setupEventListeners: function() {
            // Launcher click
            this.elements.launcher.addEventListener('click', () => this.toggle());

            // Close button
            this.elements.close.addEventListener('click', () => this.close());

            // Proactive popup
            this.elements.proactiveClose.addEventListener('click', () => this.dismissProactive());
            this.elements.proactiveCta.addEventListener('click', () => {
                this.dismissProactive();
                this.open();
            });

            // Send message
            this.elements.send.addEventListener('click', () => this.sendMessage());
            this.elements.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            // Input focus for typing indicator
            this.elements.input.addEventListener('focus', () => this.sendTyping(true));
            this.elements.input.addEventListener('blur', () => this.sendTyping(false));

            // Auto-resize input
            this.elements.input.addEventListener('input', () => {
                this.elements.input.style.height = 'auto';
                this.elements.input.style.height = Math.min(this.elements.input.scrollHeight, 120) + 'px';
            });

            // Rating stars
            this.elements.stars.forEach(star => {
                star.addEventListener('click', () => this.submitRating(parseInt(star.dataset.rating)));
            });

            // Track user interactions
            document.addEventListener('click', () => {
                this.behaviorTracking.hasInteracted = true;
                const now = Date.now();
                if (now - this.behaviorTracking.lastClickTime < 3000) {
                    this.behaviorTracking.clickCount++;
                } else {
                    this.behaviorTracking.clickCount = 1;
                }
                this.behaviorTracking.lastClickTime = now;
            });

            document.addEventListener('scroll', () => {
                this.behaviorTracking.hasScrolled = true;
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                this.behaviorTracking.scrollDepth = Math.round((scrollTop / docHeight) * 100) || 0;
            });
        },

        connect: function() {
            // Build WebSocket URL with fingerprint and device info
            const params = new URLSearchParams({
                visitor: this.state.visitorId,
                session: this.state.sessionId,
                fingerprint: this.state.fingerprint || '',
                platform: navigator.platform || '',
                screen: screen.width + 'x' + screen.height,
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                lang: navigator.language || 'en'
            });

            const wsUrl = `${this.config.wsUrl}/ws/support?${params.toString()}`;

            try {
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    console.log('[DOZ Support] WebSocket connected with fingerprint');
                };

                this.ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                };

                this.ws.onclose = () => {
                    console.log('[DOZ Support] WebSocket disconnected, reconnecting...');
                    setTimeout(() => this.connect(), 3000);
                };

                this.ws.onerror = (error) => {
                    console.error('[DOZ Support] WebSocket error:', error);
                };
            } catch (e) {
                console.error('[DOZ Support] WebSocket connection failed:', e);
            }
        },

        handleMessage: function(data) {
            switch (data.type) {
                case 'connected':
                    this.state.conversationId = data.conversationId;
                    this.state.fingerprintId = data.fingerprintId;
                    this.state.isReturning = data.isReturning || false;
                    this.state.visitCount = data.visitCount || 1;
                    this.state.journeyStage = data.journeyStage || 'new';

                    // Store personalized greeting for use when conversation starts
                    if (data.personalizedGreeting) {
                        this.state.personalizedGreeting = data.personalizedGreeting;
                    }

                    // Update UI for returning users
                    if (data.isReturning && data.visitCount > 2) {
                        this.updateHeaderForReturningUser(data.visitCount);
                    }
                    break;

                case 'conversation_started':
                    this.state.conversationId = data.conversationId;
                    this.state.isReturning = data.isReturning || false;
                    this.addMessage(data.message);
                    break;

                case 'message':
                    this.addMessage(data.message);
                    if (!this.state.isOpen) {
                        this.state.unreadCount++;
                        this.updateBadge();
                    }
                    break;

                case 'typing':
                    this.showTyping(data.isTyping && data.sender !== 'user');
                    break;

                case 'escalated':
                    this.addMessage(data.message);
                    break;

                case 'agent_joined':
                    this.state.agentConnected = true;
                    this.elements.container.querySelector('.doz-support-avatar').innerHTML = '👤';
                    this.elements.container.querySelector('.doz-support-header-name').textContent = data.agentName || 'Support Agent';
                    if (data.message) this.addMessage(data.message);
                    break;

                case 'closed':
                    if (data.resolved) {
                        this.showRating();
                    }
                    break;

                case 'trigger':
                    this.showProactive(data.trigger.message);
                    break;
            }
        },

        // Update header to show recognition for returning users
        updateHeaderForReturningUser: function(visitCount) {
            const statusEl = this.elements.container.querySelector('.doz-support-header-status');
            if (statusEl && visitCount > 5) {
                statusEl.innerHTML = '<span style="color: #fbbf24;">Welcome back!</span>';
            }
        },

        toggle: function() {
            if (this.state.isOpen) {
                this.close();
            } else {
                this.open();
            }
        },

        open: function() {
            this.state.isOpen = true;
            this.state.unreadCount = 0;
            this.updateBadge();
            this.elements.window.classList.add('open');
            this.elements.launcher.classList.add('open');
            this.dismissProactive();
            this.elements.input.focus();

            // Start conversation if not started
            if (!this.state.conversationId && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'start_conversation',
                    pageUrl: window.location.href,
                    userAgent: navigator.userAgent,
                    language: navigator.language
                }));
            }

            this.saveState();
        },

        close: function() {
            this.state.isOpen = false;
            this.elements.window.classList.remove('open');
            this.elements.launcher.classList.remove('open');
            this.saveState();
        },

        addMessage: function(message) {
            const role = message.role?.toLowerCase() || 'assistant';
            const messageEl = document.createElement('div');
            messageEl.className = `doz-support-message ${role}`;

            let bubbleContent = this.escapeHtml(message.content).replace(/\n/g, '<br>');

            // Add suggested actions if any
            let actionsHtml = '';
            if (message.suggestedActions && message.suggestedActions.length > 0) {
                actionsHtml = '<div class="doz-support-actions">';
                message.suggestedActions.forEach(action => {
                    if (action.type === 'text') {
                        actionsHtml += `<button class="doz-support-action-btn" data-action="text" data-value="${this.escapeHtml(action.value || action.label)}">${this.escapeHtml(action.label)}</button>`;
                    } else if (action.type === 'link') {
                        actionsHtml += `<a href="${action.url}" target="_blank" class="doz-support-action-btn">${this.escapeHtml(action.label)}</a>`;
                    } else if (action.type === 'article') {
                        actionsHtml += `<button class="doz-support-action-btn" data-action="article" data-id="${action.articleId}">${this.escapeHtml(action.label)}</button>`;
                    }
                });
                actionsHtml += '</div>';
            }

            messageEl.innerHTML = `
                <div class="doz-support-message-bubble">${bubbleContent}</div>
                ${actionsHtml}
                <div class="doz-support-message-time">${this.formatTime(message.createdAt)}</div>
            `;

            // Insert before typing indicator
            this.elements.messages.insertBefore(messageEl, this.elements.typing);

            // Setup action button listeners
            messageEl.querySelectorAll('.doz-support-action-btn[data-action]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.action;
                    if (action === 'text') {
                        this.elements.input.value = btn.dataset.value;
                        this.sendMessage();
                    }
                });
            });

            // Scroll to bottom
            this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

            // Store message
            this.state.messages.push(message);
        },

        sendMessage: function() {
            const content = this.elements.input.value.trim();
            if (!content) return;

            this.elements.input.value = '';
            this.elements.input.style.height = 'auto';

            // Show user message immediately
            this.addMessage({
                role: 'USER',
                content,
                createdAt: new Date().toISOString()
            });

            // Send via WebSocket
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'message',
                    content
                }));
            }
        },

        sendTyping: function(isTyping) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'typing',
                    isTyping
                }));
            }
        },

        showTyping: function(show) {
            this.state.isTyping = show;
            this.elements.typing.classList.toggle('visible', show);
            if (show) {
                this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
            }
        },

        showProactive: function(message) {
            if (this.state.proactiveShown || this.state.isOpen) return;

            this.state.proactiveShown = true;
            this.elements.proactiveMessage.textContent = message;
            this.elements.proactive.classList.add('visible');
        },

        dismissProactive: function() {
            this.elements.proactive.classList.remove('visible');
        },

        showRating: function() {
            this.elements.rating.classList.add('visible');
        },

        submitRating: function(rating) {
            // Highlight selected stars
            this.elements.stars.forEach((star, index) => {
                star.classList.toggle('active', index < rating);
            });

            // Send rating
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'rating',
                    rating
                }));
            }

            // Hide rating after 2 seconds
            setTimeout(() => {
                this.elements.rating.classList.remove('visible');
            }, 2000);
        },

        updateBadge: function() {
            const badge = this.elements.badge;
            badge.textContent = this.state.unreadCount;
            badge.classList.toggle('visible', this.state.unreadCount > 0);
        },

        startBehaviorTracking: function() {
            // Track time on page
            setInterval(() => {
                this.behaviorTracking.timeOnPage++;
            }, 1000);

            // Send behavior data periodically for trigger evaluation
            setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.state.isOpen) {
                    this.ws.send(JSON.stringify({
                        type: 'behavior',
                        behavior: {
                            ...this.behaviorTracking,
                            pageUrl: window.location.href,
                            clickTimespan: Date.now() - this.behaviorTracking.lastClickTime
                        }
                    }));
                }
            }, this.config.proactiveDelay);
        },

        // Utilities
        generateId: function() {
            return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
        },

        getOrCreateVisitorId: function() {
            let visitorId = localStorage.getItem('doz_support_visitor');
            if (!visitorId) {
                visitorId = 'v_' + this.generateId();
                localStorage.setItem('doz_support_visitor', visitorId);
            }
            return visitorId;
        },

        formatTime: function(isoString) {
            if (!isoString) return '';
            const date = new Date(isoString);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },

        escapeHtml: function(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        saveState: function() {
            try {
                localStorage.setItem('doz_support_state', JSON.stringify({
                    conversationId: this.state.conversationId,
                    isOpen: this.state.isOpen
                }));
            } catch (e) {}
        },

        loadState: function() {
            try {
                const saved = JSON.parse(localStorage.getItem('doz_support_state') || '{}');
                if (saved.conversationId) {
                    this.state.conversationId = saved.conversationId;
                }
                if (saved.isOpen) {
                    this.open();
                }
            } catch (e) {}
        }
    };

    // Expose globally
    window.DozSupport = DozSupport;

    // Auto-init if script has data-auto attribute
    if (document.currentScript && document.currentScript.dataset.auto !== undefined) {
        document.addEventListener('DOMContentLoaded', () => DozSupport.init());
    }
})();
