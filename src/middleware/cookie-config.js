'use strict';

/**
 * cookie-config.js — Secure Cookie Defaults & Helpers
 *
 * Problems addressed:
 *   - server.js line 458: doz_session cookie set without httpOnly or secure flags.
 *   - Scattered res.cookie() calls throughout gateway.js lack consistent security options.
 *
 * Exports:
 *   setSecureCookie(res, name, value, opts) — sets a cookie with secure defaults
 *   clearSecureCookie(res, name)            — clears a cookie using matching options
 *   SESSION_COOKIE_OPTIONS                  — reusable options object for session cookies
 *
 * Usage in server.js / gateway.js:
 *   const { setSecureCookie, SESSION_COOKIE_OPTIONS } = require('./src/middleware/cookie-config');
 *
 *   // Fix for server.js:458 — replace the raw Set-Cookie header with:
 *   setSecureCookie(res, 'doz_session', sessionId, { maxAge: 86400000 });
 */

const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// SESSION_COOKIE_OPTIONS
// Reusable secure defaults for the doz_session cookie.
// Mirrors the manual cookie at server.js:458 but adds httpOnly + secure.
// ---------------------------------------------------------------------------
const SESSION_COOKIE_OPTIONS = Object.freeze({
    httpOnly: true,                          // not accessible via document.cookie
    secure:   IS_PROD,                       // HTTPS-only in production
    sameSite: IS_PROD ? 'strict' : 'lax',   // CSRF mitigation
    path:     '/',
    maxAge:   86400000,                      // 24 hours in milliseconds
});

// ---------------------------------------------------------------------------
// setSecureCookie
// Sets a cookie with secure defaults merged with any caller-supplied options.
//
// @param {import('express').Response} res
// @param {string} name   — cookie name
// @param {string} value  — cookie value
// @param {object} opts   — overrides merged on top of the secure defaults
// ---------------------------------------------------------------------------
function setSecureCookie(res, name, value, opts = {}) {
    const options = {
        httpOnly: true,
        secure:   IS_PROD,
        sameSite: IS_PROD ? 'strict' : 'lax',
        path:     '/',
        maxAge:   86400000, // 24 hours default
        ...opts,            // caller overrides (e.g. shorter maxAge for access tokens)
    };
    res.cookie(name, value, options);
}

// ---------------------------------------------------------------------------
// clearSecureCookie
// Expires a cookie using the same path/domain/secure flags it was created with.
// Avoids the "cookie won't clear" bug caused by mismatched options.
//
// @param {import('express').Response} res
// @param {string} name — cookie name
// ---------------------------------------------------------------------------
function clearSecureCookie(res, name) {
    res.clearCookie(name, {
        httpOnly: true,
        secure:   IS_PROD,
        sameSite: IS_PROD ? 'strict' : 'lax',
        path:     '/',
    });
}

// ---------------------------------------------------------------------------
// Preset options for specific cookie types
// ---------------------------------------------------------------------------

/** Short-lived access token cookie (15 minutes). */
const ACCESS_TOKEN_COOKIE_OPTIONS = Object.freeze({
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? 'strict' : 'lax',
    path:     '/',
    maxAge:   15 * 60 * 1000, // 15 minutes
});

/** Long-lived refresh token cookie (7 days). */
const REFRESH_TOKEN_COOKIE_OPTIONS = Object.freeze({
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? 'strict' : 'lax',
    path:     '/auth',       // scoped to the auth endpoints only
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
});

module.exports = {
    setSecureCookie,
    clearSecureCookie,
    SESSION_COOKIE_OPTIONS,
    ACCESS_TOKEN_COOKIE_OPTIONS,
    REFRESH_TOKEN_COOKIE_OPTIONS,
};
