        // Save to database using in-memory cache (instant for subsequent reads)
        const db = loadUploadsDb();

        const uploadRecord = {
            id: uploadId,
            filename: req.file.filename,
            url: imageUrl,
            deviceId: deviceId,
            userId: userId || null,
            timestamp: now,
            expiresAt: expiresAt,
            size: req.file.size,
            tier: isPaidUser ? 'paid' : 'free'
        };

        db.uploads.unshift(uploadRecord);

        // Track device
        if (!db.devices[deviceId]) {
            db.devices[deviceId] = { firstSeen: now, uploadCount: 0 };
        }
        db.devices[deviceId].lastSeen = now;
        db.devices[deviceId].uploadCount++;

        // Keep only last 1000 uploads per device (optimized)
        let deviceCount = 0;
        db.uploads = db.uploads.filter(u => {
            if (u.deviceId !== deviceId) return true;
            deviceCount++;
            return deviceCount <= 1000;
        });

        // Update cache and mark dirty for async disk flush
        saveUploadsDb(db);

        console.log(`[Upload] ${req.file.filename} - ${responseTime}ms response, background save started`);

        // Replicate to Spaceship for redundancy (non-blocking)
        if (SPACESHIP_FTP.password) {
            replicateToSpaceship(path.join(uploadsDir, req.file.filename), req.file.filename);
        }
    });
});

// ============ ULTRA-FAST PRE-GENERATED URL SYSTEM ============
// Pre-reserve URLs before photos are taken for instant sharing

const reservedUrls = new Map(); // token -> { filename, reservedAt, deviceId }
const RESERVATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Clean up expired reservations every minute
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of reservedUrls.entries()) {
        if (now - data.reservedAt > RESERVATION_TIMEOUT) {
            reservedUrls.delete(token);
        }
    }
}, 60 * 1000);

// Reserve multiple URLs in advance (batch pre-generation)
app.post('/api/reserve-urls', express.json(), (req, res) => {
    const { count = 5, deviceId = 'web' } = req.body;
    const batchCount = Math.min(Math.max(1, count), 20); // Max 20 at once

    const reservations = [];
    const now = Date.now();

    for (let i = 0; i < batchCount; i++) {
        const token = uuidv4();
        const fileUuid = uuidv4();
        const filename = fileUuid + '.png'; // Use .png since desktop screenshots are PNG
        const url = `https://${SHARE_HOST}/${fileUuid}`; // Extensionless URL avoids Cloudflare auto-caching

        reservedUrls.set(token, {
            filename,
            url,
            deviceId,
            reservedAt: now,
            index: i
        });

        reservations.push({
            token,
            url,
            filename,
            expiresIn: RESERVATION_TIMEOUT
        });
    }

    console.log(`[FastUpload] Reserved ${batchCount} URLs for device ${deviceId.substring(0, 8)}...`);

    res.json({
        success: true,
        reservations,
        count: batchCount,
        validFor: '5 minutes'
    });
});

// Single URL reservation (for immediate use)
app.get('/api/reserve-url', (req, res) => {
    const deviceId = req.query.device || req.headers['x-device-id'] || 'web';
    const token = uuidv4();
    const fileUuid = uuidv4();
    const filename = fileUuid + '.jpg';
    const url = `https://${SHARE_HOST}/${fileUuid}`; // Extensionless URL avoids Cloudflare auto-caching

    reservedUrls.set(token, {
        filename,
        url,
        deviceId,
        reservedAt: Date.now()
    });

    res.json({
        success: true,
        token,
        url,
        filename,
        expiresIn: RESERVATION_TIMEOUT
    });
});

