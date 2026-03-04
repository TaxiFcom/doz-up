/**
 * AI Agent Orchestrator
 * Central coordinator for all 9 AI agents across 3 departments
 * Manages scheduling, execution, and real-time event broadcasting
 */

const EventEmitter = require('events');
const path = require('path');

class AIAgentOrchestrator extends EventEmitter {
    constructor() {
        super();
        this.agents = new Map();
        this.scheduleTimers = new Map();
        this.cycleInterval = null;
        this.running = false;
        this.lastFullCycle = null;
        this.allFindings = [];
        this.MAX_FINDINGS_HISTORY = 500;
    }

    /**
     * Register an agent
     */
    registerAgent(agent) {
        this.agents.set(agent.id, agent);

        // Forward agent events to orchestrator
        const events = ['start', 'progress', 'finding', 'complete', 'error'];
        events.forEach(evt => {
            agent.on(evt, (data) => {
                this.emit(`agent:${evt}`, data);

                if (evt === 'finding') {
                    this.allFindings.unshift(data);
                    if (this.allFindings.length > this.MAX_FINDINGS_HISTORY) {
                        this.allFindings = this.allFindings.slice(0, this.MAX_FINDINGS_HISTORY);
                    }
                }
            });
        });

        console.log(`[Orchestrator] Registered agent: ${agent.name} (${agent.department})`);
    }

    /**
     * Load and register all agents
     */
    loadAgents() {
        const agentFiles = [
            // Security Department
            { file: './agents/security-scanner', dept: 'security' },
            { file: './agents/config-auditor', dept: 'security' },
            { file: './agents/dependency-checker', dept: 'security' },
            // Performance Department
            { file: './agents/memory-optimizer', dept: 'performance' },
            { file: './agents/response-monitor', dept: 'performance' },
            { file: './agents/cache-analyzer', dept: 'performance' },
            // Quality Department
            { file: './agents/api-completeness', dept: 'quality' },
            { file: './agents/data-integrity', dept: 'quality' },
            { file: './agents/frontend-validator', dept: 'quality' }
        ];

        for (const { file } of agentFiles) {
            try {
                const AgentClass = require(file);
                const agent = new AgentClass();
                this.registerAgent(agent);
            } catch (err) {
                console.error(`[Orchestrator] Failed to load ${file}: ${err.message}`);
            }
        }

        console.log(`[Orchestrator] Loaded ${this.agents.size} agents`);
    }

    /**
     * Start scheduled execution cycle
     */
    startSchedule(intervalMinutes = 30) {
        if (this.running) return;
        this.running = true;

        console.log(`[Orchestrator] Starting schedule - full cycle every ${intervalMinutes}min`);

        // Run first cycle after 10 seconds
        setTimeout(() => this.runAll(), 10000);

        // Schedule recurring cycles
        this.cycleInterval = setInterval(() => {
            this.runAll();
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Stop scheduled execution
     */
    stopSchedule() {
        this.running = false;
        if (this.cycleInterval) {
            clearInterval(this.cycleInterval);
            this.cycleInterval = null;
        }
        this.scheduleTimers.forEach(timer => clearTimeout(timer));
        this.scheduleTimers.clear();
        console.log('[Orchestrator] Schedule stopped');
    }

    /**
     * Run all agents sequentially with staggered starts (5s gap)
     */
    async runAll() {
        if (this._cycleRunning) {
            console.log('[Orchestrator] Cycle already in progress, skipping');
            return;
        }
        this._cycleRunning = true;
        console.log('[Orchestrator] Starting full agent cycle');
        this.lastFullCycle = new Date().toISOString();
        this.emit('cycle:start', { timestamp: this.lastFullCycle, agentCount: this.agents.size });

        const agents = Array.from(this.agents.values());
        const STAGGER_MS = 5000; // 5s between each agent

        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            console.log(`[Orchestrator] Running agent ${i + 1}/${agents.length}: ${agent.id}`);
            try {
                if (agent.state !== 'running') {
                    await agent.run();
                    console.log(`[Orchestrator] Agent ${agent.id} completed (${agent.findings.length} findings)`);
                }
            } catch (err) {
                console.error(`[Orchestrator] Agent ${agent.id} run failed:`, err.message);
            }
            // Wait between agents (except after last)
            if (i < agents.length - 1) {
                await new Promise(resolve => setTimeout(resolve, STAGGER_MS));
            }
        }

        this._cycleRunning = false;
        this.emit('cycle:complete', { timestamp: new Date().toISOString(), agentCount: this.agents.size });
        console.log('[Orchestrator] Full cycle complete');
    }

    /**
     * Run a single agent by ID
     */
    async runAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);
        if (agent.state === 'running') throw new Error(`Agent ${agentId} already running`);

        return agent.run();
    }

    /**
     * Run all agents in a department
     */
    async runDepartment(department) {
        const agents = Array.from(this.agents.values()).filter(a => a.department === department);
        if (agents.length === 0) throw new Error(`No agents in department: ${department}`);

        console.log(`[Orchestrator] Running ${department} department (${agents.length} agents)`);

        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            try {
                if (agent.state !== 'running') {
                    await agent.run();
                }
            } catch (err) {
                console.error(`[Orchestrator] Agent ${agent.id} failed:`, err.message);
            }
            if (i < agents.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    /**
     * Get full status for dashboard
     */
    getStatus() {
        const agents = Array.from(this.agents.values()).map(a => a.getStatus());
        const departments = {};

        for (const agent of agents) {
            if (!departments[agent.department]) {
                departments[agent.department] = { agents: [], findings: 0, running: 0 };
            }
            departments[agent.department].agents.push(agent);
            departments[agent.department].findings += agent.findingsCount;
            if (agent.state === 'running') departments[agent.department].running++;
        }

        return {
            totalAgents: this.agents.size,
            runningAgents: agents.filter(a => a.state === 'running').length,
            totalFindings: this.allFindings.length,
            departments,
            agents,
            lastFullCycle: this.lastFullCycle,
            scheduleActive: this.running
        };
    }

    /**
     * Get all findings, optionally filtered
     */
    getFindings(options = {}) {
        let findings = [...this.allFindings];

        if (options.severity) {
            findings = findings.filter(f => f.severity === options.severity);
        }
        if (options.department) {
            findings = findings.filter(f => f.department === options.department);
        }
        if (options.agentId) {
            findings = findings.filter(f => f.agentId === options.agentId);
        }

        // Sort by severity weight
        const severityWeight = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        findings.sort((a, b) => (severityWeight[a.severity] || 5) - (severityWeight[b.severity] || 5));

        return findings.slice(0, options.limit || 100);
    }
}

// Singleton
const orchestrator = new AIAgentOrchestrator();
module.exports = orchestrator;
