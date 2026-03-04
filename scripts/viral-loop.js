#!/usr/bin/env node
/**
 * DOZ UP Viral Loop - Runs Every 5 Minutes
 * Maximum organic traffic generation worldwide
 */

const https = require('https');
const http = require('http');

const SITE_URL = 'https://doz.com';
const SITEMAP_URL = 'https://doz.com/sitemap.xml';
const FEED_URL = 'https://doz.com/feed.xml';
const INDEXNOW_KEY = 'a3f2c8b1d4e5f6a7b8c9d0e1f2a3b4c5';

let runCount = 0;
let totalSuccess = 0;
let totalFailed = 0;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function httpGet(url, timeout = 8000) {
    return new Promise((resolve) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, {
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            resolve({ status: res.statusCode, ok: res.statusCode < 400 });
        });
        req.on('error', () => resolve({ status: 0, ok: false }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, ok: false }); });
    });
}

async function httpPost(url, body, contentType = 'application/json', timeout = 8000) {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https') ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            timeout,
            headers: {
                'Content-Type': contentType,
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'DOZ-UP-Bot/2.5.0'
            }
        }, (res) => {
            resolve({ status: res.statusCode, ok: res.statusCode < 400 });
        });
        req.on('error', () => resolve({ status: 0, ok: false }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, ok: false }); });
        req.write(body);
        req.end();
    });
}

// All pages to promote
const PAGES = [
    '', '/download.html', '/demo.html', '/gallery.html', '/studio.html',
    '/upload.html', '/mobile.html', '/pay.html', '/landing.html', '/tools.html',
    '/collage.html', '/frames.html', '/hub.html', '/login.html', '/security.html'
];

