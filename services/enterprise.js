/**
 * DOZ UP - Enterprise Sales & Lead Management System
 * Infrastructure for high-value B2B sales
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const leadsPath = path.join(dataDir, 'enterprise-leads.json');
const dealsPath = path.join(dataDir, 'deals.json');
const affiliatesPath = path.join(dataDir, 'affiliates.json');
const referralsPath = path.join(dataDir, 'referrals.json');

// Ensure data directory
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Load/Save helpers
function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ============ $1M WEEK PRICING STRATEGY ============

// LIFETIME DEALS - Quick cash injection
const LIFETIME_DEALS = {
    lifetime_pro: {
        id: 'lifetime_pro',
        name: 'Lifetime Pro',
        description: 'Pay once, use forever',
        type: 'lifetime',
        seats: 5,
        storage: 100, // GB
        price: 29900, // $299 one-time
        originalPrice: 119900, // $1,199 "value"
        spotsTotal: 500,
        spotsRemaining: 500,
        features: [
            '5 team seats forever',
            '100 GB storage',
            'All Pro features',
            'Lifetime updates',
            'Priority support for 1 year',
            'No recurring fees ever'
        ]
    },
    lifetime_team: {
        id: 'lifetime_team',
        name: 'Lifetime Team',
        description: 'Best value for teams',
        type: 'lifetime',
        seats: 25,
        storage: 500, // GB
        price: 99900, // $999 one-time
        originalPrice: 499900, // $4,999 "value"
        spotsTotal: 200,
        spotsRemaining: 200,
        features: [
            '25 team seats forever',
            '500 GB storage',
            'All Business features',
            'Lifetime updates',
            'Priority support for 2 years',
            'Custom domain',
            'API access'
        ]
    },
    lifetime_unlimited: {
        id: 'lifetime_unlimited',
        name: 'Lifetime Unlimited',
        description: 'Ultimate lifetime deal',
        type: 'lifetime',
        seats: 'Unlimited',
        storage: 'Unlimited',
        price: 249900, // $2,499 one-time
        originalPrice: 1499900, // $14,999 "value"
        spotsTotal: 100,
        spotsRemaining: 100,
        features: [
            'Unlimited seats forever',
            'Unlimited storage',
            'All Enterprise features',
            'Lifetime updates',
            'Priority support for 3 years',
            'White-label option',
            'API access',
            'Custom integrations'
        ]
    }
};

// WHITE-LABEL / RESELLER PROGRAM
const RESELLER_TIERS = {
    reseller_starter: {
        id: 'reseller_starter',
        name: 'Reseller Starter',
        description: 'Start your own screenshot business',
        type: 'reseller',
        minLicenses: 10,
        discountPercent: 40,
        price: 499900, // $4,999 setup + 40% off all licenses
        features: [
            'Your own branded platform',
            '40% discount on all licenses',
            'Resell at any price',
            'Basic white-label',
            'Reseller dashboard',
            'Marketing materials'
        ]
    },
    reseller_agency: {
        id: 'reseller_agency',
        name: 'Agency Partner',
        description: 'For agencies serving clients',
        type: 'reseller',
        minLicenses: 50,
        discountPercent: 50,
        price: 1499900, // $14,999 setup + 50% off
        features: [
            'Full white-label platform',
            '50% discount on all licenses',
            'Unlimited client accounts',
            'Custom domain per client',
            'Revenue dashboard',
            'Co-marketing support',
            'Partner badge'
        ]
    },
    reseller_enterprise: {
        id: 'reseller_enterprise',
        name: 'Enterprise Reseller',
        description: 'Build a SaaS business',
        type: 'reseller',
        minLicenses: 200,
        discountPercent: 60,
        price: 4999900, // $49,999 setup + 60% off
        features: [
            'Fully customizable platform',
            '60% discount on all licenses',
            'Your own pricing',
            'Custom features on request',
            'Dedicated account manager',
            'Revenue share options',
            'Enterprise support'
        ]
    }
};

// MEGA ENTERPRISE DEALS - $100K-$500K
const MEGA_DEALS = {
    corporate: {
        id: 'corporate',
        name: 'Corporate License',
        description: 'Company-wide deployment',
        seats: 500,
        storage: 10000, // 10 TB
        price: 9999900, // $99,999/year
        annualPrice: 9999900,
        features: [
            '500 seats',
            '10 TB storage',
            'Dedicated infrastructure',
            'Custom SLA',
            '24/7 phone support',
            'Quarterly business reviews',
            'Custom training'
        ]
    },
    global: {
        id: 'global',
        name: 'Global Enterprise',
        description: 'Multi-region deployment',
        seats: 2000,
        storage: 50000, // 50 TB
        price: 24999900, // $249,999/year
        annualPrice: 24999900,
        features: [
            '2000 seats',
            '50 TB storage',
            'Multi-region deployment',
            'Data sovereignty',
            'Dedicated success team',
            'Custom development hours',
            'Executive sponsorship'
        ]
    },
    unlimited_enterprise: {
        id: 'unlimited_enterprise',
        name: 'Unlimited Enterprise',
        description: 'No limits, maximum value',
        seats: 'Unlimited',
        storage: 'Unlimited',
        price: 49999900, // $499,999/year
        annualPrice: 49999900,
        features: [
            'Unlimited everything',
            'Private cloud option',
            'Custom everything',
            'Board-level reporting',
            'M&A support',
            'Perpetual license option',
            'Source code escrow'
        ]
    }
};

// VIRAL REFERRAL REWARDS
const REFERRAL_REWARDS = {
    signup: 500, // $5 for every signup
    trial: 1000, // $10 for trial start
    paid: 5000, // $50 for paid conversion
    enterprise: 100000, // $1,000 for enterprise deal
    whale: 500000 // $5,000 for $50K+ deal
};

// FOUNDER SPOTS (Creates urgency)
const FOUNDER_SPOTS = {
    total: 1000,
    remaining: 1000,
    benefits: [
        'Locked-in pricing forever',
        'Direct access to founders',
        'Lifetime 50% discount',
        'Product roadmap input',
        'Exclusive founder community'
    ]
};

// ============ ENTERPRISE PRICING TIERS ============
const ENTERPRISE_TIERS = {
    startup: {
        id: 'startup',
        name: 'Startup',
        description: 'For growing teams',
        seats: 10,
        storage: 500, // GB
        price: 4999, // $49.99/mo billed annually = $4,999/year
        annualPrice: 4999,
        features: [
            '10 team seats',
            '500 GB storage',
            'Priority support',
            'Custom domain',
            'API access',
            'SSO integration',
            '99.9% uptime SLA'
        ]
    },
    business: {
        id: 'business',
        name: 'Business',
        description: 'For established companies',
        seats: 50,
        storage: 2000, // 2 TB
        price: 19999, // $19,999/year
        annualPrice: 19999,
        features: [
            '50 team seats',
            '2 TB storage',
            'Dedicated support',
            'Custom branding',
            'Advanced API',
            'SSO + SCIM',
            '99.95% uptime SLA',
            'Audit logs',
            'Data residency options'
        ]
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        description: 'For large organizations',
        seats: 'Unlimited',
        storage: 'Unlimited',
        price: 49999, // Starting at $49,999/year
        annualPrice: 49999,
        features: [
            'Unlimited seats',
            'Unlimited storage',
            '24/7 dedicated support',
            'White-label solution',
            'Custom integrations',
            'Enterprise SSO',
            '99.99% uptime SLA',
            'Compliance (SOC2, HIPAA)',
            'On-premise option',
            'Custom contracts'
        ]
    },
    whale: {
        id: 'whale',
        name: 'Strategic Partnership',
        description: 'Multi-year enterprise deals',
        seats: 'Unlimited',
        storage: 'Unlimited',
        price: 99999, // $99,999+ custom
        annualPrice: 99999,
        features: [
            'Everything in Enterprise',
            'Multi-year discount',
            'Revenue sharing options',
            'Co-marketing opportunities',
            'Product roadmap input',
            'Dedicated success manager',
            'Custom development',
            'Executive sponsorship'
        ]
    }
};

// ============ LEAD MANAGEMENT ============
class EnterpriseService {
    constructor() {
        this.leads = loadJSON(leadsPath, []);
        this.deals = loadJSON(dealsPath, []);
        this.affiliates = loadJSON(affiliatesPath, []);
        this.referrals = loadJSON(referralsPath, []);
    }

    // Get enterprise tiers
    getTiers() {
        return ENTERPRISE_TIERS;
    }

    // Get lifetime deals
    getLifetimeDeals() {
        return LIFETIME_DEALS;
    }

    // Get reseller tiers
    getResellerTiers() {
        return RESELLER_TIERS;
    }

    // Get mega deals
    getMegaDeals() {
        return MEGA_DEALS;
    }

    // Get referral rewards structure
    getReferralRewards() {
        return REFERRAL_REWARDS;
    }

    // Get founder spots status
    getFounderSpots() {
        return FOUNDER_SPOTS;
    }

    // Purchase lifetime deal
    purchaseLifetimeDeal(dealType, customerData) {
        const deal = LIFETIME_DEALS[dealType];
        if (!deal) throw new Error('Invalid lifetime deal');
        if (deal.spotsRemaining <= 0) throw new Error('No spots remaining');

        // Decrement spots
        LIFETIME_DEALS[dealType].spotsRemaining--;

        // Create lead and deal
        const lead = this.createLead({
            ...customerData,
            source: 'lifetime_deal',
            budget: `$${(deal.price / 100).toFixed(0)}`
        });

        const dealRecord = {
            id: uuidv4(),
            leadId: lead.id,
            company: customerData.company || customerData.name,
            contactName: customerData.name,
            contactEmail: customerData.email,
            tier: dealType,
            tierName: deal.name,
            type: 'lifetime',
            amount: deal.price,
            finalAmount: deal.price,
            currency: 'USD',
            status: 'won',
            probability: 100,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.deals.push(dealRecord);
        saveJSON(dealsPath, this.deals);

        return { deal: dealRecord, spotsRemaining: LIFETIME_DEALS[dealType].spotsRemaining };
    }

    // Purchase reseller tier
    purchaseResellerTier(tierType, customerData) {
        const tier = RESELLER_TIERS[tierType];
        if (!tier) throw new Error('Invalid reseller tier');

        const lead = this.createLead({
            ...customerData,
            source: 'reseller_program',
            budget: `$${(tier.price / 100).toFixed(0)}`
        });

        const dealRecord = {
            id: uuidv4(),
            leadId: lead.id,
            company: customerData.company,
            contactName: customerData.name,
            contactEmail: customerData.email,
            tier: tierType,
            tierName: tier.name,
            type: 'reseller',
            amount: tier.price,
            finalAmount: tier.price,
            discountPercent: tier.discountPercent,
            currency: 'USD',
            status: 'won',
            probability: 100,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.deals.push(dealRecord);
        saveJSON(dealsPath, this.deals);

        // Create affiliate for reseller
        const affiliate = this.createAffiliate({
            name: customerData.name,
            email: customerData.email,
            company: customerData.company,
            type: 'reseller',
            tier: tierType === 'reseller_enterprise' ? 'platinum' : tierType === 'reseller_agency' ? 'gold' : 'standard',
            commissionRate: tier.discountPercent
        });

        return { deal: dealRecord, affiliate };
    }

    // Claim founder spot
    claimFounderSpot(customerData) {
        if (FOUNDER_SPOTS.remaining <= 0) throw new Error('No founder spots remaining');

        FOUNDER_SPOTS.remaining--;

        const lead = this.createLead({
            ...customerData,
            source: 'founder_spot'
        });

        return {
            lead,
            spotsRemaining: FOUNDER_SPOTS.remaining,
            benefits: FOUNDER_SPOTS.benefits
        };
    }

    // Process referral reward
    processReferralReward(referrerId, eventType, amount = 0) {
        const reward = REFERRAL_REWARDS[eventType];
        if (!reward) return null;

        // Find referrer
        const affiliate = this.affiliates.find(a => a.id === referrerId);
        if (!affiliate) return null;

        // Calculate reward
        let rewardAmount = reward;
        if (eventType === 'whale' && amount >= 5000000) {
            rewardAmount = REFERRAL_REWARDS.whale;
        } else if (eventType === 'enterprise' && amount >= 2000000) {
            rewardAmount = REFERRAL_REWARDS.enterprise;
        }

        affiliate.stats.commission += rewardAmount;
        saveJSON(affiliatesPath, this.affiliates);

        return { affiliate, reward: rewardAmount };
    }

    // ============ LEAD CAPTURE ============
    createLead(data) {
        const lead = {
            id: uuidv4(),
            company: data.company,
            name: data.name,
            email: data.email,
            phone: data.phone || null,
            title: data.title || null,
            size: data.companySize || null, // 1-10, 11-50, 51-200, 201-500, 500+
            industry: data.industry || null,
            useCase: data.useCase || null,
            budget: data.budget || null,
            timeline: data.timeline || 'exploring', // exploring, 30days, immediate
            source: data.source || 'website', // website, referral, outbound, event
            referralCode: data.referralCode || null,
            affiliateId: data.affiliateId || null,
            status: 'new', // new, contacted, qualified, proposal, negotiation, won, lost
            score: this.calculateLeadScore(data),
            tier: this.recommendTier(data),
            notes: [],
            activities: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Auto-qualify based on score
        if (lead.score >= 80) {
            lead.status = 'qualified';
            lead.priority = 'hot';
        } else if (lead.score >= 50) {
            lead.priority = 'warm';
        } else {
            lead.priority = 'cold';
        }

        this.leads.push(lead);
        saveJSON(leadsPath, this.leads);

        // Track referral
        if (data.referralCode) {
            this.trackReferral(data.referralCode, lead.id);
        }

        return lead;
    }

    calculateLeadScore(data) {
        let score = 0;

        // Company size scoring (bigger = higher value)
        const sizeScores = {
            '1-10': 10,
            '11-50': 25,
            '51-200': 40,
            '201-500': 60,
            '500+': 80
        };
        score += sizeScores[data.companySize] || 15;

        // Timeline scoring
        if (data.timeline === 'immediate') score += 30;
        else if (data.timeline === '30days') score += 20;
        else score += 5;

        // Budget indication
        if (data.budget === '50k+') score += 25;
        else if (data.budget === '20k-50k') score += 15;
        else if (data.budget === '10k-20k') score += 10;

        // Has phone = more serious
        if (data.phone) score += 10;

        // Title scoring (decision maker)
        const titles = ['ceo', 'cto', 'cio', 'vp', 'director', 'head'];
        if (data.title && titles.some(t => data.title.toLowerCase().includes(t))) {
            score += 15;
        }

        return Math.min(score, 100);
    }

    recommendTier(data) {
        const size = data.companySize;
        if (size === '500+' || data.budget === '50k+') return 'enterprise';
        if (size === '201-500' || data.budget === '20k-50k') return 'business';
        if (size === '51-200' || data.budget === '10k-20k') return 'business';
        return 'startup';
    }

    getLead(leadId) {
        return this.leads.find(l => l.id === leadId);
    }

    getLeads(filters = {}) {
        let leads = [...this.leads];

        if (filters.status) {
            leads = leads.filter(l => l.status === filters.status);
        }
        if (filters.priority) {
            leads = leads.filter(l => l.priority === filters.priority);
        }
        if (filters.tier) {
            leads = leads.filter(l => l.tier === filters.tier);
        }

        // Sort by score descending
        leads.sort((a, b) => b.score - a.score);

        return leads;
    }

    updateLead(leadId, updates) {
        const lead = this.leads.find(l => l.id === leadId);
        if (!lead) return null;

        Object.assign(lead, updates, { updatedAt: new Date().toISOString() });
        saveJSON(leadsPath, this.leads);
        return lead;
    }

    addLeadActivity(leadId, activity) {
        const lead = this.leads.find(l => l.id === leadId);
        if (!lead) return null;

        lead.activities.push({
            id: uuidv4(),
            type: activity.type, // email, call, meeting, demo, proposal
            description: activity.description,
            outcome: activity.outcome || null,
            nextStep: activity.nextStep || null,
            createdAt: new Date().toISOString()
        });

        lead.updatedAt = new Date().toISOString();
        saveJSON(leadsPath, this.leads);
        return lead;
    }

    // ============ DEAL MANAGEMENT ============
    createDeal(leadId, dealData) {
        const lead = this.leads.find(l => l.id === leadId);
        if (!lead) throw new Error('Lead not found');

        const tier = ENTERPRISE_TIERS[dealData.tier] || ENTERPRISE_TIERS.business;

        const deal = {
            id: uuidv4(),
            leadId,
            company: lead.company,
            contactName: lead.name,
            contactEmail: lead.email,
            tier: dealData.tier,
            tierName: tier.name,
            seats: dealData.seats || tier.seats,
            amount: dealData.amount || tier.annualPrice,
            discount: dealData.discount || 0,
            finalAmount: dealData.amount || tier.annualPrice,
            currency: 'USD',
            term: dealData.term || 12, // months
            status: 'proposal', // proposal, negotiation, contract, won, lost
            probability: 50,
            expectedCloseDate: dealData.expectedCloseDate || this.getExpectedCloseDate(lead.timeline),
            notes: dealData.notes || '',
            affiliateId: lead.affiliateId,
            referralCode: lead.referralCode,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Apply discount
        if (deal.discount > 0) {
            deal.finalAmount = Math.round(deal.amount * (1 - deal.discount / 100));
        }

        // Update lead status
        lead.status = 'proposal';
        saveJSON(leadsPath, this.leads);

        this.deals.push(deal);
        saveJSON(dealsPath, this.deals);

        return deal;
    }

    getExpectedCloseDate(timeline) {
        const now = new Date();
        if (timeline === 'immediate') {
            now.setDate(now.getDate() + 7);
        } else if (timeline === '30days') {
            now.setDate(now.getDate() + 30);
        } else {
            now.setDate(now.getDate() + 60);
        }
        return now.toISOString().split('T')[0];
    }

    updateDeal(dealId, updates) {
        const deal = this.deals.find(d => d.id === dealId);
        if (!deal) return null;

        Object.assign(deal, updates, { updatedAt: new Date().toISOString() });

        // Update probability based on status
        const probabilities = {
            proposal: 30,
            negotiation: 60,
            contract: 80,
            won: 100,
            lost: 0
        };
        deal.probability = probabilities[deal.status] || deal.probability;

        // If won, update lead and track commission
        if (deal.status === 'won') {
            const lead = this.leads.find(l => l.id === deal.leadId);
            if (lead) {
                lead.status = 'won';
                saveJSON(leadsPath, this.leads);
            }

            // Process affiliate commission
            if (deal.affiliateId) {
                this.processAffiliateCommission(deal);
            }
        }

        saveJSON(dealsPath, this.deals);
        return deal;
    }

    getDeals(filters = {}) {
        let deals = [...this.deals];

        if (filters.status) {
            deals = deals.filter(d => d.status === filters.status);
        }

        deals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return deals;
    }

    // ============ AFFILIATE SYSTEM ============
    createAffiliate(data) {
        const affiliate = {
            id: uuidv4(),
            name: data.name,
            email: data.email,
            company: data.company || null,
            type: data.type || 'individual', // individual, agency, partner
            code: this.generateAffiliateCode(data.name),
            commissionRate: data.commissionRate || 20, // 20% default
            tier: data.tier || 'standard', // standard, gold, platinum
            status: 'active',
            paymentMethod: data.paymentMethod || 'paypal',
            paymentDetails: data.paymentDetails || null,
            stats: {
                clicks: 0,
                leads: 0,
                conversions: 0,
                revenue: 0,
                commission: 0,
                paid: 0
            },
            createdAt: new Date().toISOString()
        };

        // Commission tiers
        const tierRates = {
            standard: 20,
            gold: 25,
            platinum: 30
        };
        affiliate.commissionRate = tierRates[affiliate.tier] || 20;

        this.affiliates.push(affiliate);
        saveJSON(affiliatesPath, this.affiliates);

        return affiliate;
    }

    generateAffiliateCode(name) {
        const base = name.toLowerCase().replace(/[^a-z]/g, '').substring(0, 6);
        const random = Math.random().toString(36).substring(2, 6);
        return `${base}${random}`.toUpperCase();
    }

    getAffiliate(affiliateId) {
        return this.affiliates.find(a => a.id === affiliateId);
    }

    getAffiliateByCode(code) {
        return this.affiliates.find(a => a.code === code.toUpperCase());
    }

    trackAffiliateClick(code) {
        const affiliate = this.getAffiliateByCode(code);
        if (affiliate) {
            affiliate.stats.clicks++;
            saveJSON(affiliatesPath, this.affiliates);
        }
        return affiliate;
    }

    processAffiliateCommission(deal) {
        const affiliate = this.affiliates.find(a => a.id === deal.affiliateId);
        if (!affiliate) return;

        const commission = Math.round(deal.finalAmount * (affiliate.commissionRate / 100));

        affiliate.stats.conversions++;
        affiliate.stats.revenue += deal.finalAmount;
        affiliate.stats.commission += commission;

        saveJSON(affiliatesPath, this.affiliates);

        // Log referral payout
        this.referrals.push({
            id: uuidv4(),
            affiliateId: affiliate.id,
            dealId: deal.id,
            amount: deal.finalAmount,
            commission,
            status: 'pending', // pending, paid
            createdAt: new Date().toISOString()
        });
        saveJSON(referralsPath, this.referrals);

        return commission;
    }

    trackReferral(code, leadId) {
        const affiliate = this.getAffiliateByCode(code);
        if (affiliate) {
            affiliate.stats.leads++;
            saveJSON(affiliatesPath, this.affiliates);

            // Update lead with affiliate
            const lead = this.leads.find(l => l.id === leadId);
            if (lead) {
                lead.affiliateId = affiliate.id;
                saveJSON(leadsPath, this.leads);
            }
        }
    }

    getAffiliates() {
        return this.affiliates;
    }

    getAffiliateStats(affiliateId) {
        const affiliate = this.getAffiliate(affiliateId);
        if (!affiliate) return null;

        const pendingPayouts = this.referrals
            .filter(r => r.affiliateId === affiliateId && r.status === 'pending')
            .reduce((sum, r) => sum + r.commission, 0);

        return {
            ...affiliate.stats,
            pendingPayouts,
            conversionRate: affiliate.stats.clicks > 0
                ? ((affiliate.stats.conversions / affiliate.stats.clicks) * 100).toFixed(2)
                : 0
        };
    }

    // ============ SALES ANALYTICS ============
    getSalesAnalytics() {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

        const wonDeals = this.deals.filter(d => d.status === 'won');
        const recentWonDeals = wonDeals.filter(d => d.updatedAt >= fiveDaysAgo);
        const pipelineDeals = this.deals.filter(d => !['won', 'lost'].includes(d.status));

        const totalRevenue = wonDeals.reduce((sum, d) => sum + d.finalAmount, 0);
        const recentRevenue = recentWonDeals.reduce((sum, d) => sum + d.finalAmount, 0);
        const pipelineValue = pipelineDeals.reduce((sum, d) => sum + (d.finalAmount * d.probability / 100), 0);

        // Lead funnel
        const newLeads = this.leads.filter(l => l.status === 'new').length;
        const qualifiedLeads = this.leads.filter(l => l.status === 'qualified').length;
        const hotLeads = this.leads.filter(l => l.priority === 'hot').length;

        // Deals by stage
        const dealsByStage = {
            proposal: this.deals.filter(d => d.status === 'proposal').length,
            negotiation: this.deals.filter(d => d.status === 'negotiation').length,
            contract: this.deals.filter(d => d.status === 'contract').length,
            won: wonDeals.length,
            lost: this.deals.filter(d => d.status === 'lost').length
        };

        // Revenue by tier
        const revenueByTier = {};
        for (const deal of wonDeals) {
            revenueByTier[deal.tier] = (revenueByTier[deal.tier] || 0) + deal.finalAmount;
        }

        // Affiliate performance
        const affiliateRevenue = this.affiliates.reduce((sum, a) => sum + a.stats.revenue, 0);
        const affiliateCommissions = this.affiliates.reduce((sum, a) => sum + a.stats.commission, 0);

        return {
            revenue: {
                total: totalRevenue,
                last5Days: recentRevenue,
                pipeline: pipelineValue,
                target: 300000,
                progress: (totalRevenue / 300000) * 100
            },
            leads: {
                total: this.leads.length,
                new: newLeads,
                qualified: qualifiedLeads,
                hot: hotLeads
            },
            deals: {
                total: this.deals.length,
                byStage: dealsByStage,
                averageSize: wonDeals.length > 0 ? totalRevenue / wonDeals.length : 0,
                winRate: this.deals.length > 0
                    ? ((wonDeals.length / (wonDeals.length + dealsByStage.lost)) * 100).toFixed(1)
                    : 0
            },
            revenueByTier,
            affiliates: {
                total: this.affiliates.length,
                revenue: affiliateRevenue,
                commissions: affiliateCommissions
            }
        };
    }

    // Target tracking - supports both $300K (5 days) and $1M (7 days)
    getTargetProgress(targetMode = 'million') {
        const targets = {
            original: { amount: 300000, days: 5 },
            million: { amount: 1000000, days: 7 }
        };

        const { amount: target, days } = targets[targetMode] || targets.million;
        const dailyTarget = target / days;

        const wonDeals = this.deals.filter(d => d.status === 'won');
        const totalRevenue = wonDeals.reduce((sum, d) => sum + d.finalAmount, 0);
        const remaining = target - totalRevenue;

        // Revenue breakdown by type
        const lifetimeRevenue = wonDeals.filter(d => d.type === 'lifetime').reduce((sum, d) => sum + d.finalAmount, 0);
        const resellerRevenue = wonDeals.filter(d => d.type === 'reseller').reduce((sum, d) => sum + d.finalAmount, 0);
        const enterpriseRevenue = wonDeals.filter(d => !['lifetime', 'reseller'].includes(d.type)).reduce((sum, d) => sum + d.finalAmount, 0);

        // Spots status
        const lifetimeSpotsTotal = Object.values(LIFETIME_DEALS).reduce((sum, d) => sum + d.spotsTotal, 0);
        const lifetimeSpotsRemaining = Object.values(LIFETIME_DEALS).reduce((sum, d) => sum + d.spotsRemaining, 0);
        const founderSpotsRemaining = FOUNDER_SPOTS.remaining;

        // Required deals to hit target
        const avgDealSize = totalRevenue > 0 && wonDeals.length > 0
            ? totalRevenue / wonDeals.length
            : 25000; // Default estimate
        const dealsNeeded = Math.ceil(remaining / avgDealSize);

        return {
            targetMode,
            target,
            current: totalRevenue,
            remaining: Math.max(0, remaining),
            progress: ((totalRevenue / target) * 100).toFixed(1),
            progressPercent: Math.min(100, (totalRevenue / target) * 100),
            dailyTarget,
            dealsNeeded: Math.max(0, dealsNeeded),
            avgDealSize,
            onTrack: totalRevenue >= dailyTarget * this.getDayNumber(),
            breakdown: {
                lifetime: lifetimeRevenue,
                reseller: resellerRevenue,
                enterprise: enterpriseRevenue
            },
            spots: {
                lifetime: {
                    total: lifetimeSpotsTotal,
                    remaining: lifetimeSpotsRemaining,
                    sold: lifetimeSpotsTotal - lifetimeSpotsRemaining
                },
                founder: {
                    total: FOUNDER_SPOTS.total,
                    remaining: founderSpotsRemaining,
                    claimed: FOUNDER_SPOTS.total - founderSpotsRemaining
                }
            },
            milestones: [
                { amount: 100000, label: '$100K', reached: totalRevenue >= 100000 },
                { amount: 250000, label: '$250K', reached: totalRevenue >= 250000 },
                { amount: 500000, label: '$500K', reached: totalRevenue >= 500000 },
                { amount: 750000, label: '$750K', reached: totalRevenue >= 750000 },
                { amount: 1000000, label: '$1M', reached: totalRevenue >= 1000000 }
            ]
        };
    }

    getDayNumber() {
        // Assuming campaign started - return day 1 for now
        return 1;
    }

    // Get comprehensive $1M strategy status
    getMillionDollarStatus() {
        const progress = this.getTargetProgress('million');
        const analytics = this.getSalesAnalytics();

        return {
            ...progress,
            strategies: {
                lifetime: {
                    name: 'Lifetime Deals',
                    target: 400000, // $400K from lifetime deals
                    current: progress.breakdown.lifetime,
                    deals: LIFETIME_DEALS
                },
                reseller: {
                    name: 'Reseller/White-Label',
                    target: 250000, // $250K from resellers
                    current: progress.breakdown.reseller,
                    deals: RESELLER_TIERS
                },
                enterprise: {
                    name: 'Enterprise Deals',
                    target: 350000, // $350K from enterprise
                    current: progress.breakdown.enterprise,
                    deals: { ...ENTERPRISE_TIERS, ...MEGA_DEALS }
                }
            },
            referralProgram: REFERRAL_REWARDS,
            urgencyMetrics: {
                founderSpots: progress.spots.founder,
                lifetimeSpots: progress.spots.lifetime,
                daysRemaining: 7 - this.getDayNumber()
            },
            ...analytics
        };
    }
}

module.exports = new EnterpriseService();
module.exports.ENTERPRISE_TIERS = ENTERPRISE_TIERS;
module.exports.LIFETIME_DEALS = LIFETIME_DEALS;
module.exports.RESELLER_TIERS = RESELLER_TIERS;
module.exports.MEGA_DEALS = MEGA_DEALS;
module.exports.REFERRAL_REWARDS = REFERRAL_REWARDS;
module.exports.FOUNDER_SPOTS = FOUNDER_SPOTS;
