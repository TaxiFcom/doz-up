});

// Enable TOTP (verify and activate)
app.post('/api/auth/totp/enable', express.json(), (req, res) => {
    try {
        const { userId, code } = req.body;
        const result = authService.enableTOTP(userId, code);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify TOTP code
app.post('/api/auth/totp/verify', express.json(), (req, res) => {
    try {
        const { userId, code } = req.body;
        const valid = authService.verifyTOTP(userId, code);
        res.json({ success: true, valid });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get trusted devices
app.get('/api/auth/devices/:userId', (req, res) => {
    try {
        const devices = authService.getTrustedDevices(req.params.userId);
        res.json({ success: true, devices });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Trust a device
app.post('/api/auth/devices/trust', express.json(), (req, res) => {
    try {
        const { userId, deviceId } = req.body;
        const result = authService.trustDevice(userId, deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove a device
app.delete('/api/auth/devices/:userId/:deviceId', (req, res) => {
    try {
        const result = authService.removeDevice(req.params.userId, req.params.deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get pending login requests (for trusted device to approve)
app.get('/api/auth/login-requests/:userId', (req, res) => {
    try {
        const requests = authService.getPendingLoginRequests(req.params.userId);
        res.json({ success: true, requests });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Approve login request
app.post('/api/auth/login-requests/approve', express.json(), (req, res) => {
    try {
        const { userId, requestId, approverDeviceId } = req.body;
        const result = authService.approveLogin(userId, requestId, approverDeviceId);

        // Notify waiting client via WebSocket
        if (result.success && global.notifyLoginApproved) {
            global.notifyLoginApproved(userId, requestId);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deny login request
app.post('/api/auth/login-requests/deny', express.json(), (req, res) => {
    try {
        const { userId, requestId } = req.body;
        const result = authService.denyLogin(userId, requestId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check login request status (for polling)
app.get('/api/auth/login-requests/:userId/:requestId/status', (req, res) => {
    try {
        const requests = authService.getPendingLoginRequests(req.params.userId);
        const request = requests.find(r => r.id === req.params.requestId);

        if (!request) {
            // Check if it was approved
            const approved = authService.loginConfirmation?.isRequestApproved(
                req.params.userId, req.params.requestId
            );
            res.json({ found: false, approved });
        } else {
            res.json({ found: true, status: request.status });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get active sessions
app.get('/api/auth/sessions/:userId', (req, res) => {
    try {
        const sessions = authService.getActiveSessions(req.params.userId);
        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke session (logout from device)
app.delete('/api/auth/sessions/:userId/:sessionId', (req, res) => {
    try {
        const result = authService.revokeSession(req.params.userId, req.params.sessionId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update security settings
app.put('/api/auth/settings/:userId', express.json(), (req, res) => {
    try {
        const result = authService.updateSecuritySettings(req.params.userId, req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get security status
app.get('/api/auth/security-status/:userId', (req, res) => {
    try {
        const status = authService.getSecurityStatus(req.params.userId);
        if (!status) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set security level (low/medium/high/maximum)
app.post('/api/auth/security-level', express.json(), (req, res) => {
    try {
        const { userId, level } = req.body;
        if (!userId || !level) {
            return res.status(400).json({ success: false, error: 'userId and level required' });
        }
        const result = authService.setSecurityLevel(userId, level);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if biometric is required for a sensitive action
app.get('/api/auth/biometric-required/:userId/:action', (req, res) => {
    try {
        const required = authService.requireBiometricForAction(req.params.userId, req.params.action);
        res.json({ success: true, required, action: req.params.action });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get security score (0-100)
app.get('/api/auth/security-score/:userId', (req, res) => {
    try {
        const score = authService.getSecurityScore(req.params.userId);
        const status = authService.getSecurityStatus(req.params.userId);
        res.json({ success: true, score, ...status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Biometric-first registration (no email/password required)
app.post('/api/auth/biometric-register', express.json(), (req, res) => {
    try {
        const { deviceId, credentialId, biometricType, publicKey } = req.body;

        if (!deviceId || !credentialId) {
            return res.status(400).json({ success: false, error: 'Device ID and credential ID required' });
        }

        // Create biometric-only user account
        const userId = deviceId;
        const user = {
            id: userId,
            type: 'biometric',
            biometricType: biometricType || 'unknown',
            credentialId: credentialId,
            publicKey: publicKey,
            createdAt: new Date().toISOString(),
            email: null, // Optional - can be added later
            name: null   // Optional - can be added later
        };

        // Store in auth service
        if (authService.webauthn) {
            authService.webauthn.storeCredential(userId, {
                credentialId: credentialId,
                publicKey: publicKey,
                biometricType: biometricType
            });
        }

        // Generate session token
        const token = require('crypto').randomBytes(32).toString('hex');
        const session = authService.createSession ?
            authService.createSession(userId, { biometric: true }) :
            { token, userId, createdAt: new Date().toISOString() };

        res.json({
            success: true,
            userId: userId,
            token: session.token || token,
            message: 'Biometric registration successful. Email and name are optional.'
        });
    } catch (error) {
        console.error('[Biometric Register] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ SESSION VALIDATION API ============

// Validate an existing session (used by auto-auth to persist logged-in state)
app.post('/api/auth/validate-session', express.json(), (req, res) => {
    try {
        const { userId, sessionToken } = req.body;

        if (!userId || !sessionToken) {
            return res.status(400).json({ valid: false, error: 'userId and sessionToken required' });
        }

        const result = authService.loginConfirmation.validateSession(userId, sessionToken);

        if (!result.valid) {
            return res.json({ valid: false, error: result.error });
        }

        // Return user info + subscription status
        const accountData = authService.getAccountData(userId);
        res.json({
            valid: true,
            user: accountData.success ? accountData.user : { id: userId },
            subscription: accountData.subscription || null,
            isSubscriptionActive: accountData.isSubscriptionActive || false
        });
    } catch (error) {
        console.error('[ValidateSession] Error:', error.message);
        res.status(500).json({ valid: false, error: 'Validation failed' });
    }
});

// ============ USER-DEVICE LINKING & SYNC API ============

// Link browser deviceId to user account (call after login/register)
app.post('/api/account/link-device', express.json(), (req, res) => {
    try {
        const { userId, browserDeviceId, email } = req.body;

        if (!userId || !browserDeviceId) {
            return res.status(400).json({
                success: false,
                error: 'userId and browserDeviceId are required'
            });
        }

        const result = authService.linkBrowserDevice(userId, browserDeviceId);

        if (result.success) {
            console.log(`[Sync] Linked device ${browserDeviceId.substring(0, 16)}... to user ${userId.substring(0, 8)}...`);
        }

        res.json(result);
    } catch (error) {
        console.error('[Link Device] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get account data by userId or email
app.get('/api/account/data/:identifier', (req, res) => {
    try {
        const result = authService.getAccountData(req.params.identifier);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get account data by browser deviceId
app.get('/api/account/by-device/:deviceId', (req, res) => {
    try {
        const result = authService.getAccountByDevice(req.params.deviceId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if device is known and has biometric credentials (for login page smart detection)
app.get('/api/auth/device-biometric-check/:deviceId', (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const accountData = authService.getAccountByDevice(deviceId);

        if (!accountData.success || !accountData.user) {
            return res.json({ success: true, knownDevice: false, hasBiometricCredentials: false });
        }

        const userId = accountData.user.id;
        const hasBiometric = authService.webauthn.hasBiometricCredentials(userId);

        res.json({
            success: true,
            knownDevice: true,
            hasBiometricCredentials: hasBiometric,
            email: accountData.user.email,
            name: accountData.user.name
        });
    } catch (error) {
        res.json({ success: true, knownDevice: false, hasBiometricCredentials: false });
    }
});

// Get user uploads by userId (aggregates uploads from all linked devices)
app.get('/api/account/uploads/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const accountData = authService.getAccountData(userId);

        if (!accountData.success) {
            return res.status(404).json(accountData);
        }

        // Get all device IDs linked to this user
        const deviceIds = accountData.linkedDevices || [];

        // Count physical devices from devices DB (not auth links which include web sessions)
        const devicesDb = await loadDevicesDb();
        let physicalDeviceCount = 0;
        for (const [uid, userData] of Object.entries(devicesDb.users || {})) {
            if (userData.devices && userData.devices.some(d => deviceIds.includes(d.deviceId))) {
                physicalDeviceCount = userData.devices.length;
                break;
            }
        }

        // Load uploads database
        const uploadsDb = await loadUploadsDb();

        // Get uploads from all linked devices
        const allUploads = uploadsDb.uploads.filter(upload =>
            deviceIds.includes(upload.deviceId)
        );

        // Deduplicate: same file size = same content (screenshots are identical bytes)
        // Keep the newest upload for each unique size
        const sortedByTime = [...allUploads].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const seenSizes = new Set();
        const dedupedUploads = sortedByTime.filter(u => {
            const key = u.size || 0;
            if (key === 0) return true; // keep uploads with unknown size
            if (seenSizes.has(key)) return false;
            seenSizes.add(key);
            return true;
        });

        // Enrich uploads with view counts from shares.json
        const shareViews = loadShareViews();
        const enrichedUploads = dedupedUploads.map(u => {
            // Normalize filename to match shares.json keys (without extension)
            const normalizedKey = u.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
            const views = shareViews[normalizedKey] ? shareViews[normalizedKey].views || 0 : 0;
            return { ...u, views };
        });

        res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=300');
        res.json({
            success: true,
            userId: userId,
            email: accountData.user.email,
            linkedDevices: physicalDeviceCount || deviceIds.length,
            uploads: enrichedUploads,
            totalUploads: enrichedUploads.length,
            totalSize: enrichedUploads.reduce((sum, u) => sum + (u.size || 0), 0)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get user stats by userId (aggregates stats from all linked devices)
app.get('/api/account/stats/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const accountData = authService.getAccountData(userId);

        if (!accountData.success) {
            return res.status(404).json(accountData);
        }

        const deviceIds = accountData.linkedDevices || [];

        // Count physical devices from devices DB (not auth links which include web sessions)
        const devicesDb = loadDevicesDb();
        let physicalDeviceCount = 0;
        for (const [uid, userData] of Object.entries(devicesDb.users)) {
            if (userData.devices.some(d => deviceIds.includes(d.deviceId))) {
                physicalDeviceCount = userData.devices.length;
                break;
            }
        }

        // Load uploads database
        const uploadsDb = loadUploadsDb();

        // Aggregate stats from all linked devices
        let totalUploads = 0;
        let totalSize = 0;
        let firstUpload = null;
        let lastUpload = null;

        uploadsDb.uploads.forEach(upload => {
            if (deviceIds.includes(upload.deviceId)) {
                totalUploads++;
                totalSize += upload.size || 0;
                if (!firstUpload || upload.timestamp < firstUpload) {
                    firstUpload = upload.timestamp;
                }
                if (!lastUpload || upload.timestamp > lastUpload) {
                    lastUpload = upload.timestamp;
                }
            }
        });

        res.json({
            success: true,
            userId: userId,
            email: accountData.user.email,
            name: accountData.user.name,
            subscription: accountData.subscription,
            isSubscriptionActive: accountData.isSubscriptionActive,
            stats: {
                linkedDevices: physicalDeviceCount || deviceIds.length,
                totalUploads: totalUploads,
                totalSize: totalSize,
                firstUpload: firstUpload,
                lastUpload: lastUpload,
                memberSince: accountData.user.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create subscription for user
app.post('/api/account/subscription', express.json(), (req, res) => {
    try {
        const { userId, plan, paymentDetails } = req.body;

        if (!userId || !plan) {
            return res.status(400).json({
                success: false,
                error: 'userId and plan are required'
            });
        }

        const result = authService.createSubscription(userId, plan, paymentDetails || {});
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get subscription by userId (uses unified plan resolver)
app.get('/api/account/subscription/:userId', (req, res) => {
    try {
        const plan = planResolver.resolvePlan(req.params.userId, null);
        res.json({
            success: true,