// Upload to a pre-reserved URL (ULTRA-FAST - URL already known, respond immediately)
app.post('/api/upload-fast', upload.single('image'), (req, res) => {
    const uploadStart = Date.now();
    const token = req.body.token || req.headers['x-upload-token'];
    const reservation = reservedUrls.get(token);

    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    const deviceId = req.headers['x-device-id'] || req.body?.deviceId || 'web';
    const userId = req.headers['x-user-id'] || req.body?.userId;

    // Check subscription via unified plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);

    // Check daily upload limit (in-memory cache)
    const uploadLimit = checkDailyUploadLimit(deviceId, isPaidUser);
    if (!uploadLimit.allowed) {
        fs.unlink(req.file.path, () => {}); // Async delete
        uploadMetrics.record(false, Date.now() - uploadStart);
        return res.status(429).json({
            error: `Daily upload limit reached (${uploadLimit.limit}/day). Resets tomorrow.`,
            limitReached: true,
            used: uploadLimit.used,
            limit: uploadLimit.limit
        });
    }

    // Determine final filename and URL
    let finalFilename, imageUrl;
    const uploadedPath = path.join(uploadsDir, req.file.filename);

    if (reservation) {
        finalFilename = reservation.filename;
        imageUrl = reservation.url;
        reservedUrls.delete(token);
    } else {
        finalFilename = req.file.filename;
        const baseFilename = finalFilename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
        imageUrl = `https://${SHARE_HOST}/${baseFilename}`;
    }

    const now = Date.now();
    const expirationMs = isPaidUser ? IMAGE_LIFETIME_MS : FREE_TIER_EXPIRATION_MS;
    const expiresAt = now + expirationMs;
    const uploadId = uuidv4();
    const responseTime = Date.now() - uploadStart;
    uploadMetrics.record(true, responseTime);

    // RESPOND IMMEDIATELY - client already has the URL
    res.json({
        success: true,
        url: imageUrl,
        filename: finalFilename,
        id: uploadId,
        expiresAt: expiresAt,
        expiresIn: isPaidUser ? '1 year' : '30 days',
        fastUpload: !!reservation,
        responseTime: responseTime,
        dailyUploads: {
            used: uploadLimit.used + 1,
            limit: uploadLimit.limit,
            remaining: Math.max(0, uploadLimit.remaining - 1)
        }
    });

    // ========== ALL BACKGROUND OPERATIONS (after response sent) ==========
    setImmediate(() => {
        // Rename file to reserved filename (async)
        if (reservation && req.file.filename !== finalFilename) {
            // Preserve the actual uploaded file extension
            const uploadedExt = path.extname(req.file.filename);
            const reservedBase = finalFilename.replace(/\.[^.]+$/, '');
            const actualFilename = reservedBase + uploadedExt;
            const newPath = path.join(uploadsDir, actualFilename);

            fs.rename(uploadedPath, newPath, (err) => {
                if (err) {
                    console.error('[FastUpload] Rename error:', err.message);
                } else {
                    console.log(`[FastUpload] Renamed to ${actualFilename}`);
                }
            });
        }

        // Increment daily upload counter (in-memory)
        incrementDailyUploadCount(deviceId);

        // Save to database using in-memory cache (instant for subsequent reads)
        const db = loadUploadsDb();

        db.uploads.unshift({
            id: uploadId,
            filename: finalFilename,
            url: imageUrl,
            deviceId: deviceId,
            userId: userId || null,
            timestamp: now,
            expiresAt: expiresAt,
            size: req.file.size,
            fastUpload: !!reservation,
            tier: isPaidUser ? 'paid' : 'free'
        });

        if (!db.devices[deviceId]) {
            db.devices[deviceId] = { firstSeen: now, uploadCount: 0 };
        }
        db.devices[deviceId].lastSeen = now;
        db.devices[deviceId].uploadCount++;

        // Update cache and mark dirty for async disk flush
        saveUploadsDb(db);

        console.log(`[FastUpload] ${finalFilename} - ${responseTime}ms response`);

        // Replicate to Spaceship for redundancy (non-blocking)
        if (SPACESHIP_FTP.password) {
            // Small delay to let rename complete first if needed
            setTimeout(() => {
                const actualPath = path.join(uploadsDir, finalFilename);
                const altExt = path.extname(req.file.filename);
                const altPath = path.join(uploadsDir, finalFilename.replace(/\.[^.]+$/, '') + altExt);
                const filePath = fs.existsSync(actualPath) ? actualPath : altPath;
                replicateToSpaceship(filePath, finalFilename);
            }, 500);
        }
    });
});

