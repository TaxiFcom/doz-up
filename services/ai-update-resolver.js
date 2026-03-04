/**
 * AI Update Resolver Service
 * Monitors update failures and provides automated diagnosis and resolution
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// Issue types and their AI-driven solutions
const ISSUE_TYPES = {
    NETWORK_ERROR: {
        patterns: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'network', 'connection'],
        diagnosis: 'Network connectivity issue detected',
        solutions: [
            'Check internet connection',
            'Verify firewall settings allow DOZ UP',
            'Try disabling VPN temporarily',
            'Check if doz.com is accessible in browser'
        ],
        autoFix: 'retry_with_fallback'
    },
    PERMISSION_ERROR: {
        patterns: ['EACCES', 'EPERM', 'permission', 'access denied'],
        diagnosis: 'File permission issue detected',
        solutions: [
            'Run DOZ UP as Administrator (Windows)',
            'Check write permissions for app directory',
            'Disable antivirus temporarily during update',
            'Manually download update from doz.com/download'
        ],
        autoFix: 'request_elevation'
    },
    DISK_SPACE: {
        patterns: ['ENOSPC', 'disk full', 'no space', 'insufficient'],
        diagnosis: 'Insufficient disk space',
        solutions: [
            'Free up at least 200MB disk space',
            'Clear temporary files',
            'Empty recycle bin',
            'Uninstall unused programs'
        ],
        autoFix: 'clear_cache'
    },
    CORRUPTED_DOWNLOAD: {
        patterns: ['checksum', 'hash', 'corrupt', 'invalid', 'sha512'],
        diagnosis: 'Download file corrupted',
        solutions: [
            'Clear update cache and retry',
            'Check for proxy/firewall interference',
            'Try direct download from website',
            'Disable download managers'
        ],
        autoFix: 'clear_and_retry'
    },
    VERSION_MISMATCH: {
        patterns: ['version', 'mismatch', 'incompatible', 'already installed'],
        diagnosis: 'Version conflict detected',
        solutions: [
            'Uninstall current version completely',
            'Delete app data folder',
            'Reinstall from fresh download',
            'Check for multiple installations'
        ],
        autoFix: 'force_reinstall'
    },
    ANTIVIRUS_BLOCK: {
        patterns: ['blocked', 'quarantine', 'threat', 'virus', 'malware'],
        diagnosis: 'Antivirus blocking update',
        solutions: [
            'Add DOZ UP to antivirus whitelist',
            'Temporarily disable real-time protection',
            'Exclude app folder from scanning',
            'This is a false positive - DOZ UP is safe'
        ],
        autoFix: 'notify_whitelist'
    },
    PROCESS_LOCKED: {
        patterns: ['EBUSY', 'locked', 'in use', 'cannot access'],
        diagnosis: 'Files locked by another process',
        solutions: [
            'Close all DOZ UP instances',
            'Restart computer and try again',
            'Check Task Manager for running processes',
            'End DOZ UP processes manually'
        ],
        autoFix: 'kill_and_retry'
    }
};

// Telemetry storage
const telemetryPath = path.join(__dirname, '..', 'data', 'update-telemetry.json');

class AIUpdateResolver {
    constructor() {
        this.issueLog = [];
        this.resolvedCount = 0;
        this.failedCount = 0;
        this.loadTelemetry();
    }

    loadTelemetry() {
        try {
            if (fsSync.existsSync(telemetryPath)) {
                const data = fsSync.readFileSync(telemetryPath, 'utf8');
                const telemetry = JSON.parse(data);
                this.issueLog = telemetry.issueLog || [];
                this.resolvedCount = telemetry.resolvedCount || 0;
                this.failedCount = telemetry.failedCount || 0;
            }
        } catch (e) {
            console.log('[AIUpdateResolver] Starting with fresh telemetry');
        }
    }

    async saveTelemetry() {
        try {
            const dir = path.dirname(telemetryPath);
            if (!fsSync.existsSync(dir)) {
                fsSync.mkdirSync(dir, { recursive: true });
            }
            await fs.writeFile(telemetryPath, JSON.stringify({
                issueLog: this.issueLog.slice(-1000), // Keep last 1000
                resolvedCount: this.resolvedCount,
                failedCount: this.failedCount,
                lastUpdated: new Date().toISOString()
            }, null, 2));
        } catch (e) {
            console.error('[AIUpdateResolver] Failed to save telemetry:', e);
        }
    }

    /**
     * Diagnose an update failure
     */
    diagnose(error, context = {}) {
        const errorStr = (error?.message || error || '').toLowerCase();
        const errorCode = error?.code || '';

        let matchedIssue = null;
        let matchScore = 0;

        // Find best matching issue type
        for (const [issueType, config] of Object.entries(ISSUE_TYPES)) {
            let score = 0;
            for (const pattern of config.patterns) {
                if (errorStr.includes(pattern.toLowerCase()) || errorCode.includes(pattern)) {
                    score += 2;
                }
            }
            if (score > matchScore) {
                matchScore = score;
                matchedIssue = { type: issueType, ...config };
            }
        }

        // Default to generic error if no match
        if (!matchedIssue) {
            matchedIssue = {
                type: 'UNKNOWN',
                diagnosis: 'Unknown error occurred',
                solutions: [
                    'Restart the application',
                    'Check internet connection',
                    'Try manual download from doz.com/download',
                    'Contact support if issue persists'
                ],
                autoFix: null
            };
        }

        const diagnosis = {
            timestamp: new Date().toISOString(),
            issueType: matchedIssue.type,
            diagnosis: matchedIssue.diagnosis,
            solutions: matchedIssue.solutions,
            autoFix: matchedIssue.autoFix,
            confidence: matchScore > 0 ? Math.min(matchScore * 25, 100) : 30,
            originalError: error?.message || error,
            errorCode: errorCode,
            context: {
                deviceId: context.deviceId,
                currentVersion: context.currentVersion,
                targetVersion: context.targetVersion,
                platform: context.platform,
                timestamp: Date.now()
            }
        };

        // Log the issue
        this.issueLog.push(diagnosis);
        this.saveTelemetry();

        return diagnosis;
    }

    /**
     * Generate auto-fix script based on diagnosis
     */
    generateAutoFix(diagnosis) {
        const fixes = {
            retry_with_fallback: {
                action: 'RETRY_DOWNLOAD',
                script: `
                    // Retry with fallback servers
                    const servers = [
                        'https://up.doz.com',
                        'https://doz.com',
                        'https://cdn.doz.com'
                    ];
                    for (const server of servers) {
                        try {
                            await downloadUpdate(server);
                            break;
                        } catch (e) {
                            continue;
                        }
                    }
                `,
                userAction: null
            },
            request_elevation: {
                action: 'REQUEST_ADMIN',
                script: null,
                userAction: 'Please restart DOZ UP as Administrator'
            },
            clear_cache: {
                action: 'CLEAR_CACHE',
                script: `
                    const cachePaths = [
                        '%TEMP%/doz-up-update',
                        '%LOCALAPPDATA%/doz-up-updater'
                    ];
                    for (const p of cachePaths) {
                        try { await fs.rm(p, { recursive: true }); } catch {}
                    }
                `,
                userAction: null
            },
            clear_and_retry: {
                action: 'CLEAR_AND_RETRY',
                script: `
                    // Clear corrupted downloads
                    await clearUpdateCache();
                    // Retry with fresh download
                    await downloadUpdate({ force: true, verify: true });
                `,
                userAction: null
            },
            force_reinstall: {
                action: 'FORCE_REINSTALL',
                script: null,
                userAction: 'Please download fresh installer from doz.com/download'
            },
            notify_whitelist: {
                action: 'WHITELIST_REQUIRED',
                script: null,
                userAction: 'Please add DOZ UP to your antivirus whitelist',
                instructions: [
                    '1. Open your antivirus software',
                    '2. Go to Settings > Exclusions',
                    '3. Add the DOZ UP installation folder',
                    '4. Also exclude: %LOCALAPPDATA%/doz-up'
                ]
            },
            kill_and_retry: {
                action: 'KILL_PROCESSES',
                script: `
                    // Kill any running instances
                    if (process.platform === 'win32') {
                        require('child_process').execSync('taskkill /f /im "DOZ UP.exe" 2>nul', { stdio: 'ignore' });
                    }
                    // Wait and retry
                    await new Promise(r => setTimeout(r, 2000));
                    await downloadUpdate();
                `,
                userAction: null
            }
        };

        return fixes[diagnosis.autoFix] || {
            action: 'MANUAL_INTERVENTION',
            script: null,
            userAction: 'Please try the suggested solutions or contact support'
        };
    }

    /**
     * Report successful resolution
     */
    reportResolved(diagnosisId) {
        this.resolvedCount++;
        this.saveTelemetry();
    }

    /**
     * Report failed resolution
     */
    reportFailed(diagnosisId, additionalInfo) {
        this.failedCount++;
        const issue = this.issueLog.find(i => i.timestamp === diagnosisId);
        if (issue) {
            issue.failedResolution = true;
            issue.additionalInfo = additionalInfo;
        }
        this.saveTelemetry();
    }

    /**
     * Get statistics
     */
    getStats() {
        const issuesByType = {};
        for (const issue of this.issueLog) {
            issuesByType[issue.issueType] = (issuesByType[issue.issueType] || 0) + 1;
        }

        return {
            totalIssues: this.issueLog.length,
            resolved: this.resolvedCount,
            failed: this.failedCount,
            resolutionRate: this.resolvedCount > 0
                ? Math.round((this.resolvedCount / (this.resolvedCount + this.failedCount)) * 100)
                : 0,
            issuesByType,
            recentIssues: this.issueLog.slice(-10),
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Get fix instructions for client display
     */
    getClientInstructions(diagnosis) {
        const autoFix = this.generateAutoFix(diagnosis);

        return {
            title: `Update Issue: ${diagnosis.diagnosis}`,
            confidence: `${diagnosis.confidence}% confidence`,
            steps: diagnosis.solutions,
            autoFixAvailable: autoFix.action !== 'MANUAL_INTERVENTION' && !autoFix.userAction,
            userActionRequired: autoFix.userAction,
            additionalInstructions: autoFix.instructions,
            supportUrl: 'https://doz.com/up/help-center',
            downloadUrl: 'https://doz.com/up/download'
        };
    }
}

// Singleton instance
const aiUpdateResolver = new AIUpdateResolver();

module.exports = aiUpdateResolver;
module.exports.AIUpdateResolver = AIUpdateResolver;
