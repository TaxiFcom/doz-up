/**
 * DOZ ISO - Project Security Center
 * Controls AI/Claude access to project editing
 * Two-level authentication with biometric support
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Data files
const DATA_DIR = path.join(__dirname, '..', 'data', 'doz-iso');
const SESSIONS_FILE = path.join(DATA_DIR, 'ai-sessions.json');
const TOKENS_FILE = path.join(DATA_DIR, 'access-tokens.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'biometric-credentials.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data files
const initFile = (file, defaultData) => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
    }
};

// Default settings
const DEFAULT_SETTINGS = {
    enabled: true,
    sessionDuration: 'until_locked', // '1h', '4h', '24h', 'until_locked'
    inactivityTimeout: 30, // minutes
    absenceLockout: 24, // hours
    locationVerification: {
        enabled: true,
        triggerOnCityChange: true,
        triggerOnCountryChange: true,
        absenceDays: 3,
        distanceKm: 30
    },
    readPassword: null, // hash
    editPassword: null, // hash
    readSalt: null,
    editSalt: null,
    setupComplete: false,
    lastOnline: null,
    failedAttempts: 0,
    lockoutUntil: null
};

// Initialize all data files
initFile(SESSIONS_FILE, {});
initFile(TOKENS_FILE, {});
initFile(AUDIT_FILE, []);
initFile(LOCATIONS_FILE, { history: [], current: null });
initFile(SETTINGS_FILE, DEFAULT_SETTINGS);
initFile(CREDENTIALS_FILE, { credentials: [], challenges: {} });

// Load data helpers
const loadJSON = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
};

const saveJSON = (file, data) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// Password hashing with PBKDF2
const hashPassword = (password, salt = null) => {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt };
};

const verifyPassword = (password, hash, salt) => {
    const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(testHash));
};

// Generate session token
const generateToken = () => {
    return 'DOZISO-' + crypto.randomBytes(32).toString('hex');
};

// Calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

// DOZ ISO Service
class DozIsoService {

    // Get current status
    getStatus() {
        const settings = loadJSON(SETTINGS_FILE);
        const sessions = loadJSON(SESSIONS_FILE);
        const activeSessions = Object.values(sessions).filter(s => s.active);

        return {
            enabled: settings.enabled,
            setupComplete: settings.setupComplete,
            locked: activeSessions.length === 0,
            activeSessions: activeSessions.length,
            lastOnline: settings.lastOnline
        };
    }

    // Initial setup - set passwords
    setup(readPassword, editPassword) {
        const settings = loadJSON(SETTINGS_FILE);

        const readHash = hashPassword(readPassword);
        const editHash = hashPassword(editPassword);

        settings.readPassword = readHash.hash;
        settings.readSalt = readHash.salt;
        settings.editPassword = editHash.hash;
        settings.editSalt = editHash.salt;
        settings.setupComplete = true;
        settings.lastOnline = new Date().toISOString();

        saveJSON(SETTINGS_FILE, settings);

        this.logAudit('SETUP', 'System', 'Initial setup completed');

        return { success: true };
    }

    // Check if rate limited
    isRateLimited() {
        const settings = loadJSON(SETTINGS_FILE);
        if (settings.lockoutUntil && new Date(settings.lockoutUntil) > new Date()) {
            return { limited: true, until: settings.lockoutUntil };
        }
        return { limited: false };
    }

    // Record failed attempt
    recordFailedAttempt() {
        const settings = loadJSON(SETTINGS_FILE);
        settings.failedAttempts = (settings.failedAttempts || 0) + 1;

        if (settings.failedAttempts >= 3) {
            // Lock for 5 minutes after 3 failures
            settings.lockoutUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        }

        saveJSON(SETTINGS_FILE, settings);
    }

    // Reset failed attempts
    resetFailedAttempts() {
        const settings = loadJSON(SETTINGS_FILE);
        settings.failedAttempts = 0;
        settings.lockoutUntil = null;
        saveJSON(SETTINGS_FILE, settings);
    }

    // Unlock with password
    unlock(password, level, clientInfo = {}) {
        const settings = loadJSON(SETTINGS_FILE);

        if (!settings.setupComplete) {
            return { success: false, error: 'Setup not complete. Set passwords first.' };
        }

        // Check rate limit
        const rateLimit = this.isRateLimited();
        if (rateLimit.limited) {
            return { success: false, error: 'Too many attempts. Try again later.', lockoutUntil: rateLimit.until };
        }

        // Check location if needed
        const locationCheck = this.checkLocationVerification(clientInfo);
        if (locationCheck.requiresVerification) {
            return {
                success: false,
                error: 'Location verification required',
                locationVerification: true,
                reason: locationCheck.reason
            };
        }

        // Verify password based on level
        let valid = false;
        if (level === 'read') {
            valid = verifyPassword(password, settings.readPassword, settings.readSalt);
        } else if (level === 'edit') {
            valid = verifyPassword(password, settings.editPassword, settings.editSalt);
        }

        if (!valid) {
            this.recordFailedAttempt();
            this.logAudit('AUTH_FAILED', clientInfo.agent || 'Unknown', `Invalid ${level} password`);
            return { success: false, error: 'Invalid password' };
        }

        // Reset failed attempts on success
        this.resetFailedAttempts();

        // Create session
        const token = generateToken();
        const sessions = loadJSON(SESSIONS_FILE);

        const session = {
            id: crypto.randomBytes(8).toString('hex'),
            token,
            level,
            agent: clientInfo.agent || 'Unknown',
            ip: clientInfo.ip || 'Unknown',
            device: clientInfo.device || 'Unknown',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            expiresAt: this.calculateExpiry(settings.sessionDuration),
            active: true
        };

        sessions[session.id] = session;
        saveJSON(SESSIONS_FILE, sessions);

        // Update last online
        settings.lastOnline = new Date().toISOString();
        saveJSON(SETTINGS_FILE, settings);

        // Update location
        if (clientInfo.location) {
            this.updateLocation(clientInfo.location);
        }

        this.logAudit('UNLOCK', session.agent, `${level} access granted`, { sessionId: session.id });

        return {
            success: true,
            token,
            sessionId: session.id,
            level,
            expiresAt: session.expiresAt
        };
    }

    // Calculate session expiry
    calculateExpiry(duration) {
        if (duration === 'until_locked') return null;

        const hours = {
            '1h': 1,
            '4h': 4,
            '24h': 24
        };

        const h = hours[duration] || 24;
        return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
    }

    // Check location verification requirement
    checkLocationVerification(clientInfo) {
        const settings = loadJSON(SETTINGS_FILE);
        const locations = loadJSON(LOCATIONS_FILE);

        if (!settings.locationVerification.enabled) {
            return { requiresVerification: false };
        }

        if (!locations.current || !clientInfo.location) {
            return { requiresVerification: false };
        }

        const current = locations.current;
        const newLoc = clientInfo.location;

        // Check city/country change
        if (settings.locationVerification.triggerOnCityChange && current.city !== newLoc.city) {
            return { requiresVerification: true, reason: 'City changed' };
        }

        if (settings.locationVerification.triggerOnCountryChange && current.country !== newLoc.country) {
            return { requiresVerification: true, reason: 'Country changed' };
        }

        // Check absence + distance
        if (settings.lastOnline) {
            const lastOnline = new Date(settings.lastOnline);
            const daysSince = (Date.now() - lastOnline.getTime()) / (1000 * 60 * 60 * 24);

            if (daysSince >= settings.locationVerification.absenceDays) {
                const distance = calculateDistance(
                    current.lat, current.lon,
                    newLoc.lat, newLoc.lon
                );

                if (distance > settings.locationVerification.distanceKm) {
                    return {
                        requiresVerification: true,
                        reason: `${Math.round(daysSince)} days absence + ${Math.round(distance)}km distance`
                    };
                }
            }
        }

        return { requiresVerification: false };
    }

    // Update location
    updateLocation(location) {
        const locations = loadJSON(LOCATIONS_FILE);

        if (locations.current) {
            locations.history.push({
                ...locations.current,
                endedAt: new Date().toISOString()
            });

            // Keep only last 100 locations
            if (locations.history.length > 100) {
                locations.history = locations.history.slice(-100);
            }
        }

        locations.current = {
            ...location,
            recordedAt: new Date().toISOString()
        };

        saveJSON(LOCATIONS_FILE, locations);
    }

    // Lock session / end AI access
    lock(sessionId = null, token = null) {
        const sessions = loadJSON(SESSIONS_FILE);

        if (sessionId) {
            if (sessions[sessionId]) {
                sessions[sessionId].active = false;
                sessions[sessionId].endedAt = new Date().toISOString();
                this.logAudit('LOCK', sessions[sessionId].agent, 'Session ended', { sessionId });
            }
        } else if (token) {
            // Find by token
            for (const [id, session] of Object.entries(sessions)) {
                if (session.token === token && session.active) {
                    sessions[id].active = false;
                    sessions[id].endedAt = new Date().toISOString();
                    this.logAudit('LOCK', session.agent, 'Session ended', { sessionId: id });
                    break;
                }
            }
        } else {
            // Lock all sessions
            for (const [id, session] of Object.entries(sessions)) {
                if (session.active) {
                    sessions[id].active = false;
                    sessions[id].endedAt = new Date().toISOString();
                }
            }
            this.logAudit('LOCK_ALL', 'System', 'All sessions ended');
        }

        saveJSON(SESSIONS_FILE, sessions);
        return { success: true };
    }

    // Verify token
    verifyToken(token) {
        const sessions = loadJSON(SESSIONS_FILE);
        const settings = loadJSON(SETTINGS_FILE);

        for (const [id, session] of Object.entries(sessions)) {
            if (session.token === token && session.active) {
                // Check expiry
                if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
                    sessions[id].active = false;
                    sessions[id].endedAt = new Date().toISOString();
                    saveJSON(SESSIONS_FILE, sessions);
                    return { valid: false, error: 'Session expired' };
                }

                // Check inactivity
                const inactivityMs = settings.inactivityTimeout * 60 * 1000;
                if (new Date() - new Date(session.lastActivity) > inactivityMs) {
                    sessions[id].active = false;
                    sessions[id].endedAt = new Date().toISOString();
                    saveJSON(SESSIONS_FILE, sessions);
                    return { valid: false, error: 'Session inactive' };
                }

                // Update last activity
                sessions[id].lastActivity = new Date().toISOString();
                saveJSON(SESSIONS_FILE, sessions);

                // Update last online in settings
                settings.lastOnline = new Date().toISOString();
                saveJSON(SETTINGS_FILE, settings);

                return {
                    valid: true,
                    level: session.level,
                    sessionId: id,
                    agent: session.agent
                };
            }
        }

        return { valid: false, error: 'Invalid or inactive token' };
    }

    // Get all sessions
    getSessions() {
        const sessions = loadJSON(SESSIONS_FILE);
        return Object.values(sessions).map(s => ({
            id: s.id,
            level: s.level,
            agent: s.agent,
            ip: s.ip,
            createdAt: s.createdAt,
            lastActivity: s.lastActivity,
            expiresAt: s.expiresAt,
            active: s.active
        }));
    }

    // Get audit log
    getAuditLog(limit = 100, offset = 0) {
        const audit = loadJSON(AUDIT_FILE);
        return audit.slice(-limit - offset, audit.length - offset).reverse();
    }

    // Log audit event
    logAudit(action, agent, details, metadata = {}) {
        const audit = loadJSON(AUDIT_FILE);

        audit.push({
            id: crypto.randomBytes(8).toString('hex'),
            timestamp: new Date().toISOString(),
            action,
            agent,
            details,
            ...metadata
        });

        // Keep only last 10000 entries
        if (audit.length > 10000) {
            audit.splice(0, audit.length - 10000);
        }

        saveJSON(AUDIT_FILE, audit);
    }

    // Log file operation (for AI tracking)
    logFileOperation(token, operation, filePath, contentHash = null) {
        const verify = this.verifyToken(token);
        if (!verify.valid) return;

        this.logAudit(
            `FILE_${operation.toUpperCase()}`,
            verify.agent,
            `${operation}: ${filePath}`,
            {
                sessionId: verify.sessionId,
                filePath,
                contentHash
            }
        );
    }

    // Get settings
    getSettings() {
        const settings = loadJSON(SETTINGS_FILE);
        return {
            enabled: settings.enabled,
            sessionDuration: settings.sessionDuration,
            inactivityTimeout: settings.inactivityTimeout,
            absenceLockout: settings.absenceLockout,
            locationVerification: settings.locationVerification,
            setupComplete: settings.setupComplete,
            lastOnline: settings.lastOnline
        };
    }

    // Update settings
    updateSettings(newSettings) {
        const settings = loadJSON(SETTINGS_FILE);

        const allowedKeys = [
            'enabled', 'sessionDuration', 'inactivityTimeout',
            'absenceLockout', 'locationVerification'
        ];

        for (const key of allowedKeys) {
            if (newSettings[key] !== undefined) {
                settings[key] = newSettings[key];
            }
        }

        saveJSON(SETTINGS_FILE, settings);
        this.logAudit('SETTINGS_UPDATE', 'Admin', 'Settings updated', { changes: Object.keys(newSettings) });

        return { success: true };
    }

    // Change password
    changePassword(level, currentPassword, newPassword) {
        const settings = loadJSON(SETTINGS_FILE);

        // Verify current password
        let valid = false;
        if (level === 'read') {
            valid = verifyPassword(currentPassword, settings.readPassword, settings.readSalt);
        } else if (level === 'edit') {
            valid = verifyPassword(currentPassword, settings.editPassword, settings.editSalt);
        }

        if (!valid) {
            return { success: false, error: 'Current password incorrect' };
        }

        // Set new password
        const newHash = hashPassword(newPassword);
        if (level === 'read') {
            settings.readPassword = newHash.hash;
            settings.readSalt = newHash.salt;
        } else {
            settings.editPassword = newHash.hash;
            settings.editSalt = newHash.salt;
        }

        saveJSON(SETTINGS_FILE, settings);
        this.logAudit('PASSWORD_CHANGE', 'Admin', `${level} password changed`);

        return { success: true };
    }

    // ===== BIOMETRIC (WebAuthn) SUPPORT =====

    // Generate registration challenge
    generateBiometricChallenge(userId) {
        const credentials = loadJSON(CREDENTIALS_FILE);

        const challenge = crypto.randomBytes(32).toString('base64url');
        credentials.challenges[userId] = {
            challenge,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min
        };

        saveJSON(CREDENTIALS_FILE, credentials);

        return {
            challenge,
            rpId: 'doz.com',
            rpName: 'DOZ ISO',
            userId,
            userName: 'admin'
        };
    }

    // Register biometric credential
    registerBiometric(userId, credential, level) {
        const credentials = loadJSON(CREDENTIALS_FILE);

        // Verify challenge exists
        if (!credentials.challenges[userId]) {
            return { success: false, error: 'No active challenge' };
        }

        const challengeData = credentials.challenges[userId];
        if (new Date(challengeData.expiresAt) < new Date()) {
            delete credentials.challenges[userId];
            saveJSON(CREDENTIALS_FILE, credentials);
            return { success: false, error: 'Challenge expired' };
        }

        // Store credential
        credentials.credentials.push({
            id: credential.id,
            publicKey: credential.publicKey,
            userId,
            level,
            createdAt: new Date().toISOString(),
            lastUsed: null
        });

        delete credentials.challenges[userId];
        saveJSON(CREDENTIALS_FILE, credentials);

        this.logAudit('BIOMETRIC_REGISTER', 'Admin', `Biometric registered for ${level} access`);

        return { success: true };
    }

    // Verify biometric
    verifyBiometric(credentialId, signature, clientInfo = {}) {
        const credentials = loadJSON(CREDENTIALS_FILE);

        const cred = credentials.credentials.find(c => c.id === credentialId);
        if (!cred) {
            return { success: false, error: 'Credential not found' };
        }

        // Update last used
        cred.lastUsed = new Date().toISOString();
        saveJSON(CREDENTIALS_FILE, credentials);

        // Create session
        return this.unlock('__biometric__', cred.level, {
            ...clientInfo,
            agent: clientInfo.agent || 'Biometric Auth'
        });
    }

    // Get registered biometrics
    getBiometrics() {
        const credentials = loadJSON(CREDENTIALS_FILE);
        return credentials.credentials.map(c => ({
            id: c.id,
            level: c.level,
            createdAt: c.createdAt,
            lastUsed: c.lastUsed
        }));
    }

    // Remove biometric
    removeBiometric(credentialId) {
        const credentials = loadJSON(CREDENTIALS_FILE);
        credentials.credentials = credentials.credentials.filter(c => c.id !== credentialId);
        saveJSON(CREDENTIALS_FILE, credentials);

        this.logAudit('BIOMETRIC_REMOVE', 'Admin', 'Biometric credential removed');

        return { success: true };
    }

    // Location verification complete
    completeLocationVerification(password, level, clientInfo) {
        // This bypasses location check - used after manual verification
        const settings = loadJSON(SETTINGS_FILE);

        // Verify password
        let valid = false;
        if (level === 'read') {
            valid = verifyPassword(password, settings.readPassword, settings.readSalt);
        } else if (level === 'edit') {
            valid = verifyPassword(password, settings.editPassword, settings.editSalt);
        }

        if (!valid) {
            return { success: false, error: 'Invalid password' };
        }

        // Update location and create session
        if (clientInfo.location) {
            this.updateLocation(clientInfo.location);
        }

        // Create session directly
        const token = generateToken();
        const sessions = loadJSON(SESSIONS_FILE);

        const session = {
            id: crypto.randomBytes(8).toString('hex'),
            token,
            level,
            agent: clientInfo.agent || 'Unknown',
            ip: clientInfo.ip || 'Unknown',
            device: clientInfo.device || 'Unknown',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            expiresAt: this.calculateExpiry(settings.sessionDuration),
            active: true,
            locationVerified: true
        };

        sessions[session.id] = session;
        saveJSON(SESSIONS_FILE, sessions);

        settings.lastOnline = new Date().toISOString();
        saveJSON(SETTINGS_FILE, settings);

        this.logAudit('UNLOCK_LOCATION_VERIFIED', session.agent, `${level} access granted after location verification`);

        return {
            success: true,
            token,
            sessionId: session.id,
            level
        };
    }
}

// Biometric unlock bypass
const BIOMETRIC_BYPASS = '__biometric__';
DozIsoService.prototype._originalUnlock = DozIsoService.prototype.unlock;
DozIsoService.prototype.unlock = function(password, level, clientInfo = {}) {
    if (password === BIOMETRIC_BYPASS) {
        // Skip password verification for biometric auth
        const settings = loadJSON(SETTINGS_FILE);
        if (!settings.setupComplete) {
            return { success: false, error: 'Setup not complete' };
        }

        const token = generateToken();
        const sessions = loadJSON(SESSIONS_FILE);

        const session = {
            id: crypto.randomBytes(8).toString('hex'),
            token,
            level,
            agent: clientInfo.agent || 'Biometric',
            ip: clientInfo.ip || 'Unknown',
            device: clientInfo.device || 'Unknown',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            expiresAt: this.calculateExpiry(settings.sessionDuration),
            active: true,
            biometric: true
        };

        sessions[session.id] = session;
        saveJSON(SESSIONS_FILE, sessions);

        settings.lastOnline = new Date().toISOString();
        saveJSON(SETTINGS_FILE, settings);

        this.logAudit('UNLOCK_BIOMETRIC', session.agent, `${level} access granted via biometric`);

        return {
            success: true,
            token,
            sessionId: session.id,
            level
        };
    }

    return this._originalUnlock(password, level, clientInfo);
};

module.exports = new DozIsoService();
