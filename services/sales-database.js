/**
 * DOZ UP - Sales Database Service
 * Centralized sales data management with journey tracking
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SALES_DB_PATH = path.join(DATA_DIR, 'sales-database.json');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');
const SUBSCRIPTIONS_PATH = path.join(DATA_DIR, 'subscriptions.json');

// In-memory cache
let salesData = null;
let lastSave = 0;
const SAVE_INTERVAL = 5000; // Save every 5 seconds max

/**
 * Initialize/load sales database
 */
function loadDatabase() {
    if (salesData) return salesData;

    try {
        if (fs.existsSync(SALES_DB_PATH)) {
            salesData = JSON.parse(fs.readFileSync(SALES_DB_PATH, 'utf8'));
        } else {
            salesData = {
                sales: [],
                journeys: {},
                stats: {
                    totalSales: 0,
                    totalRevenue: 0,
                    todaySales: 0,
                    todayRevenue: 0,
                    lastReset: new Date().toDateString()
                },
                lastUpdated: new Date().toISOString()
            };
            // Import existing data on first load
            importExistingData();
        }
    } catch (e) {
        console.error('[SalesDB] Load error:', e.message);
        salesData = {
            sales: [],
            journeys: {},
            stats: { totalSales: 0, totalRevenue: 0, todaySales: 0, todayRevenue: 0, lastReset: new Date().toDateString() },
            lastUpdated: new Date().toISOString()
        };
    }

    return salesData;
}

/**
 * Save database (debounced)
 */
function saveDatabase() {
    const now = Date.now();
    if (now - lastSave < SAVE_INTERVAL) {
        // Schedule save for later
        setTimeout(() => saveDatabase(), SAVE_INTERVAL);
        return;
    }

    lastSave = now;
    try {
        salesData.lastUpdated = new Date().toISOString();
        fs.writeFileSync(SALES_DB_PATH, JSON.stringify(salesData, null, 2));
    } catch (e) {
        console.error('[SalesDB] Save error:', e.message);
    }
}

/**
 * Import existing transactions and subscriptions
 */
function importExistingData() {
    console.log('[SalesDB] Importing existing data...');
    let imported = 0;

    // Import transactions
    try {
        if (fs.existsSync(TRANSACTIONS_PATH)) {
            const transactions = JSON.parse(fs.readFileSync(TRANSACTIONS_PATH, 'utf8'));
            const txArray = Array.isArray(transactions) ? transactions : Object.values(transactions);

            for (const tx of txArray) {
                if (tx.type === 'checkout_completed' || tx.type === 'invoice_paid' || tx.status === 'completed') {
                    const sale = {
                        id: tx.id || uuidv4(),
                        stripeId: tx.stripeId || tx.id,
                        email: tx.email || tx.customerEmail || '',
                        plan: tx.planId || tx.plan || 'Unknown',
                        amount: (tx.amount || 0) / 100, // Convert cents to dollars
                        currency: tx.currency || 'USD',
                        status: 'completed',
                        type: tx.type || 'purchase',
                        createdAt: tx.createdAt || tx.timestamp || new Date().toISOString(),
                        userId: tx.userId || '',
                        journey: {
                            source: tx.source || 'direct',
                            campaign: tx.campaign || ''
                        }
                    };

                    // Avoid duplicates
                    if (!salesData.sales.find(s => s.stripeId === sale.stripeId)) {
                        salesData.sales.push(sale);
                        imported++;
                    }
                }
            }
        }
    } catch (e) {
        console.error('[SalesDB] Transaction import error:', e.message);
    }

    // Import subscriptions
    try {
        if (fs.existsSync(SUBSCRIPTIONS_PATH)) {
            const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_PATH, 'utf8'));
            const subArray = Array.isArray(subs) ? subs : Object.values(subs);

            for (const sub of subArray) {
                if (sub.status === 'active' && sub.amount) {
                    const sale = {
                        id: sub.id || uuidv4(),
                        stripeId: sub.stripeSubscriptionId || sub.id,
                        email: sub.email || '',
                        plan: sub.planId || 'Subscription',
                        amount: (sub.amount || 0) / 100,
                        currency: sub.currency || 'USD',
                        status: 'completed',
                        type: 'subscription',
                        createdAt: sub.createdAt || new Date().toISOString(),
                        userId: sub.userId || '',
                        journey: { source: 'subscription' }
                    };

                    if (!salesData.sales.find(s => s.stripeId === sale.stripeId)) {
                        salesData.sales.push(sale);
                        imported++;
                    }
                }
            }
        }
    } catch (e) {
        console.error('[SalesDB] Subscription import error:', e.message);
    }

    // Sort by date
    salesData.sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Calculate stats
    recalculateStats();

    console.log(`[SalesDB] Imported ${imported} sales. Total: ${salesData.sales.length}`);
    saveDatabase();
}

