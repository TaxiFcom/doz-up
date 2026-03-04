    broadcastPairingEvent(userId, {
        type: 'pairing-accepted',
        newDevice: newDevice,
        acceptedBy: newDeviceId
    });

    res.json({
        success: true,
        message: 'Device paired successfully!',
        userId: userId,
        devices: user.devices
    });
});

// Remove device
app.delete('/api/devices/:deviceId/:targetDeviceId', (req, res) => {
    const { deviceId, targetDeviceId } = req.params;
    const db = loadDevicesDb();

    // Find user
    let userId = null;
    for (const [uid, userData] of Object.entries(db.users)) {
        if (userData.devices.some(d => d.deviceId === deviceId)) {
            userId = uid;
            break;
        }
    }

    if (!userId) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = db.users[userId];

    // Don't allow removing the last device
    if (user.devices.length <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot remove last device' });
    }

    // Remove target device
    const initialCount = user.devices.length;
    user.devices = user.devices.filter(d => d.deviceId !== targetDeviceId);

    if (user.devices.length === initialCount) {
        return res.status(404).json({ success: false, error: 'Target device not found' });
    }

    saveDevicesDb(db);

    console.log(`[Device] Device ${targetDeviceId} removed from user ${userId}`);

    res.json({
        success: true,
        message: 'Device removed',
        devices: user.devices
    });
});

// Rename device (POST version)
app.post('/api/devices/rename', express.json(), (req, res) => {
    const { deviceId, name } = req.body;
    const db = loadDevicesDb();

    // Find and update device
    for (const user of Object.values(db.users)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.name = name || device.name;
            saveDevicesDb(db);
            return res.json({ success: true, device });
        }
    }

    res.status(404).json({ success: false, error: 'Device not found' });
});

// Rename device (PATCH version)
app.patch('/api/devices/:deviceId/rename', express.json(), (req, res) => {
    const { deviceId } = req.params;
    const { newName } = req.body;
    const db = loadDevicesDb();

    // Find and update device
    for (const user of Object.values(db.users)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.name = newName || device.name;
            saveDevicesDb(db);
            return res.json({ success: true, device });
        }
    }

    res.status(404).json({ success: false, error: 'Device not found' });
});

// Update device activity
app.post('/api/devices/heartbeat', express.json(), (req, res) => {
    const { deviceId } = req.body;
    const db = loadDevicesDb();

    // Find and update device
    for (const user of Object.values(db.users)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.lastActive = new Date().toISOString();
            saveDevicesDb(db);
            return res.json({ success: true });
        }
    }

    res.json({ success: true }); // Silent fail for heartbeat
});

// ============ CLOUD GALLERY API ============
const galleryDbPath = path.join(dataDir, 'gallery.json');

function loadGalleryDb() {
    try {
        if (fs.existsSync(galleryDbPath)) {
            return JSON.parse(fs.readFileSync(galleryDbPath, 'utf8'));
        }
    } catch (e) {}
    return { images: [], stats: {} };
}

function saveGalleryDb(db) {
    fs.writeFileSync(galleryDbPath, JSON.stringify(db));
}

// Get latest gallery images
app.get('/api/gallery/latest', (req, res) => {
    const db = loadGalleryDb();
    const limit = parseInt(req.query.limit) || 20;
    const images = (db.images || [])
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    res.json({ success: true, images, total: (db.images || []).length });
});

// Get user's gallery
app.get('/api/gallery', (req, res) => {
    const { device } = req.query;
    const db = loadGalleryDb();

    // Filter by device
    const userImages = device
        ? db.images.filter(img => img.deviceId === device)
        : db.images;

    // Enrich images with view counts from shares.json
    const shareViews = loadShareViews();
    const enrichedImages = userImages.map(img => {
        // Normalize filename to match shares.json keys (without extension)
        const normalizedKey = img.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
        const views = shareViews[normalizedKey] ? shareViews[normalizedKey].views || 0 : 0;
        return { ...img, views };
    });

    // Calculate stats
    const totalSize = enrichedImages.reduce((sum, img) => sum + (img.size || 0), 0);
    const totalShares = enrichedImages.reduce((sum, img) => sum + (img.shares || 0), 0);
    const totalViews = enrichedImages.reduce((sum, img) => sum + (img.views || 0), 0);

    res.json({
        success: true,
        images: enrichedImages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        stats: {
            total: enrichedImages.length,
            storage: (totalSize / (1024 * 1024)).toFixed(1),
            shares: totalShares,
            views: totalViews
        }
    });
});

