/**
 * DOZ UP - Smart Support Trigger System
 * Detects when users need help and initiates proactive support
 *
 * Features:
 * - Multiple trigger types (idle, rage click, exit intent, etc.)
 * - Page-specific triggers
 * - Cooldown management
 * - Priority-based selection
 * - Behavior tracking
 */

const { v4: uuidv4 } = require('uuid');

class SupportTriggerService {
    constructor() {
        // Cooldown tracking: visitorId -> { lastTrigger, count }
        this.cooldowns = new Map();
        this.cooldownPeriod = 5 * 60 * 1000; // 5 minutes between triggers
        this.maxTriggersPerSession = 3; // Max triggers per session

        // Define all triggers
        this.triggers = this.defineTriggers();

        // Cleanup old cooldowns periodically
        setInterval(() => this.cleanup(), 60 * 1000);
    }

    defineTriggers() {
        return [
            // Idle/Engagement Triggers
            {
                id: 'idle_time',
                name: 'Idle on Page',
                description: 'User has been idle for too long',
                condition: (data) => data.timeOnPage > 120 && !data.hasInteracted && !data.hasScrolled,
                message: "Hi there! 👋 Need any help? I'm here if you have questions!",
                priority: 1,
                pages: ['*'],
                cooldownMinutes: 10
            },
            {
                id: 'deep_idle',
                name: 'Deep Idle',
                description: 'User has been completely idle for extended time',
                condition: (data) => data.timeOnPage > 300 && !data.hasInteracted,
                message: "Still there? Let me know if there's anything I can help you find! 😊",
                priority: 1,
                pages: ['*'],
                cooldownMinutes: 15
            },

            // Error/Problem Triggers
            {
                id: 'error_page',
                name: 'Error Page Visit',
                description: 'User landed on an error page',
                condition: (data) =>
                    data.pageUrl.includes('error') ||
                    data.pageUrl.includes('404') ||
                    data.httpStatus >= 400,
                message: "Oops! Looks like something went wrong. Can I help you find what you're looking for?",
                priority: 3,
                pages: ['*'],
                cooldownMinutes: 2
            },
            {
                id: 'rage_click',
                name: 'Rage Clicking',
                description: 'User clicking repeatedly in frustration',
                condition: (data) => data.clickCount > 5 && data.clickTimespan < 3000,
                message: "Having trouble with something? I'm here to help! 💪",
                priority: 3,
                pages: ['*'],
                cooldownMinutes: 5
            },
            {
                id: 'form_struggle',
                name: 'Form Filling Struggle',
                description: 'User having trouble with a form',
                condition: (data) => data.formErrors > 2 || (data.formTime > 120 && !data.formSubmitted),
                message: "Need help with the form? I can guide you through it!",
                priority: 2,
                pages: ['*'],
                cooldownMinutes: 5
            },

            // Exit Intent Triggers
            {
                id: 'exit_intent',
                name: 'Exit Intent',
                description: 'User about to leave the page',
                condition: (data) => data.exitIntent && data.timeOnPage > 10,
                message: "Before you go - is there anything I can help with?",
                priority: 2,
                pages: ['pay', 'pricing', 'checkout', 'download'],
                cooldownMinutes: 30
            },
            {
                id: 'tab_switch',
                name: 'Tab Switch Away',
                description: 'User switched to another tab for a while',
                condition: (data) => data.tabHidden && data.tabHiddenDuration > 30,
                message: "Welcome back! 👋 Let me know if you need any help.",
                priority: 1,
                pages: ['pay', 'checkout'],
                cooldownMinutes: 10
            },

            // Navigation Triggers
            {
                id: 'scroll_stuck',
                name: 'Stuck Scrolling',
                description: 'User scrolling up and down repeatedly',
                condition: (data) => data.scrollBounces > 3 && data.timeOnPage > 30,
                message: "Looking for something specific? I can point you in the right direction! 🔍",
                priority: 1,
                pages: ['*'],
                cooldownMinutes: 10
            },
            {
                id: 'repeated_visit',
                name: 'Repeated Page Visit',
                description: 'User keeps coming back to the same page',
                condition: (data) => data.pageVisitCount >= 3 && data.sessionPageViews > 5,
                message: "I noticed you've visited this page a few times. Can I help you find something?",
                priority: 1,
                pages: ['*'],
                cooldownMinutes: 30
            },

            // Sales/Conversion Triggers
            {
                id: 'pricing_hesitation',
                name: 'Pricing Page Hesitation',
                description: 'User spending time on pricing page',
                condition: (data) =>
                    (data.pageUrl.includes('pay') || data.pageUrl.includes('pricing')) &&
                    data.timeOnPage > 60,
                message: "Have questions about our plans? I'm happy to help you choose the right one! 💳",
                priority: 2,
                pages: ['pay', 'pricing'],
                cooldownMinutes: 15
            },
            {
                id: 'pricing_scroll',
                name: 'Pricing Plan Comparison',
                description: 'User scrolling through pricing plans',
                condition: (data) =>
                    data.pageUrl.includes('pay') &&
                    data.scrollDepth > 50 &&
                    data.timeOnPage > 30,
                message: "Comparing plans? I can explain the differences if you'd like! 😊",
                priority: 2,
                pages: ['pay', 'pricing'],
                cooldownMinutes: 15
            },
            {
                id: 'checkout_abandon',
                name: 'Checkout Abandonment',
                description: 'User started checkout but got stuck',
                condition: (data) =>
                    data.checkoutStarted &&
                    !data.checkoutCompleted &&
                    data.timeOnPage > 90,
                message: "Need help completing your purchase? I can assist with any questions! 🛒",
                priority: 3,
                pages: ['checkout', 'payment'],
                cooldownMinutes: 10
            },

            // Help/Support Triggers
            {
                id: 'help_search',
                name: 'Help Search Fail',
                description: 'User searched help but found no results',
                condition: (data) => data.searchQuery && data.searchResults === 0,
                message: "Couldn't find what you're looking for? I might be able to help! 🤔",
                priority: 2,
                pages: ['help', 'search', 'support'],
                cooldownMinutes: 5
            },
            {
                id: 'help_browse',
                name: 'Help Center Browsing',
                description: 'User browsing help articles',
                condition: (data) =>
                    data.pageUrl.includes('help') &&
                    data.articlesViewed > 2 &&
                    data.timeOnPage > 60,
                message: "Still looking for answers? I can help find what you need! 📚",
                priority: 1,
                pages: ['help', 'support', 'help-center'],
                cooldownMinutes: 15
            },

            // Download/Install Triggers
            {
                id: 'download_hesitation',
                name: 'Download Page Hesitation',
                description: 'User on download page but not downloading',
                condition: (data) =>
                    data.pageUrl.includes('download') &&
                    data.timeOnPage > 45 &&
                    !data.downloadStarted,
                message: "Ready to try DOZ UP? Let me know if you have any questions before downloading! 🚀",
                priority: 2,
                pages: ['download'],
                cooldownMinutes: 15
            },

            // Return Visitor Triggers
            {
                id: 'return_visitor',
                name: 'Return Visitor Welcome',
                description: 'Returning visitor to the site',
                condition: (data) =>
                    data.isReturningVisitor &&
                    data.daysSinceLastVisit > 7 &&
                    data.timeOnPage > 20,
                message: "Welcome back! Anything I can help you with today?",
                priority: 1,
                pages: ['*'],
                cooldownMinutes: 60
            },
            {
                id: 'returning_high_intent',
                name: 'Returning High Intent Visitor',
                description: 'Returning user with high conversion score on pricing page',
                condition: (data) =>
                    data.isReturningVisitor &&
                    data.visitCount >= 3 &&
                    data.conversionScore >= 70 &&
                    (data.pageUrl.includes('pay') || data.pageUrl.includes('pricing')),
                message: (data) => data.visitorName
                    ? `Welcome back, ${data.visitorName}! I noticed you've been exploring our plans. Ready to get started? I can help you choose the perfect plan!`
                    : "Welcome back! I noticed you've been exploring our plans. Ready to get started? I can help you choose the perfect plan or answer any final questions!",
                priority: 3,
                pages: ['pay', 'pricing'],
                cooldownMinutes: 60,
                offerType: 'CONVERSION_ASSIST'
            },
            {
                id: 'returning_unresolved',
                name: 'Returning with Unresolved Issue',
                description: 'User returning who has an unresolved support issue',
                condition: (data) =>
                    data.isReturningVisitor &&
                    data.unresolvedIssues &&
                    data.unresolvedIssues.length > 0 &&
                    data.timeOnPage > 15,
                message: (data) => {
                    const issue = data.unresolvedIssues[0];
                    return `Welcome back! I see you previously asked about "${issue}". Would you like to continue that conversation or is there something else I can help with?`;
                },
                priority: 3,
                pages: ['*'],
                cooldownMinutes: 30,
                offerType: 'ISSUE_FOLLOWUP'
            },
            {
                id: 'winback_visitor',
                name: 'Win-back Long Absent Visitor',
                description: 'Visitor returning after 30+ days',
                condition: (data) =>
                    data.isReturningVisitor &&
                    data.daysSinceLastVisit > 30 &&
                    data.timeOnPage > 20,
                message: "Welcome back! It's great to see you again after a while. A lot has improved since your last visit - want me to show you what's new?",
                priority: 2,
                pages: ['*'],
                cooldownMinutes: 120,
                offerType: 'WINBACK'
            },
            {
                id: 'special_offer_returning',
                name: 'Special Offer for Considering User',
                description: 'User in considering stage visiting pricing page multiple times',
                condition: (data) =>
                    data.isReturningVisitor &&
                    data.journeyStage === 'considering' &&
                    data.pricingPageVisits >= 3 &&
                    (data.pageUrl.includes('pay') || data.pageUrl.includes('pricing')),
                message: "I see you're seriously considering DOZ UP - that's awesome! Since you've taken the time to explore, I might be able to help with a special offer. Want to hear about it?",
                priority: 3,
                pages: ['pay', 'pricing'],
                cooldownMinutes: 1440, // 24 hours
                offerType: 'SPECIAL_DISCOUNT'
            },
            {
                id: 'loyal_visitor',
                name: 'Loyal Visitor Recognition',
                description: 'Very frequent visitor showing dedication',
                condition: (data) =>
                    data.isReturningVisitor &&
                    data.visitCount >= 10 &&
                    !data.isCustomer &&
                    data.timeOnPage > 30,
                message: "You're becoming a regular around here! I really appreciate your interest in DOZ UP. Is there anything holding you back from trying it out?",
                priority: 2,
                pages: ['*'],
                cooldownMinutes: 240,
                offerType: 'LOYALTY_RECOGNITION'
            }
        ];
    }

