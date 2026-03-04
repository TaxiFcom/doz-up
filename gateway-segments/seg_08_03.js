        return;
    }
    const now = Date.now();
    const pending = spaceshipRetryQueue.filter(item => now >= item.nextRetry);
    for (const item of pending) {
        try {
            const exists = fs.existsSync(item.filePath);
            if (!exists) {
                const idx = spaceshipRetryQueue.indexOf(item);
                if (idx !== -1) spaceshipRetryQueue.splice(idx, 1);
                continue;
            }
            const fileBuffer = await fs.promises.readFile(item.filePath);
            const encryptedBuffer = encryptFile(fileBuffer);
            await uploadToSpaceship(item.filename + '.enc', encryptedBuffer);
            console.log(`[Spaceship-Retry] Replicated ${item.filename} (attempt ${item.attempts + 1})`);
            const idx = spaceshipRetryQueue.indexOf(item);
            if (idx !== -1) spaceshipRetryQueue.splice(idx, 1);
            spaceshipConsecutiveFailures = 0; // Reset on success
        } catch (err) {
            spaceshipConsecutiveFailures++;
            item.attempts++;
            if (item.attempts >= 3) {
                console.error(`[Spaceship-Retry] Giving up on ${item.filename} after 3 attempts`);
                const idx = spaceshipRetryQueue.indexOf(item);
                if (idx !== -1) spaceshipRetryQueue.splice(idx, 1);
            } else {
                item.nextRetry = Date.now() + 60000 * Math.pow(2, item.attempts);
            }
        }
    }
}, 120000); // Check retry queue every 2 minutes (was 15s)

// Download and decrypt file from Spaceship via FTP
async function downloadFromSpaceship(filename) {
    const client = new ftp.Client();
    try {
        await client.access({
            host: SPACESHIP_FTP.host,
            port: SPACESHIP_FTP.port,
            user: SPACESHIP_FTP.user,
            password: SPACESHIP_FTP.password,
            secure: false
        });

        const remotePath = `${SPACESHIP_FTP.basePath}/${filename}`;
        const tmpPath = path.join(uploadsDir, '.spaceship-dl-' + Date.now());
        await client.downloadTo(tmpPath, remotePath);
        client.close();

        const encryptedBuffer = fs.readFileSync(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch (e) {}
        return decryptFile(encryptedBuffer);
    } catch (err) {
        client.close();
        throw err;
    }
}

// Database for Spaceship files (maps public ID to encrypted filename)
const spaceshipFilesPath = path.join(dataDir, 'spaceship-files.json');

function loadSpaceshipDb() {
    try {
        if (fs.existsSync(spaceshipFilesPath)) {
            return JSON.parse(fs.readFileSync(spaceshipFilesPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading spaceship db:', e.message);
    }
    return { files: {} };
}

function saveSpaceshipDb(db) {
    fs.writeFileSync(spaceshipFilesPath, JSON.stringify(db));
}

// Encrypted upload endpoint - uploads to Spaceship FTP
app.post('/upload-secure', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const deviceId = req.headers['x-device-id'] || req.body?.deviceId || 'web';
        const fileBuffer = fs.readFileSync(req.file.path);

        // Generate unique ID and encrypted filename
        const fileId = uuidv4();
        const ext = path.extname(req.file.originalname) || '.png';
        const encryptedFilename = `${fileId}${ext}.enc`;

        // Encrypt and upload to Spaceship
        const encryptedBuffer = encryptFile(fileBuffer);
        await uploadToSpaceship(encryptedFilename, encryptedBuffer);

        // Delete local temp file
        fs.unlinkSync(req.file.path);

        // Save mapping in database
        const db = loadSpaceshipDb();
        db.files[fileId] = {
            encryptedFilename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            deviceId,
            uploadedAt: Date.now()
        };
        saveSpaceshipDb(db);

        // Return public URL (served through our server)
        const publicUrl = `https://${HOST}/files/${fileId}${ext}`;

        console.log(`[Secure Upload] File ${fileId} encrypted and uploaded to Spaceship`);

        res.json({
            success: true,
            url: publicUrl,
            id: fileId,
            filename: `${fileId}${ext}`
        });
    } catch (err) {
        console.error('[Secure Upload] Error:', err.message);
        // Clean up temp file on error
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Upload failed', message: err.message });
    }
});

// Serve encrypted files from Spaceship (decrypt on-the-fly)
app.get('/files/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const fileId = filename.replace(/\.[^.]+$/, ''); // Remove extension

        const db = loadSpaceshipDb();
        const fileInfo = db.files[fileId];

        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Download and decrypt from Spaceship
        const decryptedBuffer = await downloadFromSpaceship(fileInfo.encryptedFilename);

        // Set content type and serve
        res.set('Content-Type', fileInfo.mimeType || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${fileInfo.originalName}"`);
        res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.send(decryptedBuffer);
    } catch (err) {
        console.error('[File Serve] Error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve file' });
    }
});

