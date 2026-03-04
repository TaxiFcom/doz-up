        const affiliate = enterpriseService.createAffiliate(req.body);
        res.json({ success: true, affiliate });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get affiliates
app.get('/api/affiliates', (req, res) => {
    const affiliates = enterpriseService.getAffiliates();
    res.json({ success: true, affiliates });
});

// Get affiliate by code (for tracking)
app.get('/api/affiliates/code/:code', (req, res) => {
    const affiliate = enterpriseService.getAffiliateByCode(req.params.code);
    if (!affiliate) {
        return res.status(404).json({ error: 'Affiliate not found' });
    }
    res.json({ success: true, affiliate: { id: affiliate.id, name: affiliate.name, code: affiliate.code } });
});

// Track affiliate click
app.post('/api/affiliates/track/:code', (req, res) => {
    const affiliate = enterpriseService.trackAffiliateClick(req.params.code);
    res.json({ success: true, tracked: !!affiliate });
});

// Get affiliate stats
app.get('/api/affiliates/:id/stats', (req, res) => {
    const stats = enterpriseService.getAffiliateStats(req.params.id);
    if (!stats) {
        return res.status(404).json({ error: 'Affiliate not found' });
    }
    res.json({ success: true, stats });
});

// ============ SALES ANALYTICS ============

// Sales dashboard
app.get('/api/enterprise/analytics', (req, res) => {
    const analytics = enterpriseService.getSalesAnalytics();
    res.json({ success: true, ...analytics });
});

// Target progress ($300K goal)
app.get('/api/enterprise/target', (req, res) => {
    const progress = enterpriseService.getTargetProgress();
    res.json({ success: true, ...progress });
});

// ============ $1M WEEK PRICING ENDPOINTS ============

// Get lifetime deals
app.get('/api/enterprise/lifetime-deals', (req, res) => {
    const deals = enterpriseService.getLifetimeDeals();
    res.json({ success: true, deals });
});

