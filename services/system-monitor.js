/**
 * DOZ UP System Monitor
 * 100% real-time monitoring of all inputs, connections, and system health
 *
 * Features:
 * - Real-time metrics tracking for all WebSocket endpoints
 * - CPU, memory, and heap monitoring
 * - Connection rate tracking
 * - Error rate monitoring with alerts
 * - Threshold-based alerting system
 * - Ready for 1M+ req/min capacity
 */

const os = require('os');
const v8 = require('v8');
const { EventEmitter } = require('events');

// Monitoring configuration
const METRICS_INTERVAL = 1000;    // Update metrics every 1 second
const HISTORY_RETENTION = 3600;   // Keep 1 hour of history (seconds)
const ALERT_COOLDOWN = 60000;     // Don't repeat same alert for 60 seconds

class SystemMonitor extends EventEmitter {
    constructor() {
        super();

        // Real-time metrics
        this.metrics = {
            // Connection metrics
            activeConnections: 0,
            connectionsByPlatform: {
                desktop: 0,
                widget: 0,
                extension: 0,
                mobile: 0,
                web: 0,
                admin: 0
            },
            connectionsPerSecond: 0,
            peakConnections: 0,

            // Message metrics
            messagesTotal: 0,
            messagesPerMinute: 0,
            messagesPerSecond: 0,
            avgMessageLatency: 0,
            peakMessagesPerMinute: 0,

            // WebSocket endpoint metrics
            wsMetrics: {
                live: { active: 0, msgRate: 0, errors: 0 },
                brain: { active: 0, msgRate: 0, errors: 0 },
                admin: { active: 0, msgRate: 0, errors: 0 },
                viral: { active: 0, msgRate: 0, errors: 0 },
                analytics: { active: 0, msgRate: 0, errors: 0 },
                support: { active: 0, msgRate: 0, errors: 0 },
                monitor: { active: 0, msgRate: 0, errors: 0 }
            },

            // Error metrics
            errorCount: 0,
            errorRate: 0,
            errorsPerMinute: 0,

            // Resource metrics
            cpuUsage: 0,
            memoryUsage: 0,
            memoryTotal: os.totalmem(),
            memoryFree: os.freemem(),
            heapUsed: 0,
            heapTotal: 0,
            heapLimit: 0,

            // Process metrics
            uptime: process.uptime(),
            nodeVersion: process.version,
            pid: process.pid,

            // Timestamp
            lastUpdated: Date.now()
        };

        // Thresholds for alerting
        this.thresholds = {
            maxConnections: 50000,
            maxMessagesPerMinute: 1000000,  // 1M req/min target
            maxLatency: 500,                // 500ms
            maxErrorRate: 1,                // 1%
            maxCpuUsage: 80,                // 80%
            maxMemoryUsage: 85              // 85%
        };

        // Alert history
        this.alerts = [];
        this.alertCooldowns = new Map();  // alertType -> lastTriggered

        // Input log (ring buffer)
        this.inputLog = [];
        this.maxInputLog = 10000;

        // Historical metrics (for graphs)
        this.history = {
            connections: [],
            messages: [],
            errors: [],
            cpu: [],
            memory: []
        };

        // Rate tracking
        this.messageTimestamps = [];
        this.connectionTimestamps = [];
        this.errorTimestamps = [];

        // CPU tracking
        this.lastCpuUsage = process.cpuUsage();
        this.lastCpuTime = Date.now();

        // Start monitoring
        this.startMonitoring();

        console.log('[Monitor] System Monitor initialized');
    }

    /**
     * Start the monitoring loop
     */
    startMonitoring() {
        // Main metrics update loop
        this.metricsInterval = setInterval(() => {
            this.updateMetrics();
        }, METRICS_INTERVAL);

        // History recording (every 10 seconds)
        this.historyInterval = setInterval(() => {
            this.recordHistory();
        }, 10000);

        // Clean old data (every minute)
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        clearInterval(this.metricsInterval);
        clearInterval(this.historyInterval);
        clearInterval(this.cleanupInterval);
    }

    /**
     * Update all metrics
     */
    updateMetrics() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const oneSecondAgo = now - 1000;

