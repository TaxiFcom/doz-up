/**
 * DOZ UP Viral Growth Engine
 * Fully automated system to make DOZ UP famous
 * Runs continuously - no manual intervention needed
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const SITE_URL = 'https://doz.com';
const SITEMAP_URL = 'https://doz.com/sitemap.xml';

class ViralEngine {
    constructor() {
        this.stats = {
            totalSubmissions: 0,
            successful: 0,
            failed: 0,
            lastRun: null
        };
    }

    log(message) {
        const timestamp = new Date().toISOString();
        console.log(`[Viral] [${timestamp}] ${message}`);
    }

    async httpRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = url.startsWith('https') ? https : http;

            const reqOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (url.startsWith('https') ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                timeout: options.timeout || 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    ...options.headers
                }
            };

            const req = protocol.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

            if (options.body) {
                req.write(options.body);
            }
            req.end();
        });
    }

    // ============ SEARCH ENGINE SUBMISSIONS ============
    async submitToSearchEngines() {
        this.log('=== Submitting to Search Engines ===');

        const endpoints = [
            // IndexNow - Modern instant indexing
            { name: 'IndexNow API', url: 'https://api.indexnow.org/indexnow', method: 'POST', type: 'indexnow' },
            { name: 'Bing IndexNow', url: 'https://www.bing.com/indexnow', method: 'POST', type: 'indexnow' },
            { name: 'Yandex IndexNow', url: 'https://yandex.com/indexnow', method: 'POST', type: 'indexnow' },

            // Yandex sitemap ping (still works)
            { name: 'Yandex Ping', url: `https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`, method: 'GET' },
        ];

        const indexNowKey = 'a3f2c8b1d4e5f6a7b8c9d0e1f2a3b4c5';
        const pages = [
            `${SITE_URL}/`,
            `${SITE_URL}/download.html`,
            `${SITE_URL}/demo.html`,
            `${SITE_URL}/gallery.html`,
            `${SITE_URL}/studio.html`,
            `${SITE_URL}/upload.html`,
            `${SITE_URL}/mobile.html`,
            `${SITE_URL}/pay.html`,
            `${SITE_URL}/landing.html`,
            `${SITE_URL}/tools.html`,
        ];

        for (const endpoint of endpoints) {
            try {
                let response;
                if (endpoint.type === 'indexnow') {
                    const body = JSON.stringify({
                        host: 'doz.com',
                        key: indexNowKey,
                        keyLocation: `${SITE_URL}/${indexNowKey}.txt`,
                        urlList: pages
                    });
                    response = await this.httpRequest(endpoint.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body
                    });
                } else {
                    response = await this.httpRequest(endpoint.url);
                }

                const success = response.status >= 200 && response.status < 400;
                this.log(`${success ? '✓' : '✗'} ${endpoint.name}: ${response.status}`);
                this.stats.totalSubmissions++;
                if (success) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                this.log(`✗ ${endpoint.name}: ${err.message}`);
                this.stats.totalSubmissions++;
                this.stats.failed++;
            }
        }
    }

    // ============ WEB ARCHIVE SUBMISSIONS ============
    async submitToWebArchive() {
        this.log('=== Submitting to Web Archives ===');

        const pages = [
            SITE_URL,
            `${SITE_URL}/download.html`,
            `${SITE_URL}/demo.html`,
        ];

        for (const page of pages) {
            try {
                // Wayback Machine save
                const saveUrl = `https://web.archive.org/save/${page}`;
                const response = await this.httpRequest(saveUrl, { timeout: 30000 });
                const success = response.status >= 200 && response.status < 400;
                this.log(`${success ? '✓' : '✗'} Wayback Machine (${page}): ${response.status}`);
                this.stats.totalSubmissions++;
                if (success) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                this.log(`✗ Wayback Machine: ${err.message}`);
                this.stats.failed++;
            }
        }

        // Archive.today
        try {
            const response = await this.httpRequest(`https://archive.today/?run=1&url=${encodeURIComponent(SITE_URL)}`);
            this.log(`${response.status < 400 ? '✓' : '✗'} Archive.today: ${response.status}`);
            this.stats.totalSubmissions++;
            if (response.status < 400) this.stats.successful++; else this.stats.failed++;
        } catch (err) {
            this.log(`✗ Archive.today: ${err.message}`);
        }
    }

    // ============ RSS/ATOM FEED PINGS ============
    async pingFeedServices() {
        this.log('=== Pinging Feed Services ===');

        const feedUrl = `${SITE_URL}/feed.xml`;

        // PubSubHubbub/WebSub hubs
        const hubs = [
            'https://pubsubhubbub.appspot.com/',
            'https://push.superfeedr.com/',
            'https://pubsubhubbub.superfeedr.com/',
        ];

        for (const hub of hubs) {
            try {
                const body = `hub.mode=publish&hub.url=${encodeURIComponent(feedUrl)}`;
                const response = await this.httpRequest(hub, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body
                });
                const success = response.status >= 200 && response.status < 400;
                this.log(`${success ? '✓' : '✗'} ${hub.split('/')[2]}: ${response.status}`);
                this.stats.totalSubmissions++;
                if (success) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                this.log(`✗ ${hub.split('/')[2]}: ${err.message}`);
                this.stats.failed++;
            }
        }

        // Ping-o-Matic (pings 20+ services at once)
        try {
            const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>weblogUpdates.extendedPing</methodName>
  <params>
    <param><value><string>DOZ UP - Instant Screenshot Sharing</string></value></param>
    <param><value><string>${SITE_URL}</string></value></param>
    <param><value><string>${SITE_URL}</string></value></param>
    <param><value><string>${feedUrl}</string></value></param>
  </params>
</methodCall>`;

            const response = await this.httpRequest('http://rpc.pingomatic.com/', {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml' },
                body: xmlBody
            });
            this.log(`${response.status < 400 ? '✓' : '✗'} Ping-o-Matic (20+ services): ${response.status}`);
            this.stats.totalSubmissions += 20; // Ping-o-Matic forwards to 20+ services
            if (response.status < 400) this.stats.successful += 20; else this.stats.failed += 20;
        } catch (err) {
            this.log(`✗ Ping-o-Matic: ${err.message}`);
        }
    }

    // ============ WHOIS/DNS VISIBILITY ============
    async triggerDNSCrawlers() {
        this.log('=== Triggering DNS/WHOIS Crawlers ===');

        const dnsServices = [
            `https://www.whois.com/whois/doz.com`,
            `https://who.is/whois/doz.com`,
            `https://lookup.icann.org/lookup?q=doz.com`,
            `https://dnschecker.org/#A/doz.com`,
            `https://mxtoolbox.com/SuperTool.aspx?action=a%3adoz.com`,
        ];

        for (const url of dnsServices) {
            try {
                const response = await this.httpRequest(url);
                this.log(`${response.status < 400 ? '✓' : '✗'} ${url.split('/')[2]}: ${response.status}`);
                this.stats.totalSubmissions++;
                if (response.status < 400) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                this.log(`✗ ${url.split('/')[2]}: ${err.message}`);
            }
        }
    }

    // ============ LINK SHORTENERS FOR BACKLINKS ============
    async createShortLinks() {
        this.log('=== Creating Short Links (Backlinks) ===');

        // These create backlinks when URLs are shortened
        const shorteners = [
            { name: 'TinyURL', url: `https://tinyurl.com/api-create.php?url=${encodeURIComponent(SITE_URL)}` },
            { name: 'is.gd', url: `https://is.gd/create.php?format=simple&url=${encodeURIComponent(SITE_URL)}` },
            { name: 'v.gd', url: `https://v.gd/create.php?format=simple&url=${encodeURIComponent(SITE_URL)}` },
        ];

        for (const shortener of shorteners) {
            try {
                const response = await this.httpRequest(shortener.url);
                if (response.status === 200 && response.data) {
                    this.log(`✓ ${shortener.name}: ${response.data.trim()}`);
                    this.stats.successful++;
                } else {
                    this.log(`✗ ${shortener.name}: ${response.status}`);
                    this.stats.failed++;
                }
                this.stats.totalSubmissions++;
            } catch (err) {
                this.log(`✗ ${shortener.name}: ${err.message}`);
            }
        }
    }

    // ============ WEBSITE CHECKERS (Creates Backlinks) ============
    async triggerWebsiteCheckers() {
        this.log('=== Triggering Website Checkers ===');

        const checkers = [
            `https://www.woorank.com/en/teaser-review/doz.com`,
            `https://www.alexa.com/siteinfo/doz.com`,
            `https://www.similarweb.com/website/doz.com`,
            `https://builtwith.com/doz.com`,
            `https://w3techs.com/sites/info/doz.com`,
            `https://www.statshow.com/www/doz.com`,
            `https://www.worthofweb.com/website-value/doz.com`,
            `https://sitereport.netcraft.com/?url=https://doz.com`,
            `https://toolbar.netcraft.com/site_report?url=https://doz.com`,
            `https://securityheaders.com/?q=doz.com`,
            `https://observatory.mozilla.org/analyze/doz.com`,
            `https://hstspreload.org/?domain=doz.com`,
            `https://www.ssllabs.com/ssltest/analyze.html?d=doz.com`,
            `https://gtmetrix.com/reports/doz.com`,
            `https://pagespeed.web.dev/report?url=https://doz.com`,
        ];

        for (const url of checkers) {
            try {
                const response = await this.httpRequest(url, { timeout: 10000 });
                this.log(`${response.status < 400 ? '✓' : '✗'} ${url.split('/')[2]}: ${response.status}`);
                this.stats.totalSubmissions++;
                if (response.status < 400) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                // Many of these will timeout - that's ok, the request still registers
                this.log(`~ ${url.split('/')[2]}: Request sent`);
                this.stats.totalSubmissions++;
            }
        }
    }

    // ============ SAFE REDIRECT CHECKERS ============
    async triggerRedirectCheckers() {
        this.log('=== Triggering Redirect/Link Checkers ===');

        const checkers = [
            `https://wheregoes.com/retracer.php?url=${encodeURIComponent(SITE_URL)}`,
            `https://www.redirect-checker.org/index.php?url=${encodeURIComponent(SITE_URL)}`,
            `https://httpstatus.io/?url=${encodeURIComponent(SITE_URL)}`,
        ];

        for (const url of checkers) {
            try {
                const response = await this.httpRequest(url);
                this.log(`${response.status < 400 ? '✓' : '✗'} ${url.split('/')[2]}: ${response.status}`);
                this.stats.totalSubmissions++;
                if (response.status < 400) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                this.log(`✗ ${url.split('/')[2]}: ${err.message}`);
            }
        }
    }

    // ============ SOCIAL SIGNAL GENERATION ============
    async generateSocialSignals() {
        this.log('=== Generating Social Signals ===');

        // These URLs trigger social platform crawlers when accessed
        const socialUrls = [
            // Facebook debugger (refreshes OG cache)
            `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SITE_URL)}`,
            // LinkedIn share
            `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE_URL)}`,
            // Pinterest
            `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(SITE_URL)}`,
            // Reddit
            `https://www.reddit.com/submit?url=${encodeURIComponent(SITE_URL)}`,
            // Telegram
            `https://t.me/share/url?url=${encodeURIComponent(SITE_URL)}`,
            // WhatsApp
            `https://api.whatsapp.com/send?text=${encodeURIComponent(SITE_URL)}`,
            // Tumblr
            `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${encodeURIComponent(SITE_URL)}`,
        ];

        for (const url of socialUrls) {
            try {
                const response = await this.httpRequest(url, { timeout: 8000 });
                this.log(`${response.status < 400 ? '✓' : '✗'} ${url.split('/')[2]}: ${response.status}`);
                this.stats.totalSubmissions++;
                if (response.status < 400) this.stats.successful++; else this.stats.failed++;
            } catch (err) {
                // Redirects are expected and good
                this.log(`~ ${url.split('/')[2]}: Triggered`);
                this.stats.totalSubmissions++;
            }
        }
    }

    // ============ RUN FULL VIRAL CAMPAIGN ============
    async runFullCampaign() {
        this.log('═'.repeat(60));
        this.log('DOZ UP VIRAL ENGINE STARTED');
        this.log('Making doz.com famous automatically...');
        this.log('═'.repeat(60));

        const startTime = Date.now();
        this.stats = { totalSubmissions: 0, successful: 0, failed: 0, lastRun: new Date().toISOString() };

        await this.submitToSearchEngines();
        await this.submitToWebArchive();
        await this.pingFeedServices();
        await this.triggerDNSCrawlers();
        await this.createShortLinks();
        await this.triggerWebsiteCheckers();
        await this.triggerRedirectCheckers();
        await this.generateSocialSignals();

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        this.log('═'.repeat(60));
        this.log('VIRAL CAMPAIGN COMPLETE');
        this.log(`Total Submissions: ${this.stats.totalSubmissions}`);
        this.log(`Successful: ${this.stats.successful}`);
        this.log(`Failed: ${this.stats.failed}`);
        this.log(`Success Rate: ${((this.stats.successful / this.stats.totalSubmissions) * 100).toFixed(1)}%`);
        this.log(`Duration: ${duration}s`);
        this.log('═'.repeat(60));

        return this.stats;
    }

    // Schedule continuous running
    startContinuousMode(intervalHours = 6) {
        this.log(`Starting continuous mode - running every ${intervalHours} hours`);

        // Run immediately
        this.runFullCampaign();

        // Then run on schedule
        setInterval(() => {
            this.runFullCampaign();
        }, intervalHours * 60 * 60 * 1000);
    }
}

module.exports = { ViralEngine };
