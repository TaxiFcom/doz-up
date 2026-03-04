/**
 * DOZ UP - Stripe Payment Service
 * Stripe Integration for Subscription Payments
 */

const Stripe = require('stripe');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Stripe API Keys - from environment variables (.env file)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Validate required environment variables
if (!STRIPE_SECRET_KEY) {
    console.error('CRITICAL: STRIPE_SECRET_KEY environment variable is not set!');
}
if (!STRIPE_PUBLISHABLE_KEY) {
    console.error('CRITICAL: STRIPE_PUBLISHABLE_KEY environment variable is not set!');
}

// Initialize Stripe
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16'
}) : null;

// Configuration
const CONFIG = {
    publicKey: STRIPE_PUBLISHABLE_KEY,
    secretKey: STRIPE_SECRET_KEY,
    currency: 'usd',
    merchantName: 'DOZ UP',
    successUrl: 'https://doz.com/up/payment/success',
    cancelUrl: 'https://doz.com/up/payment/cancel',
    webhookSecret: STRIPE_WEBHOOK_SECRET
};

// Pricing Plans with Stripe Price IDs
// Prices in USD cents, converted from EUR base prices (EUR × 1.087 = USD)
const PLANS = {
    free: {
        id: 'free',
        name: 'Free Membership',
        description: 'Free forever with limits',
        price: 0,
        interval: 'forever',
        storage: 1024, // 1 GB storage
        maxFileSize: 1024, // 1 GB max file size
        retention: '30 days', // 30 days expiration for temporal drives
        uploadsPerDay: 7, // 7 uploads per day, resets next day
        uploadSpeedLimit: 1024 * 1024 * 1024, // 1GB/sec upload speed limit
        crossDeviceUploads: true, // Cross-device uploads enabled
        features: ['1 GB Storage', '1 GB max file size', '30-day link expiry', '7 uploads/day (resets daily)', 'Cross-device uploads']
    },
    starter_monthly: {
        id: 'starter_monthly',
        name: 'Starter',
        description: 'For individuals',
        price: 499, // $4.99/month
        interval: 'month',
        storage: 5120, // 5 GB
        maxFileSize: 256,
        retention: 'forever',
        uploadsPerDay: -1, // unlimited
        features: ['5 GB Storage', 'Links never expire', 'Desktop app included', 'Email support']
    },
    starter_yearly: {
        id: 'starter_yearly',
        name: 'Starter (Annual)',
        description: 'Best Value - Save 33%',
        price: 3996, // $3.33/mo × 12 = $39.96/year
        interval: 'year',
        storage: 5120, // 5 GB
        maxFileSize: 256,
        retention: 'forever',
        uploadsPerDay: -1,
        monthlyEquiv: 333, // $3.33/month equivalent
        features: ['5 GB Storage', 'Links never expire', 'Desktop app included', 'Email support', 'Save 33%']
    },
    pro_monthly: {
        id: 'pro_monthly',
        name: 'Pro',
        description: 'For power users',
        price: 1499, // $14.99/month
        interval: 'month',
        storage: -1, // Unlimited
        maxFileSize: 512,
        retention: 'forever',
        uploadsPerDay: -1,
        features: ['Unlimited storage', 'All devices + Mobile app', 'Links never expire', 'Priority support 24/7']
    },
    pro_yearly: {
        id: 'pro_yearly',
        name: 'Pro (Annual)',
        description: 'Most Popular - Save 33%',
        price: 11988, // $9.99/mo × 12 = $119.88/year
        interval: 'year',
        storage: -1, // Unlimited
        maxFileSize: 512,
        retention: 'forever',
        uploadsPerDay: -1,
        monthlyEquiv: 999, // $9.99/month equivalent
        features: ['Unlimited storage', 'All devices + Mobile app', 'Links never expire', 'Priority support 24/7', 'Save 33%']
    },
    team_monthly: {
        id: 'team_monthly',
        name: 'Team',
        description: 'For small teams',
        price: 3999, // $39.99/user/month
        interval: 'month',
        storage: 7168, // 7 GB per user
        maxFileSize: 1024,
        retention: 'forever',
        uploadsPerDay: -1,
        minSeats: 1,
        features: ['Everything in Pro', 'Team workspace', 'Admin dashboard', 'API access']
    },
    team_yearly: {
        id: 'team_yearly',
        name: 'Team (Annual)',
        description: 'For Teams - Save 33%',
        price: 35988, // $29.99/mo × 12 = $359.88/year per user
        interval: 'year',
        storage: 7168,
        maxFileSize: 1024,
        retention: 'forever',
        uploadsPerDay: -1,
        minSeats: 1,
        monthlyEquiv: 2999, // $29.99/month equivalent
        features: ['Everything in Pro', 'Team workspace', 'Admin dashboard', 'API access', 'Save 33%']
    },
    enterprise_monthly: {
        id: 'enterprise_monthly',
        name: 'Enterprise',
        description: 'For organizations',
        price: 9999, // $99.99/user/month
        interval: 'month',
        storage: -1, // Unlimited
        maxFileSize: -1,
        retention: 'forever',
        uploadsPerDay: -1,
        minSeats: 1,
        features: ['Everything in Team', 'SSO & SAML', 'Dedicated support', 'Custom integrations']
    },
    enterprise_yearly: {
        id: 'enterprise_yearly',
        name: 'Enterprise (Annual)',
        description: 'Enterprise - Save 33%',
        price: 93240, // $77.70/mo × 12 = $932.40/year per user
        interval: 'year',
        storage: -1,
        maxFileSize: -1,
        retention: 'forever',
        uploadsPerDay: -1,
        minSeats: 1,
        monthlyEquiv: 7770, // $77.70/month equivalent
        features: ['Everything in Team', 'SSO & SAML', 'Dedicated support', 'Custom integrations', 'Save 33%']
    }
};

