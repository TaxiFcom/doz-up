/**
 * DOZ UP - Admin Authentication & Management
 * Secure admin panel access control
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const security = require('./security');

const dataDir = path.join(__dirname, '..', 'data');
const adminsPath = path.join(dataDir, 'admins.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Admin and User roles with permissions
// Level indicates hierarchy: higher level = more permissions
const ROLES = {
    // ============ ADMIN ROLES ============
    superadmin: {
        name: 'Super Admin',
        level: 100,
        type: 'admin',
        permissions: ['*'] // All permissions
    },
    admin: {
        name: 'Admin',
        level: 90,
        type: 'admin',
        permissions: [
            'dashboard:full',
            'revenue:read', 'revenue:write',
            'orders:read', 'orders:write',
            'subscriptions:read', 'subscriptions:write',
            'analytics:read', 'analytics:company',
            'users:read', 'users:write', 'users:manage',
            'tickets:read', 'tickets:write', 'tickets:manage',
            'uploads:read', 'uploads:manage',
            'heatmap:read',
            'ads:read', 'ads:write',
            'settings:read', 'settings:write',
            'leads:read', 'leads:write',
            'deals:read', 'deals:write',
            'proposals:read', 'proposals:write',
            'control-center:read', 'control-center:actions'
        ]
    },
    moderator: {
        name: 'Moderator',
        level: 50,
        type: 'admin',
        permissions: [
            'dashboard:limited',
            'users:read',
            'tickets:read', 'tickets:write',
            'uploads:read', 'uploads:moderate',
            'heatmap:read',
            'analytics:personal'
        ]
    },
    sales: {
        name: 'Sales Manager',
        level: 40,
        type: 'admin',
        permissions: [
            'leads:read', 'leads:write',
            'deals:read', 'deals:write',
            'proposals:read', 'proposals:write',
            'analytics:read',
            'users:read'
        ]
    },
    viewer: {
        name: 'Viewer',
        level: 10,
        type: 'admin',
        permissions: [
            'leads:read',
            'deals:read',
            'proposals:read',
            'analytics:read'
        ]
    },
    // ============ USER ROLES ============
    user: {
        name: 'User',
        level: 10,
        type: 'user',
        permissions: [
            'uploads:own',
            'analytics:personal',
            'account:own',
            'cabinet:own'
        ]
    },
    visitor: {
        name: 'Visitor',
        level: 0,
        type: 'public',
        permissions: [
            'public:read'
        ]
    }
};

// Permission groups for easier management
const PERMISSION_GROUPS = {
    revenue: ['revenue:read', 'revenue:write'],
    orders: ['orders:read', 'orders:write'],
    subscriptions: ['subscriptions:read', 'subscriptions:write'],
    users: ['users:read', 'users:write', 'users:manage'],
    tickets: ['tickets:read', 'tickets:write', 'tickets:manage'],
    uploads: ['uploads:read', 'uploads:moderate', 'uploads:manage'],
    analytics: ['analytics:read', 'analytics:company', 'analytics:personal'],
    ads: ['ads:read', 'ads:write'],
    settings: ['settings:read', 'settings:write'],
    heatmap: ['heatmap:read']
};

class AdminService {
    constructor() {
        this.admins = loadJSON(adminsPath, []);
        this.loginAttempts = new Map();

        // Create default admin if none exists
        if (this.admins.length === 0) {
            this.createDefaultAdmin();
        }
    }

    createDefaultAdmin() {
        const defaultPassword = process.env.ADMIN_PASSWORD || 'DozUp2026!';
        const { hash, salt } = security.hashPassword(defaultPassword);

        const admin = {
            id: crypto.randomUUID(),
            username: 'admin',
            email: 'admin@doz.com',
            passwordHash: hash,
            passwordSalt: salt,
            role: 'superadmin',
            status: 'active',
            twoFactorEnabled: false,
            twoFactorSecret: null,
            createdAt: new Date().toISOString(),
            lastLogin: null,
            loginCount: 0
        };

        this.admins.push(admin);
        saveJSON(adminsPath, this.admins);
        console.log('[Admin] Default admin created. Username: admin');
    }

    // ============ AUTHENTICATION ============

    async login(username, password, ip) {
        // Check for brute force
        const attempts = this.loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
        const now = Date.now();

        // Reset after 15 minutes
        if (now - attempts.lastAttempt > 900000) {
            attempts.count = 0;
        }

        if (attempts.count >= 5) {
            security.logSecurityEvent({
                type: 'login_blocked',
                ip,
                username,
                message: 'Too many failed attempts',
                severity: 'high'
            });
            return { success: false, error: 'Account temporarily locked. Try again in 15 minutes.' };
        }

        const admin = this.admins.find(a =>
            a.username === username || a.email === username
        );

        if (!admin) {
            attempts.count++;
            attempts.lastAttempt = now;
            this.loginAttempts.set(ip, attempts);
            return { success: false, error: 'Invalid credentials' };
        }

        if (admin.status !== 'active') {
            return { success: false, error: 'Account is disabled' };
        }

        const isValid = security.verifyPassword(password, admin.passwordHash, admin.passwordSalt);

        if (!isValid) {
            attempts.count++;
            attempts.lastAttempt = now;
            this.loginAttempts.set(ip, attempts);

            security.logSecurityEvent({
                type: 'login_failed',
                ip,
                username,
                adminId: admin.id,
                severity: 'medium'
            });

            return { success: false, error: 'Invalid credentials' };
        }

        // Successful login
        this.loginAttempts.delete(ip);

        // Update admin stats
        admin.lastLogin = new Date().toISOString();
        admin.loginCount++;
        saveJSON(adminsPath, this.admins);

        // Create session
        const session = security.createSession(admin.id, { ip, userAgent: 'admin-panel' });

        security.logSecurityEvent({
            type: 'login_success',
            ip,
            adminId: admin.id,
            username: admin.username,
            severity: 'low'
        });

        return {
            success: true,
            admin: this.sanitizeAdmin(admin),
            token: session.accessToken,
            sessionId: session.sessionId,
            expiresAt: session.expiresAt
        };
    }

    logout(sessionId) {
        security.destroySession(sessionId);
        return { success: true };
    }

    // ============ ADMIN MANAGEMENT ============

    createAdmin(data, createdBy) {
        // Validate
        if (!data.username || !data.email || !data.password) {
            throw new Error('Username, email, and password are required');
        }

        if (this.admins.find(a => a.username === data.username)) {
            throw new Error('Username already exists');
        }

        if (this.admins.find(a => a.email === data.email)) {
            throw new Error('Email already exists');
        }

        const passwordCheck = security.checkPasswordStrength(data.password);
        if (!passwordCheck.valid) {
            throw new Error(passwordCheck.issues.join('. '));
        }

        const { hash, salt } = security.hashPassword(data.password);

        const admin = {
            id: crypto.randomUUID(),
            username: security.sanitizeString(data.username, 50),
            email: security.sanitizeEmail(data.email),
            passwordHash: hash,
            passwordSalt: salt,
            role: ROLES[data.role] ? data.role : 'viewer',
            status: 'active',
            twoFactorEnabled: false,
            twoFactorSecret: null,
            createdAt: new Date().toISOString(),
            createdBy,
            lastLogin: null,
            loginCount: 0
        };

        this.admins.push(admin);
        saveJSON(adminsPath, this.admins);

        security.logSecurityEvent({
            type: 'admin_created',
            adminId: admin.id,
            createdBy,
            severity: 'medium'
        });

        return this.sanitizeAdmin(admin);
    }

    updateAdmin(adminId, updates, updatedBy) {
        const admin = this.admins.find(a => a.id === adminId);
        if (!admin) return null;

        // Don't allow changing superadmin's role
        if (admin.role === 'superadmin' && updates.role && updates.role !== 'superadmin') {
            throw new Error('Cannot change superadmin role');
        }

        if (updates.username) admin.username = security.sanitizeString(updates.username, 50);
        if (updates.email) admin.email = security.sanitizeEmail(updates.email);
        if (updates.role && ROLES[updates.role]) admin.role = updates.role;
        if (updates.status) admin.status = updates.status;

        admin.updatedAt = new Date().toISOString();
        admin.updatedBy = updatedBy;

        saveJSON(adminsPath, this.admins);
        return this.sanitizeAdmin(admin);
    }

    changePassword(adminId, currentPassword, newPassword) {
        const admin = this.admins.find(a => a.id === adminId);
        if (!admin) throw new Error('Admin not found');

        const isValid = security.verifyPassword(currentPassword, admin.passwordHash, admin.passwordSalt);
        if (!isValid) throw new Error('Current password is incorrect');

        const passwordCheck = security.checkPasswordStrength(newPassword);
        if (!passwordCheck.valid) {
            throw new Error(passwordCheck.issues.join('. '));
        }

        const { hash, salt } = security.hashPassword(newPassword);
        admin.passwordHash = hash;
        admin.passwordSalt = salt;
        admin.passwordChangedAt = new Date().toISOString();

        saveJSON(adminsPath, this.admins);

        security.logSecurityEvent({
            type: 'password_changed',
            adminId,
            severity: 'medium'
        });

        return true;
    }

    deleteAdmin(adminId, deletedBy) {
        const index = this.admins.findIndex(a => a.id === adminId);
        if (index === -1) return false;

        const admin = this.admins[index];
        if (admin.role === 'superadmin') {
            throw new Error('Cannot delete superadmin');
        }

        this.admins.splice(index, 1);
        saveJSON(adminsPath, this.admins);

        security.logSecurityEvent({
            type: 'admin_deleted',
            adminId,
            deletedBy,
            severity: 'high'
        });

        return true;
    }

    getAdmin(adminId) {
        const admin = this.admins.find(a => a.id === adminId);
        return admin ? this.sanitizeAdmin(admin) : null;
    }

    getAdmins() {
        return this.admins.map(a => this.sanitizeAdmin(a));
    }

    // ============ PERMISSIONS ============

    hasPermission(adminId, permission) {
        const admin = this.admins.find(a => a.id === adminId);
        if (!admin) return false;

        const role = ROLES[admin.role];
        if (!role) return false;

        // Superadmin has all permissions
        if (role.permissions.includes('*')) return true;

        return role.permissions.includes(permission);
    }

    getPermissions(adminId) {
        const admin = this.admins.find(a => a.id === adminId);
        if (!admin) return [];

        const role = ROLES[admin.role];
        return role ? role.permissions : [];
    }

    getRoles() {
        return Object.entries(ROLES).map(([id, role]) => ({
            id,
            name: role.name,
            permissions: role.permissions
        }));
    }

    // ============ HELPER ============

    sanitizeAdmin(admin) {
        return {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            role: admin.role,
            roleName: ROLES[admin.role]?.name || admin.role,
            status: admin.status,
            twoFactorEnabled: admin.twoFactorEnabled,
            createdAt: admin.createdAt,
            lastLogin: admin.lastLogin,
            loginCount: admin.loginCount
        };
    }

    // Validate session and return admin
    validateAdminSession(token) {
        const payload = security.verifyToken(token);
        if (!payload) return null;

        const session = security.validateSession(payload.sessionId);
        if (!session) return null;

        const admin = this.admins.find(a => a.id === payload.userId);
        if (!admin || admin.status !== 'active') return null;

        return {
            admin: this.sanitizeAdmin(admin),
            session
        };
    }
}

const adminServiceInstance = new AdminService();

// Helper: Check if a role has a specific permission
function hasPermissionForRole(role, permission) {
    const roleData = ROLES[role];
    if (!roleData) return false;
    if (roleData.permissions.includes('*')) return true;
    return roleData.permissions.includes(permission);
}

// Helper: Get role level
function getRoleLevel(role) {
    return ROLES[role]?.level || 0;
}

// Helper: Check if role is admin type
function isAdminRole(role) {
    return ROLES[role]?.type === 'admin';
}

// Helper: Get permissions for dashboard visibility
function getDashboardPermissions(role) {
    const roleData = ROLES[role];
    if (!roleData) return { canViewAll: false, sections: [] };

    const isFullAccess = roleData.permissions.includes('*') || roleData.permissions.includes('dashboard:full');

    return {
        canViewAll: isFullAccess,
        role: role,
        roleLevel: roleData.level,
        roleName: roleData.name,
        sections: {
            revenue: isFullAccess || roleData.permissions.includes('revenue:read'),
            orders: isFullAccess || roleData.permissions.includes('orders:read'),
            subscriptions: isFullAccess || roleData.permissions.includes('subscriptions:read'),
            companyAnalytics: isFullAccess || roleData.permissions.includes('analytics:company'),
            personalAnalytics: isFullAccess || roleData.permissions.includes('analytics:personal') || roleData.permissions.includes('analytics:read'),
            users: isFullAccess || roleData.permissions.includes('users:read'),
            usersManage: isFullAccess || roleData.permissions.includes('users:manage'),
            tickets: isFullAccess || roleData.permissions.includes('tickets:read'),
            ticketsManage: isFullAccess || roleData.permissions.includes('tickets:manage'),
            uploads: isFullAccess || roleData.permissions.includes('uploads:read'),
            heatmap: isFullAccess || roleData.permissions.includes('heatmap:read'),
            ads: isFullAccess || roleData.permissions.includes('ads:read'),
            settings: isFullAccess || roleData.permissions.includes('settings:read')
        }
    };
}

module.exports = adminServiceInstance;
module.exports.ROLES = ROLES;
module.exports.PERMISSION_GROUPS = PERMISSION_GROUPS;
module.exports.hasPermissionForRole = hasPermissionForRole;
module.exports.getRoleLevel = getRoleLevel;
module.exports.isAdminRole = isAdminRole;
module.exports.getDashboardPermissions = getDashboardPermissions;
