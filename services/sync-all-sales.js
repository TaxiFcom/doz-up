/**
 * DOZ UP - Sync All Sales from Stripe
 * Imports all successful charges as orders for the dashboard
 */

const fs = require('fs');
const path = require('path');

// Paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// Load Stripe
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// Load existing data
function loadJSON(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading', file, e.message);
    }
    return [];
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function syncAllSales() {
    console.log('\n============================================================');
    console.log('  DOZ UP - Syncing All Sales from Stripe');
    console.log('============================================================\n');

    const transactions = loadJSON(TRANSACTIONS_FILE);
    const subscriptions = loadJSON(SUBSCRIPTIONS_FILE);
    const existingIds = new Set(transactions.map(t => t.stripeChargeId || t.id));

    let synced = 0;
    let total = 0;
    let revenue = { usd: 0, gbp: 0 };

    // Get ALL successful charges (last 90 days)
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
        const params = { limit: 100 };
        if (startingAfter) params.starting_after = startingAfter;

        const charges = await stripe.charges.list(params);

        for (const charge of charges.data) {
            if (charge.paid && charge.status === 'succeeded') {
                total++;

                // Track revenue
                const amount = charge.amount / 100;
                if (charge.currency === 'usd') revenue.usd += amount;
                else if (charge.currency === 'gbp') revenue.gbp += amount;

                // Skip if already synced
                if (existingIds.has(charge.id)) continue;

                // Create transaction record
                const transaction = {
                    id: `txn_${charge.id}`,
                    stripeChargeId: charge.id,
                    type: 'payment',
                    userId: charge.customer || charge.billing_details?.email || 'unknown',
                    customerEmail: charge.billing_details?.email || '',
                    customerName: charge.billing_details?.name || '',
                    planId: 'payment',
                    planName: charge.description || 'Payment',
                    amount: amount,
                    currency: charge.currency.toUpperCase(),
                    status: 'completed',
                    stripeCustomer: charge.customer,
                    createdAt: new Date(charge.created * 1000).toISOString(),
                    syncedAt: new Date().toISOString()
                };

                transactions.push(transaction);
                existingIds.add(charge.id);
                synced++;

                console.log(`[Sync] Added: ${amount} ${charge.currency.toUpperCase()} from ${charge.billing_details?.email || charge.customer || 'unknown'}`);
            }
        }

        hasMore = charges.has_more;
        if (charges.data.length > 0) {
            startingAfter = charges.data[charges.data.length - 1].id;
        }
    }

    // Save updated transactions
    saveJSON(TRANSACTIONS_FILE, transactions);

    console.log('\n============================================================');
    console.log('  Sync Complete!');
    console.log('============================================================');
    console.log(`  Total Successful Charges: ${total}`);
    console.log(`  Newly Synced: ${synced}`);
    console.log(`  Revenue: $${revenue.usd.toFixed(2)} USD + £${revenue.gbp.toFixed(2)} GBP`);
    console.log('============================================================\n');

    return { synced, total, revenue };
}

// Run
syncAllSales().catch(console.error);
