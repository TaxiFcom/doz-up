/**
 * DOZ Shared Config — Common Express setup for all containers
 * CORS, compression, body parsing, health endpoint, error handling
 */

const express = require('express');
const compression = require('compression');

const ALLOWED_ORIGINS = [
    'https://doz.com',
    'https://www.doz.com',
    'https://up.doz.com',
    'https://up.doz.com.im',
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
    // Spaceship frontend
    process.env.SPACESHIP_ORIGIN || 'https://lp.doz.com',
];

/**
 * Create a configured Express app for a DOZ container
 * @param {string} serviceName - e.g. 'doz-brains', 'doz-analytics'
 * @param {object} opts - { enableCompression, bodyLimit, trustProxy }
 * @returns {express.Application}
 */
function createApp(serviceName, opts = {}) {
    const {
        enableCompression = true,
        bodyLimit = '50mb',
        trustProxy = true,
    } = opts;

    const app = express();

    // Set service name in env for event bus
    process.env.DOZ_SERVICE_NAME = serviceName;

    // Trust proxy (behind nginx mesh gateway)
    if (trustProxy) app.set('trust proxy', true);

    // CORS
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-ID, X-Sync-Token, X-App-Version, X-User-Id, X-Upload-Token, X-Session-Id, X-Mesh-Internal');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        // Allow internal mesh requests
        if (req.headers['x-mesh-internal'] === 'true') {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    // Compression
    if (enableCompression) {
        app.use(compression({
            level: 6,
            threshold: 1024,
            filter: (req, res) => {
                if (req.headers['x-no-compression']) return false;
                return compression.filter(req, res);
            }
        }));
    }

    // Body parsing
    app.use(express.json({ limit: bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    // Disable ETag
    app.set('etag', false);

    // Request ID + timing
    app.use((req, res, next) => {
        req._startTime = Date.now();
        req._serviceId = serviceName;
        next();
    });

    // Health endpoint
    app.get('/health', (req, res) => {
        res.json({
            service: serviceName,
            status: 'healthy',
            uptime: process.uptime(),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
            timestamp: new Date().toISOString(),
        });
    });

    return app;
}

/**
 * Start an Express server with graceful shutdown
 * @param {express.Application} app
 * @param {number} port
 * @param {string} serviceName
 * @returns {Promise<http.Server>}
 */
function startServer(app, port, serviceName) {
    const http = require('http');
    const server = http.createServer(app);

    // Error handler middleware (add last)
    app.use((err, req, res, next) => {
        console.error(`[${serviceName}] Error:`, err.message);
        res.status(500).json({ error: 'Internal server error', service: serviceName });
    });

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({ error: 'Not found', service: serviceName, path: req.path });
    });

    return new Promise((resolve, reject) => {
        server.listen(port, '0.0.0.0', () => {
            console.log(`[${serviceName}] Running on port ${port}`);
            resolve(server);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`[${serviceName}] Port ${port} in use, retrying in 2s...`);
                setTimeout(() => {
                    server.close();
                    server.listen(port, '0.0.0.0');
                }, 2000);
            } else {
                reject(err);
            }
        });

        // Graceful shutdown
        const shutdown = () => {
            console.log(`[${serviceName}] Shutting down...`);
            server.close(() => {
                console.log(`[${serviceName}] Server closed`);
                process.exit(0);
            });
            // Force exit after 30s
            setTimeout(() => process.exit(1), 30000);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    });
}

module.exports = { createApp, startServer, ALLOWED_ORIGINS };
