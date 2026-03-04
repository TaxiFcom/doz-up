                <button class="pairing-tab active" onclick="switchPairingTab('generate')">Generate Code</button>
                <button class="pairing-tab" onclick="switchPairingTab('enter')">Enter Code</button>
            </div>

            <!-- Generate Code Tab -->
            <div id="generateCodeTab" class="pairing-tab-content active">
                <div class="pairing-code-display" onclick="copyPairingCode()">
                    <div class="pairing-code" id="pairingCode">----</div>
                    <div class="pairing-code-hint">Click to copy</div>
                </div>
                <div class="pairing-timer" id="pairingTimer">Code expires in 5:00</div>
                <p style="font-size: 0.85rem; color: #64748b;">Enter this code on your other device at<br><strong style="color: #a78bfa;">doz.com/my-account</strong></p>
            </div>

            <!-- Enter Code Tab -->
            <div id="enterCodeTab" class="pairing-tab-content">
                <div class="pairing-input-section">
                    <input type="text" class="pairing-input" id="pairingCodeInput" placeholder="XXXX-XXXX" maxlength="9">
                </div>
                <div id="pairingStatus"></div>
                <button class="pairing-btn" onclick="submitPairingCode()">Pair Device</button>
            </div>

            <button class="pairing-btn secondary" onclick="closePairingModal()">Close</button>
        </div>
    </div>

    <!-- Subscribe Popup (3 second delay) -->
    <div class="subscribe-popup" id="subscribePopup">
        <div class="subscribe-popup-content">
            <button class="subscribe-popup-close" onclick="closeSubscribePopup()">&times;</button>
            <div class="subscribe-popup-icon">&#x1F680;</div>
            <h2>Love sharing instantly?</h2>
            <p>Get unlimited storage, links that never expire, and priority support.</p>
            <div class="urgency" id="popupUrgency" style="display:none">
                &#x1F525; <span id="popupActiveCount"></span> <span id="popupProofLabel"></span>
            </div>
            <button class="subscribe-popup-btn" onclick="popupCheckout()">
                Upgrade to Pro - $${((stripeService.getPlan('pro_yearly')?.monthlyEquiv || 999) / 100).toFixed(2)}/mo
            </button>
            <div class="skip-link" onclick="closeSubscribePopup()">Maybe later</div>
        </div>
    </div>

    <script>
        const imageUrl = '${imageUrl}';
        const rawImageUrl = '${rawImageUrl}';
        const filename = '${filename}';

        function showToast(message) {
            const toast = document.getElementById('toast');
            document.getElementById('toastText').textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2500);
        }

        function copyLink(btn) {
            navigator.clipboard.writeText(imageUrl + '?ref=copy').then(() => {
                showToast('Link copied to clipboard!');
                if (btn) {
                    btn.classList.add('copied');
                    btn.querySelector('span').textContent = 'Copied!';
                    setTimeout(() => {
                        btn.classList.remove('copied');
                        btn.querySelector('span').textContent = 'Copy Link';
                    }, 2000);
                }
                trackShare('copy');
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = imageUrl + '?ref=copy';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('Link copied!');
            });
        }

        function downloadImage() {
            showToast('Starting download...');
            trackShare('download');

            // Fetch the image and trigger download
            fetch(rawImageUrl)
                .then(response => response.blob())
                .then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename || 'doz-image.png';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    showToast('Download complete!');
                })
                .catch(() => {
                    // Fallback: open in new tab
                    window.open(rawImageUrl, '_blank');
                });
        }

        function openLightbox() {
            document.getElementById('lightbox').classList.add('show');
            document.body.style.overflow = 'hidden';
        }

        function closeLightbox() {
            document.getElementById('lightbox').classList.remove('show');
            document.body.style.overflow = '';
        }

        function showQR() {
            const qrContainer = document.getElementById('qrCode');
            // Generate QR code using API
            qrContainer.textContent = '';
            const qrImg = document.createElement('img');
            qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(imageUrl + '?ref=qr');
            qrImg.alt = 'QR Code';
            qrImg.style.cssText = 'width:200px;height:200px;';
            qrContainer.appendChild(qrImg);
            document.getElementById('qrModal').classList.add('show');
            document.body.style.overflow = 'hidden';
            trackShare('qr');
        }

        function hideQR() {
            document.getElementById('qrModal').classList.remove('show');
            document.body.style.overflow = '';
        }

        function trackShare(method) {
            try {
                fetch('/api/track-share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: filename, method: method })
                }).catch(() => {});
            } catch(e) {}
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeLightbox();
                hideQR();
            }
            if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                copyLink(document.getElementById('copyBtn'));
            }
        });

        // Preload image for smoother lightbox
        const preloadImg = new Image();
        preloadImg.src = rawImageUrl;

        // ============ DEVICE PAIRING FUNCTIONS ============

        // Generate device fingerprint
        function generateDeviceId() {
            const nav = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, navigator.platform].join('|');
            let hash = 0;
            for (let i = 0; i < nav.length; i++) { hash = ((hash << 5) - hash) + nav.charCodeAt(i); hash = hash & hash; }
            return 'DOZ-' + Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
        }

        const DEVICE_ID = generateDeviceId();
        let currentPairingCode = null;
        let pairingTimer = null;
        let pairingCountdown = 300; // 5 minutes

        function openPairingModal() {
            document.getElementById('pairingModal').classList.add('show');
            document.body.style.overflow = 'hidden';
            generatePairingCode();
        }

        function closePairingModal() {
            document.getElementById('pairingModal').classList.remove('show');
            document.body.style.overflow = '';
            if (pairingTimer) {
                clearInterval(pairingTimer);
                pairingTimer = null;
            }
            currentPairingCode = null;
        }

        function switchPairingTab(tab) {
            document.querySelectorAll('.pairing-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.pairing-tab-content').forEach(c => c.classList.remove('active'));

            if (tab === 'generate') {
                document.querySelector('.pairing-tab:first-child').classList.add('active');
                document.getElementById('generateCodeTab').classList.add('active');
            } else {
                document.querySelector('.pairing-tab:last-child').classList.add('active');
                document.getElementById('enterCodeTab').classList.add('active');
            }
        }

        async function generatePairingCode() {
            try {
                const response = await fetch('/api/devices/pairing-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deviceId: DEVICE_ID,
                        deviceName: navigator.platform || 'Web Browser'
                    })
                });

                const data = await response.json();
                if (data.success && data.code) {
                    currentPairingCode = data.code;
                    document.getElementById('pairingCode').textContent = data.code;
                    startPairingTimer();
                } else {
                    document.getElementById('pairingCode').textContent = 'ERROR';
                }
            } catch (e) {
                console.error('Error generating pairing code:', e);
                document.getElementById('pairingCode').textContent = 'ERROR';
            }
        }

        function startPairingTimer() {
            pairingCountdown = 300;
            updateTimerDisplay();

            if (pairingTimer) clearInterval(pairingTimer);
            pairingTimer = setInterval(() => {
                pairingCountdown--;
                updateTimerDisplay();

                if (pairingCountdown <= 0) {
                    clearInterval(pairingTimer);
                    document.getElementById('pairingCode').textContent = 'EXPIRED';
                    document.getElementById('pairingTimer').textContent = 'Code expired - click to generate new';
                }
            }, 1000);
        }

        function updateTimerDisplay() {
            const mins = Math.floor(pairingCountdown / 60);
            const secs = pairingCountdown % 60;
            document.getElementById('pairingTimer').textContent = 'Code expires in ' + mins + ':' + secs.toString().padStart(2, '0');
        }

        function copyPairingCode() {
            if (currentPairingCode && currentPairingCode !== 'EXPIRED') {
                navigator.clipboard.writeText(currentPairingCode).then(() => {
                    showToast('Pairing code copied!');
                });
            }
        }

        async function submitPairingCode() {
            const input = document.getElementById('pairingCodeInput');
            const statusEl = document.getElementById('pairingStatus');
            let code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

            if (code.length !== 8) {
                statusEl.className = 'pairing-status error';
                statusEl.textContent = 'Please enter a valid 8-character code';
                return;
            }

            // Format as XXXX-XXXX
            code = code.slice(0, 4) + '-' + code.slice(4);

            try {
                statusEl.className = 'pairing-status';
                statusEl.textContent = 'Pairing...';
                statusEl.style.color = '#94a3b8';

                const response = await fetch('/api/devices/pair', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: code,
                        newDeviceId: DEVICE_ID,
                        deviceName: navigator.platform || 'Web Browser',
                        platform: navigator.platform || 'Web'
                    })
                });

                const data = await response.json();
                if (data.success) {
                    statusEl.className = 'pairing-status success';
                    statusEl.textContent = 'Device paired successfully!';
                    showToast('Device paired! View in My Account');
                    setTimeout(closePairingModal, 2000);
                } else {
                    statusEl.className = 'pairing-status error';
                    statusEl.textContent = data.error || 'Pairing failed. Check the code and try again.';
                }
            } catch (e) {
                console.error('Pairing error:', e);
                statusEl.className = 'pairing-status error';
                statusEl.textContent = 'Connection error. Please try again.';
            }
        }

        // Auto-format pairing code input
        document.getElementById('pairingCodeInput').addEventListener('input', function(e) {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (value.length > 4) {
                value = value.slice(0, 4) + '-' + value.slice(4, 8);
            }
            e.target.value = value;
        });

        // Close pairing modal on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closePairingModal();
            }
        });
    </script>
