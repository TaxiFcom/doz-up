    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// SSE clients for real-time updates
const gallerySSEClients = new Map();

// Create gallery
app.post('/api/galleries', express.json(), (req, res) => {
    const { name, template, deviceId, ownerName } = req.body;

    if (!name || !deviceId) {
        return res.status(400).json({ error: 'Name and device ID required' });
    }

    const db = loadGalleriesDb();
    const galleryId = `gal-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
    const inviteCode = generateInviteCode();

    const gallery = {
        id: galleryId,
        name: name.trim(),
        ownerId: deviceId,
        ownerName: ownerName || 'Owner',
        template: template || 'classic',
        inviteCode: inviteCode,
        createdAt: Date.now(),
        settings: {
            autoAddPhotos: false,
            allowMemberUploads: true
        }
    };

    db.galleries.push(gallery);

    // Add owner as first member
    db.members.push({
        galleryId: galleryId,
        deviceId: deviceId,
        memberName: ownerName || 'Owner',
        role: 'owner',
        joinedAt: Date.now()
    });

    saveGalleriesDb(db);

    const inviteUrl = `https://${SHARE_HOST}/gallery/join/${inviteCode}`;

    res.json({
        success: true,
        gallery: gallery,
        inviteCode: inviteCode,
        inviteUrl: inviteUrl
    });
});

// List user's galleries
app.get('/api/galleries', (req, res) => {
    const deviceId = req.query.device;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadGalleriesDb();

    // Find galleries where user is a member
    const memberGalleryIds = db.members
        .filter(m => m.deviceId.toLowerCase() === deviceId.toLowerCase())
        .map(m => m.galleryId);

    const galleries = db.galleries
        .filter(g => memberGalleryIds.includes(g.id))
        .map(g => {
            const memberCount = db.members.filter(m => m.galleryId === g.id).length;
            const photoCount = db.galleryPhotos.filter(p => p.galleryId === g.id).length;
            return { ...g, memberCount, photoCount };
        });

    res.json({ galleries });
});

// Get gallery details with photos
app.get('/api/galleries/:id', (req, res) => {
    const galleryId = req.params.id;
    const deviceId = req.query.device;

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g => g.id === galleryId);

    if (!gallery) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    // Check if user is a member
    const isMember = db.members.some(m =>
        m.galleryId === galleryId &&
        m.deviceId.toLowerCase() === deviceId?.toLowerCase()
    );

    if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this gallery' });
    }

    const members = db.members.filter(m => m.galleryId === galleryId);
    const photos = db.galleryPhotos.filter(p => p.galleryId === galleryId);

    // Load upload details
    const uploadsDb = loadUploadsDb();
    const photosWithDetails = photos.map(p => {
        const upload = uploadsDb.uploads.find(u => u.id === p.uploadId);
        const member = members.find(m => m.deviceId === p.addedBy);
        return {
            ...p,
            url: upload?.url,
            filename: upload?.filename,
            thumbnail: upload?.thumbnail,
            size: upload?.size,
            addedByName: member?.memberName || 'Unknown'
        };
    }).filter(p => p.url);

    res.json({
        gallery,
        members,
        photos: photosWithDetails
    });
});

// Join gallery with invite code
app.post('/api/galleries/join', express.json(), (req, res) => {
    const { inviteCode, deviceId, memberName } = req.body;

    if (!inviteCode || !deviceId) {
        return res.status(400).json({ error: 'Invite code and device ID required' });
    }

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g =>
        g.inviteCode.toUpperCase() === inviteCode.toUpperCase().trim()
    );

    if (!gallery) {
        return res.status(404).json({ error: 'Invalid invite code' });
    }

    // Check if already a member
    const existingMember = db.members.find(m =>
        m.galleryId === gallery.id &&
        m.deviceId.toLowerCase() === deviceId.toLowerCase()
    );

    if (existingMember) {
        return res.json({ success: true, gallery, alreadyMember: true });
    }

    // Add as new member
    const member = {
        galleryId: gallery.id,
        deviceId: deviceId,
        memberName: memberName || 'Family Member',
        role: 'member',
        joinedAt: Date.now()
    };

    db.members.push(member);
    saveGalleriesDb(db);

    // Notify other members via SSE
    notifyGalleryMembers(gallery.id, {
        type: 'member-joined',
        member: { memberName: member.memberName, joinedAt: member.joinedAt }
    });

    res.json({ success: true, gallery, member });
});