/**
 * Recalculate statistics
 */
function recalculateStats() {
    const today = new Date().toDateString();

    // Reset daily stats if new day
    if (salesData.stats.lastReset !== today) {
        salesData.stats.todaySales = 0;
        salesData.stats.todayRevenue = 0;
        salesData.stats.lastReset = today;
    }

    let totalRevenue = 0;
    let todayRevenue = 0;
    let todaySales = 0;

    for (const sale of salesData.sales) {
        if (sale.status === 'completed') {
            totalRevenue += sale.amount || 0;

            const saleDate = new Date(sale.createdAt).toDateString();
            if (saleDate === today) {
                todayRevenue += sale.amount || 0;
                todaySales++;
            }
        }
    }

    salesData.stats.totalSales = salesData.sales.filter(s => s.status === 'completed').length;
    salesData.stats.totalRevenue = Math.round(totalRevenue * 100) / 100;
    salesData.stats.todaySales = todaySales;
    salesData.stats.todayRevenue = Math.round(todayRevenue * 100) / 100;
}

/**
 * Record a new sale
 */
function recordSale(saleData) {
    loadDatabase();

    const sale = {
        id: saleData.id || uuidv4(),
        stripeId: saleData.stripeId || saleData.id,
        email: saleData.email || '',
        plan: saleData.plan || saleData.planId || 'Unknown',
        amount: typeof saleData.amount === 'number' ? saleData.amount : 0,
        currency: saleData.currency || 'USD',
        status: saleData.status || 'completed',
        type: saleData.type || 'purchase',
        createdAt: saleData.createdAt || new Date().toISOString(),
        userId: saleData.userId || '',
        customerName: saleData.customerName || '',
        journey: saleData.journey || {}
    };

    // Check for duplicate
    const existing = salesData.sales.find(s => s.stripeId === sale.stripeId);
    if (existing) {
        // Update existing
        Object.assign(existing, sale);
    } else {
        // Add new
        salesData.sales.unshift(sale);

        // Update stats
        if (sale.status === 'completed') {
            salesData.stats.totalSales++;
            salesData.stats.totalRevenue += sale.amount;

            if (new Date(sale.createdAt).toDateString() === new Date().toDateString()) {
                salesData.stats.todaySales++;
                salesData.stats.todayRevenue += sale.amount;
            }
        }
    }

    saveDatabase();
    return sale;
}

/**
 * Track user journey
 */
function trackJourney(fingerprint, data) {
    loadDatabase();

    if (!salesData.journeys[fingerprint]) {
        salesData.journeys[fingerprint] = {
            stage: 'visit',
            visits: 0,
            pages: [],
            email: null,
            source: data.source || 'direct',
            startedAt: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        };
    }

    const journey = salesData.journeys[fingerprint];
    journey.visits++;
    journey.lastActivity = new Date().toISOString();

    if (data.page) {
        journey.lastPage = data.page;
        if (!journey.pages.includes(data.page)) {
            journey.pages.push(data.page);
        }

        // Determine stage based on pages visited
        if (data.page.includes('checkout') || data.page.includes('pay')) {
            journey.stage = 'checkout';
        } else if (data.page.includes('pricing') || data.page.includes('plans')) {
            if (journey.stage === 'visit') journey.stage = 'interest';
        }
    }

    if (data.email) {
        journey.email = data.email;
    }

    if (data.stage) {
        journey.stage = data.stage;
    }

    saveDatabase();
    return journey;
}

/**
 * Mark journey as purchased
 */
function markPurchased(fingerprint, saleId) {
    loadDatabase();

    if (salesData.journeys[fingerprint]) {
        salesData.journeys[fingerprint].stage = 'purchased';
        salesData.journeys[fingerprint].saleId = saleId;
        salesData.journeys[fingerprint].purchasedAt = new Date().toISOString();
        saveDatabase();
    }
}

/**
 * Get all sales with pagination
 */
function getAllSales(options = {}) {
    loadDatabase();

    let sales = [...salesData.sales];

    // Filter by status
    if (options.status) {
        sales = sales.filter(s => s.status === options.status);
    }

    // Filter by date range
    if (options.startDate) {
        const start = new Date(options.startDate);
        sales = sales.filter(s => new Date(s.createdAt) >= start);
    }
    if (options.endDate) {
        const end = new Date(options.endDate);
        sales = sales.filter(s => new Date(s.createdAt) <= end);
    }

    // Filter by plan
    if (options.plan) {
        sales = sales.filter(s => s.plan.toLowerCase().includes(options.plan.toLowerCase()));
    }

    // Search by email
    if (options.search) {
        const search = options.search.toLowerCase();
        sales = sales.filter(s =>
            (s.email && s.email.toLowerCase().includes(search)) ||
            (s.plan && s.plan.toLowerCase().includes(search)) ||
            (s.customerName && s.customerName.toLowerCase().includes(search))
        );
    }

    // Pagination
    const page = options.page || 1;
    const limit = options.limit || 50;
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
        sales: sales.slice(start, end),
        total: sales.length,
        page,
        limit,
        totalPages: Math.ceil(sales.length / limit)
    };
}

