/**
 * DOZ UP - Content Moderation Service
 * Enterprise-grade content moderation with auto-moderation rules and queue management
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Data storage paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'content-reports.json');
const RULES_FILE = path.join(DATA_DIR, 'moderation-rules.json');
const MOD_LOG_FILE = path.join(DATA_DIR, 'moderation-log.json');
const BANNED_WORDS_FILE = path.join(DATA_DIR, 'banned-words.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function loadData(filePath, defaultValue = []) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[Moderation] Error loading ${filePath}:`, e.message);
    }
    return defaultValue;
}

function saveData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error(`[Moderation] Error saving ${filePath}:`, e.message);
        return false;
    }
}

// Initialize default banned words
function initializeBannedWords() {
    const words = loadData(BANNED_WORDS_FILE);
    if (words.length === 0) {
        // Minimal default list - admin should configure
        const defaults = ['spam', 'scam', 'malware'];
        saveData(BANNED_WORDS_FILE, defaults);
    }
}

initializeBannedWords();

// Report reasons
const REPORT_REASONS = {
    SPAM: 'Spam or advertising',
    INAPPROPRIATE: 'Inappropriate content',
    COPYRIGHT: 'Copyright violation',
    HARASSMENT: 'Harassment or bullying',
    MALWARE: 'Malware or harmful content',
    OTHER: 'Other'
};

// Content types
const CONTENT_TYPES = ['UPLOAD', 'COMMENT', 'PROFILE', 'MESSAGE'];

// Report statuses
const REPORT_STATUSES = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'];

// Moderation actions
const MOD_ACTIONS = ['APPROVED', 'REMOVED', 'WARNING_SENT', 'USER_BANNED', 'NO_ACTION'];

// ============ CONTENT REPORTS ============

/**
 * Submit a content report
 */
