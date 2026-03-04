'use strict';

/**
 * upload-limiter.js — Secure Multer Configuration & Upload Rate Limiting
 *
 * Replaces the 1 GB multer limit at gateway.js:3579 with sensible per-purpose limits.
 * Keeps the same disk-storage destinations used in gateway.js so existing code
 * can swap the multer instances without changing file paths.
 *
 * Exports:
 *   screenshotUpload  — multer instance for single screenshot images (10 MB)
 *   syncUpload        — multer instance for sync files (50 MB, matches gateway.js:5377)
 *   uploadRateLimiter — express-rate-limit middleware (100 uploads / 15 min per IP)
 *
 * Usage in gateway.js:
 *   const { screenshotUpload, syncUpload, uploadRateLimiter } = require('./src/middleware/upload-limiter');
 *
 *   // Replace:  upload.single('screenshot')
 *   // With:     uploadRateLimiter, screenshotUpload.single('screenshot')
 *
 *   app.post('/api/upload', uploadRateLimiter, screenshotUpload.single('screenshot'), handler);
 *   app.post('/api/sync',   uploadRateLimiter, syncUpload.single('file'),             handler);
 */

const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

// ---------------------------------------------------------------------------
// Storage paths (mirror gateway.js)
// ---------------------------------------------------------------------------
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ---------------------------------------------------------------------------
// MIME type whitelist
// Allows the listed extensions AND their corresponding MIME types.
// ---------------------------------------------------------------------------
const ALLOWED_IMAGE_EXTENSIONS = /\.(jpeg|jpg|png|gif|webp|bmp)$/i;
const ALLOWED_IMAGE_MIMES      = /^image\/(jpeg|jpg|png|gif|webp|bmp)$/i;

function imageFileFilter(req, file, cb) {
    const extOk  = ALLOWED_IMAGE_EXTENSIONS.test(path.extname(file.originalname));
    const mimeOk = ALLOWED_IMAGE_MIMES.test(file.mimetype);

    if (extOk && mimeOk) {
        cb(null, true);
    } else {
        // Reject with a structured error so centralErrorHandler can return 415
        const err = new Error(`Unsupported file type: ${file.mimetype}`);
        err.code   = 'UNSUPPORTED_MEDIA_TYPE';
        err.status = 415;
        cb(err, false);
    }
}

// Sync accepts a broader set (including avif) — mirrors gateway.js:5378-5386
const ALLOWED_SYNC_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|avif)$/i;
const ALLOWED_SYNC_MIMES      = /^image\/(png|jpg|jpeg|gif|webp|avif)$/i;

function syncFileFilter(req, file, cb) {
    const extOk  = ALLOWED_SYNC_EXTENSIONS.test(path.extname(file.originalname));
    const mimeOk = ALLOWED_SYNC_MIMES.test(file.mimetype);

    if (extOk && mimeOk) {
        cb(null, true);
    } else {
        const err = new Error('Invalid file type for sync');
        err.code   = 'UNSUPPORTED_MEDIA_TYPE';
        err.status = 415;
        cb(err, false);
    }
}

// ---------------------------------------------------------------------------
// Disk storage configs
// ---------------------------------------------------------------------------
const screenshotStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename:    (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        cb(null, uuidv4() + ext);
    },
});

const syncStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename:    (req, file, cb) => {
        // Honour an explicit filename requested by the client (sync protocol), else UUID
        const customFilename = req.headers['x-sync-filename'] || file.originalname;
        cb(null, customFilename);
    },
});

// ---------------------------------------------------------------------------
// screenshotUpload — 10 MB image limit
// Replaces the 1 GB upload at gateway.js:3579
// ---------------------------------------------------------------------------
const screenshotUpload = multer({
    storage:    screenshotStorage,
    limits:     { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: imageFileFilter,
});

// ---------------------------------------------------------------------------
// syncUpload — 50 MB limit (matches gateway.js:5377)
// ---------------------------------------------------------------------------
const syncUpload = multer({
    storage:    syncStorage,
    limits:     { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: syncFileFilter,
});

// ---------------------------------------------------------------------------
// uploadRateLimiter
// 100 upload requests per 15 minutes per IP.
// Uses express-rate-limit which is already in package.json.
// ---------------------------------------------------------------------------
const uploadRateLimiter = rateLimit({
    windowMs:         15 * 60 * 1000, // 15 minutes
    max:              100,             // max requests per window per IP
    standardHeaders:  true,           // Return rate limit info in RateLimit-* headers
    legacyHeaders:    false,
    message: {
        error: 'Too many upload requests, please try again later.',
        code:  'RATE_LIMIT_EXCEEDED',
    },
    // Skip rate-limiting for admin requests
    skip: (req) => Boolean(req.admin),
});

module.exports = { screenshotUpload, syncUpload, uploadRateLimiter };