// Add image to gallery (called after upload)
app.post('/api/gallery', express.json(), (req, res) => {
    const { deviceId, filename, url, size, type, filter, beauty } = req.body;
    const db = loadGalleryDb();

    const image = {
        id: uuidv4(),
        deviceId: deviceId || 'anonymous',
        filename: filename || `image-${Date.now()}.png`,
        url,
        size: size || 0,
        type: type || 'screenshot', // screenshot, selfie, edited, gif
        filter: filter || null,
        beauty: beauty || false,
        views: 0,
        shares: 0,
        favorite: false,
        createdAt: new Date().toISOString()
    };

    db.images.unshift(image);

    // Keep max 1000 images per user
    const userImages = db.images.filter(img => img.deviceId === deviceId);
    if (userImages.length > 1000) {
        const oldestId = userImages[userImages.length - 1].id;
        db.images = db.images.filter(img => img.id !== oldestId);
    }

    saveGalleryDb(db);

    console.log(`[Gallery] New image added: ${filename} by ${deviceId}`);
    res.json({ success: true, image });
});

// Update image (favorite, etc.)
app.patch('/api/gallery/:imageId', express.json(), (req, res) => {
    const { imageId } = req.params;
    const updates = req.body;
    const db = loadGalleryDb();

    const image = db.images.find(img => img.id === imageId);
    if (!image) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }

    // Apply updates
    if (updates.favorite !== undefined) image.favorite = updates.favorite;
    if (updates.filename) image.filename = updates.filename;

    saveGalleryDb(db);
    res.json({ success: true, image });
});

// Delete image
app.delete('/api/gallery/:imageId', (req, res) => {
    const { imageId } = req.params;
    const db = loadGalleryDb();

    const initialLength = db.images.length;
    db.images = db.images.filter(img => img.id !== imageId);

    if (db.images.length === initialLength) {
        return res.status(404).json({ success: false, error: 'Image not found' });
    }

    saveGalleryDb(db);
    console.log(`[Gallery] Image deleted: ${imageId}`);
    res.json({ success: true });
});

// Track image view
app.post('/api/gallery/:imageId/view', (req, res) => {
    const { imageId } = req.params;
    const db = loadGalleryDb();

    const image = db.images.find(img => img.id === imageId);
    if (image) {
        image.views = (image.views || 0) + 1;
        saveGalleryDb(db);
    }

    res.json({ success: true });
});

// Track image share
app.post('/api/gallery/:imageId/share', express.json(), (req, res) => {
    const { imageId } = req.params;
    const { platform } = req.body; // twitter, facebook, etc.
    const db = loadGalleryDb();

    const image = db.images.find(img => img.id === imageId);
    if (image) {
        image.shares = (image.shares || 0) + 1;
        if (!image.shareHistory) image.shareHistory = [];
        image.shareHistory.push({
            platform,
            timestamp: new Date().toISOString()
        });
        saveGalleryDb(db);
    }

    res.json({ success: true });
});

// ============ STUDIO / FILTERS API ============
const filtersDbPath = path.join(dataDir, 'filters.json');

async function loadFiltersDb() {
    return await dbUtils.loadJSON(filtersDbPath, { customFilters: [], presets: [] });
}

async function saveFiltersDb(data) {
    return await dbUtils.saveJSON(filtersDbPath, data);
}

