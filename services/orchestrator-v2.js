/**
 * Orchestrator V2 - Priority-Tiered Parallel Execution Engine
 * Manages 1000+ AI agents across 20 departments
 *
 * Priority Tiers:
 *   P0 (Critical)  - Every 5 min    - ~50 agents   (security, server health)
 *   P1 (High)      - Every 15 min   - ~150 agents  (performance, quality core)
 *   P2 (Medium)    - Every 30 min   - ~300 agents  (SEO, UX, compliance)
 *   P3 (Low)       - Every 2 hours  - ~300 agents  (documentation, design system)
 *   P4 (Baseline)  - Every 6 hours  - ~200 agents  (competitive intel, deep analysis)
 *
 * Execution: 20 agents in parallel via Promise.allSettled
 * Memory: ~7MB steady-state for 1000 agents
 */

const EventEmitter = require('events');
const AgentRegistry = require('./agents/core/agent-registry');
const FileCache = require('./agents/core/file-cache');
const RollingBuffer = require('./agents/core/rolling-buffer');

const PRIORITY_INTERVALS = {
    P0: 5 * 60 * 1000,     // 5 minutes
    P1: 15 * 60 * 1000,    // 15 minutes
    P2: 30 * 60 * 1000,    // 30 minutes
    P3: 2 * 60 * 60 * 1000, // 2 hours
    P4: 6 * 60 * 60 * 1000  // 6 hours
};

const CONCURRENCY = 20; // Max parallel agents

class OrchestratorV2 extends EventEmitter {
    constructor() {
        super();
        this.registry = new AgentRegistry();
        this.fileCache = new FileCache();
        this.findings = new RollingBuffer(2000);
        this.tierTimers = {};
        this.running = false;
        this.lastTierRun = {};
        this.tierRunning = {};
        this.stats = {
            totalCycles: 0,
            totalFindings: 0,
            startedAt: null,
            lastActivity: null
        };

        // Also keep the legacy orchestrator's allFindings for backward compat
        this.allFindings = [];
        this.MAX_FINDINGS_HISTORY = 500;
    }

    /**
     * Initialize: load all agents (legacy + config-based)
     */
    initialize() {
        console.log('[OrchestratorV2] Initializing...');

        // Load legacy agents first
        const legacyCount = this.registry.loadLegacy();

        // Load config-based agents
        const { loaded, failed } = this.registry.loadConfigs();

        // Wire up event forwarding for ALL agents
        for (const agent of this.registry.getAll()) {
            this._wireAgent(agent);
        }

        const stats = this.registry.getStats();
        console.log(`[OrchestratorV2] Ready: ${stats.totalAgents} agents across ${stats.departments} departments`);
        console.log(`[OrchestratorV2] Priority distribution: P0=${stats.byPriority.P0} P1=${stats.byPriority.P1} P2=${stats.byPriority.P2} P3=${stats.byPriority.P3} P4=${stats.byPriority.P4}`);

        return stats;
    }

    /**
     * Wire agent events to orchestrator
     */
    _wireAgent(agent) {
        const events = ['start', 'progress', 'finding', 'complete', 'error'];
        events.forEach(evt => {
            agent.on(evt, (data) => {
                this.emit(`agent:${evt}`, data);

                if (evt === 'finding') {
                    this.findings.push(data);
                    // Legacy compat
                    this.allFindings.unshift(data);
                    if (this.allFindings.length > this.MAX_FINDINGS_HISTORY) {
                        this.allFindings = this.allFindings.slice(0, this.MAX_FINDINGS_HISTORY);
                    }
                    this.stats.totalFindings++;
                }

                this.stats.lastActivity = new Date().toISOString();
            });
        });
    }

    /**
     * Start priority-based scheduling
     */
    startSchedule() {
        if (this.running) return;
        this.running = true;
        this.stats.startedAt = new Date().toISOString();

        console.log('[OrchestratorV2] Starting priority-tiered schedule');

        // Run P0 immediately (most critical), then stagger other tiers
        setTimeout(() => this.runTier('P0'), 5000);
        setTimeout(() => this.runTier('P1'), 15000);
        setTimeout(() => this.runTier('P2'), 30000);
        setTimeout(() => this.runTier('P3'), 60000);
        setTimeout(() => this.runTier('P4'), 120000);

        // Set up recurring timers for each tier
        for (const [tier, interval] of Object.entries(PRIORITY_INTERVALS)) {
            this.tierTimers[tier] = setInterval(() => {
                this.runTier(tier);
            }, interval);
        }

        console.log('[OrchestratorV2] Schedule active - P0 every 5m, P1 every 15m, P2 every 30m, P3 every 2h, P4 every 6h');
    }

    /**
     * Stop all timers
     */
    stopSchedule() {
        this.running = false;
        for (const timer of Object.values(this.tierTimers)) {
            clearInterval(timer);
        }
        this.tierTimers = {};
        console.log('[OrchestratorV2] Schedule stopped');
    }

