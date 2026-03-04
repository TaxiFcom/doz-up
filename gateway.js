// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dbUtils = require('./lib/db'); // Shared async database utility
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const ftp = require('basic-ftp');

// Process error handlers - prevent silent crashes + AI interception
process.on('uncaughtException', (err) => {
    // EADDRINUSE is handled by server.on('error') with retry logic — don't crash
    if (err.code === 'EADDRINUSE') return;
    console.error('[FATAL] Uncaught Exception:', err);
    try {
        const aiInterceptor = require('./services/ai-error-interceptor');
        aiInterceptor.handleError({ message: err.message, source: 'uncaughtException', stack: err.stack });
    } catch (e) { /* AI interceptor not yet loaded */ }
    if (err.code === 'ERR_HTTP_HEADERS_SENT') {
        console.error('[FATAL] Exiting in 1s for PM2 restart...');
        setTimeout(() => process.exit(1), 1000);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    // Suppress Redis/BullMQ connection errors (no Redis server, handled by fallback)
    const msg = reason?.message || String(reason);
    if (msg.includes('Connection is closed') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('maxRetriesPerRequest')) {
        return;
    }
    console.error('[FATAL] Unhandled Rejection:', reason);
    try {
        const aiInterceptor = require('./services/ai-error-interceptor');
        aiInterceptor.handleError({ message: msg, source: 'unhandledRejection', stack: reason?.stack });
    } catch (e) { /* AI interceptor not yet loaded */ }
});

// SSL Configuration for HTTPS with SNI support
const tls = require('tls');

// SSL directory path
const sslDir = path.join(__dirname, 'ssl');

// Cache of loaded SSL certs to avoid reloading on every request
const sslCache = {};

// ─── Security middleware imports ───────────────────────────────────────────────
const { securityHeaders } = require('./src/middleware/security-headers');
const { csrfProtection, attachCsrfToken } = require('./src/middleware/csrf');
const { cookieOptions, sessionCookieOptions, csrfCookieOptions } = require('./src/middleware/cookie-config');
const { requireAuth, requireAdmin, optionalAuth } = require('./src/middleware/auth');
const { validate } = require('./src/middleware/validate');
const { uploadLimiter, syncLimiter } = require('./src/middleware/upload-limiter');
const { asyncWrap } = require('./src/middleware/async-wrap');

// ─── Route handlers ───────────────────────────────────────────────────────────
const { registerRoutes } = require('./src/routes/index');

/**
 * Load SSL certificate files for a given domain.
 * Returns null if cert files are missing (falls back to HTTP).
 */
function loadCert(domain) {
    if (sslCache[domain]) return sslCache[domain];
    const certPath = path.join(sslDir, domain, 'fullchain.pem');
    const keyPath  = path.join(sslDir, domain, 'privkey.pem');
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
    const cert = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    sslCache[domain] = cert;
    return cert;
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();

// ─── Security headers (Helmet + CSP) ─────────────────────────────────────────
app.use(securityHeaders);

// ─── Trust proxy — required when running behind nginx/Caddy/Cloudflare ───────
app.set('trust proxy', 1);

// IMPORTANT: Raw-body parser for Stripe webhook MUST come before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Cookie parser ────────────────────────────────────────────────────────────
const cookieParser = require('cookie-parser');
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const cors = require('cors');
const allowedOrigins = [
    'https://doz.com',
    'https://up.doz.com',
    'https://up.doz.com.im',
    'https://adm.doz.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(process.env.EXTRA_CORS_ORIGINS ? process.env.EXTRA_CORS_ORIGINS.split(',') : []),
];
app.use(cors({
    origin(origin, cb) {
        // Allow non-browser requests (curl, Postman, server-to-server)
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-CSRF-Token'],
}));

// ─── Compression ──────────────────────────────────────────────────────────────
const compression = require('compression');
app.use(compression());

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
let redisClient = null;
try {
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
    });
    redisClient.on('error', () => { /* suppress */ });
} catch (e) { /* no Redis — use in-memory fallback */ }

const makeStore = () => redisClient
    ? new RedisStore({ sendCommand: (...args) => redisClient.call(...args) })
    : undefined;

// General API limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    message: { error: 'Too many requests, please try again later.' },
});

// Strict limiter for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    message: { error: 'Too many authentication attempts, please try again later.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// ─── CSRF — attach token cookie on GET requests ───────────────────────────────
app.use(attachCsrfToken);

// ─── Register all modular API routes ─────────────────────────────────────────
registerRoutes(app);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', asyncWrap(async (req, res) => {
    const checks = { status: 'ok', timestamp: new Date().toISOString() };

    // Database check
    try {
        await dbUtils.query('SELECT 1');
        checks.database = 'ok';
    } catch (e) {
        checks.database = 'error';
        checks.status = 'degraded';
    }

    // Redis check
    try {
        if (redisClient) {
            await redisClient.ping();
            checks.redis = 'ok';
        } else {
            checks.redis = 'not_configured';
        }
    } catch (e) {
        checks.redis = 'error';
    }

    res.status(checks.status === 'ok' ? 200 : 503).json(checks);
}));

// ─── CSRF token endpoint for browser clients ──────────────────────────────────
app.get('/auth/csrf-token', attachCsrfToken, (req, res) => {
    res.json({ csrfToken: req.csrfToken });
});