</body>
</html>`;
}

// API endpoint to track share actions
app.post('/api/track-share', express.json(), (req, res) => {
    try {
        const { filename, method } = req.body;
        if (!filename || !method) {
            return res.status(400).json({ error: 'Missing filename or method' });
        }

        // Normalize key by stripping extension to prevent duplicates
        const normalizedKey = filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');

        const sharesPath = path.join(__dirname, 'data', 'shares.json');
        let shares = {};
        if (fs.existsSync(sharesPath)) {
            shares = JSON.parse(fs.readFileSync(sharesPath, 'utf8'));
        }

        if (!shares[normalizedKey]) {
            shares[normalizedKey] = { views: 0, sources: {}, shares: {}, firstView: Date.now() };
        }

        if (!shares[normalizedKey].shares) {
            shares[normalizedKey].shares = {};
        }

        shares[normalizedKey].shares[method] = (shares[normalizedKey].shares[method] || 0) + 1;
        shares[normalizedKey].lastShare = Date.now();

        fs.writeFileSync(sharesPath, JSON.stringify(shares));
        res.json({ success: true });
    } catch (e) {
        console.log('[Share Tracking API] Error:', e.message);
        res.json({ success: true }); // Don't fail silently
    }
});

// ============ INTERNAL SYNC ENDPOINT ============
// Server-to-server file sync with preserved filenames
// Used by dev-sync to replicate uploads between servers
const SYNC_SECRET = process.env.SYNC_SECRET || 'doz-internal-sync-2026';

// Multer storage that preserves the original filename
const syncStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        // Use the provided filename from header, or fall back to original
        const customFilename = req.headers['x-sync-filename'] || file.originalname;
        cb(null, customFilename);
    }
});

const syncUpload = multer({
    storage: syncStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for sync
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type for sync'));
        }
    }
});

// Internal file sync endpoint - preserves original filename
app.post('/api/internal/sync-file', syncUpload.single('file'), (req, res) => {
    // Verify internal sync secret
    const providedSecret = req.headers['x-sync-secret'];
    if (providedSecret !== SYNC_SECRET) {
        return res.status(403).json({ error: 'Invalid sync secret' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
    }

    const filename = req.file.filename;
    const filePath = path.join(uploadsDir, filename);

    // Verify file was saved
    if (!fs.existsSync(filePath)) {
        return res.status(500).json({ error: 'File sync failed' });
    }

    console.log(`[Sync] File synced: ${filename} from ${req.ip}`);

    res.json({
        success: true,
        filename: filename,
        url: `https://${SHARE_HOST}/${filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')}`,
        syncedAt: new Date().toISOString()
    });
});

