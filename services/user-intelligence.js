/**
 * DOZ UP - User Intelligence & Personalization System
 *
 * Features:
 * - Remote diagnostics and auto-fix
 * - User behavior tracking and learning
 * - Automatic feedback collection
 * - UI personalization engine
 * - Issue pattern recognition
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const intelligenceDir = path.join(dataDir, 'intelligence');

// Ensure directories exist
[dataDir, intelligenceDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Data files
const FILES = {
    behaviors: path.join(intelligenceDir, 'user-behaviors.json'),
    issues: path.join(intelligenceDir, 'detected-issues.json'),
    patterns: path.join(intelligenceDir, 'learned-patterns.json'),
    feedback: path.join(intelligenceDir, 'feedback.json'),
    personalization: path.join(intelligenceDir, 'personalization-profiles.json'),
    diagnostics: path.join(intelligenceDir, 'diagnostics.json'),
    remoteFixes: path.join(intelligenceDir, 'remote-fixes.json')
};

function loadJSON(filepath, defaultValue = {}) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) { console.error(`[Intelligence] Error loading ${filepath}:`, e.message); }
    return defaultValue;
}

function saveJSON(filepath, data) {
    try {
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } catch (e) { console.error(`[Intelligence] Error saving ${filepath}:`, e.message); }
}

// ============ ISSUE PATTERNS (Machine Learning Lite) ============
const ISSUE_PATTERNS = {
    // Capture Issues
    capture_failed: {
        id: 'capture_failed',
        name: 'Screenshot Capture Failed',
        signals: ['capture_error', 'black_screen', 'timeout', 'gpu_crash'],
        autoFix: 'reset_capture_engine',
        severity: 'high'
    },
    capture_slow: {
        id: 'capture_slow',
        name: 'Slow Screenshot Capture',
        signals: ['capture_time > 2000ms', 'multiple_retries', 'gpu_fallback'],
        autoFix: 'optimize_capture_settings',
        severity: 'medium'
    },
    capture_confused: {
        id: 'capture_confused',
        name: 'User Confused During Capture',
        signals: ['cancelled_multiple_times', 'rapid_esc_key', 'mouse_erratic', 'no_selection_made'],
        autoFix: 'show_capture_tutorial',
        severity: 'low'
    },

    // Upload Issues
    upload_failed: {
        id: 'upload_failed',
        name: 'Upload Failed',
        signals: ['upload_error', 'network_timeout', 'server_error'],
        autoFix: 'retry_with_fallback_server',
        severity: 'high'
    },
    upload_slow: {
        id: 'upload_slow',
        name: 'Slow Upload',
        signals: ['upload_time > 5000ms', 'large_file_size'],
        autoFix: 'compress_and_retry',
        severity: 'medium'
    },

    // Update Issues
    update_failed: {
        id: 'update_failed',
        name: 'Update Failed',
        signals: ['update_error', 'download_failed', 'installation_failed', 'version_mismatch'],
        autoFix: 'force_clean_update',
        severity: 'critical'
    },
    update_stuck: {
        id: 'update_stuck',
        name: 'Update Stuck',
        signals: ['update_progress_stalled', 'same_version_after_update'],
        autoFix: 'clear_cache_and_retry',
        severity: 'high'
    },

    // UI/UX Issues
    ui_navigation_confused: {
        id: 'ui_navigation_confused',
        name: 'User Lost in Navigation',
        signals: ['rapid_page_switches', 'back_button_spam', 'search_without_result_click'],
        autoFix: 'show_navigation_helper',
        severity: 'low'
    },
    feature_discovery_failed: {
        id: 'feature_discovery_failed',
        name: 'User Can\'t Find Feature',
        signals: ['search_patterns', 'random_clicking', 'help_page_visit', 'same_page_reload'],
        autoFix: 'show_feature_spotlight',
        severity: 'low'
    },

    // Performance Issues
    app_slow: {
        id: 'app_slow',
        name: 'App Running Slowly',
        signals: ['high_cpu', 'high_memory', 'ui_lag_reported', 'render_time > 1000ms'],
        autoFix: 'optimize_performance',
        severity: 'medium'
    },
    app_crash: {
        id: 'app_crash',
        name: 'App Crashed',
        signals: ['crash_report', 'unexpected_exit', 'error_boundary_triggered'],
        autoFix: 'restart_with_safe_mode',
        severity: 'critical'
    },

    // Engagement Issues
    low_engagement: {
        id: 'low_engagement',
        name: 'User Disengaged',
        signals: ['long_idle_time', 'incomplete_actions', 'app_minimized_frequently'],
        autoFix: 'show_engagement_prompt',
        severity: 'low'
    },
    frustration_detected: {
        id: 'frustration_detected',
        name: 'User Frustrated',
        signals: ['rage_clicks', 'rapid_actions', 'error_retry_loop', 'aggressive_scrolling'],
        autoFix: 'offer_help_proactively',
        severity: 'medium'
    }
};

// ============ AUTO-FIX ACTIONS ============
const AUTO_FIX_ACTIONS = {
    reset_capture_engine: {
        id: 'reset_capture_engine',
        name: 'Reset Capture Engine',
        type: 'remote_command',
        command: { action: 'reset_capture', params: { clearCache: true, reinitGPU: true } },
        description: 'Resets the screenshot capture system'
    },
    optimize_capture_settings: {
        id: 'optimize_capture_settings',
        name: 'Optimize Capture Settings',
        type: 'config_push',
        config: { useGPU: false, captureMethod: 'fallback', compression: 'medium' },
        description: 'Switches to optimized capture settings'
    },
    show_capture_tutorial: {
        id: 'show_capture_tutorial',
        name: 'Show Capture Tutorial',
        type: 'ui_action',
        action: { type: 'show_modal', modal: 'capture_tutorial' },
        description: 'Shows interactive capture tutorial'
    },
    retry_with_fallback_server: {
        id: 'retry_with_fallback_server',
        name: 'Retry with Fallback Server',
        type: 'remote_command',
        command: { action: 'switch_upload_server', params: { useFallback: true } },
        description: 'Switches to backup upload server'
    },
    compress_and_retry: {
        id: 'compress_and_retry',
        name: 'Compress and Retry',
        type: 'remote_command',
        command: { action: 'compress_upload', params: { quality: 80, maxSize: 5000000 } },
        description: 'Compresses image and retries upload'
    },
    force_clean_update: {
        id: 'force_clean_update',
        name: 'Force Clean Update',
        type: 'remote_command',
        command: { action: 'force_update', params: { clean: true, clearCache: true } },
        description: 'Forces a clean reinstall of the update'
    },
    clear_cache_and_retry: {
        id: 'clear_cache_and_retry',
        name: 'Clear Cache and Retry',
        type: 'remote_command',
        command: { action: 'clear_cache', params: { all: true, retryUpdate: true } },
        description: 'Clears all caches and retries'
    },
    show_navigation_helper: {
        id: 'show_navigation_helper',
        name: 'Show Navigation Helper',
        type: 'ui_action',
        action: { type: 'show_overlay', overlay: 'navigation_guide' },
        description: 'Shows navigation assistance overlay'
    },
    show_feature_spotlight: {
        id: 'show_feature_spotlight',
        name: 'Show Feature Spotlight',
        type: 'ui_action',
        action: { type: 'spotlight', target: 'auto_detect' },
        description: 'Highlights the feature user is looking for'
    },
    optimize_performance: {
        id: 'optimize_performance',
        name: 'Optimize Performance',
        type: 'remote_command',
        command: { action: 'optimize', params: { clearMemory: true, disableAnimations: true } },
        description: 'Optimizes app performance'
    },
    restart_with_safe_mode: {
        id: 'restart_with_safe_mode',
        name: 'Restart in Safe Mode',
        type: 'remote_command',
        command: { action: 'restart', params: { safeMode: true, reportCrash: true } },
        description: 'Restarts app in safe mode'
    },
    show_engagement_prompt: {
        id: 'show_engagement_prompt',
        name: 'Show Engagement Prompt',
        type: 'ui_action',
        action: { type: 'show_tip', tip: 'quick_action_reminder' },
        description: 'Shows a helpful tip to re-engage user'
    },
    offer_help_proactively: {
        id: 'offer_help_proactively',
        name: 'Offer Help',
        type: 'ui_action',
        action: { type: 'show_help_widget', message: 'Need help? Click here!' },
        description: 'Proactively offers assistance'
    }
};

// ============ USER INTELLIGENCE SERVICE ============
class UserIntelligenceService {
    constructor() {
        this.behaviors = loadJSON(FILES.behaviors, { users: {}, sessions: {} });
        this.issues = loadJSON(FILES.issues, { detected: [], resolved: [], learning: [] });
        this.patterns = loadJSON(FILES.patterns, { learned: [], confidence: {} });
        this.feedback = loadJSON(FILES.feedback, { explicit: [], implicit: [], analyzed: [] });
        this.personalization = loadJSON(FILES.personalization, { profiles: {} });
        this.diagnostics = loadJSON(FILES.diagnostics, { devices: {}, checks: [] });
        this.remoteFixes = loadJSON(FILES.remoteFixes, { pending: [], applied: [], failed: [] });

        // Real-time tracking
        this.activeSessions = new Map();
        this.pendingFixes = new Map();

        console.log('[Intelligence] User Intelligence Service initialized');
    }

    // ============ BEHAVIOR TRACKING ============

    /**
     * Track user behavior event
     */
    trackBehavior(userId, deviceId, event) {
        const timestamp = Date.now();
        const sessionId = this.getOrCreateSession(userId, deviceId);

        const behaviorEvent = {
            id: uuidv4(),
            userId,
            deviceId,
            sessionId,
            timestamp,
            type: event.type,
            action: event.action,
            target: event.target || null,
            metadata: event.metadata || {},
            context: {
                page: event.page || 'unknown',
                component: event.component || null,
                previousAction: this.getLastAction(sessionId),
                timeSinceLastAction: this.getTimeSinceLastAction(sessionId)
            }
        };

        // Store in session
        if (!this.activeSessions.has(sessionId)) {
            this.activeSessions.set(sessionId, { events: [], startTime: timestamp });
        }
        this.activeSessions.get(sessionId).events.push(behaviorEvent);

        // Analyze for patterns in real-time
        this.analyzeRealTime(sessionId, behaviorEvent);

        // Save periodically (every 10 events)
        const session = this.activeSessions.get(sessionId);
        if (session.events.length % 10 === 0) {
            this.persistSession(sessionId);
        }

        return behaviorEvent;
    }

    /**
     * Get or create session for user
     */
    getOrCreateSession(userId, deviceId) {
        const sessionKey = `${userId}_${deviceId}`;

        // Check for existing active session (within 30 minutes)
        if (this.behaviors.sessions[sessionKey]) {
            const lastActivity = this.behaviors.sessions[sessionKey].lastActivity;
            if (Date.now() - lastActivity < 30 * 60 * 1000) {
                this.behaviors.sessions[sessionKey].lastActivity = Date.now();
                return this.behaviors.sessions[sessionKey].id;
            }
        }

        // Create new session
        const sessionId = uuidv4();
        this.behaviors.sessions[sessionKey] = {
            id: sessionId,
            userId,
            deviceId,
            startTime: Date.now(),
            lastActivity: Date.now()
        };

        return sessionId;
    }

    /**
     * Get last action from session
     */
    getLastAction(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session || session.events.length === 0) return null;
        return session.events[session.events.length - 1].action;
    }

    /**
     * Get time since last action
     */
    getTimeSinceLastAction(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session || session.events.length === 0) return 0;
        return Date.now() - session.events[session.events.length - 1].timestamp;
    }

    // ============ REAL-TIME ANALYSIS ============

    /**
     * Analyze behavior in real-time for issues
     */
    analyzeRealTime(sessionId, event) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const recentEvents = session.events.slice(-20); // Last 20 events
        const detectedIssues = [];

        // Check each pattern
        for (const [patternId, pattern] of Object.entries(ISSUE_PATTERNS)) {
            const match = this.matchPattern(pattern, recentEvents, event);
            if (match.detected) {
                detectedIssues.push({
                    patternId,
                    pattern,
                    confidence: match.confidence,
                    signals: match.matchedSignals
                });
            }
        }

        // Handle detected issues
        for (const issue of detectedIssues) {
            this.handleDetectedIssue(session, issue);
        }

        // Check for engagement patterns
        this.analyzeEngagement(session, recentEvents);

        // Update learned patterns
        this.updateLearnedPatterns(session, event);
    }

    /**
     * Match behavior against issue pattern
     */
    matchPattern(pattern, recentEvents, currentEvent) {
        const matchedSignals = [];
        let confidence = 0;

        for (const signal of pattern.signals) {
            // Parse signal (can be simple or conditional)
            if (signal.includes('>') || signal.includes('<')) {
                // Conditional signal (e.g., "capture_time > 2000ms")
                const [metric, operator, value] = signal.split(/\s*(>|<)\s*/);
                const numValue = parseInt(value);

                if (currentEvent.metadata[metric]) {
                    const actual = currentEvent.metadata[metric];
                    if ((operator === '>' && actual > numValue) ||
                        (operator === '<' && actual < numValue)) {
                        matchedSignals.push(signal);
                        confidence += 25;
                    }
                }
            } else {
                // Simple signal match
                const matchingEvents = recentEvents.filter(e =>
                    e.type === signal ||
                    e.action === signal ||
                    (e.metadata && e.metadata.signal === signal)
                );

                if (matchingEvents.length > 0) {
                    matchedSignals.push(signal);
                    confidence += 25;
                }

                // Check for repeated signals (frustration indicator)
                if (matchingEvents.length >= 3) {
                    confidence += 15;
                }
            }
        }

        return {
            detected: confidence >= 50,
            confidence: Math.min(100, confidence),
            matchedSignals
        };
    }

    /**
     * Handle a detected issue
     */
    handleDetectedIssue(session, issue) {
        const { userId, deviceId } = this.behaviors.sessions[
            Object.keys(this.behaviors.sessions).find(k =>
                this.behaviors.sessions[k].id === session.id
            )
        ] || {};

        const detectedIssue = {
            id: uuidv4(),
            patternId: issue.patternId,
            severity: issue.pattern.severity,
            confidence: issue.confidence,
            signals: issue.signals,
            userId,
            deviceId,
            sessionId: session.id,
            detectedAt: Date.now(),
            status: 'detected',
            autoFixApplied: false
        };

        this.issues.detected.push(detectedIssue);

        console.log(`[Intelligence] Issue detected: ${issue.pattern.name} (${issue.confidence}% confidence)`);

        // Auto-fix if confidence is high enough
        if (issue.confidence >= 70 && issue.pattern.autoFix) {
            this.applyAutoFix(detectedIssue, issue.pattern.autoFix);
        }

        // Add to learning queue
        this.issues.learning.push({
            ...detectedIssue,
            needsValidation: issue.confidence < 90
        });

        this.saveIssues();

        return detectedIssue;
    }

    /**
     * Apply auto-fix for detected issue
     */
    applyAutoFix(issue, fixId) {
        const fix = AUTO_FIX_ACTIONS[fixId];
        if (!fix) {
            console.warn(`[Intelligence] Unknown fix action: ${fixId}`);
            return null;
        }

        const remoteFix = {
            id: uuidv4(),
            issueId: issue.id,
            fixId,
            fix,
            userId: issue.userId,
            deviceId: issue.deviceId,
            status: 'pending',
            createdAt: Date.now(),
            appliedAt: null,
            result: null
        };

        this.remoteFixes.pending.push(remoteFix);
        this.pendingFixes.set(issue.deviceId, remoteFix);

        console.log(`[Intelligence] Auto-fix queued: ${fix.name} for device ${issue.deviceId}`);

        this.saveRemoteFixes();

        return remoteFix;
    }

    /**
     * Get pending fixes for a device
     */
    getPendingFixes(deviceId) {
        return this.remoteFixes.pending.filter(f => f.deviceId === deviceId && f.status === 'pending');
    }

    /**
     * Mark fix as applied
     */
    markFixApplied(fixId, result) {
        const fixIndex = this.remoteFixes.pending.findIndex(f => f.id === fixId);
        if (fixIndex === -1) return null;

        const fix = this.remoteFixes.pending[fixIndex];
        fix.status = result.success ? 'applied' : 'failed';
        fix.appliedAt = Date.now();
        fix.result = result;

        // Move to appropriate list
        this.remoteFixes.pending.splice(fixIndex, 1);
        if (result.success) {
            this.remoteFixes.applied.push(fix);
        } else {
            this.remoteFixes.failed.push(fix);
        }

        // Update issue status
        const issue = this.issues.detected.find(i => i.id === fix.issueId);
        if (issue) {
            issue.autoFixApplied = result.success;
            issue.status = result.success ? 'auto_resolved' : 'fix_failed';
        }

        this.saveRemoteFixes();
        this.saveIssues();

        return fix;
    }

    // ============ ENGAGEMENT ANALYSIS ============

    /**
     * Analyze user engagement patterns
     */
    analyzeEngagement(session, recentEvents) {
        const engagement = {
            score: 100,
            factors: [],
            recommendations: []
        };

        // Check for idle time
        const idleTime = this.calculateIdleTime(recentEvents);
        if (idleTime > 60000) { // More than 1 minute
            engagement.score -= 20;
            engagement.factors.push('long_idle');
        }

        // Check for incomplete actions
        const incompleteActions = this.detectIncompleteActions(recentEvents);
        if (incompleteActions.length > 0) {
            engagement.score -= 10 * incompleteActions.length;
            engagement.factors.push('incomplete_actions');
            engagement.recommendations.push('offer_completion_help');
        }

        // Check for repeated failures
        const failures = recentEvents.filter(e => e.type === 'error' || e.action?.includes('failed'));
        if (failures.length >= 3) {
            engagement.score -= 30;
            engagement.factors.push('repeated_failures');
            engagement.recommendations.push('proactive_support');
        }

        // Check for exploration behavior (positive)
        const uniquePages = new Set(recentEvents.map(e => e.context.page)).size;
        if (uniquePages >= 3) {
            engagement.score += 10;
            engagement.factors.push('exploring_features');
        }

        // Check for frustration signals
        const frustrationScore = this.calculateFrustration(recentEvents);
        if (frustrationScore > 50) {
            engagement.score -= frustrationScore / 2;
            engagement.factors.push('frustration_detected');
            engagement.recommendations.push('offer_help');
        }

        // Store engagement data
        session.engagement = engagement;

        return engagement;
    }

    /**
     * Calculate idle time from events
     */
    calculateIdleTime(events) {
        if (events.length < 2) return 0;

        let maxIdle = 0;
        for (let i = 1; i < events.length; i++) {
            const idle = events[i].timestamp - events[i-1].timestamp;
            maxIdle = Math.max(maxIdle, idle);
        }
        return maxIdle;
    }

    /**
     * Detect incomplete actions
     */
    detectIncompleteActions(events) {
        const incomplete = [];
        const actionPairs = {
            'capture_start': 'capture_complete',
            'upload_start': 'upload_complete',
            'modal_open': 'modal_close',
            'form_start': 'form_submit'
        };

        for (const [start, end] of Object.entries(actionPairs)) {
            const starts = events.filter(e => e.action === start);
            const ends = events.filter(e => e.action === end);

            if (starts.length > ends.length) {
                incomplete.push({ action: start, count: starts.length - ends.length });
            }
        }

        return incomplete;
    }

    /**
     * Calculate frustration score
     */
    calculateFrustration(events) {
        let score = 0;
        const recentMs = 30000; // Last 30 seconds
        const now = Date.now();
        const recent = events.filter(e => now - e.timestamp < recentMs);

        // Rapid clicking (more than 5 clicks in 5 seconds)
        const clicks = recent.filter(e => e.type === 'click');
        if (clicks.length > 5) {
            const clickSpan = clicks[clicks.length - 1].timestamp - clicks[0].timestamp;
            if (clickSpan < 5000) {
                score += 30; // Rage clicking
            }
        }

        // Same action repeated
        const actionCounts = {};
        recent.forEach(e => {
            actionCounts[e.action] = (actionCounts[e.action] || 0) + 1;
        });
        const maxRepeat = Math.max(...Object.values(actionCounts));
        if (maxRepeat >= 5) {
            score += 20;
        }

        // Error events
        const errors = recent.filter(e => e.type === 'error');
        score += errors.length * 10;

        // Escape key presses
        const escapes = recent.filter(e => e.action === 'key_escape');
        score += escapes.length * 5;

        return Math.min(100, score);
    }

    // ============ PATTERN LEARNING ============

    /**
     * Update learned patterns based on new data
     */
    updateLearnedPatterns(session, event) {
        const userId = Object.values(this.behaviors.sessions).find(s => s.id === session.id)?.userId;
        if (!userId) return;

        // Get or create user pattern profile
        if (!this.patterns.learned[userId]) {
            this.patterns.learned[userId] = {
                commonActions: {},
                preferredFeatures: [],
                usagePatterns: {},
                peakUsageTimes: {},
                capturePreferences: {},
                navigationStyle: null
            };
        }

        const profile = this.patterns.learned[userId];

        // Track common actions
        profile.commonActions[event.action] = (profile.commonActions[event.action] || 0) + 1;

        // Track usage time
        const hour = new Date().getHours();
        profile.peakUsageTimes[hour] = (profile.peakUsageTimes[hour] || 0) + 1;

        // Track feature usage
        if (event.context.component) {
            const featureIndex = profile.preferredFeatures.findIndex(f => f.name === event.context.component);
            if (featureIndex === -1) {
                profile.preferredFeatures.push({ name: event.context.component, useCount: 1 });
            } else {
                profile.preferredFeatures[featureIndex].useCount++;
            }
            // Sort by use count
            profile.preferredFeatures.sort((a, b) => b.useCount - a.useCount);
        }

        // Detect navigation style
        const navEvents = session.events.filter(e => e.type === 'navigation');
        if (navEvents.length >= 10) {
            const avgTimeBetweenNav = navEvents.reduce((sum, e, i) => {
                if (i === 0) return 0;
                return sum + (e.timestamp - navEvents[i-1].timestamp);
            }, 0) / (navEvents.length - 1);

            if (avgTimeBetweenNav < 3000) {
                profile.navigationStyle = 'fast_scanner';
            } else if (avgTimeBetweenNav > 10000) {
                profile.navigationStyle = 'careful_reader';
            } else {
                profile.navigationStyle = 'balanced';
            }
        }

        // Save periodically
        if (Math.random() < 0.1) { // 10% chance to save
            this.savePatterns();
        }
    }

    // ============ FEEDBACK COLLECTION ============

    /**
     * Collect explicit feedback from user
     */
    collectExplicitFeedback(userId, deviceId, feedback) {
        const feedbackEntry = {
            id: uuidv4(),
            userId,
            deviceId,
            type: 'explicit',
            rating: feedback.rating || null,
            category: feedback.category || 'general',
            message: feedback.message || '',
            context: {
                page: feedback.page || 'unknown',
                feature: feedback.feature || null,
                action: feedback.action || null
            },
            sentiment: this.analyzeSentiment(feedback.message),
            createdAt: Date.now()
        };

        this.feedback.explicit.push(feedbackEntry);
        this.saveFeedback();

        console.log(`[Intelligence] Explicit feedback collected from user ${userId}`);

        return feedbackEntry;
    }

    /**
     * Collect implicit feedback from behavior
     */
    collectImplicitFeedback(userId, deviceId, behavior) {
        const feedbackEntry = {
            id: uuidv4(),
            userId,
            deviceId,
            type: 'implicit',
            signal: behavior.signal,
            interpretation: behavior.interpretation,
            confidence: behavior.confidence || 50,
            context: behavior.context || {},
            createdAt: Date.now()
        };

        this.feedback.implicit.push(feedbackEntry);

        // Analyze if we have enough data
        if (this.feedback.implicit.length % 100 === 0) {
            this.analyzeImplicitFeedback();
        }

        return feedbackEntry;
    }

    /**
     * Simple sentiment analysis
     */
    analyzeSentiment(text) {
        if (!text) return 'neutral';

        const positive = ['great', 'awesome', 'love', 'excellent', 'amazing', 'good', 'nice', 'helpful', 'easy', 'fast'];
        const negative = ['bad', 'terrible', 'hate', 'awful', 'slow', 'broken', 'bug', 'error', 'crash', 'frustrating', 'confusing'];

        const words = text.toLowerCase().split(/\s+/);
        let score = 0;

        words.forEach(word => {
            if (positive.includes(word)) score++;
            if (negative.includes(word)) score--;
        });

        if (score > 0) return 'positive';
        if (score < 0) return 'negative';
        return 'neutral';
    }

    /**
     * Analyze implicit feedback patterns
     */
    analyzeImplicitFeedback() {
        const recent = this.feedback.implicit.slice(-500);

        const analysis = {
            analyzedAt: Date.now(),
            sampleSize: recent.length,
            signals: {},
            insights: []
        };

        // Count signals
        recent.forEach(f => {
            analysis.signals[f.signal] = (analysis.signals[f.signal] || 0) + 1;
        });

        // Generate insights
        const sortedSignals = Object.entries(analysis.signals).sort((a, b) => b[1] - a[1]);

        if (sortedSignals.length > 0) {
            analysis.insights.push({
                type: 'most_common_signal',
                signal: sortedSignals[0][0],
                count: sortedSignals[0][1],
                percentage: ((sortedSignals[0][1] / recent.length) * 100).toFixed(1)
            });
        }

        this.feedback.analyzed.push(analysis);
        this.saveFeedback();

        return analysis;
    }

    // ============ UI PERSONALIZATION ============

    /**
     * Get personalization profile for user
     */
    getPersonalizationProfile(userId) {
        if (!this.personalization.profiles[userId]) {
            this.personalization.profiles[userId] = this.createDefaultProfile(userId);
        }
        return this.personalization.profiles[userId];
    }

    /**
     * Create default personalization profile
     */
    createDefaultProfile(userId) {
        return {
            userId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ui: {
                theme: 'auto',
                density: 'comfortable',
                animations: true,
                soundEffects: true,
                quickActions: ['capture', 'upload', 'gallery'],
                sidebarCollapsed: false,
                tooltipsEnabled: true
            },
            features: {
                shortcuts: {
                    capture: 'Ctrl+Shift+S',
                    areaCapture: 'Ctrl+Shift+A'
                },
                autoUpload: true,
                autoCopyLink: true,
                soundOnCapture: true
            },
            behavior: {
                skillLevel: 'beginner', // beginner, intermediate, advanced
                preferredWorkflow: 'quick_capture', // quick_capture, detailed_editing, batch_processing
                helpLevel: 'full' // full, minimal, none
            },
            recommendations: [],
            adaptations: []
        };
    }

    /**
     * Update personalization based on behavior
     */
    updatePersonalization(userId, behaviorData) {
        const profile = this.getPersonalizationProfile(userId);
        const patterns = this.patterns.learned[userId];

        if (!patterns) return profile;

        // Adapt skill level based on usage
        const totalActions = Object.values(patterns.commonActions).reduce((a, b) => a + b, 0);
        if (totalActions > 1000) {
            profile.behavior.skillLevel = 'advanced';
            profile.behavior.helpLevel = 'minimal';
        } else if (totalActions > 100) {
            profile.behavior.skillLevel = 'intermediate';
            profile.behavior.helpLevel = 'minimal';
        }

        // Adapt UI based on navigation style
        if (patterns.navigationStyle === 'fast_scanner') {
            profile.ui.density = 'compact';
            profile.ui.animations = false;
        } else if (patterns.navigationStyle === 'careful_reader') {
            profile.ui.density = 'comfortable';
            profile.ui.tooltipsEnabled = true;
        }

        // Recommend features based on usage
        if (patterns.preferredFeatures.length > 0) {
            profile.ui.quickActions = patterns.preferredFeatures
                .slice(0, 5)
                .map(f => f.name);
        }

        // Track adaptations
        profile.adaptations.push({
            timestamp: Date.now(),
            reason: 'behavior_analysis',
            changes: ['skillLevel', 'helpLevel', 'density']
        });

        profile.updatedAt = Date.now();
        this.savePersonalization();

        return profile;
    }

    /**
     * Get UI recommendations for user
     */
    getUIRecommendations(userId) {
        const profile = this.getPersonalizationProfile(userId);
        const patterns = this.patterns.learned[userId];
        const recommendations = [];

        if (!patterns) return recommendations;

        // Recommend based on peak usage times
        const peakHour = Object.entries(patterns.peakUsageTimes || {})
            .sort((a, b) => b[1] - a[1])[0];

        if (peakHour) {
            const hour = parseInt(peakHour[0]);
            if (hour >= 20 || hour <= 6) {
                recommendations.push({
                    type: 'theme',
                    suggestion: 'dark',
                    reason: 'You often use DOZ UP in the evening/night'
                });
            }
        }

        // Recommend based on most used features
        if (patterns.preferredFeatures.length > 0) {
            const topFeature = patterns.preferredFeatures[0];
            recommendations.push({
                type: 'quick_action',
                suggestion: topFeature.name,
                reason: `You use ${topFeature.name} frequently`
            });
        }

        // Recommend based on skill level
        if (profile.behavior.skillLevel === 'advanced') {
            recommendations.push({
                type: 'shortcuts',
                suggestion: 'enable_all_shortcuts',
                reason: 'You\'re an advanced user - try keyboard shortcuts for faster workflow'
            });
        }

        profile.recommendations = recommendations;
        this.savePersonalization();

        return recommendations;
    }

    // ============ REMOTE DIAGNOSTICS ============

    /**
     * Run diagnostics on device
     */
    runDiagnostics(deviceId, deviceInfo) {
        const diagnostic = {
            id: uuidv4(),
            deviceId,
            timestamp: Date.now(),
            info: deviceInfo,
            checks: [],
            issues: [],
            recommendations: []
        };

        // Check version
        if (deviceInfo.version !== '2.7.0') {
            diagnostic.checks.push({ name: 'version', status: 'warning', message: 'Not on latest version' });
            diagnostic.issues.push('outdated_version');
            diagnostic.recommendations.push({
                action: 'update',
                priority: 'high',
                message: 'Update to v2.7.0 for latest features and fixes'
            });
        } else {
            diagnostic.checks.push({ name: 'version', status: 'ok', message: 'On latest version' });
        }

        // Check connectivity
        if (deviceInfo.lastSeen && Date.now() - deviceInfo.lastSeen > 300000) {
            diagnostic.checks.push({ name: 'connectivity', status: 'warning', message: 'Device not seen recently' });
        } else {
            diagnostic.checks.push({ name: 'connectivity', status: 'ok', message: 'Device connected' });
        }

        // Check performance
        if (deviceInfo.memory && deviceInfo.memory.heapUsed > 500 * 1024 * 1024) {
            diagnostic.checks.push({ name: 'memory', status: 'warning', message: 'High memory usage' });
            diagnostic.issues.push('high_memory');
            diagnostic.recommendations.push({
                action: 'restart',
                priority: 'medium',
                message: 'Restart app to free memory'
            });
        }

        // Store diagnostic
        this.diagnostics.devices[deviceId] = {
            lastDiagnostic: diagnostic,
            history: (this.diagnostics.devices[deviceId]?.history || []).concat(diagnostic.id).slice(-10)
        };
        this.diagnostics.checks.push(diagnostic);

        this.saveDiagnostics();

        return diagnostic;
    }

    /**
     * Get device health status
     */
    getDeviceHealth(deviceId) {
        const device = this.diagnostics.devices[deviceId];
        if (!device || !device.lastDiagnostic) {
            return { status: 'unknown', message: 'No diagnostic data' };
        }

        const diag = device.lastDiagnostic;
        const errorCount = diag.checks.filter(c => c.status === 'error').length;
        const warningCount = diag.checks.filter(c => c.status === 'warning').length;

        if (errorCount > 0) {
            return { status: 'error', message: `${errorCount} critical issues`, issues: diag.issues };
        } else if (warningCount > 0) {
            return { status: 'warning', message: `${warningCount} warnings`, issues: diag.issues };
        }
        return { status: 'healthy', message: 'All systems normal', issues: [] };
    }

    // ============ PERSISTENCE ============

    persistSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        // Store session data
        if (!this.behaviors.users[sessionId]) {
            this.behaviors.users[sessionId] = [];
        }
        this.behaviors.users[sessionId] = session.events;

        saveJSON(FILES.behaviors, this.behaviors);
    }

    saveIssues() { saveJSON(FILES.issues, this.issues); }
    savePatterns() { saveJSON(FILES.patterns, this.patterns); }
    saveFeedback() { saveJSON(FILES.feedback, this.feedback); }
    savePersonalization() { saveJSON(FILES.personalization, this.personalization); }
    saveDiagnostics() { saveJSON(FILES.diagnostics, this.diagnostics); }
    saveRemoteFixes() { saveJSON(FILES.remoteFixes, this.remoteFixes); }

    // ============ API METHODS ============

    /**
     * Get all stats for dashboard
     */
    getStats() {
        return {
            activeSessions: this.activeSessions.size,
            totalBehaviors: Object.keys(this.behaviors.users).length,
            detectedIssues: this.issues.detected.length,
            resolvedIssues: this.issues.resolved.length,
            pendingFixes: this.remoteFixes.pending.length,
            appliedFixes: this.remoteFixes.applied.length,
            feedbackCount: this.feedback.explicit.length + this.feedback.implicit.length,
            personalizedUsers: Object.keys(this.personalization.profiles).length,
            learnedPatterns: Object.keys(this.patterns.learned).length
        };
    }

    /**
     * Get issue patterns for reference
     */
    getIssuePatterns() {
        return ISSUE_PATTERNS;
    }

    /**
     * Get auto-fix actions for reference
     */
    getAutoFixActions() {
        return AUTO_FIX_ACTIONS;
    }
}

// Export singleton
module.exports = new UserIntelligenceService();
module.exports.ISSUE_PATTERNS = ISSUE_PATTERNS;
module.exports.AUTO_FIX_ACTIONS = AUTO_FIX_ACTIONS;
