/**
 * DOZ UP - Payment Recovery Service
 * Syncs pending transactions with Stripe to recover missed webhook events
 */

const fs = require('fs');
const path = require('path');

// Paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const RECOVERY_LOG_FILE = path.join(DATA_DIR, 'recovery-log.json');

// Load Stripe (requires STRIPE_SECRET_KEY)
let stripe;
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    const Stripe = require('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
} catch (e) {
    console.error('[Recovery] Failed to initialize Stripe:', e.message);
}

class PaymentRecoveryService {
    constructor() {
        this.recoveryLog = [];
        this.stats = {
            totalPending: 0,
            recovered: 0,
            failed: 0,
            notPaid: 0,
            errors: 0
        };
    }

    // Load transactions
    loadTransactions() {
        try {
            if (fs.existsSync(TRANSACTIONS_FILE)) {
                return JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('[Recovery] Error loading transactions:', e.message);
        }
        return [];
    }

    // Save transactions
    saveTransactions(transactions) {
        try {
            fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
            return true;
        } catch (e) {
            console.error('[Recovery] Error saving transactions:', e.message);
            return false;
        }
    }

    // Load subscriptions
    loadSubscriptions() {
        try {
            if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
                return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('[Recovery] Error loading subscriptions:', e.message);
        }
        return [];
    }

    // Save subscriptions
    saveSubscriptions(subscriptions) {
        try {
            fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
            return true;
        } catch (e) {
            console.error('[Recovery] Error saving subscriptions:', e.message);
            return false;
        }
    }

    // Check if checkout session was completed
    async checkSessionStatus(sessionId) {
        if (!stripe) {
            throw new Error('Stripe not initialized');
        }

        try {
            const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['subscription', 'payment_intent', 'customer']
            });

            return {
                status: session.payment_status, // 'paid', 'unpaid', 'no_payment_required'
                completed: session.status === 'complete',
                session,
                customer: session.customer,
                subscription: session.subscription,
                paymentIntent: session.payment_intent,
                metadata: session.metadata,
                amountTotal: session.amount_total,
                currency: session.currency
            };
        } catch (e) {
            if (e.code === 'resource_missing') {
                return { status: 'not_found', completed: false };
            }
            throw e;
        }
    }

    // Activate subscription for user
    activateSubscription(userId, planId, stripeData) {
        const subscriptions = this.loadSubscriptions();

        // Check if already exists
        const existingIdx = subscriptions.findIndex(s => s.userId === userId);

        const subscription = {
            id: stripeData.subscriptionId || `sub_recovered_${Date.now()}`,
            userId,
            planId,
            planName: this.getPlanName(planId),
            status: 'active',
            amount: stripeData.amount || 0,
            currency: stripeData.currency || 'USD',
            currentPeriodStart: new Date().toISOString(),
            currentPeriodEnd: stripeData.periodEnd ? new Date(stripeData.periodEnd * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            stripeCustomerId: stripeData.customerId,
            stripeSubscriptionId: stripeData.subscriptionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            recoveredAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
            subscriptions[existingIdx] = subscription;
            console.log(`[Recovery] Updated subscription for user ${userId}`);
        } else {
            subscriptions.push(subscription);
            console.log(`[Recovery] Created subscription for user ${userId}`);
        }

        return this.saveSubscriptions(subscriptions);
    }

    getPlanName(planId) {
        const planNames = {
            'free': 'Free',
            'starter_monthly': 'Starter',
            'starter_yearly': 'Starter (Annual)',
            'pro_monthly': 'Pro',
            'pro_yearly': 'Pro (Annual)',
            'business_monthly': 'Business',
            'business_yearly': 'Business (Annual)',
            'enterprise_monthly': 'Enterprise',
            'enterprise_yearly': 'Enterprise (Annual)'
        };
        return planNames[planId] || planId;
    }

    // Recover a single transaction
    async recoverTransaction(transaction) {
        const { id: sessionId, userId, planId, amount } = transaction;

        console.log(`[Recovery] Checking session: ${sessionId}`);

        try {
            const result = await this.checkSessionStatus(sessionId);

            if (result.status === 'not_found') {
                this.recoveryLog.push({
                    sessionId,
                    userId,
                    status: 'not_found',
                    message: 'Session not found in Stripe',
                    timestamp: new Date().toISOString()
                });
                this.stats.failed++;
                return { recovered: false, reason: 'not_found' };
            }

            if (result.status === 'paid' || result.completed) {
                // Payment was successful - activate subscription
                const subData = result.subscription;
                const customer = result.customer;

                this.activateSubscription(userId, planId, {
                    subscriptionId: subData?.id,
                    customerId: typeof customer === 'string' ? customer : customer?.id,
                    amount: result.amountTotal,
                    currency: result.currency?.toUpperCase(),
                    periodEnd: subData?.current_period_end
                });

                this.recoveryLog.push({
                    sessionId,
                    userId,
                    planId,
                    status: 'recovered',
                    stripeStatus: result.status,
                    amount: result.amountTotal,
                    timestamp: new Date().toISOString()
                });

                this.stats.recovered++;
                return { recovered: true, status: 'completed' };
            } else {
                // Not paid
                this.recoveryLog.push({
                    sessionId,
                    userId,
                    status: 'not_paid',
                    stripeStatus: result.status,
                    timestamp: new Date().toISOString()
                });
                this.stats.notPaid++;
                return { recovered: false, reason: 'not_paid', status: result.status };
            }
        } catch (e) {
            console.error(`[Recovery] Error checking session ${sessionId}:`, e.message);
            this.recoveryLog.push({
                sessionId,
                userId,
                status: 'error',
                error: e.message,
                timestamp: new Date().toISOString()
            });
            this.stats.errors++;
            return { recovered: false, reason: 'error', error: e.message };
        }
    }

    // Recover all pending transactions
    async recoverAll() {
        console.log('\n='.repeat(60));
        console.log('  DOZ UP - Payment Recovery Service');
        console.log('='.repeat(60) + '\n');

        if (!stripe) {
            console.error('[Recovery] Cannot run without Stripe API key');
            return { success: false, error: 'Stripe not initialized' };
        }

        const transactions = this.loadTransactions();
        const pendingTransactions = transactions.filter(t =>
            t.status === 'pending' &&
            t.id &&
            t.id.startsWith('cs_')
        );

        this.stats.totalPending = pendingTransactions.length;
        console.log(`[Recovery] Found ${pendingTransactions.length} pending transactions to check\n`);

        if (pendingTransactions.length === 0) {
            console.log('[Recovery] No pending transactions to recover');
            return { success: true, stats: this.stats };
        }

        // Process in batches of 5 to avoid rate limits
        const batchSize = 5;
        for (let i = 0; i < pendingTransactions.length; i += batchSize) {
            const batch = pendingTransactions.slice(i, i + batchSize);

            console.log(`[Recovery] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pendingTransactions.length/batchSize)}`);

            await Promise.all(batch.map(async (transaction) => {
                const result = await this.recoverTransaction(transaction);

                // Update transaction status in memory
                const idx = transactions.findIndex(t => t.id === transaction.id);
                if (idx >= 0 && result.recovered) {
                    transactions[idx].status = 'completed';
                    transactions[idx].recoveredAt = new Date().toISOString();
                }
            }));

            // Small delay between batches
            if (i + batchSize < pendingTransactions.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Save updated transactions
        this.saveTransactions(transactions);

        // Save recovery log
        try {
            fs.writeFileSync(RECOVERY_LOG_FILE, JSON.stringify({
                runAt: new Date().toISOString(),
                stats: this.stats,
                log: this.recoveryLog
            }, null, 2));
        } catch (e) {
            console.error('[Recovery] Error saving recovery log:', e.message);
        }

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('  Recovery Summary');
        console.log('='.repeat(60));
        console.log(`  Total Pending:    ${this.stats.totalPending}`);
        console.log(`  Recovered:        ${this.stats.recovered} (subscriptions activated)`);
        console.log(`  Not Paid:         ${this.stats.notPaid} (checkout abandoned)`);
        console.log(`  Not Found:        ${this.stats.failed}`);
        console.log(`  Errors:           ${this.stats.errors}`);
        console.log('='.repeat(60) + '\n');

        return {
            success: true,
            stats: this.stats,
            log: this.recoveryLog
        };
    }

    // Fetch recent payments directly from Stripe (last 30 days)
    async syncFromStripe(days = 30) {
        console.log(`\n[Recovery] Syncing payments from Stripe (last ${days} days)...`);

        if (!stripe) {
            console.error('[Recovery] Cannot run without Stripe API key');
            return { success: false, error: 'Stripe not initialized' };
        }

        const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
        let synced = 0;

        try {
            // Fetch successful checkout sessions
            const sessions = await stripe.checkout.sessions.list({
                limit: 100,
                created: { gte: since },
                expand: ['data.subscription', 'data.customer']
            });

            console.log(`[Recovery] Found ${sessions.data.length} checkout sessions`);

            for (const session of sessions.data) {
                if (session.payment_status === 'paid' && session.metadata?.userId) {
                    const { userId, planId } = session.metadata;

                    // Check if subscription already exists
                    const subscriptions = this.loadSubscriptions();
                    const exists = subscriptions.some(s =>
                        s.userId === userId && s.stripeSubscriptionId === session.subscription?.id
                    );

                    if (!exists && planId) {
                        this.activateSubscription(userId, planId, {
                            subscriptionId: session.subscription?.id,
                            customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
                            amount: session.amount_total,
                            currency: session.currency?.toUpperCase(),
                            periodEnd: session.subscription?.current_period_end
                        });
                        synced++;
                        console.log(`[Recovery] Synced payment for user ${userId} - ${planId}`);
                    }
                }
            }

            console.log(`[Recovery] Synced ${synced} payments from Stripe`);
            return { success: true, synced };
        } catch (e) {
            console.error('[Recovery] Error syncing from Stripe:', e.message);
            return { success: false, error: e.message };
        }
    }
}

// Export service
const recoveryService = new PaymentRecoveryService();
module.exports = recoveryService;

// Run if called directly
if (require.main === module) {
    (async () => {
        try {
            // First, recover pending transactions
            await recoveryService.recoverAll();

            // Then, sync any missed payments from Stripe
            await recoveryService.syncFromStripe(30);

            console.log('\n[Recovery] Complete! Check data/recovery-log.json for details.\n');
        } catch (e) {
            console.error('[Recovery] Fatal error:', e);
            process.exit(1);
        }
    })();
}
