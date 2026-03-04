/**
 * DOZ UP - Agent Queue Service
 * Real-time agent availability and queue management for live ticket system
 *
 * Features:
 * - Track agent availability in real-time
 * - Queue management with priority
 * - Estimated wait time calculation
 * - Auto-assign conversations to available agents
 * - Speed comparison: AI vs human response times
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Data file path
const DATA_FILE = path.join(__dirname, '..', 'data', 'agent-availability.json');

class AgentQueueService {
    constructor() {
        // Agent status tracking
        this.agents = new Map();

        // Conversation queue
        this.queue = [];

        // Settings
        this.settings = {
            aiTimeoutMs: parseInt(process.env.AI_RESPONSE_TIMEOUT_MS) || 8000,
            humanFallbackEnabled: true,
            maxQueueSize: 50,
            estimatedWaitPerPosition: 120, // seconds per queue position
            maxConcurrentChatsPerAgent: parseInt(process.env.AGENT_MAX_CONCURRENT) || 5
        };

        // Metrics
        this.metrics = {
            totalEscalations: 0,
            totalResolved: 0,
            avgWaitTime: 0,
            avgHandleTime: 0,
            aiTimeouts: 0
        };

        // Load persisted data
        this.loadData();

        // Process queue periodically
        setInterval(() => this.processQueue(), 5000);

        // Save data periodically
        setInterval(() => this.saveData(), 30000);

        console.log(`[Agent Queue] Initialized with ${this.agents.size} agents`);
    }

    loadData() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

                // Load agents
                if (data.agents) {
                    for (const [agentId, agent] of Object.entries(data.agents)) {
                        // Reset online status on startup (agents must re-connect)
                        agent.status = 'OFFLINE';
                        agent.activeConversations = [];
                        this.agents.set(agentId, agent);
                    }
                }

                // Load settings
                if (data.settings) {
                    Object.assign(this.settings, data.settings);
                }

                // Load metrics
                if (data.metrics) {
                    Object.assign(this.metrics, data.metrics);
                }
            }
        } catch (error) {
            console.error('[Agent Queue] Failed to load data:', error.message);
        }
    }

    saveData() {
        try {
            const data = {
                agents: Object.fromEntries(this.agents),
                queue: this.queue,
                settings: this.settings,
                metrics: this.metrics,
                savedAt: new Date().toISOString()
            };

            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[Agent Queue] Failed to save data:', error.message);
        }
    }

    // ==================== Agent Management ====================

    /**
     * Register a new agent or update existing
     */
    registerAgent(agentId, agentInfo) {
        const existing = this.agents.get(agentId);

        const agent = {
            id: agentId,
            name: agentInfo.name || 'Support Agent',
            email: agentInfo.email || null,
            skills: agentInfo.skills || ['general'],
            status: 'OFFLINE',
            statusSince: new Date().toISOString(),
            currentLoad: 0,
            maxConcurrent: agentInfo.maxConcurrent || this.settings.maxConcurrentChatsPerAgent,
            activeConversations: [],
            avgResponseTime: existing?.avgResponseTime || 60,
            totalHandled: existing?.totalHandled || 0,
            rating: existing?.rating || 5.0,
            createdAt: existing?.createdAt || new Date().toISOString()
        };

        this.agents.set(agentId, agent);
        return agent;
    }

    /**
     * Set agent online
     */
    setAgentOnline(agentId, socketInfo = {}) {
        const agent = this.agents.get(agentId);
        if (!agent) return null;

        agent.status = 'ONLINE';
        agent.statusSince = new Date().toISOString();
        agent.socket = socketInfo.socketId;

        console.log(`[Agent Queue] Agent ${agent.name} is now ONLINE`);

        // Process queue for new agent
        this.processQueue();

        return agent;
    }

    /**
     * Set agent offline
     */
    setAgentOffline(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) return null;

        agent.status = 'OFFLINE';
        agent.statusSince = new Date().toISOString();
        agent.socket = null;

        console.log(`[Agent Queue] Agent ${agent.name} is now OFFLINE`);

        // Re-queue any active conversations
        for (const convId of agent.activeConversations) {
            this.addToQueue(convId, 'HIGH', { reason: 'AGENT_OFFLINE' });
        }
        agent.activeConversations = [];
        agent.currentLoad = 0;

        return agent;
    }

    /**
     * Set agent away/busy
     */
    setAgentAway(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) return null;

        agent.status = 'AWAY';
        agent.statusSince = new Date().toISOString();

        return agent;
    }

    /**
     * Get available agents (online with capacity)
     */
    getAvailableAgents() {
        const available = [];

        for (const [id, agent] of this.agents) {
            if (agent.status === 'ONLINE' && agent.currentLoad < agent.maxConcurrent) {
                available.push({
                    ...agent,
                    availableSlots: agent.maxConcurrent - agent.currentLoad
                });
            }
        }

        // Sort by load (least loaded first) then by response time
        return available.sort((a, b) => {
            if (a.currentLoad !== b.currentLoad) {
                return a.currentLoad - b.currentLoad;
            }
            return a.avgResponseTime - b.avgResponseTime;
        });
    }

    /**
     * Get best agent for a conversation
     */
    getBestAgent(conversationContext = {}) {
        const available = this.getAvailableAgents();
        if (available.length === 0) return null;

        // If conversation has skill requirements, filter by skills
        if (conversationContext.category) {
            const skillMap = {
                'BILLING': 'billing',
                'TECHNICAL': 'technical',
                'ENTERPRISE': 'enterprise',
                'ACCOUNT': 'account'
            };

            const requiredSkill = skillMap[conversationContext.category];
            if (requiredSkill) {
                const skilled = available.filter(a => a.skills.includes(requiredSkill));
                if (skilled.length > 0) {
                    return skilled[0];
                }
            }
        }

        // Return best available agent
        return available[0];
    }

    // ==================== Queue Management ====================

    /**
     * Add conversation to queue
     */
    addToQueue(conversationId, priority = 'MEDIUM', metadata = {}) {
        // Check if already in queue
        const existing = this.queue.find(q => q.conversationId === conversationId);
        if (existing) {
            // Update priority if higher
            if (this.getPriorityValue(priority) > this.getPriorityValue(existing.priority)) {
                existing.priority = priority;
            }
            return existing;
        }

        // Check queue size
        if (this.queue.length >= this.settings.maxQueueSize) {
            console.warn('[Agent Queue] Queue is full!');
            return null;
        }

        const queueEntry = {
            id: uuidv4(),
            conversationId,
            priority,
            queuedAt: new Date().toISOString(),
            estimatedWait: this.calculateEstimatedWait(this.queue.length),
            metadata
        };

        // Insert based on priority
        const position = this.findInsertPosition(priority);
        this.queue.splice(position, 0, queueEntry);

        // Update positions
        this.updateQueuePositions();

        this.metrics.totalEscalations++;

        console.log(`[Agent Queue] Added conversation ${conversationId} to queue at position ${position + 1}`);

        return { ...queueEntry, position: position + 1 };
    }

    /**
     * Remove from queue
     */
    removeFromQueue(conversationId) {
        const index = this.queue.findIndex(q => q.conversationId === conversationId);
        if (index !== -1) {
            this.queue.splice(index, 1);
            this.updateQueuePositions();
            return true;
        }
        return false;
    }

    /**
     * Get queue position for a conversation
     */
    getQueuePosition(conversationId) {
        const index = this.queue.findIndex(q => q.conversationId === conversationId);
        if (index === -1) return null;

        return {
            position: index + 1,
            estimatedWait: this.calculateEstimatedWait(index),
            queuedAt: this.queue[index].queuedAt,
            priority: this.queue[index].priority
        };
    }

    /**
     * Process queue - assign conversations to available agents
     */
    processQueue() {
        if (this.queue.length === 0) return;

        const available = this.getAvailableAgents();
        if (available.length === 0) return;

        // Process queue items
        const toAssign = [];

        for (const queueEntry of this.queue) {
            const agent = this.getBestAgent(queueEntry.metadata);
            if (agent && agent.currentLoad < agent.maxConcurrent) {
                toAssign.push({
                    queueEntry,
                    agent
                });
                agent.currentLoad++; // Temporarily increment to prevent over-assignment
            }
        }

        // Perform assignments
        for (const { queueEntry, agent } of toAssign) {
            this.assignToAgent(queueEntry.conversationId, agent.id);
            this.removeFromQueue(queueEntry.conversationId);
        }
    }

    /**
     * Assign conversation to agent
     */
    assignToAgent(conversationId, agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) return null;

        if (!agent.activeConversations.includes(conversationId)) {
            agent.activeConversations.push(conversationId);
            agent.currentLoad = agent.activeConversations.length;
        }

        console.log(`[Agent Queue] Assigned conversation ${conversationId} to agent ${agent.name}`);

        return {
            agentId,
            agentName: agent.name,
            assignedAt: new Date().toISOString()
        };
    }

    /**
     * Release conversation from agent
     */
    releaseFromAgent(conversationId, agentId, resolved = true) {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        agent.activeConversations = agent.activeConversations.filter(id => id !== conversationId);
        agent.currentLoad = agent.activeConversations.length;

        if (resolved) {
            agent.totalHandled++;
            this.metrics.totalResolved++;
        }

        // Process queue for newly available agent
        this.processQueue();
    }

    // ==================== Helper Methods ====================

    getPriorityValue(priority) {
        const values = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'URGENT': 4 };
        return values[priority] || 2;
    }

    findInsertPosition(priority) {
        const priorityValue = this.getPriorityValue(priority);

        for (let i = 0; i < this.queue.length; i++) {
            if (this.getPriorityValue(this.queue[i].priority) < priorityValue) {
                return i;
            }
        }

        return this.queue.length;
    }

    updateQueuePositions() {
        for (let i = 0; i < this.queue.length; i++) {
            this.queue[i].position = i + 1;
            this.queue[i].estimatedWait = this.calculateEstimatedWait(i);
        }
    }

    calculateEstimatedWait(position) {
        const available = this.getAvailableAgents();
        const totalCapacity = available.reduce((sum, a) => sum + (a.maxConcurrent - a.currentLoad), 0);

        if (totalCapacity === 0) {
            return position * this.settings.estimatedWaitPerPosition;
        }

        // Estimate based on position and available capacity
        const avgHandleTime = this.metrics.avgHandleTime || 300; // 5 minutes default
        return Math.ceil((position / Math.max(totalCapacity, 1)) * avgHandleTime);
    }

    // ==================== Speed-Based Escalation ====================

    /**
     * Check if should escalate to human based on AI response time
     */
    shouldEscalateToHuman(aiResponseTime) {
        if (!this.settings.humanFallbackEnabled) {
            return { escalate: false };
        }

        // If AI took longer than timeout threshold
        if (aiResponseTime > this.settings.aiTimeoutMs) {
            const available = this.getAvailableAgents();

            if (available.length > 0) {
                const bestAgent = available[0];

                // If human can likely respond faster
                if (bestAgent.avgResponseTime * 1000 < aiResponseTime) {
                    return {
                        escalate: true,
                        reason: 'HUMAN_FASTER',
                        agentId: bestAgent.id,
                        agentName: bestAgent.name,
                        estimatedResponseTime: bestAgent.avgResponseTime
                    };
                }
            }

            // AI timed out but no agents available - still escalate to queue
            return {
                escalate: true,
                reason: 'AI_TIMEOUT',
                queuePosition: this.queue.length + 1,
                estimatedWait: this.calculateEstimatedWait(this.queue.length)
            };
        }

        return { escalate: false };
    }

    /**
     * Record AI timeout for metrics
     */
    recordAITimeout() {
        this.metrics.aiTimeouts++;
    }

    // ==================== Statistics ====================

    /**
     * Get queue statistics
     */
    getQueueStats() {
        const available = this.getAvailableAgents();

        return {
            queueSize: this.queue.length,
            avgWaitTime: this.calculateEstimatedWait(0),
            availableAgents: available.length,
            totalAgents: this.agents.size,
            onlineAgents: Array.from(this.agents.values()).filter(a => a.status === 'ONLINE').length,
            estimatedWaitForNew: this.calculateEstimatedWait(this.queue.length),
            metrics: this.metrics
        };
    }

    /**
     * Get agent statistics
     */
    getAgentStats(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) return null;

        return {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            currentLoad: agent.currentLoad,
            maxConcurrent: agent.maxConcurrent,
            activeConversations: agent.activeConversations.length,
            avgResponseTime: agent.avgResponseTime,
            totalHandled: agent.totalHandled,
            rating: agent.rating
        };
    }

    /**
     * Get all agents status
     */
    getAllAgentsStatus() {
        const agents = [];

        for (const [id, agent] of this.agents) {
            agents.push({
                id,
                name: agent.name,
                status: agent.status,
                currentLoad: agent.currentLoad,
                maxConcurrent: agent.maxConcurrent,
                availableSlots: agent.maxConcurrent - agent.currentLoad
            });
        }

        return agents;
    }
}

// Export singleton instance
const agentQueueService = new AgentQueueService();
module.exports = agentQueueService;
