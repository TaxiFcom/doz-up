#!/usr/bin/env node
/**
 * DOZ UP MEGA VIRAL ENGINE WITH ANALYTICS
 * Real-time dashboard at http://localhost:3333
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const SITE = 'https://doz.com';
const DOMAIN = 'doz.com';
const SITEMAP = 'https://doz.com/sitemap.xml';
const FEED = 'https://doz.com/feed.xml';
const INDEXNOW_KEY = 'a3f2c8b1d4e5f6a7b8c9d0e1f2a3b4c5';
const DASHBOARD_PORT = 3333;

// Analytics data
const analytics = {
    startedAt: new Date().toISOString(),
    totalCycles: 0,
    totalSubmissions: 0,
    totalSuccess: 0,
    totalFailed: 0,
    totalTraffic: 0,
    submissionsPerMinute: 0,
    lastMinuteHits: [],
    categories: {
        indexNow: { hits: 0, success: 0 },
        xmlRpc: { hits: 0, success: 0 },
        searchEngines: { hits: 0, success: 0 },
        social: { hits: 0, success: 0 },
        analyzers: { hits: 0, success: 0 },
        directories: { hits: 0, success: 0 },
        backlinks: { hits: 0, success: 0 },
        archives: { hits: 0, success: 0 },
        feeds: { hits: 0, success: 0 },
        shorteners: { hits: 0, success: 0 },
    },
    hourlyStats: [],
    recentCycles: [],
    topReferrers: {},
    liveActivity: [],
};

// WebSocket clients
const wsClients = new Set();

function broadcast(data) {
    const msg = JSON.stringify(data);
    wsClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });
}

function log(m) {
    const msg = `[${new Date().toISOString()}] ${m}`;
    console.log(msg);
    analytics.liveActivity.unshift({ time: new Date().toISOString(), message: m });
    if (analytics.liveActivity.length > 100) analytics.liveActivity = analytics.liveActivity.slice(0, 100);
    broadcast({ type: 'activity', message: m, success: !m.includes('✗') });
}

function recordHit(category, success) {
    analytics.totalSubmissions++;
    if (success) analytics.totalSuccess++; else analytics.totalFailed++;
    if (analytics.categories[category]) {
        analytics.categories[category].hits++;
        if (success) analytics.categories[category].success++;
    }
    analytics.lastMinuteHits.push(Date.now());
    analytics.lastMinuteHits = analytics.lastMinuteHits.filter(t => Date.now() - t < 60000);
    analytics.submissionsPerMinute = analytics.lastMinuteHits.length;
}

function getRunningTime() {
    const diff = Date.now() - new Date(analytics.startedAt).getTime();
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

function getDashboardData() {
    const lastHour = analytics.hourlyStats.slice(-1)[0];
    return {
        overview: {
            startedAt: analytics.startedAt,
            runningFor: getRunningTime(),
            totalCycles: analytics.totalCycles,
            totalSubmissions: analytics.totalSubmissions,
            totalSuccess: analytics.totalSuccess,
            totalFailed: analytics.totalFailed,
            successRate: analytics.totalSubmissions > 0
                ? ((analytics.totalSuccess / analytics.totalSubmissions) * 100).toFixed(1) + '%' : '0%',
            totalTraffic: analytics.totalTraffic,
        },
        realtime: {
            submissionsPerMinute: analytics.submissionsPerMinute,
            submissionsLastHour: lastHour ? lastHour.success + lastHour.failed : 0,
        },
        categories: analytics.categories,
        hourlyChart: analytics.hourlyStats.slice(-24).map(h => ({
            hour: h.hour.slice(11, 13) + ':00',
            success: h.success,
            failed: h.failed,
        })),
        recentCycles: analytics.recentCycles.slice(0, 20),
        topReferrers: Object.entries(analytics.topReferrers)
            .sort((a, b) => b[1] - a[1]).slice(0, 20)
            .map(([source, count]) => ({ source, count })),
    };
}

// HTTP request helper
const hit = (url, method = 'GET', body = null, contentType = 'application/json') => {
    return new Promise((resolve) => {
        try {
            const u = new URL(url);
            const proto = url.startsWith('https') ? https : http;
            const opts = {
                hostname: u.hostname, port: u.port || (url.startsWith('https') ? 443 : 80),
                path: u.pathname + u.search, method, timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0', 'Accept': '*/*' }
            };
            if (body) { opts.headers['Content-Type'] = contentType; opts.headers['Content-Length'] = Buffer.byteLength(body); }
            const req = proto.request(opts, (res) => resolve({ ok: res.statusCode < 400 || res.statusCode === 403, status: res.statusCode }));
            req.on('error', () => resolve({ ok: false }));
            req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
            if (body) req.write(body);
            req.end();
        } catch { resolve({ ok: false }); }
    });
};

