/**
 * DOZ UP - Restart Coordination Lock
 * Prevents multiple monitoring services from triggering simultaneous gateway restarts.
 * Uses a file-based lock with 2-minute TTL.
 */
const fs = require('fs');
const path = require('path');

const LOCK_FILE = path.join(__dirname, '..', 'data', 'restart-lock.json');
const LOCK_TTL = 120000; // 2 minutes

function acquireLock(owner) {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
            if (Date.now() - lock.timestamp < LOCK_TTL) {
                return false; // Someone else holds the lock
            }
        }
        fs.writeFileSync(LOCK_FILE, JSON.stringify({
            owner: owner,
            timestamp: Date.now(),
            pid: process.pid
        }));
        return true;
    } catch (e) {
        return false;
    }
}

function releaseLock(owner) {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
            if (lock.owner === owner) {
                fs.unlinkSync(LOCK_FILE);
            }
        }
    } catch (e) {}
}

function isLocked() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
            return Date.now() - lock.timestamp < LOCK_TTL;
        }
    } catch (e) {}
    return false;
}

module.exports = { acquireLock, releaseLock, isLocked };
