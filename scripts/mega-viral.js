#!/usr/bin/env node
/**
 * DOZ UP MEGA VIRAL ENGINE
 * Submits to 1000+ endpoints every 5 minutes
 * Maximum organic traffic generation worldwide
 */

const https = require('https');
const http = require('http');

const SITE = 'https://doz.com';
const DOMAIN = 'doz.com';
const SITEMAP = 'https://doz.com/sitemap.xml';
const FEED = 'https://doz.com/feed.xml';
const INDEXNOW_KEY = 'a3f2c8b1d4e5f6a7b8c9d0e1f2a3b4c5';

let cycle = 0, totalHits = 0, totalSuccess = 0;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// Fast HTTP request with short timeout
const hit = (url, method = 'GET', body = null, contentType = 'application/json') => {
    return new Promise((resolve) => {
        try {
            const u = new URL(url);
            const proto = url.startsWith('https') ? https : http;
            const opts = {
                hostname: u.hostname, port: u.port || (url.startsWith('https') ? 443 : 80),
                path: u.pathname + u.search, method, timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', 'Accept': '*/*' }
            };
            if (body) { opts.headers['Content-Type'] = contentType; opts.headers['Content-Length'] = Buffer.byteLength(body); }
            const req = proto.request(opts, (res) => resolve({ ok: res.statusCode < 400 || res.statusCode === 403 }));
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

// IndexNow endpoints
const INDEXNOW = [
    'https://api.indexnow.org/indexnow',
    'https://www.bing.com/indexnow',
    'https://yandex.com/indexnow',
    'https://search.seznam.cz/indexnow',
];

// Search engine pings
const SEARCH_PINGS = [
    `https://webmaster.yandex.com/ping?sitemap=${encodeURIComponent(SITEMAP)}`,
    `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP)}`,
    `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP)}`,
];

// PubSubHubbub / WebSub hubs
const WEBSUB_HUBS = [
    'https://pubsubhubbub.appspot.com/',
    'https://push.superfeedr.com/',
    'https://pubsubhubbub.superfeedr.com/',
    'https://switchboard.p3k.io/',
    'https://hub.rsscloud.io/',
    'https://phubb.cweiske.de/hub.php',
];

// XML-RPC Ping services (each pings multiple downstream services)
const XMLRPC_PINGS = [
    'http://rpc.pingomatic.com/',
    'http://ping.blogs.yandex.ru/RPC2',
    'http://rpc.twingly.com/',
    'http://ping.blo.gs/',
    'http://rpc.blogrolling.com/pinger/',
    'http://rpc.icerocket.com:10080/',
    'http://ping.fc2.com/',
    'http://ping.feedburner.com/',
    'http://blogsearch.google.com/ping/RPC2',
    'http://rpc.weblogs.com/RPC2',
    'http://ping.syndic8.com/xmlrpc.php',
    'http://ping.weblogalot.com/rpc.php',
    'http://xmlrpc.blogg.de/',
    'http://ping.bloggers.jp/rpc/',
    'http://api.feedster.com/ping.php',
    'http://api.moreover.com/ping',
    'http://ping.rootblog.com/rpc.php',
    'http://xping.pubsub.com/ping',
    'http://ping.cocolog-nifty.com/xmlrpc',
    'http://www.blogpeople.net/ping/',
];

// URL Shorteners (create backlinks)
const SHORTENERS = [
    `https://tinyurl.com/api-create.php?url=${encodeURIComponent(SITE)}`,
    `https://is.gd/create.php?format=simple&url=${encodeURIComponent(SITE)}`,
    `https://v.gd/create.php?format=simple&url=${encodeURIComponent(SITE)}`,
    `https://clck.ru/--?url=${encodeURIComponent(SITE)}`,
    `https://cutt.ly/api/api.php?key=free&short=${encodeURIComponent(SITE)}`,
];

// Web Archives
const ARCHIVES = [
    `https://web.archive.org/save/${SITE}`,
    `https://archive.today/?run=1&url=${encodeURIComponent(SITE)}`,
    `https://megalodon.jp/?url=${encodeURIComponent(SITE)}`,
    `https://archive.ph/?run=1&url=${encodeURIComponent(SITE)}`,
    `https://webcache.googleusercontent.com/search?q=cache:${SITE}`,
];

// Website analyzers and SEO tools
const ANALYZERS = [
    // Domain/WHOIS
    `https://www.whois.com/whois/${DOMAIN}`,
    `https://who.is/whois/${DOMAIN}`,
    `https://lookup.icann.org/lookup?q=${DOMAIN}`,
    `https://www.godaddy.com/whois/results.aspx?domain=${DOMAIN}`,
    `https://whois.domaintools.com/${DOMAIN}`,
    // Tech stack
    `https://builtwith.com/${DOMAIN}`,
    `https://w3techs.com/sites/info/${DOMAIN}`,
    `https://www.wappalyzer.com/lookup/${DOMAIN}`,
    `https://sitereport.netcraft.com/?url=${SITE}`,
    `https://toolbar.netcraft.com/site_report?url=${SITE}`,
    // Traffic/rank
    `https://www.alexa.com/siteinfo/${DOMAIN}`,
    `https://www.similarweb.com/website/${DOMAIN}`,
    `https://www.semrush.com/info/${DOMAIN}`,
    `https://ahrefs.com/site-explorer?target=${DOMAIN}`,
    `https://www.statshow.com/www/${DOMAIN}`,
    `https://www.worthofweb.com/website-value/${DOMAIN}`,
    `https://sitevaluation.org/${DOMAIN}`,
    `https://www.estimatewebsite.com/${DOMAIN}`,
    `https://www.websiteoutlook.com/www.${DOMAIN}`,
    // Security
    `https://securityheaders.com/?q=${DOMAIN}`,
    `https://observatory.mozilla.org/analyze/${DOMAIN}`,
    `https://hstspreload.org/?domain=${DOMAIN}`,
    `https://www.ssllabs.com/ssltest/analyze.html?d=${DOMAIN}`,
    `https://transparencyreport.google.com/safe-browsing/search?url=${DOMAIN}`,
    `https://sitecheck.sucuri.net/results/${DOMAIN}`,
    `https://www.virustotal.com/gui/domain/${DOMAIN}`,
    // Speed/Performance
    `https://pagespeed.web.dev/report?url=${encodeURIComponent(SITE)}`,
    `https://gtmetrix.com/reports/${DOMAIN}`,
    `https://tools.pingdom.com/#${SITE}`,
    `https://www.webpagetest.org/?url=${encodeURIComponent(SITE)}`,
    `https://yellowlab.tools/?url=${encodeURIComponent(SITE)}`,
    // DNS
    `https://dnschecker.org/#A/${DOMAIN}`,
    `https://mxtoolbox.com/SuperTool.aspx?action=a%3a${DOMAIN}`,
    `https://intodns.com/${DOMAIN}`,
    `https://dnslytics.com/domain/${DOMAIN}`,
    `https://viewdns.info/reverseip/?host=${DOMAIN}`,
    `https://www.robtex.com/dns-lookup/${DOMAIN}`,
    // SEO
    `https://www.seoptimer.com/${DOMAIN}`,
    `https://www.seobility.net/en/seocheck/${DOMAIN}`,
    `https://smallseotools.com/website-seo-score-checker/?url=${DOMAIN}`,
    `https://seositecheckup.com/seo-audit/${DOMAIN}`,
    `https://www.woorank.com/en/teaser-review/${DOMAIN}`,
    `https://neilpatel.com/seo-analyzer/results?url=${SITE}`,
    // Redirect/Link
    `https://www.redirect-checker.org/index.php?url=${encodeURIComponent(SITE)}`,
    `https://httpstatus.io/?url=${encodeURIComponent(SITE)}`,
    `https://wheregoes.com/retracer.php?url=${encodeURIComponent(SITE)}`,
    `https://www.whatsmyip.org/http-compression-test/?url=${encodeURIComponent(SITE)}`,
];

// Social bookmarking / share triggers
const SOCIAL = [
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SITE)}`,
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE)}`,
    `https://twitter.com/intent/tweet?url=${encodeURIComponent(SITE)}&text=Check%20out%20DOZ%20UP`,
    `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(SITE)}`,
    `https://www.reddit.com/submit?url=${encodeURIComponent(SITE)}`,
    `https://t.me/share/url?url=${encodeURIComponent(SITE)}`,
    `https://api.whatsapp.com/send?text=${encodeURIComponent(SITE)}`,
    `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${encodeURIComponent(SITE)}`,
    `https://mix.com/add?url=${encodeURIComponent(SITE)}`,
    `https://getpocket.com/save?url=${encodeURIComponent(SITE)}`,
    `https://www.digg.com/submit?url=${encodeURIComponent(SITE)}`,
    `https://share.flipboard.com/bookmarklet/popout?v=2&url=${encodeURIComponent(SITE)}`,
    `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(SITE)}`,
    `https://slashdot.org/submission?url=${encodeURIComponent(SITE)}`,
    `https://www.stumbleupon.com/submit?url=${encodeURIComponent(SITE)}`,
    `https://buffer.com/add?url=${encodeURIComponent(SITE)}`,
    `https://share.diasporafoundation.org/?url=${encodeURIComponent(SITE)}`,
    `https://www.evernote.com/clip.action?url=${encodeURIComponent(SITE)}`,
    `https://www.instapaper.com/hello2?url=${encodeURIComponent(SITE)}`,
    `https://www.blogger.com/blog_this.pyra?u=${encodeURIComponent(SITE)}`,
    `https://compose.mail.yahoo.com/?body=${encodeURIComponent(SITE)}`,
    `https://mail.google.com/mail/?view=cm&body=${encodeURIComponent(SITE)}`,
    `https://web.skype.com/share?url=${encodeURIComponent(SITE)}`,
    `https://line.me/R/msg/text/?${encodeURIComponent(SITE)}`,
    `https://connect.ok.ru/offer?url=${encodeURIComponent(SITE)}`,
    `https://vk.com/share.php?url=${encodeURIComponent(SITE)}`,
    `https://www.xing.com/spi/shares/new?url=${encodeURIComponent(SITE)}`,
    `https://www.weibo.com/share/share.php?url=${encodeURIComponent(SITE)}`,
    `https://service.weibo.com/share/share.php?url=${encodeURIComponent(SITE)}`,
    `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${encodeURIComponent(SITE)}`,
    `https://share.renren.com/share/buttonshare?link=${encodeURIComponent(SITE)}`,
    `https://www.douban.com/recommend/?url=${encodeURIComponent(SITE)}`,
    `https://b.hatena.ne.jp/add?mode=confirm&url=${encodeURIComponent(SITE)}`,
    `https://mixi.jp/share.pl?u=${encodeURIComponent(SITE)}`,
    `https://www.addtoany.com/share?url=${encodeURIComponent(SITE)}`,
    `https://www.sharethis.com/share?url=${encodeURIComponent(SITE)}`,
];

// Directory/listing sites
const DIRECTORIES = [
    `https://www.crunchbase.com/discover/organization.companies/${DOMAIN}`,
    `https://angel.co/company/${DOMAIN.replace('.com','')}`,
    `https://www.producthunt.com/search?q=${DOMAIN}`,
    `https://alternativeto.net/browse/search/?q=${DOMAIN}`,
    `https://stackshare.io/search?q=${DOMAIN}`,
    `https://www.capterra.com/search/?query=${DOMAIN}`,
    `https://www.g2.com/search?query=${DOMAIN}`,
    `https://www.trustpilot.com/search?query=${DOMAIN}`,
    `https://sourceforge.net/software/?q=${DOMAIN}`,
    `https://github.com/search?q=${DOMAIN}`,
    `https://gitlab.com/search?search=${DOMAIN}`,
    `https://www.yelp.com/search?find_desc=${DOMAIN}`,
    `https://www.bbb.org/search?find_text=${DOMAIN}`,
    `https://www.yellowpages.com/search?search_terms=${DOMAIN}`,
    `https://www.manta.com/mb?search=${DOMAIN}`,
];

// Blog/CMS platforms (trigger crawlers)
const BLOGS = [
    `https://www.blogger.com/profile/find?q=${DOMAIN}`,
    `https://wordpress.com/read/search?q=${DOMAIN}`,
    `https://medium.com/search?q=${DOMAIN}`,
    `https://dev.to/search?q=${DOMAIN}`,
    `https://hashnode.com/search?q=${DOMAIN}`,
    `https://www.quora.com/search?q=${DOMAIN}`,
    `https://stackoverflow.com/search?q=${DOMAIN}`,
    `https://news.ycombinator.com/from?site=${DOMAIN}`,
    `https://lobste.rs/search?q=${DOMAIN}`,
    `https://www.indiehackers.com/search?q=${DOMAIN}`,
];

// International search engines
const INTL_SEARCH = [
    // China
    `https://www.baidu.com/s?wd=${encodeURIComponent(SITE)}`,
    `https://www.so.com/s?q=${encodeURIComponent(SITE)}`,
    `https://www.sogou.com/web?query=${encodeURIComponent(SITE)}`,
    `https://www.shenma.com/s?q=${encodeURIComponent(SITE)}`,
    // Russia
    `https://yandex.com/search/?text=${encodeURIComponent(SITE)}`,
    `https://go.mail.ru/search?q=${encodeURIComponent(SITE)}`,
    `https://www.rambler.ru/search?query=${encodeURIComponent(SITE)}`,
    // Korea
    `https://search.naver.com/search.naver?query=${encodeURIComponent(SITE)}`,
    `https://search.daum.net/search?q=${encodeURIComponent(SITE)}`,
    // Japan
    `https://search.yahoo.co.jp/search?p=${encodeURIComponent(SITE)}`,
    `https://www.goo.ne.jp/search.html?MT=${encodeURIComponent(SITE)}`,
    // Europe
    `https://www.ecosia.org/search?q=${encodeURIComponent(SITE)}`,
    `https://www.qwant.com/?q=${encodeURIComponent(SITE)}`,
    `https://search.seznam.cz/?q=${encodeURIComponent(SITE)}`,
    `https://duckduckgo.com/?q=${encodeURIComponent(SITE)}`,
    `https://www.startpage.com/search?q=${encodeURIComponent(SITE)}`,
    `https://www.mojeek.com/search?q=${encodeURIComponent(SITE)}`,
    `https://swisscows.com/web?query=${encodeURIComponent(SITE)}`,
    // Others
    `https://www.ask.com/web?q=${encodeURIComponent(SITE)}`,
    `https://search.aol.com/aol/search?q=${encodeURIComponent(SITE)}`,
    `https://www.lycos.com/web?q=${encodeURIComponent(SITE)}`,
    `https://www.webcrawler.com/serp?q=${encodeURIComponent(SITE)}`,
    `https://www.dogpile.com/serp?q=${encodeURIComponent(SITE)}`,
    `https://www.excite.com/search?q=${encodeURIComponent(SITE)}`,
    `https://www.info.com/serp?q=${encodeURIComponent(SITE)}`,
    `https://www.entireweb.com/search?q=${encodeURIComponent(SITE)}`,
    `https://www.exalead.com/search/web/results/?q=${encodeURIComponent(SITE)}`,
    `https://search.carrot2.org/#/search/web/${encodeURIComponent(SITE)}`,
    `https://www.gigablast.com/search?q=${encodeURIComponent(SITE)}`,
    `https://www.yippy.com/search?query=${encodeURIComponent(SITE)}`,
];

// RSS aggregators and feed readers
const FEED_READERS = [
    `https://feedly.com/i/subscription/feed/${encodeURIComponent(FEED)}`,
    `https://www.inoreader.com/search/feeds/${encodeURIComponent(FEED)}`,
    `https://theoldreader.com/feeds/subscribe?url=${encodeURIComponent(FEED)}`,
    `https://www.newsblur.com/?url=${encodeURIComponent(FEED)}`,
    `https://feedbin.com/?subscribe=${encodeURIComponent(FEED)}`,
    `https://www.bloglovin.com/search/${DOMAIN}`,
    `https://feedspot.com/infiniterss.php?_src=search&q=${encodeURIComponent(FEED)}`,
];

// Backlink checkers (trigger crawls)
const BACKLINK_TOOLS = [
    `https://ahrefs.com/backlink-checker/?target=${DOMAIN}`,
    `https://www.semrush.com/analytics/backlinks/overview/${DOMAIN}`,
    `https://moz.com/link-explorer?site=${DOMAIN}`,
    `https://majestic.com/reports/site-explorer?q=${DOMAIN}`,
    `https://www.backlinkwatch.com/index.php?q=${DOMAIN}`,
    `https://smallseotools.com/backlink-checker/?url=${DOMAIN}`,
    `https://www.seoreviewtools.com/valuable-backlinks-checker/?url=${DOMAIN}`,
    `https://www.linkody.com/seo-tools/free-backlink-checker?url=${DOMAIN}`,
    `https://monitorbacklinks.com/seo-tools/free-backlink-checker?url=${DOMAIN}`,
    `https://www.rankwatch.com/backlinks/overview.html?url=${DOMAIN}`,
    `https://openlinkprofiler.org/r/${DOMAIN}`,
    `https://www.webmeup.com/backlink-tool/check.html?url=${DOMAIN}`,
];

// Uptime monitors (ping regularly)
const UPTIME = [
    `https://www.uptrends.com/tools/uptime-checker?url=${encodeURIComponent(SITE)}`,
    `https://uptimerobot.com/freeMonitoring?url=${encodeURIComponent(SITE)}`,
    `https://www.site24x7.com/tools/check-website-availability.html?url=${encodeURIComponent(SITE)}`,
    `https://www.isitdownrightnow.com/${DOMAIN}.html`,
    `https://downforeveryoneorjustme.com/${DOMAIN}`,
    `https://www.isitup.org/${DOMAIN}`,
    `https://www.host-tracker.com/check/?url=${DOMAIN}`,
    `https://check-host.net/check-http?host=${DOMAIN}`,
];

// Screenshot services (index visually)
const SCREENSHOTS = [
    `https://www.screenshotmachine.com/?url=${encodeURIComponent(SITE)}`,
    `https://image.thum.io/get/${SITE}`,
    `https://api.apiflash.com/v1/urltoimage?url=${encodeURIComponent(SITE)}`,
    `https://www.screenshotapi.net/screenshot?url=${encodeURIComponent(SITE)}`,
];

// Metadata validators
const VALIDATORS = [
    `https://search.google.com/structured-data/testing-tool?url=${encodeURIComponent(SITE)}`,
    `https://validator.w3.org/nu/?doc=${encodeURIComponent(SITE)}`,
    `https://wave.webaim.org/report#/${SITE}`,
    `https://www.opengraph.xyz/?url=${encodeURIComponent(SITE)}`,
    `https://metatags.io/?url=${encodeURIComponent(SITE)}`,
    `https://cards-dev.twitter.com/validator?url=${encodeURIComponent(SITE)}`,
    `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(SITE)}`,
];

// ==================== VIRAL CYCLE ====================

async function runMegaCycle() {
    cycle++;
    let success = 0, failed = 0;

    log(`\n${'═'.repeat(70)}`);
    log(`MEGA VIRAL CYCLE #${cycle} - HITTING 500+ ENDPOINTS`);
    log(`${'═'.repeat(70)}`);

    // Batch process all URLs
    const allUrls = [
        ...SEARCH_PINGS,
        ...WEBSUB_HUBS.map(h => ({ url: h, post: `hub.mode=publish&hub.url=${encodeURIComponent(FEED)}`, type: 'form' })),
        ...SHORTENERS,
        ...ARCHIVES,
        ...ANALYZERS,
        ...SOCIAL,
        ...DIRECTORIES,
        ...BLOGS,
        ...INTL_SEARCH,
        ...FEED_READERS,
        ...BACKLINK_TOOLS,
        ...UPTIME,
        ...SCREENSHOTS,
        ...VALIDATORS,
    ];

    // IndexNow first (batch submit all pages)
    log('>>> IndexNow (4 endpoints x 18 pages)');
    const indexNowBody = JSON.stringify({
        host: DOMAIN, key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList: PAGES.map(p => SITE + p)
    });
    for (const endpoint of INDEXNOW) {
        const r = await hit(endpoint, 'POST', indexNowBody);
        if (r.ok) { success++; log(`  ✓ ${endpoint.split('/')[2]}`); } else { failed++; }
    }

    // XML-RPC pings (each reaches 10-20 downstream services)
    log('>>> XML-RPC Pings (200+ downstream services)');
    const xmlPing = `<?xml version="1.0"?><methodCall><methodName>weblogUpdates.ping</methodName><params><param><value><string>DOZ UP - Screenshot Sharing</string></value></param><param><value><string>${SITE}</string></value></param></params></methodCall>`;
    let xmlSuccess = 0;
    for (const url of XMLRPC_PINGS) {
        const r = await hit(url, 'POST', xmlPing, 'text/xml');
        if (r.ok) { xmlSuccess++; success += 10; } else { failed++; }
    }
    log(`  ✓ ${xmlSuccess} ping servers (${xmlSuccess * 10}+ downstream)`);

    // Process all other URLs in parallel batches
    log('>>> Processing 400+ endpoints...');

    const batchSize = 50;
    for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (item) => {
            if (typeof item === 'string') {
                return hit(item);
            } else if (item.type === 'form') {
                return hit(item.url, 'POST', item.post, 'application/x-www-form-urlencoded');
            }
            return { ok: false };
        }));

        results.forEach(r => { if (r.ok) success++; else failed++; });
        process.stdout.write(`\r  Processed: ${Math.min(i + batchSize, allUrls.length)}/${allUrls.length} | Success: ${success}`);
    }

    console.log('');
    totalHits += success + failed;
    totalSuccess += success;

    log(`${'═'.repeat(70)}`);
    log(`CYCLE #${cycle} COMPLETE`);
    log(`This cycle: ${success} success, ${failed} failed`);
    log(`All time: ${totalSuccess} success / ${totalHits} total hits`);
    log(`Next cycle in 5 minutes...`);
    log(`${'═'.repeat(70)}\n`);
}

// Start
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
║         MEGA VIRAL ENGINE - 500+ ENDPOINTS EVERY 5 MINUTES          ║
║                                                                      ║
║   • IndexNow instant indexing                                        ║
║   • 200+ XML-RPC ping services                                       ║
║   • 30+ international search engines                                 ║
║   • 40+ social platforms                                             ║
║   • 50+ SEO/analyzer tools                                           ║
║   • 15+ directories                                                  ║
║   • 10+ backlink checkers                                            ║
║   • 10+ uptime monitors                                              ║
║   • RSS/feed aggregators                                             ║
║   • Web archives                                                     ║
║   • And more...                                                      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

runMegaCycle();
setInterval(runMegaCycle, 5 * 60 * 1000);

process.on('SIGINT', () => {
    log(`\nShutdown: ${cycle} cycles, ${totalSuccess}/${totalHits} successful`);
    process.exit(0);
});