// All pages
const PAGES = ['', '/download.html', '/demo.html', '/gallery.html', '/studio.html', '/upload.html',
    '/mobile.html', '/pay.html', '/landing.html', '/tools.html', '/collage.html', '/frames.html',
    '/hub.html', '/login.html', '/security.html', '/my-account.html', '/feed.xml', '/sitemap.xml'];

// ==================== MEGA URL LISTS ====================
const INDEXNOW = ['https://api.indexnow.org/indexnow', 'https://www.bing.com/indexnow', 'https://yandex.com/indexnow', 'https://search.seznam.cz/indexnow'];
const SEARCH_PINGS = [`https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(SITEMAP)}`];
const WEBSUB_HUBS = ['https://pubsubhubbub.appspot.com/', 'https://push.superfeedr.com/', 'https://pubsubhubbub.superfeedr.com/'];
const XMLRPC_PINGS = ['http://rpc.pingomatic.com/', 'http://ping.blogs.yandex.ru/RPC2', 'http://rpc.twingly.com/', 'http://ping.blo.gs/', 'http://rpc.blogrolling.com/pinger/', 'http://ping.fc2.com/', 'http://ping.feedburner.com/', 'http://blogsearch.google.com/ping/RPC2', 'http://rpc.weblogs.com/RPC2', 'http://ping.syndic8.com/xmlrpc.php'];
const SHORTENERS = [`https://tinyurl.com/api-create.php?url=${encodeURIComponent(SITE)}`, `https://is.gd/create.php?format=simple&url=${encodeURIComponent(SITE)}`, `https://v.gd/create.php?format=simple&url=${encodeURIComponent(SITE)}`];
const ARCHIVES = [`https://web.archive.org/save/${SITE}`, `https://archive.today/?run=1&url=${encodeURIComponent(SITE)}`];

const ANALYZERS = [
    `https://www.whois.com/whois/${DOMAIN}`, `https://who.is/whois/${DOMAIN}`, `https://lookup.icann.org/lookup?q=${DOMAIN}`,
    `https://builtwith.com/${DOMAIN}`, `https://w3techs.com/sites/info/${DOMAIN}`, `https://sitereport.netcraft.com/?url=${SITE}`,
    `https://www.statshow.com/www/${DOMAIN}`, `https://www.worthofweb.com/website-value/${DOMAIN}`,
    `https://hstspreload.org/?domain=${DOMAIN}`, `https://www.ssllabs.com/ssltest/analyze.html?d=${DOMAIN}`,
    `https://pagespeed.web.dev/report?url=${encodeURIComponent(SITE)}`, `https://mxtoolbox.com/SuperTool.aspx?action=a%3a${DOMAIN}`,
    `https://www.redirect-checker.org/index.php?url=${encodeURIComponent(SITE)}`, `https://httpstatus.io/?url=${encodeURIComponent(SITE)}`,
];

const SOCIAL = [
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE)}`,
    `https://twitter.com/intent/tweet?url=${encodeURIComponent(SITE)}`,
    `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(SITE)}`,
    `https://t.me/share/url?url=${encodeURIComponent(SITE)}`,
    `https://api.whatsapp.com/send?text=${encodeURIComponent(SITE)}`,
    `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${encodeURIComponent(SITE)}`,
    `https://getpocket.com/save?url=${encodeURIComponent(SITE)}`,
    `https://share.flipboard.com/bookmarklet/popout?v=2&url=${encodeURIComponent(SITE)}`,
    `https://vk.com/share.php?url=${encodeURIComponent(SITE)}`,
    `https://www.xing.com/spi/shares/new?url=${encodeURIComponent(SITE)}`,
    `https://b.hatena.ne.jp/add?mode=confirm&url=${encodeURIComponent(SITE)}`,
    `https://www.addtoany.com/share?url=${encodeURIComponent(SITE)}`,
];

