'use strict';

/**
 * tests/helpers.js
 *
 * Shared test utilities.  Import from any test file:
 *
 *   const { createMockRequest, createMockResponse, createMockNext, generateTestToken }
 *     = require('../helpers');
 */

const crypto = require('crypto');

// ── createMockRequest ──────────────────────────────────────────────────────────────────────────────
/**
 * Returns a minimal mock Express `req` object.
 *
 * @param {object} [overrides]  — any fields to merge / override on the base object
 * @returns {object}
 *
 * @example
 * const req = createMockRequest({
 *   headers: { authorization: 'Bearer abc123' },
 *   body: { email: 'a@b.com' },
 * });
 */
function createMockRequest(overrides = {}) {
  return {
    method:  'GET',
    path:    '/',
    url:     '/',
    headers: {},
    body:    {},
    params:  {},
    query:   {},
    cookies: {},
    user:    null,
    ...overrides,
    // Deep-merge headers so callers can add individual headers without losing defaults
    headers: Object.assign({}, overrides.headers || {}),
  };
}

// ── createMockResponse ────────────────────────────────────────────────────────────────────────────
/**
 * Returns a mock Express `res` object where every chainable method is a jest.fn().
 * Methods that are conventionally chainable (status, setHeader, cookie) return `this`.
 *
 * @returns {{ json: jest.Mock, status: jest.Mock, send: jest.Mock,
 *             cookie: jest.Mock, setHeader: jest.Mock, _status: number }}
 *
 * @example
 * const res = createMockResponse();
 * middleware(req, res, next);
 * expect(res.status).toHaveBeenCalledWith(401);
 * expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
 */
function createMockResponse() {
  const res = {
    _status:    200,
    json:       jest.fn(),
    send:       jest.fn(),
    status:     jest.fn(),
    cookie:     jest.fn(),
    setHeader:  jest.fn(),
  };

  // Make status() chainable — `res.status(401).json(...)` should work
  res.status.mockImplementation((code) => {
    res._status = code;
    return res;
  });

  // Make cookie() and setHeader() chainable too
  res.cookie.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);

  return res;
}

// ── createMockNext ────────────────────────────────────────────────────────────────────────────────────
/**
 * Returns a plain jest.fn() suitable for use as Express `next`.
 *
 * @returns {jest.Mock}
 */
function createMockNext() {
  return jest.fn();
}

// ── generateTestToken ───────────────────────────────────────────────────────────────────────────────
/**
 * Generates a valid token using the **same custom HMAC-based scheme** that
 * `services/security.js` uses, signed with the fixed test JWT_SECRET.
 *
 * This means tokens generated here will pass `securityService.verifyToken()`.
 *
 * @param {object} [payload]   — custom payload fields (merged with defaults)
 * @param {number} [expiresIn] — token lifetime in ms (default: 24 h)
 * @returns {string}
 *
 * @example
 * const token = generateTestToken({ userId: 'u_123', role: 'admin' });
 * const req   = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
 */
function generateTestToken(payload = {}, expiresIn = 24 * 60 * 60 * 1000) {
  const secret = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';

  const header = { alg: 'HS256', typ: 'JWT' };
  const now    = Date.now();

  const tokenPayload = {
    userId: 'test-user-id',
    role:   'user',
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const headerB64  = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

module.exports = {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
};
