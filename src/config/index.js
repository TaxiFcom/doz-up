'use strict';

// Re-export validated env config
const env = require('./env');

// ─── Upload limits ─────────────────────────────────────────────────────────────────────
const UPLOAD_LIMITS = {
  image:  env.UPLOAD_MAX_SIZE_MB      * 1024 * 1024, // bytes
  sync:   env.UPLOAD_MAX_SYNC_SIZE_MB * 1024 * 1024,
  video:  50                          * 1024 * 1024, // 50 MB fixed for video
};

// ─── Cookie options ─────────────────────────────────────────────────────────────────────
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path:     '/',
};

// ─── CORS allowed origins (from gateway.js line 193) ───────────────────────────────────
const CORS_ORIGINS = [
  'https://share.doz.com',
  'https://doz.com',
  'https://doz.com.im',
  'https://up.doz.com',
  'https://up.doz.com.im',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
];

// ─── Rate limits ───────────────────────────────────────────────────────────────────────
const RATE_LIMITS = {
  upload: { max: 100,  windowMs: 60 * 60 * 1000 },       // 100 req / hour
  api:    { max: 1000, windowMs: 60 * 60 * 1000 },       // 1000 req / hour
  auth:   { max: 10,   windowMs:      60 * 1000 },        // 10 req / minute
};

module.exports = {
  env,
  UPLOAD_LIMITS,
  COOKIE_OPTIONS,
  CORS_ORIGINS,
  RATE_LIMITS,
};