// Get daily upload limit status
app.get('/api/upload-limit', (req, res) => {
    const deviceId = req.query.device || req.headers['x-device-id'] || 'web';
    const userId = req.query.userId || req.headers['x-user-id'];

    // Check subscription via unified plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);

    const limitStatus = checkDailyUploadLimit(deviceId, isPaidUser);

    res.json({
        success: true,
        tier: isPaidUser ? 'paid' : 'free',
        dailyUploads: {
            used: limitStatus.used,
            limit: isPaidUser ? 'unlimited' : limitStatus.limit,
            remaining: isPaidUser ? 'unlimited' : limitStatus.remaining,
            allowed: limitStatus.allowed
        },
        limits: {
            maxFileSizeMB: isPaidUser ? 'unlimited' : FREE_TIER_CONFIG.maxFileSizeMB,
            storageMB: isPaidUser ? 'unlimited' : FREE_TIER_CONFIG.storageMB,
            expirationDays: isPaidUser ? 365 : FREE_TIER_CONFIG.expirationDays,
            crossDeviceUploads: FREE_TIER_CONFIG.crossDeviceUploads
        },
        resetsAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
    });
});

// Get reservation status
app.get('/api/reservation-status', (req, res) => {
    const deviceId = req.query.device || 'web';
    const deviceReservations = [];

    for (const [token, data] of reservedUrls.entries()) {
        if (data.deviceId === deviceId) {
            deviceReservations.push({
                token,
                url: data.url,
                age: Date.now() - data.reservedAt
            });
        }
    }

    res.json({
        success: true,
        count: deviceReservations.length,
        reservations: deviceReservations
    });
});

// API: Get uploads by device
app.get('/api/uploads', (req, res) => {
    const deviceId = req.query.device;
    const devicesParam = req.query.devices; // comma-separated list of device IDs

    if (!deviceId && !devicesParam) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadUploadsDb();

    // Support querying multiple device IDs at once (for multi-device sync)
    const deviceIds = devicesParam
        ? devicesParam.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
        : [deviceId.toLowerCase()];

    // Case-insensitive deviceId matching to handle WEB- vs web- format differences
    const uploads = db.uploads.filter(u =>
        u.deviceId && deviceIds.includes(u.deviceId.toLowerCase())
    );
    const primaryId = deviceId || deviceIds[0];
    const device = db.devices[primaryId] || db.devices[primaryId.toLowerCase()];

    // Enrich uploads with view counts from shares.json
    const shareViews = loadShareViews();
    const enrichedUploads = uploads.map(u => {
        // Normalize filename to match shares.json keys (without extension)
        const normalizedKey = u.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
        const views = shareViews[normalizedKey] ? shareViews[normalizedKey].views || 0 : 0;
        return { ...u, views };
    });

    res.json({
        success: true,
        device: device || null,
        uploads: enrichedUploads,
        count: enrichedUploads.length,
        queriedDevices: deviceIds.length
    });
});

// API: Delete upload
app.delete('/api/uploads/:id', (req, res) => {
    const deviceId = req.query.device;
    const uploadId = req.params.id;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadUploadsDb();
    const upload = db.uploads.find(u => u.id === uploadId && u.deviceId && u.deviceId.toLowerCase() === deviceId.toLowerCase());

    if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
    }

    // Delete file
    const filePath = path.join(uploadsDir, upload.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    // Remove from database
    db.uploads = db.uploads.filter(u => u.id !== uploadId);
    if (db.devices[deviceId]) {
        db.devices[deviceId].uploadCount--;
    }
    saveUploadsDb(db);

    res.json({ success: true });
});

