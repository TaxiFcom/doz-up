/**
 * DOZ UP - Analytics Service
 * Business metrics, KPIs, and trend analysis
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

class AnalyticsService {
    constructor() {
        this.leadsPath = path.join(dataDir, 'leads.json');
        this.dealsPath = path.join(dataDir, 'deals.json');
        this.proposalsPath = path.join(dataDir, 'proposals.json');
        this.affiliatesPath = path.join(dataDir, 'affiliates.json');
        this.demosPath = path.join(dataDir, 'demos.json');
    }

    // Get overview dashboard stats
    getDashboardOverview() {
        const leads = loadJSON(this.leadsPath, []);
        const deals = loadJSON(this.dealsPath, []);
        const proposals = loadJSON(this.proposalsPath, []);
        const affiliates = loadJSON(this.affiliatesPath, []);

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Calculate revenue metrics
        const wonDeals = deals.filter(d => d.status === 'won');
        const totalRevenue = wonDeals.reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;
        const monthRevenue = wonDeals
            .filter(d => new Date(d.closedAt || d.updatedAt) >= startOfMonth)
            .reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;

        // Pipeline metrics
        const pipelineDeals = deals.filter(d => !['won', 'lost'].includes(d.status));
        const pipelineValue = pipelineDeals.reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;
        const weightedPipeline = pipelineDeals
            .reduce((sum, d) => sum + (d.finalAmount || 0) * (d.probability || 50) / 100, 0) / 100;

        // Lead metrics
        const newLeadsThisMonth = leads.filter(l => new Date(l.createdAt) >= startOfMonth).length;
        const newLeadsThisWeek = leads.filter(l => new Date(l.createdAt) >= startOfWeek).length;
        const newLeadsToday = leads.filter(l => new Date(l.createdAt) >= today).length;
        const qualifiedLeads = leads.filter(l => l.status === 'qualified').length;
        const hotLeads = leads.filter(l => l.priority === 'hot' || l.score >= 80).length;

        // Conversion rates
        const leadToQualified = leads.length > 0
            ? (qualifiedLeads / leads.length * 100).toFixed(1) : 0;
        const dealWinRate = deals.length > 0
            ? (wonDeals.length / deals.length * 100).toFixed(1) : 0;
        const proposalAcceptRate = proposals.length > 0
            ? (proposals.filter(p => p.status === 'accepted').length / proposals.length * 100).toFixed(1) : 0;

        // Average deal size
        const avgDealSize = wonDeals.length > 0
            ? Math.round(totalRevenue / wonDeals.length) : 0;

        // Affiliate metrics
        const activeAffiliates = affiliates.filter(a => a.status === 'active').length;
        const affiliateRevenue = affiliates.reduce((sum, a) => sum + (a.stats?.revenue || 0), 0) / 100;
        const affiliateConversions = affiliates.reduce((sum, a) => sum + (a.stats?.conversions || 0), 0);

        return {
            revenue: {
                total: totalRevenue,
                thisMonth: monthRevenue,
                pipeline: pipelineValue,
                weightedPipeline: Math.round(weightedPipeline),
                avgDealSize
            },
            leads: {
                total: leads.length,
                thisMonth: newLeadsThisMonth,
                thisWeek: newLeadsThisWeek,
                today: newLeadsToday,
                qualified: qualifiedLeads,
                hot: hotLeads
            },
            deals: {
                total: deals.length,
                won: wonDeals.length,
                lost: deals.filter(d => d.status === 'lost').length,
                inPipeline: pipelineDeals.length,
                winRate: parseFloat(dealWinRate)
            },
            proposals: {
                total: proposals.length,
                sent: proposals.filter(p => p.status === 'sent').length,
                viewed: proposals.filter(p => p.status === 'viewed').length,
                accepted: proposals.filter(p => p.status === 'accepted').length,
                acceptRate: parseFloat(proposalAcceptRate)
            },
            conversions: {
                leadToQualified: parseFloat(leadToQualified),
                dealWinRate: parseFloat(dealWinRate),
                proposalAcceptRate: parseFloat(proposalAcceptRate)
            },
            affiliates: {
                total: affiliates.length,
                active: activeAffiliates,
                revenue: affiliateRevenue,
                conversions: affiliateConversions
            }
        };
    }

    // Get revenue trend data
    getRevenueTrend(days = 30) {
        const deals = loadJSON(this.dealsPath, []);
        const wonDeals = deals.filter(d => d.status === 'won');

        const trend = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const dayRevenue = wonDeals
                .filter(d => (d.closedAt || d.updatedAt)?.startsWith(dateStr))
                .reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;

            trend.push({
                date: dateStr,
                revenue: dayRevenue
            });
        }

        return trend;
    }

    // Get lead source breakdown
    getLeadSources() {
        const leads = loadJSON(this.leadsPath, []);

        const sources = {};
        for (const lead of leads) {
            const source = lead.source || 'unknown';
            if (!sources[source]) {
                sources[source] = { count: 0, converted: 0 };
            }
            sources[source].count++;
            if (lead.status === 'qualified' || lead.status === 'converted') {
                sources[source].converted++;
            }
        }

        return Object.entries(sources).map(([source, data]) => ({
            source,
            count: data.count,
            converted: data.converted,
            conversionRate: data.count > 0
                ? (data.converted / data.count * 100).toFixed(1) : 0
        })).sort((a, b) => b.count - a.count);
    }

    // Get tier distribution
    getTierDistribution() {
        const deals = loadJSON(this.dealsPath, []);
        const wonDeals = deals.filter(d => d.status === 'won');

        const tiers = {};
        for (const deal of wonDeals) {
            const tier = deal.tier || 'unknown';
            if (!tiers[tier]) {
                tiers[tier] = { count: 0, revenue: 0 };
            }
            tiers[tier].count++;
            tiers[tier].revenue += (deal.finalAmount || 0) / 100;
        }

        return Object.entries(tiers).map(([tier, data]) => ({
            tier,
            count: data.count,
            revenue: Math.round(data.revenue)
        })).sort((a, b) => b.revenue - a.revenue);
    }

    // Get sales funnel data
    getSalesFunnel() {
        const leads = loadJSON(this.leadsPath, []);
        const deals = loadJSON(this.dealsPath, []);
        const proposals = loadJSON(this.proposalsPath, []);

        return {
            leads: leads.length,
            qualified: leads.filter(l => l.status === 'qualified').length,
            demos: leads.filter(l => l.status === 'demo_scheduled' || l.status === 'demo_completed').length,
            proposals: proposals.filter(p => ['sent', 'viewed', 'accepted'].includes(p.status)).length,
            negotiations: deals.filter(d => d.status === 'negotiation').length,
            won: deals.filter(d => d.status === 'won').length
        };
    }

    // Get top performers (affiliates)
    getTopAffiliates(limit = 5) {
        const affiliates = loadJSON(this.affiliatesPath, []);

        return affiliates
            .filter(a => a.status === 'active')
            .sort((a, b) => (b.stats?.revenue || 0) - (a.stats?.revenue || 0))
            .slice(0, limit)
            .map(a => ({
                id: a.id,
                name: a.name,
                company: a.company,
                revenue: (a.stats?.revenue || 0) / 100,
                conversions: a.stats?.conversions || 0,
                clicks: a.stats?.clicks || 0
            }));
    }

    // Get recent activity
    getRecentActivity(limit = 10) {
        const activityPath = path.join(dataDir, 'activity.json');
        const activities = loadJSON(activityPath, []);

        return activities.slice(0, limit);
    }

    // Get MRR/ARR metrics
    getMRRMetrics() {
        const deals = loadJSON(this.dealsPath, []);
        const wonDeals = deals.filter(d => d.status === 'won');

        // Assuming deals are annual subscriptions
        const totalARR = wonDeals.reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;
        const mrr = totalARR / 12;

        // Calculate growth (this month vs last month)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        const thisMonthDeals = wonDeals.filter(d => {
            const date = new Date(d.closedAt || d.updatedAt);
            return date >= startOfMonth;
        });
        const lastMonthDeals = wonDeals.filter(d => {
            const date = new Date(d.closedAt || d.updatedAt);
            return date >= startOfLastMonth && date < startOfMonth;
        });

        const thisMonthARR = thisMonthDeals.reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;
        const lastMonthARR = lastMonthDeals.reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;

        const growth = lastMonthARR > 0
            ? ((thisMonthARR - lastMonthARR) / lastMonthARR * 100).toFixed(1) : 0;

        return {
            mrr: Math.round(mrr),
            arr: Math.round(totalARR),
            newMRR: Math.round(thisMonthARR / 12),
            growth: parseFloat(growth),
            deals: wonDeals.length
        };
    }

    // Get daily stats for sparklines
    getDailyStats(metric, days = 7) {
        const stats = [];
        const now = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            let value = 0;

            if (metric === 'leads') {
                const leads = loadJSON(this.leadsPath, []);
                value = leads.filter(l => l.createdAt?.startsWith(dateStr)).length;
            } else if (metric === 'revenue') {
                const deals = loadJSON(this.dealsPath, []);
                value = deals
                    .filter(d => d.status === 'won' && (d.closedAt || d.updatedAt)?.startsWith(dateStr))
                    .reduce((sum, d) => sum + (d.finalAmount || 0), 0) / 100;
            } else if (metric === 'deals') {
                const deals = loadJSON(this.dealsPath, []);
                value = deals.filter(d => d.createdAt?.startsWith(dateStr)).length;
            }

            stats.push({ date: dateStr, value });
        }

        return stats;
    }
}

module.exports = new AnalyticsService();
