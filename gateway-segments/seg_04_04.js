    const userUploads = uploadsDb.uploads ? uploadsDb.uploads.filter(u =>
        linkedDeviceIds.includes(u.deviceId) || (userId && u.userId === userId)
    ) : [];

    const now = new Date();
    const today = now.toDateString();
    const todayUploads = userUploads.filter(u => {
        const ts = u.timestamp || u.createdAt;
        return ts && new Date(ts).toDateString() === today;
    });

    const totalSize = userUploads.reduce((sum, u) => sum + (u.size || 0), 0);
    const daysActive = userUploads.length > 0
        ? Math.max(1, Math.ceil((now - new Date(userUploads[userUploads.length - 1].timestamp || 0)) / 86400000))
        : 1;

    res.json({
        success: true,
        today: todayUploads.length,
        total: userUploads.length,
        storage: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        shared: userUploads.length,
        weekly: userUploads.filter(u => {
            const ts = u.timestamp || u.createdAt;
            if (!ts) return false;
            const week = new Date();
            week.setDate(week.getDate() - 7);
            return new Date(ts) > week;
        }).length,
        monthly: userUploads.filter(u => {
            const ts = u.timestamp || u.createdAt;
            if (!ts) return false;
            const month = new Date();
            month.setMonth(month.getMonth() - 1);
            return new Date(ts) > month;
        }).length,
        avgPerDay: Math.round(userUploads.length / daysActive * 10) / 10
    });
});

// Feature requests - for user feedback
app.post('/api/feature-requests', express.json(), (req, res) => {
    const { deviceId, message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    const db = loadFeatureRequests();
    const request = {
        id: uuidv4(),
        deviceId: deviceId || 'anonymous',
        message,
        status: 'new',
        votes: 1,
        createdAt: new Date().toISOString()
    };
    db.requests.push(request);
    saveFeatureRequests(db);

    console.log(`[Feature Request] ${deviceId}: ${message}`);

    res.json({ success: true, request });
});

// Get all feature requests (for admin)
app.get('/api/feature-requests', (req, res) => {
    const db = loadFeatureRequests();
    res.json({ success: true, requests: db.requests.sort((a, b) => b.votes - a.votes) });
});

// ============ REFERRAL SYSTEM - 50% DISCOUNT ============
const referralsDbPath = path.join(dataDir, 'referrals.json');

async function loadReferralsDb() {
    return await dbUtils.loadJSON(referralsDbPath, { referrals: [], codes: {} });
}

async function saveReferralsDb(data) {
    return await dbUtils.saveJSON(referralsDbPath, data);
}

// Get referral stats for a user
app.get('/api/referrals/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const db = loadReferralsDb();

    // Generate referral code if not exists
    if (!db.codes[deviceId]) {
        db.codes[deviceId] = {
            code: 'REF-' + deviceId.replace('DOZ-', ''),
            createdAt: new Date().toISOString(),
            invitesSent: 0,
            conversions: 0,
            totalEarnings: 0
        };
        saveReferralsDb(db);
    }

    const code = db.codes[deviceId];
    const userReferrals = db.referrals.filter(r => r.referrerDeviceId === deviceId);

    res.json({
        success: true,
        code: code.code,
        stats: {
            invitesSent: code.invitesSent,
            conversions: userReferrals.filter(r => r.status === 'converted').length,
            pending: userReferrals.filter(r => r.status === 'pending').length,
            totalEarnings: code.totalEarnings
        },
        referrals: userReferrals.slice(0, 20) // Last 20 referrals
    });
});

// Track referral invite sent
app.post('/api/referrals/invite', express.json(), (req, res) => {
    const { deviceId, method, recipient } = req.body;
    const db = loadReferralsDb();

    if (!db.codes[deviceId]) {
        db.codes[deviceId] = {
            code: 'REF-' + deviceId.replace('DOZ-', ''),
            createdAt: new Date().toISOString(),
            invitesSent: 0,
            conversions: 0,
            totalEarnings: 0
        };
    }

    db.codes[deviceId].invitesSent++;

    const invite = {
        id: uuidv4(),
        referrerDeviceId: deviceId,
        method: method || 'unknown', // email, twitter, facebook, linkedin
        recipient: recipient || null,
        status: 'sent',
        sentAt: new Date().toISOString()
    };

    db.referrals.push(invite);
    saveReferralsDb(db);

    console.log(`[Referral] ${deviceId} sent invite via ${method}`);
    res.json({ success: true, invite });
});