// Get available filters and presets
app.get('/api/studio/filters', (req, res) => {
    const defaultFilters = [
        { id: 'clarendon', name: 'Clarendon', css: 'contrast(1.2) saturate(1.35)', category: 'popular' },
        { id: 'gingham', name: 'Gingham', css: 'brightness(1.05) sepia(0.04)', category: 'popular' },
        { id: 'moon', name: 'Moon', css: 'grayscale(1) contrast(1.1) brightness(1.1)', category: 'bw' },
        { id: 'lark', name: 'Lark', css: 'contrast(0.9) brightness(1.1) saturate(0.85)', category: 'popular' },
        { id: 'reyes', name: 'Reyes', css: 'sepia(0.22) brightness(1.1) contrast(0.85) saturate(0.75)', category: 'vintage' },
        { id: 'juno', name: 'Juno', css: 'saturate(1.4) contrast(1.15) brightness(1.05) sepia(0.05)', category: 'popular' },
        { id: 'slumber', name: 'Slumber', css: 'saturate(0.66) brightness(1.05)', category: 'vintage' },
        { id: '1977', name: '1977', css: 'sepia(0.5) hue-rotate(-30deg) saturate(1.4)', category: 'vintage' },
        { id: 'nashville', name: 'Nashville', css: 'sepia(0.2) contrast(1.2) brightness(1.05) saturate(1.2)', category: 'vintage' },
        { id: 'inkwell', name: 'Inkwell', css: 'grayscale(1) brightness(1.1) contrast(1.3)', category: 'bw' },
        { id: 'willow', name: 'Willow', css: 'grayscale(0.5) contrast(0.95) brightness(0.9)', category: 'bw' },
        { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.95)', category: 'bw' }
    ];

    const beautyPresets = [
        { id: 'natural', name: 'Natural', settings: { smooth: 30, bright: 50, soft: 20, slim: 0, eyes: 0, warmth: 50 } },
        { id: 'soft', name: 'Soft Glow', settings: { smooth: 60, bright: 55, soft: 40, slim: 0, eyes: 0, warmth: 55 } },
        { id: 'glamour', name: 'Glamour', settings: { smooth: 70, bright: 60, soft: 30, slim: 20, eyes: 15, warmth: 60 } },
        { id: 'studio', name: 'Studio', settings: { smooth: 50, bright: 55, soft: 25, slim: 10, eyes: 10, warmth: 45 } },
        { id: 'hd', name: 'HD Clear', settings: { smooth: 20, bright: 52, soft: 10, slim: 0, eyes: 0, warmth: 48 } }
    ];

    res.json({
        success: true,
        filters: defaultFilters,
        beautyPresets
    });
});

// Save custom filter/preset
app.post('/api/studio/filters', express.json(), (req, res) => {
    const { deviceId, name, type, settings } = req.body;
    const db = loadFiltersDb();

    const filter = {
        id: uuidv4(),
        deviceId,
        name,
        type, // 'filter' or 'beauty'
        settings,
        createdAt: new Date().toISOString()
    };

    db.customFilters.push(filter);
    saveFiltersDb(db);

    res.json({ success: true, filter });
});

// ============ USER THEMES API ============
const themesDbPath = path.join(dataDir, 'themes.json');

async function loadThemesDb() {
    return await dbUtils.loadJSON(themesDbPath, { userThemes: {} });
}

async function saveThemesDb(data) {
    return await dbUtils.saveJSON(themesDbPath, data);
}

// Get user's theme preferences
app.get('/api/themes/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const db = loadThemesDb();

    const userTheme = db.userThemes[deviceId] || {
        theme: 'dark', // dark, light, system
        accentColor: '#10b981',
        fontSize: 'medium',
        compactMode: false,
        soundEnabled: true,
        notificationsEnabled: true
    };

    res.json({ success: true, theme: userTheme });
});

// Save user's theme preferences
app.post('/api/themes/:deviceId', express.json(), (req, res) => {
    const { deviceId } = req.params;
    const settings = req.body;
    const db = loadThemesDb();

    db.userThemes[deviceId] = {
        ...db.userThemes[deviceId],
        ...settings,
        updatedAt: new Date().toISOString()
    };

    saveThemesDb(db);
    res.json({ success: true, theme: db.userThemes[deviceId] });
});

