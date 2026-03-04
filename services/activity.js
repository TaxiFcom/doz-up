/**
 * DOZ UP - Activity Logging & Audit Trail
 * Track all important system activities
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const activityPath = path.join(dataDir, 'activity.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

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

// Activity types
const ACTIVITY_TYPES = {
    // Lead activities
    LEAD_CREATED: { category: 'leads', action: 'created', description: 'New lead captured' },
    LEAD_UPDATED: { category: 'leads', action: 'updated', description: 'Lead information updated' },
    LEAD_QUALIFIED: { category: 'leads', action: 'qualified', description: 'Lead marked as qualified' },
    LEAD_CONTACTED: { category: 'leads', action: 'contacted', description: 'Lead contacted' },

    // Deal activities
    DEAL_CREATED: { category: 'deals', action: 'created', description: 'New deal created' },
    DEAL_UPDATED: { category: 'deals', action: 'updated', description: 'Deal updated' },
    DEAL_WON: { category: 'deals', action: 'won', description: 'Deal marked as won' },
    DEAL_LOST: { category: 'deals', action: 'lost', description: 'Deal marked as lost' },
    DEAL_STAGE_CHANGED: { category: 'deals', action: 'stage_changed', description: 'Deal stage changed' },

    // Proposal activities
    PROPOSAL_CREATED: { category: 'proposals', action: 'created', description: 'Proposal created' },
    PROPOSAL_SENT: { category: 'proposals', action: 'sent', description: 'Proposal sent to client' },
    PROPOSAL_VIEWED: { category: 'proposals', action: 'viewed', description: 'Proposal viewed by client' },
    PROPOSAL_ACCEPTED: { category: 'proposals', action: 'accepted', description: 'Proposal accepted' },
    PROPOSAL_DECLINED: { category: 'proposals', action: 'declined', description: 'Proposal declined' },

    // Demo activities
    DEMO_SCHEDULED: { category: 'demos', action: 'scheduled', description: 'Demo scheduled' },
    DEMO_COMPLETED: { category: 'demos', action: 'completed', description: 'Demo completed' },
    DEMO_CANCELLED: { category: 'demos', action: 'cancelled', description: 'Demo cancelled' },
    DEMO_RESCHEDULED: { category: 'demos', action: 'rescheduled', description: 'Demo rescheduled' },
    DEMO_NO_SHOW: { category: 'demos', action: 'no_show', description: 'Client no-show for demo' },

    // User activities
    USER_REGISTERED: { category: 'users', action: 'registered', description: 'New user registered' },
    USER_SUBSCRIBED: { category: 'users', action: 'subscribed', description: 'User subscribed to plan' },
    USER_UPGRADED: { category: 'users', action: 'upgraded', description: 'User upgraded plan' },
    USER_CANCELLED: { category: 'users', action: 'cancelled', description: 'User cancelled subscription' },

    // Payment activities
    PAYMENT_RECEIVED: { category: 'payments', action: 'received', description: 'Payment received' },
    PAYMENT_FAILED: { category: 'payments', action: 'failed', description: 'Payment failed' },
    REFUND_ISSUED: { category: 'payments', action: 'refunded', description: 'Refund issued' },

    // Affiliate activities
    AFFILIATE_CREATED: { category: 'affiliates', action: 'created', description: 'New affiliate registered' },
    AFFILIATE_REFERRAL: { category: 'affiliates', action: 'referral', description: 'Affiliate referral tracked' },
    AFFILIATE_CONVERSION: { category: 'affiliates', action: 'conversion', description: 'Affiliate conversion' },
    AFFILIATE_PAYOUT: { category: 'affiliates', action: 'payout', description: 'Affiliate payout processed' },

    // System activities
    SYSTEM_BACKUP: { category: 'system', action: 'backup', description: 'System backup created' },
    SYSTEM_ERROR: { category: 'system', action: 'error', description: 'System error occurred' },
    ADMIN_LOGIN: { category: 'admin', action: 'login', description: 'Admin logged in' },
    ADMIN_ACTION: { category: 'admin', action: 'action', description: 'Admin performed action' }
};

class ActivityService {
    constructor() {
        this.activities = loadJSON(activityPath, []);
        this.realtimeListeners = [];

        // Keep only last 30 days of activities
        this.cleanupOldActivities();
        setInterval(() => this.cleanupOldActivities(), 24 * 60 * 60 * 1000);
    }

    // Log an activity
    log(type, data = {}) {
        const typeInfo = ACTIVITY_TYPES[type] || {
            category: 'other',
            action: type.toLowerCase(),
            description: type
        };

        const activity = {
            id: uuidv4(),
            type,
            category: typeInfo.category,
            action: typeInfo.action,
            description: data.description || typeInfo.description,
            entityType: data.entityType || null, // lead, deal, proposal, etc.
            entityId: data.entityId || null,
            entityName: data.entityName || null,
            userId: data.userId || null,
            userName: data.userName || null,
            metadata: data.metadata || {},
            ip: data.ip || null,
            timestamp: new Date().toISOString()
        };

        this.activities.unshift(activity);

        // Keep max 10000 activities in memory
        if (this.activities.length > 10000) {
            this.activities = this.activities.slice(0, 10000);
        }

        saveJSON(activityPath, this.activities);

        // Notify realtime listeners
        this.notifyListeners(activity);

        return activity;
    }

    // Get activities with filters
    getActivities(filters = {}) {
        let activities = [...this.activities];

        if (filters.category) {
            activities = activities.filter(a => a.category === filters.category);
        }
        if (filters.action) {
            activities = activities.filter(a => a.action === filters.action);
        }
        if (filters.type) {
            activities = activities.filter(a => a.type === filters.type);
        }
        if (filters.entityType) {
            activities = activities.filter(a => a.entityType === filters.entityType);
        }
        if (filters.entityId) {
            activities = activities.filter(a => a.entityId === filters.entityId);
        }
        if (filters.userId) {
            activities = activities.filter(a => a.userId === filters.userId);
        }
        if (filters.from) {
            activities = activities.filter(a => new Date(a.timestamp) >= new Date(filters.from));
        }
        if (filters.to) {
            activities = activities.filter(a => new Date(a.timestamp) <= new Date(filters.to));
        }

        // Pagination
        const offset = filters.offset || 0;
        const limit = filters.limit || 50;

        return {
            activities: activities.slice(offset, offset + limit),
            total: activities.length,
            offset,
            limit
        };
    }

    // Get recent activities for dashboard
    getRecent(limit = 20) {
        return this.activities.slice(0, limit);
    }

    // Get activity stats
    getStats(days = 7) {
        const now = new Date();
        const startDate = new Date(now - days * 24 * 60 * 60 * 1000);

        const recentActivities = this.activities.filter(a =>
            new Date(a.timestamp) >= startDate
        );

        // Count by category
        const byCategory = {};
        for (const activity of recentActivities) {
            byCategory[activity.category] = (byCategory[activity.category] || 0) + 1;
        }

        // Count by day
        const byDay = {};
        for (const activity of recentActivities) {
            const day = activity.timestamp.split('T')[0];
            byDay[day] = (byDay[day] || 0) + 1;
        }

        // Top actions
        const byAction = {};
        for (const activity of recentActivities) {
            const key = `${activity.category}:${activity.action}`;
            byAction[key] = (byAction[key] || 0) + 1;
        }

        const topActions = Object.entries(byAction)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([action, count]) => ({ action, count }));

        return {
            total: recentActivities.length,
            byCategory,
            byDay,
            topActions,
            period: { from: startDate.toISOString(), to: now.toISOString() }
        };
    }

    // Get entity timeline
    getEntityTimeline(entityType, entityId) {
        return this.activities.filter(a =>
            a.entityType === entityType && a.entityId === entityId
        );
    }

    // Realtime notifications
    addListener(callback) {
        this.realtimeListeners.push(callback);
        return () => {
            this.realtimeListeners = this.realtimeListeners.filter(l => l !== callback);
        };
    }

    notifyListeners(activity) {
        for (const listener of this.realtimeListeners) {
            try {
                listener(activity);
            } catch (e) {
                console.error('[Activity] Listener error:', e);
            }
        }
    }

    // Cleanup old activities
    cleanupOldActivities() {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const before = this.activities.length;

        this.activities = this.activities.filter(a =>
            new Date(a.timestamp) >= thirtyDaysAgo
        );

        if (this.activities.length < before) {
            saveJSON(activityPath, this.activities);
            console.log(`[Activity] Cleaned ${before - this.activities.length} old activities`);
        }
    }

    // Export activities
    exportActivities(filters = {}, format = 'json') {
        const { activities } = this.getActivities({ ...filters, limit: 100000 });

        if (format === 'csv') {
            const headers = ['Timestamp', 'Type', 'Category', 'Action', 'Description', 'Entity', 'User'];
            const rows = activities.map(a => [
                a.timestamp,
                a.type,
                a.category,
                a.action,
                a.description,
                a.entityName || a.entityId || '',
                a.userName || a.userId || ''
            ]);

            return [headers, ...rows].map(row => row.join(',')).join('\n');
        }

        return JSON.stringify(activities, null, 2);
    }

    // Get available activity types
    getActivityTypes() {
        return ACTIVITY_TYPES;
    }
}

module.exports = new ActivityService();
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
