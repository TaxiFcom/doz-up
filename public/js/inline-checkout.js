/**
 * DOZ UP - Slide-Out Checkout Panel (Shopify-style)
 * High-conversion checkout with Apple Pay, Google Pay, and Card payments
 */

window.DOZCheckout = (function() {
    let stripe = null;
    let elements = null;
    let paymentElement = null;
    let expressCheckoutElement = null;
    let currentClientSecret = null;
    let currentPlanId = null;
    let initialized = false;
    let panelCreated = false;

    // ============ SHARE CONTEXT ============
    // Store share context for checkout linking from /i/ links
    function setShareContext(filename) {
        if (filename) {
            sessionStorage.setItem('doz_share_checkout', JSON.stringify({
                filename: filename,
                timestamp: Date.now()
            }));
        }
    }

    function getShareContext() {
        try {
            const stored = sessionStorage.getItem('doz_share_checkout');
            if (stored) {
                const ctx = JSON.parse(stored);
                // Only use if less than 30 minutes old
                if (Date.now() - ctx.timestamp < 30 * 60 * 1000) {
                    return ctx.filename;
                }
            }
        } catch (e) {}
        return null;
    }

    function clearShareContext() {
        sessionStorage.removeItem('doz_share_checkout');
    }

    // Plan data cache
    const planData = {
        // Monthly plans
        'starter_monthly': { name: 'Starter', price: 499, interval: 'month', badge: 'Best Value', features: ['5 GB storage', 'Links never expire', 'Desktop app'], isYearly: false },
        'pro_monthly': { name: 'Pro', price: 1499, interval: 'month', badge: 'Most Popular', features: ['Unlimited storage', 'All devices', 'Priority support'], isYearly: false },
        'team_monthly': { name: 'Team', price: 3999, interval: 'user/month', badge: 'For Teams', features: ['Everything in Pro', 'Team workspace', 'Admin dashboard'], isYearly: false },
        'enterprise_monthly': { name: 'Enterprise', price: 9999, interval: 'user/month', badge: 'Enterprise', features: ['Everything in Team', 'SSO & SAML', 'Dedicated support'], isYearly: false },
        // Yearly plans (price is full yearly amount)
        'starter_yearly': { name: 'Starter', price: 3996, interval: 'year', monthlyEquiv: 333, badge: 'Best Value', features: ['5 GB storage', 'Links never expire', 'Desktop app'], isYearly: true },
        'pro_yearly': { name: 'Pro', price: 11988, interval: 'year', monthlyEquiv: 999, badge: 'Most Popular', features: ['Unlimited storage', 'All devices', 'Priority support'], isYearly: true },
        'team_yearly': { name: 'Team', price: 35988, interval: 'year', monthlyEquiv: 2999, badge: 'For Teams', features: ['Everything in Pro', 'Team workspace', 'Admin dashboard'], isYearly: true },
        'enterprise_yearly': { name: 'Enterprise', price: 93240, interval: 'year', monthlyEquiv: 7770, badge: 'Enterprise', features: ['Everything in Team', 'SSO & SAML', 'Dedicated support'], isYearly: true }
    };

    // Load Stripe.js dynamically if not already loaded
    async function loadStripeJS() {
        if (window.Stripe) return;

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://js.stripe.com/v3/';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Initialize Stripe with public key
    async function init(publicKey) {
        if (initialized && stripe) return true;

        try {
            await loadStripeJS();

            if (!publicKey || publicKey.includes('xxxx')) {
                console.log('[DOZCheckout] Mock mode - Stripe not configured');
                return false;
            }

            stripe = window.Stripe(publicKey);
            initialized = true;
            console.log('[DOZCheckout] Initialized');
            return true;
        } catch (error) {
            console.error('[DOZCheckout] Init error:', error);
            return false;
        }
    }

    // Fetch public key from API
    async function fetchPublicKey() {
        try {
            const response = await fetch('/api/checkout/plans');
            const data = await response.json();
            return data.publicKey;
        } catch (error) {
            console.error('[DOZCheckout] Failed to fetch public key:', error);
            return null;
        }
    }

    // Create the slide-out panel once
    function createPanel() {
        if (panelCreated) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'doz-checkout-overlay';
        overlay.id = 'doz-checkout-overlay';
        overlay.onclick = () => close();
        document.body.appendChild(overlay);

        // Create panel
        const panel = document.createElement('div');
        panel.className = 'doz-inline-checkout';
        panel.id = 'doz-checkout-panel';
        document.body.appendChild(panel);

        panelCreated = true;
    }

    // Create checkout HTML for the panel
    function createCheckoutHTML(planId, plan) {
        const totalPrice = ((plan?.price || 0) / 100).toFixed(2);
        const isYearly = plan?.isYearly || planId.includes('yearly');
        const monthlyEquiv = plan?.monthlyEquiv ? ((plan.monthlyEquiv) / 100).toFixed(2) : totalPrice;
        const interval = plan?.interval || 'month';
        const planName = plan?.name || 'Selected Plan';
        const badge = plan?.badge || '';
        const features = plan?.features || [];
        const qty = plan?._quantity || 1;

        // For yearly plans, show monthly equivalent price with yearly total below
        const displayPrice = isYearly ? monthlyEquiv : totalPrice;
        // For multi-user plans, show /month instead of /user/month since total already covers all users
        let displayInterval = isYearly ? 'month' : interval;
        if (qty > 1 && displayInterval.includes('user/')) displayInterval = displayInterval.replace('user/', '');

        // Format prices with locale
        const fmtPrice = (v) => parseFloat(v).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const featuresHTML = features.map(f => `<span class="doz-plan-feature">${f}</span>`).join('');

        // Per-user price line for multi-user plans
        const perUserNote = qty > 1 ? `<div style="font-size:0.85rem;color:#10b981;margin-top:4px;">${qty} users × €${fmtPrice(plan._originalMonthlyEquiv ? plan._originalMonthlyEquiv / 100 : displayPrice / qty)}/user/month</div>` : '';

        // Yearly billing note
        const yearlyNote = isYearly ? `<div class="doz-yearly-note" style="font-size:0.85rem;color:#888;margin-top:5px;">Billed annually at €${fmtPrice(totalPrice)}</div>` : '';

        return `
            <div class="doz-inline-checkout-inner">
                <div class="doz-checkout-header">
                    <h3>Secure Checkout</h3>
                    <button class="doz-checkout-close" onclick="DOZCheckout.close()">&times;</button>
                </div>

                <div class="doz-checkout-content">
                    <!-- Plan Summary -->
                    <div class="doz-plan-summary">
                        <div class="doz-plan-summary-header">
                            <span class="doz-plan-name">${planName} Plan${isYearly ? ' (Annual)' : ''}</span>
                            ${badge ? `<span class="doz-plan-badge">${badge}</span>` : ''}
                        </div>
                        <div class="doz-plan-price">
                            <span class="amount">€${fmtPrice(displayPrice)}</span>
                            <span class="interval">/${displayInterval}</span>
                        </div>
                        ${perUserNote}
                        ${yearlyNote}
                        <div class="doz-plan-features">
                            ${featuresHTML}
                        </div>
                    </div>

                    <!-- Gift Toggle -->
                    <div class="doz-gift-toggle">
                        <label class="doz-toggle-label">
                            <input type="checkbox" id="doz-gift-toggle-${planId}" onchange="DOZCheckout.toggleGift('${planId}')">
                            <span class="doz-toggle-switch"></span>
                            <span class="doz-toggle-text">🎁 Buy as a Gift</span>
                        </label>
                    </div>

                    <div class="doz-express-checkout" id="doz-express-${planId}">
                        <div class="doz-express-label">Express Checkout</div>
                    </div>

                    <div class="doz-divider">or pay with card</div>

                    <form id="doz-form-${planId}" onsubmit="DOZCheckout.handleSubmit(event, '${planId}')">
                        <div class="doz-form-group">
                            <label>Email Address</label>
                            <input type="email" id="doz-email-${planId}" required placeholder="you@example.com">
                        </div>

                        <!-- Gift Recipient Section (hidden by default) -->
                        <div class="doz-gift-section" id="doz-gift-section-${planId}" style="display: none;">
                            <div class="doz-gift-header">
                                <span class="doz-gift-icon">🎁</span>
                                <span>Gift Recipient Details</span>
                            </div>
                            <div class="doz-form-group">
                                <label>Recipient's Name</label>
                                <input type="text" id="doz-gift-name-${planId}" placeholder="Friend's name">
                            </div>
                            <div class="doz-form-group">
                                <label>Recipient's Email</label>
                                <input type="email" id="doz-gift-email-${planId}" placeholder="friend@example.com">
                            </div>
                            <div class="doz-form-group">
                                <label>Personal Message (optional)</label>
                                <textarea id="doz-gift-message-${planId}" placeholder="Enjoy your gift!" rows="2" style="width:100%; padding:14px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:12px; color:#fff; font-family:inherit; resize:none;"></textarea>
                            </div>
                        </div>

                        <div id="doz-payment-element-${planId}" class="doz-payment-element"></div>

                        <div class="doz-order-summary">
                            <div class="doz-order-line">
                                <span>${planName} Plan${isYearly ? ' (Annual)' : ''}${qty > 1 ? ` × ${qty} users` : ''}</span>
                                <span>€${fmtPrice(displayPrice)}/${displayInterval}</span>
                            </div>
                            ${isYearly ? `<div class="doz-order-line" style="color:#888;font-size:0.9rem;"><span>Billed annually</span><span>€${fmtPrice(totalPrice)}/year</span></div>` : ''}
                            <div class="doz-order-line doz-gift-line" id="doz-gift-line-${planId}" style="display: none;">
                                <span>🎁 Gift for:</span>
                                <span id="doz-gift-recipient-${planId}">-</span>
                            </div>
                            <div class="doz-order-line doz-total">
                                <span>Total Today</span>
                                <span>€${fmtPrice(totalPrice)}</span>
                            </div>
                        </div>

                        <button type="submit" class="doz-checkout-btn" id="doz-submit-${planId}">
                            <span class="doz-btn-text">Complete Purchase →</span>
                        </button>

                        <div class="doz-payment-error" id="doz-error-${planId}"></div>

                        <div class="doz-secure-badge">
                            <span>🔒</span>
                            <span>Secured by Stripe • 256-bit SSL</span>
                        </div>

                        <div class="doz-trust-badges">
                            <div class="doz-trust-badge">
                                <span class="doz-trust-badge-icon">💳</span>
                                <span>Safe Payment</span>
                            </div>
                            <div class="doz-trust-badge">
                                <span class="doz-trust-badge-icon">↩️</span>
                                <span>30-Day Refund</span>
                            </div>
                            <div class="doz-trust-badge">
                                <span class="doz-trust-badge-icon">🚀</span>
                                <span>Instant Access</span>
                            </div>
                        </div>
                    </form>

                    <div class="doz-success-message" id="doz-success-${planId}">
                        <div class="doz-success-icon">✓</div>
                        <h3 id="doz-success-title-${planId}">Payment Successful!</h3>
                        <p id="doz-success-text-${planId}">Your subscription is now active. Redirecting...</p>
                    </div>
                </div>
            </div>
        `;
    }

    // Toggle gift mode
    function toggleGift(planId) {
        const toggle = document.getElementById(`doz-gift-toggle-${planId}`);
        const giftSection = document.getElementById(`doz-gift-section-${planId}`);
        const giftLine = document.getElementById(`doz-gift-line-${planId}`);
        const submitBtn = document.getElementById(`doz-submit-${planId}`);
        const giftNameInput = document.getElementById(`doz-gift-name-${planId}`);
        const giftEmailInput = document.getElementById(`doz-gift-email-${planId}`);

        if (toggle.checked) {
            giftSection.style.display = 'block';
            giftLine.style.display = 'flex';
            submitBtn.querySelector('.doz-btn-text').textContent = '🎁 Send Gift →';
            giftNameInput.required = true;
            giftEmailInput.required = true;

            // Update recipient display on input
            giftNameInput.addEventListener('input', () => {
                document.getElementById(`doz-gift-recipient-${planId}`).textContent =
                    giftNameInput.value || '-';
            });
        } else {
            giftSection.style.display = 'none';
            giftLine.style.display = 'none';
            submitBtn.querySelector('.doz-btn-text').textContent = 'Complete Purchase →';
            giftNameInput.required = false;
            giftEmailInput.required = false;
        }
    }

    // Open checkout panel
    async function open(planId, plan, containerId, quantity) {
        // Create panel if not exists
        createPanel();

        const panel = document.getElementById('doz-checkout-panel');
        const overlay = document.getElementById('doz-checkout-overlay');

        if (!panel) {
            console.error('[DOZCheckout] Panel not found');
            return;
        }

        // Get plan data - clone to avoid mutating shared reference
        const sourcePlan = plan || planData[planId] || { name: planId, price: 0, interval: 'month' };
        const planInfo = Object.assign({}, sourcePlan);
        const qty = quantity || 1;
        if (qty > 1) {
            planInfo._quantity = qty;
            planInfo._originalPrice = sourcePlan.price;
            planInfo._originalMonthlyEquiv = sourcePlan.monthlyEquiv;
            planInfo.price = sourcePlan.price * qty;
            if (sourcePlan.monthlyEquiv) planInfo.monthlyEquiv = sourcePlan.monthlyEquiv * qty;
            planInfo.name = sourcePlan.name + ` (${qty} users)`;
        }

        // Close any existing checkout first
        if (currentPlanId && currentPlanId !== planId) {
            cleanupStripeElements();
        }

        // Initialize if needed
        if (!initialized) {
            const publicKey = await fetchPublicKey();
            await init(publicKey);
        }

        // Create checkout HTML
        panel.innerHTML = createCheckoutHTML(planId, planInfo);

        // Show panel and overlay
        overlay.classList.add('active');
        panel.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scroll

        currentPlanId = planId;

        // Track InitiateCheckout event
        if (window.DOZPixel) {
            window.DOZPixel.trackInitiateCheckout(planId);
        }

        // If no Stripe (mock mode), just show the form
        if (!stripe) {
            return;
        }

        try {
            // Get email placeholder
            const email = 'guest@checkout.temp';

            // Get share context for checkout linking
            const shareFilename = getShareContext();

            // Create checkout session
            const response = await fetch('/api/stripe/create-inline-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    planId: planId,
                    email: email,
                    customerName: '',
                    quantity: qty || 1,
                    shareFilename: shareFilename
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to initialize checkout');
            }

            currentClientSecret = data.clientSecret;

            // Initialize Stripe Elements
            const appearance = {
                theme: 'night',
                variables: {
                    colorPrimary: '#10b981',
                    colorBackground: 'rgba(255,255,255,0.05)',
                    colorText: '#ffffff',
                    colorDanger: '#f44336',
                    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
                    borderRadius: '12px',
                    spacingUnit: '4px'
                },
                rules: {
                    '.Input': {
                        border: '1px solid rgba(255,255,255,0.1)',
                        boxShadow: 'none',
                        padding: '14px 16px'
                    },
                    '.Input:focus': {
                        border: '1px solid #10b981',
                        boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.1)'
                    },
                    '.Label': {
                        color: '#888',
                        fontSize: '0.9rem',
                        marginBottom: '8px'
                    }
                }
            };

            elements = stripe.elements({
                clientSecret: currentClientSecret,
                appearance: appearance
            });

            // Mount Payment Element
            paymentElement = elements.create('payment', {
                layout: 'tabs'
            });
            paymentElement.mount(`#doz-payment-element-${planId}`);

            // Track AddPaymentInfo when user interacts with payment form
            paymentElement.on('change', (event) => {
                if (event.complete && window.DOZPixel) {
                    window.DOZPixel.trackAddPaymentInfo(planId);
                }
            });

            // Mount Express Checkout Element
            try {
                expressCheckoutElement = elements.create('expressCheckout', {
                    buttonType: {
                        applePay: 'subscribe',
                        googlePay: 'subscribe'
                    }
                });

                expressCheckoutElement.on('confirm', async (event) => {
                    const { error } = await stripe.confirmPayment({
                        elements,
                        clientSecret: currentClientSecret,
                        confirmParams: {
                            return_url: window.location.origin + '/v2/payment/success'
                        },
                        redirect: 'if_required'
                    });

                    if (error) {
                        showError(planId, error.message);
                    } else {
                        showSuccess(planId);
                    }
                });

                expressCheckoutElement.mount(`#doz-express-${planId}`);
            } catch (e) {
                console.log('[DOZCheckout] Express checkout not available:', e.message);
                // Hide express checkout section if not available
                const expressDiv = document.getElementById(`doz-express-${planId}`);
                if (expressDiv) expressDiv.style.display = 'none';
            }

        } catch (error) {
            console.error('[DOZCheckout] Error:', error);
            showError(planId, error.message);
        }
    }

    // Cleanup Stripe elements
    function cleanupStripeElements() {
        if (paymentElement) {
            paymentElement.destroy();
            paymentElement = null;
        }
        if (expressCheckoutElement) {
            expressCheckoutElement.destroy();
            expressCheckoutElement = null;
        }
        elements = null;
        currentClientSecret = null;
    }

    // Close checkout panel
    function close() {
        const panel = document.getElementById('doz-checkout-panel');
        const overlay = document.getElementById('doz-checkout-overlay');

        if (panel) panel.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore scroll

        // Cleanup Stripe elements
        cleanupStripeElements();
        currentPlanId = null;
    }

    // Handle form submission
    async function handleSubmit(event, planId) {
        event.preventDefault();

        const submitBtn = document.getElementById(`doz-submit-${planId}`);
        const emailInput = document.getElementById(`doz-email-${planId}`);
        const email = emailInput?.value;

        if (!email) {
            showError(planId, 'Please enter your email address');
            return;
        }

        // Check if this is a gift purchase
        const isGift = document.getElementById(`doz-gift-toggle-${planId}`)?.checked;
        let giftData = null;

        if (isGift) {
            const recipientName = document.getElementById(`doz-gift-name-${planId}`)?.value;
            const recipientEmail = document.getElementById(`doz-gift-email-${planId}`)?.value;
            const giftMessage = document.getElementById(`doz-gift-message-${planId}`)?.value;

            if (!recipientName || !recipientEmail) {
                showError(planId, 'Please enter recipient name and email');
                return;
            }

            giftData = {
                recipientName,
                recipientEmail,
                message: giftMessage || ''
            };
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="doz-spinner"></span> Processing...';
        hideError(planId);

        try {
            // Mock mode
            if (!stripe || !elements) {
                const response = await fetch('/api/checkout/simulate-success', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: btoa(email).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16),
                        planId: planId,
                        email: email,
                        customerName: '',
                        isGift: isGift,
                        giftData: giftData
                    })
                });
                const result = await response.json();
                if (result.success) {
                    showSuccess(planId, isGift, giftData);
                } else {
                    throw new Error(result.error || 'Payment failed');
                }
                return;
            }

            // Confirm payment with Stripe
            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    receipt_email: email,
                    return_url: window.location.origin + '/v2/payment/success?plan=' + planId + (isGift ? '&gift=1' : '')
                },
                redirect: 'if_required'
            });

            if (error) {
                throw new Error(error.message);
            }

            if (paymentIntent && paymentIntent.status === 'succeeded') {
                // Store gift data for backend processing
                if (isGift && giftData) {
                    await fetch('/api/stripe/process-gift', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            paymentIntentId: paymentIntent.id,
                            planId: planId,
                            buyerEmail: email,
                            giftData: giftData
                        })
                    });
                }
                showSuccess(planId, isGift, giftData);
            }

        } catch (error) {
            showError(planId, error.message);
        } finally {
            submitBtn.disabled = false;
            const btnText = isGift ? '🎁 Send Gift →' : 'Complete Purchase →';
            submitBtn.innerHTML = `<span class="doz-btn-text">${btnText}</span>`;
        }
    }

    function showError(planId, message) {
        const errorEl = document.getElementById(`doz-error-${planId}`);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add('show');
        }
    }

    function hideError(planId) {
        const errorEl = document.getElementById(`doz-error-${planId}`);
        if (errorEl) {
            errorEl.classList.remove('show');
        }
    }

    function showSuccess(planId, isGift = false, giftData = null) {
        const formEl = document.getElementById(`doz-form-${planId}`);
        const successEl = document.getElementById(`doz-success-${planId}`);
        const expressEl = document.getElementById(`doz-express-${planId}`);
        const dividerEl = formEl?.previousElementSibling;
        const giftToggleEl = document.querySelector(`#doz-gift-toggle-${planId}`)?.closest('.doz-gift-toggle');
        const planSummary = document.querySelector('.doz-plan-summary');

        // Track Purchase conversion
        if (window.DOZPixel) {
            window.DOZPixel.trackPurchase(planId);
        }

        if (formEl) formEl.style.display = 'none';
        if (expressEl) expressEl.style.display = 'none';
        if (giftToggleEl) giftToggleEl.style.display = 'none';
        if (planSummary) planSummary.style.display = 'none';
        if (dividerEl && dividerEl.classList.contains('doz-divider')) {
            dividerEl.style.display = 'none';
        }

        // Update success message for gift purchases
        if (isGift && giftData) {
            const titleEl = document.getElementById(`doz-success-title-${planId}`);
            const textEl = document.getElementById(`doz-success-text-${planId}`);
            if (titleEl) titleEl.textContent = '🎁 Gift Sent!';
            if (textEl) textEl.textContent = `Your gift is on its way to ${giftData.recipientName}!`;
        }

        if (successEl) successEl.classList.add('show');

        // Redirect after delay
        setTimeout(() => {
            const giftParam = isGift ? '&gift=1' : '';
            window.location.href = '/v2/payment/success?plan=' + planId + giftParam;
        }, 2500);
    }

    // Public API
    return {
        init,
        open,
        close,
        handleSubmit,
        toggleGift,
        // Share context functions for /i/ link checkout
        setShareContext,
        getShareContext,
        clearShareContext
    };
})();

// Global function to open checkout (for onclick handlers)
function openInlineCheckout(planId, buttonEl, quantity) {
    DOZCheckout.open(planId, null, null, quantity || 1);
}
