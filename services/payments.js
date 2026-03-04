/**
 * DOZ UP - Payment Service
 * Checkout.com Integration for Subscription Payments
 *
 * CONFIGURATION: Edit config/checkout.json to set your API keys
 */

let Checkout;
try {
    Checkout = require('checkout-sdk-node').Checkout;
} catch (e) {
    // ESM-only version - will be loaded async below
    Checkout = null;
}
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load config from file (easy setup - just edit config/checkout.json)
const configPath = path.join(__dirname, '..', 'config', 'checkout.json');
let fileConfig = {};

try {
    if (fs.existsSync(configPath)) {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('[Payments] Loaded Checkout.com config from config/checkout.json');
    }
} catch (e) {
    console.warn('[Payments] Could not load config/checkout.json:', e.message);
}

// Configuration (file config takes priority, then env vars, then defaults)
const CONFIG = {
    publicKey: fileConfig.publicKey || process.env.CHECKOUT_PUBLIC_KEY || '',
    secretKey: fileConfig.secretKey || process.env.CHECKOUT_SECRET_KEY || '',
    webhookSecret: fileConfig.webhookSecret || process.env.CHECKOUT_WEBHOOK_SECRET || '',
    environment: fileConfig.environment || (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'),
    currency: fileConfig.currency || 'USD',
    merchantName: fileConfig.merchantName || 'DOZ UP',
    successUrl: fileConfig.successUrl || 'https://doz.com/up/v2/payment/success',
    cancelUrl: fileConfig.cancelUrl || 'https://doz.com/up/v2/payment/cancel',
    webhookUrl: fileConfig.webhookUrl || 'https://doz.com/up/api/webhooks/checkout'
};

// Check if keys are configured
const isConfigured = CONFIG.publicKey && CONFIG.secretKey &&
    !CONFIG.publicKey.includes('xxxx') && !CONFIG.secretKey.includes('xxxx');

// Initialize Checkout.com client
let cko = null;
async function initCheckout() {
    if (!isConfigured) {
        console.warn('[Payments] Checkout.com not configured. Edit config/checkout.json with your API keys.');
        return;
    }
    try {
        if (!Checkout) {
            const mod = await import('checkout-sdk-node');
            Checkout = mod.Checkout || mod.default?.Checkout || mod.default;
        }
        cko = new Checkout(CONFIG.secretKey, {
            pk: CONFIG.publicKey,
            environment: CONFIG.environment
        });
        console.log(`[Payments] Checkout.com initialized (${CONFIG.environment} mode)`);
    } catch (e) {
        console.warn('[Payments] Checkout.com initialization failed:', e.message);
    }
}
initCheckout();

// Pricing Plans
const PLANS = {
    starter_monthly: {
        id: 'starter_monthly',
        name: 'Starter',
        description: 'Perfect for individuals',
        price: 333, // cents
        interval: 'month',
        storage: 512, // MB
        features: ['500 MB Storage', '24-hour image retention', 'Basic support']
    },
    starter_yearly: {
        id: 'starter_yearly',
        name: 'Starter Yearly',
        description: 'Perfect for individuals - Save 17%',
        price: 3333, // cents
        interval: 'year',
        storage: 512,
        features: ['500 MB Storage', '24-hour image retention', 'Basic support', '2 months free']
    },
    pro_monthly: {
        id: 'pro_monthly',
        name: 'Pro',
        description: 'For power users',
        price: 9999, // cents
        interval: 'month',
        storage: 51200, // 50 GB
        features: ['50 GB Storage', 'Permanent image storage', 'Priority support', 'Custom domain']
    },
    pro_yearly: {
        id: 'pro_yearly',
        name: 'Pro Yearly',
        description: 'For power users - Save 17%',
        price: 99900, // cents
        interval: 'year',
        storage: 51200,
        features: ['50 GB Storage', 'Permanent image storage', 'Priority support', 'Custom domain', '2 months free']
    },
    business_monthly: {
        id: 'business_monthly',
        name: 'Business',
        description: 'For teams',
        price: 19900, // cents
        interval: 'month',
        storage: 153600, // 150 GB
        accounts: 3,
        features: ['150 GB Storage', '3 Team accounts', 'Permanent storage', 'API access', 'Dedicated support']
    },
    business_yearly: {
        id: 'business_yearly',
        name: 'Business Yearly',
        description: 'For teams - Save 17%',
        price: 199000, // cents
        interval: 'year',
        storage: 153600,
        accounts: 3,
        features: ['150 GB Storage', '3 Team accounts', 'Permanent storage', 'API access', 'Dedicated support', '2 months free']
    }
};

// Data paths
const dataDir = path.join(__dirname, '..', 'data');
const subscriptionsPath = path.join(dataDir, 'subscriptions.json');
const transactionsPath = path.join(dataDir, 'transactions.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Load/Save helpers
function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {
        console.error(`[Payments] Error loading ${filepath}:`, e.message);
    }
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

class PaymentService {
    constructor() {
        this.subscriptions = loadJSON(subscriptionsPath, []);
        this.transactions = loadJSON(transactionsPath, []);
    }

    // Get available plans
    getPlans() {
        return PLANS;
    }

    // Get plan by ID
    getPlan(planId) {
        return PLANS[planId] || null;
    }

    // Create a payment session (hosted checkout)
    async createPaymentSession(userId, userEmail, planId, metadata = {}) {
        const plan = this.getPlan(planId);
        if (!plan) {
            throw new Error('Invalid plan selected');
        }

        if (!cko) {
            throw new Error('Payment provider not configured');
        }

        try {
            const payment = await cko.payments.request({
                source: {
                    type: 'token',
                    token: metadata.token // Card token from frontend
                },
                amount: plan.price,
                currency: CONFIG.currency,
                reference: `DOZ-${userId}-${Date.now()}`,
                description: `DOZ UP ${plan.name} Subscription`,
                customer: {
                    email: userEmail,
                    name: metadata.customerName || userEmail
                },
                metadata: {
                    userId,
                    planId,
                    type: 'subscription',
                    ...metadata
                },
                success_url: `${CONFIG.successUrl}?session_id={cko-session-id}`,
                failure_url: CONFIG.cancelUrl
            });

            // Log transaction
            this.logTransaction({
                id: payment.id,
                userId,
                planId,
                amount: plan.price,
                currency: CONFIG.currency,
                status: payment.status,
                type: 'payment_initiated',
                createdAt: new Date().toISOString()
            });

            return payment;
        } catch (error) {
            console.error('[Payments] Error creating payment:', error);
            throw error;
        }
    }

    // Create hosted payment page (simpler integration)
    async createHostedPaymentPage(userId, userEmail, planId, customerName) {
        const plan = this.getPlan(planId);
        if (!plan) {
            throw new Error('Invalid plan selected');
        }

        if (!cko) {
            // Return mock for development
            return {
                id: `hpp_${Date.now()}`,
                _links: {
                    redirect: {
                        href: `/v2/checkout/mock?plan=${planId}&user=${userId}`
                    }
                }
            };
        }

        try {
            const session = await cko.hostedPayments.create({
                amount: plan.price,
                currency: CONFIG.currency,
                reference: `DOZ-SUB-${userId}-${Date.now()}`,
                description: `DOZ UP ${plan.name} Subscription`,
                customer: {
                    email: userEmail,
                    name: customerName
                },
                billing: {
                    address: {
                        country: 'US'
                    }
                },
                products: [{
                    name: `DOZ UP ${plan.name}`,
                    quantity: 1,
                    price: plan.price
                }],
                metadata: {
                    userId,
                    planId,
                    type: 'subscription'
                },
                success_url: `${CONFIG.successUrl}?cko-session-id={cko-session-id}`,
                cancel_url: CONFIG.cancelUrl,
                failure_url: CONFIG.cancelUrl
            });

            return session;
        } catch (error) {
            console.error('[Payments] Error creating hosted page:', error);
            throw error;
        }
    }

    // Process webhook event
    async processWebhook(event, signature) {
        // Verify webhook signature
        if (CONFIG.webhookSecret && signature) {
            const expectedSignature = crypto
                .createHmac('sha256', CONFIG.webhookSecret)
                .update(JSON.stringify(event))
                .digest('hex');

            if (signature !== expectedSignature) {
                throw new Error('Invalid webhook signature');
            }
        }

        const eventType = event.type;
        const data = event.data;

        console.log(`[Payments] Webhook received: ${eventType}`);

        switch (eventType) {
            case 'payment_approved':
            case 'payment_captured':
                await this.handlePaymentSuccess(data);
                break;
            case 'payment_declined':
            case 'payment_expired':
            case 'payment_canceled':
                await this.handlePaymentFailed(data);
                break;
            case 'payment_refunded':
                await this.handleRefund(data);
                break;
            default:
                console.log(`[Payments] Unhandled event type: ${eventType}`);
        }

        return { received: true };
    }

    // Handle successful payment
    async handlePaymentSuccess(paymentData) {
        const { metadata, id, amount, currency } = paymentData;
        const { userId, planId } = metadata || {};

        if (!userId || !planId) {
            console.error('[Payments] Missing metadata in payment:', id);
            return;
        }

        const plan = this.getPlan(planId);
        if (!plan) {
            console.error('[Payments] Invalid plan in payment:', planId);
            return;
        }

        // Calculate subscription period
        const now = new Date();
        const endDate = new Date(now);
        if (plan.interval === 'year') {
            endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
        }

        // Create/Update subscription
        const subscription = {
            id: `sub_${Date.now()}`,
            userId,
            planId,
            planName: plan.name,
            status: 'active',
            amount: amount,
            currency: currency,
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: endDate.toISOString(),
            paymentId: id,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        };

        // Save subscription
        const existingIndex = this.subscriptions.findIndex(s => s.userId === userId);
        if (existingIndex >= 0) {
            this.subscriptions[existingIndex] = { ...this.subscriptions[existingIndex], ...subscription };
        } else {
            this.subscriptions.push(subscription);
        }
        saveJSON(subscriptionsPath, this.subscriptions);

        // Broadcast new order to admin dashboards in real-time
        if (global.broadcastNewOrder) {
            global.broadcastNewOrder({
                id: subscription.id,
                customerName: paymentData.customer?.name || 'Customer',
                email: paymentData.customer?.email || userId,
                plan: plan.name,
                amount: amount / 100, // Convert from cents to dollars
                status: 'active',
                createdAt: subscription.createdAt
            });
        }

        // Log transaction
        this.logTransaction({
            id,
            userId,
            planId,
            amount,
            currency,
            status: 'completed',
            type: 'payment_success',
            subscriptionId: subscription.id,
            createdAt: now.toISOString()
        });

        console.log(`[Payments] Subscription activated for user ${userId}: ${plan.name}`);
        return subscription;
    }

    // Handle failed payment
    async handlePaymentFailed(paymentData) {
        const { metadata, id } = paymentData;
        const { userId, planId } = metadata || {};

        this.logTransaction({
            id,
            userId,
            planId,
            status: 'failed',
            type: 'payment_failed',
            createdAt: new Date().toISOString()
        });

        console.log(`[Payments] Payment failed for user ${userId}`);
    }

    // Handle refund
    async handleRefund(paymentData) {
        const { metadata, id, amount } = paymentData;
        const { userId } = metadata || {};

        // Cancel subscription
        const subscription = this.subscriptions.find(s => s.userId === userId);
        if (subscription) {
            subscription.status = 'cancelled';
            subscription.cancelledAt = new Date().toISOString();
            saveJSON(subscriptionsPath, this.subscriptions);
        }

        this.logTransaction({
            id,
            userId,
            amount,
            status: 'refunded',
            type: 'refund',
            createdAt: new Date().toISOString()
        });

        console.log(`[Payments] Refund processed for user ${userId}`);
    }

    // Get user subscription
    getSubscription(userId) {
        return this.subscriptions.find(s => s.userId === userId) || null;
    }

    // Get all subscriptions
    getAllSubscriptions() {
        if (!Array.isArray(this.subscriptions)) {
            console.warn('[Payments] subscriptions data corrupted, resetting to array');
            this.subscriptions = [];
        }
        return this.subscriptions;
    }

    // Cancel subscription
    async cancelSubscription(userId) {
        const subscription = this.subscriptions.find(s => s.userId === userId);
        if (!subscription) {
            throw new Error('Subscription not found');
        }

        subscription.status = 'cancelled';
        subscription.cancelledAt = new Date().toISOString();
        subscription.cancelAtPeriodEnd = true;
        saveJSON(subscriptionsPath, this.subscriptions);

        return subscription;
    }

    // Log transaction
    logTransaction(transaction) {
        this.transactions.push(transaction);
        // Keep last 10000 transactions
        if (this.transactions.length > 10000) {
            this.transactions = this.transactions.slice(-10000);
        }
        saveJSON(transactionsPath, this.transactions);
    }

    // Get transactions
    getTransactions(userId = null, limit = 100) {
        let txns = this.transactions;
        if (userId) {
            txns = txns.filter(t => t.userId === userId);
        }
        return txns.slice(-limit).reverse();
    }

    // Get revenue stats
    getRevenueStats() {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const thisMonth = today.substring(0, 7);

        const completed = this.transactions.filter(t => t.status === 'completed');

        const todayRevenue = completed
            .filter(t => t.createdAt?.startsWith(today))
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const monthRevenue = completed
            .filter(t => t.createdAt?.startsWith(thisMonth))
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const totalRevenue = completed.reduce((sum, t) => sum + (t.amount || 0), 0);

        const activeSubscriptions = this.subscriptions.filter(s => s.status === 'active').length;

        // MRR calculation
        const mrr = this.subscriptions
            .filter(s => s.status === 'active')
            .reduce((sum, s) => {
                const plan = this.getPlan(s.planId);
                if (!plan) return sum;
                if (plan.interval === 'year') {
                    return sum + (plan.price / 12);
                }
                return sum + plan.price;
            }, 0);

        return {
            todayRevenue: todayRevenue / 100, // Convert cents to dollars
            monthRevenue: monthRevenue / 100,
            totalRevenue: totalRevenue / 100,
            activeSubscriptions,
            mrr: mrr / 100,
            currency: CONFIG.currency
        };
    }

    // Check if subscription is active
    isSubscriptionActive(userId) {
        const sub = this.getSubscription(userId);
        if (!sub) return false;
        if (sub.status !== 'active') return false;

        const now = new Date();
        const endDate = new Date(sub.currentPeriodEnd);
        return now < endDate;
    }

    // Get public key for frontend
    getPublicKey() {
        return CONFIG.publicKey;
    }
}

// Export singleton
module.exports = new PaymentService();
module.exports.PLANS = PLANS;
module.exports.CONFIG = CONFIG;