// API: Create secure link with device binding
app.post('/api/secure-link', express.json(), (req, res) => {
    const { uploadId, deviceId } = req.body;

    if (!uploadId || !deviceId) {
        return res.status(400).json({ error: 'Upload ID and Device ID required' });
    }

    const db = loadUploadsDb();
    const upload = db.uploads.find(u => u.id === uploadId);

    if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
    }

    // Generate secure token
    const secureToken = crypto.randomBytes(16).toString('hex');
    const secureId = `sec-${Date.now().toString(36)}-${secureToken.substring(0, 8)}`;

    // Store secure link
    if (!db.secureLinks) db.secureLinks = {};
    db.secureLinks[secureId] = {
        uploadId: upload.id,
        filename: upload.filename,
        deviceId: deviceId,
        createdAt: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        accessCount: 0,
        token: secureToken
    };

    saveUploadsDb(db);

    const secureUrl = `https://${SHARE_HOST}/s/${secureId}`;

    res.json({
        success: true,
        secureUrl: secureUrl,
        secureId: secureId,
        expiresIn: '7 days'
    });
});

// API: Access secure link
app.get('/s/:secureId', (req, res) => {
    const { secureId } = req.params;

    const db = loadUploadsDb();
    const secureLink = db.secureLinks?.[secureId];

    if (!secureLink) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html><head><title>Link Not Found - DOZ UP</title>
            <style>body{font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px}.icon{font-size:64px;margin-bottom:20px}h1{margin:0 0 10px}p{color:#94a3b8}</style></head>
            <body><div class="box"><div class="icon">&#x1F512;</div><h1>Link Not Found</h1><p>This secure link does not exist or has been removed.</p></div></body></html>
        `);
    }

    if (Date.now() > secureLink.expiresAt) {
        return res.status(410).send(`
            <!DOCTYPE html>
            <html><head><title>Link Expired - DOZ UP</title>
            <style>body{font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px}.icon{font-size:64px;margin-bottom:20px}h1{margin:0 0 10px}p{color:#94a3b8}</style></head>
            <body><div class="box"><div class="icon">&#x23F0;</div><h1>Link Expired</h1><p>This secure link has expired. Please request a new one from the owner.</p></div></body></html>
        `);
    }

    // Increment access count
    secureLink.accessCount++;
    saveUploadsDb(db);

    // Serve the image
    const imagePath = path.join(uploadsDir, secureLink.filename);
    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).send('File not found');
    }
});

// ============ FAMILY GALLERIES API ============

// Cached galleries database
const galleriesFile = path.join(dataDir, 'galleries.json');
let galleriesDbCache = null;
let galleriesDbDirty = false;

function loadGalleriesDb() {
    if (galleriesDbCache) return galleriesDbCache;
    try {
        if (fs.existsSync(galleriesFile)) {
            galleriesDbCache = JSON.parse(fs.readFileSync(galleriesFile, 'utf8'));
            return galleriesDbCache;
        }
    } catch (e) {
        console.error('Error loading galleries.json:', e);
    }
    galleriesDbCache = { galleries: [], members: [], galleryPhotos: [] };
    return galleriesDbCache;
}

function saveGalleriesDb(data) {
    galleriesDbCache = data;
    galleriesDbDirty = true;
}

// Flush galleries DB every 5 seconds
setInterval(() => {
    if (galleriesDbDirty && galleriesDbCache) {
        fs.writeFile(galleriesFile, JSON.stringify(galleriesDbCache), (err) => {
            if (err) console.error('[DB] Galleries flush error:', err.message);
        });
        galleriesDbDirty = false;
    }
}, 10000); // was 5s, reduced frequency for performance

// Generate invite code
function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