// Use referral code (when new user signs up)
app.post('/api/referrals/use', express.json(), (req, res) => {
    const { referralCode, newDeviceId } = req.body;
    const db = loadReferralsDb();

    // Find the referrer
    const referrerDeviceId = Object.keys(db.codes).find(
        id => db.codes[id].code === referralCode
    );

    if (!referrerDeviceId) {
        return res.status(404).json({ success: false, error: 'Invalid referral code' });
    }

    // Check if new user already used a code
    const existingUse = db.referrals.find(r => r.newUserDeviceId === newDeviceId && r.status === 'converted');
    if (existingUse) {
        return res.status(400).json({ success: false, error: 'Already used a referral code' });
    }

    // Record the referral conversion
    const referral = {
        id: uuidv4(),
        referrerDeviceId,
        newUserDeviceId: newDeviceId,
        code: referralCode,
        status: 'converted',
        convertedAt: new Date().toISOString(),
        discountApplied: 50 // 50% discount
    };

    db.referrals.push(referral);
    db.codes[referrerDeviceId].conversions++;
    db.codes[referrerDeviceId].totalEarnings += 18.85; // 50% of $37.70 yearly
    saveReferralsDb(db);

    console.log(`[Referral] ${newDeviceId} used code ${referralCode} from ${referrerDeviceId}`);
    res.json({
        success: true,
        discount: 50,
        message: 'Referral code applied! You get 50% off.'
    });
});

// Check referral eligibility (must have 7+ months remaining)
app.get('/api/referrals/eligibility/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const subsDb = loadSubscriptionsDb();
    const sub = subsDb.subscriptions.find(s => s.deviceId === deviceId && s.status === 'active');

    if (!sub) {
        return res.json({
            eligible: false,
            reason: 'No active subscription',
            monthsRemaining: 0
        });
    }

    const expiresAt = new Date(sub.expiresAt);
    const now = new Date();
    const monthsRemaining = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24 * 30));

    const eligible = monthsRemaining >= 7;

    res.json({
        eligible,
        monthsRemaining,
        reason: eligible ? 'You can earn referral rewards!' : `Need ${7 - monthsRemaining} more months to be eligible`,
        renewalWindow: {
            startsAt: new Date(expiresAt.getTime() - (3 * 30 * 24 * 60 * 60 * 1000)).toISOString(), // 3 months before
            endsAt: sub.expiresAt
        }
    });
});

// ============ DEVICE MANAGEMENT - BIOMETRIC PAIRING ============
const devicesDbPath = path.join(dataDir, 'devices.json');

async function loadDevicesDb() {
    return await dbUtils.loadJSON(devicesDbPath, { users: {}, pairingCodes: {} });
}

async function saveDevicesDb(data) {
    return await dbUtils.saveJSON(devicesDbPath, data);
}

// ============ REAL-TIME DEVICE PAIRING (Bluetooth-like) ============
// NOTE: SSE route MUST be defined BEFORE parameterized :deviceId route

// SSE clients for device pairing events
const devicePairingClients = new Map(); // userId -> Set of {deviceId, res}

// SSE stream for device pairing events
app.get('/api/devices/pairing-stream', (req, res) => {
    const { userId, deviceId } = req.query;

    if (!userId || !deviceId) {
        return res.status(400).json({ error: 'userId and deviceId required' });
    }

    // Set up SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send connection confirmation
    res.write(`data: ${JSON.stringify({ type: 'connected', deviceId })}\n\n`);

    // Store client
    if (!devicePairingClients.has(userId)) {
        devicePairingClients.set(userId, new Set());
    }
    devicePairingClients.get(userId).add({ deviceId, res });

    // Keep alive
    const keepAlive = setInterval(() => {
        res.write(':keepalive\n\n');
    }, 30000);

    // Clean up on disconnect
    req.on('close', () => {
        clearInterval(keepAlive);
        const clients = devicePairingClients.get(userId);
        if (clients) {
            for (const client of clients) {
                if (client.deviceId === deviceId) {
                    clients.delete(client);
                    break;
                }
            }
        }
    });
});

// Get user's devices
app.get('/api/devices/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const db = loadDevicesDb();

    // Parse OS from user-agent
    const ua = req.headers['user-agent'] || '';
    let detectedOS = 'Unknown';
    if (ua.includes('Windows')) detectedOS = 'Windows';
    else if (ua.includes('Mac')) detectedOS = 'macOS';
    else if (ua.includes('Linux') && !ua.includes('Android')) detectedOS = 'Linux';
    else if (ua.includes('Android')) detectedOS = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) detectedOS = 'iOS';

    // Find user by device - prefer the user with MOST devices (the paired group)
    let userId = null;
    let maxDevices = 0;
    for (const [uid, userData] of Object.entries(db.users)) {
        if (userData.devices && userData.devices.some(d => d.deviceId === deviceId)) {
            if (userData.devices.length > maxDevices) {
                userId = uid;
                maxDevices = userData.devices.length;
            }
        }
    }

    if (!userId) {
        // Create new user with this device
        userId = 'user-' + uuidv4().substring(0, 8);
        db.users[userId] = {
            createdAt: new Date().toISOString(),
            devices: [{
                deviceId,
                name: detectedOS + ' Device',
                platform: detectedOS,
                addedAt: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                verified: true,
                current: true
            }]
        };
        saveDevicesDb(db);
    } else {
        // Update lastActive and OS for the requesting device
        const device = db.users[userId].devices.find(d => d.deviceId === deviceId);
        if (device) {
            device.lastActive = new Date().toISOString();
            device.current = true;
            if (detectedOS !== 'Unknown') device.platform = detectedOS;
            // Mark other devices as not current
            db.users[userId].devices.forEach(d => {
                if (d.deviceId !== deviceId) d.current = false;
            });
        }
        saveDevicesDb(db);
    }

    const user = db.users[userId];

    // Add active status to each device (active within last 5 minutes)
    const devicesWithStatus = user.devices.map(d => ({
        ...d,
        isActive: d.current || (d.lastActive && (Date.now() - new Date(d.lastActive).getTime()) < 5 * 60 * 1000)
    }));

    res.json({
        success: true,
        userId,
        devices: devicesWithStatus,
        maxDevices: 5
    });
});

