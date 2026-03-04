/**
 * A/B Test Tracker Service
 * Tracks visitor assignments, checkout starts, and conversions by variant
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'ab-test-stats.json');
const TEST_START_DATE = new Date().toISOString();

// A/B Test Configuration
const AB_CONFIG = {
    testName: 'checkout_pricing_feb2026',
    variants: {
        A: { name: 'Forced Discount', traffic: 50, description: '0.99/mo, 13.33/yr all currencies' },
        B: { name: 'Current Flow', traffic: 25, description: 'Baseline - no changes' },
        C: { name: '3-Day Trial', traffic: 25, description: 'Free trial before charge' }
    }
};

// In-memory stats (persisted to disk)
let AB_STATS = {
    A: { visitors: 0, checkoutStarts: 0, conversions: 0, revenue: 0, trials: 0, trialConversions: 0 },
    B: { visitors: 0, checkoutStarts: 0, conversions: 0, revenue: 0, trials: 0, trialConversions: 0 },
    C: { visitors: 0, checkoutStarts: 0, conversions: 0, revenue: 0, trials: 0, trialConversions: 0 }
};

// Load existing stats
function loadStats() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            AB_STATS = data.stats || AB_STATS;
            console.log('[A/B Test] Loaded stats:', JSON.stringify(AB_STATS));
        }
    } catch (e) {
        console.error('[A/B Test] Failed to load stats:', e.message);
    }
}

// Save stats to disk
function saveStats() {
    try {
        const data = {
            config: AB_CONFIG,
            startDate: TEST_START_DATE,
            lastUpdated: new Date().toISOString(),
            stats: AB_STATS
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[A/B Test] Failed to save stats:', e.message);
    }
}

// Assign variant based on fingerprint hash (consistent assignment)
function assignVariant(fingerprintId) {
    if (!fingerprintId) return 'B'; // Default to baseline

    // Use first 8 hex chars of fingerprint for hash
    const hashPart = fingerprintId.replace(/^fp_/, '').slice(0, 8);
    const hash = parseInt(hashPart, 16);
    const bucket = hash % 100;

    if (bucket < 50) return 'A';      // 0-49: Forced discount (50%)
    if (bucket < 75) return 'B';      // 50-74: Current flow (25%)
    return 'C';                        // 75-99: 3-day trial (25%)
}

// Track visitor assignment
function trackVisitor(variant) {
    if (!AB_STATS[variant]) return;
    AB_STATS[variant].visitors++;
    saveStats();
    console.log(`[A/B Test] Visitor assigned to variant ${variant}. Total: ${AB_STATS[variant].visitors}`);
}

// Track checkout start
function trackCheckoutStart(variant) {
    if (!AB_STATS[variant]) return;
    AB_STATS[variant].checkoutStarts++;
    saveStats();
    console.log(`[A/B Test] Checkout started for variant ${variant}. Total: ${AB_STATS[variant].checkoutStarts}`);
}

// Track conversion (payment success)
function trackConversion(variant, amountCents, currency = 'USD') {
    if (!AB_STATS[variant]) return;
    AB_STATS[variant].conversions++;
    AB_STATS[variant].revenue += amountCents;
    saveStats();
    console.log(`[A/B Test] Conversion for variant ${variant}! Amount: ${amountCents} ${currency}. Total conversions: ${AB_STATS[variant].conversions}`);
}

// Track trial start (Variant C)
function trackTrialStart(variant) {
    if (!AB_STATS[variant]) return;
    AB_STATS[variant].trials++;
    saveStats();
    console.log(`[A/B Test] Trial started for variant ${variant}. Total trials: ${AB_STATS[variant].trials}`);
}

// Track trial conversion (trial -> paid)
function trackTrialConversion(variant, amountCents) {
    if (!AB_STATS[variant]) return;
    AB_STATS[variant].trialConversions++;
    AB_STATS[variant].revenue += amountCents;
    saveStats();
    console.log(`[A/B Test] Trial converted for variant ${variant}!`);
}

// Get stats with calculated rates
function getStats() {
    const variants = Object.entries(AB_STATS).map(([variant, stats]) => {
        const checkoutRate = stats.visitors > 0
            ? ((stats.checkoutStarts / stats.visitors) * 100).toFixed(1) + '%'
            : '0%';
        const conversionRate = stats.checkoutStarts > 0
            ? ((stats.conversions / stats.checkoutStarts) * 100).toFixed(1) + '%'
            : '0%';
        const trialConversionRate = stats.trials > 0
            ? ((stats.trialConversions / stats.trials) * 100).toFixed(1) + '%'
            : '0%';
        const avgOrderValue = stats.conversions > 0
            ? (stats.revenue / stats.conversions / 100).toFixed(2)
            : '0.00';
        const totalRevenue = (stats.revenue / 100).toFixed(2);

        return {
            variant,
            name: AB_CONFIG.variants[variant]?.name || variant,
            description: AB_CONFIG.variants[variant]?.description || '',
            traffic: AB_CONFIG.variants[variant]?.traffic || 0,
            ...stats,
            checkoutRate,
            conversionRate,
            trialConversionRate,
            avgOrderValue,
            totalRevenue
        };
    });

    const totalVisitors = Object.values(AB_STATS).reduce((sum, s) => sum + s.visitors, 0);
    const totalConversions = Object.values(AB_STATS).reduce((sum, s) => sum + s.conversions, 0);
    const totalRevenue = Object.values(AB_STATS).reduce((sum, s) => sum + s.revenue, 0);

    return {
        testName: AB_CONFIG.testName,
        startDate: TEST_START_DATE,
        lastUpdated: new Date().toISOString(),
        summary: {
            totalVisitors,
            totalConversions,
            totalRevenue: (totalRevenue / 100).toFixed(2),
            overallConversionRate: totalVisitors > 0
                ? ((totalConversions / totalVisitors) * 100).toFixed(2) + '%'
                : '0%'
        },
        variants
    };
}

// Reset stats (for testing)
function resetStats() {
    AB_STATS = {
        A: { visitors: 0, checkoutStarts: 0, conversions: 0, revenue: 0, trials: 0, trialConversions: 0 },
        B: { visitors: 0, checkoutStarts: 0, conversions: 0, revenue: 0, trials: 0, trialConversions: 0 },
        C: { visitors: 0, checkoutStarts: 0, conversions: 0, revenue: 0, trials: 0, trialConversions: 0 }
    };
    saveStats();
    console.log('[A/B Test] Stats reset');
}

// Initialize
loadStats();
console.log('[A/B Test] Tracker initialized');

module.exports = {
    assignVariant,
    trackVisitor,
    trackCheckoutStart,
    trackConversion,
    trackTrialStart,
    trackTrialConversion,
    getStats,
    resetStats,
    AB_CONFIG
};
