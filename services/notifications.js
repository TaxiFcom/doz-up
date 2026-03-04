/**
 * DOZ UP - Real-time Notification Service
 * Push notifications to connected admin clients
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const notificationsPath = path.join(dataDir, 'notifications.json');

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

// Notification types
const NOTIFICATION_TYPES = {
    // Sales
    NEW_LEAD: { icon: 'user-plus', color: '#4CAF50', sound: true },
    HOT_LEAD: { icon: 'fire', color: '#ff5722', sound: true },
    DEAL_WON: { icon: 'trophy', color: '#FFD700', sound: true },
    DEAL_LOST: { icon: 'x-circle', color: '#f44336', sound: false },

    // Demos
    DEMO_SCHEDULED: { icon: 'calendar', color: '#2196F3', sound: true },
    DEMO_STARTING: { icon: 'clock', color: '#ff9800', sound: true },
    DEMO_COMPLETED: { icon: 'check-circle', color: '#4CAF50', sound: false },

    // Proposals
    PROPOSAL_VIEWED: { icon: 'eye', color: '#9C27B0', sound: true },
    PROPOSAL_ACCEPTED: { icon: 'check-circle', color: '#4CAF50', sound: true },
    PROPOSAL_EXPIRED: { icon: 'alert-circle', color: '#ff9800', sound: false },

    // Payments
    PAYMENT_RECEIVED: { icon: 'dollar-sign', color: '#4CAF50', sound: true },
    PAYMENT_FAILED: { icon: 'alert-triangle', color: '#f44336', sound: true },

    // System
    BACKUP_COMPLETE: { icon: 'database', color: '#607D8B', sound: false },
    SYSTEM_ALERT: { icon: 'alert-circle', color: '#f44336', sound: true },
    MILESTONE_REACHED: { icon: 'star', color: '#FFD700', sound: true },

    // AI Support
    SUPPORT_NEW_CONVERSATION: { icon: 'message-circle', color: '#00d4ff', sound: true },
    SUPPORT_ESCALATION: { icon: 'alert-triangle', color: '#f97316', sound: true },
    SUPPORT_NEW_TICKET: { icon: 'ticket', color: '#7b2ff7', sound: true },
    SUPPORT_URGENT: { icon: 'zap', color: '#ef4444', sound: true },
    SUPPORT_RATING: { icon: 'star', color: '#eab308', sound: false },
    SUPPORT_RESOLVED: { icon: 'check-circle', color: '#10b981', sound: false }
};

class NotificationService {
    constructor() {
        this.notifications = loadJSON(notificationsPath, []);
        this.subscribers = new Map(); // userId -> [callback]

        // Cleanup old notifications
        this.cleanup();
        setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }

    // Create and broadcast notification
    create(data) {
        const typeConfig = NOTIFICATION_TYPES[data.type] || {
            icon: 'bell',
            color: '#666',
            sound: false
        };

        const notification = {
            id: uuidv4(),
            type: data.type,
            title: data.title,
            message: data.message,
            icon: typeConfig.icon,
            color: typeConfig.color,
            sound: typeConfig.sound,
            link: data.link || null,
            entityType: data.entityType || null,
            entityId: data.entityId || null,
            priority: data.priority || 'normal', // low, normal, high, urgent
            targetUsers: data.targetUsers || null, // null = all, or array of userIds
            read: false,
            readBy: [],
            createdAt: new Date().toISOString()
        };

        this.notifications.unshift(notification);

        // Keep max 500 notifications
        if (this.notifications.length > 500) {
            this.notifications = this.notifications.slice(0, 500);
        }

        saveJSON(notificationsPath, this.notifications);

        // Broadcast to subscribers
        this.broadcast(notification);

        return notification;
    }

    // Convenience methods for common notifications
    notifyNewLead(lead) {
        return this.create({
            type: 'NEW_LEAD',
            title: 'New Lead!',
            message: `${lead.name} from ${lead.company} just submitted a lead form`,
            entityType: 'lead',
            entityId: lead.id,
            link: `/v2/admin/leads/${lead.id}`,
            priority: lead.priority === 'hot' ? 'high' : 'normal'
        });
    }

    notifyHotLead(lead) {
        return this.create({
            type: 'HOT_LEAD',
            title: 'Hot Lead Alert!',
            message: `${lead.company} - Score: ${lead.score}/100 - ${lead.name} (${lead.title})`,
            entityType: 'lead',
            entityId: lead.id,
            link: `/v2/admin/leads/${lead.id}`,
            priority: 'urgent'
        });
    }

    notifyDealWon(deal) {
        const amount = (deal.finalAmount / 100).toLocaleString();
        return this.create({
            type: 'DEAL_WON',
            title: 'Deal Won!',
            message: `${deal.company} - $${amount} - ${deal.tierName}`,
            entityType: 'deal',
            entityId: deal.id,
            link: `/v2/admin/deals/${deal.id}`,
            priority: 'high'
        });
    }

    notifyDealLost(deal) {
        return this.create({
            type: 'DEAL_LOST',
            title: 'Deal Lost',
            message: `${deal.company} - ${deal.tierName} - ${deal.lostReason || 'No reason given'}`,
            entityType: 'deal',
            entityId: deal.id,
            priority: 'normal'
        });
    }

    notifyDemoScheduled(demo) {
        return this.create({
            type: 'DEMO_SCHEDULED',
            title: 'Demo Scheduled',
            message: `${demo.company} - ${demo.date} at ${demo.time}`,
            entityType: 'demo',
            entityId: demo.id,
            link: `/v2/admin/demos/${demo.id}`,
            priority: 'normal'
        });
    }

    notifyDemoStartingSoon(demo) {
        return this.create({
            type: 'DEMO_STARTING',
            title: 'Demo Starting in 15 min',
            message: `${demo.company} - ${demo.contactName} - ${demo.meetingLink}`,
            entityType: 'demo',
            entityId: demo.id,
            link: demo.meetingLink,
            priority: 'urgent'
        });
    }

    notifyProposalViewed(proposal) {
        return this.create({
            type: 'PROPOSAL_VIEWED',
            title: 'Proposal Viewed!',
            message: `${proposal.company} is viewing proposal #${proposal.proposalNumber}`,
            entityType: 'proposal',
            entityId: proposal.id,
            link: `/v2/admin/proposals/${proposal.id}`,
            priority: 'high'
        });
    }

    notifyProposalAccepted(proposal) {
        const amount = (proposal.finalPrice / 100).toLocaleString();
        return this.create({
            type: 'PROPOSAL_ACCEPTED',
            title: 'Proposal Accepted!',
            message: `${proposal.company} accepted - $${amount}/year`,
            entityType: 'proposal',
            entityId: proposal.id,
            link: `/v2/admin/proposals/${proposal.id}`,
            priority: 'urgent'
        });
    }

    notifyPaymentReceived(payment) {
        const amount = (payment.amount / 100).toLocaleString();
        return this.create({
            type: 'PAYMENT_RECEIVED',
            title: 'Payment Received',
            message: `$${amount} from ${payment.email || 'customer'}`,
            entityType: 'payment',
            entityId: payment.id,
            priority: 'normal'
        });
    }

    notifyMilestone(milestone, current) {
        return this.create({
            type: 'MILESTONE_REACHED',
            title: 'Milestone Reached!',
            message: milestone,
            priority: 'high'
        });
    }

    // AI Support notifications
    notifySupportNewConversation(conversation) {
        return this.create({
            type: 'SUPPORT_NEW_CONVERSATION',
            title: 'New Support Chat',
            message: `Visitor on ${conversation.pageUrl || 'site'} started a conversation`,
            entityType: 'support_conversation',
            entityId: conversation.id,
            link: `/admin/support-inbox.html?conv=${conversation.id}`,
            priority: 'normal'
        });
    }

    notifySupportEscalation(conversation) {
        return this.create({
            type: 'SUPPORT_ESCALATION',
            title: 'Support Escalation!',
            message: `Visitor requested human support - ${conversation.pageUrl || 'Unknown page'}`,
            entityType: 'support_conversation',
            entityId: conversation.id,
            link: `/admin/support-inbox.html?conv=${conversation.id}`,
            priority: 'high'
        });
    }

    notifySupportNewTicket(ticket) {
        return this.create({
            type: 'SUPPORT_NEW_TICKET',
            title: 'New Support Ticket',
            message: `${ticket.ticketNumber}: ${ticket.subject}`,
            entityType: 'support_ticket',
            entityId: ticket.id,
            link: `/admin/support-inbox.html?ticket=${ticket.id}`,
            priority: ticket.priority === 'URGENT' ? 'urgent' : 'normal'
        });
    }

    notifySupportUrgent(conversation, reason) {
        return this.create({
            type: 'SUPPORT_URGENT',
            title: 'Urgent Support Needed',
            message: reason || `Visitor needs immediate assistance`,
            entityType: 'support_conversation',
            entityId: conversation.id,
            link: `/admin/support-inbox.html?conv=${conversation.id}`,
            priority: 'urgent'
        });
    }

    notifySupportRating(conversation, rating) {
        return this.create({
            type: 'SUPPORT_RATING',
            title: 'Support Rating Received',
            message: `Customer rated support ${rating}/5 stars`,
            entityType: 'support_conversation',
            entityId: conversation.id,
            link: `/admin/support-inbox.html?conv=${conversation.id}`,
            priority: rating <= 2 ? 'high' : 'normal'
        });
    }

    notifySupportResolved(conversation) {
        return this.create({
            type: 'SUPPORT_RESOLVED',
            title: 'Support Resolved',
            message: `Conversation resolved ${conversation.aiHandled ? 'by AI' : 'by agent'}`,
            entityType: 'support_conversation',
            entityId: conversation.id,
            priority: 'low'
        });
    }

    // Subscribe to notifications
    subscribe(userId, callback) {
        if (!this.subscribers.has(userId)) {
            this.subscribers.set(userId, []);
        }
        this.subscribers.get(userId).push(callback);

        // Return unsubscribe function
        return () => {
            const callbacks = this.subscribers.get(userId) || [];
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        };
    }

    // Broadcast notification to subscribers
    broadcast(notification) {
        const targets = notification.targetUsers || Array.from(this.subscribers.keys());

        for (const userId of targets) {
            const callbacks = this.subscribers.get(userId) || [];
            for (const callback of callbacks) {
                try {
                    callback(notification);
                } catch (e) {
                    console.error('[Notifications] Broadcast error:', e);
                }
            }
        }
    }

    // Get notifications for user
    getNotifications(userId, filters = {}) {
        let notifications = this.notifications.filter(n =>
            !n.targetUsers || n.targetUsers.includes(userId)
        );

        if (filters.unreadOnly) {
            notifications = notifications.filter(n => !n.readBy.includes(userId));
        }
        if (filters.type) {
            notifications = notifications.filter(n => n.type === filters.type);
        }
        if (filters.priority) {
            notifications = notifications.filter(n => n.priority === filters.priority);
        }

        const offset = filters.offset || 0;
        const limit = filters.limit || 50;

        return {
            notifications: notifications.slice(offset, offset + limit),
            total: notifications.length,
            unread: notifications.filter(n => !n.readBy.includes(userId)).length
        };
    }

    // Mark notification as read
    markRead(notificationId, userId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (!notification) return false;

        if (!notification.readBy.includes(userId)) {
            notification.readBy.push(userId);
            saveJSON(notificationsPath, this.notifications);
        }

        return true;
    }

    // Mark all as read
    markAllRead(userId) {
        let count = 0;
        for (const notification of this.notifications) {
            if (!notification.targetUsers || notification.targetUsers.includes(userId)) {
                if (!notification.readBy.includes(userId)) {
                    notification.readBy.push(userId);
                    count++;
                }
            }
        }

        if (count > 0) {
            saveJSON(notificationsPath, this.notifications);
        }

        return count;
    }

    // Get unread count
    getUnreadCount(userId) {
        return this.notifications.filter(n =>
            (!n.targetUsers || n.targetUsers.includes(userId)) &&
            !n.readBy.includes(userId)
        ).length;
    }

    // Delete notification
    delete(notificationId) {
        const index = this.notifications.findIndex(n => n.id === notificationId);
        if (index === -1) return false;

        this.notifications.splice(index, 1);
        saveJSON(notificationsPath, this.notifications);
        return true;
    }

    // Cleanup old notifications (older than 7 days)
    cleanup() {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const before = this.notifications.length;

        this.notifications = this.notifications.filter(n =>
            new Date(n.createdAt) >= sevenDaysAgo
        );

        if (this.notifications.length < before) {
            saveJSON(notificationsPath, this.notifications);
            console.log(`[Notifications] Cleaned ${before - this.notifications.length} old notifications`);
        }
    }

    // Get notification types
    getTypes() {
        return NOTIFICATION_TYPES;
    }
}

module.exports = new NotificationService();
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
