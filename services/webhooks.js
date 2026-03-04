/**
 * DOZ UP - Webhook Notifications System
 * Send notifications to external services on events
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const webhooksPath = path.join(dataDir, 'webhooks.json');
const deliveriesPath = path.join(dataDir, 'webhook-deliveries.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Webhook events
const WEBHOOK_EVENTS = [
    // Leads
    'lead.created',
    'lead.updated',
    'lead.qualified',
    'lead.contacted',

    // Deals
    'deal.created',
    'deal.updated',
    'deal.won',
    'deal.lost',

    // Proposals
    'proposal.created',
    'proposal.sent',
    'proposal.viewed',
    'proposal.accepted',
    'proposal.declined',

    // Demos
    'demo.scheduled',
    'demo.completed',
    'demo.cancelled',

    // Payments
    'payment.received',
    'payment.failed',

    // Users
    'user.registered',
    'user.subscribed'
];

class WebhookService {
    constructor() {
        this.webhooks = loadJSON(webhooksPath, []);
        this.deliveries = loadJSON(deliveriesPath, []);
        this.retryQueue = [];

        // Process retry queue
        setInterval(() => this.processRetryQueue(), 60000);

        // Cleanup old deliveries
        setInterval(() => this.cleanupDeliveries(), 24 * 60 * 60 * 1000);
    }

    // ============ WEBHOOK MANAGEMENT ============

    createWebhook(data) {
        if (!data.url || !data.events || data.events.length === 0) {
            throw new Error('URL and at least one event are required');
        }

        // Validate URL
        try {
            new URL(data.url);
        } catch {
            throw new Error('Invalid webhook URL');
        }

        // Validate events
        const invalidEvents = data.events.filter(e => !WEBHOOK_EVENTS.includes(e) && e !== '*');
        if (invalidEvents.length > 0) {
            throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
        }

        const webhook = {
            id: uuidv4(),
            url: data.url,
            events: data.events, // ['*'] for all events
            secret: data.secret || crypto.randomBytes(32).toString('hex'),
            description: data.description || '',
            status: 'active', // active, paused, disabled
            headers: data.headers || {},
            retryPolicy: {
                maxRetries: data.maxRetries || 3,
                retryDelay: data.retryDelay || 60000 // 1 minute
            },
            stats: {
                deliveries: 0,
                successes: 0,
                failures: 0,
                lastDelivery: null,
                lastSuccess: null,
                lastFailure: null
            },
            createdAt: new Date().toISOString(),
            createdBy: data.createdBy || 'system'
        };

        this.webhooks.push(webhook);
        saveJSON(webhooksPath, this.webhooks);

        return {
            ...webhook,
            secret: webhook.secret // Only show secret on creation
        };
    }

    updateWebhook(webhookId, updates) {
        const webhook = this.webhooks.find(w => w.id === webhookId);
        if (!webhook) return null;

        if (updates.url) webhook.url = updates.url;
        if (updates.events) webhook.events = updates.events;
        if (updates.description !== undefined) webhook.description = updates.description;
        if (updates.status) webhook.status = updates.status;
        if (updates.headers) webhook.headers = updates.headers;

        webhook.updatedAt = new Date().toISOString();
        saveJSON(webhooksPath, this.webhooks);

        return this.sanitizeWebhook(webhook);
    }

    deleteWebhook(webhookId) {
        const index = this.webhooks.findIndex(w => w.id === webhookId);
        if (index === -1) return false;

        this.webhooks.splice(index, 1);
        saveJSON(webhooksPath, this.webhooks);
        return true;
    }

    getWebhook(webhookId) {
        const webhook = this.webhooks.find(w => w.id === webhookId);
        return webhook ? this.sanitizeWebhook(webhook) : null;
    }

    getWebhooks() {
        return this.webhooks.map(w => this.sanitizeWebhook(w));
    }

    regenerateSecret(webhookId) {
        const webhook = this.webhooks.find(w => w.id === webhookId);
        if (!webhook) return null;

        webhook.secret = crypto.randomBytes(32).toString('hex');
        webhook.updatedAt = new Date().toISOString();
        saveJSON(webhooksPath, this.webhooks);

        return { id: webhook.id, secret: webhook.secret };
    }

    // ============ EVENT TRIGGERING ============

    async trigger(event, payload) {
        const webhooksToTrigger = this.webhooks.filter(w =>
            w.status === 'active' &&
            (w.events.includes('*') || w.events.includes(event))
        );

        const results = [];

        for (const webhook of webhooksToTrigger) {
            const result = await this.deliver(webhook, event, payload);
            results.push(result);
        }

        return results;
    }

    async deliver(webhook, event, payload, attempt = 1) {
        const deliveryId = uuidv4();
        const timestamp = new Date().toISOString();

        const body = JSON.stringify({
            id: deliveryId,
            event,
            timestamp,
            data: payload
        });

        // Generate signature
        const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(body)
            .digest('hex');

        const delivery = {
            id: deliveryId,
            webhookId: webhook.id,
            event,
            url: webhook.url,
            requestBody: body,
            requestHeaders: {
                'Content-Type': 'application/json',
                'X-Webhook-ID': webhook.id,
                'X-Webhook-Event': event,
                'X-Webhook-Signature': `sha256=${signature}`,
                'X-Webhook-Timestamp': timestamp,
                ...webhook.headers
            },
            attempt,
            status: 'pending',
            createdAt: timestamp
        };

        try {
            const response = await this.sendRequest(webhook.url, body, delivery.requestHeaders);

            delivery.status = response.statusCode >= 200 && response.statusCode < 300 ? 'success' : 'failed';
            delivery.responseStatus = response.statusCode;
            delivery.responseBody = response.body?.substring(0, 1000);
            delivery.completedAt = new Date().toISOString();
            delivery.duration = Date.now() - new Date(timestamp).getTime();

            // Update webhook stats
            webhook.stats.deliveries++;
            if (delivery.status === 'success') {
                webhook.stats.successes++;
                webhook.stats.lastSuccess = timestamp;
            } else {
                webhook.stats.failures++;
                webhook.stats.lastFailure = timestamp;

                // Queue for retry if not max attempts
                if (attempt < webhook.retryPolicy.maxRetries) {
                    this.queueRetry(webhook, event, payload, attempt + 1);
                }
            }
            webhook.stats.lastDelivery = timestamp;

        } catch (error) {
            delivery.status = 'failed';
            delivery.error = error.message;
            delivery.completedAt = new Date().toISOString();

            webhook.stats.deliveries++;
            webhook.stats.failures++;
            webhook.stats.lastFailure = timestamp;
            webhook.stats.lastDelivery = timestamp;

            // Queue for retry
            if (attempt < webhook.retryPolicy.maxRetries) {
                this.queueRetry(webhook, event, payload, attempt + 1);
            }
        }

        // Save delivery log
        this.deliveries.unshift(delivery);
        if (this.deliveries.length > 1000) {
            this.deliveries = this.deliveries.slice(0, 1000);
        }
        saveJSON(deliveriesPath, this.deliveries);
        saveJSON(webhooksPath, this.webhooks);

        return delivery;
    }

    sendRequest(url, body, headers) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 30000
            };

            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(body);
            req.end();
        });
    }

    queueRetry(webhook, event, payload, attempt) {
        this.retryQueue.push({
            webhook,
            event,
            payload,
            attempt,
            executeAt: Date.now() + webhook.retryPolicy.retryDelay * attempt
        });
    }

    async processRetryQueue() {
        const now = Date.now();
        const toProcess = this.retryQueue.filter(r => r.executeAt <= now);

        for (const item of toProcess) {
            await this.deliver(item.webhook, item.event, item.payload, item.attempt);
        }

        this.retryQueue = this.retryQueue.filter(r => r.executeAt > now);
    }

    // ============ DELIVERY LOGS ============

    getDeliveries(filters = {}) {
        let deliveries = [...this.deliveries];

        if (filters.webhookId) {
            deliveries = deliveries.filter(d => d.webhookId === filters.webhookId);
        }
        if (filters.event) {
            deliveries = deliveries.filter(d => d.event === filters.event);
        }
        if (filters.status) {
            deliveries = deliveries.filter(d => d.status === filters.status);
        }

        const offset = filters.offset || 0;
        const limit = filters.limit || 50;

        return {
            deliveries: deliveries.slice(offset, offset + limit),
            total: deliveries.length
        };
    }

    getDelivery(deliveryId) {
        return this.deliveries.find(d => d.id === deliveryId);
    }

    async redeliverWebhook(deliveryId) {
        const delivery = this.deliveries.find(d => d.id === deliveryId);
        if (!delivery) throw new Error('Delivery not found');

        const webhook = this.webhooks.find(w => w.id === delivery.webhookId);
        if (!webhook) throw new Error('Webhook not found');

        const payload = JSON.parse(delivery.requestBody).data;
        return await this.deliver(webhook, delivery.event, payload);
    }

    // ============ TEST WEBHOOK ============

    async testWebhook(webhookId) {
        const webhook = this.webhooks.find(w => w.id === webhookId);
        if (!webhook) throw new Error('Webhook not found');

        const testPayload = {
            message: 'This is a test webhook delivery',
            webhook_id: webhookId,
            timestamp: new Date().toISOString()
        };

        return await this.deliver(webhook, 'test.webhook', testPayload);
    }

    // ============ HELPERS ============

    sanitizeWebhook(webhook) {
        return {
            id: webhook.id,
            url: webhook.url,
            events: webhook.events,
            description: webhook.description,
            status: webhook.status,
            stats: webhook.stats,
            createdAt: webhook.createdAt,
            updatedAt: webhook.updatedAt
            // Don't include secret
        };
    }

    cleanupDeliveries() {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const before = this.deliveries.length;

        this.deliveries = this.deliveries.filter(d =>
            new Date(d.createdAt) >= sevenDaysAgo
        );

        if (this.deliveries.length < before) {
            saveJSON(deliveriesPath, this.deliveries);
            console.log(`[Webhooks] Cleaned ${before - this.deliveries.length} old deliveries`);
        }
    }

    getAvailableEvents() {
        return WEBHOOK_EVENTS;
    }
}

module.exports = new WebhookService();
module.exports.WEBHOOK_EVENTS = WEBHOOK_EVENTS;