// API to list user's Spaceship files
app.get('/api/files', (req, res) => {
    const deviceId = req.headers['x-device-id'] || req.query.deviceId;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    const db = loadSpaceshipDb();
    const userFiles = Object.entries(db.files)
        .filter(([_, file]) => file.deviceId === deviceId)
        .map(([id, file]) => ({
            id,
            url: `https://${HOST}/files/${id}${path.extname(file.originalName) || '.png'}`,
            originalName: file.originalName,
            size: file.size,
            uploadedAt: file.uploadedAt
        }))
        .sort((a, b) => b.uploadedAt - a.uploadedAt);

    res.json({
        success: true,
        files: userFiles,
        count: userFiles.length
    });
});

// Favicon fallback - redirect to logo.png
app.get('/favicon.ico', (req, res) => {
    res.redirect('/logo.png');
});

// ============ SPEDX.STORE DOMAIN ROUTING ============
const SPEDX_DIR = 'C:/var/www/html/spedx';

// Serve spedx.store from dedicated directory
app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.includes('spedx.store')) {
        // Handle root path
        if (req.path === '/') {
            return res.sendFile(path.join(SPEDX_DIR, 'index.html'));
        }

        // Try exact path first
        let filePath = path.join(SPEDX_DIR, req.path);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return res.sendFile(filePath);
        }

        // Try with .html extension
        filePath = path.join(SPEDX_DIR, req.path + '.html');
        if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
        }

        // Fallback to index.html for SPA routing
        return res.sendFile(path.join(SPEDX_DIR, 'index.html'));
    }
    next();
});

// ============ DOZ UP PLATFORM ROUTES (/up) ============
// Platform accessible at /up path to allow other developments at root
app.get('/up', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/up/my', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cabinet.html'));
});

app.get('/up/my-account', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'my-account.html'));
});

app.get('/up/changelog', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'changelog.html'));
});

app.get('/up/payment/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'success.html'));
});

app.get('/up/payment/cancel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment', 'cancel.html'));
});

// Static files for /up path (CSS, JS, images)
// ============ DOZAI STATIC FILES ============
// Serve DOZ AI CLI deployed projects
app.use("/DOZAI", express.static(path.join(__dirname, "public/DOZAI"), {
    index: ["index.html", "index.htm"],
    extensions: ["html", "htm"],
    dotfiles: "ignore"
}));

app.use('/up', express.static(path.join(__dirname, 'public')));

