/**
 * DOZ UP - Heatmap & AI Conversion Funnel Engine
 * Advanced user behavior analysis with AI-powered optimization
 * Generates millions through intelligent conversion optimization
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const heatmapDbPath = path.join(dataDir, 'heatmap-funnel.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ============ DATABASE ============
function loadDatabase() {
    try {
        if (fs.existsSync(heatmapDbPath)) {
            return JSON.parse(fs.readFileSync(heatmapDbPath, 'utf8'));
        }
    } catch (e) {
        console.error('[Heatmap] Error loading database:', e.message);
    }
    return createEmptyDatabase();
}

function createEmptyDatabase() {
    return {
        version: 1,
        heatmaps: {},        // Page-specific heatmap data
        funnels: {},         // Conversion funnels
        sessions: {},        // Session journeys
        scrollMaps: {},      // Scroll depth data
        attentionMaps: {},   // Mouse movement attention
        clickStreams: [],    // Click sequence analysis
        aiRecommendations: [], // AI-generated recommendations
        abTests: {},         // A/B test configurations
        conversionGoals: [], // Defined conversion goals
        lastUpdated: Date.now()
    };
}

function saveDatabase(db) {
    try {
        db.lastUpdated = Date.now();
        fs.writeFileSync(heatmapDbPath, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('[Heatmap] Error saving database:', e.message);
    }
}

let db = loadDatabase();

// ============ HEATMAP TRACKING ============

/**
 * Track click for heatmap
 */
function trackClick(data) {
    const { page, x, y, element, viewport, sessionId, visitorId, timestamp } = data;
    const pageKey = normalizePageKey(page);

    if (!db.heatmaps[pageKey]) {
        db.heatmaps[pageKey] = {
            clicks: [],
            totalClicks: 0,
            zones: initializeZones(),
            elements: {},
            created: Date.now()
        };
    }

    const heatmap = db.heatmaps[pageKey];

    // Store click with normalized coordinates (percentage-based for responsiveness)
    const normalizedX = Math.round((x / viewport.width) * 100);
    const normalizedY = Math.round((y / viewport.height) * 100);

    heatmap.clicks.push({
        x: normalizedX,
        y: normalizedY,
        rawX: x,
        rawY: y,
        element: element?.tag || 'unknown',
        elementId: element?.id || null,
        elementClass: element?.class || null,
        sessionId,
        visitorId,
        timestamp: timestamp || Date.now()
    });

    // Keep last 10000 clicks per page
    if (heatmap.clicks.length > 10000) {
        heatmap.clicks = heatmap.clicks.slice(-10000);
    }

    heatmap.totalClicks++;

    // Update zone heat
    const zoneX = Math.min(9, Math.floor(normalizedX / 10));
    const zoneY = Math.min(9, Math.floor(normalizedY / 10));
    const zoneKey = `${zoneX}-${zoneY}`;
    heatmap.zones[zoneKey] = (heatmap.zones[zoneKey] || 0) + 1;

    // Track element clicks
    if (element?.tag) {
        const elemKey = `${element.tag}${element.id ? '#' + element.id : ''}${element.class ? '.' + element.class : ''}`;
        heatmap.elements[elemKey] = (heatmap.elements[elemKey] || 0) + 1;
    }

    saveDatabase(db);
    return { success: true, pageKey };
}

/**
 * Track mouse movement for attention heatmap
 */
function trackMovement(data) {
    const { page, positions, sessionId, viewport } = data;
    const pageKey = normalizePageKey(page);

    if (!db.attentionMaps[pageKey]) {
        db.attentionMaps[pageKey] = {
            zones: initializeZones(),
            totalMovements: 0,
            hotspots: []
        };
    }

    const attention = db.attentionMaps[pageKey];

    positions.forEach(pos => {
        const normalizedX = Math.round((pos.x / viewport.width) * 100);
        const normalizedY = Math.round((pos.y / viewport.height) * 100);
        const zoneX = Math.min(9, Math.floor(normalizedX / 10));
        const zoneY = Math.min(9, Math.floor(normalizedY / 10));
        const zoneKey = `${zoneX}-${zoneY}`;

        attention.zones[zoneKey] = (attention.zones[zoneKey] || 0) + 1;
        attention.totalMovements++;
    });

    // Identify hotspots (zones with high attention)
    attention.hotspots = identifyHotspots(attention.zones);

    saveDatabase(db);
    return { success: true };
}

