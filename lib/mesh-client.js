/**
 * DOZ Mesh Client — Inter-service HTTP communication
 * Service discovery via Docker DNS, retry with exponential backoff, circuit breaker
 */

const http = require('http');
const https = require('https');

// Service registry — container name → port mapping
const SERVICE_REGISTRY = {
    'doz-up-core':    { host: process.env.DOZ_UP_CORE_HOST    || 'doz-up-core',    port: parseInt(process.env.DOZ_UP_CORE_PORT    || '3000') },
    'doz-brains':     { host: process.env.DOZ_BRAINS_HOST     || 'doz-brains',     port: parseInt(process.env.DOZ_BRAINS_PORT     || '3010') },
    'doz-analytics':  { host: process.env.DOZ_ANALYTICS_HOST  || 'doz-analytics',  port: parseInt(process.env.DOZ_ANALYTICS_PORT  || '3020') },
    'doz-agents':     { host: process.env.DOZ_AGENTS_HOST     || 'doz-agents',     port: parseInt(process.env.DOZ_AGENTS_PORT     || '3030') },
    'doz-payments':   { host: process.env.DOZ_PAYMENTS_HOST   || 'doz-payments',   port: parseInt(process.env.DOZ_PAYMENTS_PORT   || '3040') },
    'doz-iso':        { host: process.env.DOZ_ISO_HOST        || 'doz-iso',        port: parseInt(process.env.DOZ_ISO_PORT        || '3050') },
    'doz-admin':      { host: process.env.DOZ_ADMIN_HOST      || 'doz-admin',      port: parseInt(process.env.DOZ_ADMIN_PORT      || '3060') },
};

// Circuit breaker state per service
const circuitBreakers = {};

const CIRCUIT_BREAKER_THRESHOLD = 5;   // failures before opening
const CIRCUIT_BREAKER_TIMEOUT = 30000; // ms before half-open retry

function getCircuit(service) {
    if (!circuitBreakers[service]) {
        circuitBreakers[service] = { failures: 0, state: 'closed', lastFailure: 0 };
    }
    return circuitBreakers[service];
}

function recordSuccess(service) {
    const circuit = getCircuit(service);
    circuit.failures = 0;
    circuit.state = 'closed';
}

function recordFailure(service) {
    const circuit = getCircuit(service);
    circuit.failures++;
    circuit.lastFailure = Date.now();
    if (circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuit.state = 'open';
        console.warn(`[Mesh] Circuit OPEN for ${service} (${circuit.failures} failures)`);
    }
}

function isCircuitOpen(service) {
    const circuit = getCircuit(service);
    if (circuit.state !== 'open') return false;
    // Allow half-open retry after timeout
    if (Date.now() - circuit.lastFailure > CIRCUIT_BREAKER_TIMEOUT) {
        circuit.state = 'half-open';
        return false;
    }
    return true;
}

/**
 * Make an HTTP request to another DOZ container
 * @param {string} service - Service name from SERVICE_REGISTRY
 * @param {string} path - URL path (e.g., '/api/account/plan/123')
 * @param {object} options - { method, body, headers, timeout, retries }
 * @returns {Promise<{status: number, data: any, headers: object}>}
 */
async function request(service, path, options = {}) {
    const { method = 'GET', body = null, headers = {}, timeout = 5000, retries = 3 } = options;

    const target = SERVICE_REGISTRY[service];
    if (!target) throw new Error(`[Mesh] Unknown service: ${service}`);

    if (isCircuitOpen(service)) {
        throw new Error(`[Mesh] Circuit breaker OPEN for ${service}, retry after ${CIRCUIT_BREAKER_TIMEOUT}ms`);
    }

    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
        if (attempt > 0) {
            // Exponential backoff: 200ms, 400ms, 800ms...
            await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
        }

        try {
            const result = await _httpRequest(target.host, target.port, path, method, body, headers, timeout);
            recordSuccess(service);
            return result;
        } catch (err) {
            lastError = err;
            console.warn(`[Mesh] ${service}${path} attempt ${attempt + 1}/${retries} failed: ${err.message}`);
        }
    }

    recordFailure(service);
    throw lastError;
}

function _httpRequest(host, port, path, method, body, headers, timeout) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const reqHeaders = {
            'Content-Type': 'application/json',
            'X-Mesh-Internal': 'true',
            ...headers,
        };
        if (payload) reqHeaders['Content-Length'] = Buffer.byteLength(payload);

        const req = http.request({ hostname: host, port, path, method, headers: reqHeaders, timeout }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ status: res.statusCode, data: parsed, headers: res.headers });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${timeout}ms`)); });

        if (payload) req.write(payload);
        req.end();
    });
}

// Convenience methods
const mesh = {
    request,

    async get(service, path, options = {}) {
        return request(service, path, { ...options, method: 'GET' });
    },

    async post(service, path, body, options = {}) {
        return request(service, path, { ...options, method: 'POST', body });
    },

    async put(service, path, body, options = {}) {
        return request(service, path, { ...options, method: 'PUT', body });
    },

    async del(service, path, options = {}) {
        return request(service, path, { ...options, method: 'DELETE' });
    },

    // Forward an incoming Express request to another service
    async forward(service, req, res) {
        try {
            const result = await request(service, req.originalUrl, {
                method: req.method,
                body: req.body && Object.keys(req.body).length > 0 ? req.body : null,
                headers: {
                    'X-Device-ID': req.headers['x-device-id'] || '',
                    'X-User-Id': req.headers['x-user-id'] || '',
                    'X-Session-Id': req.headers['x-session-id'] || '',
                    'X-Real-IP': req.ip || req.connection.remoteAddress,
                },
            });
            res.status(result.status).json(result.data);
        } catch (err) {
            console.error(`[Mesh] Forward to ${service} failed:`, err.message);
            res.status(502).json({ error: 'Service unavailable', service });
        }
    },

    // Health check all services
    async healthCheck() {
        const results = {};
        for (const [name] of Object.entries(SERVICE_REGISTRY)) {
            try {
                const res = await request(name, '/health', { timeout: 3000, retries: 1 });
                results[name] = { status: 'healthy', code: res.status };
            } catch (err) {
                results[name] = { status: 'unhealthy', error: err.message };
            }
        }
        return results;
    },

    // Get circuit breaker status for monitoring
    getCircuitStatus() {
        const status = {};
        for (const [name] of Object.entries(SERVICE_REGISTRY)) {
            const circuit = getCircuit(name);
            status[name] = { state: circuit.state, failures: circuit.failures };
        }
        return status;
    },

    SERVICE_REGISTRY,
};

module.exports = mesh;
