'use strict';

/**
 * security-headers.js — Helmet-based HTTP Security Headers
 *
 * Configures helmet with settings appropriate for DOZ UP:
 *   - Content Security Policy allowing self, data:, blob: for img-src (screenshot platform)
 *     and Stripe domains for scripts/frames
 *   - HSTS with 1-year max-age + preload
 *   - X-Powered-By removed
 *
 * Usage in gateway.js:
 *   const { securityHeaders } = require('./src/middleware/security-headers');
 *   app.use(securityHeaders());
 */

const helmet = require('helmet');

// Trusted external domains used by DOZ UP
const CDN_URL  = process.env.CDN_URL  || 'https://cdn.doz-up.com';
const S3_URL   = process.env.S3_URL   || 'https://*.s3.amazonaws.com';
const API_URL  = process.env.API_URL  || "'self'";

/**
 * Returns a pre-configured helmet middleware stack for DOZ UP.
 * Calling it as a function allows future parameterisation (e.g. nonce injection).
 *
 * @returns {Function} Express middleware
 */
function securityHeaders() {
    return helmet({

        // --- Content Security Policy -------------------------------------------
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],

                // Scripts: self + Stripe (payment) — no unsafe-inline
                scriptSrc: [
                    "'self'",
                    'https://js.stripe.com',
                    'https://*.stripe.com',
                ],

                // Styles: allow inline (common with component frameworks)
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    'https://fonts.googleapis.com',
                ],

                // Fonts
                fontSrc: [
                    "'self'",
                    'https://fonts.gstatic.com',
                    CDN_URL,
                ],

                // Images: allow data: and blob: for screenshot previews
                imgSrc: [
                    "'self'",
                    'data:',   // base64-encoded inline images
                    'blob:',   // local object URLs (screenshot preview canvas)
                    CDN_URL,
                    S3_URL,
                    'https://', // screenshots rendered from arbitrary URLs
                ],

                // Fetch / XHR / WebSocket
                connectSrc: [
                    "'self'",
                    CDN_URL,
                    'https://api.stripe.com',
                    API_URL,
                ],

                // Frames: Stripe payment elements only
                frameSrc: [
                    "'self'",
                    'https://js.stripe.com',
                    'https://hooks.stripe.com',
                    'https://*.stripe.com',
                ],

                // Media
                mediaSrc: ["'self'", CDN_URL],

                // Prevent clickjacking by disallowing external frame ancestors
                frameAncestors: ["'none'"],

                // Upgrade plain HTTP sub-requests to HTTPS
                upgradeInsecureRequests: [],

                // Restrict <base> tag hijacking
                baseUri: ["'self'"],

                // Forms may only submit to same origin
                formAction: ["'self'"],
            },

            // Enable enforce mode in production; report-only in dev for easier debugging
            reportOnly: process.env.NODE_ENV !== 'production',
        },

        // --- HTTP Strict Transport Security ------------------------------------
        hsts: {
            maxAge:            31536000, // 1 year in seconds
            includeSubDomains: true,
            preload:           true,
        },

        // --- Hide server fingerprint -------------------------------------------
        hidePoweredBy: true, // removes X-Powered-By: Express

        // --- Other helmet defaults (all enabled unless noted) ------------------
        noSniff:        true,            // X-Content-Type-Options: nosniff
        xssFilter:      true,            // X-XSS-Protection (legacy browsers)
        frameguard:     { action: 'deny' }, // X-Frame-Options: DENY

        // Disable COEP — DOZ UP loads third-party images for screenshots
        crossOriginEmbedderPolicy: false,

        // Allow cross-origin loading of public media assets
        crossOriginResourcePolicy: { policy: 'cross-origin' },

        crossOriginOpenerPolicy: { policy: 'same-origin' },
    });
}

/**
 * Optional Permissions-Policy header (not included in helmet automatically).
 * Add app.use(permissionsPolicy) after securityHeaders() if desired.
 */
function permissionsPolicy(req, res, next) {
    res.setHeader(
        'Permissions-Policy',
        [
            'camera=()',
            'microphone=()',
            'geolocation=()',
            'payment=(self)',
            'usb=()',
        ].join(', ')
    );
    return next();
}

module.exports = { securityHeaders, permissionsPolicy };