    /**
     * Run all agents in a priority tier (parallel batches of CONCURRENCY)
     */
    async runTier(tier) {
        if (this.tierRunning[tier]) {
            console.log(`[OrchestratorV2] Tier ${tier} already running, skipping`);
            return;
        }

        const agents = this.registry.getByPriority(tier);
        if (agents.length === 0) return;

        this.tierRunning[tier] = true;
        this.lastTierRun[tier] = new Date().toISOString();
        const startTime = Date.now();

        console.log(`[OrchestratorV2] Running tier ${tier}: ${agents.length} agents (concurrency: ${CONCURRENCY})`);
        this.emit('tier:start', { tier, count: agents.length, timestamp: this.lastTierRun[tier] });

        // Clear file cache for this cycle (files may have changed)
        this.fileCache.clearCycle();

        // Pre-warm cache with commonly needed files
        this.fileCache.get('gateway.js');

        // Run in parallel batches
        let completed = 0;
        let errors = 0;

        for (let i = 0; i < agents.length; i += CONCURRENCY) {
            const batch = agents.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(agent => {
                    if (agent.state === 'running') return Promise.resolve();
                    return agent.run(this.fileCache);
                })
            );

            for (const result of results) {
                if (result.status === 'fulfilled') completed++;
                else errors++;
            }
        }

        const duration = Date.now() - startTime;
        this.tierRunning[tier] = false;
        this.stats.totalCycles++;

        console.log(`[OrchestratorV2] Tier ${tier} complete: ${completed} ok, ${errors} errors, ${duration}ms, ${this.fileCache.readCount} file reads`);
        this.emit('tier:complete', { tier, completed, errors, duration, fileReads: this.fileCache.readCount });
    }

    /**
     * Run ALL agents across ALL tiers
     */
    async runAll() {
        console.log('[OrchestratorV2] Running ALL agents');
        this.fileCache.clearCycle();
        this.fileCache.get('gateway.js');

        for (const tier of ['P0', 'P1', 'P2', 'P3', 'P4']) {
            await this.runTier(tier);
        }
        console.log('[OrchestratorV2] Full cycle complete');
    }

    /**
     * Run a single agent by ID
     */
    async runAgent(agentId) {
        const agent = this.registry.get(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);
        if (agent.state === 'running') throw new Error(`Agent ${agentId} already running`);

        this.fileCache.clearCycle();
        return agent.run(this.fileCache);
    }

    /**
     * Run all agents in a department
     */
    async runDepartment(department) {
        const agents = this.registry.getByDepartment(department);
        if (agents.length === 0) throw new Error(`No agents in department: ${department}`);

        console.log(`[OrchestratorV2] Running department ${department}: ${agents.length} agents`);
        this.fileCache.clearCycle();
        this.fileCache.get('gateway.js');

        for (let i = 0; i < agents.length; i += CONCURRENCY) {
            const batch = agents.slice(i, i + CONCURRENCY);
            await Promise.allSettled(batch.map(a => {
                if (a.state === 'running') return Promise.resolve();
                return a.run(this.fileCache);
            }));
        }
    }

    /**
     * Get full status for dashboard
     */
    getStatus() {
        const allAgents = this.registry.getAll();
        const deptSummary = this.registry.getDepartmentSummary();
        const regStats = this.registry.getStats();

        return {
            totalAgents: regStats.totalAgents,
            departments: deptSummary,
            departmentCount: regStats.departments,
            byPriority: regStats.byPriority,
            runningAgents: allAgents.filter(a => a.state === 'running').length,
            completedAgents: allAgents.filter(a => a.state === 'completed').length,
            errorAgents: allAgents.filter(a => a.state === 'error').length,
            totalFindings: this.findings.length,
            lastTierRun: this.lastTierRun,
            scheduleActive: this.running,
            stats: this.stats,
            fileCache: this.fileCache.getStats(),
            healthScore: this._calculateHealthScore()
        };
    }

    /**
     * Calculate overall health score (0-1000)
     */
    _calculateHealthScore() {
        const findings = this.findings.getAll();
        if (findings.length === 0) return { score: 1000, grade: 'A+' };

        // Deduct points by severity
        const weights = { critical: 50, high: 20, medium: 5, low: 1, info: 0 };
        let deductions = 0;
        const counted = new Set();

        for (const f of findings) {
            // Deduplicate by title
            if (counted.has(f.title)) continue;
            counted.add(f.title);
            deductions += weights[f.severity] || 0;
        }

        const score = Math.max(0, 1000 - deductions);
        let grade;
        if (score >= 950) grade = 'A+';
        else if (score >= 900) grade = 'A';
        else if (score >= 850) grade = 'A-';
        else if (score >= 800) grade = 'B+';
        else if (score >= 750) grade = 'B';
        else if (score >= 700) grade = 'B-';
        else if (score >= 650) grade = 'C+';
        else if (score >= 600) grade = 'C';
        else grade = 'D';

        return { score, grade, deductions, uniqueFindings: counted.size };
    }

    /**
     * Get findings with optional filters
     */
    getFindings(options = {}) {
        let findings = this.findings.getAll();

        if (options.severity) {
            findings = findings.filter(f => f.severity === options.severity);
        }
        if (options.department) {
            findings = findings.filter(f => f.department === options.department);
        }
        if (options.agentId) {
            findings = findings.filter(f => f.agentId === options.agentId);
        }

        // Sort by severity
        const severityWeight = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        findings.sort((a, b) => (severityWeight[a.severity] || 5) - (severityWeight[b.severity] || 5));

        return findings.slice(0, options.limit || 200);
    }

    /**
     * Get agent details list for dashboard
     */
    getAgentList(options = {}) {
        let agents = this.registry.getAll().map(a => a.getStatus());

        if (options.department) {
            agents = agents.filter(a => a.department === options.department);
        }
        if (options.priority) {
            agents = agents.filter(a => a.priority === options.priority);
        }
        if (options.state) {
            agents = agents.filter(a => a.state === options.state);
        }

        return agents;
    }
}

// Singleton
const orchestratorV2 = new OrchestratorV2();
module.exports = orchestratorV2;
