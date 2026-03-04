/**
 * DOZ UP - AI Support Engine
 * Enterprise-level AI-powered customer support using Anthropic Claude
 *
 * Features:
 * - Natural conversation with "Luna" AI assistant
 * - Knowledge base integration from help articles
 * - Confidence scoring for response quality
 * - Automatic escalation detection
 * - Context-aware responses
 */

let Anthropic = null;
try {
    Anthropic = require('@anthropic-ai/sdk');
} catch (e) {
    console.warn('[AI Support] @anthropic-ai/sdk not installed - run: npm install @anthropic-ai/sdk');
}

const path = require('path');
const fs = require('fs');

class AISupportEngine {
    constructor() {
        this.client = null;
        this.model = process.env.AI_SUPPORT_MODEL || 'claude-3-5-sonnet-20241022';
        this.maxTokens = parseInt(process.env.AI_SUPPORT_MAX_TOKENS) || 1024;
        this.confidenceThreshold = parseFloat(process.env.AI_SUPPORT_CONFIDENCE_THRESHOLD) || 0.7;

        // Response timeout for speed-based escalation (default 8 seconds)
        this.responseTimeout = parseInt(process.env.AI_RESPONSE_TIMEOUT_MS) || 8000;

        // Response time tracking for analytics
        this.responseMetrics = {
            totalResponses: 0,
            totalTime: 0,
            timeouts: 0,
            avgResponseTime: 0
        };

        // Initialize Anthropic client
        this.initClient();

        // Load knowledge base
        this.knowledgeBase = this.loadKnowledgeBase();

        // Conversation context window
        this.contextWindow = 10;

        // Escalation keywords
        this.escalationKeywords = [
            'human', 'agent', 'person', 'real person', 'manager', 'supervisor',
            'refund', 'cancel subscription', 'urgent', 'emergency', 'lawyer',
            'sue', 'legal', 'attorney', 'complaint', 'fraud', 'scam',
            'immediately', 'right now', 'asap', 'furious', 'unacceptable'
        ];

        // Frustration indicators
        this.frustrationIndicators = [
            'already told you', 'said that', 'repeat', 'again', 'not listening',
            'useless', 'terrible', 'worst', 'hate', 'stupid', 'dumb',
            'waste of time', 'ridiculous', 'pathetic', 'incompetent'
        ];
    }

    initClient() {
        if (!Anthropic) {
            console.warn('[AI Support] Anthropic SDK not available - AI responses will use fallback');
            return;
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
            try {
                this.client = new Anthropic({ apiKey });
                console.log('[AI Support] Anthropic client initialized');
            } catch (e) {
                console.error('[AI Support] Failed to initialize Anthropic client:', e.message);
            }
        } else {
            console.warn('[AI Support] ANTHROPIC_API_KEY not set - AI responses will use fallback');
        }
    }

    loadKnowledgeBase() {
        try {
            const articlesPath = path.join(__dirname, '..', 'data', 'help-articles.json');
            if (fs.existsSync(articlesPath)) {
                const data = JSON.parse(fs.readFileSync(articlesPath, 'utf8'));
                console.log(`[AI Support] Loaded ${data.articles?.length || 0} help articles`);
                return {
                    articles: data.articles || [],
                    categories: data.categories || [],
                    templates: data.templates || []
                };
            }
        } catch (e) {
            console.error('[AI Support] Failed to load knowledge base:', e.message);
        }
        return { articles: [], categories: [], templates: [] };
    }

    reloadKnowledgeBase() {
        this.knowledgeBase = this.loadKnowledgeBase();
    }

