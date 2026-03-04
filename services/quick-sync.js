/**
 * Quick Sync - Import all Stripe charges to transactions
 */
const fs = require('fs');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

(async () => {
    console.log('Fetching all charges from Stripe...');
    const transactions = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'data', 'transactions.json')));
    const existingIds = new Set(transactions.map(t => t.stripeChargeId || t.id));

    let added = 0;
    let revenue = { USD: 0, GBP: 0, EGP: 0 };
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
        const params = { limit: 100 };
        if (startingAfter) params.starting_after = startingAfter;

        const charges = await Stripe.charges.list(params);

        for (const c of charges.data) {
            if (c.paid && c.status === 'succeeded') {
                const cur = c.currency.toUpperCase();
                revenue[cur] = (revenue[cur] || 0) + (c.amount / 100);

                if (!existingIds.has(c.id)) {
                    transactions.push({
                        id: 'txn_' + c.id,
                        stripeChargeId: c.id,
                        type: 'payment',
                        customerEmail: c.billing_details?.email || '',
                        customerName: c.billing_details?.name || '',
                        amount: c.amount / 100,
                        currency: cur,
                        status: 'completed',
                        createdAt: new Date(c.created * 1000).toISOString(),
                        syncedAt: new Date().toISOString()
                    });
                    existingIds.add(c.id);
                    added++;
                }
            }
        }

        hasMore = charges.has_more;
        if (charges.data.length > 0) {
            startingAfter = charges.data[charges.data.length - 1].id;
        }
        process.stdout.write('.');
    }

    fs.writeFileSync(require('path').join(__dirname, '..', 'data', 'transactions.json'), JSON.stringify(transactions, null, 2));

    console.log('');
    console.log('==================================================');
    console.log('  Sales Synced!');
    console.log('==================================================');
    console.log('  New transactions added:', added);
    console.log('  Total transactions:', transactions.length);
    console.log('');
    console.log('  Total Revenue (All Time):');
    Object.entries(revenue).forEach(([cur, amt]) => {
        if (amt > 0) {
            const sym = cur === 'USD' ? '$' : cur === 'GBP' ? '£' : cur === 'EGP' ? 'E£' : cur + ' ';
            console.log('    ' + cur + ':', sym + amt.toFixed(2));
        }
    });
    console.log('==================================================');
})();