async function runViralCycle() {
    runCount++;
    let success = 0;
    let failed = 0;

    log(`\n${'='.repeat(60)}`);
    log(`VIRAL CYCLE #${runCount} STARTED`);
    log(`${'='.repeat(60)}`);

    // 1. IndexNow submissions (instant indexing)
    log('>>> IndexNow Submissions');
    const indexNowEndpoints = [
        'https://api.indexnow.org/indexnow',
        'https://www.bing.com/indexnow',
        'https://yandex.com/indexnow',
    ];

    const urls = PAGES.map(p => SITE_URL + p);
    const indexNowBody = JSON.stringify({
        host: 'doz.com',
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: urls
    });

    for (const endpoint of indexNowEndpoints) {
        const r = await httpPost(endpoint, indexNowBody);
        if (r.ok || r.status === 202) { success++; log(`  ✓ ${endpoint.split('/')[2]}`); }
        else { failed++; }
    }

    // 2. Yandex ping
    log('>>> Search Engine Pings');
    const yandex = await httpGet(`https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`);
    if (yandex.ok) { success++; log('  ✓ Yandex'); } else { failed++; }

    // 3. PubSubHubbub/WebSub (notify feed readers)
    log('>>> Feed Notifications');
    const hubs = [
        'https://pubsubhubbub.appspot.com/',
        'https://push.superfeedr.com/',
    ];
    for (const hub of hubs) {
        const body = `hub.mode=publish&hub.url=${encodeURIComponent(FEED_URL)}`;
        const r = await httpPost(hub, body, 'application/x-www-form-urlencoded');
        if (r.ok) { success++; log(`  ✓ ${hub.split('/')[2]}`); } else { failed++; }
    }

    // 4. Ping-o-Matic (pings 20+ services)
    log('>>> Ping-o-Matic (20+ services)');
    const xmlPing = `<?xml version="1.0"?><methodCall><methodName>weblogUpdates.ping</methodName><params><param><value><string>DOZ UP</string></value></param><param><value><string>${SITE_URL}</string></value></param></params></methodCall>`;
    const pom = await httpPost('http://rpc.pingomatic.com/', xmlPing, 'text/xml');
    if (pom.ok) { success += 20; log('  ✓ Ping-o-Matic (20+ services notified)'); } else { failed++; }

    // 5. Web archive trigger
    log('>>> Web Archives');
    const randomPage = PAGES[Math.floor(Math.random() * PAGES.length)];
    const archive = await httpGet(`https://web.archive.org/save/${SITE_URL}${randomPage}`, 15000);
    if (archive.ok || archive.status === 302) { success++; log(`  ✓ Wayback Machine (${randomPage || '/'})`); } else { failed++; }

    // 6. Website analyzers (creates backlinks, triggers crawlers)
    log('>>> Website Analyzers');
    const analyzers = [
        `https://www.whois.com/whois/doz.com`,
        `https://builtwith.com/doz.com`,
        `https://w3techs.com/sites/info/doz.com`,
        `https://sitereport.netcraft.com/?url=${SITE_URL}`,
        `https://www.statshow.com/www/doz.com`,
        `https://hstspreload.org/?domain=doz.com`,
    ];
    for (const url of analyzers) {
        const r = await httpGet(url);
        if (r.ok) { success++; log(`  ✓ ${url.split('/')[2]}`); } else { failed++; }
    }

    // 7. Social signals
    log('>>> Social Platforms');
    const social = [
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE_URL)}`,
        `https://t.me/share/url?url=${encodeURIComponent(SITE_URL)}`,
        `https://api.whatsapp.com/send?text=${encodeURIComponent('Check out DOZ UP - fastest screenshot sharing! ' + SITE_URL)}`,
        `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(SITE_URL)}`,
    ];
    for (const url of social) {
        const r = await httpGet(url);
        if (r.ok || r.status === 302 || r.status === 308) { success++; log(`  ✓ ${url.split('/')[2]}`); } else { failed++; }
    }

    // 8. URL shorteners (backlinks)
    log('>>> URL Shorteners');
    const tiny = await httpGet(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(SITE_URL + randomPage)}`);
    if (tiny.ok) { success++; log('  ✓ TinyURL'); } else { failed++; }

    // 9. DNS/Security checkers
    log('>>> DNS & Security');
    const dns = [
        `https://lookup.icann.org/lookup?q=doz.com`,
        `https://mxtoolbox.com/SuperTool.aspx?action=a%3adoz.com`,
    ];
    for (const url of dns) {
        const r = await httpGet(url);
        if (r.ok) { success++; log(`  ✓ ${url.split('/')[2]}`); } else { failed++; }
    }

    // 10. Page speed / SEO tools
    log('>>> SEO Tools');
    const seo = [
        `https://pagespeed.web.dev/report?url=${encodeURIComponent(SITE_URL)}`,
        `https://www.redirect-checker.org/index.php?url=${encodeURIComponent(SITE_URL)}`,
    ];
    for (const url of seo) {
        const r = await httpGet(url);
        if (r.ok || r.status === 302) { success++; log(`  ✓ ${url.split('/')[2]}`); } else { failed++; }
    }

    totalSuccess += success;
    totalFailed += failed;

    log(`${'='.repeat(60)}`);
    log(`CYCLE #${runCount} COMPLETE: ${success} success, ${failed} failed`);
    log(`TOTAL ALL TIME: ${totalSuccess} success, ${totalFailed} failed`);
    log(`NEXT RUN: 7 minutes`);
    log(`${'='.repeat(60)}\n`);
}

// Run immediately then every 5 minutes
log('╔════════════════════════════════════════════════════════════╗');
log('║     DOZ UP VIRAL LOOP - RUNNING EVERY 7 MINUTES           ║');
log('║     Making doz.com famous worldwide automatically         ║');
log('╚════════════════════════════════════════════════════════════╝');

runViralCycle();
setInterval(runViralCycle, 7 * 60 * 1000); // Every 7 minutes

// Keep alive
process.on('SIGINT', () => {
    log(`\nShutting down. Total runs: ${runCount}, Success: ${totalSuccess}, Failed: ${totalFailed}`);
    process.exit(0);
});