/**
 * Track scroll depth
 */
function trackScroll(data) {
    const { page, depth, maxDepth, sessionId, visitorId } = data;
    const pageKey = normalizePageKey(page);

    if (!db.scrollMaps[pageKey]) {
        db.scrollMaps[pageKey] = {
            depths: { 0: 0, 25: 0, 50: 0, 75: 0, 100: 0 },
            sessions: {},
            avgDepth: 0,
            totalSessions: 0
        };
    }

    const scrollMap = db.scrollMaps[pageKey];

    // Update session max depth
    if (!scrollMap.sessions[sessionId] || maxDepth > scrollMap.sessions[sessionId]) {
        scrollMap.sessions[sessionId] = maxDepth;
    }

    // Update depth buckets
    [0, 25, 50, 75, 100].forEach(bucket => {
        if (maxDepth >= bucket) {
            scrollMap.depths[bucket]++;
        }
    });

    // Calculate average
    const sessionDepths = Object.values(scrollMap.sessions);
    scrollMap.avgDepth = Math.round(sessionDepths.reduce((a, b) => a + b, 0) / sessionDepths.length);
    scrollMap.totalSessions = sessionDepths.length;

    // Limit session tracking
    if (Object.keys(scrollMap.sessions).length > 5000) {
        const keys = Object.keys(scrollMap.sessions).slice(0, 2500);
        keys.forEach(k => delete scrollMap.sessions[k]);
    }

    saveDatabase(db);
    return { success: true, avgDepth: scrollMap.avgDepth };
}

// ============ CONVERSION FUNNEL ============

const DEFAULT_FUNNEL_STAGES = [
    { id: 'landing', name: 'Landing', description: 'Visitor lands on page', trigger: 'pageview' },
    { id: 'engagement', name: 'Engagement', description: 'Scroll > 25% or click', trigger: 'scroll_25_or_click' },
    { id: 'interest', name: 'Interest', description: 'Time > 30s or scroll > 50%', trigger: 'time_30_or_scroll_50' },
    { id: 'intent', name: 'Intent', description: 'CTA hover or form focus', trigger: 'cta_interaction' },
    { id: 'action', name: 'Action', description: 'Form submit or CTA click', trigger: 'action_taken' },
    { id: 'conversion', name: 'Conversion', description: 'Goal completed', trigger: 'goal_complete' }
];

/**
 * Initialize or get funnel
 */
function getFunnel(funnelId = 'default') {
    if (!db.funnels[funnelId]) {
        db.funnels[funnelId] = {
            id: funnelId,
            stages: DEFAULT_FUNNEL_STAGES,
            data: {},
            conversions: [],
            dropoffs: {},
            created: Date.now()
        };
        saveDatabase(db);
    }
    return db.funnels[funnelId];
}

/**
 * Track funnel stage progression
 */
