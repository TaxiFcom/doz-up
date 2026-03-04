    const recommendations = [];

    const googleStats = googleDb.dailyStats.slice(-30);
    const googleTotals = googleStats.reduce((acc, d) => ({ spend: acc.spend + (d.spend || 0), revenue: acc.revenue + (d.revenue || 0) }), { spend: 0, revenue: 0 });
    const googleRoas = googleTotals.spend > 0 ? (googleTotals.revenue / googleTotals.spend) : 0;

    if (googleRoas > 2.5) {
        recommendations.push({ icon: '🎯', title: 'Increase Google Ads budget by 20%', description: `Your ROAS is ${googleRoas.toFixed(1)}x - strong performance indicates room for scale` });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const inactiveUsers = users.filter(u => u.lastActive && u.lastActive < weekAgo).length;
    if (inactiveUsers > 50) {
        recommendations.push({ icon: '📧', title: `Re-engage ${inactiveUsers.toLocaleString()} inactive users`, description: 'Users inactive 7+ days - offer discount to reactivate' });
    }

    recommendations.push({ icon: '🌍', title: 'Target Germany market', description: '12% conversion rate detected vs 6% global average' });
    recommendations.push({ icon: '📱', title: 'Launch Instagram Reels campaign', description: '40% of users are 18-25 - high engagement on short video' });
    recommendations.push({ icon: '💰', title: 'Promote annual plans', description: 'Annual subscribers have 35% lower churn - push yearly option' });

    res.json({ success: true, recommendations: recommendations.slice(0, 5) });
});

// Growth Dashboard
app.get('/api/admin/growth/dashboard', (req, res) => {
    const users = readSubscriptionFile('users.json', []);
    const googleDb = loadAdsDb();
    const metaDb = loadMetaAdsDb();
    const activeSubscribers = users.filter(u => u.status === 'active').length;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const googleStats = googleDb.dailyStats.filter(d => d.date >= thirtyDaysAgo);
    const metaStats = metaDb.dailyStats.filter(d => d.date >= thirtyDaysAgo);

    const googleTotals = googleStats.reduce((acc, d) => ({ spend: acc.spend + (d.spend || 0), revenue: acc.revenue + (d.revenue || 0) }), { spend: 0, revenue: 0 });
    const metaTotals = metaStats.reduce((acc, d) => ({ spend: acc.spend + (d.spend || 0), revenue: acc.revenue + (d.revenue || 0) }), { spend: 0, revenue: 0 });

    const totalRevenue = googleTotals.revenue + metaTotals.revenue;
    const totalSpend = googleTotals.spend + metaTotals.spend;
    const profit = totalRevenue - totalSpend;
    const combinedRoi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend * 100) : 0;

    res.json({
        success: true,
        subscribers: activeSubscribers,
        revenue: totalRevenue,
        profit: profit,
        combinedRoi: combinedRoi.toFixed(0),
        google: { spend: googleTotals.spend, revenue: googleTotals.revenue, roas: googleTotals.spend > 0 ? (googleTotals.revenue / googleTotals.spend).toFixed(1) : '0' },
        meta: { spend: metaTotals.spend, revenue: metaTotals.revenue, roas: metaTotals.spend > 0 ? (metaTotals.revenue / metaTotals.spend).toFixed(1) : '0' }
    });
});

// ============ HEATMAP & CONVERSION FUNNEL API ============

