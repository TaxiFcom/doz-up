/**
 * DOZ UP - AI Conversion Engine
 * Central orchestrator that ties visitor intelligence, support triggers,
 * and behavioral data into actionable conversion optimization.
 *
 * Responsibilities:
 * - Real-time conversion scoring and stage progression
 * - Exit-intent intervention selection
 * - Smart nudge generation based on visitor context
 * - Conversion funnel analysis and leak detection
 * - A/B test variant assignment
 */

const path = require('path');
const fs = require('fs');

class AIConversionEngine {
    constructor() {
        this.dataDir = path.join(__dirname, '..', 'data');
        this.conversionDataFile = path.join(this.dataDir, 'conversion-engine.json');

        // Conversion funnel stages
        this.funnelStages = ['landing', 'exploring', 'interested', 'considering', 'checkout', 'customer'];

        // Nudge templates by page type and visitor stage
        this.nudgeTemplates = {
            pricing: {
                new: {
                    message: 'Start with our free plan — no credit card required!',
                    cta: 'Get Started Free',
                    ctaUrl: '/checkout.html?plan=free',
                    type: 'info'
                },
                exploring: {
                    message: 'Most users choose the Starter plan. Try it risk-free!',
                    cta: 'See Plans',
                    ctaUrl: '/pay.html',
                    type: 'social-proof'
                },
                interested: {
                    message: '🔥 Limited offer: Get 50% off your first month!',
                    cta: 'Claim Offer',
                    ctaUrl: '/checkout.html?plan=starter_monthly&coupon=WELCOME50',
                    type: 'urgency'
                },
                considering: {
                    message: 'Still deciding? Try our 7-day free trial with full features.',
                    cta: 'Start Free Trial',
                    ctaUrl: '/checkout.html?plan=starter_monthly',
                    type: 'reassurance'
                }
            },
            checkout: {
                new: {
                    message: '🔒 Secure checkout powered by Stripe. Cancel anytime.',
                    type: 'trust'
                },
                considering: {
                    message: '✅ Join 10,000+ users who trust DOZ UP for their images.',
                    type: 'social-proof'
                }
            },
            gallery: {
                new: {
                    message: 'Love what you see? Upload your own images for free!',
                    cta: 'Upload Now',
                    ctaUrl: '/upload.html',
                    type: 'engagement'
                },
                exploring: {
                    message: 'Pro tip: Annotate and enhance your images with our Studio tools.',
                    cta: 'Try Studio',
                    ctaUrl: '/studio.html',
                    type: 'feature-discovery'
                }
            },
            upload: {
                new: {
                    message: 'Your first upload is always free — no account needed!',
                    type: 'encouragement'
                }
            },
            landing: {
                new: {
                    message: 'Welcome to DOZ UP! Upload, share, and enhance your images.',
                    cta: 'Get Started',
                    ctaUrl: '/upload.html',
                    type: 'welcome'
                },
                exploring: {
                    message: 'Ready to take your images to the next level?',
                    cta: 'See Features',
                    ctaUrl: '/features.html',
                    type: 'feature-discovery'
                }
            }
        };

        // Exit intent interventions by page context
        this.exitInterventions = {
            pricing: [
                {
                    type: 'discount',
                    title: 'Wait! Here\'s a special offer',
                    message: 'Get 50% off your first month. This offer expires when you leave.',
                    cta: 'Claim 50% Off',
                    ctaUrl: '/checkout.html?plan=starter_monthly&coupon=WELCOME50',
                    priority: 3
                },
                {
                    type: 'free-trial',
                    title: 'Not ready to commit?',
                    message: 'Try DOZ UP free for 7 days. No credit card required.',
                    cta: 'Start Free Trial',
                    ctaUrl: '/checkout.html?plan=free',
                    priority: 2
                }
            ],
            checkout: [
                {
                    type: 'reassurance',
                    title: 'Your purchase is protected',
                    message: '30-day money-back guarantee. Cancel anytime, no questions asked.',
                    cta: 'Complete Purchase',
                    priority: 3
                },
                {
                    type: 'discount',
                    title: 'Complete your order with 20% off!',
                    message: 'Use code DOZCOM at checkout for a special discount.',
                    cta: 'Apply Discount',
                    priority: 2
                }
            ],
            general: [
                {
                    type: 'engagement',
                    title: 'Before you go...',
                    message: 'Have a question? Our AI assistant Luna can help you instantly.',
                    cta: 'Chat with Luna',
                    action: 'open-support',
                    priority: 1
                }
            ]
        };

        // Stats tracking
        this.stats = {
            nudgesShown: 0,
            nudgesClicked: 0,
            exitIntentsDetected: 0,
            exitInterventionsShown: 0,
            exitInterventionsSaved: 0,
            conversions: 0
        };

        // Load persistent data
        this.loadData();

        // Save stats periodically
        setInterval(() => this.saveData(), 5 * 60 * 1000);
    }