function trackFunnelStage(data) {
    const { funnelId = 'default', stage, sessionId, visitorId, page, metadata } = data;
    const funnel = getFunnel(funnelId);
    const today = new Date().toISOString().split('T')[0];

    if (!funnel.data[today]) {
        funnel.data[today] = {};
        DEFAULT_FUNNEL_STAGES.forEach(s => {
            funnel.data[today][s.id] = { count: 0, visitors: new Set() };
        });
    }

    // Record stage entry
    if (funnel.data[today][stage]) {
        funnel.data[today][stage].count++;
        // Convert Set to array for storage
        const visitors = funnel.data[today][stage].visitors;
        if (visitors instanceof Set) {
            visitors.add(visitorId);
        } else {
            if (!Array.isArray(funnel.data[today][stage].visitors)) {
                funnel.data[today][stage].visitors = [];
            }
            if (!funnel.data[today][stage].visitors.includes(visitorId)) {
                funnel.data[today][stage].visitors.push(visitorId);
            }
        }
    }

    // Track session journey
    if (!db.sessions[sessionId]) {
        db.sessions[sessionId] = {
            visitorId,
            stages: [],
            pages: [],
            startTime: Date.now(),
            lastActivity: Date.now()
        };
    }

    const session = db.sessions[sessionId];
    session.stages.push({ stage, timestamp: Date.now(), page });
    session.lastActivity = Date.now();

    // Detect drop-off (if previous stage was significantly earlier)
    const stageIndex = DEFAULT_FUNNEL_STAGES.findIndex(s => s.id === stage);
    if (stageIndex > 0) {
        const prevStage = DEFAULT_FUNNEL_STAGES[stageIndex - 1].id;
        if (!funnel.dropoffs[prevStage]) {
            funnel.dropoffs[prevStage] = { count: 0, reasons: {} };
        }
    }

    saveDatabase(db);

    // Generate AI recommendations if conversion
    if (stage === 'conversion') {
        funnel.conversions.push({
            sessionId,
            visitorId,
            timestamp: Date.now(),
            journey: session.stages,
            metadata
        });
        generateAIRecommendations();
    }

    return { success: true, sessionJourney: session.stages };
}

/**
 * Get funnel analytics with AI insights
 */
function getFunnelAnalytics(funnelId = 'default', days = 7) {
    const funnel = getFunnel(funnelId);
    const endDate = new Date();
    const startDate = new Date(endDate - days * 24 * 60 * 60 * 1000);

    // Aggregate data
    const aggregated = {};
    DEFAULT_FUNNEL_STAGES.forEach(s => {
        aggregated[s.id] = { total: 0, unique: new Set() };
    });

    Object.keys(funnel.data).forEach(date => {
        const d = new Date(date);
        if (d >= startDate && d <= endDate) {
            Object.keys(funnel.data[date]).forEach(stage => {
                const stageData = funnel.data[date][stage];
                aggregated[stage].total += stageData.count || 0;
                const visitors = stageData.visitors;
                if (Array.isArray(visitors)) {
                    visitors.forEach(v => aggregated[stage].unique.add(v));
                }
            });
        }
    });

    // Calculate conversion rates and drop-offs
    const stages = DEFAULT_FUNNEL_STAGES.map((s, i) => {
        const current = aggregated[s.id].total;
        const previous = i > 0 ? aggregated[DEFAULT_FUNNEL_STAGES[i-1].id].total : current;
        const conversionRate = previous > 0 ? Math.round((current / previous) * 100) : 0;
        const dropoffRate = 100 - conversionRate;

        return {
            ...s,
            count: current,
            uniqueVisitors: aggregated[s.id].unique.size,
            conversionRate,
            dropoffRate,
            dropoffCount: previous - current
        };
    });

    // Overall funnel conversion
    const landingCount = stages[0]?.count || 0;
    const conversionCount = stages[stages.length - 1]?.count || 0;
    const overallConversion = landingCount > 0 ? ((conversionCount / landingCount) * 100).toFixed(2) : 0;

    return {
        funnelId,
        period: { start: startDate.toISOString(), end: endDate.toISOString(), days },
        stages,
        summary: {
            totalVisitors: landingCount,
            totalConversions: conversionCount,
            overallConversionRate: parseFloat(overallConversion),
            biggestDropoff: findBiggestDropoff(stages),
            recentConversions: funnel.conversions.slice(-10)
        },
        aiInsights: generateFunnelInsights(stages, funnel)
    };
}

// ============ AI CONVERSION OPTIMIZER ============

/**
 * Generate AI recommendations for conversion optimization
 */
