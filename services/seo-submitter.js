/**
 * DOZ UP SEO Mass Submitter Service
 * Submits site to search engines, directories, and ping services
 */

const https = require('https');
const http = require('http');

const SITE_URL = 'https://doz.com';
const SITEMAP_URL = 'https://doz.com/sitemap.xml';
const RSS_URL = 'https://doz.com/feed.xml';

// ============ SEARCH ENGINE PING URLS ============
const SEARCH_ENGINE_PINGS = [
    // Google
    `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
    `https://www.google.com/webmasters/sitemaps/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,

    // Bing & Microsoft
    `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
    `https://www.bing.com/webmaster/ping.aspx?siteMap=${encodeURIComponent(SITEMAP_URL)}`,

    // Yandex
    `https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,

    // IndexNow (Bing, Yandex, Seznam, Naver)
    // Will be handled separately with API key
];

// ============ BLOG/PING SERVICES ============
const PING_SERVICES = [
    // Major Ping Services
    { name: 'Ping-o-Matic', url: 'http://rpc.pingomatic.com/', method: 'xmlrpc' },
    { name: 'Twingly', url: 'http://rpc.twingly.com/', method: 'xmlrpc' },
    { name: 'Weblogs', url: 'http://rpc.weblogs.com/RPC2', method: 'xmlrpc' },
    { name: 'BlogRolling', url: 'http://rpc.blogrolling.com/pinger/', method: 'xmlrpc' },
    { name: 'Feedburner', url: 'http://ping.feedburner.com/', method: 'xmlrpc' },
    { name: 'Moreover', url: 'http://api.moreover.com/RPC2', method: 'xmlrpc' },
    { name: 'Syndic8', url: 'http://ping.syndic8.com/xmlrpc.php', method: 'xmlrpc' },
    { name: 'NewsGator', url: 'http://services.newsgator.com/ngws/xmlrpcping.aspx', method: 'xmlrpc' },
    { name: 'BlogPeople', url: 'http://www.blogpeople.net/ping/', method: 'xmlrpc' },
    { name: 'Bloglines', url: 'http://rpc.bloglines.com/ping', method: 'xmlrpc' },
    { name: 'PubSubHubbub', url: 'https://pubsubhubbub.appspot.com/', method: 'pubsub' },
    { name: 'Superfeedr', url: 'https://push.superfeedr.com/', method: 'pubsub' },
];

// ============ DIRECTORY SUBMISSION ENDPOINTS ============
const DIRECTORIES = [
    // Web Directories
    'https://www.dmoz.org/',
    'https://www.jasminedirectory.com/',
    'https://www.somuch.com/',
    'https://www.pegasusdirectory.com/',
    'https://www.marketinginternetdirectory.com/',
    'https://www.directoryworld.net/',
    'https://www.abc-directory.com/',
    'https://www.sitepromotiondirectory.com/',
    'https://www.submissionwebdirectory.com/',
    'https://www.linkcentre.com/',
];

// ============ SOCIAL BOOKMARKING ============
const SOCIAL_PLATFORMS = [
    'reddit.com',
    'pinterest.com',
    'mix.com',
    'digg.com',
    'slashdot.org',
    'hackernews',
    'producthunt.com',
    'indiehackers.com',
    'betalist.com',
];

// ============ INDEXNOW PROTOCOL ============
// Instant indexing for Bing, Yandex, Seznam, Naver
const INDEXNOW_ENDPOINTS = [
    'https://api.indexnow.org/indexnow',
    'https://www.bing.com/indexnow',
    'https://yandex.com/indexnow',
    'https://search.seznam.cz/indexnow',
];

class SEOSubmitter {
    constructor() {
        this.results = {
            success: [],
            failed: [],
            pending: []
        };
        this.indexNowKey = this.generateIndexNowKey();
    }

    generateIndexNowKey() {
        // Generate a consistent key based on domain
        const crypto = require('crypto');
        return crypto.createHash('md5').update('doz.com-indexnow').digest('hex');
    }

    // Simple HTTP GET request
    async httpGet(url, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, { timeout }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
    }

    // HTTP POST request
    async httpPost(url, body, contentType = 'application/json', timeout = 10000) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = url.startsWith('https') ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (url.startsWith('https') ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                timeout,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'DOZ-UP-SEO-Bot/2.5.0'
                }
            };

            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });

            req.write(body);
            req.end();
        });
    }

    // Ping search engines with sitemap
    async pingSearchEngines() {
        console.log('[SEO] Pinging search engines...');
        const results = [];

        for (const pingUrl of SEARCH_ENGINE_PINGS) {
            try {
                const response = await this.httpGet(pingUrl);
                const success = response.status >= 200 && response.status < 400;
                results.push({
                    url: pingUrl,
                    success,
                    status: response.status
                });
                console.log(`[SEO] ${success ? '✓' : '✗'} ${pingUrl.split('/')[2]} - ${response.status}`);
            } catch (err) {
                results.push({ url: pingUrl, success: false, error: err.message });
                console.log(`[SEO] ✗ ${pingUrl.split('/')[2]} - ${err.message}`);
            }
        }

        return results;
    }

    // IndexNow submission for instant indexing
    async submitIndexNow(urls = [SITE_URL]) {
        console.log('[SEO] Submitting to IndexNow...');
        const results = [];

        const payload = JSON.stringify({
            host: 'doz.com',
            key: this.indexNowKey,
            keyLocation: `https://doz.com/${this.indexNowKey}.txt`,
            urlList: urls
        });

        for (const endpoint of INDEXNOW_ENDPOINTS) {
            try {
                const response = await this.httpPost(endpoint, payload, 'application/json');
                const success = response.status >= 200 && response.status < 400;
                results.push({
                    endpoint,
                    success,
                    status: response.status
                });
                console.log(`[SEO] ${success ? '✓' : '✗'} IndexNow ${endpoint.split('/')[2]} - ${response.status}`);
            } catch (err) {
                results.push({ endpoint, success: false, error: err.message });
            }
        }

        return results;
    }

    // XML-RPC ping for blog services
    createXmlRpcPing(blogName, blogUrl) {
        return `<?xml version="1.0"?>
<methodCall>
  <methodName>weblogUpdates.ping</methodName>
  <params>
    <param><value><string>${blogName}</string></value></param>
    <param><value><string>${blogUrl}</string></value></param>
  </params>
</methodCall>`;
    }

    // Extended XML-RPC ping
    createExtendedPing(blogName, blogUrl, checkUrl, rssUrl) {
        return `<?xml version="1.0"?>
<methodCall>
  <methodName>weblogUpdates.extendedPing</methodName>
  <params>
    <param><value><string>${blogName}</string></value></param>
    <param><value><string>${blogUrl}</string></value></param>
    <param><value><string>${checkUrl}</string></value></param>
    <param><value><string>${rssUrl}</string></value></param>
  </params>
</methodCall>`;
    }

    // Ping blog/update services
    async pingServices() {
        console.log('[SEO] Pinging blog/update services...');
        const results = [];

        for (const service of PING_SERVICES) {
            try {
                if (service.method === 'xmlrpc') {
                    const xmlBody = this.createExtendedPing(
                        'DOZ UP - Instant Screenshot Sharing',
                        SITE_URL,
                        SITE_URL,
                        RSS_URL
                    );
                    const response = await this.httpPost(service.url, xmlBody, 'text/xml');
                    const success = response.status >= 200 && response.status < 400;
                    results.push({ service: service.name, success, status: response.status });
                    console.log(`[SEO] ${success ? '✓' : '✗'} ${service.name} - ${response.status}`);
                } else if (service.method === 'pubsub') {
                    // PubSubHubbub/WebSub
                    const body = `hub.mode=publish&hub.url=${encodeURIComponent(RSS_URL)}`;
                    const response = await this.httpPost(service.url, body, 'application/x-www-form-urlencoded');
                    const success = response.status >= 200 && response.status < 400;
                    results.push({ service: service.name, success, status: response.status });
                    console.log(`[SEO] ${success ? '✓' : '✗'} ${service.name} - ${response.status}`);
                }
            } catch (err) {
                results.push({ service: service.name, success: false, error: err.message });
                console.log(`[SEO] ✗ ${service.name} - ${err.message}`);
            }
        }

        return results;
    }

    // Submit to web directories (generates submission data)
    getDirectorySubmissionData() {
        return {
            title: 'DOZ UP - Instant Screenshot Sharing Platform',
            url: SITE_URL,
            description: 'DOZ UP is the fastest screenshot and image sharing platform. Capture, upload, and share in milliseconds with pre-generated URLs. Features include global hotkey capture, instant clipboard URLs, real-time analytics, and cross-platform desktop apps.',
            keywords: 'screenshot sharing, image upload, instant sharing, screen capture, DOZ UP, fast upload, clipboard URL, screenshot tool',
            category: 'Computers/Software/Internet/Clients/Graphics',
            alternateCategories: [
                'Computers/Software/Graphics/Image Editing',
                'Internet/Web Applications/Productivity',
                'Computers/Software/Screenshot Tools'
            ],
            email: 'contact@doz.com',
            reciprocalUrl: `${SITE_URL}/partners`,
            language: 'English',
            country: 'Worldwide'
        };
    }

    // Generate submission report
    async runFullSubmission() {
        console.log('='.repeat(60));
        console.log('[SEO] DOZ UP Mass Submission Started');
        console.log('[SEO] Target: Maximum search engine visibility');
        console.log('='.repeat(60));

        const report = {
            timestamp: new Date().toISOString(),
            searchEngines: await this.pingSearchEngines(),
            indexNow: await this.submitIndexNow([
                SITE_URL,
                `${SITE_URL}/download`,
                `${SITE_URL}/demo`,
                `${SITE_URL}/gallery`,
                `${SITE_URL}/studio`,
                `${SITE_URL}/upload`,
                `${SITE_URL}/login`,
                `${SITE_URL}/pay`,
                `${SITE_URL}/my-account`
            ]),
            pingServices: await this.pingServices(),
            directoryData: this.getDirectorySubmissionData()
        };

        // Calculate stats
        const totalAttempts =
            report.searchEngines.length +
            report.indexNow.length +
            report.pingServices.length;

        const successCount =
            report.searchEngines.filter(r => r.success).length +
            report.indexNow.filter(r => r.success).length +
            report.pingServices.filter(r => r.success).length;

        report.summary = {
            totalAttempts,
            successful: successCount,
            failed: totalAttempts - successCount,
            successRate: ((successCount / totalAttempts) * 100).toFixed(1) + '%'
        };

        console.log('='.repeat(60));
        console.log(`[SEO] Submission Complete!`);
        console.log(`[SEO] Total: ${totalAttempts} | Success: ${successCount} | Failed: ${totalAttempts - successCount}`);
        console.log(`[SEO] Success Rate: ${report.summary.successRate}`);
        console.log('='.repeat(60));

        return report;
    }
}

