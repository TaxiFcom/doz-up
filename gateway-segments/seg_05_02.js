        // Track specific events
        if (telemetry.event === 'heartbeat') {
            device.heartbeats++;
            device.lastHeartbeat = new Date().toISOString();
            device.trayStatus = telemetry.trayStatus;
            device.heapUsed = telemetry.heapUsed;
        }

        if (telemetry.event === 'crash' || telemetry.event === 'error') {
            device.crashes++;
            db.crashes.unshift({
                deviceId,
                event: telemetry.event,
                error: telemetry.error,
                stack: telemetry.stack,
                timestamp: new Date().toISOString(),
                version: telemetry.version
            });

            // Keep last 1000 crashes
            if (db.crashes.length > 1000) {
                db.crashes = db.crashes.slice(0, 1000);
            }

            // Record issue for this device
            device.issues.push({
                type: telemetry.event,
                error: telemetry.error,
                timestamp: new Date().toISOString()
            });

            // Keep last 50 issues per device
            if (device.issues.length > 50) {
                device.issues = device.issues.slice(-50);
            }
        }

        if (telemetry.event === 'tray_recreated') {
            if (!device.trayRecreations) device.trayRecreations = 0;
            device.trayRecreations++;
        }

        saveTelemetryDb(db);

        // Return diagnostics/commands for the app
        const response = { success: true };

        // Auto-fix commands based on issues
        if (device.crashes > 5 && device.version !== '2.0.0') {
            response.command = 'update';
            response.message = 'Please update to latest version';
        }

        res.json(response);
    } catch (e) {
        console.error('[Telemetry] Error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Receive user feedback
app.post('/api/feedback', express.json(), (req, res) => {
    try {
        const { deviceId, rating, comment, version } = req.body;
        const db = loadFeedbackDb();

        db.feedback.unshift({
            id: uuidv4(),
            deviceId: deviceId || 'unknown',
            rating: rating, // 1-5 emoji rating
            comment: comment || '',
            version: version || 'unknown',
            timestamp: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress
        });

        // Keep last 1000 feedback entries
        if (db.feedback.length > 1000) {
            db.feedback = db.feedback.slice(0, 1000);
        }

        saveFeedbackDb(db);
        res.json({ success: true, message: 'Thank you for your feedback!' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: Get telemetry dashboard
app.get('/api/admin/telemetry', (req, res) => {
    try {
        const db = loadTelemetryDb();
        const feedbackDb = loadFeedbackDb();

        // Get device stats
        const devices = Object.entries(db.devices).map(([id, data]) => ({
            id: id.substring(0, 16) + '...',
            fullId: id,
            ...data
        }));

        // Sort by last seen
        devices.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

        // Calculate stats
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const oneDay = 24 * oneHour;

        const activeLastHour = devices.filter(d => (now - new Date(d.lastSeen).getTime()) < oneHour).length;
        const activeLastDay = devices.filter(d => (now - new Date(d.lastSeen).getTime()) < oneDay).length;

        // Count versions
        const versions = {};
        devices.forEach(d => {
            versions[d.version] = (versions[d.version] || 0) + 1;
        });

        // Recent crashes
        const recentCrashes = db.crashes.slice(0, 20);

        // Crash rate (crashes per device in last 24h)
        const crashesLast24h = db.crashes.filter(c => (now - new Date(c.timestamp).getTime()) < oneDay).length;
        const crashRate = activeLastDay > 0 ? (crashesLast24h / activeLastDay).toFixed(2) : 0;

        // Feedback stats
        const recentFeedback = feedbackDb.feedback.slice(0, 10);
        const avgRating = feedbackDb.feedback.length > 0
            ? (feedbackDb.feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / feedbackDb.feedback.length).toFixed(1)
            : 0;

        res.json({
            success: true,
            stats: {
                totalDevices: devices.length,
                activeLastHour,
                activeLastDay,
                totalCrashes: db.crashes.length,
                crashesLast24h,
                crashRate,
                totalFeedback: feedbackDb.feedback.length,
                avgRating
            },
            versions,
            devices: devices.slice(0, 50),
            recentCrashes,
            recentFeedback,
            issues: db.issues?.slice(0, 20) || []
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: Get device telemetry details
app.get('/api/admin/telemetry/device/:deviceId', (req, res) => {
    try {
        const db = loadTelemetryDb();
        const device = db.devices[req.params.deviceId];

        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Get events for this device
        const events = db.events
            .filter(e => e.deviceId === req.params.deviceId)
            .slice(0, 100);

        // Get crashes for this device
        const crashes = db.crashes
            .filter(c => c.deviceId === req.params.deviceId)
            .slice(0, 50);

        res.json({
            success: true,
            device: { id: req.params.deviceId, ...device },
            events,
            crashes
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Admin: Get problematic devices (high crash rate)
app.get('/api/admin/telemetry/problematic', (req, res) => {
    try {
        const db = loadTelemetryDb();

        const problematic = Object.entries(db.devices)
            .filter(([id, data]) => data.crashes > 2 || data.trayRecreations > 5)
            .map(([id, data]) => ({
                deviceId: id,
                ...data
            }))
            .sort((a, b) => b.crashes - a.crashes);

        res.json({
            success: true,
            count: problematic.length,
            devices: problematic.slice(0, 50)
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Serve download page
app.get('/download', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});
app.get('/up/download', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// Serve electron-updater manifest files for auto-updates
app.get('/download/updates/:file', (req, res) => {
    const filename = req.params.file;
    const allowedFiles = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];

    if (!allowedFiles.includes(filename)) {
        return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(__dirname, 'public', 'download', 'updates', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Update manifest not found' });
    }

    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(filePath);
    console.log(`[Update] Served ${filename} for auto-update check`);
});

// Serve update binary files (for electron-updater downloads)
app.get('/download/updates/:filename.exe', (req, res) => {
    const filename = req.params.filename + '.exe';
    const filePath = path.join(__dirname, 'public', 'download', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Update file not found' });
    }

    res.sendFile(filePath);
    console.log(`[Update] Serving update binary: ${filename}`);
});

// Admin root redirect to login
app.get('/admin/', (req, res) => {
    res.redirect('/admin/login.html');
});

app.get('/admin', (req, res) => {
    res.redirect('/admin/login.html');
});

// Serve desktop app download with proper security headers
// Cache checksums to avoid reading entire file into memory on every request
const downloadChecksumCache = {};
app.get('/download/DOZ-UP-v:version.exe', async (req, res) => {
    const version = req.params.version;
    const filename = `DOZ-UP-v${version}.exe`;
    const filePath = path.join(__dirname, 'public', 'download', filename);

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Version not found' });
        }

        const stats = fs.statSync(filePath);
        const cacheKey = `${filename}-${stats.size}-${stats.mtimeMs}`;

        // Compute checksum once and cache it
        if (!downloadChecksumCache[cacheKey]) {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            await new Promise((resolve, reject) => {
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            downloadChecksumCache[cacheKey] = hash.digest('hex');
        }

        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': stats.size,
            'X-Content-Type-Options': 'nosniff',
            'X-Download-Checksum': downloadChecksumCache[cacheKey],
            'X-Download-Version': version,
            'Cache-Control': 'public, max-age=86400'
        });

        // HEAD requests: just send headers, don't stream file
        if (req.method === 'HEAD') return res.end();

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        console.log(`[Download] DOZ-UP v${version} downloaded - Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    } catch (error) {
        console.error('[Download] Error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Serve ZIP download (less browser warnings)
app.get('/download/DOZ-UP-v:version.zip', (req, res) => {
    const version = req.params.version;
    const filename = `DOZ-UP-v${version}.zip`;
    const filePath = path.join(__dirname, 'public', 'download', filename);

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Version not found' });
        }

        const stats = fs.statSync(filePath);

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400'
        });

        // HEAD requests: just send headers
        if (req.method === 'HEAD') return res.end();

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        console.log(`[Download] DOZ-UP v${version} ZIP downloaded - Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
    } catch (error) {
        console.error('[Download] ZIP Error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Get download info (version, size, checksum) for verification
app.get('/api/download/info', (req, res) => {
    const downloadDir = path.join(__dirname, 'public', 'download');
    const latestVersion = DOWNLOAD_VERSION; // Use latest available build version
    const filename = `DOZ-UP-v${latestVersion}.exe`;
    const filePath = path.join(downloadDir, filename);

    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Download not available' });
        }

        const stats = fs.statSync(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        res.json({
            success: true,
            version: latestVersion,
            filename: filename,
            size: stats.size,
            sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
            sha256: sha256,
            downloadUrl: `https://${HOST}/download/${filename}`,
            signed: true, // Signed with DOZ Network self-signed certificate
            lastModified: stats.mtime
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get download info' });
    }
});

// Serve "My Uploads" page (cabinet)
app.get('/my', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cabinet.html'));
});

// ============ AUTHENTICATION & SECURITY API ============
const authService = require('./services/auth-security');

// Session touch middleware - updates lastActive on every API request from authenticated users
app.use('/api', (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const sessionToken = req.headers['x-session-token'];
    if (userId && sessionToken) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
        authService.loginConfirmation.touchSession(userId, sessionToken, ip);
    }
    next();
});

// Concurrent usage detection endpoint
app.get('/api/auth/concurrent-check/:userId', (req, res) => {
    try {
        const result = authService.loginConfirmation.detectConcurrentUsage(req.params.userId);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revoke all other sessions (keep current)
app.post('/api/auth/sessions/revoke-others', express.json(), (req, res) => {
    try {
        const { userId, currentSessionId } = req.body;
        if (!userId || !currentSessionId) {
            return res.status(400).json({ success: false, error: 'userId and currentSessionId required' });
        }
        const result = authService.loginConfirmation.revokeAllOtherSessions(userId, currentSessionId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set up broadcastToUser global function for session eviction notifications
global.broadcastToUser = global.broadcastToUser || function(userId, data) {
    // Will be connected to WebSocket once admin WSS is available
    console.log(`[Session] Notification for ${userId}:`, data.type);
};

// Rate limiting for auth endpoints (15 requests per minute per IP)
const authRateLimits = new Map();
app.use('/api/auth', (req, res, next) => {
    // Only rate-limit write operations (login, register, password reset)
    if (req.method !== 'POST') return next();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const key = `auth:${ip}`;
    const now = Date.now();
    const window = 60000; // 1 minute
    const limit = 15;

    let entry = authRateLimits.get(key);
    if (!entry || now - entry.start > window) {
        entry = { start: now, count: 0 };
    }
    entry.count++;
    authRateLimits.set(key, entry);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));

    if (entry.count > limit) {
        return res.status(429).json({ error: 'Too many authentication attempts. Try again in 1 minute.' });
    }
    next();
});

// Register new user
app.post('/api/auth/register', express.json(), (req, res) => {
    try {
        const { email, password, name, browserDeviceId } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email required' });
        }
        const result = authService.registerUser(email, password, name);

        // Auto-link browser deviceId if provided
        if (result.success && browserDeviceId) {
            authService.linkBrowserDevice(result.userId, browserDeviceId);
            result.deviceLinked = true;
            console.log(`[Register] Linked device ${browserDeviceId.substring(0, 16)}... to new user ${result.userId.substring(0, 8)}...`);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/auth/login', express.json(), async (req, res) => {
    try {
        const { email, password, totpCode, biometricVerified, deviceConfirmationApproved, browserDeviceId } = req.body;
        const deviceInfo = {
            userAgent: req.headers['user-agent'],
            platform: req.body.platform || 'web',
            browser: req.body.browser,
            ipAddress: req.ip || req.connection?.remoteAddress,
            screenResolution: req.body.screenResolution,
            timezone: req.body.timezone,
            language: req.headers['accept-language']?.split(',')[0]
        };

        const result = await authService.login(email, password, deviceInfo, {
            totpCode, biometricVerified, deviceConfirmationApproved
        });

        console.log('[Login] Result:', JSON.stringify({ success: result.success, userId: result.userId, hasToken: !!result.sessionToken, error: result.error }));

        // Auto-link browser deviceId if login successful and deviceId provided
        if (result.success && browserDeviceId) {
            authService.linkBrowserDevice(result.userId, browserDeviceId);
            result.deviceLinked = true;
            console.log(`[Login] Linked device ${browserDeviceId.substring(0, 16)}... to user ${result.userId.substring(0, 8)}...`);
        }

        res.json(result);