function generateAIRecommendations() {
    const recommendations = [];
    const funnel = getFunnel('default');
    const analytics = getFunnelAnalytics('default', 7);

    // Analyze each stage for optimization opportunities
    analytics.stages.forEach((stage, i) => {
        if (i > 0 && stage.dropoffRate > 30) {
            recommendations.push(generateDropoffRecommendation(stage, analytics.stages[i-1]));
        }
    });

    // Analyze heatmaps for UX improvements
    Object.keys(db.heatmaps).forEach(page => {
        const heatmap = db.heatmaps[page];
        const scrollMap = db.scrollMaps[page];

        // Low scroll depth recommendation
        if (scrollMap && scrollMap.avgDepth < 50) {
            recommendations.push({
                type: 'scroll_depth',
                priority: 'high',
                page,
                title: 'Low Scroll Engagement',
                description: `Only ${scrollMap.avgDepth}% average scroll depth on ${page}`,
                action: 'Move key content and CTAs above the fold. Add visual cues to encourage scrolling.',
                expectedImpact: '+15-25% engagement',
                confidence: 0.85
            });
        }

        // Dead zones analysis
        const deadZones = findDeadZones(heatmap.zones);
        if (deadZones.length > 3) {
            recommendations.push({
                type: 'dead_zones',
                priority: 'medium',
                page,
                title: 'Underutilized Page Areas',
                description: `${deadZones.length} zones receive minimal interaction`,
                action: 'Redistribute content or add engaging elements to dead zones.',
                zones: deadZones,
                expectedImpact: '+10-15% page interaction',
                confidence: 0.75
            });
        }
    });

    // Revenue optimization recommendations
    recommendations.push(...generateRevenueRecommendations(analytics));

    // Sort by priority and confidence
    recommendations.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (priorityOrder[a.priority] - priorityOrder[b.priority]) || (b.confidence - a.confidence);
    });

    db.aiRecommendations = recommendations.slice(0, 20);
    saveDatabase(db);

    return recommendations;
}

/**
 * Generate revenue-focused recommendations
 */
function generateRevenueRecommendations(analytics) {
    const recommendations = [];
    const convRate = analytics.summary.overallConversionRate;

    // Critical: Very low conversion
    if (convRate < 1) {
        recommendations.push({
            type: 'critical_conversion',
            priority: 'critical',
            title: 'CRITICAL: Conversion Rate Below 1%',
            description: `Current conversion rate: ${convRate}% - Significant revenue loss`,
            actions: [
                'Simplify checkout/signup process immediately',
                'Add trust signals (testimonials, guarantees, security badges)',
                'Implement exit-intent popup with special offer',
                'Review and optimize CTA button placement and copy',
                'Add live chat support for hesitant visitors'
            ],
            expectedImpact: 'Potential 2-5x revenue increase',
            potentialRevenue: 'If 1000 daily visitors, improving to 3% = 30 vs 10 conversions/day',
            confidence: 0.95
        });
    }

    // High value: Improve intent to action
    const intentStage = analytics.stages.find(s => s.id === 'intent');
    const actionStage = analytics.stages.find(s => s.id === 'action');
    if (intentStage && actionStage && actionStage.conversionRate < 50) {
        recommendations.push({
            type: 'intent_to_action',
            priority: 'high',
            title: 'Intent to Action Gap',
            description: `${100 - actionStage.conversionRate}% of interested visitors don't take action`,
            actions: [
                'Add urgency elements (countdown timer, limited stock)',
                'Offer instant incentive (discount code, free shipping)',
                'Reduce form fields to essential only',
                'Add progress indicator for multi-step processes',
                'Implement one-click actions where possible'
            ],
            expectedImpact: '+20-40% action rate',
            confidence: 0.88
        });
    }

    // Engagement optimization
    const engagementStage = analytics.stages.find(s => s.id === 'engagement');
    if (engagementStage && engagementStage.conversionRate < 60) {
        recommendations.push({
            type: 'engagement_boost',
            priority: 'high',
            title: 'Engagement Optimization Needed',
            description: `${100 - engagementStage.conversionRate}% bounce before engaging`,
            actions: [
                'Improve page load speed (target < 2 seconds)',
                'Add compelling hero section with clear value prop',
                'Use video or animation to capture attention',
                'Implement scroll-triggered content reveals',
                'Add interactive elements (quiz, calculator, configurator)'
            ],
            expectedImpact: '+25-35% engagement rate',
            confidence: 0.82
        });
    }

    // Mobile optimization check
    recommendations.push({
        type: 'mobile_optimization',
        priority: 'high',
        title: 'Mobile Experience Audit',
        description: 'Mobile users typically have 50% lower conversion - optimize for mobile',
        actions: [
            'Ensure buttons are thumb-friendly (min 44x44px)',
            'Simplify navigation for mobile',
            'Implement mobile-specific CTAs',
            'Use mobile payment options (Apple Pay, Google Pay)',
            'Test and optimize mobile checkout flow'
        ],
        expectedImpact: '+30-50% mobile conversions',
        confidence: 0.90
    });

    return recommendations;
}

