/**
 * Dashboard Stats Service
 * Aggregates real data from all sources for admin dashboard
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function loadJSON(filepath, defaultValue = {}) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

class DashboardStats {
    /**
     * Get real support tickets from conversations
     */
    getTickets() {
        const convPath = path.join(dataDir, 'support-conversations.json');
        const data = loadJSON(convPath, { conversations: [] });
        const conversations = data.conversations || [];

        return conversations.map(conv => ({
            id: conv.id || conv.conversationId,
            subject: conv.subject || (conv.messages?.[0]?.content?.slice(0, 50) + '...') || 'Support Request',
            customer: conv.email || conv.visitorId || 'Anonymous',
            priority: conv.priority || (conv.aiHandled ? 'low' : 'medium'),
            status: conv.status || 'open',
            created: new Date(conv.createdAt || conv.startedAt || Date.now()),
            channel: conv.channel || 'chat',
            aiHandled: conv.aiHandled || false
        })).sort((a, b) => b.created - a.created).slice(0, 20);
    }

    /**
     * Get real subscriptions from data files
     */
    getSubscriptions() {
        const subsPath = path.join(dataDir, 'subscriptions.json');
        const subs = loadJSON(subsPath, []);
        const subsList = Array.isArray(subs) ? subs : Object.values(subs);

        return subsList.map(sub => ({
            customer: sub.customerName || sub.userId || 'User',
            email: sub.email || sub.customerEmail || '',
            plan: sub.planName || sub.plan || 'Unknown',
            amount: this.formatAmount(sub.amount || sub.price || 0, sub.interval || 'month'),
            status: sub.status || 'active',
            started: sub.currentPeriodStart || sub.createdAt || new Date().toISOString(),
            nextBilling: sub.currentPeriodEnd || null,
            stripeId: sub.stripeSubscriptionId || null
        }));
    }

    /**
     * Calculate real MRR from subscriptions
     */
    getMRR() {
        const subsPath = path.join(dataDir, 'subscriptions.json');
        const subs = loadJSON(subsPath, []);
        const subsList = Array.isArray(subs) ? subs : Object.values(subs);

        const activeSubs = subsList.filter(s => s.status === 'active');

        return activeSubs.reduce((sum, s) => {
            const amount = s.amount || s.price || 0;
            const interval = s.interval || 'month';
            if (interval === 'year' || interval === 'yearly') return sum + (amount / 12);
            return sum + amount;
        }, 0);
    }

    /**
     * Get real traffic sources breakdown
     */
    getTrafficSources() {
        const trafficPath = path.join(dataDir, 'traffic.json');
        const analyticsPath = path.join(dataDir, 'analytics-advanced.json');

        const traffic = loadJSON(trafficPath, { pageViews: [] });
        const analytics = loadJSON(analyticsPath, { pageViews: [] });

        // Combine all page views
        const allViews = [...(traffic.pageViews || []), ...(analytics.pageViews || [])];

        // Count by source
        const sources = {
            'Google Ads': 0,
            'Organic': 0,
            'Direct': 0,
            'Social': 0,
            'Referral': 0
        };

        allViews.forEach(pv => {
            const ref = (pv.referrer || pv.source || '').toLowerCase();
            if (ref.includes('google') && (ref.includes('ads') || ref.includes('gclid'))) {
                sources['Google Ads']++;
            } else if (ref.includes('google') || ref.includes('bing') || ref.includes('yahoo') || ref.includes('duckduckgo')) {
                sources['Organic']++;
            } else if (ref.includes('facebook') || ref.includes('twitter') || ref.includes('instagram') || ref.includes('linkedin') || ref.includes('tiktok')) {
                sources['Social']++;
            } else if (!ref || ref === 'direct' || ref === '(direct)') {
                sources['Direct']++;
            } else {
                sources['Referral']++;
            }
        });

        const total = Object.values(sources).reduce((a, b) => a + b, 0) || 1;

        return {
            labels: Object.keys(sources),
            data: Object.values(sources).map(v => Math.round((v / total) * 100))
        };
    }

    /**
     * Get growth chart data (last 7 days)
     */
    getGrowthChart() {
        const trafficPath = path.join(dataDir, 'traffic.json');
        const traffic = loadJSON(trafficPath, { pageViews: [], visitors: {} });

        const now = Date.now();
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const today = new Date().getDay();

        // Reorder days to end with today
        const orderedDays = [];
        for (let i = 6; i >= 0; i--) {
            const dayIndex = (today - i + 7) % 7;
            orderedDays.push(days[dayIndex === 0 ? 6 : dayIndex - 1]);
        }

        // Count page views per day
        const pageViews = traffic.pageViews || [];
        const dailyViews = [0, 0, 0, 0, 0, 0, 0];

        pageViews.forEach(pv => {
            const ts = pv.timestamp || 0;
            const daysAgo = Math.floor((now - ts) / 86400000);
            if (daysAgo >= 0 && daysAgo < 7) {
                dailyViews[6 - daysAgo]++;
            }
        });

        // Get revenue per day from transactions
        const transPath = path.join(dataDir, 'transactions.json');
        const trans = loadJSON(transPath, []);
        const dailyRevenue = [0, 0, 0, 0, 0, 0, 0];

        (Array.isArray(trans) ? trans : Object.values(trans)).forEach(t => {
            const ts = new Date(t.createdAt || t.timestamp || 0).getTime();
            const daysAgo = Math.floor((now - ts) / 86400000);
            if (daysAgo >= 0 && daysAgo < 7 && t.status === 'succeeded') {
                dailyRevenue[6 - daysAgo] += (t.amount || 0) / 100;
            }
        });

        return {
            labels: orderedDays,
            users: dailyViews,
            revenue: dailyRevenue
        };
    }

    /**
     * Get ROI data from actual revenue
     */
    getROIData() {
        const transPath = path.join(dataDir, 'transactions.json');
        const trans = loadJSON(transPath, []);
        const transList = Array.isArray(trans) ? trans : Object.values(trans);

        const now = Date.now();
        const dayAgo = now - 86400000;
        const weekAgo = now - 604800000;

        // Calculate today's revenue
        const todayRevenue = transList
            .filter(t => {
                const ts = new Date(t.createdAt || t.timestamp || 0).getTime();
                return ts > dayAgo && t.status === 'succeeded';
            })
            .reduce((sum, t) => sum + ((t.amount || 0) / 100), 0);

        // Calculate week's revenue
        const weekRevenue = transList
            .filter(t => {
                const ts = new Date(t.createdAt || t.timestamp || 0).getTime();
                return ts > weekAgo && t.status === 'succeeded';
            })
            .reduce((sum, t) => sum + ((t.amount || 0) / 100), 0);

        // Ad spend tracking (if available)
        const adSpendPath = path.join(dataDir, 'ad-spend.json');
        const adSpend = loadJSON(adSpendPath, { today: 0, week: 0 });

        const todaySpend = adSpend.today || 0;
        const weekSpend = adSpend.week || 0;

        const todayROI = todaySpend > 0
            ? Math.round(((todayRevenue - todaySpend) / todaySpend) * 100)
            : (todayRevenue > 0 ? 100 : 0);

        return {
            todaySpend,
            todayRevenue,
            todayROI,
            weekSpend,
            weekRevenue,
            weekROI: weekSpend > 0
                ? Math.round(((weekRevenue - weekSpend) / weekSpend) * 100)
                : (weekRevenue > 0 ? 100 : 0)
        };
    }

    /**
     * Get comprehensive dashboard stats
     */
    getAllStats() {
        return {
            tickets: this.getTickets(),
            subscriptions: this.getSubscriptions(),
            mrr: this.getMRR(),
            trafficSources: this.getTrafficSources(),
            growth: this.getGrowthChart(),
            roi: this.getROIData()
        };
    }

    formatAmount(amount, interval) {
        const formatted = typeof amount === 'number' ? amount.toFixed(2) : amount;
        return `$${formatted}/${interval === 'year' ? 'yr' : 'mo'}`;
    }
}

module.exports = new DashboardStats();