// Broadcast pairing event to all user's devices
function broadcastPairingEvent(userId, event, excludeDeviceId = null) {
    const clients = devicePairingClients.get(userId);
    if (clients) {
        const data = JSON.stringify(event);
        for (const client of clients) {
            if (client.deviceId !== excludeDeviceId) {
                client.res.write(`data: ${data}\n\n`);
            }
        }
    }
}

// Generate pairing code for adding new device
app.post('/api/devices/pairing-code', express.json(), (req, res) => {
    const { deviceId, deviceName } = req.body;
    const db = loadDevicesDb();

    // Generate 8-character pairing code
    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
                 Math.random().toString(36).substring(2, 6).toUpperCase();

    // Find user
    let userId = null;
    let initiatorDevice = null;
    for (const [uid, userData] of Object.entries(db.users)) {
        const device = userData.devices.find(d => d.deviceId === deviceId);
        if (device) {
            userId = uid;
            initiatorDevice = device;
            break;
        }
    }

    if (!userId) {
        return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    // Store pairing code (expires in 5 minutes)
    db.pairingCodes[code] = {
        userId,
        initiatorDeviceId: deviceId,
        initiatorDeviceName: initiatorDevice?.name || deviceName || 'Unknown Device',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };

    saveDevicesDb(db);

    // Broadcast pairing request to all user's other devices
    broadcastPairingEvent(userId, {
        type: 'pairing-request',
        code,
        fromDeviceId: deviceId,
        fromDeviceName: initiatorDevice?.name || deviceName || 'Unknown Device',
        expiresAt: db.pairingCodes[code].expiresAt
    }, deviceId);

    res.json({
        success: true,
        code,
        expiresIn: 300 // 5 minutes
    });
});

// Pair new device using code
app.post('/api/devices/pair', express.json(), (req, res) => {
    const { code, newDeviceId, deviceName, platform } = req.body;
    const db = loadDevicesDb();

    const pairing = db.pairingCodes[code];

    if (!pairing) {
        return res.status(404).json({ success: false, error: 'Invalid pairing code' });
    }

    if (new Date(pairing.expiresAt) < new Date()) {
        delete db.pairingCodes[code];
        saveDevicesDb(db);
        return res.status(400).json({ success: false, error: 'Pairing code expired' });
    }

    const user = db.users[pairing.userId];

    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Check device limit
    if (user.devices.length >= 5) {
        return res.status(400).json({ success: false, error: 'Maximum 5 devices allowed' });
    }

    // Check if device already added
    if (user.devices.some(d => d.deviceId === newDeviceId)) {
        return res.status(400).json({ success: false, error: 'Device already linked' });
    }

    // Remove new device from any existing solo user entry (prevents stale lookups on refresh)
    for (const [uid, userData] of Object.entries(db.users)) {
        if (uid !== pairing.userId && userData.devices) {
            const idx = userData.devices.findIndex(d => d.deviceId === newDeviceId);
            if (idx !== -1) {
                userData.devices.splice(idx, 1);
                // Delete empty user entries
                if (userData.devices.length === 0) {
                    delete db.users[uid];
                }
            }
        }
    }

    // Parse OS from platform/user-agent
    const ua = req.headers['user-agent'] || '';
    let os = platform || 'Unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    // Add new device
    const newDevice = {
        deviceId: newDeviceId,
        name: deviceName || 'New Device',
        platform: os,
        addedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        verified: true,
        current: false,
        pairedFrom: pairing.initiatorDeviceId
    };
    user.devices.push(newDevice);

    // Store initiator info before cleanup
    const initiatorDeviceId = pairing.initiatorDeviceId;
    const userId = pairing.userId;

    // Clean up pairing code
    delete db.pairingCodes[code];
    saveDevicesDb(db);

    console.log(`[Device] New device ${newDeviceId} paired to user ${userId}`);

    // Broadcast pairing success to all user's devices (especially the initiator)