// ============ ROOT REDIRECT ============
// Redirect root to /up platform (but serve index.html directly on up.doz.com)
app.get('/', (req, res) => {
    const host = req.headers.host || '';
    // On up.doz.com, serve the main page directly (avoid redirect loop)
    if (host.includes('up.doz.com')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    res.redirect(301, '/up');
});

// ============ AI EXPRESS ERROR HANDLER ============
// Catch all Express route errors and feed to AI interceptor for auto-fix
app.use((err, req, res, next) => {
    aiErrorInterceptor.handleError({
        message: err.message,
        source: 'express-route',
        stack: err.stack,
        context: { method: req.method, path: req.path, statusCode: err.status || 500 },
    });

    if (!res.headersSent) {
        res.status(err.status || 500).json({
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        });
    }
});

// Mobile app: serve with aggressive no-cache + version header for live updates
app.get('/mobile.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-DOZ-Version', APK_VERSION);
    res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// Service worker: always fresh (browsers check sw.js on every navigation)
app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Serve image uploader frontend (with optimized caching)
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// ============ CENTRAL ERROR HANDLER (must be after all routes) ============
app.use(centralErrorHandler);

// HTTP server on port 80 (for Cloudflare Flexible or direct access)
// Skip if nginx is handling port 80 (NGINX_PROXY=true or port conflict)
const NGINX_PROXY = process.env.NGINX_PROXY === 'true' || process.env.SKIP_PORT_80 === 'true';
let httpServer80 = null;

if (!NGINX_PROXY) {
    httpServer80 = http.createServer(app);
    httpServer80.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log('[Port 80] Already in use (nginx handles it), continuing without direct binding');
            // Don't crash - nginx is handling this port
        } else {
            console.error('[Port 80] Server error:', err.message);
        }
    });
    // Use setImmediate to ensure error handler is fully registered before listen
    setImmediate(() => {
        httpServer80.listen(80, '0.0.0.0', () => {
            console.log(`HTTP server running at https://${HOST}:80`);
        });
    });
} else {
    console.log('[Port 80] Skipping - nginx is configured as reverse proxy');
}

// Also attach WebSocket routing to port 80 (only if httpServer80 is active)
if (httpServer80) {
    httpServer80.on('upgrade', (req, socket, head) => {
        const pathname = req.url.split('?')[0];
        const wsRoutes80 = {
            '/ws/live': wss,
            '/ws/admin': adminWss,
            '/ws/monitor': monitorWss,
            '/ws/viral': viralWss,
            '/ws/analytics': analyticsWss,
            '/ws/support': supportWss,
            '/ws/agents': agentsWss
        };
        const target = wsRoutes80[pathname];
        if (target) {
            target.handleUpgrade(req, socket, head, (ws) => {
                target.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });
}

let serverRetries = 0;
function startMainServer() {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Gateway v${APP_VERSION} running at https://${HOST}:${PORT}`);
        console.log(`Image uploader at https://${HOST}/`);
        console.log(`ConnectHub at https://${HOST}/7G/`);
        console.log(`WebSocket live tracking at wss://${HOST}/ws/live`);
        console.log(`WebSocket real-time analytics at wss://${HOST}/ws/analytics`);
        console.log(`Admin notification WebSocket at wss://${HOST}/ws/admin`);
        console.log(`Real-Time Analytics Dashboard at https://${HOST}/admin/analytics.html`);
        console.log(`V2 Subscription at https://${HOST}/v2`);
        console.log(`V2 Admin Panel at https://${HOST}/v2/admin`);
        console.log(`Admin API: Username: admin, Password: ${process.env.ADMIN_PASSWORD ? '***' + process.env.ADMIN_PASSWORD.slice(-3) : 'NOT SET (check .env)'}`);

        // ============ START AI OPERATIONS CENTER ============
        setTimeout(() => {
            try {
                aiOpsCenter.start();

                // Broadcast AI events to admin WebSocket
                aiOpsCenter.on('health:check', (data) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'health', data });
                });
                aiOpsCenter.on('performance:issues', (issues) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'performance', issues });
                });
                aiOpsCenter.on('security:alert', (alerts) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'security', alerts, priority: 'high' });
                });
                aiOpsCenter.on('quality:issues', (issues) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'quality', issues });
                });
                aiOpsCenter.on('report:generated', (report) => {
                    broadcastToAdmins({ type: 'ai_ops', department: 'report', report });
                });

                console.log('[AI-Ops] Connected to admin WebSocket for real-time updates');
            } catch (e) {
                console.log('[AI-Ops] Init error:', e.message);
            }
        }, 5000);
    });
}

