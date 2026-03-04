'use strict';

/**
 * csrf.js — Double-Submit Cookie CSRF Protection
 *
 * Strategy: stateless double-submit cookie pattern.
 *   1. csrfCookieMiddleware  — sets a csrf_token cookie (not HttpOnly so JS can read it).
 *   2. csrfProtection        — verifies that the x-csrf-token header matches the cookie.
 *
 * Skipped for:
 *   - Safe methods:  GET, HEAD, OPTIONS
 *   - Webhook paths: /webhook, /stripe/webhook, /api/webhook/*
 *   - API-key authenticated requests (x-api-key header present)
 *
 * Uses crypto.timingSafeEqual to avoid timing-attack vulnerabilities.
 *
 * Usage in gateway.js:
 *   const { csrfCookieMiddleware, csrfProtection } = require('./src/middleware/csrf');
 *   app.use(csrfCookieMiddleware);   // must run after cookie-parser
 *   app.use(csrfProtection);         // applies to all state-changing requests
 */

const crypto = require('crypto');

const CSRF_COOKIE_NAME  = 'csrf_token';
const CSRF_HEADER_NAME  = 'x-csrf-token';
const CSRF_TOKEN_BYTES  = 32; // produces a 64-character hex string

// Routes that should never require CSRF (webhook receivers)
const WEBHOOK_PATH_PATTERNS = [
    /^\/webhook/i,
    /^\/stripe\/webhook/i,
    /^\/api\/webhook/i,
];

// ---------------------------------------------------------------------------
// generateCsrfToken — internal helper
// ---------------------------------------------------------------------------
function generateCsrfToken() {
    return crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');
}

// ---------------------------------------------------------------------------
// csrfCookieMiddleware
// Sets (or reads) the csrf_token cookie and stores the value at req.csrfToken
// so route handlers can embed it in rendered HTML if needed.
// ---------------------------------------------------------------------------
function csrfCookieMiddleware(req, res, next) {
    const isProduction = process.env.NODE_ENV === 'production';
    const existing     = req.cookies && req.cookies[CSRF_COOKIE_NAME];

    if (!existing) {
        const token = generateCsrfToken();
        res.cookie(CSRF_COOKIE_NAME, token, {
            httpOnly: false,               // must be readable by JS
            secure:   isProduction,
            sameSite: 'strict',
            maxAge:   24 * 60 * 60 * 1000, // 24 hours
            path:     '/',
        });
        req.csrfToken = token;
    } else {
        req.csrfToken = existing;
    }

    return next();
}

// ---------------------------------------------------------------------------
// csrfProtection
// Rejects state-changing requests that lack a matching x-csrf-token header.
// ---------------------------------------------------------------------------
function csrfProtection(req, res, next) {
    // 1. Safe HTTP methods — skip
    const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
    if (SAFE_METHODS.includes(req.method)) {
        return next();
    }

    // 2. Webhook routes — skip (Stripe/payment webhooks use their own signature verification)
    const reqPath = req.path || '';
    if (WEBHOOK_PATH_PATTERNS.some((re) => re.test(reqPath))) {
        return next();
    }

    // 3. API-key authenticated requests — skip CSRF (server-to-server calls can't set cookies)
    if (req.headers['x-api-key']) {
        return next();
    }

    // 4. Verify double-submit cookie
    const headerToken = req.headers[CSRF_HEADER_NAME];
    const cookieToken = req.cookies && req.cookies[CSRF_COOKIE_NAME];

    if (!headerToken || !cookieToken) {
        return res.status(403).json({
            error: 'CSRF token missing',
            code:  'CSRF_TOKEN_MISSING',
        });
    }

    // Pad both to equal length before timingSafeEqual — different lengths always fail anyway
    // but the check must not leak length information via short-circuit.
    const headerBuf = Buffer.from(headerToken, 'utf8');
    const cookieBuf = Buffer.from(cookieToken, 'utf8');

    if (
        headerBuf.length !== cookieBuf.length ||
        !crypto.timingSafeEqual(headerBuf, cookieBuf)
    ) {
        return res.status(403).json({
            error: 'CSRF token mismatch',
            code:  'CSRF_TOKEN_MISMATCH',
        });
    }

    return next();
}

/**
 * GET /auth/csrf-token — convenience route to expose the token to SPA clients.
 *
 * Usage in gateway.js:
 *   app.get('/auth/csrf-token', csrfCookieMiddleware, csrfTokenRoute);
 */
function csrfTokenRoute(req, res) {
    return res.json({ csrfToken: req.csrfToken });
}

module.exports = { csrfCookieMiddleware, csrfProtection, csrfTokenRoute, generateCsrfToken };
