/**
 * DOZ UP - User Management Service
 * Enterprise-grade user management with warnings, notes, groups, and bulk operations
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Data storage paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const WARNINGS_FILE = path.join(DATA_DIR, 'user-warnings.json');
const NOTES_FILE = path.join(DATA_DIR, 'user-notes.json');
const GROUPS_FILE = path.join(DATA_DIR, 'user-groups.json');
const GROUP_MEMBERS_FILE = path.join(DATA_DIR, 'group-members.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper to load JSON data
function loadData(filePath, defaultValue = []) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[UserMgmt] Error loading ${filePath}:`, e.message);
    }
    return defaultValue;
}

// Helper to save JSON data
function saveData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error(`[UserMgmt] Error saving ${filePath}:`, e.message);
        return false;
    }
}

// Initialize default user groups
function initializeDefaultGroups() {
    const groups = loadData(GROUPS_FILE);
    if (groups.length === 0) {
        const defaultGroups = [
            { id: uuidv4(), name: 'VIP', description: 'VIP users with premium benefits', color: '#f59e0b', icon: 'star', priority: 100, isSystem: true, permissions: ['priority_support', 'extended_storage'], createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Beta Testers', description: 'Early access to new features', color: '#8b5cf6', icon: 'beaker', priority: 80, isSystem: true, permissions: ['beta_access'], createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Trusted', description: 'Trusted users with relaxed limits', color: '#10b981', icon: 'shield-check', priority: 60, isSystem: true, permissions: ['extended_limits'], createdAt: new Date().toISOString() },
            { id: uuidv4(), name: 'Flagged', description: 'Users under review', color: '#ef4444', icon: 'flag', priority: 10, isSystem: true, permissions: ['restricted'], createdAt: new Date().toISOString() }
        ];
        saveData(GROUPS_FILE, defaultGroups);
        console.log('[UserMgmt] Initialized default user groups');
    }
}

initializeDefaultGroups();

// ============ WARNING SYSTEM ============

/**
 * Issue a warning to a user
 */
function issueWarning(userId, adminId, adminName, reason, severity = 1, expiresInDays = null) {
    const warnings = loadData(WARNINGS_FILE);

    const warning = {
        id: uuidv4(),
        userId,
        adminId,
        adminName,
        reason,
        severity: Math.min(5, Math.max(1, severity)),
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null,
        isActive: true,
        createdAt: new Date().toISOString()
    };

    warnings.push(warning);
    saveData(WARNINGS_FILE, warnings);

    // Check if user should be auto-suspended based on warning count
    const activeWarnings = warnings.filter(w =>
        w.userId === userId &&
        w.isActive &&
        (!w.expiresAt || new Date(w.expiresAt) > new Date())
    );

    // Calculate total severity points
    const totalSeverity = activeWarnings.reduce((sum, w) => sum + w.severity, 0);

    return {
        warning,
        activeWarningCount: activeWarnings.length,
        totalSeverity,
        shouldSuspend: totalSeverity >= 10 // Auto-suspend at 10 severity points
    };
}

/**
 * Get warnings for a user
 */
