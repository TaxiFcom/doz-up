const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;
const DOMAIN = process.env.DOMAIN || 'up.doz.com.im';

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Data paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const REFERRALS_FILE = path.join(DATA_DIR, 'referrals.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJsonFile(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) { console.error('Error reading', filePath, e.message); }
    return defaultValue;
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() { return crypto.randomBytes(8).toString('hex'); }
function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }
function generateReferralCode() { return crypto.randomBytes(4).toString('hex').toUpperCase(); }

const PRICING = {
    trial: { price: 0, storage: 1024, name: 'Free Trial', trialDays: 14 },
    personal_monthly: { price: 3.33, storage: 1024, name: 'Personal Monthly' },
    personal_yearly: { price: 13.33, storage: 1024, name: 'Personal Yearly' },
    pro_monthly: { price: 6.99, storage: 10240, name: 'Pro Monthly' },
    pro_yearly: { price: 24.99, storage: 10240, name: 'Pro Yearly' },
    business_monthly: { price: 19.99, storage: 102400, name: 'Business Monthly' },
    business_yearly: { price: 99.99, storage: 102400, name: 'Business Yearly' }
};

function trackEvent(event, data) {
    try {
        const analytics = readJsonFile(ANALYTICS_FILE, { events: [], daily: {} });
        analytics.events.push({ event, data, timestamp: new Date().toISOString() });
        const today = new Date().toISOString().split('T')[0];
        if (!analytics.daily[today]) analytics.daily[today] = { trials: 0, conversions: 0 };
        if (event === 'trial_started') analytics.daily[today].trials++;
        if (event === 'subscription_completed') analytics.daily[today].conversions++;
        writeJsonFile(ANALYTICS_FILE, analytics);
    } catch (e) { console.error('Analytics error:', e); }
}

// ============ API ROUTES (BEFORE STATIC FILES) ============

// Pricing API
app.get('/api/pricing', (req, res) => {
    res.json({
        success: true,
        plans: PRICING,
        features: {
            trial: ['14 days free', '1GB storage', 'Basic capture', 'Cloud upload'],
            personal: ['Unlimited screenshots', '1GB storage', '30-day history', 'Email support'],
            pro: ['Everything in Personal', '10GB storage', 'Unlimited history', 'API access'],
            business: ['Everything in Pro', '100GB storage', 'Team collaboration', 'SSO']
        }
    });
});