        // Calculate rates
        this.messageTimestamps = this.messageTimestamps.filter(t => t > oneMinuteAgo);
        this.connectionTimestamps = this.connectionTimestamps.filter(t => t > oneMinuteAgo);
        this.errorTimestamps = this.errorTimestamps.filter(t => t > oneMinuteAgo);

        this.metrics.messagesPerMinute = this.messageTimestamps.length;
        this.metrics.messagesPerSecond = this.messageTimestamps.filter(t => t > oneSecondAgo).length;
        this.metrics.connectionsPerSecond = this.connectionTimestamps.filter(t => t > oneSecondAgo).length;
        this.metrics.errorsPerMinute = this.errorTimestamps.length;

        // Peak tracking
        if (this.metrics.messagesPerMinute > this.metrics.peakMessagesPerMinute) {
            this.metrics.peakMessagesPerMinute = this.metrics.messagesPerMinute;
        }

        // Error rate
        if (this.metrics.messagesTotal > 0) {
            this.metrics.errorRate = parseFloat(
                (this.metrics.errorCount / this.metrics.messagesTotal * 100).toFixed(3)
            );
        }

        // CPU usage
        this.updateCpuUsage();

        // Memory usage
        this.updateMemoryUsage();

        // Update timestamp
        this.metrics.uptime = process.uptime();
        this.metrics.lastUpdated = now;

        // Check thresholds and alert
        this.checkThresholds();