function submitReport(contentId, contentType, reason, description = null, reporterId = null, reporterIp = null) {
    if (!CONTENT_TYPES.includes(contentType)) {
        return { error: 'Invalid content type' };
    }

    if (!Object.keys(REPORT_REASONS).includes(reason)) {
        return { error: 'Invalid report reason' };
    }

    const reports = loadData(REPORTS_FILE);

    // Check for duplicate reports
    const existingReport = reports.find(r =>
        r.contentId === contentId &&
        r.reporterId === reporterId &&
        r.status === 'PENDING'
    );

    if (existingReport) {
        return { error: 'You have already reported this content' };
    }

    const report = {
        id: uuidv4(),
        contentId,
        contentType,
        reporterId,
        reporterIp,
        reason,
        description,
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        action: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    reports.push(report);
    saveData(REPORTS_FILE, reports);

    // Log the report
    logModeration(contentId, contentType, 'REPORT_SUBMITTED', `Report submitted: ${reason}`, null, null, true);

    return report;
}

/**
 * Get moderation queue (pending reports)
 */
function getQueue(filters = {}) {
    const reports = loadData(REPORTS_FILE);

    let filtered = reports;

    // Filter by status
    if (filters.status) {
        filtered = filtered.filter(r => r.status === filters.status);
    } else {
        // Default to pending reports
        filtered = filtered.filter(r => r.status === 'PENDING' || r.status === 'REVIEWING');
    }

    // Filter by content type
    if (filters.contentType) {
        filtered = filtered.filter(r => r.contentType === filters.contentType);
    }

    // Filter by reason
    if (filters.reason) {
        filtered = filtered.filter(r => r.reason === filters.reason);
    }

    // Sort by date (oldest first for queue processing)
    filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const start = (page - 1) * limit;

    return {
        reports: filtered.slice(start, start + limit),
        total: filtered.length,
        page,
        totalPages: Math.ceil(filtered.length / limit)
    };
}

/**
 * Get report by ID
 */
function getReport(reportId) {
    const reports = loadData(REPORTS_FILE);
    return reports.find(r => r.id === reportId);
}

/**
 * Update report status (claim for review)
 */
function claimReport(reportId, adminId) {
    const reports = loadData(REPORTS_FILE);
    const index = reports.findIndex(r => r.id === reportId);

    if (index === -1) return { error: 'Report not found' };

    if (reports[index].status !== 'PENDING') {
        return { error: 'Report already being reviewed' };
    }

    reports[index].status = 'REVIEWING';
    reports[index].reviewedBy = adminId;
    reports[index].updatedAt = new Date().toISOString();

    saveData(REPORTS_FILE, reports);
    return reports[index];
}

/**
 * Resolve a report
 */
function resolveReport(reportId, adminId, adminName, action, reviewNote = null) {
    if (!MOD_ACTIONS.includes(action)) {
        return { error: 'Invalid action' };
    }

    const reports = loadData(REPORTS_FILE);
    const index = reports.findIndex(r => r.id === reportId);

    if (index === -1) return { error: 'Report not found' };

    const report = reports[index];
    reports[index].status = action === 'NO_ACTION' ? 'DISMISSED' : 'RESOLVED';
    reports[index].reviewedBy = adminId;
    reports[index].reviewedAt = new Date().toISOString();
    reports[index].reviewNote = reviewNote;
    reports[index].action = action;
    reports[index].updatedAt = new Date().toISOString();

    saveData(REPORTS_FILE, reports);

    // Log the moderation action
    logModeration(report.contentId, report.contentType, action, reviewNote, adminId, adminName, false);

    return reports[index];
}

/**
 * Bulk resolve reports
 */
function bulkResolve(reportIds, adminId, adminName, action, reviewNote = null) {
    const results = {
        success: [],
        failed: []
    };

    for (const reportId of reportIds) {
        const result = resolveReport(reportId, adminId, adminName, action, reviewNote);
        if (result.error) {
            results.failed.push({ reportId, error: result.error });
        } else {
            results.success.push(reportId);
        }
    }

    return results;
}

// ============ AUTO-MODERATION RULES ============

/**
 * Create a moderation rule
 */
function createRule(name, ruleType, pattern, action = 'REMOVED', severity = 1, description = null, createdBy = null) {
    const rules = loadData(RULES_FILE);

    const rule = {
        id: uuidv4(),
        name,
        description,
        ruleType, // 'keyword', 'regex', 'hash', 'ml'
        pattern,
        action,
        severity,
        isActive: true,
        hitCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy
    };

    rules.push(rule);
    saveData(RULES_FILE, rules);

    return rule;
}

/**
 * Get all rules
 */
function getAllRules(includeInactive = false) {
    const rules = loadData(RULES_FILE);
    if (includeInactive) return rules;
    return rules.filter(r => r.isActive);
}

/**
 * Get rule by ID
 */
function getRule(ruleId) {
    const rules = loadData(RULES_FILE);
    return rules.find(r => r.id === ruleId);
}

/**
 * Update a rule
 */
function updateRule(ruleId, updates) {
    const rules = loadData(RULES_FILE);
    const index = rules.findIndex(r => r.id === ruleId);

    if (index === -1) return { error: 'Rule not found' };

    rules[index] = {
        ...rules[index],
        ...updates,
        updatedAt: new Date().toISOString()
    };

    saveData(RULES_FILE, rules);
    return rules[index];
}

/**
 * Delete a rule
 */
function deleteRule(ruleId) {
    const rules = loadData(RULES_FILE);
    const index = rules.findIndex(r => r.id === ruleId);

    if (index === -1) return false;

    rules.splice(index, 1);
    saveData(RULES_FILE, rules);
    return true;
}

/**
 * Check content against moderation rules
 */
function checkContent(content, contentType) {
    const rules = getAllRules();
    const violations = [];

    for (const rule of rules) {
        let matches = false;

        switch (rule.ruleType) {
            case 'keyword':
                // Simple keyword matching (case-insensitive)
                matches = content.toLowerCase().includes(rule.pattern.toLowerCase());
                break;

            case 'regex':
                try {
                    const regex = new RegExp(rule.pattern, 'gi');
                    matches = regex.test(content);
                } catch (e) {
                    console.error(`[Moderation] Invalid regex in rule ${rule.id}:`, e.message);
                }
                break;

            case 'hash':
                // Content hash matching (for file uploads)
                matches = content === rule.pattern;
                break;

            default:
                break;
        }

        if (matches) {
            violations.push({
                ruleId: rule.id,
                ruleName: rule.name,
                action: rule.action,
                severity: rule.severity
            });

            // Increment hit count
            incrementRuleHitCount(rule.id);
        }
    }

    return {
        isViolation: violations.length > 0,
        violations,
        recommendedAction: violations.length > 0 ? violations[0].action : null
    };
}

/**
 * Increment rule hit count
 */
function incrementRuleHitCount(ruleId) {
    const rules = loadData(RULES_FILE);
    const index = rules.findIndex(r => r.id === ruleId);

    if (index !== -1) {
        rules[index].hitCount = (rules[index].hitCount || 0) + 1;
        saveData(RULES_FILE, rules);
    }
}

// ============ BANNED WORDS ============

/**
 * Get banned words list
 */
function getBannedWords() {
    return loadData(BANNED_WORDS_FILE);
}

/**
 * Add banned word
 */
function addBannedWord(word) {
    const words = loadData(BANNED_WORDS_FILE);

    if (words.includes(word.toLowerCase())) {
        return { error: 'Word already banned' };
    }

    words.push(word.toLowerCase());
    saveData(BANNED_WORDS_FILE, words);

    // Create corresponding rule
    createRule(`Banned word: ${word}`, 'keyword', word, 'REMOVED', 3, 'Auto-generated rule for banned word');

    return { success: true };
}

/**
 * Remove banned word
 */
function removeBannedWord(word) {
    const words = loadData(BANNED_WORDS_FILE);
    const index = words.indexOf(word.toLowerCase());

    if (index === -1) return { error: 'Word not found' };

    words.splice(index, 1);
    saveData(BANNED_WORDS_FILE, words);
    return { success: true };
}

// ============ MODERATION LOG ============

/**
 * Log a moderation action
 */
function logModeration(contentId, contentType, action, reason = null, adminId = null, adminName = null, isAutomatic = false, ruleId = null, metadata = {}) {
    const logs = loadData(MOD_LOG_FILE);

    const logEntry = {
        id: uuidv4(),
        contentId,
        contentType,
        action,
        reason,
        adminId,
        adminName,
        ruleId,
        isAutomatic,
        metadata,
        createdAt: new Date().toISOString()
    };

    logs.push(logEntry);

    // Keep only last 10000 entries
    if (logs.length > 10000) {
        logs.shift();
    }

    saveData(MOD_LOG_FILE, logs);
    return logEntry;
}

/**
 * Get moderation log
 */
function getLog(filters = {}) {
    const logs = loadData(MOD_LOG_FILE);

    let filtered = logs;

    if (filters.contentId) {
        filtered = filtered.filter(l => l.contentId === filters.contentId);
    }

    if (filters.adminId) {
        filtered = filtered.filter(l => l.adminId === filters.adminId);
    }

    if (filters.action) {
        filtered = filtered.filter(l => l.action === filters.action);
    }

    if (filters.isAutomatic !== undefined) {
        filtered = filtered.filter(l => l.isAutomatic === filters.isAutomatic);
    }

    // Sort by date (newest first)
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const start = (page - 1) * limit;

    return {
        entries: filtered.slice(start, start + limit),
        total: filtered.length,
        page,
        totalPages: Math.ceil(filtered.length / limit)
    };
}

// ============ STATISTICS ============

/**
 * Get moderation statistics
 */
function getStats() {
    const reports = loadData(REPORTS_FILE);
    const rules = loadData(RULES_FILE);
    const logs = loadData(MOD_LOG_FILE);
    const now = new Date();

    // Reports stats
    const pendingReports = reports.filter(r => r.status === 'PENDING').length;
    const reviewingReports = reports.filter(r => r.status === 'REVIEWING').length;
    const resolvedToday = reports.filter(r =>
        r.status === 'RESOLVED' &&
        new Date(r.resolvedAt) > new Date(now - 24 * 60 * 60 * 1000)
    ).length;

    // Calculate average resolution time
    const resolvedReports = reports.filter(r => r.status === 'RESOLVED' && r.reviewedAt);
    let avgResolutionTime = 0;
    if (resolvedReports.length > 0) {
        const totalTime = resolvedReports.reduce((sum, r) => {
            return sum + (new Date(r.reviewedAt) - new Date(r.createdAt));
        }, 0);
        avgResolutionTime = Math.round(totalTime / resolvedReports.length / 1000 / 60); // in minutes
    }

    // Reports by reason
    const reportsByReason = {};
    for (const reason of Object.keys(REPORT_REASONS)) {
        reportsByReason[reason] = reports.filter(r => r.reason === reason).length;
    }

    // Actions taken
    const actionStats = {};
    for (const action of MOD_ACTIONS) {
        actionStats[action] = logs.filter(l => l.action === action).length;
    }

    // Auto vs manual
    const autoActions = logs.filter(l => l.isAutomatic).length;
    const manualActions = logs.filter(l => !l.isAutomatic).length;

    // Top rules by hits
    const topRules = rules
        .filter(r => r.hitCount > 0)
        .sort((a, b) => b.hitCount - a.hitCount)
        .slice(0, 10)
        .map(r => ({ id: r.id, name: r.name, hits: r.hitCount }));

    return {
        queue: {
            pending: pendingReports,
            reviewing: reviewingReports,
            total: pendingReports + reviewingReports
        },
        reports: {
            total: reports.length,
            resolvedToday,
            avgResolutionTime, // in minutes
            byReason: reportsByReason
        },
        rules: {
            total: rules.length,
            active: rules.filter(r => r.isActive).length,
            topRules
        },
        actions: {
            total: logs.length,
            auto: autoActions,
            manual: manualActions,
            breakdown: actionStats
        }
    };
}

module.exports = {
    // Constants
    REPORT_REASONS,
    CONTENT_TYPES,
    REPORT_STATUSES,
    MOD_ACTIONS,

    // Reports
    submitReport,
    getQueue,
    getReport,
    claimReport,
    resolveReport,
    bulkResolve,

    // Rules
    createRule,
    getAllRules,
    getRule,
    updateRule,
    deleteRule,
    checkContent,

    // Banned words
    getBannedWords,
    addBannedWord,
    removeBannedWord,

    // Log
    logModeration,
    getLog,

    // Stats
    getStats
};