// Add photo to gallery
app.post('/api/galleries/:id/photos', express.json(), (req, res) => {
    const galleryId = req.params.id;
    const { uploadId, deviceId } = req.body;

    if (!uploadId || !deviceId) {
        return res.status(400).json({ error: 'Upload ID and device ID required' });
    }

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g => g.id === galleryId);

    if (!gallery) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    // Verify membership
    const member = db.members.find(m =>
        m.galleryId === galleryId &&
        m.deviceId.toLowerCase() === deviceId.toLowerCase()
    );

    if (!member) {
        return res.status(403).json({ error: 'Not a member of this gallery' });
    }

    // Check if photo already in gallery
    const exists = db.galleryPhotos.some(p =>
        p.galleryId === galleryId && p.uploadId === uploadId
    );

    if (exists) {
        return res.json({ success: true, alreadyExists: true });
    }

    // Add photo
    const galleryPhoto = {
        id: `gph-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        galleryId: galleryId,
        uploadId: uploadId,
        addedBy: deviceId,
        addedAt: Date.now()
    };

    db.galleryPhotos.push(galleryPhoto);
    saveGalleriesDb(db);

    // Get upload details for SSE notification
    const uploadsDb = loadUploadsDb();
    const upload = uploadsDb.uploads.find(u => u.id === uploadId);

    // Notify members via SSE
    notifyGalleryMembers(galleryId, {
        type: 'photo-added',
        photo: {
            ...galleryPhoto,
            url: upload?.url,
            filename: upload?.filename,
            addedByName: member.memberName
        }
    });

    res.json({ success: true, photo: galleryPhoto });
});

// Remove photo from gallery
app.delete('/api/galleries/:id/photos/:photoId', (req, res) => {
    const { id: galleryId, photoId } = req.params;
    const deviceId = req.query.device;

    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g => g.id === galleryId);

    if (!gallery) {
        return res.status(404).json({ error: 'Gallery not found' });
    }

    // Find the photo
    const photoIndex = db.galleryPhotos.findIndex(p =>
        p.galleryId === galleryId && p.id === photoId
    );

    if (photoIndex === -1) {
        return res.status(404).json({ error: 'Photo not found in gallery' });
    }

    const photo = db.galleryPhotos[photoIndex];

    // Check permission (owner can remove any, members only their own)
    const isOwner = gallery.ownerId.toLowerCase() === deviceId?.toLowerCase();
    const isUploader = photo.addedBy.toLowerCase() === deviceId?.toLowerCase();

    if (!isOwner && !isUploader) {
        return res.status(403).json({ error: 'Not authorized to remove this photo' });
    }

    db.galleryPhotos.splice(photoIndex, 1);
    saveGalleriesDb(db);

    // Notify members
    notifyGalleryMembers(galleryId, {
        type: 'photo-removed',
        photoId: photoId
    });

    res.json({ success: true });
});

// SSE stream for real-time updates
app.get('/api/galleries/:id/stream', (req, res) => {
    const galleryId = req.params.id;
    const deviceId = req.query.device;

    const db = loadGalleriesDb();
    const isMember = db.members.some(m =>
        m.galleryId === galleryId &&
        m.deviceId.toLowerCase() === deviceId?.toLowerCase()
    );

    if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this gallery' });
    }

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', galleryId })}\n\n`);

    // Store client connection
    if (!gallerySSEClients.has(galleryId)) {
        gallerySSEClients.set(galleryId, new Set());
    }
    gallerySSEClients.get(galleryId).add(res);

    // Keep alive
    const keepAlive = setInterval(() => {
        res.write(':keepalive\n\n');
    }, 30000);

    // Clean up on close
    req.on('close', () => {
        clearInterval(keepAlive);
        gallerySSEClients.get(galleryId)?.delete(res);
    });
});

// Helper to notify gallery members
function notifyGalleryMembers(galleryId, event) {
    const clients = gallerySSEClients.get(galleryId);
    if (clients) {
        const data = JSON.stringify(event);
        clients.forEach(client => {
            client.write(`data: ${data}\n\n`);
        });
    }
}

