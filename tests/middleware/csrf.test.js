'use strict';

/**
 * tests/middleware/csrf.test.js
 *
 * Unit tests for src/middleware/csrf.js.
 * Tests both csrfProtection (the guard) and csrfCookieMiddleware (the token setter).
 *
 * Covers:
 *   - GET requests bypass CSRF protection (safe methods)
 *   - POST without CSRF token returns 403
 *   - POST with matching CSRF cookie and header passes
 *   - Webhook paths bypass CSRF
 *   - API-key authenticated requests bypass CSRF
 *   - Mismatched cookie/header token returns 403
 */

const {
  csrfProtection,
  csrfCookieMiddleware,
  generateCsrfToken,
} = require('../../src/middleware/csrf');

const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

// ── Constant used across tests ─────────────────────────────────────────────────────────────────────
const VALID_TOKEN  = 'a'.repeat(64); // simulates a 64-char hex CSRF token
const OTHER_TOKEN  = 'b'.repeat(64); // different token to trigger mismatch

// ── csrfProtection ────────────────────────────────────────────────────────────────────────────────

describe('csrfProtection — safe HTTP methods bypass', () => {
  test.each(['GET', 'HEAD', 'OPTIONS'])(
    '%s requests are allowed through without a CSRF token',
    (method) => {
      const req  = createMockRequest({ method });
      const res  = createMockResponse();
      const next = createMockNext();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  );
});

describe('csrfProtection — POST without CSRF token', () => {
  test('returns 403 when x-csrf-token header is absent', () => {
    const req  = createMockRequest({
      method:  'POST',
      path:    '/api/users',
      cookies: { csrf_token: VALID_TOKEN },
      headers: {}, // no x-csrf-token header
    });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfProtection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CSRF_TOKEN_MISSING' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 when csrf_token cookie is absent', () => {
    const req  = createMockRequest({
      method:  'POST',
      path:    '/api/users',
      cookies: {}, // no csrf_token cookie
      headers: { 'x-csrf-token': VALID_TOKEN },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfProtection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CSRF_TOKEN_MISSING' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('csrfProtection — token match and mismatch', () => {
  test('POST with matching cookie and header passes (calls next)', () => {
    const req  = createMockRequest({
      method:  'POST',
      path:    '/api/users',
      cookies: { csrf_token: VALID_TOKEN },
      headers: { 'x-csrf-token': VALID_TOKEN },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 403 when header token does not match cookie token', () => {
    const req  = createMockRequest({
      method:  'POST',
      path:    '/api/screenshots',
      cookies: { csrf_token: VALID_TOKEN },
      headers: { 'x-csrf-token': OTHER_TOKEN }, // different!
    });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfProtection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CSRF_TOKEN_MISMATCH' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('PUT and PATCH are also protected by CSRF', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const req  = createMockRequest({
        method,
        path:    '/api/screenshots/1',
        cookies: {},
        headers: {},
      });
      const res  = createMockResponse();
      const next = createMockNext();

      csrfProtection(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });
});

describe('csrfProtection — webhook paths bypass', () => {
  test.each([
    '/webhook',
    '/webhook/stripe',
    '/stripe/webhook',
    '/api/webhook/payment',
  ])(
    'POST to "%s" bypasses CSRF (no token required)',
    (webhookPath) => {
      const req  = createMockRequest({
        method:  'POST',
        path:    webhookPath,
        cookies: {}, // deliberately empty — webhooks don't send cookies
        headers: {},
      });
      const res  = createMockResponse();
      const next = createMockNext();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  );
});

describe('csrfProtection — API-key requests bypass', () => {
  test('POST with x-api-key header bypasses CSRF (server-to-server)', () => {
    const req  = createMockRequest({
      method:  'POST',
      path:    '/api/screenshots',
      cookies: {}, // no CSRF cookie
      headers: { 'x-api-key': 'doz_api_key_abc123' }, // API key present
    });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── csrfCookieMiddleware ─────────────────────────────────────────────────────────────────────────────

describe('csrfCookieMiddleware', () => {
  test('sets a csrf_token cookie and req.csrfToken when no existing cookie is present', () => {
    const req  = createMockRequest({ cookies: {} });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfCookieMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.csrfToken).toBeDefined();
    expect(typeof req.csrfToken).toBe('string');
    expect(req.csrfToken.length).toBeGreaterThan(0);
    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.objectContaining({ httpOnly: false })
    );
  });

  test('reuses the existing csrf_token cookie value without setting a new cookie', () => {
    const existingToken = VALID_TOKEN;
    const req  = createMockRequest({ cookies: { csrf_token: existingToken } });
    const res  = createMockResponse();
    const next = createMockNext();

    csrfCookieMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.csrfToken).toBe(existingToken);
    // The cookie should NOT be re-set since it already exists
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

// ── generateCsrfToken ──────────────────────────────────────────────────────────────────────────────

describe('generateCsrfToken()', () => {
  test('generates a 64-character hex string', () => {
    const token = generateCsrfToken();
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test('generates unique tokens on each call', () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });
});