/**
 * Generate funnel-specific AI insights
 */
function generateFunnelInsights(stages, funnel) {
    const insights = [];
    const now = new Date();
    const hour = now.getHours();

    // Time-based insight
    if (hour >= 9 && hour <= 17) {
        insights.push({
            type: 'timing',
            icon: '🕐',
            title: 'Peak Hours Active',
            message: 'Business hours typically see 40% higher conversion rates. Ensure support is available.'
        });
    }

    // Funnel health insight
    const overallHealth = calculateFunnelHealth(stages);
    insights.push({
        type: 'health',
        icon: overallHealth > 70 ? '💚' : overallHealth > 40 ? '💛' : '❤️',
        title: 'Funnel Health Score',
        message: `Your funnel is performing at ${overallHealth}% efficiency.`,
        score: overallHealth
    });

    // Biggest opportunity
    const biggestGap = findBiggestDropoff(stages);
    if (biggestGap) {
        insights.push({
            type: 'opportunity',
            icon: '💰',
            title: 'Biggest Revenue Opportunity',
            message: `Fixing the ${biggestGap.from} → ${biggestGap.to} drop-off could increase conversions by ${biggestGap.potential}%`,
            stage: biggestGap.from
        });
    }

    // Recent trend
    const conversionTrend = analyzeConversionTrend(funnel);
    insights.push({
        type: 'trend',
        icon: conversionTrend > 0 ? '📈' : conversionTrend < 0 ? '📉' : '➡️',
        title: 'Conversion Trend',
        message: conversionTrend > 0
            ? `Conversions up ${conversionTrend}% this week - keep optimizing!`
            : conversionTrend < 0
            ? `Conversions down ${Math.abs(conversionTrend)}% - review recent changes`
            : 'Conversions stable - test new optimizations',
        trend: conversionTrend
    });

    // Quick wins
    insights.push({
        type: 'quick_wins',
        icon: '⚡',
        title: 'Quick Wins for Today',
        actions: [
            'Add social proof near CTAs',
            'Test a more compelling headline',
            'Add urgency messaging',
            'Simplify your main form'
        ]
    });

    return insights;
}

/**
 * AI-powered conversion prediction
 */
function predictConversions(days = 30) {
    const funnel = getFunnel('default');
    const historicalData = [];

    // Collect historical conversion data
    Object.keys(funnel.data).forEach(date => {
        const dayData = funnel.data[date];
        if (dayData.conversion) {
            historicalData.push({
                date,
                conversions: dayData.conversion.count || 0
            });
        }
    });

    if (historicalData.length < 7) {
        return {
            prediction: 'Insufficient data',
            confidence: 0,
            message: 'Need at least 7 days of data for predictions'
        };
    }

    // Simple moving average prediction
    const recent = historicalData.slice(-7);
    const avgConversions = recent.reduce((sum, d) => sum + d.conversions, 0) / recent.length;
    const trend = calculateTrend(historicalData);

    const predictions = [];
    let cumulative = 0;

    for (let i = 1; i <= days; i++) {
        const predicted = Math.round(avgConversions * (1 + trend * i / 100));
        cumulative += predicted;
        predictions.push({
            day: i,
            predicted,
            cumulative
        });
    }

    // Revenue projection (assuming average value)
    const avgValue = 50; // Default average conversion value
    const projectedRevenue = cumulative * avgValue;

    return {
        dailyAverage: Math.round(avgConversions),
        trend: trend > 0 ? 'growing' : trend < 0 ? 'declining' : 'stable',
        trendPercent: trend,
        predictions,
        projectedConversions: cumulative,
        projectedRevenue,
        confidence: 0.75,
        optimizedProjection: {
            conversions: Math.round(cumulative * 1.5),
            revenue: Math.round(projectedRevenue * 1.5),
            message: 'With recommended optimizations, you could see 50% improvement'
        }
    };
}

