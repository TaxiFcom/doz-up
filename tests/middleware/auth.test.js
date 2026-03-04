'use strict';

/**
 * tests/middleware/auth.test.js
 *
 * Unit tests for src/middleware/auth.js.
 * All external service dependencies are mocked so these tests run without a
 * real database, Redis instance, or file system.
 *
 * Covers:
 *   - requireAuth: no token → 401
 *   - requireAuth: invalid token → 401
 *   - requireAuth: valid token → calls next() and populates req.user
 *   - requireAdmin: no Authorization header → 401
 *   - optionalAuth: no token → still calls next() (req.user = null)
 */

const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
} = require('../helpers');

// ── Mock external services before requiring the middleware ─────────────────────────────────────────

// securityService.verifyToken is the only function requireAuth / optionalAuth use.
const mockVerifyToken = jest.fn();
jest.mock('../../services/security', () => ({
  verifyToken: mockVerifyToken,
}));

// adminService is used only by requireAdmin.
const mockValidateAdminSession = jest.fn();
const mockHasPermission        = jest.fn(() => true);
jest.mock('../../services/admin', () => ({
  validateAdminSession: mockValidateAdminSession,
  hasPermission:        mockHasPermission,
}));

// Mock fs so no disk I/O happens (admin-settings.json lookup)
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => false), // pretend admin-settings.json doesn't exist
}));

// Now safe to require the middleware
const { requireAuth, requireAdmin, optionalAuth } = require('../../src/middleware/auth');

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

/** Helper that runs middleware and returns a promise resolving to { req, res, nextCalled }. */
function runMiddleware(middleware, reqOverrides = {}) {
  return new Promise((resolve) => {
    const req  = createMockRequest(reqOverrides);
    const res  = createMockResponse();
    const next = createMockNext();

    next.mockImplementation(() => resolve({ req, res, next, nextCalled: true }));

    const result = middleware(req, res, next);

    // If next was NOT called the middleware resolved synchronously via res.status().json()
    if (!next.mock.calls.length) {
      resolve({ req, res, next, nextCalled: false });
    }
  });
}

// ── requireAuth ──────────────────────────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when no Authorization header is present', () => {
    const req  = createMockRequest(); // no headers
    const res  = createMockResponse();
    const next = createMockNext();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TOKEN_MISSING' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header is present but token is invalid', () => {
    // securityService.verifyToken returns null for bad tokens
    mockVerifyToken.mockReturnValue(null);

    const req  = createMockRequest({
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TOKEN_INVALID' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() and sets req.user when token is valid', () => {
    const fakePayload = { userId: 'u_001', role: 'user', exp: Date.now() + 60000 };
    mockVerifyToken.mockReturnValue(fakePayload);

    const token = generateTestToken({ userId: 'u_001' });
    const req   = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(fakePayload);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── requireAdmin ───────────────────────────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when no Authorization header is present', () => {
    const middleware = requireAdmin();

    const req  = createMockRequest(); // no auth header
    const res  = createMockResponse();
    const next = createMockNext();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header is present but admin session is invalid', () => {
    mockValidateAdminSession.mockReturnValue(null); // invalid session

    const middleware = requireAdmin();
    const req  = createMockRequest({
      headers: { authorization: 'Bearer bad-admin-token' },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() and sets req.admin when admin session is valid', () => {
    const fakeAdmin   = { id: 'admin_1', email: 'admin@doz.com', role: 'admin' };
    const fakeSession = { id: 'sess_1', createdAt: Date.now() };
    mockValidateAdminSession.mockReturnValue({ admin: fakeAdmin, session: fakeSession });

    const middleware = requireAdmin();
    const req  = createMockRequest({
      headers: { authorization: 'Bearer valid-admin-token' },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toEqual(fakeAdmin);
    expect(req.session).toEqual(fakeSession);
  });
});

// ── optionalAuth ──────────────────────────────────────────────────────────────────────────────────

describe('optionalAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls next() with req.user = null when no token is provided', () => {
    const req  = createMockRequest(); // no Authorization header
    const res  = createMockResponse();
    const next = createMockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeNull();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next() with req.user = null when an invalid token is provided', () => {
    mockVerifyToken.mockReturnValue(null); // invalid token

    const req  = createMockRequest({
      headers: { authorization: 'Bearer broken.token' },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeNull();
  });

  test('calls next() with req.user populated when a valid token is provided', () => {
    const fakePayload = { userId: 'u_002', role: 'user' };
    mockVerifyToken.mockReturnValue(fakePayload);

    const token = generateTestToken({ userId: 'u_002' });
    const req   = createMockRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const res  = createMockResponse();
    const next = createMockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(fakePayload);
  });
});
