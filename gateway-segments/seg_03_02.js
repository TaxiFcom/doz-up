            .share-btn, .invite-btn {
                justify-content: center;
            }
            .features-row {
                flex-direction: column;
                gap: 10px;
            }
            .steps-demo {
                flex-direction: column;
                gap: 20px;
            }
            .step-arrow {
                transform: rotate(90deg);
            }
            .step-card {
                width: 90%;
                max-width: 200px;
            }
            .trust-badges {
                flex-direction: column;
                gap: 8px;
            }
            .big-cta-btn {
                padding: 14px 28px;
                font-size: 1rem;
            }
        }

        /* Social Proof Banner */
        .social-proof-banner {
            background: linear-gradient(135deg, rgba(251, 146, 60, 0.15), rgba(239, 68, 68, 0.1));
            border: 1px solid rgba(251, 146, 60, 0.3);
            border-radius: 12px;
            padding: 12px 20px;
            margin-bottom: 15px;
            text-align: center;
            animation: pulse-glow 2s ease-in-out infinite;
        }
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 5px rgba(251, 146, 60, 0.2); }
            50% { box-shadow: 0 0 20px rgba(251, 146, 60, 0.4); }
        }
        .social-proof-text {
            color: #fb923c;
            font-size: 0.95rem;
            font-weight: 500;
        }
        .social-proof-text .count {
            font-weight: 700;
            color: #fff;
        }

        /* Subscribe Popup Modal */
        .subscribe-popup {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 3000;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .subscribe-popup.show {
            display: flex;
        }
        .subscribe-popup-content {
            background: linear-gradient(135deg, #1a1a2e, #2d2d44);
            border: 2px solid rgba(16, 185, 129, 0.4);
            border-radius: 24px;
            padding: 35px;
            text-align: center;
            max-width: 400px;
            width: 90%;
            position: relative;
            animation: slideUp 0.4s ease;
        }
        @keyframes slideUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .subscribe-popup-close {
            position: absolute;
            top: 15px;
            right: 15px;
            background: rgba(255,255,255,0.1);
            border: none;
            color: #fff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .subscribe-popup-close:hover {
            background: rgba(255,255,255,0.2);
        }
        .subscribe-popup-icon {
            font-size: 48px;
            margin-bottom: 15px;
        }
        .subscribe-popup h2 {
            color: #fff;
            font-size: 1.5rem;
            margin-bottom: 10px;
        }
        .subscribe-popup p {
            color: #94a3b8;
            font-size: 1rem;
            margin-bottom: 20px;
            line-height: 1.5;
        }
        .subscribe-popup .urgency {
            background: rgba(251, 146, 60, 0.15);
            border: 1px solid rgba(251, 146, 60, 0.3);
            border-radius: 8px;
            padding: 10px 15px;
            margin-bottom: 20px;
            color: #fb923c;
            font-size: 0.9rem;
            font-weight: 500;
        }
        .subscribe-popup-btn {
            display: block;
            width: 100%;
            padding: 16px 24px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            font-size: 1.1rem;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
        }
        .subscribe-popup-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        .subscribe-popup .skip-link {
            color: #64748b;
            font-size: 0.85rem;
            margin-top: 15px;
            cursor: pointer;
        }
        .subscribe-popup .skip-link:hover {
            color: #94a3b8;
        }

        /* Checkout CTA Section */
        .checkout-cta-section {
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05));
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
            text-align: center;
        }
        .checkout-cta-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #10b981;
            margin-bottom: 8px;
        }
        .checkout-cta-text {
            color: rgba(255,255,255,0.7);
            font-size: 0.9rem;
            margin-bottom: 16px;
        }
        .checkout-cta-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            padding: 14px 28px;
            border-radius: 12px;
            border: none;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }
        .checkout-cta-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        .checkout-cta-btn svg {
            width: 20px;
            height: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <a href="https://${SHARE_HOST}?ref=logo" class="logo">DOZ</a>
            <a href="${downloadPageUrl}" class="try-btn">Get DOZ Free</a>
        </div>

        <div class="image-container">
            <img src="${rawImageUrl}" alt="Shared Image" onclick="openLightbox()" id="mainImage">
            <div class="image-info">
                <span>Shared via DOZ</span>
                <div class="image-actions">
                    <button class="image-action-btn" onclick="openLightbox()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>
                        View
                    </button>
                    <span>${fileSizeKB} KB</span>
                </div>
            </div>
        </div>

        <div class="share-section">
            <div class="share-title">Share this image</div>
            <div class="share-buttons">
                <a href="https://wa.me/?text=${shareText}%20${encodeURIComponent(imageUrl + '?ref=wa')}" target="_blank" class="share-btn whatsapp" onclick="trackShare('whatsapp')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                </a>
                <a href="https://t.me/share/url?url=${encodeURIComponent(imageUrl + '?ref=tg')}&text=${shareText}" target="_blank" class="share-btn telegram" onclick="trackShare('telegram')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    Telegram
                </a>
                <a href="https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(imageUrl + '?ref=tw')}" target="_blank" class="share-btn twitter" onclick="trackShare('twitter')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    X / Twitter
                </a>
                <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(imageUrl + '?ref=fb')}" target="_blank" class="share-btn facebook" onclick="trackShare('facebook')">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    Facebook
                </a>
                <a href="mailto:?subject=${emailSubject}&body=${emailBody}" class="share-btn email" onclick="trackShare('email')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    Email
                </a>
                <button onclick="copyLink(this)" class="share-btn copy" id="copyBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    <span>Copy Link</span>
                </button>
                <button onclick="downloadImage()" class="share-btn download">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                </button>
                <button onclick="showQR()" class="share-btn qr">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    QR Code
                </button>
            </div>
        </div>

        <div class="invite-section">
            <div class="invite-content">
                <div class="invite-title">Love sharing? Try DOZ!</div>
                <div class="invite-text">The fastest way to capture and share screenshots. One click, instant link. Free forever.</div>
                <div class="invite-buttons">
                    <a href="${downloadPageUrl}" class="invite-btn primary">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download DOZ Free
                    </a>
                    <a href="https://wa.me/?text=${inviteText}%20${inviteUrl}" target="_blank" class="invite-btn secondary">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Invite Friends
                    </a>
                    <button onclick="openPairingModal()" class="invite-btn secondary">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>
                        Pair Device
                    </button>
                </div>
                <div class="features-row">
                    <div class="feature-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Instant capture
                    </div>
                    <div class="feature-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        One-click share
                    </div>
                    <div class="feature-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                        100% Free
                    </div>
                </div>
            </div>
        </div>

        <!-- Social Proof Banner -->
        <div class="social-proof-banner" id="socialProofBanner" style="display:none">
            <div class="social-proof-text" id="socialProofText">
                <span class="count" id="activeCount"></span> <span id="socialProofLabel"></span>
            </div>
        </div>

        <div class="checkout-cta-section">
            <div class="checkout-cta-title">Upgrade to Pro</div>
            <div class="checkout-cta-text">Unlimited storage, links never expire, priority support</div>
            <a href="#" id="checkoutBtn" class="checkout-cta-btn" onclick="startSmartCheckout(); return false;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
                <span id="checkoutBtnText">Upgrade Now - $${((stripeService.getPlan('pro_yearly')?.monthlyEquiv || 999) / 100).toFixed(2)}/month</span>
            </a>
        </div>

        <script>
        const SHARE_FILENAME = '${filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')}';
        const PLAN_ID = 'pro_yearly';

        let isCheckingOut = false;

        async function startSmartCheckout() {
            if (isCheckingOut) return; // Prevent double-click
            isCheckingOut = true;

            const btn = document.getElementById('checkoutBtn');
            const btnText = document.getElementById('checkoutBtnText');
            const originalText = btnText.textContent;
            btnText.textContent = 'Redirecting...';
            btn.style.opacity = '0.7';

            // Store share context
            sessionStorage.setItem('doz_share_checkout', JSON.stringify({
                filename: SHARE_FILENAME,
                timestamp: Date.now()
            }));

            // Mark that user clicked checkout (for popup)
            localStorage.setItem('doz_checkout_clicked', Date.now());

            const fallbackUrl = '/checkout.html?plan=' + PLAN_ID + '&share=' + SHARE_FILENAME;

            try {
                const res = await fetch('/api/checkout/payment-link?planId=' + PLAN_ID + '&filename=' + SHARE_FILENAME);
                const data = await res.json();

                if (data.success && data.url) {
                    window.location.href = data.url;
                } else {
                    window.location.href = fallbackUrl;
                }
            } catch (e) {
                console.log('Payment Link not available, using checkout page');
                window.location.href = fallbackUrl;
            }

            // Reset button after short delay (in case redirect fails)
            setTimeout(() => {
                isCheckingOut = false;
                btnText.textContent = originalText;
                btn.style.opacity = '1';
            }, 3000);
        }

        // Popup checkout - immediate redirect
        function popupCheckout() {
            localStorage.setItem('doz_checkout_clicked', Date.now());
            localStorage.setItem('doz_popup_dismissed', Date.now());
            window.location.href = '/checkout.html?plan=' + PLAN_ID + '&share=' + SHARE_FILENAME + '&popup=1';
        }

        // Close subscribe popup
        function closeSubscribePopup() {
            document.getElementById('subscribePopup').classList.remove('show');
            localStorage.setItem('doz_popup_dismissed', Date.now());
        }

        // Load social proof data - real numbers from live analytics
        async function loadSocialProof() {
            try {
                const res = await fetch('/api/social-proof/active-checkouts');
                const data = await res.json();
                if (!data.success) return;

                var count = 0;
                var label = '';

                // Priority: active visitors > today uploads > total images
                if (data.activeVisitors > 1) {
                    count = data.activeVisitors;
                    label = 'people viewing right now';
                } else if (data.todayUploads > 0) {
                    count = data.todayUploads;
                    label = 'images shared today';
                } else if (data.totalImages > 0) {
                    count = data.totalImages.toLocaleString();
                    label = 'images shared on DOZ';
                }

                var banner = document.getElementById('socialProofBanner');
                var popup = document.getElementById('popupUrgency');

                if (count > 0 || (typeof count === 'string' && count !== '0')) {
                    document.getElementById('activeCount').textContent = count;
                    document.getElementById('socialProofLabel').textContent = label;
                    banner.style.display = '';

                    document.getElementById('popupActiveCount').textContent = count;
                    document.getElementById('popupProofLabel').textContent = label;
                    popup.style.display = '';
                } else {
                    banner.style.display = 'none';
                    popup.style.display = 'none';
                }
            } catch (e) {
                console.log('Social proof not available');
            }
        }

        // Show popup after 3 seconds
        function initSubscribePopup() {
            // Don't show if dismissed recently (within 24 hours)
            const dismissed = localStorage.getItem('doz_popup_dismissed');
            if (dismissed && (Date.now() - parseInt(dismissed)) < 24 * 60 * 60 * 1000) {
                return;
            }

            // Don't show if already clicked checkout
            const clicked = localStorage.getItem('doz_checkout_clicked');
            if (clicked && (Date.now() - parseInt(clicked)) < 60 * 60 * 1000) {
                return;
            }

            setTimeout(() => {
                document.getElementById('subscribePopup').classList.add('show');
            }, 3000);
        }

        // Pre-check if user has saved payment method
        (async function() {
            try {
                const res = await fetch('/api/checkout/owner/' + SHARE_FILENAME);
                const data = await res.json();
                if (data.success && data.hasCustomer && data.paymentPreferences?.hasPreferred) {
                    const card = data.paymentPreferences;
                    const btnText = document.getElementById('checkoutBtnText');
                    if (card.last4) {
                        btnText.textContent = 'Pay with ****' + card.last4 + ' \u2192';
                    }
                }
            } catch (e) {}
        })();

        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadSocialProof();
            initSubscribePopup();

            // Refresh social proof every 30 seconds
            setInterval(loadSocialProof, 30000);
        });
        </script>

        <div class="footer">
            Powered by <a href="https://${SHARE_HOST}">DOZ</a> - Share screenshots instantly
        </div>
    </div>

    <div class="toast" id="toast">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <span id="toastText">Link copied!</span>
    </div>

    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
        <img src="${rawImageUrl}" alt="Full size image">
    </div>

    <div class="qr-modal" id="qrModal" onclick="hideQR()">
        <div class="qr-content" onclick="event.stopPropagation()">
            <h3>Scan to view</h3>
            <p>Point your phone camera at this QR code</p>
            <div class="qr-code" id="qrCode"></div>
            <button class="qr-close" onclick="hideQR()">Close</button>
        </div>
    </div>

    <!-- Device Pairing Modal -->
    <div class="pairing-modal" id="pairingModal" onclick="closePairingModal()">
        <div class="pairing-content" onclick="event.stopPropagation()">
            <h3>Pair New Device</h3>
            <p>Connect another device to your DOZ account</p>

            <div class="pairing-tabs">
