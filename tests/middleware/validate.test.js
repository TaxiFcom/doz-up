'use strict';

/**
 * tests/middleware/validate.test.js
 *
 * Unit tests for src/middleware/validate.js.
 * No external services are involved — the middleware is a pure Zod wrapper.
 *
 * Covers:
 *   - Valid body passes validation and calls next()
 *   - Invalid body returns 422 with a field-level error map
 *   - Missing required fields return 422
 *   - Query-string validation with z.coerce works correctly
 */

const { z }                      = require('zod');
const { validate, validateBody, validateQuery } = require('../../src/middleware/validate');
const { createMockRequest, createMockResponse, createMockNext } = require('../helpers');

// ── Schemas used across tests ────────────────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
});

const RegisterSchema = z.object({
  email:    z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
});

const PaginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ── validate() — body (default target) ──────────────────────────────────────────────────────────────────

describe('validate() — body validation', () => {
  test('valid body passes through and calls next()', () => {
    const req  = createMockRequest({ body: { email: 'user@test.com', password: 'secret1' } });
    const res  = createMockResponse();
    const next = createMockNext();

    validate(LoginSchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // The parsed (normalised) value is written back to req.body
    expect(req.body.email).toBe('user@test.com');
  });

  test('invalid body returns 422 with field-level error details', () => {
    const req  = createMockRequest({ body: { email: 'not-an-email', password: 'short' } });
    const res  = createMockResponse();
    const next = createMockNext();

    validate(LoginSchema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);

    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.fields).toBeDefined();
    expect(Object.keys(payload.fields)).toContain('email');
  });

  test('missing required field returns 422 with the missing field listed', () => {
    const req  = createMockRequest({ body: { email: 'ok@test.com' } }); // password missing
    const res  = createMockResponse();
    const next = createMockNext();

    validate(LoginSchema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);

    const payload = res.json.mock.calls[0][0];
    expect(payload.fields).toHaveProperty('password');
    expect(next).not.toHaveBeenCalled();
  });

  test('multiple invalid fields are all reported in a single response', () => {
    const req  = createMockRequest({ body: {} }); // everything missing
    const res  = createMockResponse();
    const next = createMockNext();

    validate(RegisterSchema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);

    const payload = res.json.mock.calls[0][0];
    const fields  = Object.keys(payload.fields);
    expect(fields).toContain('email');
    expect(fields).toContain('username');
    expect(fields).toContain('password');
  });

  test('parsed (coerced/transformed) value is written back to req.body', () => {
    // Zod trims the string and lowercases via .email() normalisation
    const req  = createMockRequest({ body: { email: 'Valid@Test.com', password: 'mypassword' } });
    const res  = createMockResponse();
    const next = createMockNext();

    const schema = z.object({
      email:    z.string().email().transform((v) => v.toLowerCase()),
      password: z.string().min(6),
    });

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.email).toBe('valid@test.com');
  });
});

// ── validate() — query target with z.coerce ──────────────────────────────────────────────────────────────────

describe('validate() — query validation with coerce', () => {
  test('string query params are coerced to numbers and defaults are applied', () => {
    // Simulate an HTTP query string arriving as all-string values
    const req  = createMockRequest({ query: { page: '3', limit: '10' } });
    const res  = createMockResponse();
    const next = createMockNext();

    validate(PaginationSchema, 'query')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.page).toBe(3);
    expect(req.query.limit).toBe(10);
    expect(req.query.order).toBe('desc'); // default applied
  });

  test('missing query params resolve to schema defaults', () => {
    const req  = createMockRequest({ query: {} });
    const res  = createMockResponse();
    const next = createMockNext();

    validate(PaginationSchema, 'query')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.page).toBe(1);
    expect(req.query.limit).toBe(20);
    expect(req.query.order).toBe('desc');
  });

  test('invalid query param (non-numeric page) returns 422', () => {
    const req  = createMockRequest({ query: { page: 'abc' } });
    const res  = createMockResponse();
    const next = createMockNext();

    validate(PaginationSchema, 'query')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(next).not.toHaveBeenCalled();

    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.target).toBe('query');
  });
});

// ── validate() — unsupported target throws at setup time ──────────────────────────────────────────────

describe('validate() — unsupported target', () => {
  test('throws synchronously when an unsupported target is passed', () => {
    expect(() => validate(LoginSchema, 'headers')).toThrow(/unsupported target/i);
  });
});

// ── validateBody / validateQuery shorthands ──────────────────────────────────────────────────────────────

describe('validateBody() shorthand', () => {
  test('behaves identically to validate(schema, "body")', () => {
    const req  = createMockRequest({ body: { email: 'a@b.com', password: 'pass123' } });
    const res  = createMockResponse();
    const next = createMockNext();

    validateBody(LoginSchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validateQuery() shorthand', () => {
  test('behaves identically to validate(schema, "query")', () => {
    const req  = createMockRequest({ query: {} });
    const res  = createMockResponse();
    const next = createMockNext();

    validateQuery(PaginationSchema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
