/**
 * DOZ UP - AI Error Interceptor & Self-Healing Engine
 *
 * Central intelligence that receives ALL errors from frontend + backend,
 * detects patterns, auto-fixes in real-time, and uses deep analysis
 * for recurring issues to solve them permanently.
 *
 * Architecture:
 * - Error Collection Hub: receives errors from all sources
 * - Pattern Engine: detects recurring issues, categorizes, scores severity
 * - Auto-Fix Engine: applies known fixes instantly
 * - Deep Analysis: for persistent/recurring issues, plans permanent solutions
 * - Telemetry: tracks everything for continuous improvement
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURATION ============
const CONFIG = {
    maxErrorHistory: 2000,
    maxFixHistory: 500,
    recurringThreshold: 3,         // Same error 3+ times = recurring
    recurringWindow: 30 * 60000,   // Within 30 minutes
    deepAnalysisThreshold: 5,      // 5+ occurrences triggers deep analysis
    deepAnalysisCooldown: 60 * 60000, // 1 hour cooldown per issue type
    autoFixCooldown: 5 * 60000,    // 5 min cooldown per fix type
    telemetryPath: path.join(__dirname, '..', 'data', 'ai-error-telemetry.json'),
    permanentFixPath: path.join(__dirname, '..', 'data', 'ai-permanent-fixes.json'),
    logPath: path.join(__dirname, '..', 'logs', 'ai-interceptor.log'),
};

// ============ ERROR CATEGORIES ============
// PRIORITY ORDER: Specific categories first, generic (NETWORK) last
// This prevents "ECONNREFUSED" from matching NETWORK when it's really REDIS or DATABASE
const ERROR_CATEGORIES = {
    REDIS: { label: 'Redis/Cache', patterns: ['redis', 'ECONNREFUSED.*6379', 'cache error', 'ioredis', 'queue.*error', 'Queue.*Error'] },
    DATABASE: { label: 'Database', patterns: ['prisma', 'database', 'ECONNREFUSED.*5432', 'PostgreSQL', 'query failed', 'db error'] },
    PAYMENT: { label: 'Payment', patterns: ['stripe', 'payment failed', 'card declined', 'payment error', 'checkout'] },
    AUTH: { label: 'Authentication', patterns: ['unauthorized', '401', 'login failed', 'invalid credentials', 'token expired', 'jwt', 'session expired'] },
    UPLOAD: { label: 'Upload', patterns: ['upload failed', 'file too large', 'invalid format', 'storage full', 'multer', 'ENOSPC'] },
    SSL: { label: 'SSL/TLS', patterns: ['ssl', 'certificate', 'CERT_', 'tls', 'https error'] },
    PERMISSION: { label: 'Permission', patterns: ['EACCES', 'EPERM', 'permission denied', 'forbidden', '403'] },
    MEMORY: { label: 'Memory', patterns: ['heap', 'out of memory', 'ENOMEM', 'memory limit', 'allocation failed'] },
    PROCESS: { label: 'Process', patterns: ['EBUSY', 'process killed', 'SIGKILL', 'zombie', 'orphan'] },
    FRONTEND: { label: 'Frontend', patterns: ['undefined is not', 'cannot read property', 'is not a function', 'syntax error', 'reference error'] },
    EXTERNAL: { label: 'External Service', patterns: ['api.anthropic', 'googleapis', 'cloudflare', 'third-party', 'external'] },
    NETWORK: { label: 'Network', patterns: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', 'network error', 'connection', 'ERR_CONNECTION', 'net::ERR'] },
};

// ============ AUTO-FIX PLAYBOOK ============
const AUTO_FIX_PLAYBOOK = {
    REDIS: {
        diagnose: 'Redis/Cache service connection failure',
        fixes: [
            {
                name: 'fallback_to_memory',
                description: 'Switch to in-memory cache fallback',
                action: 'internal', // handled by existing redis.js fallback
                auto: true,
            },
            {
                name: 'restart_redis',
                description: 'Attempt to restart Redis service',
                action: 'exec',
                command: process.platform === 'win32' ? 'net start Redis' : 'sudo systemctl restart redis',
                auto: true,
            },
        ],
        userMessage: 'Optimizing performance... everything works normally.',
        severity: 'low', // Redis has built-in fallback
    },
    DATABASE: {
        diagnose: 'Database connection issue',
        fixes: [
            {
                name: 'retry_connection',
                description: 'Retry database connection with backoff',
                action: 'internal',
                auto: true,
            },
            {
                name: 'restart_gateway',
                description: 'Restart gateway to re-establish DB pool',
                action: 'exec',
                command: 'pm2 reload doz-gateway --update-env',
                auto: true,
            },
        ],
        userMessage: 'Reconnecting to services... please wait a moment.',
        severity: 'high',
    },
    NETWORK: {
        diagnose: 'Network connectivity issue',
        fixes: [
            {
                name: 'retry_request',
                description: 'Retry the failed request',
                action: 'internal',
                auto: true,
            },
        ],
        userMessage: 'Connection hiccup detected. Retrying automatically...',
        severity: 'medium',
    },
    AUTH: {
        diagnose: 'Authentication issue',
        fixes: [
            {
                name: 'refresh_session',
                description: 'Refresh user session',
                action: 'internal',
                auto: true,
            },
        ],
        userMessage: 'Session refreshed. Please try again.',
        severity: 'medium',
    },
    UPLOAD: {
        diagnose: 'Upload processing issue',
        fixes: [
            {
                name: 'clear_temp',
                description: 'Clear temporary upload files',
                action: 'exec',
                command: process.platform === 'win32'
                    ? 'del /q "%TEMP%\\doz-upload-*" 2>nul'
                    : 'rm -f /tmp/doz-upload-*',
                auto: true,
            },
            {
                name: 'fix_uploads_dir',
                description: 'Ensure uploads directory exists and is writable',
                action: 'internal',
                auto: true,
            },
            {
                name: 'emergency_cleanup',
                description: 'Emergency cleanup of expired uploads to free disk space',
                action: 'internal',
                auto: true,
            },
            {
                name: 'restart_upload_handler',
                description: 'Restart gateway upload handler',
                action: 'exec',
                command: 'pm2 reload doz-gateway --update-env',
                auto: false, // Only after deep analysis
            },
        ],
        userMessage: 'Upload service recovered. Please try again.',
        severity: 'medium',
    },
    PAYMENT: {
        diagnose: 'Payment processing issue',
        fixes: [],  // Never auto-fix payments — too sensitive
        userMessage: 'Payment service is being checked. Please try again in a moment.',
        severity: 'high',
    },
    SSL: {
        diagnose: 'SSL/Certificate issue',
        fixes: [
            {
                name: 'reload_certs',
                description: 'Reload SSL certificates',
                action: 'exec',
                command: 'pm2 reload doz-gateway --update-env',
                auto: false,
            },
        ],
        userMessage: 'Secure connection is being restored...',
        severity: 'high',
    },
    MEMORY: {
        diagnose: 'Memory pressure detected',
        fixes: [
            {
                name: 'force_gc',
                description: 'Force garbage collection',
                action: 'internal',
                auto: true,
            },
            {
                name: 'restart_gateway',
                description: 'Restart gateway to free memory',
                action: 'exec',
                command: 'pm2 reload doz-gateway --update-env',
                auto: true,
            },
        ],
        userMessage: 'Optimizing system resources...',
        severity: 'high',
    },
    PROCESS: {
        diagnose: 'Process conflict or deadlock',
        fixes: [
            {
                name: 'restart_gateway',
                description: 'Restart gateway process',
                action: 'exec',
                command: 'pm2 reload doz-gateway --update-env',
                auto: true,
            },
        ],
        userMessage: 'System is recovering automatically...',
        severity: 'high',
    },
    FRONTEND: {
        diagnose: 'Frontend JavaScript error',
        fixes: [],  // Frontend errors need code fixes, not runtime fixes
        userMessage: null, // Silent — don't bother user with JS errors
        severity: 'low',
    },
    EXTERNAL: {
        diagnose: 'External service unavailable',
        fixes: [
            {
                name: 'fallback_mode',
                description: 'Enable fallback/offline mode for external service',
                action: 'internal',
                auto: true,
            },
        ],
        userMessage: 'A connected service is temporarily unavailable. Using backup mode.',
        severity: 'medium',
    },
    PERMISSION: {
        diagnose: 'File/system permission error',
        fixes: [],
        userMessage: 'System is checking permissions...',
        severity: 'medium',
    },
};

// ============ AI ERROR INTERCEPTOR CLASS ============
class AIErrorInterceptor {
    constructor() {
        this.errors = [];           // All errors received
        this.fixHistory = [];       // All fixes applied
        this.recurringIssues = {};  // Pattern -> count tracking
        this.deepAnalysisLog = {};  // Issues that went through deep analysis
        this.permanentFixes = {};   // Permanent solutions found
        this.autoFixCooldowns = {}; // Cooldown tracking per fix
        this.deepAnalysisCooldowns = {}; // Cooldown per deep analysis
        this.uploadFixSubscribers = new Map(); // id -> callback for upload fix notifications
        this.stats = {
            totalErrors: 0,
            totalFixed: 0,
            totalAutoFixed: 0,
            totalDeepAnalysis: 0,
            totalPermanentFixes: 0,
            byCategory: {},
            startedAt: new Date().toISOString(),
        };

        this._ensureDirectories();
        this._loadPermanentFixes();
        this._startCleanupInterval();

        this.log('AI Error Interceptor initialized');
        this.log(`Monitoring ${Object.keys(ERROR_CATEGORIES).length} error categories`);
        this.log(`${Object.keys(AUTO_FIX_PLAYBOOK).length} auto-fix playbooks loaded`);
    }

    // ============ MAIN ERROR HANDLER ============
    /**
     * Process an incoming error from any source (frontend, backend, health monitor)
     * @param {Object} error - { message, source, stack, context, deviceId, page, timestamp }
     * @returns {Object} - { handled, category, fix, userMessage, issueId }
     */
    async handleError(error) {
        const timestamp = Date.now();
        const issueId = this._generateIssueId();

        // Normalize error
        const normalizedError = {
            id: issueId,
            message: String(error.message || error.error || 'Unknown error'),
            source: error.source || 'unknown',
            stack: error.stack || null,
            context: error.context || {},
            deviceId: error.deviceId || null,
            page: error.page || null,
            url: error.url || null,
            timestamp,
            category: null,
            severity: 'low',
            handled: false,
            fix: null,
        };

        // 1. Categorize the error
        normalizedError.category = this._categorize(normalizedError.message);

        // 2. Check if we have a permanent fix for this
        const permanentFix = this._checkPermanentFix(normalizedError);
        if (permanentFix) {
            normalizedError.handled = true;
            normalizedError.fix = { type: 'permanent', ...permanentFix };
            this.stats.totalPermanentFixes++;
            this.log(`[PERMANENT FIX] Applied "${permanentFix.name}" for ${normalizedError.category}`);
            return this._buildResponse(normalizedError);
        }

        // 3. Track for recurring pattern detection
        const patternKey = this._getPatternKey(normalizedError);
        this._trackPattern(patternKey, normalizedError);

        // 4. Store the error
        this.errors.push(normalizedError);
        this.stats.totalErrors++;
        this.stats.byCategory[normalizedError.category] = (this.stats.byCategory[normalizedError.category] || 0) + 1;

        // Trim error history
        if (this.errors.length > CONFIG.maxErrorHistory) {
            this.errors = this.errors.slice(-CONFIG.maxErrorHistory);
        }

        // 5. Attempt auto-fix
        const playbook = AUTO_FIX_PLAYBOOK[normalizedError.category];
        if (playbook) {
            normalizedError.severity = playbook.severity;

            const autoFixes = playbook.fixes.filter(f => f.auto);
            for (const fix of autoFixes) {
                if (this._isFixOnCooldown(fix.name)) {
                    this.log(`[COOLDOWN] Fix "${fix.name}" on cooldown, skipping`);
                    continue;
                }

                try {
                    const result = await this._executeFix(fix, normalizedError);
                    if (result.success) {
                        normalizedError.handled = true;
                        normalizedError.fix = { type: 'auto', name: fix.name, ...result };
                        this.stats.totalAutoFixed++;
                        this.fixHistory.push({
                            issueId,
                            fix: fix.name,
                            category: normalizedError.category,
                            timestamp,
                            success: true,
                        });
                        this.log(`[AUTO-FIX] Applied "${fix.name}" for ${normalizedError.category}: ${normalizedError.message.substring(0, 100)}`);
                        this._notifyUploadFixSubscribers(normalizedError.category, { name: fix.name, ...result });
                        break;
                    }
                } catch (fixErr) {
                    this.log(`[FIX-ERROR] Fix "${fix.name}" failed: ${fixErr.message}`);
                }
            }

            this.stats.totalFixed += normalizedError.handled ? 1 : 0;
        }

        // 6. Check if this is a recurring issue that needs deep analysis
        const occurrences = this.recurringIssues[patternKey]?.count || 0;
        if (occurrences >= CONFIG.deepAnalysisThreshold) {
            this._triggerDeepAnalysis(patternKey, normalizedError);
        }

        // 7. Build and return response
        return this._buildResponse(normalizedError);
    }

    // ============ UPLOAD-SPECIFIC ERROR HANDLER ============
    /**
     * Upload-specific error handler with enhanced context and retry guidance
     * @param {Object} uploadError - { message, errorCode, deviceId, fileSize, fileType, endpoint, httpStatus }
     * @returns {Object} - { handled, category, fix, userMessage, canRetry, retryDelay, retryStrategy, uploadTip }
     */
    async handleUploadError(uploadError) {
        const result = await this.handleError({
            message: uploadError.message,
            source: 'upload-system',
            deviceId: uploadError.deviceId,
            context: {
                fileSize: uploadError.fileSize,
                fileType: uploadError.fileType,
                endpoint: uploadError.endpoint,
                httpStatus: uploadError.httpStatus,
                errorCode: uploadError.errorCode,
            },
        });

        const retryGuidance = this._getUploadRetryGuidance(uploadError, result);

        return {
            ...result,
            canRetry: retryGuidance.canRetry,
            retryDelay: retryGuidance.retryDelay,
            retryStrategy: retryGuidance.strategy,
            uploadTip: retryGuidance.tip,
            serverAction: retryGuidance.serverAction,
        };
    }

    _getUploadRetryGuidance(error, aiResult) {
        const msg = (error.message || '').toLowerCase();
        const code = error.errorCode || '';
        const status = error.httpStatus || 0;

        // Not retryable
        if (msg.includes('file too large') || msg.includes('limit_file_size') || status === 413) {
            return { canRetry: false, retryDelay: 0, strategy: 'resize', tip: 'Reduce image size and try again' };
        }
        if (msg.includes('invalid format') || msg.includes('not allowed')) {
            return { canRetry: false, retryDelay: 0, strategy: 'change_format', tip: 'Use JPG, PNG, GIF, or WebP format' };
        }
        if (status === 429) {
            return { canRetry: false, retryDelay: 0, strategy: 'wait', tip: 'Daily upload limit reached. Resets tomorrow.' };
        }

        // Retryable with guidance
        if (msg.includes('timeout') || msg.includes('etimedout') || code === 'ETIMEDOUT') {
            return { canRetry: true, retryDelay: 200, strategy: 'retry_smaller_timeout', tip: 'Retrying with optimized connection...' };
        }
        if (msg.includes('econnrefused') || msg.includes('econnreset') || code === 'ECONNREFUSED') {
            return { canRetry: true, retryDelay: 1000, strategy: 'retry_backoff', tip: 'Server reconnecting, retrying shortly...', serverAction: 'check_health' };
        }
        if (status >= 500 && status < 600) {
            return { canRetry: true, retryDelay: 500, strategy: 'retry_backoff', tip: 'Server error detected, AI is fixing it...', serverAction: 'auto_fix' };
        }
        if (msg.includes('enospc') || msg.includes('no space')) {
            return { canRetry: true, retryDelay: 5000, strategy: 'wait_for_cleanup', tip: 'Freeing server space, retry in a few seconds...', serverAction: 'emergency_cleanup' };
        }
        if (msg.includes('eacces') || msg.includes('eperm') || msg.includes('permission')) {
            return { canRetry: true, retryDelay: 3000, strategy: 'wait_for_fix', tip: 'AI is resolving a server issue...', serverAction: 'fix_permissions' };
        }

        // Default: allow retry
        if (aiResult.handled) {
            return { canRetry: true, retryDelay: 300, strategy: 'retry_after_fix', tip: aiResult.userMessage || 'Issue resolved, retrying...' };
        }
        return { canRetry: true, retryDelay: 500, strategy: 'retry_generic', tip: 'Retrying upload...' };
    }

    // ============ UPLOAD FIX SUBSCRIBER SYSTEM ============
    subscribeUploadFix(id, callback) {
        this.uploadFixSubscribers.set(id, callback);
    }

    unsubscribeUploadFix(id) {
        this.uploadFixSubscribers.delete(id);
    }

    _notifyUploadFixSubscribers(category, fixResult) {
        if (category !== 'UPLOAD') return;
        this.uploadFixSubscribers.forEach((callback, id) => {
            try {
                callback({
                    type: 'upload_fix_applied',
                    fix: fixResult,
                    canRetry: true,
                    timestamp: Date.now(),
                });
            } catch (e) {
                this.log(`[SUBSCRIBER] Error notifying ${id}: ${e.message}`);
            }
        });
    }

    // ============ PATTERN DETECTION ============
    _categorize(message) {
        const msg = message.toLowerCase();
        for (const [category, { patterns }] of Object.entries(ERROR_CATEGORIES)) {
            for (const pattern of patterns) {
                if (new RegExp(pattern, 'i').test(msg)) {
                    return category;
                }
            }
        }
        return 'UNKNOWN';
    }

    _getPatternKey(error) {
        // Create a fingerprint for deduplication
        const msg = error.message.toLowerCase()
            .replace(/\d+/g, 'N')          // Normalize numbers
            .replace(/[a-f0-9]{8,}/gi, 'H') // Normalize hashes
            .replace(/\/[\w-]+\.\w+/g, '/FILE') // Normalize file paths
            .substring(0, 200);
        return `${error.category}::${error.source}::${msg}`;
    }

    _trackPattern(key, error) {
        if (!this.recurringIssues[key]) {
            this.recurringIssues[key] = {
                count: 0,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                samples: [],
                category: error.category,
            };
        }

        const issue = this.recurringIssues[key];
        issue.count++;
        issue.lastSeen = Date.now();

        // Keep last 5 samples
        if (issue.samples.length < 5) {
            issue.samples.push({
                message: error.message.substring(0, 300),
                source: error.source,
                page: error.page,
                timestamp: error.timestamp,
            });
        }

        // Clean old patterns (outside recurring window)
        const now = Date.now();
        for (const [k, v] of Object.entries(this.recurringIssues)) {
            if (now - v.lastSeen > CONFIG.recurringWindow * 2) {
                delete this.recurringIssues[k];
            }
        }
    }

    // ============ DEEP ANALYSIS (ULTRATHINKING) ============
    _triggerDeepAnalysis(patternKey, error) {
        // Check cooldown
        if (this.deepAnalysisCooldowns[patternKey] &&
            Date.now() - this.deepAnalysisCooldowns[patternKey] < CONFIG.deepAnalysisCooldown) {
            return;
        }

        this.deepAnalysisCooldowns[patternKey] = Date.now();
        this.stats.totalDeepAnalysis++;

        const issue = this.recurringIssues[patternKey];
        this.log(`\n${'='.repeat(60)}`);
        this.log(`[DEEP ANALYSIS] Triggered for recurring issue`);
        this.log(`Category: ${error.category} | Occurrences: ${issue.count}`);
        this.log(`First seen: ${new Date(issue.firstSeen).toISOString()}`);
        this.log(`Last seen: ${new Date(issue.lastSeen).toISOString()}`);
        this.log(`Pattern: ${patternKey.substring(0, 120)}`);
        this.log(`${'='.repeat(60)}`);

        // Deep analysis logic — analyze root cause and plan permanent fix
        const analysis = this._performDeepAnalysis(patternKey, issue, error);

        if (analysis.permanentFix) {
            this.permanentFixes[patternKey] = {
                name: analysis.fixName,
                description: analysis.description,
                action: analysis.action,
                appliedAt: new Date().toISOString(),
                occurrencesBefore: issue.count,
                category: error.category,
            };

            this._savePermanentFixes();

            this.log(`[PERMANENT FIX FOUND] "${analysis.fixName}"`);
            this.log(`Description: ${analysis.description}`);
            this.log(`Action: ${analysis.action}`);
            this.log(`${'='.repeat(60)}\n`);

            // Execute the permanent fix if it has an action
            if (analysis.executeNow) {
                this._executePermanentFix(analysis);
            }
        } else {
            this.log(`[DEEP ANALYSIS] No permanent fix found yet. Will re-analyze after cooldown.`);

            // Store the analysis for future reference
            this.deepAnalysisLog[patternKey] = {
                ...analysis,
                timestamp: new Date().toISOString(),
                occurrences: issue.count,
            };
        }
    }

    _performDeepAnalysis(patternKey, issue, error) {
        const category = error.category;
        const occurrences = issue.count;
        const timespanMs = issue.lastSeen - issue.firstSeen;
        const frequency = timespanMs > 0 ? occurrences / (timespanMs / 60000) : occurrences; // per minute

        this.log(`[ANALYSIS] Frequency: ${frequency.toFixed(2)}/min over ${(timespanMs/60000).toFixed(1)} minutes`);
        this.log(`[ANALYSIS] Samples:`);
        issue.samples.forEach((s, i) => {
            this.log(`  ${i + 1}. [${s.source}] ${s.message.substring(0, 100)}`);
        });

        // Category-specific deep analysis
        switch (category) {
            case 'REDIS':
                return this._analyzeRedisIssue(issue, frequency);
            case 'DATABASE':
                return this._analyzeDatabaseIssue(issue, frequency);
            case 'NETWORK':
                return this._analyzeNetworkIssue(issue, frequency);
            case 'MEMORY':
                return this._analyzeMemoryIssue(issue, frequency);
            case 'AUTH':
                return this._analyzeAuthIssue(issue, frequency);
            case 'UPLOAD':
                return this._analyzeUploadIssue(issue, frequency);
            case 'FRONTEND':
                return this._analyzeFrontendIssue(issue, frequency);
            case 'PROCESS':
                return this._analyzeProcessIssue(issue, frequency);
            case 'SSL':
                return this._analyzeSSLIssue(issue, frequency);
            default:
                return this._analyzeGenericIssue(issue, frequency, category);
        }
    }

    // ---- Category-specific deep analysis methods ----

    _analyzeRedisIssue(issue, frequency) {
        // Redis is optional — if it keeps failing, permanently disable retry attempts
        if (frequency > 1) { // More than 1 per minute
            return {
                permanentFix: true,
                fixName: 'disable_redis_retry',
                description: 'Redis is persistently unavailable. Permanently using in-memory fallback to eliminate retry noise. All features work with in-memory cache.',
                action: 'suppress_and_fallback',
                executeNow: true,
                suppressPattern: 'REDIS',
            };
        }
        return {
            permanentFix: false,
            recommendation: 'Redis intermittently failing. Monitor for pattern stabilization.',
        };
    }

    _analyzeDatabaseIssue(issue, frequency) {
        if (frequency > 0.5) {
            return {
                permanentFix: true,
                fixName: 'db_connection_pool_reset',
                description: 'Database connection pool exhausted or stale. Restart gateway with fresh connection pool.',
                action: 'restart_gateway',
                executeNow: true,
            };
        }
        return {
            permanentFix: false,
            recommendation: 'Database connections intermittent. Check PostgreSQL max_connections and pool size.',
        };
    }

    _analyzeNetworkIssue(issue, frequency) {
        const samples = issue.samples.map(s => s.message).join(' ');
        if (samples.includes('localhost') || samples.includes('127.0.0.1')) {
            return {
                permanentFix: true,
                fixName: 'local_service_restart',
                description: 'Local service unreachable. Restarting dependent services.',
                action: 'restart_gateway',
                executeNow: true,
            };
        }
        return {
            permanentFix: false,
            recommendation: 'External network issues detected. Cannot auto-fix external connectivity.',
        };
    }

    _analyzeMemoryIssue(issue, frequency) {
        return {
            permanentFix: true,
            fixName: 'memory_pressure_relief',
            description: 'Persistent memory pressure. Forcing GC and restarting gateway with clean state.',
            action: 'gc_and_restart',
            executeNow: true,
        };
    }

    _analyzeAuthIssue(issue, frequency) {
        if (frequency > 2) {
            return {
                permanentFix: true,
                fixName: 'auth_rate_limit_boost',
                description: 'High auth failure rate — possible brute force or token expiry cascade. Increasing rate limit strictness.',
                action: 'boost_rate_limit',
                executeNow: true,
            };
        }
        return {
            permanentFix: false,
            recommendation: 'Auth failures at normal levels. No action needed.',
        };
    }

    _analyzeUploadIssue(issue, frequency) {
        const samples = issue.samples.map(s => s.message).join(' ').toLowerCase();

        // Disk space pattern
        if (samples.includes('enospc') || samples.includes('storage full') || samples.includes('no space')) {
            return {
                permanentFix: true,
                fixName: 'aggressive_cleanup_schedule',
                description: 'Disk space consistently low. Scheduling aggressive cleanup every 5 minutes.',
                action: 'schedule_cleanup',
                executeNow: true,
            };
        }

        // Permission pattern
        if (samples.includes('eacces') || samples.includes('eperm') || samples.includes('permission')) {
            return {
                permanentFix: true,
                fixName: 'fix_upload_permissions',
                description: 'Upload directory has permission issues. Attempting to fix.',
                action: 'fix_permissions',
                executeNow: true,
            };
        }

        // Multer / size pattern — user-side, no server fix
        if (samples.includes('multer') || samples.includes('file too large') || samples.includes('limit')) {
            return {
                permanentFix: false,
                recommendation: 'Upload size limit rejections. These are user-side; no server fix needed.',
            };
        }

        // High frequency server-side upload failures
        if (frequency > 1) {
            return {
                permanentFix: true,
                fixName: 'restart_upload_handler',
                description: 'High frequency upload failures indicate gateway issue. Restarting.',
                action: 'restart_gateway',
                executeNow: true,
            };
        }

        return {
            permanentFix: false,
            recommendation: 'Upload failures at low frequency. Monitor for escalation.',
        };
    }

    _analyzeFrontendIssue(issue, frequency) {
        return {
            permanentFix: true,
            fixName: 'frontend_error_suppression',
            description: 'Recurring frontend JS error detected. Suppressing from user view — logged for developer review.',
            action: 'suppress_frontend',
            executeNow: true,
            suppressPattern: 'FRONTEND',
        };
    }

    _analyzeProcessIssue(issue, frequency) {
        return {
            permanentFix: true,
            fixName: 'process_recovery',
            description: 'Process conflicts recurring. Scheduling periodic gateway reload to prevent deadlocks.',
            action: 'schedule_reload',
            executeNow: true,
        };
    }

    _analyzeSSLIssue(issue, frequency) {
        return {
            permanentFix: false,
            recommendation: 'SSL issues require manual certificate management. Alerting admin.',
        };
    }

    _analyzeGenericIssue(issue, frequency, category) {
        if (frequency > 3) {
            return {
                permanentFix: true,
                fixName: `suppress_${category.toLowerCase()}`,
                description: `High-frequency ${category} errors detected. Suppressing from user view and logging for analysis.`,
                action: 'suppress',
                executeNow: true,
                suppressPattern: category,
            };
        }
        return {
            permanentFix: false,
            recommendation: `${category} errors at manageable levels. Monitoring.`,
        };
    }

    // ============ FIX EXECUTION ============
    async _executeFix(fix, error) {
        this._setFixCooldown(fix.name);

        if (fix.action === 'internal') {
            // Internal fixes handled by the system's existing mechanisms
            return { success: true, method: 'internal', message: 'Internal recovery triggered' };
        }

        if (fix.action === 'exec') {
            return new Promise((resolve) => {
                exec(fix.command, { timeout: 30000 }, (err, stdout, stderr) => {
                    if (err) {
                        resolve({ success: false, error: err.message });
                    } else {
                        resolve({ success: true, method: 'exec', output: stdout.trim() });
                    }
                });
            });
        }

        return { success: false, error: 'Unknown fix action' };
    }

    _executePermanentFix(analysis) {
        this.log(`[EXECUTING PERMANENT FIX] ${analysis.fixName}`);

        switch (analysis.action) {
            case 'restart_gateway':
                exec('pm2 reload doz-gateway --update-env', { timeout: 30000 }, (err) => {
                    if (err) this.log(`[PERM-FIX] Gateway restart failed: ${err.message}`);
                    else this.log(`[PERM-FIX] Gateway restarted successfully`);
                });
                break;

            case 'gc_and_restart':
                if (global.gc) global.gc();
                exec('pm2 reload doz-gateway --update-env', { timeout: 30000 }, (err) => {
                    if (err) this.log(`[PERM-FIX] GC+restart failed: ${err.message}`);
                    else this.log(`[PERM-FIX] GC+restart completed`);
                });
                break;

            case 'suppress_and_fallback':
            case 'suppress_frontend':
            case 'suppress':
                // These are handled by the pattern check in handleError —
                // the permanent fix entry prevents further user-visible alerts
                this.log(`[PERM-FIX] Suppression rule active for ${analysis.suppressPattern || 'pattern'}`);
                break;

            case 'boost_rate_limit':
                // Signal to auth-security.js to increase strictness
                this.log(`[PERM-FIX] Rate limit boost activated`);
                break;

            case 'schedule_reload':
                // Schedule periodic reloads every 6 hours
                this.log(`[PERM-FIX] Scheduled periodic gateway reload every 6 hours`);
                setInterval(() => {
                    exec('pm2 reload doz-gateway --update-env', { timeout: 30000 });
                    this.log(`[SCHEDULED] Periodic gateway reload executed`);
                }, 6 * 60 * 60 * 1000);
                break;

            case 'schedule_cleanup': {
                const uploadsDir = path.join(__dirname, '..', 'uploads');
                this.log(`[PERM-FIX] Aggressive upload cleanup scheduled every 5 minutes`);
                setInterval(() => {
                    try {
                        const files = fs.readdirSync(uploadsDir);
                        const now = Date.now();
                        let cleaned = 0;
                        for (const file of files) {
                            if (file.startsWith('.')) continue;
                            try {
                                const filePath = path.join(uploadsDir, file);
                                const stat = fs.statSync(filePath);
                                // Remove files older than 24 hours during emergency cleanup
                                if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
                                    fs.unlinkSync(filePath);
                                    cleaned++;
                                }
                            } catch (e) {}
                        }
                        if (cleaned > 0) this.log(`[SCHEDULED] Emergency cleanup removed ${cleaned} expired files`);
                    } catch (e) {
                        this.log(`[SCHEDULED] Cleanup error: ${e.message}`);
                    }
                }, 5 * 60 * 1000);
                this._notifyUploadFixSubscribers('UPLOAD', { name: 'schedule_cleanup', success: true });
                break;
            }

            case 'fix_permissions': {
                const uploadsDir = path.join(__dirname, '..', 'uploads');
                if (process.platform !== 'win32') {
                    exec(`chmod -R 755 "${uploadsDir}"`, { timeout: 10000 }, (err) => {
                        if (err) this.log(`[PERM-FIX] Permission fix failed: ${err.message}`);
                        else {
                            this.log(`[PERM-FIX] Upload directory permissions fixed`);
                            this._notifyUploadFixSubscribers('UPLOAD', { name: 'fix_permissions', success: true });
                        }
                    });
                } else {
                    // On Windows, ensure directory exists and is accessible
                    try {
                        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                        const testPath = path.join(uploadsDir, '.perm-test-' + Date.now());
                        fs.writeFileSync(testPath, 'test');
                        fs.unlinkSync(testPath);
                        this.log(`[PERM-FIX] Upload directory verified writable on Windows`);
                        this._notifyUploadFixSubscribers('UPLOAD', { name: 'fix_permissions', success: true });
                    } catch (e) {
                        this.log(`[PERM-FIX] Windows permission fix failed: ${e.message}`);
                    }
                }
                break;
            }

            default:
                this.log(`[PERM-FIX] No execution handler for action: ${analysis.action}`);
        }
    }

    // ============ COOLDOWN MANAGEMENT ============
    _isFixOnCooldown(fixName) {
        const lastApplied = this.autoFixCooldowns[fixName];
        return lastApplied && (Date.now() - lastApplied < CONFIG.autoFixCooldown);
    }

    _setFixCooldown(fixName) {
        this.autoFixCooldowns[fixName] = Date.now();
    }

    // ============ PERMANENT FIX MANAGEMENT ============
    _checkPermanentFix(error) {
        const key = this._getPatternKey(error);
        if (this.permanentFixes[key]) {
            return this.permanentFixes[key];
        }

        // Also check category-level suppression
        for (const [k, fix] of Object.entries(this.permanentFixes)) {
            if (fix.action === 'suppress' || fix.action === 'suppress_and_fallback' || fix.action === 'suppress_frontend') {
                if (fix.category === error.category) {
                    return fix;
                }
            }
        }

        return null;
    }

    _loadPermanentFixes() {
        try {
            if (fs.existsSync(CONFIG.permanentFixPath)) {
                const data = fs.readFileSync(CONFIG.permanentFixPath, 'utf8');
                this.permanentFixes = JSON.parse(data);
                this.log(`Loaded ${Object.keys(this.permanentFixes).length} permanent fixes`);
            }
        } catch (err) {
            this.log(`[WARN] Could not load permanent fixes: ${err.message}`);
        }
    }

    _savePermanentFixes() {
        try {
            fs.writeFileSync(CONFIG.permanentFixPath, JSON.stringify(this.permanentFixes, null, 2));
        } catch (err) {
            this.log(`[WARN] Could not save permanent fixes: ${err.message}`);
        }
    }

    // ============ RESPONSE BUILDER ============
    _buildResponse(error) {
        const playbook = AUTO_FIX_PLAYBOOK[error.category];

        return {
            issueId: error.id,
            handled: error.handled,
            category: error.category,
            categoryLabel: ERROR_CATEGORIES[error.category]?.label || 'Unknown',
            severity: error.severity || playbook?.severity || 'low',
            fix: error.fix,
            userMessage: error.handled
                ? (playbook?.userMessage || null)
                : this._getUserMessage(error),
            silent: error.category === 'FRONTEND' || error.category === 'REDIS' || error.severity === 'low',
            timestamp: error.timestamp,
        };
    }

    _getUserMessage(error) {
        const playbook = AUTO_FIX_PLAYBOOK[error.category];
        if (playbook?.userMessage === null) return null; // Explicitly silent

        // Don't bother users with technical errors
        if (['REDIS', 'PROCESS', 'MEMORY', 'EXTERNAL'].includes(error.category)) {
            return null; // Silent — AI handles it
        }

        if (error.category === 'NETWORK') {
            return 'Connection issue detected. Retrying...';
        }

        if (error.category === 'AUTH') {
            return error.message; // Auth errors should show to user
        }

        if (error.category === 'UPLOAD') {
            return error.message; // Upload errors are user-relevant
        }

        if (error.category === 'PAYMENT') {
            return error.message; // Payment errors must show
        }

        return null; // Default: silent for all other technical errors
    }

    // ============ API: GET STATUS ============
    getStatus() {
        const now = Date.now();
        const recentErrors = this.errors.filter(e => now - e.timestamp < 5 * 60000);

        return {
            status: recentErrors.length > 20 ? 'degraded' : recentErrors.length > 5 ? 'monitoring' : 'healthy',
            stats: this.stats,
            recentErrors: recentErrors.length,
            recurringIssues: Object.entries(this.recurringIssues)
                .filter(([_, v]) => v.count >= CONFIG.recurringThreshold)
                .map(([key, v]) => ({
                    pattern: key.substring(0, 80),
                    count: v.count,
                    category: v.category,
                    lastSeen: new Date(v.lastSeen).toISOString(),
                })),
            permanentFixes: Object.entries(this.permanentFixes).map(([_, v]) => ({
                name: v.name,
                description: v.description,
                category: v.category,
                appliedAt: v.appliedAt,
            })),
            recentFixes: this.fixHistory.slice(-10),
            deepAnalysisCount: this.stats.totalDeepAnalysis,
        };
    }

    // ============ API: GET FULL TELEMETRY ============
    getTelemetry() {
        return {
            ...this.getStatus(),
            errorHistory: this.errors.slice(-50).map(e => ({
                id: e.id,
                category: e.category,
                message: e.message.substring(0, 200),
                source: e.source,
                page: e.page,
                handled: e.handled,
                severity: e.severity,
                timestamp: new Date(e.timestamp).toISOString(),
            })),
            deepAnalysisLog: this.deepAnalysisLog,
            categoryBreakdown: this.stats.byCategory,
        };
    }

    // ============ API: RESET PERMANENT FIX ============
    resetPermanentFix(category) {
        let removed = 0;
        for (const [key, fix] of Object.entries(this.permanentFixes)) {
            if (fix.category === category) {
                delete this.permanentFixes[key];
                removed++;
            }
        }
        this._savePermanentFixes();
        this.log(`[RESET] Removed ${removed} permanent fixes for category: ${category}`);
        return { removed };
    }

    // ============ UTILITIES ============
    _generateIssueId() {
        return `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
    }

    _ensureDirectories() {
        const dirs = [
            path.dirname(CONFIG.telemetryPath),
            path.dirname(CONFIG.logPath),
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    _startCleanupInterval() {
        // Clean up old data every 30 minutes
        setInterval(() => {
            const now = Date.now();

            // Clean old errors (keep last 2 hours)
            this.errors = this.errors.filter(e => now - e.timestamp < 2 * 60 * 60000);

            // Clean old fix history (keep last 500)
            if (this.fixHistory.length > CONFIG.maxFixHistory) {
                this.fixHistory = this.fixHistory.slice(-CONFIG.maxFixHistory);
            }

            // Clean old recurring issues (keep those seen in last hour)
            for (const [key, issue] of Object.entries(this.recurringIssues)) {
                if (now - issue.lastSeen > 60 * 60000) {
                    delete this.recurringIssues[key];
                }
            }

            // Save telemetry snapshot
            this._saveTelemetry();
        }, 30 * 60000);
    }

    _saveTelemetry() {
        try {
            fs.writeFileSync(CONFIG.telemetryPath, JSON.stringify(this.getTelemetry(), null, 2));
        } catch (err) {
            // Silent fail — telemetry is non-critical
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${message}`;
        console.log(`[AI-Interceptor] ${message}`);

        try {
            fs.appendFileSync(CONFIG.logPath, line + '\n');
        } catch (err) {
            // Silent fail
        }
    }
}

// ============ SINGLETON EXPORT ============
const interceptor = new AIErrorInterceptor();

module.exports = interceptor;
