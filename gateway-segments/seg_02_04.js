            return uploadsDbCache;
        }
    } catch (e) {}
    uploadsDbCache = { uploads: [], devices: {} };
    return uploadsDbCache;
}

// Save uploads database to cache (instant), flush to disk async
function saveUploadsDb(db) {
    uploadsDbCache = db;
    uploadsDbDirty = true;
}

// Flush uploads DB to disk every 2 seconds if dirty
setInterval(() => {
    if (uploadsDbDirty && uploadsDbCache) {
        fs.writeFile(uploadsDbPath, JSON.stringify(uploadsDbCache), (err) => {
            if (err) console.error('[DB] Uploads flush error:', err.message);
        });
        uploadsDbDirty = false;
    }
}, 5000); // was 2s, reduced frequency for performance

// Auto-cleanup expired images (runs every 10 minutes)
function cleanupExpiredImages() {
    const now = Date.now();
    const db = loadUploadsDb();
    let deletedCount = 0;

    const expiredUploads = db.uploads.filter(u => {
        const expiresAt = u.expiresAt || (u.timestamp + IMAGE_LIFETIME_MS);
        return now >= expiresAt;
    });

    for (const upload of expiredUploads) {
        // Delete file
        const filePath = path.join(uploadsDir, upload.filename);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            deletedCount++;
        } catch (e) {
            console.error(`Failed to delete ${upload.filename}:`, e.message);
        }

        // Update device count
        if (db.devices[upload.deviceId]) {
            db.devices[upload.deviceId].uploadCount = Math.max(0, db.devices[upload.deviceId].uploadCount - 1);
        }
    }

    // Remove expired from database
    db.uploads = db.uploads.filter(u => {
        const expiresAt = u.expiresAt || (u.timestamp + IMAGE_LIFETIME_MS);
        return now < expiresAt;
    });

    if (deletedCount > 0) {
        saveUploadsDb(db);
        console.log(`[Cleanup] Deleted ${deletedCount} expired images`);
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredImages, 10 * 60 * 1000);

// Run cleanup on startup
setTimeout(cleanupExpiredImages, 5000);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        cb(null, uuidv4() + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max - was 1GB (DoS risk)
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|bmp/;
        const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mime = allowedTypes.test(file.mimetype);
        cb(null, ext || mime ? true : false);
    }
});

// Proxy /7G/* to ConnectHub
app.use('/7G', createProxyMiddleware({
    target: `https://${HOST}:${CONNECTHUB_PORT}`,
    changeOrigin: true,
    pathRewrite: { '^/7G': '/7G' },
    ws: true
}));

// Handle root-level UUID URLs - redirect to /i/ handler
// This catches URLs like /f983f950-6ee1-4a7b-a373-ad2f865f9551 and redirects to /i/f983f950-...
app.get('/:uuid([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', (req, res) => {
    const queryString = Object.keys(req.query).length > 0
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    res.redirect(301, `/i/${req.params.uuid}${queryString}`);
});

// Handle /up/i/ URLs - redirect to /i/ handler
app.get('/up/i/:filename', (req, res) => {
    // Preserve query parameters
    const queryString = Object.keys(req.query).length > 0
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    res.redirect(301, `/i/${req.params.filename}${queryString}`);
});