// ============ HELPER FUNCTIONS ============

function normalizePageKey(page) {
    return (page || '/').replace(/[?#].*$/, '').toLowerCase();
}

function initializeZones() {
    const zones = {};
    for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
            zones[`${x}-${y}`] = 0;
        }
    }
    return zones;
}

function identifyHotspots(zones) {
    const entries = Object.entries(zones);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const avg = total / entries.length;

    return entries
        .filter(([, count]) => count > avg * 2)
        .map(([zone, count]) => ({ zone, intensity: count }))
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 10);
}

function findDeadZones(zones) {
    const entries = Object.entries(zones);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const avg = total / entries.length;

    return entries
        .filter(([, count]) => count < avg * 0.1)
        .map(([zone]) => zone);
}

function findBiggestDropoff(stages) {
    let biggest = null;
    let maxDrop = 0;

    for (let i = 1; i < stages.length; i++) {
        const drop = stages[i].dropoffRate;
        if (drop > maxDrop) {
            maxDrop = drop;
            biggest = {
                from: stages[i-1].name,
                to: stages[i].name,
                dropRate: drop,
                potential: Math.round(drop * 0.3) // 30% of dropoff could be recovered
            };
        }
    }

    return biggest;
}

function calculateFunnelHealth(stages) {
    if (!stages.length) return 0;

    const avgConversion = stages.reduce((sum, s) => sum + s.conversionRate, 0) / stages.length;
    return Math.round(avgConversion);
}

function analyzeConversionTrend(funnel) {
    const dates = Object.keys(funnel.data).sort().slice(-14);
    if (dates.length < 7) return 0;

    const firstWeek = dates.slice(0, 7);
    const secondWeek = dates.slice(-7);

    const firstAvg = firstWeek.reduce((sum, d) => {
        return sum + (funnel.data[d]?.conversion?.count || 0);
    }, 0) / firstWeek.length;

    const secondAvg = secondWeek.reduce((sum, d) => {
        return sum + (funnel.data[d]?.conversion?.count || 0);
    }, 0) / secondWeek.length;

    if (firstAvg === 0) return 0;
    return Math.round(((secondAvg - firstAvg) / firstAvg) * 100);
}

function calculateTrend(data) {
    if (data.length < 2) return 0;

    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));

    const firstAvg = firstHalf.reduce((sum, d) => sum + d.conversions, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, d) => sum + d.conversions, 0) / secondHalf.length;

    if (firstAvg === 0) return 0;
    return Math.round(((secondAvg - firstAvg) / firstAvg) * 100);
}

function generateDropoffRecommendation(currentStage, previousStage) {
    const recommendations = {
        engagement: {
            title: 'Improve Initial Engagement',
            actions: [
                'Add compelling above-fold content',
                'Improve page load speed',
                'Use attention-grabbing visuals',
                'Add clear value proposition'
            ]
        },
        interest: {
            title: 'Build Stronger Interest',
            actions: [
                'Add social proof and testimonials',
                'Show benefits clearly',
                'Use comparison tables',
                'Add FAQ section'
            ]
        },
        intent: {
            title: 'Strengthen Purchase Intent',
            actions: [
                'Add trust badges and guarantees',
                'Show scarcity/urgency',
                'Offer free trial or demo',
                'Display reviews prominently'
            ]
        },
        action: {
            title: 'Reduce Action Friction',
            actions: [
                'Simplify forms',
                'Add guest checkout option',
                'Show progress indicators',
                'Offer multiple payment options'
            ]
        },
        conversion: {
            title: 'Seal the Conversion',
            actions: [
                'Add last-minute incentive',
                'Show money-back guarantee',
                'Provide instant confirmation',
                'Follow up immediately'
            ]
        }
    };

    const rec = recommendations[currentStage.id] || { title: 'Optimize Stage', actions: ['Review and improve'] };

    return {
        type: 'funnel_dropoff',
        priority: currentStage.dropoffRate > 50 ? 'critical' : 'high',
        stage: currentStage.id,
        title: rec.title,
        description: `${currentStage.dropoffRate}% drop-off from ${previousStage.name} to ${currentStage.name}`,
        actions: rec.actions,
        expectedImpact: `+${Math.round(currentStage.dropoffRate * 0.25)}% conversion rate`,
        confidence: 0.80
    };
}