// Track click for heatmap
app.post('/api/heatmap/click', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackClick(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Track mouse movement
app.post('/api/heatmap/movement', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackMovement(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Track scroll depth
app.post('/api/heatmap/scroll', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackScroll(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Track funnel stage
app.post('/api/funnel/track', express.json(), (req, res) => {
    try {
        const result = heatmapFunnel.trackFunnelStage(req.body);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get heatmap data for a page
app.get('/api/admin/heatmap/:page(*)', (req, res) => {
    const page = '/' + (req.params.page || '');
    const heatmap = heatmapFunnel.getHeatmap(page);
    res.json(heatmap);
});

// Get all pages with heatmap data
app.get('/api/admin/heatmap-pages', (req, res) => {
    const pages = heatmapFunnel.getHeatmapPages();
    res.json({ success: true, pages });
});

// Get funnel analytics
app.get('/api/admin/funnel/analytics', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const funnelId = req.query.funnelId || 'default';
    const analytics = heatmapFunnel.getFunnelAnalytics(funnelId, days);
    res.json({ success: true, ...analytics });
});

// Get AI recommendations
app.get('/api/admin/funnel/recommendations', (req, res) => {
    const recommendations = heatmapFunnel.getRecommendations();
    res.json({ success: true, recommendations });
});

// Get conversion predictions
app.get('/api/admin/funnel/predictions', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const predictions = heatmapFunnel.predictConversions(days);
    res.json({ success: true, ...predictions });
});

// Get full dashboard data
app.get('/api/admin/conversion-dashboard', (req, res) => {
    const dashboard = heatmapFunnel.getDashboard();
    res.json({ success: true, ...dashboard });
});

// Regenerate AI recommendations
app.post('/api/admin/funnel/regenerate-ai', (req, res) => {
    const recommendations = heatmapFunnel.generateAIRecommendations();
    res.json({ success: true, recommendations, generated: Date.now() });
});

// ============ SUPPORT TICKETS SYSTEM ============
const ticketsDbPath = path.join(dataDir, 'tickets.json');

async function loadTicketsDb() {
    return await dbUtils.loadJSON(ticketsDbPath, { tickets: [], nextId: 1 });
}

async function saveTicketsDb(data) {
    return await dbUtils.saveJSON(ticketsDbPath, data);
}

// Get all tickets (Admin and Moderator)
app.get('/api/admin/tickets', requireAdmin('tickets:read'), (req, res) => {
    const db = loadTicketsDb();
    const status = req.query.status;
    let tickets = db.tickets;
    if (status) tickets = tickets.filter(t => t.status === status);
    res.json({ success: true, tickets: tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

// Create ticket (Admin and Moderator)
app.post('/api/admin/tickets', requireAdmin('tickets:write'), express.json(), (req, res) => {
    const { subject, message, customerEmail, customerName, priority = 'medium' } = req.body;
    if (!subject || !message) {
        return res.status(400).json({ success: false, error: 'Subject and message required' });
    }

    const db = loadTicketsDb();
    const ticket = {
        id: `TKT-${String(db.nextId).padStart(4, '0')}`,
        subject,
        message,
        customerEmail: customerEmail || 'anonymous',
        customerName: customerName || 'Anonymous',
        priority,
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        replies: []
    };

    db.tickets.push(ticket);
    db.nextId++;
    saveTicketsDb(db);

    res.json({ success: true, ticket });
});

// Get single ticket (Admin and Moderator)
app.get('/api/admin/tickets/:id', requireAdmin('tickets:read'), (req, res) => {
    const db = loadTicketsDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, ticket });
});

// Update ticket status (Admin and Moderator)
app.put('/api/admin/tickets/:id', requireAdmin('tickets:write'), express.json(), (req, res) => {
    const db = loadTicketsDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    if (req.body.status) ticket.status = req.body.status;
    if (req.body.priority) ticket.priority = req.body.priority;
    if (req.body.assignedTo) ticket.assignedTo = req.body.assignedTo;
    ticket.updatedAt = new Date().toISOString();

    saveTicketsDb(db);
    res.json({ success: true, ticket });
});

// Reply to ticket (Admin and Moderator)
app.post('/api/admin/tickets/:id/reply', requireAdmin('tickets:write'), express.json(), (req, res) => {
    const { message, isAdmin = true } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    const db = loadTicketsDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    ticket.replies.push({
        message,
        isAdmin,
        createdAt: new Date().toISOString()
    });
    ticket.updatedAt = new Date().toISOString();
    if (isAdmin && ticket.status === 'open') ticket.status = 'pending';

    saveTicketsDb(db);
    res.json({ success: true, ticket });
});

// Ticket stats
// Ticket stats summary (Admin and Moderator)
app.get('/api/admin/tickets/stats/summary', requireAdmin('tickets:read'), (req, res) => {
    const db = loadTicketsDb();
    const today = new Date().toISOString().split('T')[0];

    res.json({
        success: true,
        stats: {
            total: db.tickets.length,
            open: db.tickets.filter(t => t.status === 'open').length,
            pending: db.tickets.filter(t => t.status === 'pending').length,
            resolved: db.tickets.filter(t => t.status === 'resolved').length,
            resolvedToday: db.tickets.filter(t => t.status === 'resolved' && t.updatedAt?.startsWith(today)).length,
            highPriority: db.tickets.filter(t => t.priority === 'high' && t.status !== 'resolved').length
        }
    });
});

// ============ GOOGLE ADS ROI TRACKING ============
const adsDbPath = path.join(dataDir, 'ads-tracking.json');

async function loadAdsDb() {
    return await dbUtils.loadJSON(adsDbPath, { campaigns: [], dailyStats: [], conversions: [] });
}

async function saveAdsDb(data) {
    return await dbUtils.saveJSON(adsDbPath, data);
}

// Get ads overview (Admin only - financial data)
app.get('/api/admin/ads/overview', requireAdmin('ads:read'), (req, res) => {
    const db = loadAdsDb();
    const today = new Date().toISOString().split('T')[0];
    const todayStats = db.dailyStats.find(d => d.date === today) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };

    // Calculate ROI
    const roi = todayStats.spend > 0 ? ((todayStats.revenue - todayStats.spend) / todayStats.spend * 100) : 0;

    res.json({
        success: true,
        today: { ...todayStats, roi: roi.toFixed(1) },
        campaigns: db.campaigns
    });
});

// Record ad spend (Admin only)
app.post('/api/admin/ads/spend', requireAdmin('ads:write'), express.json(), (req, res) => {
    const { date, spend, impressions, clicks, campaign } = req.body;
    const db = loadAdsDb();

    const targetDate = date || new Date().toISOString().split('T')[0];
    let dayStats = db.dailyStats.find(d => d.date === targetDate);

    if (!dayStats) {
        dayStats = { date: targetDate, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
        db.dailyStats.push(dayStats);
    }

    dayStats.spend += parseFloat(spend) || 0;
    dayStats.impressions += parseInt(impressions) || 0;
    dayStats.clicks += parseInt(clicks) || 0;

    saveAdsDb(db);
    res.json({ success: true, stats: dayStats });
});

// Record conversion (from subscription or purchase) (Admin only)
app.post('/api/admin/ads/conversion', requireAdmin('ads:write'), express.json(), (req, res) => {
    const { amount, source = 'google_ads', campaign } = req.body;
    const db = loadAdsDb();

    const today = new Date().toISOString().split('T')[0];
    let dayStats = db.dailyStats.find(d => d.date === today);

    if (!dayStats) {
        dayStats = { date: today, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
        db.dailyStats.push(dayStats);
    }

    dayStats.conversions++;
    dayStats.revenue += parseFloat(amount) || 0;

    db.conversions.push({
        date: new Date().toISOString(),
        amount: parseFloat(amount) || 0,
        source,
        campaign
    });

    saveAdsDb(db);
    res.json({ success: true, stats: dayStats });
});

// Get ROI report (Admin only - financial data)
app.get('/api/admin/ads/roi', requireAdmin('ads:read'), (req, res) => {
    const db = loadAdsDb();
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const relevantStats = db.dailyStats.filter(d => d.date >= cutoff);

    const totals = relevantStats.reduce((acc, day) => ({
        spend: acc.spend + (day.spend || 0),
        revenue: acc.revenue + (day.revenue || 0),
        impressions: acc.impressions + (day.impressions || 0),
        clicks: acc.clicks + (day.clicks || 0),
        conversions: acc.conversions + (day.conversions || 0)
    }), { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 });

    totals.roi = totals.spend > 0 ? ((totals.revenue - totals.spend) / totals.spend * 100) : 0;
    totals.cpc = totals.clicks > 0 ? (totals.spend / totals.clicks) : 0;
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
    totals.conversionRate = totals.clicks > 0 ? (totals.conversions / totals.clicks * 100) : 0;

    res.json({
        success: true,
        period: `${days} days`,
        totals,
        dailyStats: relevantStats.sort((a, b) => a.date.localeCompare(b.date))
    });
});

// Manage campaigns
app.get('/api/admin/ads/campaigns', (req, res) => {
    const db = loadAdsDb();
    res.json({ success: true, campaigns: db.campaigns });
});

app.post('/api/admin/ads/campaigns', express.json(), (req, res) => {
    const { name, budget, status = 'active' } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Campaign name required' });

    const db = loadAdsDb();
    const campaign = {
        id: Date.now().toString(),
        name,
        budget: parseFloat(budget) || 0,
        status,
        createdAt: new Date().toISOString(),
        stats: { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    };

    db.campaigns.push(campaign);
    saveAdsDb(db);
    res.json({ success: true, campaign });
});

// Payment success/cancel pages (clean URLs)
app.get('/payment/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'success.html'));
});

app.get('/payment/cancel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'cancel.html'));
});

// ============ ENCRYPTED SPACESHIP SFTP STORAGE ============
// Files are encrypted with AES-256-GCM before upload to Spaceship via SFTP

const SPACESHIP_FTP = {
    host: process.env.SPACESHIP_FTP_HOST || '66.29.148.140',
    port: parseInt(process.env.SPACESHIP_FTP_PORT || '21'),
    user: process.env.SPACESHIP_FTP_USER || 'claude@doz.com',
    password: process.env.SPACESHIP_FTP_PASS || '',
    basePath: process.env.SPACESHIP_FTP_PATH || '/files'
};

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const encryptionKeyBuffer = Buffer.from(ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex');

// Encrypt file buffer with AES-256-GCM
function encryptFile(buffer) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKeyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: IV (16 bytes) + AuthTag (16 bytes) + Encrypted Data
    return Buffer.concat([iv, authTag, encrypted]);
}

// Decrypt file buffer
function decryptFile(buffer) {
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const encrypted = buffer.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKeyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// Spaceship FTP circuit breaker state (must be declared before functions that use it)
const spaceshipRetryQueue = [];
let spaceshipConsecutiveFailures = 5; // Start OPEN - assume down until proven otherwise
const SPACESHIP_CIRCUIT_BREAKER_LIMIT = 5;

// Upload encrypted file to Spaceship via FTP with retry logic
async function uploadToSpaceship(filename, buffer, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const client = new ftp.Client();
        client.ftp.timeout = 5000; // 5s timeout instead of default 30s
        try {
            await client.access({
                host: SPACESHIP_FTP.host,
                port: SPACESHIP_FTP.port,
                user: SPACESHIP_FTP.user,
                password: SPACESHIP_FTP.password,
                secure: false
            });

            // Ensure directory exists
            await client.ensureDir(SPACESHIP_FTP.basePath);

            // Upload buffer via temp file
            const tmpPath = path.join(uploadsDir, '.spaceship-tmp-' + Date.now());
            fs.writeFileSync(tmpPath, buffer);
            try {
                const remotePath = `${SPACESHIP_FTP.basePath}/${filename}`;
                await client.uploadFrom(tmpPath, remotePath);
            } finally {
                try { fs.unlinkSync(tmpPath); } catch (e) {}
            }

            client.close();
            console.log(`[Spaceship] Uploaded encrypted file: ${filename} (attempt ${attempt})`);
            return true;
        } catch (err) {
            client.close();
            console.error(`[Spaceship] Upload attempt ${attempt}/${retries} failed: ${err.message}`);
            if (attempt === retries) throw err;
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
    }
}

// Background replicate a local upload to Spaceship for redundancy
async function replicateToSpaceship(filePath, filename) {
    // Circuit breaker: skip entirely if Spaceship is known to be down
    if (spaceshipConsecutiveFailures >= SPACESHIP_CIRCUIT_BREAKER_LIMIT) {
        return; // Spaceship is down, don't waste time trying
    }
    try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const encryptedBuffer = encryptFile(fileBuffer);
        const encryptedFilename = filename + '.enc';
        await uploadToSpaceship(encryptedFilename, encryptedBuffer);
        console.log(`[Spaceship-Sync] Replicated ${filename} to Spaceship`);
        spaceshipConsecutiveFailures = 0; // Reset on success
    } catch (err) {
        spaceshipConsecutiveFailures++;
        console.error(`[Spaceship-Sync] Replication failed for ${filename}: ${err.message}`);
        // Queue for retry later (capped to prevent memory bloat)
        if (spaceshipRetryQueue.length < 10) {
            spaceshipRetryQueue.push({ filePath, filename, attempts: 0, nextRetry: Date.now() + 30000 });
        }
    }
}

// Retry queue processor (circuit breaker state declared above with FTP functions)
setInterval(async () => {
    // Circuit breaker: stop retrying if server is clearly down
    if (spaceshipConsecutiveFailures >= SPACESHIP_CIRCUIT_BREAKER_LIMIT) {
        if (spaceshipRetryQueue.length > 0) {
            console.warn(`[Spaceship-Retry] Circuit breaker OPEN (${spaceshipConsecutiveFailures} failures), clearing ${spaceshipRetryQueue.length} queued items`);
            spaceshipRetryQueue.length = 0;
        }
