/**
 * DOZ UP - Security Service
 * JWT Authentication, Rate Limiting, Input Validation
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const tokensPath = path.join(dataDir, 'tokens.json');
const sessionsPath = path.join(dataDir, 'sessions.json');
const rateLimitPath = path.join(dataDir, 'ratelimit.json');

// Ensure data directory
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadJSON(filepath, defaultValue = {}) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// JWT-like token implementation (simplified, no external deps)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

class SecurityService {
    constructor() {
        this.tokens = loadJSON(tokensPath, { apiKeys: {}, refreshTokens: {} });
        this.sessions = loadJSON(sessionsPath, {});
        this.rateLimit = loadJSON(rateLimitPath, {});
        this.blockedIPs = new Set();

        // Clean up expired tokens periodically
        setInterval(() => this.cleanupExpiredTokens(), 60 * 60 * 1000);
    }

    // ============ JWT-LIKE TOKEN MANAGEMENT ============

    generateToken(payload, expiresIn = TOKEN_EXPIRY) {
        const header = { alg: 'HS256', typ: 'JWT' };
        const now = Date.now();
        const tokenPayload = {
            ...payload,
            iat: now,
            exp: now + expiresIn
        };

        const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
        const payloadB64 = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
        const signature = crypto
            .createHmac('sha256', JWT_SECRET)
            .update(`${headerB64}.${payloadB64}`)
            .digest('base64url');

        return `${headerB64}.${payloadB64}.${signature}`;
    }

    verifyToken(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;

            const [headerB64, payloadB64, signature] = parts;

            // Verify signature
            const expectedSig = crypto
                .createHmac('sha256', JWT_SECRET)
                .update(`${headerB64}.${payloadB64}`)
                .digest('base64url');

            if (signature !== expectedSig) return null;

            // Decode payload
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

            // Check expiration
            if (payload.exp && Date.now() > payload.exp) {
                return null;
            }

            return payload;
        } catch (e) {
            return null;
        }
    }

    // ============ API KEY MANAGEMENT ============

    generateAPIKey(userId, name, permissions = ['read']) {
        const apiKey = `doz_${crypto.randomBytes(24).toString('hex')}`;
        const hashedKey = this.hashAPIKey(apiKey);

        this.tokens.apiKeys[hashedKey] = {
            userId,
            name,
            permissions,
            createdAt: new Date().toISOString(),
            lastUsed: null,
            usageCount: 0
        };

        saveJSON(tokensPath, this.tokens);
        return apiKey; // Return unhashed key to user (only time they'll see it)
    }

    hashAPIKey(key) {
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    validateAPIKey(apiKey) {
        const hashedKey = this.hashAPIKey(apiKey);
        const keyData = this.tokens.apiKeys[hashedKey];

        if (!keyData) return null;

        // Update usage stats
        keyData.lastUsed = new Date().toISOString();
        keyData.usageCount++;
        saveJSON(tokensPath, this.tokens);

        return keyData;
    }

    revokeAPIKey(apiKey) {
        const hashedKey = this.hashAPIKey(apiKey);
        if (this.tokens.apiKeys[hashedKey]) {
            delete this.tokens.apiKeys[hashedKey];
            saveJSON(tokensPath, this.tokens);
            return true;
        }
        return false;
    }

    // ============ SESSION MANAGEMENT ============

    createSession(userId, metadata = {}) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const session = {
            userId,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + TOKEN_EXPIRY).toISOString(),
            ip: metadata.ip || null,
            userAgent: metadata.userAgent || null,
            lastActivity: new Date().toISOString()
        };

        this.sessions[sessionId] = session;
        saveJSON(sessionsPath, this.sessions);

        return {
            sessionId,
            accessToken: this.generateToken({ userId, sessionId }),
            expiresAt: session.expiresAt
        };
    }

    validateSession(sessionId) {
        const session = this.sessions[sessionId];
        if (!session) return null;

        if (new Date(session.expiresAt) < new Date()) {
            delete this.sessions[sessionId];
            saveJSON(sessionsPath, this.sessions);
            return null;
        }

        // Update last activity
        session.lastActivity = new Date().toISOString();
        saveJSON(sessionsPath, this.sessions);

        return session;
    }

    destroySession(sessionId) {
        if (this.sessions[sessionId]) {
            delete this.sessions[sessionId];
            saveJSON(sessionsPath, this.sessions);
            return true;
        }
        return false;
    }

    getUserSessions(userId) {
        return Object.entries(this.sessions)
            .filter(([_, s]) => s.userId === userId)
            .map(([id, s]) => ({ sessionId: id, ...s }));
    }

    // ============ RATE LIMITING ============

    checkRateLimit(identifier, limit = 100, windowMs = 60000) {
        const now = Date.now();
        const key = `rate_${identifier}`;

        if (!this.rateLimit[key]) {
            this.rateLimit[key] = { count: 0, windowStart: now };
        }

        const record = this.rateLimit[key];

        // Reset window if expired
        if (now - record.windowStart > windowMs) {
            record.count = 0;
            record.windowStart = now;
        }

        record.count++;

        // Check if over limit
        if (record.count > limit) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: record.windowStart + windowMs,
                retryAfter: Math.ceil((record.windowStart + windowMs - now) / 1000)
            };
        }

        return {
            allowed: true,
            remaining: limit - record.count,
            resetAt: record.windowStart + windowMs
        };
    }

    // Different rate limits for different endpoints
    getRateLimitConfig(endpoint) {
        const configs = {
            'login': { limit: 5, window: 300000 },      // 5 per 5 min
            'register': { limit: 3, window: 3600000 },  // 3 per hour
            'api': { limit: 100, window: 60000 },       // 100 per min
            'upload': { limit: 30, window: 60000 },     // 30 per min
            'webhook': { limit: 1000, window: 60000 },  // 1000 per min
            'default': { limit: 60, window: 60000 }     // 60 per min
        };
        return configs[endpoint] || configs.default;
    }

    // ============ INPUT VALIDATION ============

    sanitizeString(str, maxLength = 1000) {
        if (typeof str !== 'string') return '';
        return str
            .trim()
            .substring(0, maxLength)
            .replace(/[<>]/g, '') // Basic XSS prevention
            .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
    }

    sanitizeEmail(email) {
        if (typeof email !== 'string') return '';
        const sanitized = email.trim().toLowerCase().substring(0, 254);
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(sanitized) ? sanitized : '';
    }

    sanitizePhone(phone) {
        if (typeof phone !== 'string') return '';
        return phone.replace(/[^\d+\-\s()]/g, '').substring(0, 20);
    }

    validateRequired(obj, fields) {
        const missing = [];
        for (const field of fields) {
            if (!obj[field] || (typeof obj[field] === 'string' && !obj[field].trim())) {
                missing.push(field);
            }
        }
        return missing.length === 0 ? null : `Missing required fields: ${missing.join(', ')}`;
    }

    validateLead(data) {
        const errors = [];

        if (!data.company || data.company.length < 2) {
            errors.push('Company name is required (min 2 characters)');
        }
        if (!data.name || data.name.length < 2) {
            errors.push('Contact name is required (min 2 characters)');
        }
        if (!this.sanitizeEmail(data.email)) {
            errors.push('Valid email is required');
        }

        return errors.length === 0 ? null : errors;
    }

    validateProposal(data) {
        const errors = [];

        if (!data.company) errors.push('Company name is required');
        if (!data.contactName) errors.push('Contact name is required');
        if (!this.sanitizeEmail(data.contactEmail)) errors.push('Valid email is required');
        if (!['startup', 'business', 'enterprise', 'whale'].includes(data.tier)) {
            errors.push('Invalid tier selected');
        }

        return errors.length === 0 ? null : errors;
    }

    // ============ PASSWORD SECURITY ============

    hashPassword(password, salt = null) {
        salt = salt || crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return { hash, salt };
    }

    verifyPassword(password, storedHash, salt) {
        const { hash } = this.hashPassword(password, salt);
        return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
    }

    checkPasswordStrength(password) {
        const issues = [];
        if (password.length < 8) issues.push('Password must be at least 8 characters');
        if (!/[A-Z]/.test(password)) issues.push('Password must contain uppercase letter');
        if (!/[a-z]/.test(password)) issues.push('Password must contain lowercase letter');
        if (!/[0-9]/.test(password)) issues.push('Password must contain a number');

        return {
            valid: issues.length === 0,
            issues,
            strength: issues.length === 0 ? 'strong' : issues.length <= 2 ? 'medium' : 'weak'
        };
    }

    // ============ IP BLOCKING ============

    blockIP(ip, reason, durationMs = 3600000) {
        this.blockedIPs.add(ip);
        setTimeout(() => this.blockedIPs.delete(ip), durationMs);
        console.log(`[Security] Blocked IP ${ip}: ${reason}`);
    }

    isIPBlocked(ip) {
        return this.blockedIPs.has(ip);
    }

    // ============ SECURITY HEADERS ============

    getSecurityHeaders() {
        return {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com https://cdn.checkout.com https://*.checkout.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://googleads.g.doubleclick.net https://*.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; connect-src 'self' https://api.exchangerate-api.com https://ipapi.co https://api.stripe.com https://*.checkout.com https://www.google-analytics.com https://*.google-analytics.com https://www.google.com https://googleads.g.doubleclick.net wss://*.doz.com wss://localhost:* ws://localhost:*; img-src 'self' data: blob: https:; frame-src https://js.stripe.com https://checkout.stripe.com https://*.checkout.com https://www.googletagmanager.com https://*.google.com;",
            'Referrer-Policy': 'strict-origin-when-cross-origin'
        };
    }

    // ============ AUDIT LOGGING ============

    logSecurityEvent(event) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            ...event
        };

        const logPath = path.join(dataDir, 'security-audit.log');
        const line = JSON.stringify(logEntry) + '\n';

        fs.appendFileSync(logPath, line);

        // Alert on suspicious activity
        if (event.severity === 'high') {
            console.log(`[SECURITY ALERT] ${event.type}: ${event.message}`);
        }
    }

    // ============ CLEANUP ============

    cleanupExpiredTokens() {
        const now = Date.now();
        let cleaned = 0;

        // Clean sessions
        for (const [sessionId, session] of Object.entries(this.sessions)) {
            if (new Date(session.expiresAt) < new Date()) {
                delete this.sessions[sessionId];
                cleaned++;
            }
        }

        if (cleaned > 0) {
            saveJSON(sessionsPath, this.sessions);
            console.log(`[Security] Cleaned ${cleaned} expired sessions`);
        }

        // Clean old rate limit records
        const oldWindow = now - 3600000; // 1 hour
        for (const key of Object.keys(this.rateLimit)) {
            if (this.rateLimit[key].windowStart < oldWindow) {
                delete this.rateLimit[key];
            }
        }
    }
}

module.exports = new SecurityService();