// Upload endpoint with device tracking - OPTIMIZED FOR SPEED
app.post('/upload', upload.single('image'), (req, res) => {
    const uploadStart = Date.now();

    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    const deviceId = req.headers['x-device-id'] || req.body?.deviceId || 'web';
    const userId = req.headers['x-user-id'] || req.body?.userId;

    // Check subscription via unified plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);

    // Check daily upload limit (uses in-memory cache)
    const uploadLimit = checkDailyUploadLimit(deviceId, isPaidUser);
    if (!uploadLimit.allowed) {
        fs.unlink(req.file.path, () => {}); // Async delete
        uploadMetrics.record(false, Date.now() - uploadStart);
        return res.status(429).json({
            error: `Daily upload limit reached (${uploadLimit.limit}/day). Resets tomorrow.`,
            limitReached: true,
            used: uploadLimit.used,
            limit: uploadLimit.limit,
            resetsAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
        });
    }

    // Use extensionless URL for sharing - prevents Cloudflare from auto-caching as image
    const baseFilename = req.file.filename.replace(/\.(png|jpg|jpeg|gif|webp)$/i, '');
    const imageUrl = `https://${SHARE_HOST}/${baseFilename}`;
    const shareUrl = `https://${SHARE_HOST}/${baseFilename}`;
    const now = Date.now();
    const expirationMs = isPaidUser ? IMAGE_LIFETIME_MS : FREE_TIER_EXPIRATION_MS;
    const expiresAt = now + expirationMs;
    const expiresInText = isPaidUser ? '1 year' : '30 days';
    const uploadId = uuidv4();

    // RESPOND IMMEDIATELY with the URL - file is already saved by multer
    const responseTime = Date.now() - uploadStart;
    uploadMetrics.record(true, responseTime);
    res.json({
        success: true,
        url: imageUrl,
        shareUrl: shareUrl,
        filename: req.file.filename,
        id: uploadId,
        expiresAt: expiresAt,
        expiresIn: expiresInText,
        responseTime: responseTime,
        dailyUploads: {
            used: uploadLimit.used + 1,
            limit: uploadLimit.limit,
            remaining: Math.max(0, uploadLimit.remaining - 1)
        }
    });

    // Track for live monitor
    if (global.trackMonitorActivity) {
        const geoData = getGeoFromRequest(req);
        global.trackMonitorActivity('upload', {
            description: 'Screenshot uploaded',
            device: deviceId,
            country: geoData.country,
            city: geoData.city
        });
    }

    // ========== BACKGROUND OPERATIONS (after response sent) ==========
    setImmediate(() => {
        // Increment daily upload counter (in-memory)
        incrementDailyUploadCount(deviceId);

        // Auto-link device to user account
        if (userId && deviceId && deviceId !== 'web') {
            try {
                authService.linkBrowserDevice(userId, deviceId);
            } catch (e) {}
        }

