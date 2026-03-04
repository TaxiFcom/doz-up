/**
 * DOZ UP - Meta Pixel (Facebook Pixel) Integration
 * Comprehensive conversion tracking for all pages
 *
 * Events tracked:
 * - PageView: All pages
 * - ViewContent: Pricing/product pages
 * - InitiateCheckout: When user clicks buy button
 * - AddPaymentInfo: When user enters payment details
 * - Purchase: When payment completes successfully
 * - Lead: When user signs up or subscribes to newsletter
 */

(function() {
    'use strict';

    // ============================================
    // CONFIGURATION - Set via window.META_PIXEL_ID or environment
    // ============================================
    const PIXEL_ID = window.META_PIXEL_ID || 'YOUR_PIXEL_ID';

    // Plan pricing data for tracking
    const PLAN_DATA = {
        'starter_monthly': { name: 'Starter Monthly', value: 3.33, currency: 'USD' },
        'starter_yearly': { name: 'Starter Yearly', value: 39.96, currency: 'USD' },
        'pro_monthly': { name: 'Pro Monthly', value: 14.99, currency: 'USD' },
        'pro_yearly': { name: 'Pro Yearly', value: 119.88, currency: 'USD' },
        'team_monthly': { name: 'Team Monthly', value: 29.99, currency: 'EUR' },
        'team_yearly': { name: 'Team Yearly', value: 359.88, currency: 'EUR' },
        'business_monthly': { name: 'Enterprise Monthly', value: 77.70, currency: 'EUR' },
        'business_yearly': { name: 'Enterprise Yearly', value: 932.40, currency: 'EUR' },
        'lifetime': { name: 'Lifetime Pro', value: 99.00, currency: 'USD' }
    };

    // ============================================
    // META PIXEL BASE CODE
    // ============================================
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');

    // Initialize pixel
    if (PIXEL_ID && PIXEL_ID !== 'YOUR_PIXEL_ID') {
        fbq('init', PIXEL_ID);
        fbq('track', 'PageView');
        console.log('[MetaPixel] Initialized with ID:', PIXEL_ID);
    } else {
        console.log('[MetaPixel] No Pixel ID configured - tracking disabled');
    }

    // ============================================
    // TRACKING FUNCTIONS
    // ============================================

    /**
     * Track ViewContent - when user views a product/pricing page
     */
    function trackViewContent(contentName, contentCategory, value, currency) {
        if (typeof fbq === 'undefined') return;

        fbq('track', 'ViewContent', {
            content_name: contentName || document.title,
            content_category: contentCategory || 'Pricing',
            value: value || 0,
            currency: currency || 'USD'
        });
        console.log('[MetaPixel] ViewContent:', contentName);
    }

    /**
     * Track InitiateCheckout - when user clicks buy/subscribe button
     */
    function trackInitiateCheckout(planId, value, currency, numItems) {
        if (typeof fbq === 'undefined') return;

        const plan = PLAN_DATA[planId] || { name: planId, value: value || 0, currency: currency || 'USD' };

        fbq('track', 'InitiateCheckout', {
            content_name: plan.name,
            content_ids: [planId],
            content_type: 'product',
            value: plan.value,
            currency: plan.currency,
            num_items: numItems || 1
        });
        console.log('[MetaPixel] InitiateCheckout:', planId, plan.value, plan.currency);

        // Also send to Google Analytics if available
        if (typeof gtag !== 'undefined') {
            gtag('event', 'begin_checkout', {
                currency: plan.currency,
                value: plan.value,
                items: [{ item_id: planId, item_name: plan.name, price: plan.value }]
            });
        }
    }

    /**
     * Track AddPaymentInfo - when user enters payment details
     */
    function trackAddPaymentInfo(planId, value, currency) {
        if (typeof fbq === 'undefined') return;

        const plan = PLAN_DATA[planId] || { name: planId, value: value || 0, currency: currency || 'USD' };

        fbq('track', 'AddPaymentInfo', {
            content_name: plan.name,
            content_ids: [planId],
            content_type: 'product',
            value: plan.value,
            currency: plan.currency
        });
        console.log('[MetaPixel] AddPaymentInfo:', planId);
    }

    /**
     * Track Purchase - when payment completes successfully
     */
    function trackPurchase(planId, value, currency, transactionId) {
        if (typeof fbq === 'undefined') return;

        const plan = PLAN_DATA[planId] || { name: planId, value: value || 0, currency: currency || 'USD' };

        fbq('track', 'Purchase', {
            content_name: plan.name,
            content_ids: [planId],
            content_type: 'product',
            value: plan.value,
            currency: plan.currency,
            transaction_id: transactionId || generateTransactionId()
        });
        console.log('[MetaPixel] Purchase:', planId, plan.value, plan.currency);

        // Also send to Google Analytics if available
        if (typeof gtag !== 'undefined') {
            gtag('event', 'purchase', {
                transaction_id: transactionId || generateTransactionId(),
                currency: plan.currency,
                value: plan.value,
                items: [{ item_id: planId, item_name: plan.name, price: plan.value }]
            });
        }
    }

    /**
     * Track Lead - newsletter signup, free trial, etc.
     */
    function trackLead(leadType, value, currency) {
        if (typeof fbq === 'undefined') return;

        fbq('track', 'Lead', {
            content_name: leadType || 'Newsletter Signup',
            value: value || 0,
            currency: currency || 'USD'
        });
        console.log('[MetaPixel] Lead:', leadType);
    }

    /**
     * Track CompleteRegistration - when user creates account
     */
    function trackCompleteRegistration(method, value, currency) {
        if (typeof fbq === 'undefined') return;

        fbq('track', 'CompleteRegistration', {
            content_name: method || 'Email',
            value: value || 0,
            currency: currency || 'USD'
        });
        console.log('[MetaPixel] CompleteRegistration:', method);
    }

    /**
     * Track custom events
     */
    function trackCustomEvent(eventName, params) {
        if (typeof fbq === 'undefined') return;

        fbq('trackCustom', eventName, params || {});
        console.log('[MetaPixel] Custom:', eventName, params);
    }

    /**
     * Generate unique transaction ID
     */
    function generateTransactionId() {
        return 'DOZ-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    // ============================================
    // AUTO-TRACKING SETUP
    // ============================================

    // Track ViewContent on pricing pages
    function autoTrackViewContent() {
        const path = window.location.pathname;
        const pricingPages = ['/order', '/checkout', '/pricing', '/lp/', '/landing', '/pay'];

        if (pricingPages.some(p => path.includes(p))) {
            trackViewContent('Pricing Page', 'Pricing', 9.99, 'USD');
        }
    }

    // Auto-track when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoTrackViewContent);
    } else {
        autoTrackViewContent();
    }

    // ============================================
    // EXPOSE GLOBAL API
    // ============================================
    window.DOZPixel = {
        trackViewContent,
        trackInitiateCheckout,
        trackAddPaymentInfo,
        trackPurchase,
        trackLead,
        trackCompleteRegistration,
        trackCustomEvent,
        PLAN_DATA
    };

    // Also expose as MetaPixel for convenience
    window.MetaPixel = window.DOZPixel;

})();
