/**
 * DOZ SSH Uplink Management API
 * Provides REST endpoints for managing SSH uplinks dynamically
 */

const express = require('express');
const { getLoadBalancer } = require('./ssh-loadbalancer');

function createSSHUplinkAPI(app, authMiddleware = null) {
    const router = express.Router();

    // Optional auth middleware
    if (authMiddleware) {
        router.use(authMiddleware);
    }

    /**
     * GET /api/ssh/uplinks
     * List all SSH uplinks with their status
     */
    router.get('/uplinks', (req, res) => {
        const lb = getLoadBalancer();
        res.json({
            success: true,
            uplinks: lb.getUplinks(),
            stats: lb.getStats()
        });
    });

    /**
     * GET /api/ssh/uplinks/:id
     * Get specific uplink details
     */
    router.get('/uplinks/:id', (req, res) => {
        const lb = getLoadBalancer();
        const uplinks = lb.getUplinks();
        const uplink = uplinks.find(u => u.id === req.params.id);

        if (!uplink) {
            return res.status(404).json({
                success: false,
                error: 'Uplink not found'
            });
        }

        res.json({
            success: true,
            uplink
        });
    });

    /**
     * POST /api/ssh/uplinks
     * Add a new SSH uplink
     */
    router.post('/uplinks', (req, res) => {
        const { host, port, username, password, privateKey, priority, weight, id } = req.body;

        if (!host || !username) {
            return res.status(400).json({
                success: false,
                error: 'Host and username are required'
            });
        }

        const lb = getLoadBalancer();

        try {
            const uplinkId = lb.addUplink({
                id,
                host,
                port: port || 22,
                username,
                password,
                privateKey,
                priority: priority || 1,
                weight: weight || 1
            });

            res.json({
                success: true,
                id: uplinkId,
                message: `Uplink ${host} added successfully`
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * DELETE /api/ssh/uplinks/:id
     * Remove an SSH uplink
     */
    router.delete('/uplinks/:id', (req, res) => {
        const lb = getLoadBalancer();
        const removed = lb.removeUplink(req.params.id);

        if (!removed) {
            return res.status(404).json({
                success: false,
                error: 'Uplink not found'
            });
        }

        res.json({
            success: true,
            message: `Uplink ${req.params.id} removed`
        });
    });

    /**
     * POST /api/ssh/uplinks/:id/test
     * Test connection to an uplink
     */
    router.post('/uplinks/:id/test', async (req, res) => {
        const lb = getLoadBalancer();
        const uplinks = lb.getUplinks();
        const uplink = uplinks.find(u => u.id === req.params.id);

        if (!uplink) {
            return res.status(404).json({
                success: false,
                error: 'Uplink not found'
            });
        }

        // Trigger health check
        res.json({
            success: true,
            uplink: {
                id: uplink.id,
                host: uplink.host,
                status: uplink.status,
                healthScore: uplink.healthScore,
                latency: uplink.latency
            }
        });
    });

    /**
     * GET /api/ssh/stats
     * Get overall SSH load balancer statistics
     */
    router.get('/stats', (req, res) => {
        const lb = getLoadBalancer();
        const stats = lb.getStats();

        res.json({
            success: true,
            stats: {
                ...stats,
                uptimeFormatted: formatUptime(stats.uptime),
                bytesTransferredFormatted: formatBytes(stats.bytesTransferred)
            }
        });
    });

    /**
     * GET /api/ssh/sessions
     * Get active SSH sessions
     */
    router.get('/sessions', (req, res) => {
        const lb = getLoadBalancer();
        const sessions = [];

        lb.sessions.forEach((session, id) => {
            sessions.push({
                id,
                uplinkId: session.uplinkId,
                status: session.status,
                createdAt: session.createdAt,
                lastActivity: session.lastActivity,
                reconnectAttempts: session.reconnectAttempts
            });
        });

        res.json({
            success: true,
            sessions,
            total: sessions.length
        });
    });

    /**
     * DELETE /api/ssh/sessions/:id
     * Close a specific SSH session
     */
    router.delete('/sessions/:id', (req, res) => {
        const lb = getLoadBalancer();

        if (!lb.sessions.has(req.params.id)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        lb.closeSession(req.params.id);

        res.json({
            success: true,
            message: `Session ${req.params.id} closed`
        });
    });

    /**
     * POST /api/ssh/failover
     * Force failover to next uplink
     */
    router.post('/failover', (req, res) => {
        const lb = getLoadBalancer();

        // Get current primary
        const stats = lb.getStats();
        const currentPrimary = stats.primaryUplink;

        // Find current primary and mark unhealthy to trigger failover
        lb.uplinks.forEach(uplink => {
            if (uplink.host === currentPrimary) {
                uplink.status = 'unhealthy';
                uplink.failedHealthChecks = lb.config.failoverThreshold + 1;
            }
        });

        lb._electPrimaryUplink();
        const newStats = lb.getStats();

        res.json({
            success: true,
            previousPrimary: currentPrimary,
            newPrimary: newStats.primaryUplink,
            message: 'Failover initiated'
        });
    });

    /**
     * POST /api/ssh/reload
     * Reload uplink configuration from file
     */
    router.post('/reload', (req, res) => {
        const lb = getLoadBalancer();

        // Clear existing uplinks
        lb.uplinks.forEach((_, id) => {
            lb.removeUplink(id);
        });

        // Reload from config
        lb._loadUplinkConfig();

        res.json({
            success: true,
            message: 'Configuration reloaded',
            uplinks: lb.getUplinks().length
        });
    });

    // Mount router
    app.use('/api/ssh', router);

    console.log('[SSH API] SSH uplink management API mounted at /api/ssh');

    return router;
}

// Helper functions
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { createSSHUplinkAPI };
