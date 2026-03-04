    } catch (e) {
        score -= 50;
    }

    res.json({
        status: score >= 50 ? 'ok' : 'degraded',
        score,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        heapUsedMB
    });
});

// ============ AI HEALTH MONITOR - REPORT GENERATOR & SCHEDULER ============

async function generateAIHealthReport() {
    const startTime = Date.now();
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    let score = 100;
    const issues = [];
    const recommendations = [];

    // Check upload directory writable
    try {
        const probe = path.join(uploadsDir, '.ai-health-' + Date.now());
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
    } catch (e) {
        score -= 30;
        issues.push('Upload directory not writable');
        recommendations.push('Check disk space and directory permissions');
    }

    // Check memory usage
    if (heapMB > 600) {
        score -= 25;
        issues.push('Critical memory: ' + heapMB + 'MB');
        recommendations.push('Restart gateway to free memory');
    } else if (heapMB > 400) {
        score -= 10;
        issues.push('High memory: ' + heapMB + 'MB');
    }

    // Check upload success rate
    const totalUploads = uploadMetrics.successCount + uploadMetrics.failureCount;
    const successRate = totalUploads > 0 ? Math.round((uploadMetrics.successCount / totalUploads) * 100) : 100;
    if (successRate < 80 && totalUploads > 5) {
        score -= 20;
        issues.push('Upload success rate: ' + successRate + '% (' + uploadMetrics.failureCount + ' failures)');
        recommendations.push('Check disk space and upload permissions');
    }

    // Check WebSocket connections
    const wsCount = connectedUsers.size;
    const adminCount = adminConnections.size;
    if (wsCount > 500) {
        score -= 10;
        issues.push('High WebSocket connections: ' + wsCount);
        recommendations.push('Monitor for connection leaks');
    }

    // Check upload file count
    let uploadCount = 0;
    try {
        uploadCount = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.')).length;
    } catch (e) {}
    if (uploadCount > 50000) {
        score -= 5;
        issues.push('Storage: ' + uploadCount + ' files in uploads');
        recommendations.push('Consider archiving old uploads');
    }

    // Check uptime (just restarted = potential issue)
    const uptimeSec = Math.floor(process.uptime());
    if (uptimeSec < 120) {
        issues.push('Recently restarted (' + uptimeSec + 's ago)');
    }

    return {
        timestamp: new Date().toISOString(),
        score: Math.max(0, score),
        status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'critical',
        uptime: uptimeSec,
        uptimeFormatted: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
        memory: { heapMB, rssMB: Math.round(mem.rss / 1024 / 1024) },
        connections: { users: wsCount, admin: adminCount },
        uploads: { fileCount: uploadCount, successRate, totalSinceReset: totalUploads },
        issues,
        recommendations,
        checkDurationMs: Date.now() - startTime
    };
}

// Run AI health check every 3 hours
setInterval(async () => {
    try {
        const report = await generateAIHealthReport();
        AI_HEALTH_REPORTS.unshift(report);
        if (AI_HEALTH_REPORTS.length > AI_HEALTH_MAX_REPORTS) AI_HEALTH_REPORTS.pop();

        // Broadcast to admin WebSocket connections
        const alertData = JSON.stringify({ type: 'ai-health-report', report });
        adminConnections.forEach((conn) => {
            try { if (conn.ws && conn.ws.readyState === 1) conn.ws.send(alertData); } catch (e) {}
        });

        console.log(`[AI Monitor] Health score: ${report.score}/100 | ${report.status} | ${report.issues.length} issues`);
    } catch (e) {
        console.error('[AI Monitor] Check failed:', e.message);
    }
}, 3 * 60 * 60 * 1000);

// Initial health check 60s after startup
setTimeout(async () => {
    try {
        const report = await generateAIHealthReport();
        AI_HEALTH_REPORTS.unshift(report);
        console.log(`[AI Monitor] Initial health score: ${report.score}/100 | ${report.status}`);
    } catch (e) {}
}, 60000);

// Admin API: AI health report history
app.get('/api/admin/ai-health', (req, res) => {
    res.json({
        reports: AI_HEALTH_REPORTS,
        intervalHours: 3,
        totalReports: AI_HEALTH_REPORTS.length,
        maxReports: AI_HEALTH_MAX_REPORTS
    });
});

// Admin API: latest AI health report
app.get('/api/admin/ai-health/latest', (req, res) => {
    res.json(AI_HEALTH_REPORTS[0] || { status: 'pending', message: 'First check runs 60s after startup' });
});

