'use strict';

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

// \u2500\u2500\u2500 Sensitive field names to redact \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'creditCard',
  'ssn',
  // Nested variants common in request bodies / headers
  'req.headers.authorization',
  'req.headers.cookie',
  'body.password',
  'body.token',
  'body.secret',
  'body.creditCard',
  'body.ssn',
];

// \u2500\u2500\u2500 Regex patterns for inline value sanitization \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const SENSITIVE_PATTERNS = [
  // JWT tokens:  eyJ<base64>.<base64>.<base64>
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[JWT_REDACTED]' },
  // Stripe secret keys: sk_live_... or sk_test_...
  { pattern: /sk_(live|test)_[A-Za-z0-9]{20,}/g, replacement: '[STRIPE_KEY_REDACTED]' },
  // Anthropic keys: sk-ant-...
  { pattern: /sk-ant-[A-Za-z0-9\\\-_]{20,}/g, replacement: '[ANTHROPIC_KEY_REDACTED]' },
  // Emails in sensitive-looking contexts (inside tokens/payloads \u2014 not in log messages generally)
  // Only redact when prefixed with \"email:\" or inside a JSON-like context
  { pattern: /"email"\\s*:\\s*"([^"]+@[^"]+)"/g, replacement: '"email":"[EMAIL_REDACTED]"' },
  // password=value, secret=value, token=value in query strings or plain text
  { pattern: /(password|passwd|secret|api_key|apikey|access_token|refresh_token)=([^&\\s]{1,})/gi, replacement: '$1=[REDACTED]' },
  // "password": "value" or 'password': 'value' in JSON-like strings
  { pattern: /(["'](?:password|passwd|secret|api_key|apikey|access_token|refresh_token)["'])\\s*:\\s*["']([^"']*)["']/gi, replacement: '$1: "[REDACTED]"' },
];

/**
 * Sanitize a string value by redacting known sensitive patterns.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitize(value) {
  if (typeof value !== 'string') return value;

  let result = value;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// \u2500\u2500\u2500 Pino logger instance \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const logger = pino(
  {
    level: isDev ? 'debug' : 'info',

    // Redact sensitive fields at the serializer level
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },

    // Standard base fields
    base: {
      pid: process.pid,
      env: process.env.NODE_ENV || 'development',
    },

    // ISO timestamp
    timestamp: pino.stdTimeFunctions.isoTime,

    // Sanitize the message string itself on every log call
    hooks: {
      logMethod(inputArgs, method) {
        if (inputArgs.length > 0 && typeof inputArgs[0] === 'string') {
          inputArgs[0] = sanitize(inputArgs[0]);
        }
        method.apply(this, inputArgs);
      },
    },
  },

  // Transport: pino-pretty in development, plain stdout in production (PM2 handles rotation)
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : process.stdout
);

// \u2500\u2500\u2500 HTTP request/response logger middleware \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/**
 * Express middleware that logs each incoming request and its response.
 * Sensitive headers (Authorization, Cookie) are redacted by the pino redact config.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function httpLogger(req, res, next) {
  const start = Date.now();

  // Log request
  logger.info({
    type:   'request',
    method: req.method,
    url:    sanitize(req.originalUrl || req.url),
    ip:     req.ip,
    ua:     req.headers['user-agent'],
  }, `\u2192 ${req.method} ${req.path}`);

  // Capture response finish
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400          ? 'warn'
      : 'info';

    logger[level]({
      type:       'response',
      method:     req.method,
      url:        sanitize(req.originalUrl || req.url),
      status:     res.statusCode,
      duration_ms: ms,
    }, `\u2190 ${req.method} ${req.path} ${res.statusCode} (${ms}ms)`);
  });

  next();
}

module.exports = { logger, httpLogger, sanitize };
