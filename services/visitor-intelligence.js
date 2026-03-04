/**
 * DOZ UP - Visitor Intelligence Service
 * World-first live ticket system with device fingerprint binding
 *
 * Features:
 * - Enhanced device fingerprinting (browser + canvas + WebGL)
 * - Visitor profile management bound to fingerprint
 * - Returning user detection in real-time
 * - Personalized greeting generation
 * - Journey stage tracking
 * - Comprehensive audit trail
 * - Conversion score calculation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'visitor-profiles.json');
const AUDIT_FILE = path.join(DATA_DIR, 'support-audit.json');

class VisitorIntelligenceService {
    constructor() {
        this.profiles = new Map();
        this.byUserId = new Map();
        this.auditLog = [];

        // Journey stages
        this.JOURNEY_STAGES = {
            NEW: 'new',              // First visit
            EXPLORING: 'exploring',   // 2-5 visits
            INTERESTED: 'interested', // Viewed pricing, download
            CONSIDERING: 'considering', // Multiple pricing views, high engagement
            CUSTOMER: 'customer'      // Made purchase
        };

        // Load existing data
        this.loadData();

        // Auto-save interval
        setInterval(() => this.saveData(), 60000); // Save every minute

        console.log(`[Visitor Intelligence] Initialized with ${this.profiles.size} profiles`);
    }

    loadData() {
        try {
            // Ensure data directory exists
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }

            // Load visitor profiles
            if (fs.existsSync(PROFILES_FILE)) {
                const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));

                // Load profiles
                if (data.profiles) {
                    for (const [fpId, profile] of Object.entries(data.profiles)) {
                        this.profiles.set(fpId, profile);
                    }
                }

                // Load user ID mappings
                if (data.byUserId) {
                    for (const [userId, fpIds] of Object.entries(data.byUserId)) {
                        this.byUserId.set(userId, new Set(fpIds));
                    }
                }
            }

            // Load audit log
            if (fs.existsSync(AUDIT_FILE)) {
                const auditData = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
                this.auditLog = auditData.entries || [];

                // Keep only last 30 days of audit entries
                const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                this.auditLog = this.auditLog.filter(e => new Date(e.timestamp).getTime() > thirtyDaysAgo);
            }
        } catch (error) {
            console.error('[Visitor Intelligence] Failed to load data:', error.message);
        }
    }

    saveData() {
        try {
            // Save profiles
            const profilesData = {
                profiles: Object.fromEntries(this.profiles),
                byUserId: {}
            };

            for (const [userId, fpIds] of this.byUserId.entries()) {
                profilesData.byUserId[userId] = Array.from(fpIds);
            }

            fs.writeFileSync(PROFILES_FILE, JSON.stringify(profilesData, null, 2));

            // Save audit log
            fs.writeFileSync(AUDIT_FILE, JSON.stringify({ entries: this.auditLog }, null, 2));

        } catch (error) {
            console.error('[Visitor Intelligence] Failed to save data:', error.message);
        }
    }

    /**
     * Generate a fingerprint ID from device information
     * @param {Object} deviceInfo - Device information from client
     * @returns {string} - Fingerprint ID
     */
    generateFingerprintId(deviceInfo) {
        const components = [
            deviceInfo.userAgent || '',
            deviceInfo.platform || '',
            deviceInfo.screen || '',
            deviceInfo.timezone || '',
            deviceInfo.language || '',
            deviceInfo.colorDepth || '',
            deviceInfo.hardwareConcurrency || '',
            deviceInfo.canvasHash || '',
            deviceInfo.webglHash || ''
        ].join('|');

        const hash = crypto.createHash('sha256').update(components).digest('hex');
        return 'fp_' + hash.substring(0, 24);
    }

    /**
     * Get or create a visitor profile
     * @param {string} fingerprintId - Fingerprint ID
     * @param {Object} deviceInfo - Device information
     * @returns {Object} - Visitor profile
     */
    getOrCreateProfile(fingerprintId, deviceInfo = {}, source = null) {
        let profile = this.profiles.get(fingerprintId);
        const now = new Date().toISOString();

        if (profile) {
            // Returning visitor - update last seen and increment visit count
            const lastSeen = new Date(profile.lastSeen);
            const daysSinceLastVisit = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

            profile.lastSeen = now;
            profile.visitCount++;
            profile.daysSinceLastVisit = Math.floor(daysSinceLastVisit);
            profile.isReturning = true;

            // Update source if provided (track latest source)
            if (source) {
                profile.latestSource = source;
                if (!profile.source) profile.source = source;
            }

            // Update journey stage based on behavior
            this.updateJourneyStage(profile);

            // Log return visit
            this.logEvent(fingerprintId, 'RETURN_VISIT', {
                visitCount: profile.visitCount,
                daysSinceLastVisit: profile.daysSinceLastVisit,
                source: source || profile.source
            });

        } else {
            // New visitor
            profile = {
                fingerprintId,
                createdAt: now,
                firstSeen: now,
                lastSeen: now,
                visitCount: 1,
                daysSinceLastVisit: 0,
                isReturning: false,
                source: source || 'direct',
                latestSource: source || 'direct',
                linkedUserId: null,
                email: null,
                name: null,
                journeyStage: this.JOURNEY_STAGES.NEW,
                conversionScore: 0,
                tags: [],
                deviceInfo: {
                    platform: deviceInfo.platform || 'Unknown',
                    browser: this.parseBrowser(deviceInfo.userAgent),
                    screen: deviceInfo.screen || 'Unknown',
                    timezone: deviceInfo.timezone || 'Unknown',
                    language: deviceInfo.language || 'en'
                },
                supportHistory: {
                    totalConversations: 0,
                    totalMessages: 0,
                    lastConversationId: null,
                    unresolvedIssues: [],
                    satisfactionAvg: null,
                    lastTopic: null,
                    topics: []
                },
                pageHistory: [],
                actionHistory: [],
                preferences: {}
            };

            this.profiles.set(fingerprintId, profile);

            // Log new visitor
            this.logEvent(fingerprintId, 'NEW_VISITOR', {
                deviceInfo: profile.deviceInfo
            });
        }

        // Recalculate conversion score
        profile.conversionScore = this.calculateConversionScore(profile);

        return profile;
    }

    /**
     * Detect if this is a returning visitor and get context
     * @param {string} fingerprintId - Fingerprint ID
     * @returns {Object} - Detection result with context
     */
    detectReturningVisitor(fingerprintId) {
        const profile = this.profiles.get(fingerprintId);

        if (!profile) {
            return {
                isReturning: false,
                isNew: true,
                profile: null
            };
        }

        return {
            isReturning: profile.visitCount > 1,
            isNew: false,
            visitCount: profile.visitCount,
            daysSinceLastVisit: profile.daysSinceLastVisit,
            journeyStage: profile.journeyStage,
            conversionScore: profile.conversionScore,
            hasUnresolvedIssues: profile.supportHistory.unresolvedIssues.length > 0,
            unresolvedIssues: profile.supportHistory.unresolvedIssues,
            lastTopic: profile.supportHistory.lastTopic,
            name: profile.name,
            email: profile.email,
            profile
        };
    }

    /**
     * Generate a personalized greeting for a visitor
     * @param {Object} profile - Visitor profile
     * @returns {string} - Personalized greeting message
     */
    generatePersonalizedGreeting(profile) {
        if (!profile) {
            return "Hi there! I'm Luna, your support assistant. How can I help you today?";
        }

        const name = profile.name ? `, ${profile.name}` : '';

        // Check for unresolved issues first (highest priority)
        if (profile.supportHistory.unresolvedIssues.length > 0) {
            const issue = profile.supportHistory.unresolvedIssues[0];
            return `Welcome back${name}! I noticed you previously asked about "${issue}". Would you like to continue that conversation, or is there something new I can help with?`;
        }

        // Long absence (winback)
        if (profile.daysSinceLastVisit > 30) {
            return `Welcome back${name}! It's great to see you again after a while. A lot has improved since your last visit - would you like to hear what's new?`;
        }

        // High conversion score on return
        if (profile.conversionScore >= 70 && profile.journeyStage === this.JOURNEY_STAGES.CONSIDERING) {
            return `Welcome back${name}! I noticed you've been exploring our plans. Ready to get started? I can help you choose the perfect plan or answer any final questions!`;
        }

        // Previous conversation topic
        if (profile.supportHistory.lastTopic) {
            return `Welcome back${name}! Last time we talked about ${profile.supportHistory.lastTopic}. Is there anything else I can help you with today?`;
        }

        // Generic returning visitor
        if (profile.visitCount > 1) {
            if (profile.visitCount >= 5) {
                return `Great to see you again${name}! You're becoming a regular. How can I help you today?`;
            }
            return `Welcome back${name}! How can I assist you today?`;
        }

        // New visitor
        return `Hi there${name}! I'm Luna, your support assistant. How can I help you today?`;
    }

    /**
     * Link a user ID to a fingerprint
     * @param {string} fingerprintId - Fingerprint ID
     * @param {string} userId - User ID
     * @param {string} email - User email
     * @param {string} name - User name
     */
    linkUserToFingerprint(fingerprintId, userId, email = null, name = null) {
        const profile = this.profiles.get(fingerprintId);
        if (!profile) return;

        profile.linkedUserId = userId;
        if (email) profile.email = email;
        if (name) profile.name = name;

        // Update user ID mapping
        if (!this.byUserId.has(userId)) {
            this.byUserId.set(userId, new Set());
        }
        this.byUserId.get(userId).add(fingerprintId);

        // Update journey stage to customer if they logged in
        if (profile.journeyStage !== this.JOURNEY_STAGES.CUSTOMER) {
            profile.journeyStage = this.JOURNEY_STAGES.INTERESTED;
        }

        this.logEvent(fingerprintId, 'USER_LINKED', { userId, email });
        this.saveData();
    }

    /**
     * Get all fingerprints for a user
     * @param {string} userId - User ID
     * @returns {Array} - Array of fingerprint IDs
     */
    getFingerprintsForUser(userId) {
        const fpIds = this.byUserId.get(userId);
        return fpIds ? Array.from(fpIds) : [];
    }

    /**
     * Record a page visit
     * @param {string} fingerprintId - Fingerprint ID
     * @param {string} pageUrl - Page URL
     * @param {number} duration - Time spent on page in seconds
     */
    recordPageVisit(fingerprintId, pageUrl, duration = 0) {
        const profile = this.profiles.get(fingerprintId);
        if (!profile) return;

        const visit = {
            url: pageUrl,
            timestamp: new Date().toISOString(),
            duration
        };

        profile.pageHistory.push(visit);

        // Keep only last 100 page visits
        if (profile.pageHistory.length > 100) {
            profile.pageHistory = profile.pageHistory.slice(-100);
        }

        // Update journey stage based on pages visited
        const pageLower = pageUrl.toLowerCase();
        if (pageLower.includes('pay') || pageLower.includes('pricing')) {
            if (profile.journeyStage === this.JOURNEY_STAGES.NEW) {
                profile.journeyStage = this.JOURNEY_STAGES.INTERESTED;
            }
            profile.tags = [...new Set([...profile.tags, 'pricing-interested'])];
        }
        if (pageLower.includes('download')) {
            profile.tags = [...new Set([...profile.tags, 'download-interested'])];
        }

        this.updateJourneyStage(profile);
    }

    /**
     * Record an action/event
     * @param {string} fingerprintId - Fingerprint ID
     * @param {string} actionType - Type of action
     * @param {Object} metadata - Additional data
     */
    recordAction(fingerprintId, actionType, metadata = {}) {
        const profile = this.profiles.get(fingerprintId);
        if (!profile) return;

        const action = {
            type: actionType,
            timestamp: new Date().toISOString(),
            metadata
        };

        profile.actionHistory.push(action);

        // Keep only last 100 actions
        if (profile.actionHistory.length > 100) {
            profile.actionHistory = profile.actionHistory.slice(-100);
        }

        // Update based on action type
        if (actionType === 'PURCHASE_COMPLETED') {
            profile.journeyStage = this.JOURNEY_STAGES.CUSTOMER;
            profile.tags = [...new Set([...profile.tags, 'customer'])];
        }
        if (actionType === 'DOWNLOAD_STARTED') {
            profile.tags = [...new Set([...profile.tags, 'downloaded'])];
        }

        this.logEvent(fingerprintId, 'ACTION', { actionType, ...metadata });
    }

    /**
     * Record a support conversation
     * @param {string} fingerprintId - Fingerprint ID
     * @param {string} conversationId - Conversation ID
     * @param {Object} summary - Conversation summary
     */
    recordConversation(fingerprintId, conversationId, summary = {}) {
        const profile = this.profiles.get(fingerprintId);
        if (!profile) return;

        profile.supportHistory.totalConversations++;
        profile.supportHistory.lastConversationId = conversationId;

        if (summary.topic) {
            profile.supportHistory.lastTopic = summary.topic;
            profile.supportHistory.topics.push(summary.topic);
            // Keep only last 20 topics
            if (profile.supportHistory.topics.length > 20) {
                profile.supportHistory.topics = profile.supportHistory.topics.slice(-20);
            }
        }

        if (summary.messageCount) {
            profile.supportHistory.totalMessages += summary.messageCount;
        }

        if (summary.rating) {
            const history = profile.supportHistory;
            if (history.satisfactionAvg === null) {
                history.satisfactionAvg = summary.rating;
            } else {
                // Running average
                history.satisfactionAvg = (history.satisfactionAvg * 0.7) + (summary.rating * 0.3);
            }
        }

        if (summary.resolved === false && summary.issue) {
            profile.supportHistory.unresolvedIssues.push(summary.issue);
        }

        this.logEvent(fingerprintId, 'CONVERSATION_RECORDED', { conversationId, ...summary });
    }

    /**
     * Mark an issue as resolved
     * @param {string} fingerprintId - Fingerprint ID
     * @param {string} issue - Issue description
     */
    resolveIssue(fingerprintId, issue) {
        const profile = this.profiles.get(fingerprintId);
        if (!profile) return;

        profile.supportHistory.unresolvedIssues =
            profile.supportHistory.unresolvedIssues.filter(i => i !== issue);

        this.logEvent(fingerprintId, 'ISSUE_RESOLVED', { issue });
    }

    /**
     * Update journey stage based on behavior
     * @param {Object} profile - Visitor profile
     */
    updateJourneyStage(profile) {
        if (profile.journeyStage === this.JOURNEY_STAGES.CUSTOMER) {
            return; // Don't downgrade customers
        }

        const pricingVisits = profile.pageHistory.filter(p =>
            p.url.toLowerCase().includes('pay') || p.url.toLowerCase().includes('pricing')
        ).length;

        const downloadVisits = profile.pageHistory.filter(p =>
            p.url.toLowerCase().includes('download')
        ).length;

        if (pricingVisits >= 3 || profile.conversionScore >= 70) {
            profile.journeyStage = this.JOURNEY_STAGES.CONSIDERING;
        } else if (pricingVisits >= 1 || downloadVisits >= 1) {
            profile.journeyStage = this.JOURNEY_STAGES.INTERESTED;
        } else if (profile.visitCount >= 2) {
            profile.journeyStage = this.JOURNEY_STAGES.EXPLORING;
        }
    }

    /**
     * Calculate conversion score (0-100)
     * @param {Object} profile - Visitor profile
     * @returns {number} - Conversion score
     */
    calculateConversionScore(profile) {
        let score = 0;

        // Visit frequency (max 20 points)
        score += Math.min(profile.visitCount * 4, 20);

        // Page engagement (max 30 points)
        const pricingVisits = profile.pageHistory.filter(p =>
            p.url.toLowerCase().includes('pay') || p.url.toLowerCase().includes('pricing')
        ).length;
        score += Math.min(pricingVisits * 10, 30);

        // Download interest (max 15 points)
        if (profile.tags.includes('downloaded')) score += 15;
        else if (profile.tags.includes('download-interested')) score += 7;

        // Account status (max 20 points)
        if (profile.linkedUserId) score += 10;
        if (profile.email) score += 10;

        // Support engagement (max 15 points)
        if (profile.supportHistory.totalConversations > 0) score += 5;
        if (profile.supportHistory.satisfactionAvg && profile.supportHistory.satisfactionAvg >= 4) score += 10;

        return Math.min(score, 100);
    }

    /**
     * Get visitor context for AI
     * @param {string} fingerprintId - Fingerprint ID
     * @returns {Object} - Context for AI system prompt
     */
    getVisitorContextForAI(fingerprintId) {
        const profile = this.profiles.get(fingerprintId);
        if (!profile) return null;

        return {
            isReturning: profile.visitCount > 1,
            visitCount: profile.visitCount,
            daysSinceLastVisit: profile.daysSinceLastVisit || 0,
            journeyStage: profile.journeyStage,
            conversionScore: profile.conversionScore,
            name: profile.name,
            previousTopics: profile.supportHistory.topics.slice(-5),
            unresolvedIssues: profile.supportHistory.unresolvedIssues,
            lastTopic: profile.supportHistory.lastTopic,
            totalConversations: profile.supportHistory.totalConversations,
            satisfactionAvg: profile.supportHistory.satisfactionAvg,
            tags: profile.tags
        };
    }

    /**
     * Log an event to the audit trail
     * @param {string} fingerprintId - Fingerprint ID
     * @param {string} eventType - Event type
     * @param {Object} eventData - Event data
     * @param {Object} metadata - Additional metadata
     */
    logEvent(fingerprintId, eventType, eventData = {}, metadata = {}) {
        const entry = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            fingerprintId,
            eventType,
            eventData,
            metadata
        };

        this.auditLog.push(entry);

        // Keep audit log manageable (max 10000 entries)
        if (this.auditLog.length > 10000) {
            this.auditLog = this.auditLog.slice(-10000);
        }
    }

    /**
     * Get audit trail for a fingerprint
     * @param {string} fingerprintId - Fingerprint ID
     * @param {Object} options - Filter options
     * @returns {Array} - Audit entries
     */
    getAuditTrail(fingerprintId, options = {}) {
        let entries = this.auditLog.filter(e => e.fingerprintId === fingerprintId);

        if (options.eventType) {
            entries = entries.filter(e => e.eventType === options.eventType);
        }

        if (options.limit) {
            entries = entries.slice(-options.limit);
        }

        return entries;
    }

    /**
     * Parse browser from user agent
     * @param {string} userAgent - User agent string
     * @returns {string} - Browser name
     */
    parseBrowser(userAgent) {
        if (!userAgent) return 'Unknown';

        if (userAgent.includes('Firefox')) return 'Firefox';
        if (userAgent.includes('Edg')) return 'Edge';
        if (userAgent.includes('Chrome')) return 'Chrome';
        if (userAgent.includes('Safari')) return 'Safari';
        if (userAgent.includes('Opera') || userAgent.includes('OPR')) return 'Opera';

        return 'Other';
    }

    /**
     * Get statistics for admin dashboard
     * @returns {Object} - Statistics
     */
    getStats() {
        const profiles = Array.from(this.profiles.values());
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

        return {
            totalProfiles: profiles.length,
            activeToday: profiles.filter(p => new Date(p.lastSeen).getTime() > oneDayAgo).length,
            activeWeek: profiles.filter(p => new Date(p.lastSeen).getTime() > sevenDaysAgo).length,
            returningUsers: profiles.filter(p => p.visitCount > 1).length,
            customers: profiles.filter(p => p.journeyStage === this.JOURNEY_STAGES.CUSTOMER).length,
            considering: profiles.filter(p => p.journeyStage === this.JOURNEY_STAGES.CONSIDERING).length,
            withUnresolvedIssues: profiles.filter(p => p.supportHistory.unresolvedIssues.length > 0).length,
            avgConversionScore: profiles.length > 0
                ? Math.round(profiles.reduce((sum, p) => sum + p.conversionScore, 0) / profiles.length)
                : 0,
            stageDistribution: profiles.reduce((acc, p) => {
                const stage = p.journeyStage || 'new';
                acc[stage] = (acc[stage] || 0) + 1;
                return acc;
            }, {}),
            recentProfiles: profiles
                .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
                .slice(0, 20)
                .map(p => ({
                    fingerprintId: p.fingerprintId,
                    source: p.source,
                    latestSource: p.latestSource,
                    journeyStage: p.journeyStage,
                    visitCount: p.visitCount,
                    conversionScore: p.conversionScore,
                    lastSeen: p.lastSeen
                }))
        };
    }
}

// Export singleton instance
const visitorIntelligence = new VisitorIntelligenceService();
module.exports = visitorIntelligence;