        // Emit update event
        this.emit('metrics', this.metrics);
    }

    /**
     * Update CPU usage metrics
     */
    updateCpuUsage() {
        const currentCpuUsage = process.cpuUsage();
        const currentTime = Date.now();
        const timeDiff = currentTime - this.lastCpuTime;

        if (timeDiff > 0) {
            const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
            const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
            const totalDiff = userDiff + systemDiff;

            // CPU usage as percentage (microseconds to milliseconds)
            const cpuPercent = (totalDiff / 1000) / timeDiff * 100;
            this.metrics.cpuUsage = Math.min(100, Math.round(cpuPercent * 10) / 10);
        }

        this.lastCpuUsage = currentCpuUsage;
        this.lastCpuTime = currentTime;
    }

    /**
     * Update memory usage metrics
     */
    updateMemoryUsage() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();

        this.metrics.heapUsed = Math.round(memUsage.heapUsed / 1024 / 1024);  // MB
        this.metrics.heapTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
        this.metrics.heapLimit = Math.round(heapStats.heap_size_limit / 1024 / 1024);

        this.metrics.memoryFree = os.freemem();
        this.metrics.memoryTotal = os.totalmem();
        this.metrics.memoryUsage = Math.round(
            (1 - this.metrics.memoryFree / this.metrics.memoryTotal) * 100
        );
    }

    /**
     * Check thresholds and trigger alerts
     */
    checkThresholds() {
        // Connection threshold
        if (this.metrics.activeConnections > this.thresholds.maxConnections * 0.9) {
            this.alert('HIGH_CONNECTIONS', `Connections at ${this.metrics.activeConnections} (90% of max)`, 'warning');
        }
        if (this.metrics.activeConnections > this.thresholds.maxConnections) {
            this.alert('MAX_CONNECTIONS', `Connections exceeded max: ${this.metrics.activeConnections}`, 'critical');
        }

        // Message rate threshold
        if (this.metrics.messagesPerMinute > this.thresholds.maxMessagesPerMinute * 0.8) {
            this.alert('HIGH_MESSAGE_RATE', `Message rate at ${this.metrics.messagesPerMinute}/min (80% of 1M target)`, 'warning');
        }
        if (this.metrics.messagesPerMinute > this.thresholds.maxMessagesPerMinute) {
            this.alert('MAX_MESSAGE_RATE', `Exceeding 1M req/min: ${this.metrics.messagesPerMinute}/min`, 'critical');
        }

        // Latency threshold
        if (this.metrics.avgMessageLatency > this.thresholds.maxLatency) {
            this.alert('HIGH_LATENCY', `Average latency at ${this.metrics.avgMessageLatency}ms`, 'warning');
        }

        // Error rate threshold
        if (this.metrics.errorRate > this.thresholds.maxErrorRate) {
            this.alert('HIGH_ERROR_RATE', `Error rate at ${this.metrics.errorRate}%`, 'critical');
        }

        // CPU threshold
        if (this.metrics.cpuUsage > this.thresholds.maxCpuUsage) {
            this.alert('HIGH_CPU', `CPU usage at ${this.metrics.cpuUsage}%`, 'warning');
        }

        // Memory threshold
        if (this.metrics.memoryUsage > this.thresholds.maxMemoryUsage) {
            this.alert('HIGH_MEMORY', `Memory usage at ${this.metrics.memoryUsage}%`, 'warning');
        }
    }

    /**
     * Create an alert
     */
    alert(type, message, severity = 'info') {
        const now = Date.now();

        // Check cooldown
        const lastAlert = this.alertCooldowns.get(type);
        if (lastAlert && now - lastAlert < ALERT_COOLDOWN) {
            return; // Still in cooldown
        }

        const alert = {
            id: `alert_${now}_${Math.random().toString(36).substring(7)}`,
            type,
            message,
            severity,
            timestamp: now,
            acknowledged: false
        };

        this.alerts.push(alert);
        this.alertCooldowns.set(type, now);

        // Keep alerts list manageable
        if (this.alerts.length > 1000) {
            this.alerts = this.alerts.slice(-500);
        }

        console.log(`[Monitor] ALERT [${severity.toUpperCase()}] ${type}: ${message}`);

        // Emit alert event
        this.emit('alert', alert);

        return alert;
    }

    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            alert.acknowledgedAt = Date.now();
            return true;
        }
        return false;
    }

    /**
     * Track an input (message, connection, request)
     */
    trackInput(source, type, data = {}) {
        const now = Date.now();

        // Add to message timestamps
        this.messageTimestamps.push(now);
        this.metrics.messagesTotal++;

        // Calculate latency if provided
        if (data.startTime) {
            const latency = now - data.startTime;
            // Exponential moving average for latency
            this.metrics.avgMessageLatency = Math.round(
                this.metrics.avgMessageLatency * 0.9 + latency * 0.1
            );
        }

        // Log the input
        const input = {
            timestamp: now,
            source,
            type,
            data: typeof data === 'object' ? { ...data, startTime: undefined } : data
        };

        this.inputLog.push(input);
        if (this.inputLog.length > this.maxInputLog) {
            this.inputLog.shift();
        }

        // Update endpoint metrics if applicable
        if (data.endpoint && this.metrics.wsMetrics[data.endpoint]) {
            this.metrics.wsMetrics[data.endpoint].msgRate++;
        }

        return input;
    }

    /**
     * Track a connection
     */
    trackConnection(action, platform, endpoint, details = {}) {
        const now = Date.now();

        if (action === 'connect') {
            this.connectionTimestamps.push(now);
            this.metrics.activeConnections++;

            if (platform && this.metrics.connectionsByPlatform[platform] !== undefined) {
                this.metrics.connectionsByPlatform[platform]++;
            }

            if (endpoint && this.metrics.wsMetrics[endpoint]) {
                this.metrics.wsMetrics[endpoint].active++;
            }

            // Peak tracking
            if (this.metrics.activeConnections > this.metrics.peakConnections) {
                this.metrics.peakConnections = this.metrics.activeConnections;
            }
        } else if (action === 'disconnect') {
            this.metrics.activeConnections = Math.max(0, this.metrics.activeConnections - 1);

            if (platform && this.metrics.connectionsByPlatform[platform] !== undefined) {
                this.metrics.connectionsByPlatform[platform] = Math.max(
                    0,
                    this.metrics.connectionsByPlatform[platform] - 1
                );
            }

            if (endpoint && this.metrics.wsMetrics[endpoint]) {
                this.metrics.wsMetrics[endpoint].active = Math.max(
                    0,
                    this.metrics.wsMetrics[endpoint].active - 1
                );
            }
        }

        this.trackInput('connection', action, { platform, endpoint, ...details });
    }

    /**
     * Track an error
     */
    trackError(source, error, context = {}) {
        const now = Date.now();
        this.errorTimestamps.push(now);
        this.metrics.errorCount++;

        // Update endpoint error count
        if (context.endpoint && this.metrics.wsMetrics[context.endpoint]) {
            this.metrics.wsMetrics[context.endpoint].errors++;
        }

        this.trackInput(source, 'error', {
            error: error?.message || String(error),
            stack: error?.stack?.substring(0, 200),
            ...context
        });

        this.emit('error', { source, error, context, timestamp: now });
    }

    /**
     * Record history point
     */
    recordHistory() {
        const point = {
            timestamp: Date.now(),
            value: null
        };

        this.history.connections.push({ ...point, value: this.metrics.activeConnections });
        this.history.messages.push({ ...point, value: this.metrics.messagesPerMinute });
        this.history.errors.push({ ...point, value: this.metrics.errorsPerMinute });
        this.history.cpu.push({ ...point, value: this.metrics.cpuUsage });
        this.history.memory.push({ ...point, value: this.metrics.memoryUsage });

        // Trim old history
        const maxPoints = HISTORY_RETENTION / 10;  // 10 second intervals
        Object.keys(this.history).forEach(key => {
            if (this.history[key].length > maxPoints) {
                this.history[key] = this.history[key].slice(-maxPoints);
            }
        });
    }

    /**
     * Cleanup old data
     */
    cleanup() {
        const oneMinuteAgo = Date.now() - 60000;

        this.messageTimestamps = this.messageTimestamps.filter(t => t > oneMinuteAgo);
        this.connectionTimestamps = this.connectionTimestamps.filter(t => t > oneMinuteAgo);
        this.errorTimestamps = this.errorTimestamps.filter(t => t > oneMinuteAgo);

        // Reset per-minute counters in wsMetrics
        Object.keys(this.metrics.wsMetrics).forEach(endpoint => {
            this.metrics.wsMetrics[endpoint].msgRate = 0;
        });
    }

    /**
     * Get health status
     */
    isHealthy() {
        return (
            this.metrics.cpuUsage < this.thresholds.maxCpuUsage &&
            this.metrics.memoryUsage < this.thresholds.maxMemoryUsage &&
            this.metrics.errorRate < this.thresholds.maxErrorRate &&
            this.metrics.activeConnections < this.thresholds.maxConnections
        );
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            timestamp: Date.now(),
            healthy: this.isHealthy(),
            uptime: this.metrics.uptime,
            metrics: {
                connections: {
                    active: this.metrics.activeConnections,
                    peak: this.metrics.peakConnections,
                    perSecond: this.metrics.connectionsPerSecond,
                    byPlatform: this.metrics.connectionsByPlatform
                },
                messages: {
                    total: this.metrics.messagesTotal,
                    perMinute: this.metrics.messagesPerMinute,
                    perSecond: this.metrics.messagesPerSecond,
                    peakPerMinute: this.metrics.peakMessagesPerMinute,
                    avgLatency: this.metrics.avgMessageLatency
                },
                errors: {
                    count: this.metrics.errorCount,
                    perMinute: this.metrics.errorsPerMinute,
                    rate: this.metrics.errorRate + '%'
                },
                resources: {
                    cpu: this.metrics.cpuUsage + '%',
                    memory: this.metrics.memoryUsage + '%',
                    heapUsed: this.metrics.heapUsed + 'MB',
                    heapTotal: this.metrics.heapTotal + 'MB'
                },
                endpoints: this.metrics.wsMetrics
            },
            alerts: this.alerts.filter(a => !a.acknowledged).slice(-10)
        };
    }

    /**
     * Get detailed metrics (for dashboard)
     */
    getDetailedMetrics() {
        return {
            ...this.getStatus(),
            thresholds: this.thresholds,
            history: {
                connections: this.history.connections.slice(-60),
                messages: this.history.messages.slice(-60),
                errors: this.history.errors.slice(-60),
                cpu: this.history.cpu.slice(-60),
                memory: this.history.memory.slice(-60)
            },
            recentInputs: this.inputLog.slice(-100)
        };
    }

    /**
     * Get all alerts
     */
    getAlerts(includeAcknowledged = false) {
        if (includeAcknowledged) {
            return this.alerts.slice(-100);
        }
        return this.alerts.filter(a => !a.acknowledged).slice(-100);
    }

    /**
     * Update thresholds
     */
    setThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        return this.thresholds;
    }

    /**
     * Get system info
     */
    getSystemInfo() {
        return {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            cpus: os.cpus().length,
            totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
            nodeVersion: process.version,
            v8Version: process.versions.v8,
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            cwd: process.cwd()
        };
    }
}

// Singleton instance
const systemMonitor = new SystemMonitor();

module.exports = systemMonitor;