    /**
     * Get a smart nudge for a specific page and visitor
     */
    getNudge(pageUrl, visitorProfile) {
        const pageType = this.classifyPage(pageUrl);
        const stage = visitorProfile?.journeyStage || 'new';

        // Get templates for this page type
        const pageNudges = this.nudgeTemplates[pageType];
        if (!pageNudges) return null;

        // Try stage-specific nudge first, then fall back to 'new'
        const nudge = pageNudges[stage] || pageNudges['new'];
        if (!nudge) return null;

        this.stats.nudgesShown++;

        return {
            ...nudge,
            pageType,
            stage,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get exit intent intervention based on page and visitor context
     */
    getExitIntervention(pageUrl, visitorProfile) {
        const pageType = this.classifyPage(pageUrl);
        this.stats.exitIntentsDetected++;

        // Don't show exit intent to customers or if recently shown
        if (visitorProfile?.journeyStage === 'customer') return null;

        // Get interventions for page type
        let interventions = this.exitInterventions[pageType] || this.exitInterventions.general;

        // Filter by visitor stage - don't show discount to brand new visitors
        if (visitorProfile?.visitCount <= 1) {
            interventions = interventions.filter(i => i.type !== 'discount');
        }

        if (interventions.length === 0) {
            interventions = this.exitInterventions.general;
        }

        // Select highest priority intervention
        const intervention = interventions.sort((a, b) => b.priority - a.priority)[0];

        this.stats.exitInterventionsShown++;

        return {
            ...intervention,
            pageType,
            visitorStage: visitorProfile?.journeyStage || 'new',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Record a conversion event
     */
    recordConversion(fingerprintId, type, metadata = {}) {
        this.stats.conversions++;
        console.log(`[ConversionEngine] Conversion recorded: ${type} for ${fingerprintId}`);
    }

    /**
     * Record nudge interaction
     */
    recordNudgeClick(fingerprintId, nudgeType) {
        this.stats.nudgesClicked++;
    }

    /**
     * Record exit intervention save (user stayed)
     */
    recordExitSave(fingerprintId) {
        this.stats.exitInterventionsSaved++;
    }

    /**
     * Classify page type from URL
     */
    classifyPage(pageUrl) {
        if (!pageUrl) return 'general';
        const url = pageUrl.toLowerCase();

        if (url.includes('pricing') || url.includes('pay.html') || url.includes('plans')) return 'pricing';
        if (url.includes('checkout') || url.includes('order')) return 'checkout';
        if (url.includes('gallery') || url.includes('collage')) return 'gallery';
        if (url.includes('upload')) return 'upload';
        if (url.includes('studio') || url.includes('annotate')) return 'studio';
        if (url.includes('landing') || url === '/' || url.includes('index.html')) return 'landing';
        if (url.includes('features')) return 'features';
        if (url.includes('download')) return 'download';
        return 'general';
    }

    /**
     * Get funnel analytics
     */
    getFunnelAnalytics() {
        return {
            stats: this.stats,
            nudgeConversionRate: this.stats.nudgesShown > 0
                ? ((this.stats.nudgesClicked / this.stats.nudgesShown) * 100).toFixed(1) + '%'
                : '0%',
            exitSaveRate: this.stats.exitInterventionsShown > 0
                ? ((this.stats.exitInterventionsSaved / this.stats.exitInterventionsShown) * 100).toFixed(1) + '%'
                : '0%',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Load persistent data
     */
    loadData() {
        try {
            if (fs.existsSync(this.conversionDataFile)) {
                const data = JSON.parse(fs.readFileSync(this.conversionDataFile, 'utf8'));
                if (data.stats) this.stats = { ...this.stats, ...data.stats };
            }
        } catch (err) {
            console.error('[ConversionEngine] Error loading data:', err.message);
        }
    }

    /**
     * Save persistent data
     */
    saveData() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            fs.writeFileSync(this.conversionDataFile, JSON.stringify({
                stats: this.stats,
                savedAt: new Date().toISOString()
            }, null, 2));
        } catch (err) {
            console.error('[ConversionEngine] Error saving data:', err.message);
        }
    }
}

const conversionEngine = new AIConversionEngine();
module.exports = conversionEngine;