    /**
     * Evaluate triggers based on visitor behavior data
     * @param {Object} visitorData - Behavior data from the widget
     * @returns {Object|null} - Matched trigger or null
     */
    evaluateTriggers(visitorData) {
        const visitorId = visitorData.visitorId;
        const sessionId = visitorData.sessionId;

        // Check session trigger count
        const cooldownData = this.cooldowns.get(visitorId);
        if (cooldownData && cooldownData.sessionCount >= this.maxTriggersPerSession) {
            return null; // Max triggers reached for this session
        }

        // Check global cooldown
        if (cooldownData && Date.now() - cooldownData.lastTrigger < this.cooldownPeriod) {
            return null;
        }

        // Evaluate all triggers
        const matchedTriggers = [];

        for (const trigger of this.triggers) {
            try {
                // Check page restriction
                if (!this.matchesPage(trigger.pages, visitorData.pageUrl)) {
                    continue;
                }

                // Check trigger-specific cooldown
                const triggerKey = `${visitorId}:${trigger.id}`;
                const lastTriggered = this.cooldowns.get(triggerKey);
                if (lastTriggered && Date.now() - lastTriggered < (trigger.cooldownMinutes * 60 * 1000)) {
                    continue;
                }

                // Evaluate condition
                if (trigger.condition(visitorData)) {
                    matchedTriggers.push(trigger);
                }
            } catch (e) {
                console.error(`[Triggers] Error evaluating ${trigger.id}:`, e.message);
            }
        }

        if (matchedTriggers.length === 0) {
            return null;
        }

        // Select highest priority trigger
        const selectedTrigger = matchedTriggers.sort((a, b) => b.priority - a.priority)[0];

        // Update cooldowns
        const now = Date.now();
        this.cooldowns.set(visitorId, {
            lastTrigger: now,
            sessionCount: (cooldownData?.sessionCount || 0) + 1
        });
        this.cooldowns.set(`${visitorId}:${selectedTrigger.id}`, now);

        // Generate message - support both string and function messages
        let message = selectedTrigger.message;
        if (typeof message === 'function') {
            try {
                message = message(visitorData);
            } catch (e) {
                console.error(`[Triggers] Error generating message for ${selectedTrigger.id}:`, e.message);
                message = "Hi there! Can I help you with anything?";
            }
        }

        return {
            id: uuidv4(),
            triggerId: selectedTrigger.id,
            triggerName: selectedTrigger.name,
            description: selectedTrigger.description,
            message,
            priority: selectedTrigger.priority,
            offerType: selectedTrigger.offerType || null,
            timestamp: new Date().toISOString(),
            visitorData: {
                pageUrl: visitorData.pageUrl,
                timeOnPage: visitorData.timeOnPage,
                scrollDepth: visitorData.scrollDepth,
                isReturning: visitorData.isReturningVisitor || false,
                visitCount: visitorData.visitCount || 1,
                journeyStage: visitorData.journeyStage || 'new'
            }
        };
    }

