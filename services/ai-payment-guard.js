/**
 * AI Payment Guard - Intelligent Payment Safety Service
 * Provides fraud detection, rate limiting, duplicate prevention, and payment health monitoring
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const GUARD_FILE = path.join(DATA_DIR, 'payment-guard.json');

// Risk scoring thresholds
const RISK_BLOCK = 80;
const RISK_FLAG = 50;

// Rate limits
const MAX_ATTEMPTS_PER_EMAIL_PER_HOUR = 5;
const MAX_FAILED_BEFORE_COOLDOWN = 3;
const FAILED_COOLDOWN_MS = 10 * 60 * 1000; // 10 min
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 min
const MAX_ATTEMPTS_PER_IP_PER_HOUR = 8;
const HOUR_MS = 60 * 60 * 1000;

class AIPaymentGuard {
    constructor() {
        this.attempts = [];       // Recent payment attempts
        this.successes = [];      // Successful payments
        this.failures = [];       // Failed payments
        this.blocked = [];        // Blocked attempts
        this.flagged = [];        // Flagged (allowed but suspicious)
        this.stats = {
            totalAttempts: 0,
            totalSuccesses: 0,
            totalFailures: 0,
            totalBlocked: 0,
            totalFlagged: 0,
            startedAt: new Date().toISOString()
        };
        this.loadData();
        console.log('[PaymentGuard] AI Payment Guard initialized');
    }

    /**
     * Score a payment attempt for risk
     * Returns { score, signals, decision: 'allow'|'flag'|'block' }
     */
    scoreTransaction(email, ip, planId, amount, sessionUserId = null) {
        let score = 0;
        const signals = [];
        const now = Date.now();
        const hourAgo = now - HOUR_MS;

        // 1. Check email attempt frequency
        const emailAttempts = this.attempts.filter(a =>
            a.email === email && a.timestamp > hourAgo
        );
        if (emailAttempts.length >= MAX_ATTEMPTS_PER_EMAIL_PER_HOUR) {
            score += 30;
            signals.push(`Rate limit: ${emailAttempts.length} attempts from email in last hour`);
        } else if (emailAttempts.length >= 3) {
            score += 20;
            signals.push(`Elevated: ${emailAttempts.length} attempts from email in last hour`);
        }

        // 2. Check for recent failures from this email
        const recentFailures = this.failures.filter(f =>
            f.email === email && f.timestamp > (now - FAILED_COOLDOWN_MS)
        );
        if (recentFailures.length >= MAX_FAILED_BEFORE_COOLDOWN) {
            score += 30;
            signals.push(`Cooldown: ${recentFailures.length} failed attempts in last 10 min`);
        } else if (recentFailures.length > 0) {
            score += 10;
            signals.push(`Recent failure: ${recentFailures.length} failed in last 10 min`);
        }

        // 3. IP velocity check
        const ipAttempts = this.attempts.filter(a =>
            a.ip === ip && a.timestamp > hourAgo
        );
        if (ipAttempts.length >= MAX_ATTEMPTS_PER_IP_PER_HOUR) {
            score += 15;
            signals.push(`IP velocity: ${ipAttempts.length} attempts from IP in last hour`);
        }

        // 4. Email switching from same IP
        const ipEmails = new Set(
            this.attempts.filter(a => a.ip === ip && a.timestamp > hourAgo).map(a => a.email)
        );
        if (ipEmails.size > 2) {
            score += 25;
            signals.push(`Email switching: ${ipEmails.size} different emails from same IP`);
        }

        // 5. First-time email (no successful history)
        const hasHistory = this.successes.some(s => s.email === email);
        if (!hasHistory) {
            score += 10;
            signals.push('First-time buyer');
        } else {
            score -= 20;
            signals.push('Returning customer (trusted)');
        }

        // 6. Session match - email matches logged-in user
        if (sessionUserId && email) {
            score -= 10;
            signals.push('Authenticated session');
        }

        // 7. Duplicate detection
        const duplicate = this.attempts.find(a =>
            a.email === email &&
            a.planId === planId &&
            a.amount === amount &&
            a.timestamp > (now - DUPLICATE_WINDOW_MS) &&
            a.decision !== 'block'
        );
        if (duplicate) {
            score += 15;
            signals.push('Possible duplicate: same email+plan+amount within 5 min');
        }

        // Clamp score
        score = Math.max(0, Math.min(100, score));

        // Decision
        let decision = 'allow';
        if (score >= RISK_BLOCK) {
            decision = 'block';
        } else if (score >= RISK_FLAG) {
            decision = 'flag';
        }

        return { score, signals, decision };
    }

    /**
     * Check a payment attempt before processing
     * Returns { allowed, score, decision, signals, message }
     */
    checkPayment(email, ip, planId, amount, sessionUserId = null) {
        const now = Date.now();
        const { score, signals, decision } = this.scoreTransaction(email, ip, planId, amount, sessionUserId);

        const attempt = {
            email,
            ip: this.maskIP(ip),
            planId,
            amount,
            score,
            decision,
            signals,
            timestamp: now,
            time: new Date(now).toISOString()
        };

        this.attempts.push(attempt);
        this.stats.totalAttempts++;

        // Trim old attempts (keep last 24h)
        const dayAgo = now - (24 * HOUR_MS);
        this.attempts = this.attempts.filter(a => a.timestamp > dayAgo);

        if (decision === 'block') {
            this.blocked.push(attempt);
            this.stats.totalBlocked++;
            this.saveData();
            console.log(`[PaymentGuard] BLOCKED payment: score=${score}, email=${this.maskEmail(email)}, signals=${signals.join('; ')}`);
            return {
                allowed: false,
                score,
                decision,
                signals,
                message: 'Payment temporarily blocked for security. Please try again in a few minutes or contact support.'
            };
        }

        if (decision === 'flag') {
            this.flagged.push(attempt);
            this.stats.totalFlagged++;
            console.log(`[PaymentGuard] FLAGGED payment: score=${score}, email=${this.maskEmail(email)}, signals=${signals.join('; ')}`);
        }

        this.saveData();

        return {
            allowed: true,
            score,
            decision,
            signals,
            message: null
        };
    }

    /**
     * Record a successful payment
     */
    recordSuccess(email, planId, amount, paymentIntentId) {
        const now = Date.now();
        this.successes.push({
            email,
            planId,
            amount,
            paymentIntentId,
            timestamp: now,
            time: new Date(now).toISOString()
        });
        this.stats.totalSuccesses++;

        // Keep last 1000 successes
        if (this.successes.length > 1000) {
            this.successes = this.successes.slice(-1000);
        }

        this.saveData();
        console.log(`[PaymentGuard] Payment SUCCESS: ${this.maskEmail(email)}, $${(amount / 100).toFixed(2)}`);
    }

    /**
     * Record a failed payment
     */
    recordFailure(email, planId, amount, reason) {
        const now = Date.now();
        this.failures.push({
            email,
            planId,
            amount,
            reason,
            timestamp: now,
            time: new Date(now).toISOString()
        });
        this.stats.totalFailures++;

        // Keep last 500 failures
        if (this.failures.length > 500) {
            this.failures = this.failures.slice(-500);
        }

        this.saveData();
        console.log(`[PaymentGuard] Payment FAILURE: ${this.maskEmail(email)}, reason: ${reason}`);
    }

    /**
     * Get payment health stats for admin dashboard
     */
    getHealthStats() {
        const now = Date.now();
        const hourAgo = now - HOUR_MS;
        const dayAgo = now - (24 * HOUR_MS);

        const recentAttempts = this.attempts.filter(a => a.timestamp > hourAgo);
        const dailyAttempts = this.attempts.filter(a => a.timestamp > dayAgo);
        const recentSuccesses = this.successes.filter(s => s.timestamp > hourAgo);
        const dailySuccesses = this.successes.filter(s => s.timestamp > dayAgo);
        const recentFailures = this.failures.filter(f => f.timestamp > hourAgo);
        const dailyFailures = this.failures.filter(f => f.timestamp > dayAgo);
        const recentBlocked = this.blocked.filter(b => b.timestamp > dayAgo);
        const recentFlagged = this.flagged.filter(f => f.timestamp > dayAgo);

        const dailyTotal = dailySuccesses.length + dailyFailures.length;
        const successRate = dailyTotal > 0 ? Math.round((dailySuccesses.length / dailyTotal) * 100) : 100;

        return {
            live: {
                attemptsLastHour: recentAttempts.length,
                successesLastHour: recentSuccesses.length,
                failuresLastHour: recentFailures.length
            },
            daily: {
                attempts: dailyAttempts.length,
                successes: dailySuccesses.length,
                failures: dailyFailures.length,
                blocked: recentBlocked.length,
                flagged: recentFlagged.length,
                successRate: successRate + '%'
            },
            allTime: {
                totalAttempts: this.stats.totalAttempts,
                totalSuccesses: this.stats.totalSuccesses,
                totalFailures: this.stats.totalFailures,
                totalBlocked: this.stats.totalBlocked,
                totalFlagged: this.stats.totalFlagged,
                since: this.stats.startedAt
            },
            recentFlagged: recentFlagged.slice(-10).reverse().map(f => ({
                email: this.maskEmail(f.email),
                ip: f.ip,
                score: f.score,
                signals: f.signals,
                time: f.time
            })),
            recentBlocked: recentBlocked.slice(-10).reverse().map(b => ({
                email: this.maskEmail(b.email),
                ip: b.ip,
                score: b.score,
                signals: b.signals,
                time: b.time
            })),
            status: 'active'
        };
    }

    // Mask email for logging (show first 2 chars + domain)
    maskEmail(email) {
        if (!email || !email.includes('@')) return '***';
        const [local, domain] = email.split('@');
        return local.substring(0, 2) + '***@' + domain;
    }

    // Mask IP for storage
    maskIP(ip) {
        if (!ip) return '0.0.0.0';
        const parts = ip.split('.');
        if (parts.length === 4) return parts[0] + '.' + parts[1] + '.x.x';
        return ip.substring(0, Math.min(ip.length, 12)) + '...';
    }

    // Persist data
    saveData() {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            const data = {
                stats: this.stats,
                attempts: this.attempts.slice(-200),
                successes: this.successes.slice(-100),
                failures: this.failures.slice(-100),
                blocked: this.blocked.slice(-50),
                flagged: this.flagged.slice(-50),
                savedAt: new Date().toISOString()
            };
            fs.writeFileSync(GUARD_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('[PaymentGuard] Save error:', e.message);
        }
    }

    // Load persisted data
    loadData() {
        try {
            if (fs.existsSync(GUARD_FILE)) {
                const data = JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8'));
                this.stats = data.stats || this.stats;
                this.attempts = data.attempts || [];
                this.successes = data.successes || [];
                this.failures = data.failures || [];
                this.blocked = data.blocked || [];
                this.flagged = data.flagged || [];
                console.log(`[PaymentGuard] Loaded ${this.attempts.length} attempts, ${this.successes.length} successes`);
            }
        } catch (e) {
            console.error('[PaymentGuard] Load error:', e.message);
        }
    }
}

module.exports = new AIPaymentGuard();