// Additional massive ping list for maximum coverage
const MEGA_PING_LIST = [
    // Tier 1 - Major Search Engines
    'https://www.google.com/ping?sitemap=',
    'https://www.bing.com/ping?sitemap=',
    'https://webmaster.yandex.com/ping?sitemap=',

    // Tier 2 - Regional Search Engines
    'https://search.naver.com/ping',
    'https://www.baidu.com/ping',
    'https://www.sogou.com/ping',
    'https://www.so.com/ping',

    // Tier 3 - Meta Search & Aggregators
    'https://www.entireweb.com/ping',
    'https://www.exalead.com/ping',

    // Tier 4 - RSS/Feed Aggregators (100+)
    'http://blogsearch.google.com/ping/RPC2',
    'http://api.feedster.com/ping.php',
    'http://api.moreover.com/ping',
    'http://api.my.yahoo.com/RPC2',
    'http://bblog.com/ping.php',
    'http://bitacoras.net/ping',
    'http://blog.goo.ne.jp/XMLRPC',
    'http://blogdb.jp/xmlrpc',
    'http://blogmatcher.com/u.php',
    'http://bulkfeeds.net/rpc',
    'http://coreblog.org/ping',
    'http://mod-pubsub.org/kn_apps/blogchatt',
    'http://www.lasermemory.com/lsrpc',
    'http://ping.amagle.com',
    'http://ping.bitacoras.com',
    'http://ping.blo.gs',
    'http://ping.bloggers.jp/rpc',
    'http://ping.blogmura.jp/rpc',
    'http://ping.cocolog-nifty.com/xmlrpc',
    'http://ping.exblog.jp/xmlrpc',
    'http://ping.fc2.com',
    'http://ping.feedburner.com',
    'http://ping.myblog.jp',
    'http://ping.rootblog.com/rpc.php',
    'http://ping.rss.drecom.jp',
    'http://ping.speenee.com/xmlrpc',
    'http://ping.syndic8.com/xmlrpc.php',
    'http://ping.weblogalot.com/rpc.php',
    'http://ping.weblogs.se',
    'http://pingoat.com/goat/RPC2',
    'http://rcs.datashed.net/RPC2',
    'http://rpc.blogbuzzmachine.com/RPC2',
    'http://rpc.blogrolling.com/pinger',
    'http://rpc.icerocket.com:10080',
    'http://rpc.newsgator.com',
    'http://rpc.pingomatic.com',
    'http://rpc.technorati.com/rpc/ping',
    'http://rpc.weblogs.com/RPC2',
    'http://topicexchange.com/RPC2',
    'http://trackback.bakeinu.jp/bakeping.php',
    'http://www.a2b.cc/setloc/bp.a2b',
    'http://www.bitacoles.net/ping.php',
    'http://www.blogdigger.com/RPC2',
    'http://www.blogoole.com/ping',
    'http://www.blogoon.net/ping',
    'http://www.blogpeople.net/servlet/weblogUpdates',
    'http://www.blogroots.com/tb_populi.blog?id=1',
    'http://www.blogshares.com/rpc.php',
    'http://www.blogsnow.com/ping',
    'http://www.blogstreet.com/xrbin/xmlrpc.cgi',
    'http://www.holycowdude.com/rpc/ping',
    'http://www.imblogs.net/ping',
    'http://www.mod-pubsub.org/kn_apps/blogchatter/ping.php',
    'http://www.newsisfree.com/xmlrpctest.php',
    'http://www.popdex.com/addsite.php',
    'http://www.snipsnap.org/RPC2',
    'http://www.weblogues.com/RPC',
    'http://xmlrpc.blogg.de',
    'http://xping.pubsub.com/ping',
];

// Export for use
module.exports = { SEOSubmitter, MEGA_PING_LIST, INDEXNOW_ENDPOINTS };