// ============ API METHODS ============

/**
 * Get heatmap data for a page
 */
function getHeatmap(page, options = {}) {
    const pageKey = normalizePageKey(page);
    const heatmap = db.heatmaps[pageKey];
    const scrollMap = db.scrollMaps[pageKey];
    const attention = db.attentionMaps[pageKey];

    if (!heatmap) {
        return {
            success: false,
            message: 'No heatmap data for this page',
            page: pageKey
        };
    }

    // Generate grid data for visualization
    const gridData = [];
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const zoneKey = `${x}-${y}`;
            gridData.push({
                x: x * 10,
                y: y * 10,
                width: 10,
                height: 10,
                clicks: heatmap.zones[zoneKey] || 0,
                attention: attention?.zones[zoneKey] || 0
            });
        }
    }

    // Normalize intensity
    const maxClicks = Math.max(...gridData.map(g => g.clicks), 1);
    const maxAttention = Math.max(...gridData.map(g => g.attention), 1);

    gridData.forEach(g => {
        g.clickIntensity = g.clicks / maxClicks;
        g.attentionIntensity = g.attention / maxAttention;
        g.combinedIntensity = (g.clickIntensity + g.attentionIntensity) / 2;
    });

    return {
        success: true,
        page: pageKey,
        totalClicks: heatmap.totalClicks,
        gridData,
        topElements: Object.entries(heatmap.elements)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([element, clicks]) => ({ element, clicks })),
        scrollDepth: scrollMap ? {
            average: scrollMap.avgDepth,
            distribution: scrollMap.depths,
            totalSessions: scrollMap.totalSessions
        } : null,
        hotspots: attention?.hotspots || [],
        recentClicks: heatmap.clicks.slice(-100)
    };
}

/**
 * Get all pages with heatmap data
 */
function getHeatmapPages() {
    return Object.keys(db.heatmaps).map(page => ({
        page,
        totalClicks: db.heatmaps[page].totalClicks,
        avgScrollDepth: db.scrollMaps[page]?.avgDepth || 0,
        hasAttentionData: !!db.attentionMaps[page]
    }));
}

/**
 * Get AI recommendations
 */
function getRecommendations() {
    if (db.aiRecommendations.length === 0) {
        generateAIRecommendations();
    }
    return db.aiRecommendations;
}

/**
 * Get full dashboard data
 */
function getDashboard() {
    const funnelAnalytics = getFunnelAnalytics('default', 7);
    const predictions = predictConversions(30);
    const recommendations = getRecommendations();
    const heatmapPages = getHeatmapPages();

    return {
        funnel: funnelAnalytics,
        predictions,
        recommendations: recommendations.slice(0, 10),
        heatmapPages,
        summary: {
            totalTrackedPages: heatmapPages.length,
            totalClicks: heatmapPages.reduce((sum, p) => sum + p.totalClicks, 0),
            avgScrollDepth: Math.round(heatmapPages.reduce((sum, p) => sum + p.avgScrollDepth, 0) / (heatmapPages.length || 1)),
            funnelHealth: funnelAnalytics.stages.length > 0 ? calculateFunnelHealth(funnelAnalytics.stages) : 0,
            conversionRate: funnelAnalytics.summary.overallConversionRate,
            projectedMonthlyRevenue: predictions.projectedRevenue || 0
        },
        lastUpdated: db.lastUpdated
    };
}

// ============ EXPORTS ============

module.exports = {
    // Tracking
    trackClick,
    trackMovement,
    trackScroll,
    trackFunnelStage,

    // Analytics
    getHeatmap,
    getHeatmapPages,
    getFunnelAnalytics,
    getRecommendations,
    getDashboard,
    predictConversions,

    // AI
    generateAIRecommendations,

    // Utils
    getFunnel
};
