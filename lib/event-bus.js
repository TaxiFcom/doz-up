/**
 * DOZ Event Bus — Redis Pub/Sub for inter-container communication
 * Falls back to in-process EventEmitter when Redis unavailable
 */

const EventEmitter = require('events');

let Redis;
try { Redis = require('ioredis'); } catch { Redis = null; }

const REDIS_URL = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;

// Event channels
const CHANNELS = {
    USER_SIGNUP:        'doz:user:signup',
    USER_LOGIN:         'doz:user:login',
    UPLOAD_COMPLETE:    'doz:upload:complete',
    UPLOAD_DELETE:      'doz:upload:delete',
    PAYMENT_SUCCESS:    'doz:payment:success',
    PAYMENT_FAILED:     'doz:payment:failed',
    SUBSCRIPTION_CHANGE:'doz:subscription:change',
    AGENT_FINDING:      'doz:agent:finding',
    SUPPORT_ESCALATION: 'doz:support:escalation',
    ANALYTICS_EVENT:    'doz:analytics:event',
    HEALTH_ALERT:       'doz:health:alert',
    CONFIG_CHANGE:      'doz:config:change',
};

class DozEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
        this.publisher = null;
        this.subscriber = null;
        this.useRedis = false;
        this.subscribedChannels = new Set();
        this._serviceName = process.env.DOZ_SERVICE_NAME || 'unknown';
    }

    async initialize() {
        if (!Redis) {
            console.log(`[EventBus:${this._serviceName}] ioredis not available, using local EventEmitter`);
            return;
        }

        try {
            const redisOpts = {
                maxRetriesPerRequest: null,
                retryStrategy: (times) => times > 1 ? null : 200,
                enableReadyCheck: false,
                lazyConnect: true,
                enableOfflineQueue: false,
            };

            this.publisher = new Redis(REDIS_URL, redisOpts);
            this.subscriber = new Redis(REDIS_URL, redisOpts);

            this.publisher.on('error', (err) => {
                if (this.useRedis) {
                    console.warn(`[EventBus:${this._serviceName}] Publisher error, falling back to local`);
                    this.useRedis = false;
                }
            });

            this.subscriber.on('error', (err) => {
                if (this.useRedis) {
                    console.warn(`[EventBus:${this._serviceName}] Subscriber error, falling back to local`);
                    this.useRedis = false;
                }
            });

            // Handle incoming messages
            this.subscriber.on('message', (channel, message) => {
                try {
                    const data = JSON.parse(message);
                    // Don't re-emit events from self
                    if (data._source === this._serviceName) return;
                    super.emit(channel, data.payload, data._source);
                } catch (err) {
                    console.error(`[EventBus] Failed to parse message on ${channel}:`, err.message);
                }
            });

            await Promise.all([
                this.publisher.connect().catch(() => null),
                this.subscriber.connect().catch(() => null),
            ]);

            // Test connection
            await this.publisher.ping();
            this.useRedis = true;
            console.log(`[EventBus:${this._serviceName}] Redis pub/sub connected`);

            // Re-subscribe existing channels
            for (const channel of this.subscribedChannels) {
                await this.subscriber.subscribe(channel).catch(() => null);
            }
        } catch (err) {
            console.log(`[EventBus:${this._serviceName}] Redis unavailable, using local EventEmitter`);
            this.useRedis = false;
        }
    }

    /**
     * Publish an event to all containers
     * @param {string} channel - Channel name from CHANNELS
     * @param {any} payload - Event data
     */
    async publish(channel, payload) {
        const message = {
            _source: this._serviceName,
            _timestamp: Date.now(),
            payload,
        };

        // Always emit locally
        super.emit(channel, payload, this._serviceName);

        // Also publish to Redis if available
        if (this.useRedis && this.publisher) {
            try {
                await this.publisher.publish(channel, JSON.stringify(message));
            } catch (err) {
                console.warn(`[EventBus] Redis publish failed: ${err.message}`);
            }
        }
    }

    /**
     * Subscribe to events from all containers
     * @param {string} channel - Channel name from CHANNELS
     * @param {function} handler - (payload, source) => {}
     */
    subscribe(channel, handler) {
        this.subscribedChannels.add(channel);

        // Local listener
        this.on(channel, handler);

        // Redis subscription
        if (this.useRedis && this.subscriber) {
            this.subscriber.subscribe(channel).catch(err => {
                console.warn(`[EventBus] Redis subscribe failed for ${channel}: ${err.message}`);
            });
        }
    }

    async shutdown() {
        try {
            if (this.subscriber) {
                for (const ch of this.subscribedChannels) {
                    await this.subscriber.unsubscribe(ch).catch(() => null);
                }
                await this.subscriber.quit().catch(() => null);
            }
            if (this.publisher) {
                await this.publisher.quit().catch(() => null);
            }
            console.log(`[EventBus:${this._serviceName}] Shut down`);
        } catch (err) {
            console.error('[EventBus] Shutdown error:', err.message);
        }
    }
}

// Singleton
const eventBus = new DozEventBus();

// Auto-initialize (non-blocking)
eventBus.initialize().catch(err => {
    console.warn('[EventBus] Auto-init failed:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', () => eventBus.shutdown());
process.on('SIGINT', () => eventBus.shutdown());

module.exports = { eventBus, CHANNELS };