const DIRECTORIES = [
    `https://www.producthunt.com/search?q=${DOMAIN}`, `https://alternativeto.net/browse/search/?q=${DOMAIN}`,
    `https://stackshare.io/search?q=${DOMAIN}`, `https://github.com/search?q=${DOMAIN}`,
];

const INTL_SEARCH = [
    `https://www.baidu.com/s?wd=${encodeURIComponent(SITE)}`, `https://yandex.com/search/?text=${encodeURIComponent(SITE)}`,
    `https://search.naver.com/search.naver?query=${encodeURIComponent(SITE)}`, `https://www.ecosia.org/search?q=${encodeURIComponent(SITE)}`,
    `https://www.qwant.com/?q=${encodeURIComponent(SITE)}`, `https://duckduckgo.com/?q=${encodeURIComponent(SITE)}`,
    `https://www.startpage.com/search?q=${encodeURIComponent(SITE)}`, `https://www.mojeek.com/search?q=${encodeURIComponent(SITE)}`,
];

const BACKLINKS = [
    `https://smallseotools.com/backlink-checker/?url=${DOMAIN}`, `https://openlinkprofiler.org/r/${DOMAIN}`,
];

const FEEDS = [
    `https://feedly.com/i/subscription/feed/${encodeURIComponent(FEED)}`,
    `https://www.inoreader.com/search/feeds/${encodeURIComponent(FEED)}`,
];

// ==================== VIRAL CYCLE ====================
async function runCycle() {
    analytics.totalCycles++;
    const cycleNum = analytics.totalCycles;
    let success = 0, failed = 0;
    const startTime = Date.now();

    log(`${'═'.repeat(60)}`);
    log(`MEGA CYCLE #${cycleNum} STARTED`);
    log(`${'═'.repeat(60)}`);

    // IndexNow
    log('>>> IndexNow (4 endpoints)');
    const indexNowBody = JSON.stringify({ host: DOMAIN, key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: PAGES.map(p => SITE + p) });
    for (const ep of INDEXNOW) {
        const r = await hit(ep, 'POST', indexNowBody);
        recordHit('indexNow', r.ok);
        if (r.ok) { success++; log(`  ✓ ${ep.split('/')[2]}`); } else { failed++; log(`  ✗ ${ep.split('/')[2]}`); }
    }

    // XML-RPC
    log('>>> XML-RPC Pings');
    const xmlPing = `<?xml version="1.0"?><methodCall><methodName>weblogUpdates.ping</methodName><params><param><value><string>DOZ UP</string></value></param><param><value><string>${SITE}</string></value></param></params></methodCall>`;
    for (const ep of XMLRPC_PINGS) {
        const r = await hit(ep, 'POST', xmlPing, 'text/xml');
        recordHit('xmlRpc', r.ok);
        if (r.ok) { success += 10; log(`  ✓ ${ep.split('/')[2]} (+10)`); } else { failed++; }
    }

    // WebSub
    log('>>> WebSub Hubs');
    for (const hub of WEBSUB_HUBS) {
        const r = await hit(hub, 'POST', `hub.mode=publish&hub.url=${encodeURIComponent(FEED)}`, 'application/x-www-form-urlencoded');
        recordHit('feeds', r.ok);
        if (r.ok) { success++; log(`  ✓ ${hub.split('/')[2]}`); } else { failed++; }
    }

    // All other endpoints
    const allUrls = [...SEARCH_PINGS, ...SHORTENERS, ...ARCHIVES, ...ANALYZERS, ...SOCIAL, ...DIRECTORIES, ...INTL_SEARCH, ...BACKLINKS, ...FEEDS];

    log(`>>> Processing ${allUrls.length} endpoints...`);
    const batchSize = 20;
    for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(url => hit(url)));
        results.forEach((r, idx) => {
            const url = batch[idx];
            let cat = 'analyzers';
            if (url.includes('social') || url.includes('linkedin') || url.includes('twitter') || url.includes('pinterest') || url.includes('telegram') || url.includes('whatsapp') || url.includes('tumblr') || url.includes('vk.com') || url.includes('xing') || url.includes('hatena') || url.includes('addtoany') || url.includes('pocket') || url.includes('flipboard')) cat = 'social';
            else if (url.includes('tinyurl') || url.includes('is.gd') || url.includes('v.gd')) cat = 'shorteners';
            else if (url.includes('archive')) cat = 'archives';
            else if (url.includes('producthunt') || url.includes('alternativeto') || url.includes('github') || url.includes('stackshare')) cat = 'directories';
            else if (url.includes('backlink') || url.includes('openlinkprofiler')) cat = 'backlinks';
            else if (url.includes('baidu') || url.includes('yandex') || url.includes('naver') || url.includes('ecosia') || url.includes('qwant') || url.includes('duck') || url.includes('startpage') || url.includes('mojeek')) cat = 'searchEngines';
            else if (url.includes('feedly') || url.includes('inoreader')) cat = 'feeds';
            recordHit(cat, r.ok);
            if (r.ok) success++; else failed++;
        });
        process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, allUrls.length)}/${allUrls.length} | Success: ${success}`);
    }
    console.log('');

    // Record cycle
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    analytics.recentCycles.unshift({ cycle: cycleNum, timestamp: new Date().toISOString(), success, failed, duration });
    if (analytics.recentCycles.length > 100) analytics.recentCycles = analytics.recentCycles.slice(0, 100);

    // Hourly stats
    const hour = new Date().toISOString().slice(0, 13);
    let hourStat = analytics.hourlyStats.find(h => h.hour === hour);
    if (!hourStat) { hourStat = { hour, cycles: 0, success: 0, failed: 0 }; analytics.hourlyStats.push(hourStat); }
    hourStat.cycles++;
    hourStat.success += success;
    hourStat.failed += failed;
    analytics.hourlyStats = analytics.hourlyStats.slice(-72);

    log(`${'═'.repeat(60)}`);
    log(`CYCLE #${cycleNum} COMPLETE: ${success} success, ${failed} failed (${duration}s)`);
    log(`ALL TIME: ${analytics.totalSuccess} success / ${analytics.totalSubmissions} total`);
    log(`NEXT CYCLE: 5 minutes`);
    log(`${'═'.repeat(60)}`);

    broadcast({ type: 'cycle-complete', cycle: cycleNum, success, failed });
    broadcast({ type: 'dashboard', data: getDashboardData() });
}

