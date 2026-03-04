'use strict';

/** @type {import('jest').Config} */
const config = {
  // Node.js environment (not jsdom) — we are testing Express middleware
  testEnvironment: 'node',

  // CommonJS — no Babel transform needed
  transform: {},

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
  ],

  // File-level setup run after the Jest framework is installed (after each test file)
  setupFilesAfterEnv: ['./tests/setup.js'],

  // Clear mock state between tests automatically
  clearMocks: true,
  resetMocks: false,
  restoreMocks: false,

  // Coverage source files
  collectCoverageFrom: [
    'src/**/*.js',
    'services/**/*.js',
    '!**/node_modules/**',
  ],

  // Coverage thresholds — 50% across the board
  coverageThreshold: {
    global: {
      branches:   50,
      functions:  50,
      lines:      50,
      statements: 50,
    },
  },

  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',

  // Max time per test (ms)
  testTimeout: 15000,

  // Run test files serially to prevent DB / Redis conflicts
  maxWorkers: 1,

  verbose: true,
};

module.exports = config;