    /**
     * Generate response with timeout protection
     * If AI takes too long, escalate to human agent immediately
     * @param {Object} conversation - Conversation object
     * @param {string} userMessage - User's message
     * @param {Object} visitorContext - Optional visitor context from visitor intelligence
     * @returns {Object} - Response object with timing info
     */
    async generateResponseWithTimeout(conversation, userMessage, visitorContext = null) {
        const startTime = Date.now();

        // Create the response promise
        const responsePromise = this.generateResponseWithContext(conversation, userMessage, visitorContext);

        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject({ type: 'TIMEOUT', duration: Date.now() - startTime });
            }, this.responseTimeout);
        });

        try {
            // Race between response and timeout
            const response = await Promise.race([responsePromise, timeoutPromise]);

            // Calculate response time
            const responseTime = Date.now() - startTime;

            // Update metrics
            this.updateMetrics(responseTime, false);

            return {
                ...response,
                responseTime,
                withinTimeout: true
            };

        } catch (error) {
            if (error.type === 'TIMEOUT') {
                // AI took too long - escalate immediately
                console.warn(`[AI Support] Response timeout after ${error.duration}ms - escalating to human`);

                this.updateMetrics(error.duration, true);

                return {
                    content: "Let me connect you with a specialist who can help you right away! They'll be with you in just a moment.",
                    shouldEscalate: true,
                    escalationReason: 'AI_TIMEOUT',
                    responseTime: error.duration,
                    withinTimeout: false,
                    aiGenerated: true,
                    model: 'timeout-escalation',
                    confidence: 0
                };
            }
            throw error;
        }
    }

    /**
     * Update response time metrics
     */
    updateMetrics(responseTime, isTimeout) {
        this.responseMetrics.totalResponses++;
        this.responseMetrics.totalTime += responseTime;
        if (isTimeout) this.responseMetrics.timeouts++;
        this.responseMetrics.avgResponseTime = Math.round(
            this.responseMetrics.totalTime / this.responseMetrics.totalResponses
        );
    }

    /**
     * Get current response metrics
     */
    getMetrics() {
        return {
            ...this.responseMetrics,
            timeoutRate: this.responseMetrics.totalResponses > 0
                ? (this.responseMetrics.timeouts / this.responseMetrics.totalResponses * 100).toFixed(1) + '%'
                : '0%'
        };
    }

    /**
     * Generate response with visitor context
     * @param {Object} conversation - Conversation object
     * @param {string} userMessage - User's message
     * @param {Object} visitorContext - Visitor context from visitor intelligence
     * @returns {Object} - Response object
     */
    async generateResponseWithContext(conversation, userMessage, visitorContext = null) {
        // Check for immediate escalation triggers first
        const escalationCheck = this.checkEscalationTriggers(userMessage, conversation);
        if (escalationCheck.escalate) {
            return {
                content: escalationCheck.message,
                shouldEscalate: true,
                escalationReason: escalationCheck.reason,
                confidence: 0,
                aiGenerated: true,
                model: this.model
            };
        }

        // Find relevant articles for context
        const relevantArticles = this.findRelevantArticles(userMessage);

        // If no API client, use fallback response
        if (!this.client) {
            return this.getFallbackResponse(userMessage, relevantArticles);
        }

        try {
            // Build message history
            const messages = this.buildMessageHistory(conversation, userMessage);

            // Add context about relevant articles if found
            let enhancedUserMessage = userMessage;
            if (relevantArticles.length > 0) {
                const articleContext = relevantArticles.map(a =>
                    `[Relevant: "${a.title}" - ${a.content.substring(0, 200)}...]`
                ).join('\n');
                enhancedUserMessage = `${userMessage}\n\n[CONTEXT FOR LUNA - These articles may be relevant:\n${articleContext}]`;
            }

            messages[messages.length - 1].content = enhancedUserMessage;

            // Build system prompt with visitor context
            const systemPrompt = visitorContext
                ? this.buildSystemPromptWithVisitorContext(visitorContext)
                : this.buildSystemPrompt();

            // Call Claude API
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                system: systemPrompt,
                messages: messages
            });

            const content = response.content[0].text;
            const confidence = this.calculateConfidence(userMessage, content, relevantArticles);

            return {
                content,
                confidence,
                tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
                model: this.model,
                relatedArticles: relevantArticles.slice(0, 3).map(a => ({
                    id: a.id,
                    title: a.title,
                    category: a.category
                })),
                shouldEscalate: confidence < this.confidenceThreshold,
                escalationReason: confidence < this.confidenceThreshold ? 'LOW_CONFIDENCE' : null,
                suggestedActions: this.generateSuggestedActions(content, relevantArticles),
                aiGenerated: true
            };

        } catch (error) {
            console.error('[AI Support] API error:', error.message);
            return this.getFallbackResponse(userMessage, relevantArticles);
        }
    }

    /**
     * Build system prompt with visitor context for personalization
     */
    buildSystemPromptWithVisitorContext(visitorContext) {
        let basePrompt = this.buildSystemPrompt();

        if (!visitorContext) return basePrompt;

        const contextSection = `

VISITOR CONTEXT (Use this to personalize your responses):
- Visit Count: ${visitorContext.visitCount || 1}
- Is Returning: ${visitorContext.isReturning ? 'Yes' : 'No'}
- Journey Stage: ${visitorContext.journeyStage || 'new'}
- Days Since Last Visit: ${visitorContext.daysSinceLastVisit || 0}
- Previous Topics: ${(visitorContext.previousTopics || []).join(', ') || 'None'}
- Unresolved Issues: ${(visitorContext.unresolvedIssues || []).join(', ') || 'None'}
- Conversion Score: ${visitorContext.conversionScore || 0}/100
- Name: ${visitorContext.name || 'Unknown'}

PERSONALIZATION RULES:
- For returning visitors (visitCount > 1): Reference their history naturally, e.g., "Good to see you again!"
- For high conversion score (> 70): They're close to purchasing - emphasize value and offer to help finalize
- For users with unresolved issues: Acknowledge and prioritize resolving those issues first
- For journey stage "considering": They're evaluating - offer comparisons, trials, or demos
- For long absence (daysSinceLastVisit > 30): Welcome them back warmly and mention what's new
- Use their name naturally if available
- Don't be creepy about knowing their history - keep it natural and helpful`;

        return basePrompt + contextSection;
    }

    buildSystemPrompt() {
        const productInfo = `
DOZ UP is a powerful screenshot capture and sharing tool for Windows. Key features:
- Instant screenshot capture with Ctrl+Shift+S
- Area selection with Ctrl+Shift+A
- Window capture with Ctrl+Shift+W
- Automatic cloud upload and sharing
- Cross-device sync for Pro users
- Gallery to view all screenshots
- System tray integration

Pricing:
- Free: 50 screenshots/month, 1 device, 7-day cloud storage
- Pro Monthly: $4.99/month - unlimited screenshots, 5 devices, 1-year storage
- Pro Yearly: $37.70/year (37% savings)
- Enterprise: Custom pricing for teams

Website: doz.com
Support email: support@doz.com`;

        const knowledgeContext = this.formatKnowledgeBase();

        return `You are Luna, DOZ UP's friendly AI support assistant. You provide helpful, warm, and professional customer support 24/7.

PERSONALITY & TONE:
- Warm, helpful, and empathetic
- Professional but conversational (not robotic)
- Use occasional emoji when appropriate (1-2 max per message) like 😊 👍
- Be concise - aim for 2-4 sentences unless a detailed explanation is needed
- Never say "I'm just an AI" or "As an AI" - you are Luna, a capable support assistant
- If you don't know something, say "Let me connect you with our team" instead of guessing

PRODUCT KNOWLEDGE:
${productInfo}

HELP ARTICLES (use these to answer questions):
${knowledgeContext}

CAPABILITIES:
- Answer questions about DOZ UP features, pricing, troubleshooting
- Guide users through common tasks step-by-step
- Collect information needed for support tickets
- Know when to escalate to human agents

IMPORTANT RULES:
1. If genuinely unsure, offer to connect with human support
2. For billing issues (refunds, payments, charges), collect details then escalate
3. Never share internal information or make unauthorized promises
4. If user explicitly asks for a human, comply immediately and warmly
5. For technical issues you can't solve, collect error details then escalate
6. Always verify you understood the question before answering

ESCALATION - Connect to human when:
- User explicitly requests human/person/agent
- Billing disputes, refunds, or payment issues
- Complex technical issues after 2-3 attempts
- User shows frustration (caps, repeated questions)
- Security or privacy concerns
- Legal mentions (lawyer, sue, etc.)

When escalating, say something like: "I'd love to make sure you get the best help with this. Let me connect you with one of our specialists who can assist you directly!"

RESPONSE FORMAT:
- Use markdown for formatting when helpful
- Use bullet points for lists
- Keep paragraphs short
- Include relevant help article references when applicable`;
    }

    formatKnowledgeBase() {
        if (!this.knowledgeBase.articles.length) {
            return 'No help articles loaded.';
        }

        // Format top articles by views and helpfulness
        const sortedArticles = [...this.knowledgeBase.articles]
            .sort((a, b) => (b.views || 0) - (a.views || 0))
            .slice(0, 15);

        return sortedArticles.map(article => {
            const contentPreview = article.content.substring(0, 300).replace(/\n/g, ' ');
            return `**${article.title}** (ID: ${article.id})
Category: ${article.category}
Keywords: ${(article.keywords || []).join(', ')}
Content: ${contentPreview}...`;
        }).join('\n\n');
    }

    async generateResponse(conversation, userMessage) {
        // Check for immediate escalation triggers first
        const escalationCheck = this.checkEscalationTriggers(userMessage, conversation);
        if (escalationCheck.escalate) {
            return {
                content: escalationCheck.message,
                shouldEscalate: true,
                escalationReason: escalationCheck.reason,
                confidence: 0,
                aiGenerated: true,
                model: this.model
            };
        }

        // Find relevant articles for context
        const relevantArticles = this.findRelevantArticles(userMessage);

        // If no API client, use fallback response
        if (!this.client) {
            return this.getFallbackResponse(userMessage, relevantArticles);
        }

        try {
            // Build message history
            const messages = this.buildMessageHistory(conversation, userMessage);

            // Add context about relevant articles if found
            let enhancedUserMessage = userMessage;
            if (relevantArticles.length > 0) {
                const articleContext = relevantArticles.map(a =>
                    `[Relevant: "${a.title}" - ${a.content.substring(0, 200)}...]`
                ).join('\n');
                enhancedUserMessage = `${userMessage}\n\n[CONTEXT FOR LUNA - These articles may be relevant:\n${articleContext}]`;
            }

            messages[messages.length - 1].content = enhancedUserMessage;

            // Call Claude API
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                system: this.buildSystemPrompt(),
                messages: messages
            });

            const content = response.content[0].text;
            const confidence = this.calculateConfidence(userMessage, content, relevantArticles);

            return {
                content,
                confidence,
                tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
                model: this.model,
                relatedArticles: relevantArticles.slice(0, 3).map(a => ({
                    id: a.id,
                    title: a.title,
                    category: a.category
                })),
                shouldEscalate: confidence < this.confidenceThreshold,
                escalationReason: confidence < this.confidenceThreshold ? 'LOW_CONFIDENCE' : null,
                suggestedActions: this.generateSuggestedActions(content, relevantArticles),
                aiGenerated: true
            };

        } catch (error) {
            console.error('[AI Support] API error:', error.message);
            return this.getFallbackResponse(userMessage, relevantArticles);
        }
    }

    buildMessageHistory(conversation, newMessage) {
        const history = [];

        if (conversation && conversation.messages) {
            const recentMessages = conversation.messages.slice(-this.contextWindow);

            for (const msg of recentMessages) {
                history.push({
                    role: msg.role === 'USER' ? 'user' : 'assistant',
                    content: msg.content
                });
            }
        }

        history.push({ role: 'user', content: newMessage });
        return history;
    }

    checkEscalationTriggers(message, conversation) {
        const lowerMessage = message.toLowerCase();

        // Check for explicit human request
        const humanPhrases = ['human', 'real person', 'speak to someone', 'talk to someone',
                             'actual person', 'live agent', 'human agent', 'real agent'];
        for (const phrase of humanPhrases) {
            if (lowerMessage.includes(phrase)) {
                return {
                    escalate: true,
                    reason: 'USER_REQUESTED_HUMAN',
                    message: "Absolutely! I'll connect you with one of our support specialists right away. They'll be with you in just a moment. 😊"
                };
            }
        }

        // Check for escalation keywords
        for (const keyword of this.escalationKeywords) {
            if (lowerMessage.includes(keyword)) {
                // Billing-related - gather info first
                if (['refund', 'cancel subscription', 'charge', 'payment'].some(k => lowerMessage.includes(k))) {
                    return {
                        escalate: true,
                        reason: `BILLING_ISSUE: ${keyword}`,
                        message: "I understand you have a billing concern, and I want to make sure this is handled properly. Let me connect you with our billing team who can assist you directly. One moment please!"
                    };
                }

                // Urgent/Legal
                if (['lawyer', 'sue', 'legal', 'attorney', 'fraud', 'scam'].some(k => lowerMessage.includes(k))) {
                    return {
                        escalate: true,
                        reason: `LEGAL_CONCERN: ${keyword}`,
                        message: "I understand this is a serious matter. Let me immediately connect you with our senior support team who can properly address your concerns."
                    };
                }

                // General escalation keyword
                return {
                    escalate: true,
                    reason: `KEYWORD_TRIGGER: ${keyword}`,
                    message: "I want to make sure you get the best possible help with this. Let me connect you with one of our support specialists who can assist you directly."
                };
            }
        }

        // Check for frustration indicators
        let frustrationCount = 0;
        for (const indicator of this.frustrationIndicators) {
            if (lowerMessage.includes(indicator)) {
                frustrationCount++;
            }
        }

        // Check for ALL CAPS (frustration indicator)
        const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
        if (capsRatio > 0.5 && message.length > 10) {
            frustrationCount += 2;
        }

        if (frustrationCount >= 2) {
            return {
                escalate: true,
                reason: 'USER_FRUSTRATED',
                message: "I can see this has been frustrating, and I'm truly sorry about that. Let me get you connected with one of our senior support team members who can give this their full attention."
            };
        }

        // Check conversation history for repeated questions
        if (conversation && conversation.messages) {
            const userMessages = conversation.messages.filter(m => m.role === 'USER');
            if (userMessages.length >= 3) {
                // Simple similarity check for repeated topics
                const recentTopics = userMessages.slice(-3).map(m =>
                    m.content.toLowerCase().split(' ').slice(0, 5).join(' ')
                );
                const uniqueTopics = new Set(recentTopics);
                if (uniqueTopics.size === 1) {
                    return {
                        escalate: true,
                        reason: 'REPEATED_QUESTION',
                        message: "I notice we've been going back and forth on this. Let me bring in one of our specialists who might be able to help more effectively. One moment!"
                    };
                }
            }
        }

        return { escalate: false };
    }

    findRelevantArticles(query) {
        if (!this.knowledgeBase.articles.length) return [];

        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

        const scored = this.knowledgeBase.articles.map(article => {
            let score = 0;
            const titleLower = article.title.toLowerCase();
            const contentLower = article.content.toLowerCase();

            // Title exact match (highest weight)
            if (titleLower.includes(queryLower)) score += 20;

            // Keyword match
            for (const keyword of article.keywords || []) {
                const keywordLower = keyword.toLowerCase();
                if (queryLower.includes(keywordLower)) score += 10;
                if (queryWords.some(w => keywordLower.includes(w))) score += 3;
            }

            // Title word match
            for (const word of queryWords) {
                if (titleLower.includes(word)) score += 5;
            }

            // Content match
            for (const word of queryWords) {
                if (contentLower.includes(word)) score += 1;
            }

            // Boost by helpfulness ratio
            if (article.helpful && article.notHelpful) {
                const ratio = article.helpful / (article.helpful + article.notHelpful);
                score *= (0.5 + ratio);
            }

            return { ...article, score };
        });

        return scored
            .filter(s => s.score > 5)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }

    calculateConfidence(query, response, relevantArticles) {
        let confidence = 0.85; // Base confidence

        // Reduce if response contains uncertainty phrases
        const uncertainPhrases = [
            "i'm not sure", "i don't know", "unclear", "might", "possibly",
            "i think", "maybe", "perhaps", "not certain"
        ];
        const responseLower = response.toLowerCase();
        for (const phrase of uncertainPhrases) {
            if (responseLower.includes(phrase)) {
                confidence -= 0.1;
            }
        }

        // Reduce if response suggests escalation
        if (responseLower.includes('connect you') || responseLower.includes('specialist')) {
            confidence -= 0.15;
        }

        // Increase if matching articles found
        if (relevantArticles.length > 0) {
            confidence += 0.05 * Math.min(relevantArticles.length, 3);
        }

        // Increase if response is substantive
        if (response.length > 200) confidence += 0.05;
        if (response.includes('1.') || response.includes('-')) confidence += 0.05; // Contains steps/list

        // Clamp between 0 and 1
        return Math.max(0, Math.min(1, confidence));
    }

    generateSuggestedActions(content, articles) {
        const actions = [];

        // Add article suggestions as quick actions
        for (const article of articles.slice(0, 2)) {
            actions.push({
                type: 'article',
                label: article.title.length > 35 ? article.title.substring(0, 35) + '...' : article.title,
                articleId: article.id
            });
        }

        // Add common quick replies based on content
        const contentLower = content.toLowerCase();

        if (contentLower.includes('help') || contentLower.includes('assist')) {
            actions.push({ type: 'text', label: 'Talk to human support', value: 'I would like to speak to a human please' });
        }

        if (contentLower.includes('setting') || contentLower.includes('configure')) {
            actions.push({ type: 'text', label: 'Open Settings guide', value: 'Show me how to access settings' });
        }

        if (contentLower.includes('install') || contentLower.includes('download')) {
            actions.push({ type: 'link', label: 'Download DOZ UP', url: 'https://doz.com/up/download' });
        }

        return actions.slice(0, 4); // Max 4 actions
    }

    getFallbackResponse(userMessage, relevantArticles) {
        // Generate helpful fallback when API is unavailable
        const lowerMessage = userMessage.toLowerCase();

        // Check for common questions
        if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('plan')) {
            return {
                content: "Great question! DOZ UP has flexible pricing:\n\n- **Free**: 50 screenshots/month, 1 device\n- **Pro Monthly**: $4.99/month - unlimited screenshots, 5 devices\n- **Pro Yearly**: $37.70/year (save 37%!)\n\nYou can view all plans at doz.com/pay 😊",
                confidence: 0.9,
                shouldEscalate: false,
                relatedArticles: relevantArticles.slice(0, 3),
                suggestedActions: [{ type: 'link', label: 'View Plans', url: 'https://doz.com/up/pay' }],
                aiGenerated: true,
                model: 'fallback'
            };
        }

        if (lowerMessage.includes('download') || lowerMessage.includes('install')) {
            return {
                content: "You can download DOZ UP from our website! 🚀\n\n1. Visit **doz.com/download**\n2. Click the download button for your platform\n3. Run the installer and follow the prompts\n\nDOZ UP will start automatically after installation!",
                confidence: 0.9,
                shouldEscalate: false,
                relatedArticles: relevantArticles.slice(0, 3),
                suggestedActions: [{ type: 'link', label: 'Download Now', url: 'https://doz.com/up/download' }],
                aiGenerated: true,
                model: 'fallback'
            };
        }

        if (lowerMessage.includes('hotkey') || lowerMessage.includes('shortcut')) {
            return {
                content: "Here are the default keyboard shortcuts:\n\n- **Ctrl+Shift+S** - Full screen capture\n- **Ctrl+Shift+A** - Area selection\n- **Ctrl+Shift+W** - Window capture\n- **Ctrl+Shift+G** - Open Gallery\n\nYou can customize these in Settings > Hotkeys! 👍",
                confidence: 0.9,
                shouldEscalate: false,
                relatedArticles: relevantArticles.slice(0, 3),
                suggestedActions: [],
                aiGenerated: true,
                model: 'fallback'
            };
        }

        // If we have relevant articles, reference them
        if (relevantArticles.length > 0) {
            const article = relevantArticles[0];
            return {
                content: `I found some information that might help! Check out our article: **"${article.title}"**\n\nWould you like me to explain this in more detail, or would you prefer to speak with our support team?`,
                confidence: 0.6,
                shouldEscalate: false,
                relatedArticles: relevantArticles.slice(0, 3),
                suggestedActions: [
                    { type: 'article', label: article.title.substring(0, 35), articleId: article.id },
                    { type: 'text', label: 'Talk to human', value: 'I would like to speak to a human please' }
                ],
                aiGenerated: true,
                model: 'fallback'
            };
        }

        // Generic fallback
        return {
            content: "Thanks for reaching out! 😊 I'd be happy to help you with DOZ UP.\n\nCould you tell me a bit more about what you're trying to do or what issue you're experiencing? That way I can give you the best assistance.\n\nOr if you prefer, I can connect you with our support team right away!",
            confidence: 0.5,
            shouldEscalate: false,
            relatedArticles: [],
            suggestedActions: [
                { type: 'text', label: 'Talk to human support', value: 'I would like to speak to a human please' }
            ],
            aiGenerated: true,
            model: 'fallback'
        };
    }

    // Generate AI summary of conversation for ticket creation
    async generateTicketSummary(conversation) {
        if (!this.client || !conversation.messages || conversation.messages.length === 0) {
            return this.generateFallbackSummary(conversation);
        }

        try {
            const messagesText = conversation.messages
                .map(m => `${m.role}: ${m.content}`)
                .join('\n\n');

            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 300,
                system: 'You are a support ticket summarizer. Create a brief, factual summary of the customer issue. Include: main problem, key details, and what was attempted. Be concise (2-3 sentences).',
                messages: [{
                    role: 'user',
                    content: `Summarize this support conversation:\n\n${messagesText}`
                }]
            });

            return response.content[0].text;
        } catch (error) {
            console.error('[AI Support] Summary generation error:', error.message);
            return this.generateFallbackSummary(conversation);
        }
    }

    generateFallbackSummary(conversation) {
        if (!conversation.messages || conversation.messages.length === 0) {
            return 'Customer initiated support conversation.';
        }

        const firstUserMessage = conversation.messages.find(m => m.role === 'USER');
        if (firstUserMessage) {
            const preview = firstUserMessage.content.substring(0, 150);
            return `Customer inquiry: ${preview}${firstUserMessage.content.length > 150 ? '...' : ''}`;
        }

        return 'Support conversation requiring attention.';
    }

    // Suggest ticket priority based on conversation
    suggestPriority(conversation, escalationReason) {
        if (escalationReason) {
            if (escalationReason.includes('LEGAL') || escalationReason.includes('URGENT')) {
                return 'URGENT';
            }
            if (escalationReason.includes('BILLING') || escalationReason.includes('FRUSTRATED')) {
                return 'HIGH';
            }
        }

        // Check message content for urgency indicators
        const allContent = (conversation.messages || [])
            .map(m => m.content.toLowerCase())
            .join(' ');

        if (allContent.includes('urgent') || allContent.includes('asap') || allContent.includes('emergency')) {
            return 'HIGH';
        }

        if (allContent.includes('bug') || allContent.includes('error') || allContent.includes('crash')) {
            return 'MEDIUM';
        }

        return 'MEDIUM';
    }

    // Suggest ticket category based on conversation
    suggestCategory(conversation) {
        const allContent = (conversation.messages || [])
            .map(m => m.content.toLowerCase())
            .join(' ');

        if (allContent.includes('price') || allContent.includes('subscription') ||
            allContent.includes('payment') || allContent.includes('refund') ||
            allContent.includes('billing') || allContent.includes('charge')) {
            return 'BILLING';
        }

        if (allContent.includes('bug') || allContent.includes('error') ||
            allContent.includes('crash') || allContent.includes('not working') ||
            allContent.includes('broken') || allContent.includes('issue')) {
            return 'TECHNICAL';
        }

        if (allContent.includes('feature') || allContent.includes('request') ||
            allContent.includes('suggestion') || allContent.includes('would be nice')) {
            return 'FEATURE_REQUEST';
        }

        if (allContent.includes('account') || allContent.includes('login') ||
            allContent.includes('password') || allContent.includes('email')) {
            return 'ACCOUNT';
        }

        if (allContent.includes('enterprise') || allContent.includes('team') ||
            allContent.includes('business') || allContent.includes('api')) {
            return 'ENTERPRISE';
        }

        return 'GENERAL';
    }
}

// Export singleton instance
const aiSupportEngine = new AISupportEngine();
module.exports = aiSupportEngine;