// Purchase lifetime deal
app.post('/api/enterprise/lifetime-deals/purchase', express.json(), (req, res) => {
    try {
        const { dealType, customer } = req.body;
        const result = enterpriseService.purchaseLifetimeDeal(dealType, customer);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Get reseller tiers
app.get('/api/enterprise/reseller-tiers', (req, res) => {
    const tiers = enterpriseService.getResellerTiers();
    res.json({ success: true, tiers });
});

// Purchase reseller tier
app.post('/api/enterprise/reseller-tiers/purchase', express.json(), (req, res) => {
    try {
        const { tierType, customer } = req.body;
        const result = enterpriseService.purchaseResellerTier(tierType, customer);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Get mega deals
app.get('/api/enterprise/mega-deals', (req, res) => {
    const deals = enterpriseService.getMegaDeals();
    res.json({ success: true, deals });
});

// Get referral rewards structure
app.get('/api/enterprise/referral-rewards', (req, res) => {
    const rewards = enterpriseService.getReferralRewards();
    res.json({ success: true, rewards });
});

// Get founder spots status
app.get('/api/enterprise/founder-spots', (req, res) => {
    const spots = enterpriseService.getFounderSpots();
    res.json({ success: true, spots });
});

// Claim founder spot
app.post('/api/enterprise/founder-spots/claim', express.json(), (req, res) => {
    try {
        const result = enterpriseService.claimFounderSpot(req.body);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Get all pricing (consolidated)
app.get('/api/enterprise/all-pricing', (req, res) => {
    res.json({
        success: true,
        enterprise: enterpriseService.getTiers(),
        lifetime: enterpriseService.getLifetimeDeals(),
        reseller: enterpriseService.getResellerTiers(),
        megaDeals: enterpriseService.getMegaDeals(),
        referralRewards: enterpriseService.getReferralRewards(),
        founderSpots: enterpriseService.getFounderSpots(),
        target: {
            amount: 1000000,
            currency: 'USD',
            timeframe: '7 days'
        }
    });
});

// $1M Week Dashboard - comprehensive status
app.get('/api/enterprise/million-status', (req, res) => {
    try {
        const status = enterpriseService.getMillionDollarStatus();
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============ V2 SUBSCRIPTION SITE ============
const subscriptionDir = path.join(__dirname, 'subscription');
const subscriptionDataDir = path.join(subscriptionDir, 'data');

// Ensure subscription data directory exists
if (!fs.existsSync(subscriptionDataDir)) {
    fs.mkdirSync(subscriptionDataDir, { recursive: true });
}

// Helper functions for subscription
function readSubscriptionFile(filename, defaultValue = []) {
    const filePath = path.join(subscriptionDataDir, filename);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function writeSubscriptionFile(filename, data) {
    const filePath = path.join(subscriptionDataDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data));
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Pricing configuration (storage in MB)
const PRICING = {
    starter_monthly: { price: 3.33, storage: 512, name: 'Starter Monthly' },          // 500 MB
    starter_yearly: { price: 33.33, storage: 512, name: 'Starter Yearly' },           // 500 MB
    pro_monthly: { price: 99.99, storage: 51200, name: 'Pro Monthly' },               // 50 GB
    pro_yearly: { price: 999.00, storage: 51200, name: 'Pro Yearly' },                // 50 GB
    business_monthly: { price: 199.00, storage: 153600, name: 'Business Monthly', accounts: 3 },  // 150 GB, 3 accounts
    business_yearly: { price: 1990.00, storage: 153600, name: 'Business Yearly', accounts: 3 }    // 150 GB, 3 accounts
};

// V2 Static files
app.use('/v2', express.static(path.join(subscriptionDir, 'public')));

// V2 Subscribe endpoint
app.post('/api/subscribe', express.json(), (req, res) => {
    try {
        const { name, email, password, plan, utm_source, utm_campaign } = req.body;

        if (!name || !email || !password || !plan) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const users = readSubscriptionFile('users.json', []);

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const planConfig = PRICING[plan];
        if (!planConfig) {
            return res.status(400).json({ error: 'Invalid plan selected' });
        }

        const newUser = {
            id: uuidv4(),
            name,
            email,
            password: hashPassword(password),
            plan,
            planName: planConfig.name,
            price: planConfig.price,
            storageLimit: planConfig.storage,
            storageUsed: 0,
            status: 'active',
            source: utm_source || 'direct',
            campaign: utm_campaign || null,
            joined: new Date().toISOString()
        };

        users.push(newUser);
        writeSubscriptionFile('users.json', users);

        // Track conversion
        const analytics = readSubscriptionFile('analytics.json', { events: [], daily: {} });
        const today = new Date().toISOString().split('T')[0];
        if (!analytics.daily[today]) {
            analytics.daily[today] = { pageviews: 0, signups: 0, conversions: 0, revenue: 0, sources: {} };
        }
        analytics.daily[today].signups++;
        analytics.daily[today].conversions++;
        analytics.daily[today].revenue += planConfig.price;
        writeSubscriptionFile('analytics.json', analytics);

        res.json({ success: true, userId: newUser.id });
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Analytics pageview - REMOVED (duplicate of line ~2388, handled by main analytics engine)
// V2 Analytics event - REMOVED (duplicate of line ~2399, handled by main analytics engine)

// V2 placeholder - keep response chain intact
app.post('/api/v2/analytics/pageview', express.json(), (req, res) => {
    res.json({ success: true, redirected: 'Use /api/analytics/pageview instead' });
});
app.post('/api/v2/analytics/event', express.json(), (req, res) => {
    res.json({ success: true, redirected: 'Use /api/analytics/event instead' });
});

// V2 Admin Dashboard (Admin only - contains sensitive business data)
app.get('/api/admin/dashboard', requireAdmin('analytics:company'), (req, res) => {
    try {
        const users = readSubscriptionFile('users.json', []);
        const analytics = readSubscriptionFile('analytics.json', { events: [], daily: {} });

        const today = new Date().toISOString().split('T')[0];
        const todayStats = analytics.daily[today] || { pageviews: 0, signups: 0, revenue: 0 };

        const totalUsers = users.length;
        const activeSubscribers = users.filter(u => u.status === 'active').length;

        const totalPageviews = Object.values(analytics.daily).reduce((sum, d) => sum + (d.pageviews || 0), 0) || 1;
        const totalSignups = Object.values(analytics.daily).reduce((sum, d) => sum + (d.signups || 0), 0);
        const conversionRate = (totalSignups / totalPageviews) * 100;

        const signupsByDay = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            signupsByDay.push(analytics.daily[date]?.signups || 0);
        }

        const planDistribution = {
            personal: users.filter(u => u.plan?.includes('personal')).length,
            pro: users.filter(u => u.plan?.includes('pro')).length,
            business: users.filter(u => u.plan?.includes('business')).length
        };

        const recentUsers = users
            .sort((a, b) => new Date(b.joined) - new Date(a.joined))
            .slice(0, 10)
            .map(u => ({
                name: u.name,
                email: u.email,
                plan: u.plan,
                source: u.source,
                date: u.joined?.split('T')[0],
                status: u.status
            }));

        res.json({
            totalUsers,
            activeSubscribers,
            todayRevenue: todayStats.revenue || 0,
            conversionRate,
            signupsByDay,
            planDistribution,
            recentUsers
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Users (Admin and Moderator can view, only Admin can modify)
app.get('/api/admin/users', requireAdmin('users:read'), (req, res) => {
    try {
        const users = readSubscriptionFile('users.json', []);
        const safeUsers = users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            plan: u.plan,
            storageUsed: u.storageUsed || 0,
            storageLimit: u.storageLimit || 1024,
            joined: u.joined?.split('T')[0],
            status: u.status,
            source: u.source
        }));
        res.json(safeUsers);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Create User (Admin only - write permission)
app.post('/api/admin/users', requireAdmin('users:write'), express.json(), (req, res) => {
    try {
        const { name, email, plan, status } = req.body;
        const users = readSubscriptionFile('users.json', []);
        const planConfig = PRICING[plan] || PRICING.personal_monthly;

        const newUser = {
            id: uuidv4(),
            name,
            email,
            password: hashPassword('temp123'),
            plan,
            planName: planConfig.name,
            price: planConfig.price,
            storageLimit: planConfig.storage,
            storageUsed: 0,
            status: status || 'active',
            source: 'admin',
            joined: new Date().toISOString()
        };

        users.push(newUser);
        writeSubscriptionFile('users.json', users);
        res.json({ success: true, user: newUser });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Update User (Admin only - write permission)
app.put('/api/admin/users', requireAdmin('users:write'), express.json(), (req, res) => {
    try {
        const { id, name, email, plan, status } = req.body;
        const users = readSubscriptionFile('users.json', []);
        const userIndex = users.findIndex(u => u.id === id);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        const planConfig = PRICING[plan] || PRICING[users[userIndex].plan];
        users[userIndex] = { ...users[userIndex], name, email, plan, planName: planConfig.name, storageLimit: planConfig.storage, status };

        writeSubscriptionFile('users.json', users);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// V2 Admin Delete User (Admin only - manage permission required)
app.delete('/api/admin/users/:id', requireAdmin('users:manage'), (req, res) => {
    try {
        const { id } = req.params;
        let users = readSubscriptionFile('users.json', []);
        users = users.filter(u => u.id !== id);
        writeSubscriptionFile('users.json', users);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ OUTREACH API ============

// Get email templates
app.get('/api/outreach/templates', (req, res) => {
    res.json({
        success: true,
        templates: outreachService.getTemplates()
    });
});

// Get specific template
app.get('/api/outreach/templates/:id', (req, res) => {
    const template = outreachService.getTemplate(req.params.id);
    if (!template) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, template });
});

// Render template with variables
app.post('/api/outreach/render', express.json(), (req, res) => {
    const { templateId, variables } = req.body;
    const rendered = outreachService.renderTemplate(templateId, variables);
    if (!rendered) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, ...rendered });
});

// Get email sequences
app.get('/api/outreach/sequences', (req, res) => {
    res.json({
        success: true,
        sequences: outreachService.getSequences()
    });
});

// Create campaign
app.post('/api/outreach/campaigns', express.json(), (req, res) => {
    try {
        const campaign = outreachService.createCampaign(req.body);
        res.json({ success: true, campaign });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get campaign stats
app.get('/api/outreach/campaigns/:id/stats', (req, res) => {
    const stats = outreachService.getCampaignStats(req.params.id);
    if (!stats) {
        return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json({ success: true, stats });
});

// Log email sent
app.post('/api/outreach/emails', express.json(), (req, res) => {
    const email = outreachService.logEmail(req.body);
    res.json({ success: true, email });
});

// Generate personalized email for lead
app.post('/api/outreach/generate-for-lead', express.json(), (req, res) => {
    const { leadId, templateId, additionalVars } = req.body;
    const lead = enterpriseService.getLead(leadId);
    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }
    const email = outreachService.generateEmailForLead(lead, templateId, additionalVars);
    if (!email) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true, ...email });
});

// Get outreach stats
app.get('/api/outreach/stats', (req, res) => {
    const stats = outreachService.getStats();
    res.json({ success: true, ...stats });
});

// ============ SCHEDULING API ============

// Get available slots
app.get('/api/scheduling/slots', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const slots = schedulingService.getAvailableSlots(days);
    res.json({ success: true, slots, count: slots.length });
});

// Get slots grouped by date
app.get('/api/scheduling/slots/grouped', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const grouped = schedulingService.getSlotsGroupedByDate(days);
    res.json({ success: true, dates: grouped });
});

// Book a demo
app.post('/api/scheduling/demos', express.json(), (req, res) => {
    try {
        const demo = schedulingService.bookDemo(req.body);

        // Send notification for scheduled demo
        notificationService.notifyDemoScheduled(demo);

        // Log activity
        activityService.log('DEMO_SCHEDULED', {