// Smart Image Sharing - Rich previews + Viral sharing page (ASYNC for performance)
app.get('/i/:filename', async (req, res) => {
    const filename = req.params.filename;
    const ref = req.query.ref || 'direct';
    const userAgent = req.headers['user-agent'] || '';

    // Redirect .png/.jpg URLs to extensionless URLs for share page views
    // Cloudflare auto-caches URLs with image extensions, causing share pages to be
    // served as raw images. Extensionless URLs bypass Cloudflare's default caching.
    if (req.query.raw !== '1') {
        const extMatch = filename.match(/\.(png|jpg|jpeg|gif|webp)$/i);
        if (extMatch) {
            const baseName = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
            const queryString = Object.keys(req.query).length > 0
                ? '?' + new URLSearchParams(req.query).toString()
                : '';
            return res.redirect(302, `/i/${baseName}${queryString}`);
        }
    }

    // Get file info from cache (async, non-blocking)
    const fileInfo = await getFileInfo(filename);

    // Check if file exists
    if (!fileInfo.exists) {
        // Return a styled 404 page
        return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Not Found - DOZ UP</title>
    <link rel="icon" href="/favicon.ico">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            max-width: 500px;
        }
        .icon {
            font-size: 80px;
            margin-bottom: 24px;
            opacity: 0.8;
        }
        h1 {
            font-size: 28px;
            margin-bottom: 12px;
            color: #fff;
        }
        p {
            color: rgba(255,255,255,0.6);
            margin-bottom: 32px;
            line-height: 1.6;
        }
        .reasons {
            text-align: left;
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 32px;
        }
        .reasons h3 {
            font-size: 14px;
            color: rgba(255,255,255,0.5);
            margin-bottom: 12px;
        }
        .reasons ul {
            list-style: none;
            color: rgba(255,255,255,0.7);
            font-size: 14px;
        }
        .reasons li {
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .reasons li:last-child { border-bottom: none; }
        .reasons li::before {
            content: '\u2022';
            color: #4CAF50;
            margin-right: 10px;
        }
        .btn {
            display: inline-block;
            padding: 14px 32px;
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: #fff;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            transition: all 0.3s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(76, 175, 80, 0.3);
        }
        .home-link {
            display: block;
            margin-top: 20px;
            color: rgba(255,255,255,0.5);
            text-decoration: none;
            font-size: 14px;
        }
        .home-link:hover { color: #fff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">&#x1F4F7;</div>
        <h1>Image Not Found</h1>
        <p>The image you're looking for isn't available. It may have been removed or the link might be incorrect.</p>
        <div class="reasons">
            <h3>This could happen because:</h3>
            <ul>
                <li>The image has expired (free tier: 30 days)</li>
                <li>The uploader deleted the image</li>
                <li>The link was mistyped or corrupted</li>
                <li>The image was never uploaded</li>
            </ul>
        </div>
        <a href="/up" class="btn">Upload a New Image</a>
        <a href="/up" class="home-link">&#x2190; Back to DOZ UP</a>
    </div>
</body>
</html>`);
    }

    // Get file info from cache (already fetched above)
    const filePath = fileInfo.path;
    const fileSizeKB = fileInfo.sizeKB;
    const imageUrl = `https://${SHARE_HOST}/${filename}`;
    const rawImageUrl = `https://${SHARE_HOST}/${filename}?raw=1`;

    // Serve raw image only via explicit ?raw=1 parameter
    // Never auto-detect via Sec-Fetch-Dest - Cloudflare caches by URL, not headers,
    // so content negotiation causes the raw image to be cached over the share page
    if (req.query.raw === '1') {
        res.set('Cache-Control', 'public, max-age=2592000, immutable');
        return res.sendFile(filePath);
    }

    // All other requests get the share page HTML
    // Cloudflare auto-caches URLs ending in .png/.jpg etc - must explicitly tell it not to
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('CDN-Cache-Control', 'no-store');
    res.set('Cloudflare-CDN-Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');

    // Track share source (only for share page views, not image loads)
    trackShareView(filename, ref, userAgent);

    // Detect social media crawlers for Open Graph previews
    const crawlers = [
        'WhatsApp', 'facebookexternalhit', 'Facebot', 'Twitterbot',
        'TelegramBot', 'LinkedInBot', 'Slackbot', 'Discord', 'vkShare',
        'Viber', 'SkypeUriPreview', 'Pinterest'
    ];
    const isCrawler = crawlers.some(c => userAgent.includes(c));

    if (isCrawler) {
        // Serve Open Graph meta tags for rich preview
        return res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta property="og:title" content="Check out this image on DOZ">
    <meta property="og:description" content="Shared via DOZ - The fastest way to share screenshots and images">
    <meta property="og:image" content="${rawImageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:url" content="${imageUrl}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="DOZ">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Check out this image on DOZ">
    <meta name="twitter:description" content="Shared via DOZ - The fastest way to share screenshots">
    <meta name="twitter:image" content="${rawImageUrl}">
    <link rel="icon" href="https://${SHARE_HOST}/favicon.ico">
</head>
<body>
    <script>window.location.href="${imageUrl}";</script>
</body>
</html>`);
    }

    // Serve viral share page for browsers (with output cache)
    const cacheKey = `${filename}|${ref || ''}`;
    const cachedPage = sharePageCache.get(cacheKey);
    if (cachedPage && Date.now() - cachedPage.ts < SHARE_CACHE_TTL) {
        return res.send(cachedPage.html);
    }
    const html = generateSharePage(filename, imageUrl, rawImageUrl, fileSizeKB, ref);
    sharePageCache.set(cacheKey, { html, ts: Date.now() });
    if (sharePageCache.size > SHARE_CACHE_MAX) {
        const firstKey = sharePageCache.keys().next().value;
        sharePageCache.delete(firstKey);
    }
    res.send(html);
});

// Load share views data
function loadShareViews() {
    try {
        const sharesPath = path.join(__dirname, 'data', 'shares.json');
        if (fs.existsSync(sharesPath)) {
            return JSON.parse(fs.readFileSync(sharesPath, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Track share views - ASYNC non-blocking (fire-and-forget for performance)
function trackShareView(filename, source, userAgent) {
    // Fire and forget - don't block the response
    setImmediate(async () => {
        try {
            const sharesPath = path.join(__dirname, 'data', 'shares.json');
            // IMPORTANT: Normalize key by stripping extension to prevent duplicates
            const normalizedKey = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');

            let shares = {};
            try {
                const data = await fs.promises.readFile(sharesPath, 'utf8');
                shares = JSON.parse(data);
            } catch (e) {
                // File doesn't exist yet, start fresh
            }

            if (!shares[normalizedKey]) {
                shares[normalizedKey] = { views: 0, sources: {}, firstView: Date.now() };
            }

            shares[normalizedKey].views++;
            shares[normalizedKey].lastView = Date.now();
            shares[normalizedKey].sources[source] = (shares[normalizedKey].sources[source] || 0) + 1;

            await fs.promises.writeFile(sharesPath, JSON.stringify(shares));

            // Track for live monitor
            if (global.trackMonitorActivity) {
                global.trackMonitorActivity('share', {
                    description: 'Share link viewed',
                    page: source || 'direct'
                });
            }
        } catch (e) {
            console.log('[Share Tracking] Error:', e.message);
        }
    });
}

// Generate viral share page
// Share page output cache (avoids regenerating 55KB template on every request)
const sharePageCache = new Map();
const SHARE_CACHE_TTL = 300000; // 5 minutes
const SHARE_CACHE_MAX = 200;

function generateSharePage(filename, imageUrl, rawImageUrl, fileSizeKB, ref) {
    const shareText = encodeURIComponent(`Check this out! &#x1F440;`);
    const shareUrl = encodeURIComponent(imageUrl);
    const inviteText = encodeURIComponent(`I'm using DOZ to share screenshots instantly - try it free! &#x1F680;`);
    const inviteUrl = encodeURIComponent(`https://${SHARE_HOST}/download?ref=invite`);
    const downloadPageUrl = `https://${SHARE_HOST}/download?ref=share_page`;
    const emailSubject = encodeURIComponent('Check out this image!');
    const emailBody = encodeURIComponent(`I wanted to share this with you:\n\n${imageUrl}?ref=email\n\nShared via DOZ - The fastest way to share screenshots`);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
    <title>Shared Image - DOZ</title>
    <meta property="og:title" content="Check out this image on DOZ">
    <meta property="og:description" content="Shared via DOZ - The fastest way to share screenshots and images">
    <meta property="og:image" content="${rawImageUrl}">
    <meta property="og:url" content="${imageUrl}">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${rawImageUrl}">
    <link rel="icon" href="https://${SHARE_HOST}/favicon.ico">

    <!-- Google tag (gtag.js) - Google Ads -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-441083115"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'AW-441083115');
    </script>

    <!-- Meta Pixel for conversion tracking -->
    <script>
        window.META_PIXEL_ID = '${process.env.META_PIXEL_ID || ''}';
    </script>
    <script src="/js/meta-pixel.js"></script>
    <script>
        // Fire ViewContent event for Meta to track share page views
        document.addEventListener('DOMContentLoaded', function() {
            if (window.DOZPixel && window.META_PIXEL_ID) {
                DOZPixel.trackViewContent('Share View', 'SharePage', 0, 'USD');
                DOZPixel.trackCustomEvent('SharePageView', {
                    share_id: '${filename}',
                    referrer: '${ref}',
                    content_type: 'image'
                });
            }
        });
    </script>

    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
            min-height: 100vh;
            color: #fff;
            display: flex;
            flex-direction: column;
        }
        .container {
            flex: 1;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 0 20px;
        }
        .logo {
            font-size: 1.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, #7c3aed, #10b981);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            cursor: pointer;
            text-decoration: none;
        }
        .try-btn {
            background: linear-gradient(135deg, #7c3aed, #6366f1);
            border: none;
            color: #fff;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            font-size: 0.9rem;
            transition: transform 0.2s, box-shadow 0.2s;
            animation: pulse 2s 3;
            -webkit-tap-highlight-color: rgba(255,255,255,0.2);
            touch-action: manipulation;
            will-change: transform;
        }
        @keyframes pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4); }
            50% { box-shadow: 0 0 0 10px rgba(124, 58, 237, 0); }
        }
        .try-btn:hover {
            transform: scale(1.05);
            box-shadow: 0 10px 30px rgba(124, 58, 237, 0.4);
            animation: none;
        }
        .image-container {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            overflow: hidden;
            margin-bottom: 20px;
            position: relative;
