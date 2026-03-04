#!/usr/bin/env node
/**
 * DOZ UP SEO Auto-Ping Script
 * Run via cron or Windows Task Scheduler for continuous indexing
 *
 * Usage: node seo-auto-ping.js
 * Cron: 0 * * * * cd /path/to/DOZ-UP && node scripts/seo-auto-ping.js >> logs/seo.log 2>&1
 * Windows: schtasks /create /tn "DOZ-UP-SEO-Ping" /tr "node C:\DOZ-UP\scripts\seo-auto-ping.js" /sc hourly
 */

const https = require('https');
const http = require('http');

const SITE_URL = 'https://doz.com';
const SITEMAP_URL = 'https://doz.com/sitemap.xml';

// Search engine ping endpoints
const PING_ENDPOINTS = [
    `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
    `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
    `https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`,
];

// IndexNow endpoints for instant indexing
const INDEXNOW_ENDPOINTS = [
    'https://api.indexnow.org/indexnow',
    'https://www.bing.com/indexnow',
    'https://yandex.com/indexnow',
];

const INDEXNOW_KEY = 'a3f2c8b1d4e5f6a7b8c9d0e1f2a3b4c5';

// Pages to submit
const PAGES = [
    '/',
    '/download.html',
    '/demo.html',
    '/gallery.html',
    '/studio.html',
    '/upload.html',
    '/mobile.html',
    '/pay.html',
    '/login.html',
    '/landing.html',
];

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function httpGet(url, timeout = 10000) {
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

async function httpPost(url, body, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = url.startsWith('https') ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https') ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            timeout,
            headers: {
                'Content-Type': 'application/json',
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

async function pingSearchEngines() {
    log('=== Pinging Search Engines ===');
    let success = 0;
    let failed = 0;

    for (const url of PING_ENDPOINTS) {
        try {
            const response = await httpGet(url);
            const isSuccess = response.status >= 200 && response.status < 400;
            log(`${isSuccess ? '✓' : '✗'} ${url.split('/')[2]} - ${response.status}`);
            if (isSuccess) success++; else failed++;
        } catch (err) {
            log(`✗ ${url.split('/')[2]} - ${err.message}`);
            failed++;
        }
    }

    return { success, failed };
}

async function submitIndexNow() {
    log('=== Submitting to IndexNow ===');
    let success = 0;
    let failed = 0;

    const urls = PAGES.map(page => `${SITE_URL}${page}`);

    const payload = JSON.stringify({
        host: 'doz.com',
        key: INDEXNOW_KEY,
        keyLocation: `https://doz.com/${INDEXNOW_KEY}.txt`,
        urlList: urls
    });

    for (const endpoint of INDEXNOW_ENDPOINTS) {
        try {
            const response = await httpPost(endpoint, payload);
            const isSuccess = response.status >= 200 && response.status < 400;
            log(`${isSuccess ? '✓' : '✗'} ${endpoint.split('/')[2]} - ${response.status}`);
            if (isSuccess) success++; else failed++;
        } catch (err) {
            log(`✗ ${endpoint.split('/')[2]} - ${err.message}`);
            failed++;
        }
    }

    return { success, failed };
}

async function pingBlogServices() {
    log('=== Pinging Blog/Update Services ===');

    const services = [
        'http://rpc.pingomatic.com/',
        'http://ping.feedburner.com/',
        'http://rpc.weblogs.com/RPC2',
    ];

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>weblogUpdates.extendedPing</methodName>
  <params>
    <param><value><string>DOZ UP - Instant Screenshot Sharing</string></value></param>
    <param><value><string>${SITE_URL}</string></value></param>
    <param><value><string>${SITE_URL}</string></value></param>
    <param><value><string>${SITE_URL}/feed.xml</string></value></param>
  </params>
</methodCall>`;

    let success = 0;
    let failed = 0;

    for (const url of services) {
        try {
            const response = await httpPost(url, xmlBody);
            const isSuccess = response.status >= 200 && response.status < 400;
            log(`${isSuccess ? '✓' : '✗'} ${url.split('/')[2]} - ${response.status}`);
            if (isSuccess) success++; else failed++;
        } catch (err) {
            log(`✗ ${url.split('/')[2]} - ${err.message}`);
            failed++;
        }
    }

    return { success, failed };
}

async function main() {
    log('========================================');
    log('DOZ UP SEO Auto-Ping Started');
    log('========================================');

    const startTime = Date.now();

    const searchEngineResults = await pingSearchEngines();
    const indexNowResults = await submitIndexNow();
    const blogResults = await pingBlogServices();

    const totalSuccess = searchEngineResults.success + indexNowResults.success + blogResults.success;
    const totalFailed = searchEngineResults.failed + indexNowResults.failed + blogResults.failed;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    log('========================================');
    log(`SUMMARY: ${totalSuccess} success, ${totalFailed} failed`);
    log(`Duration: ${duration}s`);
    log('========================================');

    // Return exit code based on success rate
    process.exit(totalFailed > totalSuccess ? 1 : 0);
}

main().catch(err => {
    log(`Fatal error: ${err.message}`);
    process.exit(1);
});