// Coupon/Promotion Codes
const COUPONS = {
    'DOZCOM': { type: 'fixed_price', amount: 100, currency: 'usd', description: 'DOZ.COM Special - $1 test', minPlan: null },
    'WELCOME50': { type: 'percent', percent: 50, description: '50% off first payment', minPlan: null },
    'ANNUAL20': { type: 'percent', percent: 20, description: '20% off annual plans', minPlan: null, annualOnly: true }
};

// Storage Add-on Products
const STORAGE_ADDONS = {
    storage_1gb: {
        id: 'storage_1gb',
        name: 'Extra 1 GB Storage',
        price: 99, // $0.99/month
        interval: 'month',
        storage: 1024 // 1 GB in MB
    },
    storage_5gb: {
        id: 'storage_5gb',
        name: 'Extra 5 GB Storage',
        price: 399, // $3.99/month
        interval: 'month',
        storage: 5120
    },
    storage_10gb: {
        id: 'storage_10gb',
        name: 'Extra 10 GB Storage',
        price: 699, // $6.99/month
        interval: 'month',
        storage: 10240
    },
    storage_50gb: {
        id: 'storage_50gb',
        name: 'Extra 50 GB Storage',
        price: 2499, // $24.99/month
        interval: 'month',
        storage: 51200
    }
};

// Data paths
const dataDir = path.join(__dirname, '..', 'data');
const subscriptionsPath = path.join(dataDir, 'subscriptions.json');
const transactionsPath = path.join(dataDir, 'transactions.json');
const customersPath = path.join(dataDir, 'stripe-customers.json');

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
        console.error(`[Stripe] Error loading ${filepath}:`, e.message);
    }
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

class StripePaymentService {
    constructor() {
        this.subscriptions = loadJSON(subscriptionsPath, []);
        this.transactions = loadJSON(transactionsPath, []);
        this.customers = loadJSON(customersPath, {});
        console.log('[Stripe] Payment service initialized');
    }

    // Get Stripe publishable key for frontend
    getPublicKey() {
        return CONFIG.publicKey;
    }

    // Get available plans
    getPlans() {
        return PLANS;
    }

    // Get plan by ID
    getPlan(planId) {
        return PLANS[planId] || null;
    }

    // Get or create Stripe customer
    async getOrCreateCustomer(userId, email, name = null) {
        // Check local cache first
        if (this.customers[userId]) {
            return this.customers[userId];
        }

        try {
            // Search for existing customer by email
            const existingCustomers = await stripe.customers.list({
                email: email,
                limit: 1
            });

            if (existingCustomers.data.length > 0) {
                const customer = existingCustomers.data[0];
                this.customers[userId] = customer.id;
                saveJSON(customersPath, this.customers);
                return customer.id;
            }

            // Create new customer
            const customer = await stripe.customers.create({
                email: email,
                name: name || email.split('@')[0],
                metadata: {
                    userId: userId,
                    platform: 'DOZ UP'
                }
            });

            this.customers[userId] = customer.id;
            saveJSON(customersPath, this.customers);
            return customer.id;
        } catch (error) {
            console.error('[Stripe] Error creating customer:', error);
            throw error;
        }
    }