    /**
     * Evaluate triggers with visitor profile data from visitor intelligence
     * @param {Object} visitorData - Behavior data from the widget
     * @param {Object} visitorProfile - Profile from visitor intelligence service
     * @returns {Object|null} - Matched trigger or null
     */
    evaluateTriggersWithProfile(visitorData, visitorProfile) {
        if (!visitorProfile) {
            return this.evaluateTriggers(visitorData);
        }

        // Enrich visitor data with profile information
        const enrichedData = {
            ...visitorData,
            isReturningVisitor: visitorProfile.visitCount > 1,
            visitCount: visitorProfile.visitCount,
            daysSinceLastVisit: visitorProfile.daysSinceLastVisit || 0,
            conversionScore: visitorProfile.conversionScore || 0,
            journeyStage: visitorProfile.journeyStage || 'new',
            unresolvedIssues: visitorProfile.supportHistory?.unresolvedIssues || [],
            visitorName: visitorProfile.name,
            isCustomer: visitorProfile.journeyStage === 'customer',
            pricingPageVisits: this.countPageVisits(visitorProfile.pageHistory || [], 'pay')
        };

        return this.evaluateTriggers(enrichedData);
    }

    /**
     * Count visits to pages matching a pattern
     */
    countPageVisits(pageHistory, pattern) {
        return pageHistory.filter(p =>
            p.url && p.url.toLowerCase().includes(pattern.toLowerCase())
        ).length;
    }