/**
 * Get today's sales
 */
function getTodaySales() {
    loadDatabase();
    recalculateStats();

    const today = new Date().toDateString();
    const todaySales = salesData.sales.filter(s =>
        new Date(s.createdAt).toDateString() === today && s.status === 'completed'
    );

    return {
        sales: todaySales,
        count: todaySales.length,
        revenue: salesData.stats.todayRevenue
    };
}

/**
 * Get sale by ID
 */
function getSaleById(id) {
    loadDatabase();
    return salesData.sales.find(s => s.id === id || s.stripeId === id);
}

/**
 * Get statistics
 */
function getStats() {
    loadDatabase();
    recalculateStats();

    // Calculate additional metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const last30Days = salesData.sales.filter(s =>
        new Date(s.createdAt) >= thirtyDaysAgo && s.status === 'completed'
    );

    const monthRevenue = last30Days.reduce((sum, s) => sum + (s.amount || 0), 0);

    return {
        ...salesData.stats,
        monthSales: last30Days.length,
        monthRevenue: Math.round(monthRevenue * 100) / 100,
        averageOrderValue: salesData.stats.totalSales > 0
            ? Math.round((salesData.stats.totalRevenue / salesData.stats.totalSales) * 100) / 100
            : 0
    };
}

/**
 * Get active journeys (users on checkout or pricing)
 */
function getActiveJourneys() {
    loadDatabase();

    const now = Date.now();
    const activeThreshold = 30 * 60 * 1000; // 30 minutes

    const active = Object.entries(salesData.journeys)
        .filter(([_, j]) => {
            const lastActive = new Date(j.lastActivity).getTime();
            return (now - lastActive) < activeThreshold && j.stage !== 'purchased';
        })
        .map(([fingerprint, journey]) => ({
            fingerprint: fingerprint.substring(0, 8) + '...',
            ...journey
        }))
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    return active;
}

/**
 * Get funnel analytics
 */
function getFunnelAnalytics() {
    loadDatabase();

    const today = new Date().toDateString();
    const journeys = Object.values(salesData.journeys);

    // Count by stage
    const funnel = {
        visit: 0,
        interest: 0,
        checkout: 0,
        purchased: 0
    };

    // Today's funnel
    const todayFunnel = { visit: 0, interest: 0, checkout: 0, purchased: 0 };

    for (const j of journeys) {
        funnel[j.stage] = (funnel[j.stage] || 0) + 1;

        if (new Date(j.lastActivity).toDateString() === today) {
            todayFunnel[j.stage] = (todayFunnel[j.stage] || 0) + 1;
        }
    }

    // Calculate conversion rates
    const totalVisitors = funnel.visit + funnel.interest + funnel.checkout + funnel.purchased;

    return {
        total: funnel,
        today: todayFunnel,
        conversionRates: {
            visitToInterest: totalVisitors > 0 ? Math.round(((funnel.interest + funnel.checkout + funnel.purchased) / totalVisitors) * 100) : 0,
            interestToCheckout: (funnel.interest + funnel.checkout + funnel.purchased) > 0
                ? Math.round(((funnel.checkout + funnel.purchased) / (funnel.interest + funnel.checkout + funnel.purchased)) * 100) : 0,
            checkoutToPurchased: (funnel.checkout + funnel.purchased) > 0
                ? Math.round((funnel.purchased / (funnel.checkout + funnel.purchased)) * 100) : 0,
            overall: totalVisitors > 0 ? Math.round((funnel.purchased / totalVisitors) * 100) : 0
        }
    };
}

/**
 * Export sales to CSV
 */
function exportToCSV(options = {}) {
    const { sales } = getAllSales({ ...options, limit: 10000 });

    const headers = ['ID', 'Date', 'Email', 'Plan', 'Amount', 'Currency', 'Status', 'Type'];
    const rows = sales.map(s => [
        s.id,
        new Date(s.createdAt).toISOString(),
        s.email,
        s.plan,
        s.amount,
        s.currency,
        s.status,
        s.type
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    return csv;
}

/**
 * Get recent sales for live feed
 */
function getRecentSales(limit = 20) {
    loadDatabase();
    return salesData.sales.slice(0, limit);
}

// Export
module.exports = {
    loadDatabase,
    recordSale,
    trackJourney,
    markPurchased,
    getAllSales,
    getTodaySales,
    getSaleById,
    getStats,
    getActiveJourneys,
    getFunnelAnalytics,
    exportToCSV,
    getRecentSales,
    importExistingData,
    recalculateStats
};