// ============ AI OPERATIONS CENTER ENDPOINTS ============
app.get('/api/admin/ai-ops/status', (req, res) => {
    res.json(aiOpsCenter.getStatus());
});

app.get('/api/admin/ai-ops/scan', async (req, res) => {
    try {
        const scan = await aiOpsCenter.runFullScan();
        res.json({ success: true, scan });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/admin/ai-ops/report', async (req, res) => {
    try {
        const report = await aiOpsCenter.generateFullReport();
        res.json({ success: true, report });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============ DASHBOARD REAL DATA ENDPOINTS ============
app.get('/api/admin/dashboard/stats', (req, res) => {
    try {
        res.json(dashboardStats.getAllStats());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/tickets', (req, res) => {
    try {
        res.json(dashboardStats.getTickets());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/subscriptions', (req, res) => {
    try {
        res.json(dashboardStats.getSubscriptions());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/mrr', (req, res) => {
    try {
        res.json({ mrr: dashboardStats.getMRR() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/traffic-sources', (req, res) => {
    try {
        res.json(dashboardStats.getTrafficSources());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/growth-chart', (req, res) => {
    try {
        res.json(dashboardStats.getGrowthChart());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/dashboard/roi', (req, res) => {
    try {
        res.json(dashboardStats.getROIData());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ AI AGENT FLEET ENDPOINTS ============
app.get('/api/agents/status', (req, res) => {
    res.json(agentOrchestrator.getStatus());
});

app.post('/api/agents/run-all', (req, res) => {
    agentOrchestrator.runAll();
    res.json({ success: true, message: 'Full agent cycle started' });
});

app.post('/api/agents/run/:id', async (req, res) => {
    try {
        agentOrchestrator.runAgent(req.params.id);
        res.json({ success: true, message: `Agent ${req.params.id} started` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/run-department/:dept', (req, res) => {
    try {
        agentOrchestrator.runDepartment(req.params.dept);
        res.json({ success: true, message: `${req.params.dept} department started` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/agents/findings', (req, res) => {
    res.json(agentOrchestrator.getFindings({
        severity: req.query.severity,
        department: req.query.department,
        limit: parseInt(req.query.limit) || 100
    }));
});

// ============ ORCHESTRATOR V2 API (1000+ Agents) ============
app.get('/api/agents/v2/status', (req, res) => {
    try {
        res.json(orchestratorV2.getStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/agents/v2/findings', (req, res) => {
    try {
        res.json(orchestratorV2.getFindings({
            severity: req.query.severity,
            department: req.query.department,
            agentId: req.query.agentId,
            limit: parseInt(req.query.limit) || 200
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/agents/v2/agents', (req, res) => {
    try {
        res.json(orchestratorV2.getAgentList({
            department: req.query.department,
            priority: req.query.priority,
            state: req.query.state
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/agents/v2/run-all', (req, res) => {
    try {
        orchestratorV2.runAll();
        res.json({ success: true, message: 'V2 full cycle started (all tiers)' });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/v2/run-tier/:tier', (req, res) => {
    try {
        orchestratorV2.runTier(req.params.tier);
        res.json({ success: true, message: `Tier ${req.params.tier} started` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/v2/run-department/:dept', async (req, res) => {
    try {
        await orchestratorV2.runDepartment(req.params.dept);
        res.json({ success: true, message: `Department ${req.params.dept} completed` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/agents/v2/run/:agentId', async (req, res) => {
    try {
        await orchestratorV2.runAgent(req.params.agentId);
        res.json({ success: true, message: `Agent ${req.params.agentId} completed` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/doz-brains/status', async (req, res) => {
    res.json(await dozBrains.getStatus());
});

app.post('/api/doz-brains/chat', async (req, res) => {
    try {
        const { model, messages, prompt } = req.body;
        let result;
        if (prompt) {
            result = await dozBrains.think(prompt);
        } else if (messages) {
            result = await dozBrains.chat(model, messages);
        } else {
            return res.json({ success: false, error: 'Provide prompt or messages' });
        }
        res.json({ success: true, response: result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============ AI-POWERED DIAGNOSTICS SYSTEM ============

// AI Diagnostic endpoint - real-time issue detection and resolution
app.get('/api/diagnostics', async (req, res) => {
    const uploadsPath = path.join(__dirname, 'uploads');
    const diagnostics = {
        timestamp: Date.now(),
        server: { status: 'ok', uptime: process.uptime(), pid: process.pid },
        upload: { status: 'ok' },
        storage: { status: 'ok' },
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        issues: [],
        fixes: []
    };

    try {
        // Check uploads directory
        if (!fs.existsSync(uploadsPath)) {
            diagnostics.storage.status = 'error';
            diagnostics.issues.push('uploads_dir_missing');
            fs.mkdirSync(uploadsPath, { recursive: true });
            diagnostics.fixes.push('created_uploads_dir');
        }

        // Check write permissions
        const testFile = path.join(uploadsPath, '.write-test-' + Date.now());
        try {
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
        } catch (e) {
            diagnostics.upload.status = 'error';
            diagnostics.issues.push('no_write_permission');
        }

        // Memory check
        if (diagnostics.memory.used > 500) {
            diagnostics.issues.push('high_memory_usage');
            if (global.gc) {
                global.gc();
                diagnostics.fixes.push('triggered_gc');
            }
        }

        // Count files in uploads
        try {
            const files = fs.readdirSync(uploadsPath);
            diagnostics.storage.fileCount = files.length;
        } catch (e) {
            diagnostics.storage.fileCount = 0;
        }

        diagnostics.healthy = diagnostics.issues.length === 0;
        diagnostics.autoFixed = diagnostics.fixes.length;

    } catch (e) {
        diagnostics.error = e.message;
        diagnostics.healthy = false;
    }

    res.json(diagnostics);
});

// Real-time upload error resolution - AI-powered
app.post('/api/upload-check', express.json(), async (req, res) => {
    const { errorType, errorMessage, errorCode, deviceId, fileSize, fileType, httpStatus } = req.body;

    try {
        const result = await aiErrorInterceptor.handleUploadError({
            message: errorMessage || errorType || 'Unknown upload error',
            errorCode: errorCode || '',
            deviceId: deviceId || 'web',
            fileSize: fileSize || 0,
            fileType: fileType || '',
            endpoint: req.body.endpoint || '/upload',
            httpStatus: httpStatus || 0,
        });

        console.log(`[AI-Upload] Device: ${deviceId}, Error: ${(errorMessage || '').substring(0, 80)}, canRetry: ${result.canRetry}, strategy: ${result.retryStrategy}`);

        res.json({
            canRetry: result.canRetry,
            retryDelay: result.retryDelay,
            retryStrategy: result.retryStrategy,
            suggestion: result.retryStrategy,
            tip: result.uploadTip,
            aiHandled: result.handled,
            issueId: result.issueId,
            serverStatus: result.handled ? 'recovering' : 'ok',
        });
    } catch (err) {
        console.error('[AI-Upload] Error in upload-check:', err.message);
        // Fallback if AI fails
        res.json({
            canRetry: true,
            retryDelay: 500,
            suggestion: 'retry_generic',
            tip: 'Retrying upload...',
            aiHandled: false,
        });
    }
});

// Upload health pre-flight check
app.get('/api/upload-health', async (req, res) => {
    const deviceId = req.query.device || req.headers['x-device-id'] || 'web';
    const userId = req.query.userId || req.headers['x-user-id'];

    const health = {
        healthy: true,
        timestamp: Date.now(),
        checks: {},
        issues: [],
        recommendations: [],
    };

    // 1. Write permission check
    try {
        const testFile = path.join(uploadsDir, '.health-check-' + Date.now());
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        health.checks.writePermission = { status: 'ok' };
    } catch (e) {
        health.checks.writePermission = { status: 'error', error: e.code };
        health.issues.push('no_write_permission');
        health.healthy = false;
    }

    // 2. Daily upload limit check - respect paid user status via plan resolver
    const isPaidUser = planResolver.isPaidUser(userId, deviceId);
    const limitStatus = checkDailyUploadLimit(deviceId, isPaidUser);
    health.checks.dailyLimit = {
        status: limitStatus.allowed ? 'ok' : 'limit_reached',
        used: limitStatus.used,
        limit: isPaidUser ? 'unlimited' : limitStatus.limit,
        remaining: isPaidUser ? 'unlimited' : limitStatus.remaining,
        tier: isPaidUser ? 'paid' : 'free',
    };
    if (!limitStatus.allowed) {
        health.issues.push('daily_limit_reached');
        health.recommendations.push('Daily upload limit reached. Resets at midnight.');
    }

    // 3. Memory check
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    health.checks.memory = {
        status: heapUsedMB < 400 ? 'ok' : heapUsedMB < 600 ? 'warning' : 'critical',
        heapUsedMB,
    };
    if (heapUsedMB >= 600) {
        health.issues.push('high_memory');
        health.healthy = false;
    }
