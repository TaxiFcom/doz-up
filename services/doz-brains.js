/**
 * DOZ Brains Connection Service
 * Connects to RunPod A40 GPU (48GB VRAM) running 10 Ollama models
 * Fallback chain: DOZ Brains GPU → Anthropic Claude API → Local heuristics
 */

const https = require('https');
const http = require('http');

const OLLAMA_URL = process.env.DOZ_BRAINS_OLLAMA_URL || 'https://e06pa3allh7wyw-64411b5c-11434.proxy.runpod.net';
const BRAINS_API_URL = process.env.DOZ_BRAINS_API_URL || 'https://e06pa3allh7wyw-64411b5c-8000.proxy.runpod.net';
const DEFAULT_MODEL = process.env.DOZ_BRAINS_DEFAULT_MODEL || 'qwen2.5:7b';
const HEAVY_MODEL = process.env.DOZ_BRAINS_HEAVY_MODEL || 'qwen2.5-coder:32b';
const ENABLED = process.env.DOZ_BRAINS_ENABLED !== 'false';

// Rate limiting
const MAX_CONCURRENT = 5;
let activeRequests = 0;
const requestQueue = [];

// Response cache (5 min TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

let brainsOnline = false;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60 * 1000;

function getCacheKey(model, messages) {
    return `${model}:${JSON.stringify(messages)}`;
}

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function setCache(key, value) {
    cache.set(key, { value, time: Date.now() });
    // Prune old entries if cache gets large
    if (cache.size > 200) {
        const now = Date.now();
        for (const [k, v] of cache) {
            if (now - v.time > CACHE_TTL) cache.delete(k);
        }
    }
}

