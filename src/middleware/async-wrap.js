'use strict';

/**
 * async-wrap.js — Async Route Handler Wrapper & Central Error Handler
 *
 * Express 4 does not catch promise rejections from async route handlers.
 * asyncWrap bridges that gap by forwarding any rejection to next(err).
 *
 * centralErrorHandler is the 4-argument Express error handler that should
 * be registered last in gateway.js (after all routes).
 *
 * Usage in gateway.js:
 *
 *   const { asyncWrap, centralErrorHandler } = require('./src/middleware/async-wrap');
 *
 *   // Wrap individual handlers:
 *   app.get('/api/screenshots', asyncWrap(async (req, res) => {
 *       const data = await screenshotService.list();
 *       res.json(data);
 *   }));
 *
 *   // Register the error handler LAST (after all routes):
 *   app.use(centralErrorHandler);
 */

// ---------------------------------------------------------------------------
// asyncWrap
// Wraps an async route handler so that any rejected promise is forwarded to
// Express's error-handling chain via next(err).
//
// @param {Function} fn — async (req, res, next) => Promise<void>
// @returns {Function}  — standard Express middleware
// ---------------------------------------------------------------------------
function asyncWrap(fn) {
    return function wrappedAsync(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// ---------------------------------------------------------------------------
// centralErrorHandler
// Express 4-argument error handler.  Must be registered AFTER all routes.
//
// Behaviour:
//   - Logs the full error stack in non-production environments.
//   - Returns a JSON error response with the appropriate HTTP status.
//   - Hides internal details from the client in production.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
function centralErrorHandler(err, req, res, next) {
    const isProd   = process.env.NODE_ENV === 'production';
    const status   = err.status || err.statusCode || 500;

    // Always log — use the existing console to keep the same pino output seen elsewhere
    console.error('[Error]', {
        method:  req.method,
        path:    req.path,
        status,
        message: err.message,
        stack:   isProd ? undefined : err.stack,
    });

    // Multer file-size error
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            error: 'File too large',
            code:  'LIMIT_FILE_SIZE',
        });
    }

    // Multer unexpected field error
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
            error: 'Unexpected file field',
            code:  'LIMIT_UNEXPECTED_FILE',
        });
    }

    // SyntaxError from express.json() body parsing
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    const body = {
        error:  isProd ? 'Internal server error' : (err.message || 'Internal server error'),
        code:   err.code  || 'INTERNAL_ERROR',
    };

    if (!isProd && err.stack) {
        body.stack = err.stack;
    }

    return res.status(status).json(body);
}

module.exports = { asyncWrap, centralErrorHandler };