    // Create Stripe Checkout Session
    async createCheckoutSession(userId, email, planId, customerName = null, isGuest = false) {
        const plan = this.getPlan(planId);
        if (!plan) {
            throw new Error('Invalid plan selected');
        }

        if (plan.price === 0) {
            throw new Error('Cannot create checkout for free plan');
        }

        try {
            let customerId = null;

            // Only create/get customer if email is provided (logged-in user)
            if (email) {
                customerId = await this.getOrCreateCustomer(userId, email, customerName);
            }

            const sessionConfig = {
                // Enable Stripe Link for one-click payments + card payments
                payment_method_types: ['card', 'link'],
                // Also enable automatic payment methods for best conversion
                payment_method_options: {
                    link: {
                        persistent_token: null // Let Stripe handle Link authentication
                    }
                },
                line_items: [{
                    price_data: {
                        currency: CONFIG.currency,
                        product_data: {
                            name: `DOZ UP ${plan.name}`,
                            description: plan.description,
                            images: ['https://doz.com/up/logo.png']
                        },
                        unit_amount: plan.price,
                        recurring: plan.interval !== 'forever' && plan.interval !== 'custom' ? {
                            interval: plan.interval === 'year' ? 'year' : 'month'
                        } : undefined
                    },
                    quantity: 1
                }],
                mode: plan.interval !== 'forever' && plan.interval !== 'custom' ? 'subscription' : 'payment',
                success_url: `${CONFIG.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: CONFIG.cancelUrl,
                metadata: {
                    userId: userId,
                    planId: planId,
                    isGuest: isGuest ? 'true' : 'false'
                },
                subscription_data: plan.interval !== 'forever' && plan.interval !== 'custom' ? {
                    metadata: {
                        userId: userId,
                        planId: planId,
                        isGuest: isGuest ? 'true' : 'false'
                    }
                } : undefined,
                allow_promotion_codes: true,
                billing_address_collection: 'auto'
            };

            // Add customer if exists (logged-in user), or let Stripe collect email (guest)
            if (customerId) {
                sessionConfig.customer = customerId;
                sessionConfig.customer_update = {
                    address: 'auto',
                    name: 'auto'
                };
            } else {
                // Guest checkout - Stripe will collect email and create customer
                sessionConfig.customer_creation = 'always';
            }

            // Remove undefined fields
            Object.keys(sessionConfig).forEach(key =>
                sessionConfig[key] === undefined && delete sessionConfig[key]
            );
            if (sessionConfig.line_items[0].price_data.recurring === undefined) {
                delete sessionConfig.line_items[0].price_data.recurring;
            }
            if (sessionConfig.subscription_data === undefined) {
                delete sessionConfig.subscription_data;
            }

            const session = await stripe.checkout.sessions.create(sessionConfig);

            // Log transaction
            this.logTransaction({
                id: session.id,
                type: 'checkout_created',
                userId,
                planId,
                amount: plan.price,
                currency: CONFIG.currency,
                status: 'pending',
                createdAt: new Date().toISOString()
            });

            return session;
        } catch (error) {
            console.error('[Stripe] Error creating checkout session:', error);
            throw error;
        }
    }

    // Create Payment Intent (for custom payment forms)
    async createPaymentIntent(userId, email, planId, customerName = null) {
        const plan = this.getPlan(planId);
        if (!plan) {
            throw new Error('Invalid plan selected');
        }

        try {
            const customerId = await this.getOrCreateCustomer(userId, email, customerName);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: plan.price,
                currency: CONFIG.currency,
                customer: customerId,
                metadata: {
                    userId: userId,
                    planId: planId
                },
                automatic_payment_methods: {
                    enabled: true
                },
                description: `DOZ UP ${plan.name} Subscription`
            });

            return {
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id
            };
        } catch (error) {
            console.error('[Stripe] Error creating payment intent:', error);
            throw error;
        }
    }

    // Create subscription directly (with existing payment method)
    async createSubscription(userId, email, planId, paymentMethodId) {
        const plan = this.getPlan(planId);
        if (!plan || plan.price === 0) {
            throw new Error('Invalid plan for subscription');
        }

        try {
            const customerId = await this.getOrCreateCustomer(userId, email);

            // Attach payment method to customer
            await stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId
            });

            // Set as default payment method
            await stripe.customers.update(customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId
                }
            });

            // Create the subscription
            const subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [{
                    price_data: {
                        currency: CONFIG.currency,
                        product_data: {
                            name: `DOZ UP ${plan.name}`
                        },
                        unit_amount: plan.price,
                        recurring: {
                            interval: plan.interval === 'year' ? 'year' : 'month'
                        }
                    }
                }],
                metadata: {
                    userId: userId,
                    planId: planId
                },
                payment_behavior: 'default_incomplete',
                expand: ['latest_invoice.payment_intent']
            });

            return subscription;
        } catch (error) {
            console.error('[Stripe] Error creating subscription:', error);
            throw error;
        }
    }

    // Validate a coupon code and return discount info
    validateCoupon(code, planId) {
        if (!code) return { valid: false, error: 'No coupon code provided' };

        const coupon = COUPONS[code.toUpperCase()];
        if (!coupon) return { valid: false, error: 'Invalid coupon code' };

        const plan = this.getPlan(planId);
        if (!plan) return { valid: false, error: 'Invalid plan' };

        // Check annual-only restriction
        if (coupon.annualOnly && !planId.includes('yearly')) {
            return { valid: false, error: 'This coupon is only valid for annual plans' };
        }

        // Calculate discounted price
        let discountedAmount;
        let discountDescription;

        if (coupon.type === 'fixed_price') {
            discountedAmount = coupon.amount;
            discountDescription = coupon.description;
        } else if (coupon.type === 'percent') {
            discountedAmount = Math.round(plan.price * (1 - coupon.percent / 100));
            discountDescription = `${coupon.percent}% off - ${coupon.description}`;
        } else {
            return { valid: false, error: 'Invalid coupon type' };
        }

        // Ensure minimum $0.50 (Stripe minimum)
        if (discountedAmount < 50) discountedAmount = 50;

        return {
            valid: true,
            code: code.toUpperCase(),
            originalAmount: plan.price,
            discountedAmount: discountedAmount,
            savings: plan.price - discountedAmount,
            description: discountDescription,
            currency: CONFIG.currency
        };
    }

    // Create inline checkout for embedded Payment Element
    // This creates a subscription with incomplete status and returns client_secret
    async createInlineCheckout(userId, email, planId, customerName = null, couponCode = null) {
        const plan = this.getPlan(planId);
        if (!plan) {
            throw new Error('Invalid plan selected');
        }

        if (plan.price === 0) {
            throw new Error('Cannot create checkout for free plan');
        }

        // Calculate amount (with coupon if provided)
        let chargeAmount = plan.price;
        let appliedCoupon = null;

        if (couponCode) {
            const couponResult = this.validateCoupon(couponCode, planId);
            if (couponResult.valid) {
                chargeAmount = couponResult.discountedAmount;
                appliedCoupon = couponResult;
            }
        }

        try {
            // Create or get customer
            const customerId = await this.getOrCreateCustomer(userId, email, customerName);

            // Use Payment Intent for all plans (simpler, more flexible)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: chargeAmount,
                currency: CONFIG.currency,
                customer: customerId,
                receipt_email: email && email !== 'checkout@temp.com' ? email : undefined,
                metadata: {
                    userId: userId,
                    planId: planId,
                    planName: plan.name,
                    interval: plan.interval,
                    couponCode: couponCode || '',
                    originalAmount: String(plan.price),
                    discountedAmount: String(chargeAmount)
                },
                automatic_payment_methods: {
                    enabled: true
                },
                description: `DOZ UP ${plan.name} - ${plan.interval === 'year' ? 'Annual' : 'Monthly'} subscription${appliedCoupon ? ' (Coupon: ' + couponCode + ')' : ''}`
            });

            // Log pending transaction
            this.logTransaction({
                id: paymentIntent.id,
                type: 'inline_checkout_created',
                userId,
                planId,
                amount: chargeAmount,
                originalAmount: plan.price,
                couponCode: couponCode || null,
                currency: CONFIG.currency,
                status: 'pending',
                createdAt: new Date().toISOString()
            });

            return {
                type: 'payment_intent',
                paymentIntentId: paymentIntent.id,
                clientSecret: paymentIntent.client_secret,
                customerId: customerId,
                amount: chargeAmount,
                appliedCoupon: appliedCoupon
            };

        } catch (error) {
            console.error('[Stripe] Error creating inline checkout:', error);
            throw error;
        }
    }

    // Handle Stripe webhook events
    async handleWebhook(payload, signature) {
        let event;

        try {
            if (!CONFIG.webhookSecret) {
                console.error('[Stripe] Webhook secret not configured - rejecting unsigned webhook');
                throw new Error('Webhook secret not configured');
            }
            event = stripe.webhooks.constructEvent(payload, signature, CONFIG.webhookSecret);
        } catch (err) {
            console.error('[Stripe] Webhook signature verification failed:', err.message);
            throw new Error('Webhook signature verification failed');
        }

        console.log(`[Stripe] Webhook received: ${event.type}`);

        switch (event.type) {
            case 'checkout.session.completed':
                await this.handleCheckoutComplete(event.data.object);
                break;

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await this.handleSubscriptionUpdate(event.data.object);
                break;

            case 'customer.subscription.deleted':
                await this.handleSubscriptionCancelled(event.data.object);
                break;

            case 'invoice.paid':
                await this.handleInvoicePaid(event.data.object);
                break;

            case 'invoice.payment_failed':
                await this.handlePaymentFailed(event.data.object);
                break;

            case 'payment_intent.succeeded':
                await this.handlePaymentSuccess(event.data.object);
                break;

            default:
                console.log(`[Stripe] Unhandled event type: ${event.type}`);
        }

        return { received: true };
    }

    // Handle successful checkout
    async handleCheckoutComplete(session) {
        const { customer, metadata, subscription, payment_intent, amount_total } = session;
        const { userId, planId } = metadata || {};

        if (!userId || !planId) {
            console.error('[Stripe] Missing metadata in checkout session');
            return;
        }

        const plan = this.getPlan(planId);
        if (!plan) return;

        // For subscription mode
        if (subscription) {
            const stripeSubscription = await stripe.subscriptions.retrieve(subscription);
            await this.activateSubscription(userId, planId, stripeSubscription);
        } else {
            // One-time payment
            await this.activateSubscription(userId, planId, {
                id: payment_intent,
                current_period_end: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
            });
        }

        this.logTransaction({
            id: session.id,
            type: 'checkout_completed',
            userId,
            planId,
            amount: amount_total,
            currency: session.currency,
            status: 'completed',
            stripeCustomer: customer,
            stripeSubscription: subscription,
            createdAt: new Date().toISOString()
        });
    }

    // Handle subscription updates
    async handleSubscriptionUpdate(stripeSubscription) {
        const { metadata, status } = stripeSubscription;
        const { userId, planId } = metadata || {};

        if (!userId) return;

        const existingSub = this.subscriptions.find(s => s.userId === userId);
        if (existingSub) {
            existingSub.status = status === 'active' ? 'active' : status;
            existingSub.stripeSubscriptionId = stripeSubscription.id;
            existingSub.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000).toISOString();
            existingSub.updatedAt = new Date().toISOString();
            saveJSON(subscriptionsPath, this.subscriptions);
        }
    }

    // Handle subscription cancellation
    async handleSubscriptionCancelled(stripeSubscription) {
        const { metadata } = stripeSubscription;
        const { userId } = metadata || {};

        if (!userId) return;

        const existingSub = this.subscriptions.find(s => s.userId === userId);
        if (existingSub) {
            existingSub.status = 'cancelled';
            existingSub.cancelledAt = new Date().toISOString();
            saveJSON(subscriptionsPath, this.subscriptions);
        }

        console.log(`[Stripe] Subscription cancelled for user ${userId}`);
    }

    // Handle invoice paid
    async handleInvoicePaid(invoice) {
        const { customer, subscription, amount_paid, currency } = invoice;

        // Find user by customer ID
        const userId = Object.keys(this.customers).find(
            uid => this.customers[uid] === customer
        );

        if (userId) {
            this.logTransaction({
                id: invoice.id,
                type: 'invoice_paid',
                userId,
                amount: amount_paid,
                currency,
                stripeSubscription: subscription,
                status: 'completed',
                createdAt: new Date().toISOString()
            });
        }
    }

    // Handle payment failure
    async handlePaymentFailed(invoice) {
        const { customer, subscription } = invoice;

        const userId = Object.keys(this.customers).find(
            uid => this.customers[uid] === customer
        );

        if (userId) {
            const existingSub = this.subscriptions.find(s => s.userId === userId);
            if (existingSub) {
                existingSub.status = 'past_due';
                existingSub.updatedAt = new Date().toISOString();
                saveJSON(subscriptionsPath, this.subscriptions);
            }

            this.logTransaction({
                id: invoice.id,
                type: 'payment_failed',
                userId,
                stripeSubscription: subscription,
                status: 'failed',
                createdAt: new Date().toISOString()
            });

            console.log(`[Stripe] Payment failed for user ${userId}`);
        }
    }

    // Handle successful payment intent
    async handlePaymentSuccess(paymentIntent) {
        const { metadata, amount, currency, customer } = paymentIntent;
        const { userId, planId } = metadata || {};

        if (userId && planId) {
            await this.activateSubscription(userId, planId, {
                id: paymentIntent.id,
                current_period_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
            });
        }
    }

    // Activate subscription for user
    async activateSubscription(userId, planId, stripeData) {
        const plan = this.getPlan(planId);
        if (!plan) return;

        const now = new Date();
        let endDate;

        if (stripeData.current_period_end) {
            endDate = new Date(stripeData.current_period_end * 1000);
        } else {
            endDate = new Date(now);
            if (plan.interval === 'year') {
                endDate.setFullYear(endDate.getFullYear() + 1);
            } else {
                endDate.setMonth(endDate.getMonth() + 1);
            }
        }

        const subscription = {
            id: `sub_${Date.now()}`,
            userId,
            planId,
            planName: plan.name,
            status: 'active',
            stripeSubscriptionId: stripeData.id,
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: endDate.toISOString(),
            storage: plan.storage,
            features: plan.features,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        };

        // Update or create subscription
        const existingIndex = this.subscriptions.findIndex(s => s.userId === userId);
        if (existingIndex >= 0) {
            this.subscriptions[existingIndex] = { ...this.subscriptions[existingIndex], ...subscription };
        } else {
            this.subscriptions.push(subscription);
        }
        saveJSON(subscriptionsPath, this.subscriptions);

        // Broadcast new order
        if (global.broadcastNewOrder) {
            global.broadcastNewOrder({
                id: subscription.id,
                customerName: userId,
                plan: plan.name,
                amount: plan.price / 100,
                status: 'active',
                createdAt: subscription.createdAt
            });
        }

        console.log(`[Stripe] Subscription activated for user ${userId}: ${plan.name}`);
        return subscription;
    }

    // Get user subscription
    getSubscription(userId) {
        return this.subscriptions.find(s => s.userId === userId) || null;
    }

    // Get all subscriptions
    getAllSubscriptions() {
        return this.subscriptions;
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

    // Cancel subscription
    async cancelSubscription(userId) {
        const subscription = this.subscriptions.find(s => s.userId === userId);
        if (!subscription) {
            throw new Error('Subscription not found');
        }

        // Cancel in Stripe
        if (subscription.stripeSubscriptionId) {
            try {
                await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
            } catch (e) {
                console.error('[Stripe] Error cancelling subscription:', e);
            }
        }

        subscription.status = 'cancelled';
        subscription.cancelledAt = new Date().toISOString();
        saveJSON(subscriptionsPath, this.subscriptions);

        return subscription;
    }

    // Create customer portal session
    async createPortalSession(userId, returnUrl) {
        const customerId = this.customers[userId];
        if (!customerId) {
            throw new Error('Customer not found');
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || 'https://doz.com/up/my-account.html'
        });

        return session;
    }

    // Log transaction
    logTransaction(transaction) {
        this.transactions.push(transaction);
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

        const completed = this.transactions.filter(t =>
            t.status === 'completed' && (t.type === 'checkout_completed' || t.type === 'invoice_paid')
        );

        const todayRevenue = completed
            .filter(t => t.createdAt?.startsWith(today))
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const monthRevenue = completed
            .filter(t => t.createdAt?.startsWith(thisMonth))
            .reduce((sum, t) => sum + (t.amount || 0), 0);

        const totalRevenue = completed.reduce((sum, t) => sum + (t.amount || 0), 0);

        const activeSubscriptions = this.subscriptions.filter(s => s.status === 'active').length;

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
            todayRevenue: todayRevenue / 100,
            monthRevenue: monthRevenue / 100,
            totalRevenue: totalRevenue / 100,
            activeSubscriptions,
            mrr: mrr / 100,
            currency: CONFIG.currency.toUpperCase()
        };
    }

    // Get storage add-ons
    getStorageAddons() {
        return STORAGE_ADDONS;
    }

    // Get storage add-on by ID
    getStorageAddon(addonId) {
        return STORAGE_ADDONS[addonId] || null;
    }

    // Create checkout session for storage add-on
    async createStorageAddonCheckout(userId, email, addonId, customerName = null) {
        const addon = this.getStorageAddon(addonId);
        if (!addon) {
            throw new Error('Invalid storage add-on selected');
        }

        try {
            const customerId = await this.getOrCreateCustomer(userId, email, customerName);

            const session = await stripe.checkout.sessions.create({
                // Enable Stripe Link for one-click payments
                payment_method_types: ['card', 'link'],
                customer: customerId,
                line_items: [{
                    price_data: {
                        currency: CONFIG.currency,
                        product_data: {
                            name: addon.name,
                            description: `Add ${addon.storage / 1024} GB to your storage`,
                            images: ['https://doz.com/up/logo.png']
                        },
                        unit_amount: addon.price,
                        recurring: {
                            interval: addon.interval
                        }
                    },
                    quantity: 1
                }],
                mode: 'subscription',
                success_url: `${CONFIG.successUrl}?session_id={CHECKOUT_SESSION_ID}&addon=true`,
                cancel_url: CONFIG.cancelUrl,
                metadata: {
                    userId: userId,
                    addonId: addonId,
                    type: 'storage_addon'
                },
                subscription_data: {
                    metadata: {
                        userId: userId,
                        addonId: addonId,
                        type: 'storage_addon',
                        extraStorage: addon.storage
                    }
                },
                allow_promotion_codes: true
            });

            this.logTransaction({
                id: session.id,
                type: 'storage_addon_checkout',
                userId: userId,
                addonId: addonId,
                amount: addon.price,
                status: 'pending',
                createdAt: new Date().toISOString()
            });

            return session;
        } catch (error) {
            console.error('[Stripe] Storage addon checkout error:', error);
            throw error;
        }
    }

    // ============================================
    // PAYMENT LINKS & SHARE CONTEXT METHODS
    // ============================================

    // Get upload owner from filename UUID (for /i/ links)
    getUploadOwner(filename) {
        const uploadsPath = path.join(dataDir, 'uploads.json');
        try {
            if (!fs.existsSync(uploadsPath)) return null;
            const uploadsDb = JSON.parse(fs.readFileSync(uploadsPath, 'utf8'));

            // Strip extension if present
            const baseName = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');

            // Find upload by filename or id
            const upload = (uploadsDb.uploads || []).find(u =>
                u.filename === filename ||
                u.filename?.startsWith(baseName) ||
                u.filename?.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '') === baseName ||
                u.id === baseName
            );

            if (!upload) return null;

            return {
                deviceId: upload.deviceId,
                userId: upload.userId,
                timestamp: upload.timestamp,
                filename: upload.filename
            };
        } catch (e) {
            console.error('[Stripe] Error loading uploads:', e.message);
            return null;
        }
    }

    // Get Stripe customer ID from owner (deviceId or userId)
    getCustomerFromOwner(owner) {
        if (!owner) return null;

        // First try userId
        if (owner.userId && this.customers[owner.userId]) {
            return {
                customerId: this.customers[owner.userId],
                identifier: owner.userId,
                type: 'userId'
            };
        }

        // Then try deviceId
        if (owner.deviceId && this.customers[owner.deviceId]) {
            return {
                customerId: this.customers[owner.deviceId],
                identifier: owner.deviceId,
                type: 'deviceId'
            };
        }

        return null;
    }

    // Get customer's preferred payment method from Stripe
    async getCustomerPaymentPreferences(customerId) {
        if (!customerId || !stripe) return { hasPreferred: false };

        try {
            // Retrieve customer with expanded default payment method
            const customer = await stripe.customers.retrieve(customerId, {
                expand: ['invoice_settings.default_payment_method']
            });

            const defaultPM = customer.invoice_settings?.default_payment_method;

            if (defaultPM) {
                const pmData = typeof defaultPM === 'object' ? defaultPM : null;
                return {
                    hasPreferred: true,
                    paymentMethodId: typeof defaultPM === 'string' ? defaultPM : defaultPM.id,
                    type: pmData?.type || 'card',
                    brand: pmData?.card?.brand || null,
                    last4: pmData?.card?.last4 || null,
                    email: customer.email
                };
            }

            // Fall back to listing payment methods
            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
                limit: 1
            });

            if (paymentMethods.data.length > 0) {
                const pm = paymentMethods.data[0];
                return {
                    hasPreferred: true,
                    paymentMethodId: pm.id,
                    type: pm.type,
                    brand: pm.card?.brand || null,
                    last4: pm.card?.last4 || null,
                    email: customer.email
                };
            }

            return { hasPreferred: false, email: customer.email };
        } catch (error) {
            console.error('[Stripe] Error fetching payment preferences:', error.message);
            return { hasPreferred: false, error: error.message };
        }
    }

    // Create Payment Links for all paid plans (one-time setup)
    async createPaymentLinks() {
        if (!stripe) throw new Error('Stripe not initialized');

        const paymentLinksPath = path.join(dataDir, 'payment-links.json');
        let existingLinks = loadJSON(paymentLinksPath, { links: {}, priceIds: {} });

        console.log('[Stripe] Creating Payment Links for all plans...');

        for (const [planId, plan] of Object.entries(PLANS)) {
            // Skip free plan
            if (plan.price === 0) continue;

            // Skip if link already exists
            if (existingLinks.links[planId]) {
                console.log(`[Stripe] Payment Link already exists for ${planId}`);
                continue;
            }

            try {
                // First create a Price in Stripe
                const priceParams = {
                    currency: CONFIG.currency,
                    unit_amount: plan.price,
                    product_data: {
                        name: `DOZ UP ${plan.name}`,
                        metadata: { planId }
                    }
                };

                // Add recurring if not one-time
                if (plan.interval !== 'forever' && plan.interval !== 'custom') {
                    priceParams.recurring = {
                        interval: plan.interval === 'year' ? 'year' : 'month'
                    };
                }

                const price = await stripe.prices.create(priceParams);

                // Create Payment Link
                const paymentLink = await stripe.paymentLinks.create({
                    line_items: [{
                        price: price.id,
                        quantity: 1
                    }],
                    allow_promotion_codes: true,
                    metadata: { planId },
                    after_completion: {
                        type: 'redirect',
                        redirect: {
                            url: `${CONFIG.successUrl}?plan=${planId}&source=payment_link`
                        }
                    }
                });

                existingLinks.links[planId] = paymentLink.url;
                existingLinks.priceIds[planId] = price.id;

                console.log(`[Stripe] Created Payment Link for ${planId}: ${paymentLink.url}`);
            } catch (error) {
                console.error(`[Stripe] Error creating Payment Link for ${planId}:`, error.message);
            }
        }

        existingLinks.createdAt = existingLinks.createdAt || new Date().toISOString();
        existingLinks.lastSync = new Date().toISOString();
        saveJSON(paymentLinksPath, existingLinks);

        return existingLinks.links;
    }

    // Get Payment Link URL with customer prefill parameters
    getPaymentLinkUrl(planId, customerEmail = null, clientReferenceId = null) {
        const paymentLinksPath = path.join(dataDir, 'payment-links.json');
        const data = loadJSON(paymentLinksPath, { links: {} });
        const baseUrl = data.links[planId];

        if (!baseUrl) return null;

        // Build URL with prefill parameters
        const url = new URL(baseUrl);

        if (customerEmail) {
            url.searchParams.set('prefilled_email', customerEmail);
        }
        if (clientReferenceId) {
            url.searchParams.set('client_reference_id', clientReferenceId);
        }

        return url.toString();
    }

    // Get all Payment Links
    getPaymentLinks() {
        const paymentLinksPath = path.join(dataDir, 'payment-links.json');
        return loadJSON(paymentLinksPath, { links: {} });
    }

    // Create prefilled checkout session from share context
    async createCheckoutFromShare(filename, planId) {
        const plan = this.getPlan(planId);
        if (!plan || plan.price === 0) {
            throw new Error('Invalid plan for checkout');
        }

        let customerId = null;
        let customerEmail = null;
        let prefilled = false;

        // Try to get owner info from filename
        if (filename) {
            const owner = this.getUploadOwner(filename);
            if (owner) {
                const customerInfo = this.getCustomerFromOwner(owner);
                if (customerInfo) {
                    customerId = customerInfo.customerId;
                    prefilled = true;

                    // Get email from Stripe customer
                    try {
                        const customer = await stripe.customers.retrieve(customerId);
                        customerEmail = customer.email;
                    } catch (e) {
                        console.error('[Stripe] Error fetching customer:', e.message);
                    }
                }
            }
        }

        // Create checkout session
        const sessionConfig = {
            // Enable Stripe Link for one-click payments
            payment_method_types: ['card', 'link'],
            line_items: [{
                price_data: {
                    currency: CONFIG.currency,
                    product_data: {
                        name: `DOZ UP ${plan.name}`,
                        description: plan.description
                    },
                    unit_amount: plan.price,
                    recurring: plan.interval !== 'forever' && plan.interval !== 'custom' ? {
                        interval: plan.interval === 'year' ? 'year' : 'month'
                    } : undefined
                },
                quantity: 1
            }],
            mode: plan.interval !== 'forever' && plan.interval !== 'custom' ? 'subscription' : 'payment',
            success_url: `${CONFIG.successUrl}?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
            cancel_url: CONFIG.cancelUrl,
            allow_promotion_codes: true,
            metadata: {
                planId,
                shareFilename: filename || ''
            }
        };

        // Prefill customer if found
        if (customerId) {
            sessionConfig.customer = customerId;
            sessionConfig.customer_update = { address: 'auto', name: 'auto' };
        } else if (customerEmail) {
            sessionConfig.customer_email = customerEmail;
        }

        // Clean undefined fields
        if (!sessionConfig.line_items[0].price_data.recurring) {
            delete sessionConfig.line_items[0].price_data.recurring;
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        return {
            sessionId: session.id,
            url: session.url,
            prefilled,
            customerEmail
        };
    }
}

// Export singleton
const stripePayments = new StripePaymentService();
module.exports = stripePayments;
module.exports.stripe = stripe;
module.exports.PLANS = PLANS;
module.exports.COUPONS = COUPONS;
module.exports.STORAGE_ADDONS = STORAGE_ADDONS;
module.exports.CONFIG = CONFIG;