// ==================== HTTP SERVER ====================
const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

    if (url === '/api/viral/dashboard' || url === '/api/viral/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getDashboardData()));
    }
    else if (url === '/' || url === '/viral-dashboard.html') {
        const dashPath = path.join(__dirname, '../public/viral-dashboard.html');
        if (fs.existsSync(dashPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(fs.readFileSync(dashPath));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Dashboard loading... refresh in 5 seconds</h1><script>setTimeout(()=>location.reload(),5000)</script>');
        }
    }
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws/viral' });
wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: 'dashboard', data: getDashboardData() }));
    ws.on('close', () => wsClients.delete(ws));
});

// ==================== START ====================
console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║     ██████╗  ██████╗ ███████╗    ██╗   ██╗██████╗                   ║
║     ██╔══██╗██╔═══██╗╚══███╔╝    ██║   ██║██╔══██╗                  ║
║     ██║  ██║██║   ██║  ███╔╝     ██║   ██║██████╔╝                  ║
║     ██║  ██║██║   ██║ ███╔╝      ██║   ██║██╔═══╝                   ║
║     ██████╔╝╚██████╔╝███████╗    ╚██████╔╝██║                       ║
║     ╚═════╝  ╚═════╝ ╚══════╝     ╚═════╝ ╚═╝                       ║
║                                                                      ║
║         MEGA VIRAL ENGINE WITH REAL-TIME ANALYTICS                  ║
║                                                                      ║
║   Dashboard: http://localhost:${DASHBOARD_PORT}                              ║
║   API: http://localhost:${DASHBOARD_PORT}/api/viral/dashboard                ║
║   WebSocket: ws://localhost:${DASHBOARD_PORT}/ws/viral                       ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

server.listen(DASHBOARD_PORT, () => {
    console.log(`[Server] Dashboard running at http://localhost:${DASHBOARD_PORT}`);
    console.log(`[Server] Open in browser to watch real-time stats\n`);

    // Start viral cycles
    runCycle();
    setInterval(runCycle, 5 * 60 * 1000);
});

// Broadcast dashboard updates every 5 seconds
setInterval(() => {
    broadcast({ type: 'dashboard', data: getDashboardData() });
}, 5000);

process.on('SIGINT', () => {
    console.log(`\nShutdown: ${analytics.totalCycles} cycles, ${analytics.totalSuccess}/${analytics.totalSubmissions} successful`);
    process.exit(0);
});
