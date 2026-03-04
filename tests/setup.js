'use strict';

/**
 * tests/setup.js
 *
 * Runs once after the Jest framework is initialised for each test file.
 * - Pins NODE_ENV to 'test'
 * - Sets a fixed JWT_SECRET so token generation is deterministic
 * - Silences console.error / console.warn during tests while still
 *   allowing the captured calls to be inspected via jest.fn()
 */

// ── Environment ──────────────────────────────────────────────────────────────────────────────────
process.env.NODE_ENV  = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';

// ── Silence noisy console output in test runs ──────────────────────────────────────────────
// We replace console.error / console.warn with jest spies so tests stay readable
// but callers can still assert on what was logged when they need to.
const originalError = console.error.bind(console);
const originalWarn  = console.warn.bind(console);

console.error = jest.fn((...args) => {
  // Uncomment to see errors in output while debugging:
  // originalError(...args);
});

console.warn = jest.fn((...args) => {
  // Uncomment to see warnings in output while debugging:
  // originalWarn(...args);
});

// Restore originals after the full test suite finishes so CI logs are clean
afterAll(() => {
  console.error = originalError;
  console.warn  = originalWarn;
});
