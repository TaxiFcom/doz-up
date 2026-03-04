        const pathname = req.url.split('?')[0];
        const wsRoutesHttps = {
            '/ws/live': wss,
            '/ws/admin': adminWss,
            '/ws/monitor': monitorWss,
            '/ws/viral': viralWss,
            '/ws/analytics': analyticsWss,
            '/ws/support': supportWss,
            '/ws/agents': agentsWss
        };
        const target = wsRoutesHttps[pathname];
        if (target) {
            target.handleUpgrade(req, socket, head, (ws) => {
                target.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    httpsServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Port ${HTTPS_PORT}] Already in use (nginx handles it), continuing without direct binding`);
            // Don't crash - nginx is handling this port
        } else {
            console.error(`[Port ${HTTPS_PORT}] HTTPS server error:`, err.message);
        }
    });
    // Use setImmediate to ensure error handler is registered
    setImmediate(() => {
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log(`HTTPS server running at https://${HOST}:${HTTPS_PORT}`);
            console.log(`Cloudflare Full SSL mode enabled`);
        });
    });
} else if (NGINX_PROXY) {
    console.log(`[Port ${HTTPS_PORT}] Skipping - nginx is configured as reverse proxy`);
} else {
    console.log(`[Warning] SSL certificates not found in ./ssl/ - HTTPS disabled`);
    console.log(`[Warning] Cloudflare should use Flexible SSL mode`);
}

// ============ DEMO REMINDER SCHEDULER ============
// Check for demos starting soon every minute
const notifiedDemos = new Set();

setInterval(() => {
    try {
        const reminders = schedulingService.getDemosNeedingReminders();

        // Notify for demos starting in 15 minutes
        for (const demo of reminders.in15min || []) {
            const key = `${demo.id}-15min`;
            if (!notifiedDemos.has(key)) {
                notificationService.notifyDemoStartingSoon(demo);
                activityService.log('DEMO_REMINDER', {
                    description: `Demo reminder: ${demo.company} starting in 15 minutes`,
                    entityType: 'demo',
                    entityId: demo.id,
                    entityName: demo.company
                });
                notifiedDemos.add(key);
                console.log(`[Demo Reminder] Sent 15-min reminder for ${demo.company}`);
            }
        }

        // Clean up old notification keys (keep last 100)
        if (notifiedDemos.size > 100) {
            const arr = Array.from(notifiedDemos);
            arr.slice(0, arr.length - 100).forEach(k => notifiedDemos.delete(k));
        }
    } catch (e) {
        console.error('[Demo Reminder] Error:', e.message);
    }
}, 60000); // Check every minute

// ============ GRACEFUL SHUTDOWN ============
function gracefulShutdown(signal) {
    console.log(`[Shutdown] ${signal} received, closing servers...`);
    const forceTimeout = setTimeout(() => {
        console.log('[Shutdown] Force exit after 5s timeout');
        process.exit(0);
    }, 5000);
    forceTimeout.unref();

    let closed = 0;
    const servers = [httpServer80, server, httpsServer].filter(Boolean);
    const total = servers.length;

    servers.forEach(s => {
        s.close(() => {
            closed++;
            if (closed >= total) {
                console.log('[Shutdown] All servers closed cleanly');
                clearTimeout(forceTimeout);
                process.exit(0);
            }
        });
    });
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

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