// Start Free Trial
app.post('/api/start-trial', (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });

        const users = readJsonFile(USERS_FILE, []);
        if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });

        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);

        const newUser = {
            id: generateId(),
            name, email,
            password: hashPassword(password),
            plan: 'trial',
            planName: 'Free Trial',
            price: 0,
            storageLimit: 1024,
            storageUsed: 0,
            status: 'trial',
            joined: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            trialStart: new Date().toISOString(),
            trialEnd: trialEnd.toISOString(),
            subscriptionStart: null,
            subscriptionEnd: null,
            referralCode: generateReferralCode(),
            referralCount: 0
        };

        users.push(newUser);
        writeJsonFile(USERS_FILE, users);
        trackEvent('trial_started', { userId: newUser.id });

        res.json({ success: true, userId: newUser.id, trialDays: 14, trialEnd: trialEnd.toISOString() });
    } catch (error) {
        console.error('Trial error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Subscribe
app.post('/api/subscribe', (req, res) => {
    try {
        const { name, email, password, plan } = req.body;
        if (!plan) return res.status(400).json({ error: 'Plan required' });

        const planConfig = PRICING[plan];
        if (!planConfig) return res.status(400).json({ error: 'Invalid plan' });

        const users = readJsonFile(USERS_FILE, []);
        let user;

        if (req.body.userId) {
            user = users.find(u => u.id === req.body.userId);
            if (!user) return res.status(404).json({ error: 'User not found' });
            user.plan = plan;
            user.planName = planConfig.name;
            user.price = planConfig.price;
            user.storageLimit = planConfig.storage;
            user.status = 'active';
            user.subscriptionStart = new Date().toISOString();
            user.subscriptionEnd = plan.includes('yearly')
                ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        } else {
            if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
            if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });

            user = {
                id: generateId(),
                name, email,
                password: hashPassword(password),
                plan,
                planName: planConfig.name,
                price: planConfig.price,
                storageLimit: planConfig.storage,
                storageUsed: 0,
                status: 'active',
                joined: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                trialStart: null,
                trialEnd: null,
                subscriptionStart: new Date().toISOString(),
                subscriptionEnd: plan.includes('yearly')
                    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                referralCode: generateReferralCode(),
                referralCount: 0
            };
            users.push(user);
        }

        writeJsonFile(USERS_FILE, users);
        trackEvent('subscription_completed', { userId: user.id, plan });
        res.json({ success: true, userId: user.id, plan: planConfig.name });
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const users = readJsonFile(USERS_FILE, []);
        const user = users.find(u => u.email === email && u.password === hashPassword(password));

        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        if (user.status === 'trial' && user.trialEnd) {
            if (new Date(user.trialEnd) < new Date()) {
                user.status = 'expired';
                writeJsonFile(USERS_FILE, users);
                return res.status(403).json({ error: 'Trial expired', expired: true });
            }
        }

        user.lastLogin = new Date().toISOString();
        writeJsonFile(USERS_FILE, users);

        res.json({
            success: true,
            userId: user.id,
            name: user.name,
            email: user.email,
            plan: user.plan,
            status: user.status,
            trialEnd: user.trialEnd,
            referralCode: user.referralCode
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Password Reset
const RESET_TOKENS_FILE = path.join(DATA_DIR, 'reset_tokens.json');

app.post('/api/forgot-password', (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const users = readJsonFile(USERS_FILE, []);
        const user = users.find(u => u.email === email);
        if (!user) return res.json({ success: true, message: 'If email exists, reset link sent' });

        const resetTokens = readJsonFile(RESET_TOKENS_FILE, []);
        const token = generateId();
        const expires = new Date();
        expires.setHours(expires.getHours() + 1);

        resetTokens.push({
            token, userId: user.id, email: user.email,
            expires: expires.toISOString(), used: false,
            created: new Date().toISOString()
        });

        writeJsonFile(RESET_TOKENS_FILE, resetTokens);
        console.log('Reset token for ' + email + ': ' + token);
        res.json({ success: true, message: 'Reset link sent', token });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/verify-reset-token/:token', (req, res) => {
    const resetTokens = readJsonFile(RESET_TOKENS_FILE, []);
    const resetToken = resetTokens.find(t =>
        t.token === req.params.token && !t.used && new Date(t.expires) > new Date()
    );
    if (!resetToken) return res.status(400).json({ error: 'Invalid token' });
    res.json({ success: true, email: resetToken.email });
});

app.post('/api/reset-password', (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password too short' });

        const resetTokens = readJsonFile(RESET_TOKENS_FILE, []);
        const resetToken = resetTokens.find(t =>
            t.token === token && !t.used && new Date(t.expires) > new Date()
        );
        if (!resetToken) return res.status(400).json({ error: 'Invalid token' });

        const users = readJsonFile(USERS_FILE, []);
        const user = users.find(u => u.id === resetToken.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.password = hashPassword(password);
        writeJsonFile(USERS_FILE, users);
        resetToken.used = true;
        writeJsonFile(RESET_TOKENS_FILE, resetTokens);

        res.json({ success: true, message: 'Password reset successful' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Referrals
app.get('/api/referral/:userId', (req, res) => {
    try {
        const users = readJsonFile(USERS_FILE, []);
        const referrals = readJsonFile(REFERRALS_FILE, []);
        const user = users.find(u => u.id === req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const userReferrals = referrals.filter(r => r.referrerCode === user.referralCode);
        const successful = userReferrals.filter(r => r.status === 'converted');
        res.json({
            success: true,
            referralCode: user.referralCode,
            referralLink: `https://${DOMAIN}/?ref=${user.referralCode}`,
            totalReferrals: userReferrals.length,
            successfulReferrals: successful.length,
            rewardDays: successful.length * 30
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin
app.get('/api/admin/users', (req, res) => {
    const users = readJsonFile(USERS_FILE, []);
    const summary = users.map(u => ({ id: u.id, name: u.name, email: u.email, plan: u.plan, status: u.status, joined: u.joined }));
    res.json({ success: true, users: summary, count: summary.length });
});

app.get('/api/admin/analytics', (req, res) => {
    const analytics = readJsonFile(ANALYTICS_FILE, { events: [], daily: {} });
    const users = readJsonFile(USERS_FILE, []);
    const today = new Date().toISOString().split('T')[0];
    const todayStats = analytics.daily[today] || { trials: 0, conversions: 0 };

    res.json({
        success: true,
        today: todayStats,
        totals: {
            totalUsers: users.length,
            trialUsers: users.filter(u => u.status === 'trial').length,
            activeSubscribers: users.filter(u => u.status === 'active').length,
            expiredTrials: users.filter(u => u.status === 'expired').length
        }
    });
});

// Static files AFTER API routes
app.use('/v2', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    console.log('???? DOZ UP Server running on port ' + PORT);
    console.log('???? Pricing: http://localhost:' + PORT + '/api/pricing');
    console.log('???? Trial: POST http://localhost:' + PORT + '/api/start-trial');
});

// ============================================
// STRIPE PAYMENT ENDPOINTS
// ============================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_key');

// Create payment intent
app.post('/api/payments/create-intent', async (req, res) => {
    try {
        const { planId, userId, amount } = req.body;

        // Create or get customer
        let customerId;
        const users = readJsonFile(USERS_FILE, []);
        const user = users.find(u => u.id === userId);

        if (user?.stripeCustomerId) {
            customerId = user.stripeCustomerId;
        } else {
            const customer = await stripe.customers.create({
                email: user?.email,
                metadata: { userId }
            });
            customerId = customer.id;
            
            // Save customer ID
            if (user) {
                user.stripeCustomerId = customerId;
                writeJsonFile(USERS_FILE, users);
            }
        }

        // Create ephemeral key
        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: customerId },
            { apiVersion: '2023-10-16' }
        );

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'usd',
            customer: customerId,
            automatic_payment_methods: { enabled: true },
            metadata: { planId, userId }
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            customerId: customerId
        });

    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook for payment events
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle events
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            const { planId, userId } = paymentIntent.metadata;
            
            // Activate subscription
            const users = readJsonFile(USERS_FILE, []);
            const user = users.find(u => u.id === userId);
            if (user) {
                user.plan = planId.replace('_monthly', '').replace('_yearly', '');
                user.planName = planId.includes('yearly') ? 'Yearly' : 'Monthly';
                user.status = 'active';
                user.subscriptionStart = new Date().toISOString();
                user.subscriptionEnd = planId.includes('yearly')
                    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                writeJsonFile(USERS_FILE, users);
                
                trackEvent('subscription_completed', { userId, plan: planId, amount: paymentIntent.amount });
            }
            break;
            
        case 'payment_intent.payment_failed':
            console.log('Payment failed:', event.data.object);
            break;
    }

    res.json({ received: true });
});

console.log('??? Stripe payment endpoints added');