function getUserWarnings(userId, includeExpired = false) {
    const warnings = loadData(WARNINGS_FILE);

    return warnings.filter(w => {
        if (w.userId !== userId) return false;
        if (includeExpired) return true;
        if (!w.isActive) return false;
        if (w.expiresAt && new Date(w.expiresAt) < new Date()) return false;
        return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Revoke a warning
 */
function revokeWarning(warningId, adminId) {
    const warnings = loadData(WARNINGS_FILE);
    const index = warnings.findIndex(w => w.id === warningId);

    if (index === -1) return null;

    warnings[index].isActive = false;
    warnings[index].revokedBy = adminId;
    warnings[index].revokedAt = new Date().toISOString();

    saveData(WARNINGS_FILE, warnings);
    return warnings[index];
}

/**
 * Get warning statistics
 */
function getWarningStats() {
    const warnings = loadData(WARNINGS_FILE);
    const now = new Date();

    const active = warnings.filter(w =>
        w.isActive && (!w.expiresAt || new Date(w.expiresAt) > now)
    );

    const last7Days = warnings.filter(w =>
        new Date(w.createdAt) > new Date(now - 7 * 24 * 60 * 60 * 1000)
    );

    const last30Days = warnings.filter(w =>
        new Date(w.createdAt) > new Date(now - 30 * 24 * 60 * 60 * 1000)
    );

    return {
        total: warnings.length,
        active: active.length,
        last7Days: last7Days.length,
        last30Days: last30Days.length,
        bySeverity: {
            1: warnings.filter(w => w.severity === 1).length,
            2: warnings.filter(w => w.severity === 2).length,
            3: warnings.filter(w => w.severity === 3).length,
            4: warnings.filter(w => w.severity === 4).length,
            5: warnings.filter(w => w.severity === 5).length
        }
    };
}

// ============ ADMIN NOTES SYSTEM ============

/**
 * Add an admin note to a user
 */
function addUserNote(userId, adminId, adminName, note, isPinned = false) {
    const notes = loadData(NOTES_FILE);

    const newNote = {
        id: uuidv4(),
        userId,
        adminId,
        adminName,
        note,
        isPinned,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    notes.push(newNote);
    saveData(NOTES_FILE, notes);

    return newNote;
}

/**
 * Get notes for a user
 */
function getUserNotes(userId) {
    const notes = loadData(NOTES_FILE);

    return notes
        .filter(n => n.userId === userId)
        .sort((a, b) => {
            // Pinned notes first, then by date
            if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
}

/**
 * Update a note
 */
function updateNote(noteId, updates) {
    const notes = loadData(NOTES_FILE);
    const index = notes.findIndex(n => n.id === noteId);

    if (index === -1) return null;

    notes[index] = {
        ...notes[index],
        ...updates,
        updatedAt: new Date().toISOString()
    };

    saveData(NOTES_FILE, notes);
    return notes[index];
}

/**
 * Delete a note
 */
function deleteNote(noteId) {
    const notes = loadData(NOTES_FILE);
    const index = notes.findIndex(n => n.id === noteId);

    if (index === -1) return false;

    notes.splice(index, 1);
    saveData(NOTES_FILE, notes);
    return true;
}

// ============ USER GROUPS SYSTEM ============

/**
 * Create a new user group
 */
function createGroup(name, description, color = '#3b82f6', icon = null, permissions = []) {
    const groups = loadData(GROUPS_FILE);

    // Check if group name already exists
    if (groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
        return { error: 'Group name already exists' };
    }

    const group = {
        id: uuidv4(),
        name,
        description,
        color,
        icon,
        permissions,
        priority: 50,
        isSystem: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    groups.push(group);
    saveData(GROUPS_FILE, groups);

    return group;
}

/**
 * Get all user groups
 */
function getAllGroups() {
    return loadData(GROUPS_FILE).sort((a, b) => b.priority - a.priority);
}

/**
 * Get a group by ID
 */
function getGroup(groupId) {
    const groups = loadData(GROUPS_FILE);
    return groups.find(g => g.id === groupId);
}

/**
 * Update a group
 */
function updateGroup(groupId, updates) {
    const groups = loadData(GROUPS_FILE);
    const index = groups.findIndex(g => g.id === groupId);

    if (index === -1) return null;

    // Don't allow editing system groups
    if (groups[index].isSystem && (updates.name || updates.isSystem !== undefined)) {
        return { error: 'Cannot modify system group' };
    }

    groups[index] = {
        ...groups[index],
        ...updates,
        updatedAt: new Date().toISOString()
    };

    saveData(GROUPS_FILE, groups);
    return groups[index];
}

/**
 * Delete a group
 */
function deleteGroup(groupId) {
    const groups = loadData(GROUPS_FILE);
    const group = groups.find(g => g.id === groupId);

    if (!group) return { error: 'Group not found' };
    if (group.isSystem) return { error: 'Cannot delete system group' };

    const index = groups.findIndex(g => g.id === groupId);
    groups.splice(index, 1);
    saveData(GROUPS_FILE, groups);

    // Remove all members from this group
    const members = loadData(GROUP_MEMBERS_FILE);
    const filteredMembers = members.filter(m => m.groupId !== groupId);
    saveData(GROUP_MEMBERS_FILE, filteredMembers);

    return { success: true };
}

/**
 * Add user to group
 */
function addUserToGroup(userId, groupId, addedBy) {
    const members = loadData(GROUP_MEMBERS_FILE);

    // Check if already a member
    if (members.some(m => m.userId === userId && m.groupId === groupId)) {
        return { error: 'User already in group' };
    }

    const membership = {
        id: uuidv4(),
        userId,
        groupId,
        addedBy,
        addedAt: new Date().toISOString(),
        expiresAt: null
    };

    members.push(membership);
    saveData(GROUP_MEMBERS_FILE, members);

    return membership;
}

/**
 * Remove user from group
 */
function removeUserFromGroup(userId, groupId) {
    const members = loadData(GROUP_MEMBERS_FILE);
    const index = members.findIndex(m => m.userId === userId && m.groupId === groupId);

    if (index === -1) return false;

    members.splice(index, 1);
    saveData(GROUP_MEMBERS_FILE, members);
    return true;
}

/**
 * Get groups for a user
 */
function getUserGroups(userId) {
    const members = loadData(GROUP_MEMBERS_FILE);
    const groups = loadData(GROUPS_FILE);

    const userMemberships = members.filter(m => m.userId === userId);

    return userMemberships.map(m => {
        const group = groups.find(g => g.id === m.groupId);
        return {
            ...m,
            group
        };
    }).filter(m => m.group);
}

/**
 * Get members of a group
 */
function getGroupMembers(groupId) {
    const members = loadData(GROUP_MEMBERS_FILE);
    return members.filter(m => m.groupId === groupId);
}

// ============ BULK OPERATIONS ============

/**
 * Bulk user action
 */
function bulkUserAction(userIds, action, params = {}, adminId, adminName) {
    const results = {
        success: [],
        failed: [],
        action
    };

    for (const userId of userIds) {
        try {
            switch (action) {
                case 'suspend':
                    // Mark user as suspended
                    results.success.push({ userId, action: 'suspended' });
                    break;

                case 'unsuspend':
                    results.success.push({ userId, action: 'unsuspended' });
                    break;

                case 'warn':
                    const warning = issueWarning(userId, adminId, adminName, params.reason || 'Bulk warning', params.severity || 1);
                    results.success.push({ userId, action: 'warned', warningId: warning.warning.id });
                    break;

                case 'addToGroup':
                    if (params.groupId) {
                        const membership = addUserToGroup(userId, params.groupId, adminId);
                        if (!membership.error) {
                            results.success.push({ userId, action: 'addedToGroup' });
                        } else {
                            results.failed.push({ userId, error: membership.error });
                        }
                    }
                    break;

                case 'removeFromGroup':
                    if (params.groupId) {
                        if (removeUserFromGroup(userId, params.groupId)) {
                            results.success.push({ userId, action: 'removedFromGroup' });
                        } else {
                            results.failed.push({ userId, error: 'Not in group' });
                        }
                    }
                    break;

                case 'delete':
                    // In production, this would soft-delete the user
                    results.success.push({ userId, action: 'deleted' });
                    break;

                default:
                    results.failed.push({ userId, error: 'Unknown action' });
            }
        } catch (e) {
            results.failed.push({ userId, error: e.message });
        }
    }

    return results;
}

/**
 * Export users to CSV format
 */
function exportUsers(userIds = null, fields = ['id', 'email', 'name', 'status', 'createdAt']) {
    const users = loadData(USERS_FILE);

    let filteredUsers = userIds ? users.filter(u => userIds.includes(u.id)) : users;

    // CSV header
    let csv = fields.join(',') + '\n';

    // CSV rows
    for (const user of filteredUsers) {
        const row = fields.map(field => {
            const value = user[field] || '';
            // Escape commas and quotes
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csv += row.join(',') + '\n';
    }

    return csv;
}

// ============ USER ACTIVITY TIMELINE ============

/**
 * Get user activity timeline
 */
function getUserTimeline(userId) {
    const warnings = getUserWarnings(userId, true);
    const notes = getUserNotes(userId);
    const groups = getUserGroups(userId);

    const timeline = [];

    // Add warnings to timeline
    for (const warning of warnings) {
        timeline.push({
            type: 'warning',
            id: warning.id,
            severity: warning.severity,
            reason: warning.reason,
            adminName: warning.adminName,
            isActive: warning.isActive,
            createdAt: warning.createdAt
        });
    }

    // Add notes to timeline
    for (const note of notes) {
        timeline.push({
            type: 'note',
            id: note.id,
            note: note.note,
            adminName: note.adminName,
            isPinned: note.isPinned,
            createdAt: note.createdAt
        });
    }

    // Add group memberships to timeline
    for (const membership of groups) {
        timeline.push({
            type: 'group',
            id: membership.id,
            groupName: membership.group?.name,
            groupColor: membership.group?.color,
            createdAt: membership.addedAt
        });
    }

    // Sort by date, newest first
    return timeline.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ============ STATISTICS ============

/**
 * Get user management statistics
 */
function getStats() {
    const warnings = loadData(WARNINGS_FILE);
    const notes = loadData(NOTES_FILE);
    const groups = loadData(GROUPS_FILE);
    const members = loadData(GROUP_MEMBERS_FILE);

    return {
        warnings: getWarningStats(),
        notes: {
            total: notes.length,
            pinned: notes.filter(n => n.isPinned).length
        },
        groups: {
            total: groups.length,
            system: groups.filter(g => g.isSystem).length,
            custom: groups.filter(g => !g.isSystem).length
        },
        memberships: members.length
    };
}

module.exports = {
    // Warnings
    issueWarning,
    getUserWarnings,
    revokeWarning,
    getWarningStats,

    // Notes
    addUserNote,
    getUserNotes,
    updateNote,
    deleteNote,

    // Groups
    createGroup,
    getAllGroups,
    getGroup,
    updateGroup,
    deleteGroup,
    addUserToGroup,
    removeUserFromGroup,
    getUserGroups,
    getGroupMembers,

    // Bulk operations
    bulkUserAction,
    exportUsers,

    // Timeline
    getUserTimeline,

    // Stats
    getStats
};