// Join gallery page handler
app.get('/gallery/join/:code', (req, res) => {
    const { code } = req.params;
    const db = loadGalleriesDb();
    const gallery = db.galleries.find(g =>
        g.inviteCode.toUpperCase() === code.toUpperCase()
    );

    if (!gallery) {
        return res.send(`
            <!DOCTYPE html>
            <html><head><title>Invalid Invite - DOZ UP</title>
            <style>body{font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px}.icon{font-size:64px;margin-bottom:20px}h1{margin:0 0 10px}p{color:#94a3b8}</style></head>
            <body><div class="box"><div class="icon">&#x1F517;</div><h1>Invalid Invite</h1><p>This invite link is not valid.</p></div></body></html>
        `);
    }

    // Redirect to cabinet with join code
    res.redirect(`/cabinet.html?join=${code}`);
});

// ============ END FAMILY GALLERIES API ============

// API: Link browser fingerprint to device ID
app.post('/api/link-device', express.json(), (req, res) => {
    const { deviceId, browserFingerprint } = req.body;

    if (!deviceId || !browserFingerprint) {
        return res.status(400).json({ error: 'Device ID and browser fingerprint required' });
    }

    const db = loadUploadsDb();

    // Initialize fingerprints storage if not exists
    if (!db.fingerprints) {
        db.fingerprints = {};
    }

    // Link fingerprint to device ID
    db.fingerprints[browserFingerprint] = {
        deviceId: deviceId,
        linkedAt: Date.now()
    };

    saveUploadsDb(db);
    console.log(`Linked fingerprint ${browserFingerprint.substring(0, 16)}... to device ${deviceId.substring(0, 16)}...`);

    res.json({ success: true });
});

// API: Lookup device ID by browser fingerprint
app.get('/api/lookup-device', (req, res) => {
    const fingerprint = req.query.fp;

    if (!fingerprint) {
        return res.status(400).json({ error: 'Fingerprint required' });
    }

    const db = loadUploadsDb();
    const link = db.fingerprints?.[fingerprint];

    if (link && link.deviceId) {
        res.json({ success: true, deviceId: link.deviceId });
    } else {
        res.json({ success: false, deviceId: null });
    }
});

// API: Get device stats (linked browsers, last seen, etc.)
app.get('/api/device-stats', (req, res) => {
    const deviceId = req.query.device;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadUploadsDb();
    const device = db.devices?.[deviceId];

    // Count linked browsers/fingerprints
    let linkedBrowsers = 0;
    const linkedFingerprints = [];
    if (db.fingerprints) {
        for (const [fp, link] of Object.entries(db.fingerprints)) {
            if (link.deviceId === deviceId) {
                linkedBrowsers++;
                linkedFingerprints.push({
                    fingerprint: fp.substring(0, 16) + '...',
                    linkedAt: link.linkedAt
                });
            }
        }
    }

    res.json({
        success: true,
        device: {
            id: deviceId,
            firstSeen: device?.firstSeen || null,
            lastSeen: device?.lastSeen || null,
            uploadCount: device?.uploadCount || 0
        },
        linkedBrowsers: linkedBrowsers,
        browsers: linkedFingerprints
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // Report multer errors to AI interceptor
        uploadMetrics.record(false, 0);
        aiErrorInterceptor.handleError({
            message: `Multer error: ${err.code} - ${err.message}`,
            source: 'upload-multer',
            context: { code: err.code, field: err.field, path: req.path },
            deviceId: req.headers['x-device-id'] || 'web',
        });

        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large. Maximum size is 1GB',
                errorCode: 'LIMIT_FILE_SIZE',
                canRetry: false,
                tip: 'Reduce image size or compress before uploading',
            });
        }
        return res.status(400).json({ error: err.message, errorCode: err.code, canRetry: false });
    } else if (err) {
        uploadMetrics.record(false, 0);
        aiErrorInterceptor.handleError({
            message: `Upload middleware error: ${err.message}`,
            source: 'upload-middleware',
            stack: err.stack,
            context: { path: req.path },
        });
        return res.status(400).json({ error: err.message });
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    // Score: 100 base, penalize for high memory / high connections
    let score = 100;
    if (heapUsedMB > 600) score -= 40;
    else if (heapUsedMB > 400) score -= 15;
    if (connectedUsers.size > 1000) score -= 20;

    // Quick write-permission probe
    try {
        const probe = path.join(uploadsDir, '.health-' + Date.now());
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
