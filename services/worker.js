/**
 * DOZ UP Background Worker
 * Processes async jobs using BullMQ
 */

const { Worker, Queue } = require('bullmq');
const Redis = require('ioredis');
const path = require('path');
const fs = require('fs');

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null
});

console.log('[Worker] Starting DOZ UP background worker...');
console.log('[Worker] Redis URL:', redisUrl.replace(/\/\/.*@/, '//***@'));

// ============ UPLOAD PROCESSING QUEUE ============
const uploadWorker = new Worker('uploads', async (job) => {
    const { deviceId, filename, buffer, containerHash } = job.data;
    console.log(`[Worker] Processing upload job ${job.id}: ${filename}`);

    try {
        const containerStorage = require('./container-storage');
        const result = await containerStorage.saveFile(
            deviceId,
            filename,
            Buffer.from(buffer)
        );

        console.log(`[Worker] Upload job ${job.id} completed:`, result.success);
        return result;
    } catch (error) {
        console.error(`[Worker] Upload job ${job.id} failed:`, error);
        throw error;
    }
}, { connection, concurrency: 5 });

// ============ EMAIL QUEUE ============
const emailWorker = new Worker('emails', async (job) => {
    const { to, subject, html, template } = job.data;
    console.log(`[Worker] Processing email job ${job.id}: ${subject}`);

    try {
        // Email sending logic would go here
        // For now, just log
        console.log(`[Worker] Would send email to ${to}: ${subject}`);
        return { success: true, to, subject };
    } catch (error) {
        console.error(`[Worker] Email job ${job.id} failed:`, error);
        throw error;
    }
}, { connection, concurrency: 10 });

// ============ CLEANUP QUEUE ============
const cleanupWorker = new Worker('cleanup', async (job) => {
    const { type, maxAgeMs } = job.data;
    console.log(`[Worker] Processing cleanup job ${job.id}: ${type}`);

    try {
        if (type === 'expired-files') {
            const containerStorage = require('./container-storage');
            // Cleanup logic
            console.log('[Worker] Cleanup completed');
            return { success: true, type };
        }
        return { success: true };
    } catch (error) {
        console.error(`[Worker] Cleanup job ${job.id} failed:`, error);
        throw error;
    }
}, { connection, concurrency: 1 });

// ============ P2P CDN QUEUE ============
const p2pWorker = new Worker('p2p', async (job) => {
    const { action, fileId, metadata } = job.data;
    console.log(`[Worker] Processing P2P job ${job.id}: ${action}`);

    try {
        const p2pCDN = require('./p2p-cdn');

        if (action === 'register-file') {
            p2pCDN.registerFile(fileId, metadata);
        } else if (action === 'cleanup-stale-peers') {
            p2pCDN.cleanupStalePeers();
        }

        return { success: true, action };
    } catch (error) {
        console.error(`[Worker] P2P job ${job.id} failed:`, error);
        throw error;
    }
}, { connection, concurrency: 3 });

// ============ ANALYTICS QUEUE ============
const analyticsWorker = new Worker('analytics', async (job) => {
    const { event, data } = job.data;
    console.log(`[Worker] Processing analytics job ${job.id}: ${event}`);

    try {
        // Analytics processing would go here
        console.log(`[Worker] Analytics event: ${event}`, data);
        return { success: true, event };
    } catch (error) {
        console.error(`[Worker] Analytics job ${job.id} failed:`, error);
        throw error;
    }
}, { connection, concurrency: 20 });

// Error handlers
uploadWorker.on('failed', (job, err) => {
    console.error(`[Worker] Upload job ${job?.id} failed:`, err.message);
});

emailWorker.on('failed', (job, err) => {
    console.error(`[Worker] Email job ${job?.id} failed:`, err.message);
});

cleanupWorker.on('failed', (job, err) => {
    console.error(`[Worker] Cleanup job ${job?.id} failed:`, err.message);
});

p2pWorker.on('failed', (job, err) => {
    console.error(`[Worker] P2P job ${job?.id} failed:`, err.message);
});

analyticsWorker.on('failed', (job, err) => {
    console.error(`[Worker] Analytics job ${job?.id} failed:`, err.message);
});

// Completion handlers
uploadWorker.on('completed', (job) => {
    console.log(`[Worker] Upload job ${job.id} completed`);
});

emailWorker.on('completed', (job) => {
    console.log(`[Worker] Email job ${job.id} completed`);
});

// Graceful shutdown
async function shutdown() {
    console.log('[Worker] Shutting down workers...');

    await uploadWorker.close();
    await emailWorker.close();
    await cleanupWorker.close();
    await p2pWorker.close();
    await analyticsWorker.close();
    await connection.quit();

    console.log('[Worker] Workers shut down successfully');
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('[Worker] All workers started and listening for jobs');

// Export for testing
module.exports = {
    uploadWorker,
    emailWorker,
    cleanupWorker,
    p2pWorker,
    analyticsWorker
};
