/**
 * DOZ UP - Advanced Authentication & Security Service
 *
 * Features:
 * - WebAuthn/Biometric Authentication (Face ID, Touch ID, Windows Hello)
 * - Device Binding & Trusted Devices
 * - TOTP/Google Authenticator Support
 * - Cross-Device Login Confirmation
 * - Passwordless Authentication
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Data storage paths
const dataDir = path.join(__dirname, '..', 'data');
const usersPath = path.join(dataDir, 'auth-users.json');
const devicesPath = path.join(dataDir, 'auth-devices.json');
const credentialsPath = path.join(dataDir, 'auth-credentials.json');
const credentialUserMapPath = path.join(dataDir, 'credential-user-map.json'); // Maps credentialId -> userId for passkey login
const totpPath = path.join(dataDir, 'auth-totp.json');
const loginRequestsPath = path.join(dataDir, 'auth-login-requests.json');
const sessionsPath = path.join(dataDir, 'auth-sessions.json');
const userDeviceLinksPath = path.join(dataDir, 'user-device-links.json');
const subscriptionsPath = path.join(dataDir, 'subscriptions.json');
const passwordResetPath = path.join(dataDir, 'password-reset-tokens.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Load/Save helpers
function loadJSON(filepath, defaultValue = {}) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {
        console.error(`[Auth] Error loading ${filepath}:`, e.message);
    }
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ============ TOTP (Google Authenticator) ============

class TOTPService {
    constructor() {
        this.secrets = loadJSON(totpPath, {});
    }

    // Generate a new TOTP secret
    generateSecret(userId) {
        const buffer = crypto.randomBytes(20);
        const secret = this.base32Encode(buffer);

        this.secrets[userId] = {
            secret: secret,
            enabled: false,
            createdAt: new Date().toISOString(),
            backupCodes: this.generateBackupCodes()
        };

        saveJSON(totpPath, this.secrets);
        return secret;
    }

    // Base32 encode for TOTP secrets
    base32Encode(buffer) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = 0;
        let value = 0;
        let output = '';

        for (let i = 0; i < buffer.length; i++) {
            value = (value << 8) | buffer[i];
            bits += 8;

            while (bits >= 5) {
                output += alphabet[(value >>> (bits - 5)) & 31];
                bits -= 5;
            }
        }

        if (bits > 0) {
            output += alphabet[(value << (5 - bits)) & 31];
        }

        return output;
    }

    // Base32 decode
    base32Decode(encoded) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleanedInput = encoded.replace(/=+$/, '').toUpperCase();

        let bits = 0;
        let value = 0;
        const output = [];

        for (let i = 0; i < cleanedInput.length; i++) {
            const idx = alphabet.indexOf(cleanedInput[i]);
            if (idx === -1) continue;

            value = (value << 5) | idx;
            bits += 5;

            if (bits >= 8) {
                output.push((value >>> (bits - 8)) & 255);
                bits -= 8;
            }
        }

        return Buffer.from(output);
    }

    // Generate TOTP code
    generateTOTP(secret, timestamp = Date.now()) {
        const time = Math.floor(timestamp / 30000);
        const timeBuffer = Buffer.alloc(8);

        for (let i = 7; i >= 0; i--) {
            timeBuffer[i] = time & 0xff;
            time = Math.floor(time / 256);
        }

        const secretBuffer = this.base32Decode(secret);
        const hmac = crypto.createHmac('sha1', secretBuffer).update(timeBuffer).digest();

        const offset = hmac[hmac.length - 1] & 0x0f;
        const code = ((hmac[offset] & 0x7f) << 24) |
                     ((hmac[offset + 1] & 0xff) << 16) |
                     ((hmac[offset + 2] & 0xff) << 8) |
                     (hmac[offset + 3] & 0xff);

        return String(code % 1000000).padStart(6, '0');
    }

    // Verify TOTP code (with time drift tolerance)
    verifyTOTP(userId, code) {
        const userData = this.secrets[userId];
        if (!userData || !userData.enabled) return false;

        const now = Date.now();

        // Check current, previous, and next time windows
        for (let i = -1; i <= 1; i++) {
            const testTime = now + (i * 30000);
            const expectedCode = this.generateTOTP(userData.secret, testTime);
            if (code === expectedCode) {
                return true;
            }
        }

        // Check backup codes
        if (userData.backupCodes && userData.backupCodes.includes(code)) {
            userData.backupCodes = userData.backupCodes.filter(c => c !== code);
            saveJSON(totpPath, this.secrets);
            return true;
        }

        return false;
    }

    // Generate backup codes
    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        return codes;
    }

    // Enable TOTP for user
    enableTOTP(userId, verificationCode) {
        const userData = this.secrets[userId];
        if (!userData) return { success: false, error: 'TOTP not set up' };

        // Verify the code before enabling
        const expectedCode = this.generateTOTP(userData.secret);
        if (verificationCode !== expectedCode) {
            return { success: false, error: 'Invalid verification code' };
        }

        userData.enabled = true;
        userData.enabledAt = new Date().toISOString();
        saveJSON(totpPath, this.secrets);

        return {
            success: true,
            backupCodes: userData.backupCodes
        };
    }

    // Disable TOTP
    disableTOTP(userId) {
        if (this.secrets[userId]) {
            delete this.secrets[userId];
            saveJSON(totpPath, this.secrets);
        }
        return { success: true };
    }

    // Get QR code URL for authenticator apps
    getQRCodeUrl(userId, email) {
        const userData = this.secrets[userId];
        if (!userData) return null;

        const issuer = 'DOZ%20UP';
        const accountName = encodeURIComponent(email);
        const secret = userData.secret;

        return `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    }

    // Check if TOTP is enabled
    isTOTPEnabled(userId) {
        return this.secrets[userId]?.enabled || false;
    }
}

// ============ Device Binding & Management ============

class DeviceManager {
    constructor() {
        this.devices = loadJSON(devicesPath, {});
    }

    // Register a new device
    registerDevice(userId, deviceInfo) {
        if (!this.devices[userId]) {
            this.devices[userId] = [];
        }

        const deviceId = deviceInfo.deviceId || crypto.randomBytes(16).toString('hex');

        const device = {
            id: deviceId,
            name: deviceInfo.name || this.generateDeviceName(deviceInfo),
            fingerprint: this.generateFingerprint(deviceInfo),
            platform: deviceInfo.platform,
            browser: deviceInfo.browser,
            os: deviceInfo.os,
            trusted: false,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            ipAddress: deviceInfo.ipAddress,
            location: deviceInfo.location
        };

        // Check if device already exists
        const existingIndex = this.devices[userId].findIndex(d =>
            d.fingerprint === device.fingerprint || d.id === deviceId
        );

        if (existingIndex >= 0) {
            // Update existing device
            this.devices[userId][existingIndex] = {
                ...this.devices[userId][existingIndex],
                ...device,
                lastUsed: new Date().toISOString()
            };
        } else {
            this.devices[userId].push(device);
        }

        saveJSON(devicesPath, this.devices);
        return device;
    }

    // Generate device fingerprint
    generateFingerprint(deviceInfo) {
        const data = [
            deviceInfo.userAgent,
            deviceInfo.platform,
            deviceInfo.screenResolution,
            deviceInfo.timezone,
            deviceInfo.language
        ].join('|');

        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
    }

    // Generate friendly device name
    generateDeviceName(deviceInfo) {
        const platform = deviceInfo.platform || 'Unknown';
        const browser = deviceInfo.browser || '';

        if (platform.includes('Win')) return `Windows PC${browser ? ' - ' + browser : ''}`;
        if (platform.includes('Mac')) return `Mac${browser ? ' - ' + browser : ''}`;
        if (platform.includes('iPhone')) return 'iPhone';
        if (platform.includes('iPad')) return 'iPad';
        if (platform.includes('Android')) return 'Android Device';
        if (platform.includes('Linux')) return `Linux${browser ? ' - ' + browser : ''}`;

        return `${platform}${browser ? ' - ' + browser : ''}`;
    }

    // Trust a device
    trustDevice(userId, deviceId) {
        if (!this.devices[userId]) return { success: false, error: 'User not found' };

        const device = this.devices[userId].find(d => d.id === deviceId);
        if (!device) return { success: false, error: 'Device not found' };

        device.trusted = true;
        device.trustedAt = new Date().toISOString();
        saveJSON(devicesPath, this.devices);

        return { success: true, device };
    }

    // Untrust/Remove a device
    removeDevice(userId, deviceId) {
        if (!this.devices[userId]) return { success: false };

        this.devices[userId] = this.devices[userId].filter(d => d.id !== deviceId);
        saveJSON(devicesPath, this.devices);

        return { success: true };
    }

    // Get all devices for user
    getDevices(userId) {
        return this.devices[userId] || [];
    }

    // Check if device is trusted
    isDeviceTrusted(userId, deviceFingerprint) {
        const devices = this.devices[userId] || [];
        return devices.some(d => d.fingerprint === deviceFingerprint && d.trusted);
    }

    // Check if device is known (registered but maybe not trusted)
    isDeviceKnown(userId, deviceFingerprint) {
        const devices = this.devices[userId] || [];
        return devices.some(d => d.fingerprint === deviceFingerprint);
    }

    // Get only trusted devices for user
    getTrustedDevices(userId) {
        const devices = this.devices[userId] || [];
        return devices.filter(d => d.trusted);
    }
}

// ============ User-Device Links (Browser DeviceId to UserId) ============

class UserDeviceLinksManager {
    constructor() {
        this.links = loadJSON(userDeviceLinksPath, { byUserId: {}, byDeviceId: {} });
    }

    // Link a browser deviceId to a userId
    linkDevice(userId, browserDeviceId, email = null) {
        if (!userId || !browserDeviceId) {
            return { success: false, error: 'userId and browserDeviceId required' };
        }

        // Initialize user's device list if not exists
        if (!this.links.byUserId[userId]) {
            this.links.byUserId[userId] = {
                email: email,
                deviceIds: [],
                linkedAt: new Date().toISOString()
            };
        }

        // Add deviceId if not already linked
        if (!this.links.byUserId[userId].deviceIds.includes(browserDeviceId)) {
            this.links.byUserId[userId].deviceIds.push(browserDeviceId);
        }

        // Update email if provided
        if (email) {
            this.links.byUserId[userId].email = email;
        }

        // Create reverse lookup
        this.links.byDeviceId[browserDeviceId] = {
            userId: userId,
            email: email,
            linkedAt: new Date().toISOString()
        };

        saveJSON(userDeviceLinksPath, this.links);
        return { success: true, userId, browserDeviceId };
    }

    // Get userId from browser deviceId
    getUserIdFromDevice(browserDeviceId) {
        return this.links.byDeviceId[browserDeviceId]?.userId || null;
    }

    // Get all browser deviceIds for a userId
    getDeviceIds(userId) {
        return this.links.byUserId[userId]?.deviceIds || [];
    }

    // Get user info by deviceId
    getUserByDevice(browserDeviceId) {
        return this.links.byDeviceId[browserDeviceId] || null;
    }

    // Get all links for a user
    getUserLinks(userId) {
        return this.links.byUserId[userId] || null;
    }

    // Unlink a device from user
    unlinkDevice(userId, browserDeviceId) {
        if (this.links.byUserId[userId]) {
            this.links.byUserId[userId].deviceIds =
                this.links.byUserId[userId].deviceIds.filter(id => id !== browserDeviceId);
        }
        if (this.links.byDeviceId[browserDeviceId]) {
            delete this.links.byDeviceId[browserDeviceId];
        }
        saveJSON(userDeviceLinksPath, this.links);
        return { success: true };
    }
}

// ============ Subscriptions Manager ============

class SubscriptionsManager {
    constructor() {
        this.subscriptions = loadJSON(subscriptionsPath, {});
    }

    // Create or update subscription for a user
    createSubscription(userId, plan, paymentDetails = {}) {
        this.subscriptions[userId] = {
            id: crypto.randomBytes(8).toString('hex'),
            userId: userId,
            plan: plan,
            status: 'active',
            createdAt: new Date().toISOString(),
            expiresAt: this.calculateExpiry(plan),
            paymentMethod: paymentDetails.method || 'unknown',
            paymentId: paymentDetails.paymentId || null,
            amount: paymentDetails.amount || 0
        };
        saveJSON(subscriptionsPath, this.subscriptions);
        return { success: true, subscription: this.subscriptions[userId] };
    }

    // Get subscription by userId
    getByUserId(userId) {
        return this.subscriptions[userId] || null;
    }

    // Get subscription by deviceId (through links)
    getByDeviceId(browserDeviceId, userDeviceLinks) {
        const userId = userDeviceLinks.getUserIdFromDevice(browserDeviceId);
        if (!userId) return null;
        return this.subscriptions[userId] || null;
    }

    // Calculate expiry based on plan
    calculateExpiry(plan) {
        const now = new Date();
        switch(plan) {
            case 'monthly':
            case 'pro':
                return new Date(now.setMonth(now.getMonth() + 1)).toISOString();
            case 'yearly':
            case 'premium':
                return new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
            case 'lifetime':
                return new Date(now.setFullYear(now.getFullYear() + 100)).toISOString();
            default:
                return new Date(now.setMonth(now.getMonth() + 1)).toISOString();
        }
    }

    // Update subscription status
    updateStatus(userId, status) {
        if (this.subscriptions[userId]) {
            this.subscriptions[userId].status = status;
            this.subscriptions[userId].updatedAt = new Date().toISOString();
            saveJSON(subscriptionsPath, this.subscriptions);
            return { success: true };
        }
        return { success: false, error: 'Subscription not found' };
    }

    // Check if user has active subscription
    isActive(userId) {
        const sub = this.subscriptions[userId];
        if (!sub) return false;
        if (sub.status !== 'active') return false;
        if (new Date(sub.expiresAt) < new Date()) return false;
        return true;
    }

    // Get all subscriptions (for admin)
    getAll() {
        return this.subscriptions;
    }
}

// ============ WebAuthn/Biometric Authentication ============

class WebAuthnService {
    constructor() {
        this.credentials = loadJSON(credentialsPath, {});
        this.credentialUserMap = loadJSON(credentialUserMapPath, {}); // credentialId -> {userId, email, name}
        this.challenges = new Map(); // Temporary storage for challenges
    }

    // Generate registration options for WebAuthn (Passkey/Discoverable Credential)
    generateRegistrationOptions(userId, userEmail, userName) {
        const challenge = crypto.randomBytes(32);
        const challengeBase64 = challenge.toString('base64url');

        // Store challenge temporarily (expires in 5 minutes)
        this.challenges.set(userId, {
            challenge: challengeBase64,
            expires: Date.now() + 5 * 60 * 1000,
            type: 'registration',
            email: userEmail,
            name: userName
        });

        // Get the RP ID from environment or use default
        const rpId = process.env.WEBAUTHN_RP_ID || 'doz.com';

        return {
            challenge: challengeBase64,
            rp: {
                name: 'DOZ UP',
                id: rpId
            },
            user: {
                id: Buffer.from(userId).toString('base64url'),
                name: userEmail,
                displayName: userName || userEmail
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },   // ES256
                { type: 'public-key', alg: -257 }  // RS256
            ],
            timeout: 60000,
            attestation: 'none',
            authenticatorSelection: {
                authenticatorAttachment: 'platform', // Use platform authenticator (Face ID, Touch ID, Windows Hello)
                userVerification: 'required',
                residentKey: 'required',  // REQUIRED for passwordless login - stores credential on device
                requireResidentKey: true  // Backwards compatibility
            },
            // Exclude existing credentials to prevent duplicate registration
            excludeCredentials: (this.credentials[userId] || []).map(c => ({
                type: 'public-key',
                id: c.rawId,
                transports: c.transports
            }))
        };
    }

    // Verify and store registration
    async verifyRegistration(userId, credential) {
        const challengeData = this.challenges.get(userId);
        if (!challengeData || challengeData.type !== 'registration') {
            return { success: false, error: 'Invalid or expired challenge' };
        }

        if (Date.now() > challengeData.expires) {
            this.challenges.delete(userId);
            return { success: false, error: 'Challenge expired' };
        }

        // In production, verify the attestation properly
        // For now, we trust the client and store the credential

        if (!this.credentials[userId]) {
            this.credentials[userId] = [];
        }

        // Handle both old format (publicKey) and new WebAuthn format (attestationObject)
        const credentialRecord = {
            id: credential.id,
            rawId: credential.rawId,
            // Store attestation data for future verification
            clientDataJSON: credential.response.clientDataJSON,
            attestationObject: credential.response.attestationObject,
            // Also store publicKey if provided (backwards compatibility)
            publicKey: credential.response.publicKey || credential.response.attestationObject,
            counter: 0,
            transports: credential.response.transports || ['internal'],
            createdAt: new Date().toISOString(),
            name: credential.authenticatorName || 'Biometric',
            lastUsed: null
        };

        this.credentials[userId].push(credentialRecord);
        saveJSON(credentialsPath, this.credentials);

        // Store credential-to-user mapping for passwordless login
        this.credentialUserMap[credential.id] = {
            userId: userId,
            email: challengeData.email,
            name: challengeData.name,
            createdAt: new Date().toISOString()
        };
        saveJSON(credentialUserMapPath, this.credentialUserMap);

        this.challenges.delete(userId);

        return { success: true, credentialId: credential.id };
    }

    // Generate authentication options for PASSWORDLESS login (no userId needed!)
    generatePasswordlessAuthOptions() {
        const challenge = crypto.randomBytes(32);
        const challengeBase64 = challenge.toString('base64url');
        const challengeId = crypto.randomBytes(16).toString('hex');

        // Store challenge with a temporary ID
        this.challenges.set('passwordless_' + challengeId, {
            challenge: challengeBase64,
            expires: Date.now() + 5 * 60 * 1000,
            type: 'passwordless'
        });

        const rpId = process.env.WEBAUTHN_RP_ID || 'doz.com';

        return {
            success: true,
            challengeId: challengeId,
            options: {
                challenge: challengeBase64,
                rpId: rpId,
                timeout: 60000,
                userVerification: 'required'
                // NO allowCredentials - browser will find discoverable credentials automatically
            }
        };
    }

    // Verify passwordless authentication and return user info
    async verifyPasswordlessAuth(challengeId, credential) {
        const challengeKey = 'passwordless_' + challengeId;
        const challengeData = this.challenges.get(challengeKey);

        if (!challengeData || challengeData.type !== 'passwordless') {
            return { success: false, error: 'Invalid or expired challenge' };
        }

        if (Date.now() > challengeData.expires) {
            this.challenges.delete(challengeKey);
            return { success: false, error: 'Challenge expired' };
        }

        // Look up user from credential ID
        const userInfo = this.credentialUserMap[credential.id];
        if (!userInfo) {
            return { success: false, error: 'Credential not recognized. Please register biometric first.' };
        }

        const userId = userInfo.userId;
        const userCredentials = this.credentials[userId] || [];
        const matchingCred = userCredentials.find(c => c.id === credential.id);

        if (!matchingCred) {
            return { success: false, error: 'Credential not found for user' };
        }

        // In production, verify the signature properly
        // Update last used
        matchingCred.lastUsed = new Date().toISOString();
        matchingCred.counter++;
        saveJSON(credentialsPath, this.credentials);
        this.challenges.delete(challengeKey);

        // Return user info for automatic login
        return {
            success: true,
            userId: userInfo.userId,
            email: userInfo.email,
            name: userInfo.name
        };
    }

    // Get user from credential ID (for lookup)
    getUserFromCredential(credentialId) {
        return this.credentialUserMap[credentialId] || null;
    }

    // Generate authentication options (when userId is known)
    generateAuthenticationOptions(userId) {
        const userCredentials = this.credentials[userId] || [];

        if (userCredentials.length === 0) {
            return { success: false, error: 'No credentials registered' };
        }

        const challenge = crypto.randomBytes(32);
        const challengeBase64 = challenge.toString('base64url');

        this.challenges.set(userId, {
            challenge: challengeBase64,
            expires: Date.now() + 5 * 60 * 1000,
            type: 'authentication'
        });

        const rpId = process.env.WEBAUTHN_RP_ID || 'doz.com';

        return {
            success: true,
            options: {
                challenge: challengeBase64,
                rpId: rpId,
                timeout: 60000,
                userVerification: 'required',
                allowCredentials: userCredentials.map(cred => ({
                    type: 'public-key',
                    id: cred.rawId,
                    transports: cred.transports
                }))
            }
        };
    }

    // Verify authentication
    async verifyAuthentication(userId, credential) {
        const challengeData = this.challenges.get(userId);
        if (!challengeData || challengeData.type !== 'authentication') {
            return { success: false, error: 'Invalid or expired challenge' };
        }

        if (Date.now() > challengeData.expires) {
            this.challenges.delete(userId);
            return { success: false, error: 'Challenge expired' };
        }

        const userCredentials = this.credentials[userId] || [];
        const matchingCred = userCredentials.find(c => c.id === credential.id);

        if (!matchingCred) {
            return { success: false, error: 'Credential not found' };
        }

        // In production, verify the signature properly
        // Update last used
        matchingCred.lastUsed = new Date().toISOString();
        matchingCred.counter++;
        saveJSON(credentialsPath, this.credentials);
        this.challenges.delete(userId);

        return { success: true };
    }

    // Check if user has biometric credentials
    hasBiometricCredentials(userId) {
        return (this.credentials[userId] || []).length > 0;
    }

    // Get user's credentials (for display)
    getCredentials(userId) {
        return (this.credentials[userId] || []).map(c => ({
            id: c.id,
            name: c.name,
            createdAt: c.createdAt,
            lastUsed: c.lastUsed
        }));
    }

    // Remove a credential
    removeCredential(userId, credentialId) {
        if (!this.credentials[userId]) return { success: false };

        this.credentials[userId] = this.credentials[userId].filter(c => c.id !== credentialId);
        saveJSON(credentialsPath, this.credentials);

        return { success: true };
    }
}

// ============ Cross-Device Login Confirmation ============

class LoginConfirmationService {
    constructor(deviceManager) {
        this.deviceManager = deviceManager;
        this.pendingRequests = loadJSON(loginRequestsPath, {});
        this.sessions = loadJSON(sessionsPath, {});

        // Clean up expired requests periodically
        setInterval(() => this.cleanupExpiredRequests(), 60000);
    }

    // Create a login request that needs confirmation
    createLoginRequest(userId, newDeviceInfo) {
        const requestId = crypto.randomBytes(16).toString('hex');

        const request = {
            id: requestId,
            userId: userId,
            newDevice: {
                name: this.deviceManager.generateDeviceName(newDeviceInfo),
                platform: newDeviceInfo.platform,
                browser: newDeviceInfo.browser,
                ipAddress: newDeviceInfo.ipAddress,
                location: newDeviceInfo.location
            },
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
        };

        if (!this.pendingRequests[userId]) {
            this.pendingRequests[userId] = [];
        }

        this.pendingRequests[userId].push(request);
        saveJSON(loginRequestsPath, this.pendingRequests);

        return request;
    }

    // Get pending requests for a user
    getPendingRequests(userId) {
        const requests = this.pendingRequests[userId] || [];
        const now = new Date().toISOString();

        return requests.filter(r =>
            r.status === 'pending' && r.expiresAt > now
        );
    }

    // Approve a login request (from trusted device)
    approveRequest(userId, requestId, approverDeviceId) {
        const requests = this.pendingRequests[userId] || [];
        const request = requests.find(r => r.id === requestId);

        if (!request) {
            return { success: false, error: 'Request not found' };
        }

        if (request.status !== 'pending') {
            return { success: false, error: 'Request already processed' };
        }

        if (new Date(request.expiresAt) < new Date()) {
            return { success: false, error: 'Request expired' };
        }

        request.status = 'approved';
        request.approvedBy = approverDeviceId;
        request.approvedAt = new Date().toISOString();

        saveJSON(loginRequestsPath, this.pendingRequests);

        return { success: true, request };
    }

    // Deny a login request
    denyRequest(userId, requestId, reason = 'User denied') {
        const requests = this.pendingRequests[userId] || [];
        const request = requests.find(r => r.id === requestId);

        if (!request) {
            return { success: false, error: 'Request not found' };
        }

        request.status = 'denied';
        request.deniedReason = reason;
        request.deniedAt = new Date().toISOString();

        saveJSON(loginRequestsPath, this.pendingRequests);

        return { success: true };
    }

    // Check if a request is approved
    isRequestApproved(userId, requestId) {
        const requests = this.pendingRequests[userId] || [];
        const request = requests.find(r => r.id === requestId);

        return request?.status === 'approved';
    }

    // Cleanup expired requests
    cleanupExpiredRequests() {
        const now = new Date().toISOString();

        for (const userId in this.pendingRequests) {
            this.pendingRequests[userId] = this.pendingRequests[userId].filter(r =>
                r.expiresAt > now || r.status !== 'pending'
            );
        }

        saveJSON(loginRequestsPath, this.pendingRequests);
    }

    // Create a session after successful login
    createSession(userId, deviceInfo) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = crypto.randomBytes(64).toString('hex');

        const session = {
            id: sessionId,
            token: token,
            userId: userId,
            deviceId: deviceInfo.deviceId,
            deviceName: this.deviceManager.generateDeviceName(deviceInfo),
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            lastActive: new Date().toISOString()
        };

        if (!this.sessions[userId]) {
            this.sessions[userId] = [];
        }

        this.sessions[userId].push(session);
        saveJSON(sessionsPath, this.sessions);

        return session;
    }

    // Validate session
    validateSession(userId, token) {
        const sessions = this.sessions[userId] || [];
        const session = sessions.find(s => s.token === token);

        if (!session) {
            return { valid: false, error: 'Session not found' };
        }

        if (new Date(session.expiresAt) < new Date()) {
            return { valid: false, error: 'Session expired' };
        }

        // Update last active
        session.lastActive = new Date().toISOString();
        saveJSON(sessionsPath, this.sessions);

        return { valid: true, session };
    }

    // Revoke session
    revokeSession(userId, sessionId) {
        if (!this.sessions[userId]) return { success: false };

        this.sessions[userId] = this.sessions[userId].filter(s => s.id !== sessionId);
        saveJSON(sessionsPath, this.sessions);

        return { success: true };
    }

    // Get active sessions
    getActiveSessions(userId) {
        const sessions = this.sessions[userId] || [];
        const now = new Date().toISOString();

        return sessions.filter(s => s.expiresAt > now).map(s => ({
            id: s.id,
            deviceName: s.deviceName,
            createdAt: s.createdAt,
            lastActive: s.lastActive
        }));
    }
}

// ============ Main Auth Service ============

class AuthSecurityService {
    constructor() {
        this.totp = new TOTPService();
        this.devices = new DeviceManager();
        this.webauthn = new WebAuthnService();
        this.loginConfirmation = new LoginConfirmationService(this.devices);
        this.userDeviceLinks = new UserDeviceLinksManager();
        this.subscriptions = new SubscriptionsManager();
        this.users = loadJSON(usersPath, {});

        // Debug: Log loaded user for password reset verification
        const debugUser = Object.values(this.users).find(u => u.email === 'dr.boss0101@gmail.com');
        if (debugUser) {
            console.log('[Auth] Loaded user dr.boss0101@gmail.com hash prefix:', debugUser.passwordHash?.substring(0, 32));
        }
    }

    // Link browser deviceId to user account
    linkBrowserDevice(userId, browserDeviceId) {
        const user = this.users[userId];
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        return this.userDeviceLinks.linkDevice(userId, browserDeviceId, user.email);
    }

    // Get user account data by email or userId
    getAccountData(identifier) {
        let userId = identifier;
        let user = this.users[userId];

        // If not found by userId, try to find by email
        if (!user) {
            for (const [id, u] of Object.entries(this.users)) {
                if (u.email === identifier.toLowerCase()) {
                    userId = id;
                    user = u;
                    break;
                }
            }
        }

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        const deviceLinks = this.userDeviceLinks.getUserLinks(userId);
        const subscription = this.subscriptions.getByUserId(userId);

        return {
            success: true,
            user: {
                id: userId,
                email: user.email,
                name: user.name,
                createdAt: user.createdAt
            },
            linkedDevices: deviceLinks?.deviceIds || [],
            subscription: subscription,
            isSubscriptionActive: this.subscriptions.isActive(userId)
        };
    }

    // Get account data by browser deviceId
    getAccountByDevice(browserDeviceId) {
        const link = this.userDeviceLinks.getUserByDevice(browserDeviceId);
        if (!link) {
            return { success: false, error: 'Device not linked to any account' };
        }
        return this.getAccountData(link.userId);
    }

    // Create subscription for user
    createSubscription(userId, plan, paymentDetails = {}) {
        const user = this.users[userId];
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        return this.subscriptions.createSubscription(userId, plan, paymentDetails);
    }

    // Register a new user
    registerUser(email, password = null, name = null) {
        const userId = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 24);

        if (this.users[userId]) {
            return { success: false, error: 'User already exists' };
        }

        this.users[userId] = {
            id: userId,
            email: email.toLowerCase(),
            name: name || email.split('@')[0],
            passwordHash: password ? this.hashPassword(password) : null,
            createdAt: new Date().toISOString(),
            settings: {
                requireBiometric: false,
                requireTOTP: false,
                requireDeviceConfirmation: true
            }
        };

        saveJSON(usersPath, this.users);
        return { success: true, userId, name: this.users[userId].name };
    }

    // Hash password
    hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return `${salt}:${hash}`;
    }

    // Verify password
    verifyPassword(password, storedHash) {
        const [salt, hash] = storedHash.split(':');
        const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return hash === verifyHash;
    }

    // Main login flow
    async login(email, password, deviceInfo, additionalAuth = {}) {
        // Always reload users from file to get latest passwords
        this.users = loadJSON(usersPath, {});

        const userId = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 24);
        const user = this.users[userId];

        console.log('[Login Debug] Email:', email);
        console.log('[Login Debug] UserId:', userId);
        console.log('[Login Debug] User found:', !!user);
        console.log('[Login Debug] Password provided:', !!password, 'Length:', password ? password.length : 0);

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        console.log('[Login Debug] Stored hash exists:', !!user.passwordHash);

        // Step 1: Verify password (if set)
        if (user.passwordHash && password) {
            const isValid = this.verifyPassword(password, user.passwordHash);
            console.log('[Login Debug] Password verification result:', isValid);
            if (!isValid) {
                return { success: false, error: 'Invalid password' };
            }
        }

        // Step 2: Check device
        const deviceFingerprint = this.devices.generateFingerprint(deviceInfo);
        const isKnownDevice = this.devices.isDeviceKnown(userId, deviceFingerprint);
        const isTrustedDevice = this.devices.isDeviceTrusted(userId, deviceFingerprint);

        // Step 3: Check required authentication methods
        const requirements = [];

        // TOTP required?
        if (user.settings.requireTOTP && this.totp.isTOTPEnabled(userId)) {
            if (!additionalAuth.totpCode) {
                requirements.push('totp');
            } else if (!this.totp.verifyTOTP(userId, additionalAuth.totpCode)) {
                return { success: false, error: 'Invalid TOTP code' };
            }
        }

        // Biometric required?
        if (user.settings.requireBiometric && this.webauthn.hasBiometricCredentials(userId)) {
            if (!additionalAuth.biometricVerified) {
                requirements.push('biometric');
            }
        }

        // Device confirmation required for new devices?
        // But only if the user HAS trusted devices - otherwise they can never login!
        const trustedDevices = this.devices.getTrustedDevices(userId);
        const hasTrustedDevices = trustedDevices && trustedDevices.length > 0;

        if (!isTrustedDevice && user.settings.requireDeviceConfirmation && hasTrustedDevices) {
            if (!additionalAuth.deviceConfirmationApproved) {
                // Create a pending login request
                const request = this.loginConfirmation.createLoginRequest(userId, deviceInfo);
                return {
                    success: false,
                    requiresConfirmation: true,
                    requestId: request.id,
                    error: 'Please confirm this login from a trusted device',
                    message: 'Please confirm this login from a trusted device'
                };
            }
        }

        // If there are requirements, return them
        if (requirements.length > 0) {
            return {
                success: false,
                requiresAdditionalAuth: true,
                requirements: requirements
            };
        }

        // Step 4: All checks passed - create session
        const device = this.devices.registerDevice(userId, deviceInfo);

        // Auto-trust first device if user has no trusted devices yet
        if (!hasTrustedDevices) {
            this.devices.trustDevice(userId, device.id);
            console.log(`[Auth] Auto-trusted first device for user ${userId.substring(0, 8)}...`);
        }

        const session = this.loginConfirmation.createSession(userId, {
            ...deviceInfo,
            deviceId: device.id
        });

        return {
            success: true,
            userId: userId,
            email: user.email,
            name: user.name || user.email.split('@')[0],
            sessionToken: session.token,
            deviceId: device.id,
            isNewDevice: !isKnownDevice,
            deviceAutoTrusted: !hasTrustedDevices
        };
    }

    // Setup biometric authentication
    setupBiometric(userId) {
        const user = this.users[userId];
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        return this.webauthn.generateRegistrationOptions(userId, user.email, user.email);
    }

    // Complete biometric setup
    async completeBiometricSetup(userId, credential) {
        return await this.webauthn.verifyRegistration(userId, credential);
    }

    // Authenticate with biometric
    async authenticateWithBiometric(userId, credential) {
        return await this.webauthn.verifyAuthentication(userId, credential);
    }

    // Get biometric authentication options
    getBiometricAuthOptions(userId) {
        return this.webauthn.generateAuthenticationOptions(userId);
    }

    // ============ PASSWORDLESS BIOMETRIC LOGIN (No email needed!) ============

    // Get passwordless auth options - call this first, no user info needed
    getPasswordlessAuthOptions() {
        return this.webauthn.generatePasswordlessAuthOptions();
    }

    // Complete passwordless login - returns user info and creates session
    async passwordlessLogin(challengeId, credential, deviceInfo = {}) {
        // Verify the biometric and get user info
        const result = await this.webauthn.verifyPasswordlessAuth(challengeId, credential);

        if (!result.success) {
            return result;
        }

        // Get full user data
        const user = this.users[result.userId];
        if (!user) {
            return { success: false, error: 'User account not found' };
        }

        // Register/update device
        const device = this.devices.registerDevice(result.userId, deviceInfo);

        // Create session
        const session = this.loginConfirmation.createSession(result.userId, {
            ...deviceInfo,
            deviceId: device.id
        });

        console.log(`[Auth] Passwordless login successful for ${result.email}`);

        return {
            success: true,
            userId: result.userId,
            email: result.email,
            name: result.name || user.name || result.email.split('@')[0],
            sessionToken: session.token,
            deviceId: device.id,
            loginMethod: 'biometric'
        };
    }

    // Check if any passkeys are registered (for UI hint)
    hasAnyPasskeys() {
        return Object.keys(this.webauthn.credentialUserMap || {}).length > 0;
    }

    // Setup TOTP
    setupTOTP(userId) {
        const user = this.users[userId];
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        const secret = this.totp.generateSecret(userId);
        const qrUrl = this.totp.getQRCodeUrl(userId, user.email);

        return {
            success: true,
            secret: secret,
            qrUrl: qrUrl
        };
    }

    // Enable TOTP
    enableTOTP(userId, code) {
        return this.totp.enableTOTP(userId, code);
    }

    // Verify TOTP
    verifyTOTP(userId, code) {
        return this.totp.verifyTOTP(userId, code);
    }

    // Get user's trusted devices
    getTrustedDevices(userId) {
        return this.devices.getDevices(userId);
    }

    // Trust a device
    trustDevice(userId, deviceId) {
        return this.devices.trustDevice(userId, deviceId);
    }

    // Remove a device
    removeDevice(userId, deviceId) {
        return this.devices.removeDevice(userId, deviceId);
    }

    // Get pending login requests
    getPendingLoginRequests(userId) {
        return this.loginConfirmation.getPendingRequests(userId);
    }

    // Approve login from another device
    approveLogin(userId, requestId, approverDeviceId) {
        return this.loginConfirmation.approveRequest(userId, requestId, approverDeviceId);
    }

    // Deny login request
    denyLogin(userId, requestId) {
        return this.loginConfirmation.denyRequest(userId, requestId);
    }

    // Get active sessions
    getActiveSessions(userId) {
        return this.loginConfirmation.getActiveSessions(userId);
    }

    // Revoke a session
    revokeSession(userId, sessionId) {
        return this.loginConfirmation.revokeSession(userId, sessionId);
    }

    // Update security settings
    updateSecuritySettings(userId, settings) {
        const user = this.users[userId];
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        user.settings = { ...user.settings, ...settings };
        saveJSON(usersPath, this.users);

        return { success: true, settings: user.settings };
    }

    // Get security status
    getSecurityStatus(userId) {
        const user = this.users[userId];
        if (!user) {
            return null;
        }

        return {
            totpEnabled: this.totp.isTOTPEnabled(userId),
            biometricEnabled: this.webauthn.hasBiometricCredentials(userId),
            trustedDevices: this.devices.getDevices(userId).filter(d => d.trusted).length,
            totalDevices: this.devices.getDevices(userId).length,
            activeSessions: this.loginConfirmation.getActiveSessions(userId).length,
            settings: user.settings
        };
    }

    // ============ PASSWORD RESET ============

    // Load password reset tokens
    loadPasswordResetTokens() {
        return loadJSON(passwordResetPath, {});
    }

    // Save password reset tokens
    savePasswordResetTokens(tokens) {
        saveJSON(passwordResetPath, tokens);
    }

    // Generate password reset token
    generatePasswordResetToken(email) {
        const userId = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 24);
        const user = this.users[userId];

        // Always return success to prevent email enumeration
        if (!user) {
            console.log('[Auth] Password reset requested for non-existent email:', email);
            return { success: true, message: 'If an account exists, a reset email will be sent' };
        }

        // Generate secure token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiry

        // Store token
        const tokens = this.loadPasswordResetTokens();
        tokens[token] = {
            userId: userId,
            email: email.toLowerCase(),
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt,
            used: false
        };
        this.savePasswordResetTokens(tokens);

        console.log('[Auth] Password reset token generated for:', email);

        return {
            success: true,
            token: token,
            email: email.toLowerCase(),
            userId: userId,
            expiresAt: expiresAt,
            message: 'If an account exists, a reset email will be sent'
        };
    }

    // Verify password reset token
    verifyPasswordResetToken(token) {
        const tokens = this.loadPasswordResetTokens();
        const tokenData = tokens[token];

        if (!tokenData) {
            return { valid: false, error: 'Invalid or expired token' };
        }

        if (tokenData.used) {
            return { valid: false, error: 'Token has already been used' };
        }

        if (new Date(tokenData.expiresAt) < new Date()) {
            return { valid: false, error: 'Token has expired' };
        }

        return {
            valid: true,
            userId: tokenData.userId,
            email: tokenData.email
        };
    }

    // Reset password with token
    resetPassword(token, newPassword) {
        const verification = this.verifyPasswordResetToken(token);

        if (!verification.valid) {
            return { success: false, error: verification.error };
        }

        const user = this.users[verification.userId];
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // Update password
        user.passwordHash = this.hashPassword(newPassword);
        user.passwordChangedAt = new Date().toISOString();
        saveJSON(usersPath, this.users);

        // Mark token as used
        const tokens = this.loadPasswordResetTokens();
        tokens[token].used = true;
        tokens[token].usedAt = new Date().toISOString();
        this.savePasswordResetTokens(tokens);

        console.log('[Auth] Password reset successful for:', verification.email);

        return {
            success: true,
            message: 'Password has been reset successfully'
        };
    }

    // Clean up expired tokens (call periodically)
    cleanupExpiredPasswordResetTokens() {
        const tokens = this.loadPasswordResetTokens();
        const now = new Date();
        let cleaned = 0;

        for (const token of Object.keys(tokens)) {
            if (new Date(tokens[token].expiresAt) < now || tokens[token].used) {
                // Keep used tokens for 24 hours for audit
                if (tokens[token].used) {
                    const usedAt = new Date(tokens[token].usedAt || tokens[token].expiresAt);
                    if (now - usedAt > 24 * 60 * 60 * 1000) {
                        delete tokens[token];
                        cleaned++;
                    }
                } else {
                    delete tokens[token];
                    cleaned++;
                }
            }
        }

        if (cleaned > 0) {
            this.savePasswordResetTokens(tokens);
            console.log(`[Auth] Cleaned up ${cleaned} expired password reset tokens`);
        }
    }
}

// Export singleton
module.exports = new AuthSecurityService();
module.exports.AuthSecurityService = AuthSecurityService;
module.exports.TOTPService = TOTPService;
module.exports.DeviceManager = DeviceManager;
module.exports.WebAuthnService = WebAuthnService;
module.exports.LoginConfirmationService = LoginConfirmationService;
module.exports.UserDeviceLinksManager = UserDeviceLinksManager;
module.exports.SubscriptionsManager = SubscriptionsManager;