// Available themes list
app.get('/api/themes', (req, res) => {
    const themes = [
        { id: 'dark', name: 'Dark Mode', colors: { bg: '#0a0a1a', text: '#ffffff', accent: '#10b981' } },
        { id: 'light', name: 'Light Mode', colors: { bg: '#ffffff', text: '#1a1a2e', accent: '#10b981' } },
        { id: 'midnight', name: 'Midnight Blue', colors: { bg: '#0f172a', text: '#e2e8f0', accent: '#3b82f6' } },
        { id: 'forest', name: 'Forest Green', colors: { bg: '#0d1f17', text: '#d1fae5', accent: '#059669' } },
        { id: 'sunset', name: 'Sunset', colors: { bg: '#1f1315', text: '#fecaca', accent: '#f97316' } },
        { id: 'ocean', name: 'Ocean', colors: { bg: '#0c1929', text: '#bae6fd', accent: '#0ea5e9' } },
        { id: 'purple', name: 'Purple Dreams', colors: { bg: '#1e1b4b', text: '#e0e7ff', accent: '#8b5cf6' } },
        { id: 'rose', name: 'Rose', colors: { bg: '#1f1218', text: '#fce7f3', accent: '#ec4899' } }
    ];

    const accentColors = [
        '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#ef4444', '#06b6d4'
    ];

    res.json({ success: true, themes, accentColors });
});

// ============ TELEMETRY SYSTEM ============
// Store telemetry data for diagnostics (cached)
const telemetryDbPath = path.join(dataDir, 'telemetry.json');
const feedbackDbPath = path.join(dataDir, 'feedback.json');
let telemetryDbCache = null;
let telemetryDbDirty = false;
let feedbackDbCache = null;
let feedbackDbDirty = false;

function loadTelemetryDb() {
    if (telemetryDbCache) return telemetryDbCache;
    try {
        if (fs.existsSync(telemetryDbPath)) {
            telemetryDbCache = JSON.parse(fs.readFileSync(telemetryDbPath, 'utf8'));
            return telemetryDbCache;
        }
    } catch (e) {}
    telemetryDbCache = { events: [], devices: {}, crashes: [], issues: [] };
    return telemetryDbCache;
}

function saveTelemetryDb(db) {
    telemetryDbCache = db;
    telemetryDbDirty = true;
}

function loadFeedbackDb() {
    if (feedbackDbCache) return feedbackDbCache;
    try {
        if (fs.existsSync(feedbackDbPath)) {
            feedbackDbCache = JSON.parse(fs.readFileSync(feedbackDbPath, 'utf8'));
            return feedbackDbCache;
        }
    } catch (e) {}
    feedbackDbCache = { feedback: [] };
    return feedbackDbCache;
}

function saveFeedbackDb(db) {
    feedbackDbCache = db;
    feedbackDbDirty = true;
}

// Flush telemetry/feedback DBs every 10 seconds
setInterval(() => {
    if (telemetryDbDirty && telemetryDbCache) {
        fs.writeFile(telemetryDbPath, JSON.stringify(telemetryDbCache), () => {});
        telemetryDbDirty = false;
    }
    if (feedbackDbDirty && feedbackDbCache) {
        fs.writeFile(feedbackDbPath, JSON.stringify(feedbackDbCache), () => {});
        feedbackDbDirty = false;
    }
}, 10000);

// Receive telemetry from desktop apps
app.post('/api/telemetry', express.json(), (req, res) => {
    try {
        const telemetry = req.body;
        const db = loadTelemetryDb();

        // Store event
        const event = {
            ...telemetry,
            receivedAt: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress
        };

        db.events.unshift(event);

        // Keep last 10000 events
        if (db.events.length > 10000) {
            db.events = db.events.slice(0, 10000);
        }

        // Track device
        const deviceId = telemetry.deviceId || 'unknown';
        if (!db.devices[deviceId]) {
            db.devices[deviceId] = {
                firstSeen: new Date().toISOString(),
                version: telemetry.version,
                platform: telemetry.platform,
                crashes: 0,
                heartbeats: 0,
                issues: []
            };
        }

        const device = db.devices[deviceId];
        device.lastSeen = new Date().toISOString();
        device.version = telemetry.version;
        device.lastEvent = telemetry.event;