    /**
     * Check if current page matches trigger page restrictions
     */
    matchesPage(pagePatterns, currentUrl) {
        if (!currentUrl) return false;

        const urlLower = currentUrl.toLowerCase();

        for (const pattern of pagePatterns) {
            if (pattern === '*') return true;
            if (urlLower.includes(pattern.toLowerCase())) return true;
        }

        return false;
    }

    /**
     * Record trigger outcome (for analytics)
     */
    recordOutcome(triggerId, outcome) {
        // Outcomes: 'opened', 'dismissed', 'converted'
        // This can be extended to store in database for analytics
        console.log(`[Triggers] Trigger ${triggerId} outcome: ${outcome}`);
    }

    /**
     * Get trigger by ID
     */
    getTrigger(triggerId) {
        return this.triggers.find(t => t.id === triggerId);
    }

    /**
     * Get all active triggers
     */
    getAllTriggers() {
        return this.triggers.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            priority: t.priority,
            pages: t.pages
        }));
    }

    /**
     * Reset cooldown for a visitor (e.g., new session)
     */
    resetCooldown(visitorId) {
        // Remove all cooldowns for this visitor
        for (const key of this.cooldowns.keys()) {
            if (key.startsWith(visitorId)) {
                this.cooldowns.delete(key);
            }
        }
    }

    /**
     * Clean up old cooldown entries
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes

        for (const [key, value] of this.cooldowns.entries()) {
            const timestamp = typeof value === 'number' ? value : value.lastTrigger;
            if (now - timestamp > maxAge) {
                this.cooldowns.delete(key);
            }
        }
    }

    /**
     * Get statistics about triggers
     */
    getStats() {
        return {
            totalTriggers: this.triggers.length,
            activeCooldowns: this.cooldowns.size,
            triggers: this.triggers.map(t => ({
                id: t.id,
                name: t.name,
                priority: t.priority
            }))
        };
    }
}

// Export singleton instance
const supportTriggerService = new SupportTriggerService();
module.exports = supportTriggerService;