// Broadcast to all admin WebSocket clients
function broadcastToAdmins(message) {
    if (typeof adminWss !== 'undefined' && adminWss.clients) {
        const data = JSON.stringify(message);
        adminWss.clients.forEach(client => {
            if (client.readyState === 1) {
                try { client.send(data); } catch (e) {}
            }
        });
    }
}
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        serverRetries++;
        if (serverRetries <= 5) {
            console.log(`[Port ${PORT}] In use, retrying in ${serverRetries * 2}s (attempt ${serverRetries}/5)...`);
            setTimeout(() => startMainServer(), serverRetries * 2000);
        } else {
            console.error(`[FATAL] Port ${PORT} still in use after 5 retries — exiting`);
            process.exit(1);
        }
    } else {
        console.error(`[Port ${PORT}] Server error:`, err.message);
    }
});
startMainServer();

// Central WebSocket upgrade router (ws@8.x abortHandshake bug: multiple WSS on same server kill each other)
server.on('upgrade', (req, socket, head) => {
    // Proxy WebSocket upgrades for rdp.doz.com to Kasm
    const wsHost = (req.headers.host || "").toLowerCase();
    if (wsHost.includes("rdp.doz.com")) {
        const tls = require("tls");
        const proxySocket = tls.connect({ host: "127.0.0.1", port: 8443, rejectUnauthorized: false }, () => {
            let rawHeaders = "GET " + (req.url || "/") + " HTTP/1.1\r\n";
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
                rawHeaders += req.rawHeaders[i] + ": " + req.rawHeaders[i + 1] + "\r\n";
            }
            rawHeaders += "\r\n";
            proxySocket.write(rawHeaders);
            if (head && head.length) proxySocket.write(head);
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });
        proxySocket.on("error", () => socket.destroy());
        socket.on("error", () => proxySocket.destroy());
        return;
    }
    const pathname = req.url.split('?')[0];
    const wsRoutes = {
        '/ws/live': wss,
        '/ws/admin': adminWss,
        '/ws/monitor': monitorWss,
        '/ws/viral': viralWss,
        '/ws/analytics': analyticsWss,
        '/ws/support': supportWss,
        '/ws/agents': agentsWss,
        '/terminal/ssh': sshRelay.wss
    };
    const target = wsRoutes[pathname];
    if (target) {
        target.handleUpgrade(req, socket, head, (ws) => {
            target.emit('connection', ws, req);
        });
    } else {
        socket.destroy();
    }
});

// Start HTTPS server for Cloudflare Full SSL
// Skip if nginx is handling port 443 (NGINX_PROXY=true)
if (httpsServer && !NGINX_PROXY) {
    // Central WebSocket upgrade router for HTTPS server
    httpsServer.on('upgrade', (req, socket, head) => {
        // Proxy WebSocket upgrades for rdp.doz.com to Kasm
        const wsHostHttps = (req.headers.host || "").toLowerCase();
        if (wsHostHttps.includes("rdp.doz.com")) {
            const tls = require("tls");
            const proxySocket = tls.connect({ host: "127.0.0.1", port: 8443, rejectUnauthorized: false }, () => {
                let rawHeaders = "GET " + (req.url || "/") + " HTTP/1.1\r\n";
                for (let i = 0; i < req.rawHeaders.length; i += 2) {
                    rawHeaders += req.rawHeaders[i] + ": " + req.rawHeaders[i + 1] + "\r\n";
                }
                rawHeaders += "\r\n";
                proxySocket.write(rawHeaders);
                if (head && head.length) proxySocket.write(head);
                proxySocket.pipe(socket);
                socket.pipe(proxySocket);
            });
            proxySocket.on("error", () => socket.destroy());
            socket.on("error", () => proxySocket.destroy());
            return;
        }