function fetchJSON(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(url, {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            timeout: options.timeout || 30000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

async function processQueue() {
    while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
        const { fn, resolve, reject } = requestQueue.shift();
        activeRequests++;
        fn().then(resolve).catch(reject).finally(() => {
            activeRequests--;
            processQueue();
        });
    }
}

function enqueue(fn) {
    return new Promise((resolve, reject) => {
        if (activeRequests < MAX_CONCURRENT) {
            activeRequests++;
            fn().then(resolve).catch(reject).finally(() => {
                activeRequests--;
                processQueue();
            });
        } else {
            requestQueue.push({ fn, resolve, reject });
        }
    });
}

const dozBrains = {
    /**
     * Check if DOZ Brains GPU is available
     */
    async isAvailable() {
        if (!ENABLED) return false;
        if (Date.now() - lastHealthCheck < HEALTH_CHECK_INTERVAL) return brainsOnline;

        try {
            const result = await fetchJSON(`${OLLAMA_URL}/api/tags`, { timeout: 8000 });
            brainsOnline = result.status === 200 && result.data?.models?.length > 0;
            lastHealthCheck = Date.now();
            if (brainsOnline) {
                console.log(`[DOZ Brains] GPU online - ${result.data.models.length} models available`);
            }
        } catch (e) {
            brainsOnline = false;
            lastHealthCheck = Date.now();
        }
        return brainsOnline;
    },

    /**
     * Get list of available models
     */
    async getModels() {
        try {
            const result = await fetchJSON(`${OLLAMA_URL}/api/tags`, { timeout: 8000 });
            if (result.status === 200 && result.data?.models) {
                return result.data.models.map(m => m.name);
            }
        } catch (e) {}
        return [];
    },

    /**
     * Chat with a specific model via Ollama proxy
     */
    async chat(model, messages, options = {}) {
        const cacheKey = getCacheKey(model, messages);
        const cached = getCached(cacheKey);
        if (cached) return cached;

        return enqueue(async () => {
            // Try DOZ Brains GPU first
            if (await this.isAvailable()) {
                try {
                    const result = await fetchJSON(`${OLLAMA_URL}/api/chat`, {
                        method: 'POST',
                        body: {
                            model: model || DEFAULT_MODEL,
                            messages,
                            stream: false,
                            options: {
                                temperature: options.temperature || 0.3,
                                num_predict: options.maxTokens || 2048
                            }
                        },
                        timeout: options.timeout || 60000
                    });

                    if (result.status === 200 && result.data?.message?.content) {
                        const response = result.data.message.content;
                        setCache(cacheKey, response);
                        return response;
                    }
                } catch (e) {
                    console.log(`[DOZ Brains] GPU request failed: ${e.message}, falling back to Claude`);
                }
            }

            // Fallback to Anthropic Claude API
            return this._claudeFallback(messages, options);
        });
    },

    /**
     * Use the heavy coder model for code analysis
     */
    async analyze(code, prompt, options = {}) {
        const messages = [
            { role: 'system', content: 'You are a code analysis AI. Respond with concise, actionable findings in JSON format.' },
            { role: 'user', content: `${prompt}\n\n\`\`\`\n${code}\n\`\`\`` }
        ];
        return this.chat(HEAVY_MODEL, messages, { timeout: 120000, ...options });
    },

    /**
     * Multi-brain collaboration via DOZ Brains API
     */
    async collaborate(task, context, options = {}) {
        if (await this.isAvailable()) {
            try {
                const result = await fetchJSON(`${BRAINS_API_URL}/api/brains/collaborate`, {
                    method: 'POST',
                    body: { task, context, models: options.models },
                    timeout: options.timeout || 120000
                });
                if (result.status === 200 && result.data) {
                    return result.data;
                }
            } catch (e) {
                console.log(`[DOZ Brains] Collaboration failed: ${e.message}`);
            }
        }

        // Fallback: single Claude call
        const messages = [
            { role: 'system', content: 'You are an AI collaborating on a task. Provide comprehensive analysis.' },
            { role: 'user', content: `Task: ${task}\n\nContext: ${JSON.stringify(context)}` }
        ];
        const response = await this._claudeFallback(messages, options);
        return { result: response, model: 'claude-fallback' };
    },

    /**
     * Quick think - fast model for simple decisions
     */
    async think(prompt, options = {}) {
        const messages = [
            { role: 'user', content: prompt }
        ];
        return this.chat(DEFAULT_MODEL, messages, { maxTokens: 1024, ...options });
    },

    /**
     * Fallback to Anthropic Claude API
     */
    async _claudeFallback(messages, options = {}) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return this._localFallback(messages);
        }

        try {
            const systemMsg = messages.find(m => m.role === 'system');
            const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
                role: m.role,
                content: m.content
            }));

            const body = {
                model: 'claude-haiku-4-5-20251001',
                max_tokens: options.maxTokens || 2048,
                messages: userMessages
            };
            if (systemMsg) body.system = systemMsg.content;

            const result = await fetchJSON('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body,
                timeout: options.timeout || 30000
            });

            if (result.status === 200 && result.data?.content?.[0]?.text) {
                return result.data.content[0].text;
            }
            console.log(`[DOZ Brains] Claude API returned status ${result.status}`);
        } catch (e) {
            console.log(`[DOZ Brains] Claude fallback failed: ${e.message}`);
        }

        return this._localFallback(messages);
    },

    /**
     * Last resort: local heuristics (no AI, basic pattern matching)
     */
    _localFallback(messages) {
        const lastMsg = messages[messages.length - 1]?.content || '';
        return `[Local Analysis] Unable to reach AI services. Input length: ${lastMsg.length} chars. Manual review recommended.`;
    },

    /**
     * Get full status for dashboard
     */
    async getStatus() {
        const available = await this.isAvailable();
        const models = available ? await this.getModels() : [];
        return {
            enabled: ENABLED,
            online: available,
            ollamaUrl: OLLAMA_URL,
            brainsApiUrl: BRAINS_API_URL,
            defaultModel: DEFAULT_MODEL,
            heavyModel: HEAVY_MODEL,
            modelsAvailable: models,
            activeRequests,
            queuedRequests: requestQueue.length,
            cacheSize: cache.size,
            lastHealthCheck: lastHealthCheck ? new Date(lastHealthCheck).toISOString() : null
        };
    }
};

module.exports = dozBrains;
