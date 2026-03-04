'use strict';

/**
 * auth.js — Authentication & Authorization Middleware
 *
 * Wraps the existing securityService.verifyToken() and adminService.validateAdminSession().
 * Does NOT re-implement token logic — delegates entirely to the service layer.
 *
 * Exports:
 *   requireAuth       — verifies Bearer token; rejects 401 if missing/invalid
 *   requireAdmin(perm) — validates admin session + device binding; replaces gateway.js:10250
 *   optionalAuth      — same as requireAuth but continues without error if no token
 */

const path           = require('path');
const fs             = require('fs');
const securityService = require('../../services/security');
const adminService   = require('../../services/admin');

// ---------------------------------------------------------------------------
// requireAuth
// Verifies the Bearer token in Authorization header using securityService.
// On success: attaches the decoded payload to req.user and calls next().
// On failure: returns 401.
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required', code: 'TOKEN_MISSING' });
    }

    const token = authHeader.slice(7);
    const payload = securityService.verifyToken(token);

    if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
    }

    req.user = payload;
    return next();
}

// ---------------------------------------------------------------------------
// requireAdmin(permission)
// Replicates and centralises the inline requireAdmin defined at gateway.js:10250.
// Uses adminService.validateAdminSession() + reads device-binding settings.
//
// Usage:
//   app.get('/api/admin/users', requireAdmin('users:read'), handler);
//   app.get('/api/admin/info',  requireAdmin(), handler);          // no specific perm
// ---------------------------------------------------------------------------
function requireAdmin(permission = null) {
    return (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const token = authHeader.slice(7);
            const result = adminService.validateAdminSession(token);

            if (!result) {
                return res.status(401).json({ error: 'Invalid or expired token' });
            }

            // --- Device binding check ---
            // Reads admin-settings.json to honour the deviceBinding flag.
            const adminSettingsPath = path.join(__dirname, '..', '..', 'data', 'admin-settings.json');
            try {
                if (fs.existsSync(adminSettingsPath)) {
                    const settings = JSON.parse(fs.readFileSync(adminSettingsPath, 'utf8'));
                    if (settings.deviceBinding && settings.deviceBinding.enabled) {
                        const clientDeviceId = req.headers['x-device-id'];
                        if (!clientDeviceId || clientDeviceId !== settings.deviceBinding.deviceId) {
                            return res.status(403).json({
                                error: 'Access denied: Device not authorized',
                                code:  'DEVICE_NOT_BOUND',
                            });
                        }
                    }
                }
            } catch (e) {
                console.error('[Auth] Error checking device binding:', e);
            }

            // --- Permission check ---
            if (permission && !adminService.hasPermission(result.admin.id, permission)) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            req.admin   = result.admin;
            req.session = result.session;
            return next();
        } catch (err) {
            console.error('[Auth] requireAdmin error:', err);
            return res.status(500).json({ error: 'Admin authentication error', details: err.message });
        }
    };
}

// ---------------------------------------------------------------------------
// optionalAuth
// Same flow as requireAuth but continues (req.user = null) when no token is
// present or the token is invalid — useful for routes that adapt their response
// based on whether the caller is authenticated.
// ---------------------------------------------------------------------------
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }

    const token = authHeader.slice(7);
    const payload = securityService.verifyToken(token);

    req.user = payload || null; // null when invalid/expired — don't reject
    return next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth };
