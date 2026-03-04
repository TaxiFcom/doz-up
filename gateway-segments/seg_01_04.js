    // Subscribe to notifications
    const unsubscribe = notificationService.subscribe(admin.id, (notification) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'notification',
                notification
            }));
        }
    });

    // Send welcome message with unread count
    ws.send(JSON.stringify({
        type: 'connected',
        unreadCount: notificationService.getUnreadCount(admin.id),
        timestamp: Date.now()
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }

            if (data.type === 'mark_read' && data.notificationId) {
                notificationService.markRead(data.notificationId, admin.id);
                ws.send(JSON.stringify({
                    type: 'marked_read',
                    notificationId: data.notificationId,
                    unreadCount: notificationService.getUnreadCount(admin.id)
                }));
            }

            if (data.type === 'mark_all_read') {
                const count = notificationService.markAllRead(admin.id);
                ws.send(JSON.stringify({
                    type: 'all_marked_read',
                    count,
                    unreadCount: 0
                }));
            }

            // Admin replies to support chat user directly via WebSocket
            if (data.type === 'support_reply' && data.fingerprintId && data.message) {
                const client = supportClients.get(data.fingerprintId);
                if (client && client.ws?.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify({
                        type: 'agent_joined',
                        agentName: admin.username || 'Support Team',
                        message: {
                            role: 'ASSISTANT',
                            content: data.message,
                            createdAt: new Date().toISOString(),
                            fromAdmin: true
                        }
                    }));
                    client.conversationHistory.push({ role: 'assistant', content: data.message });
                    ws.send(JSON.stringify({ type: 'support_reply_sent', fingerprintId: data.fingerprintId }));
                    console.log(`[WS Admin] ${admin.username} replied to support user ${data.fingerprintId}`);
                } else {
                    ws.send(JSON.stringify({ type: 'support_reply_failed', reason: 'User disconnected' }));
                }
            }

            // Admin requests list of active support chats
            if (data.type === 'get_support_chats') {
                const chats = [];
                supportClients.forEach((client, fpId) => {
                    if (client.conversationHistory.length > 0) {
                        const lastMsg = client.conversationHistory[client.conversationHistory.length - 1];
                        chats.push({
                            fingerprintId: fpId,
                            messageCount: client.conversationHistory.length,
                            lastMessage: lastMsg.content?.substring(0, 100),
                            lastRole: lastMsg.role,
                            isConnected: client.ws?.readyState === WebSocket.OPEN
                        });
                    }
                });
                ws.send(JSON.stringify({ type: 'support_chats', chats }));
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        unsubscribe();
        adminConnections.delete(connectionId);
        console.log(`[WS Admin] ${admin.username} disconnected - Total: ${adminConnections.size}`);
    });

    ws.on('error', () => {
        unsubscribe();
        adminConnections.delete(connectionId);
    });
});

// Broadcast notification to all connected admins
function broadcastAdminNotification(notification) {
    adminConnections.forEach((conn) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
            // Check if notification targets this admin
            if (!notification.targetUsers || notification.targetUsers.includes(conn.user.id)) {
                conn.ws.send(JSON.stringify({
                    type: 'notification',
                    notification
                }));
            }
        }
    });
}

// ============ LIVE MONITOR WEBSOCKET ============
const monitorWss = new WebSocket.Server({ noServer: true });
const monitorConnections = new Set();

// Live monitor state
const monitorState = {
    todayStats: {
        visitors: 0,
        signups: 0,
        uploads: 0,
        shares: 0,
        sales: 0,
        revenue: 0
    },
    recentActivities: [],
    recentSales: [],
    activeIssues: [],
    geoData: {},
    timeline: new Array(24).fill(0),
    lastReset: new Date().toDateString()
};

// Reset daily stats at midnight
function checkDailyReset() {
    const today = new Date().toDateString();
    if (monitorState.lastReset !== today) {
        monitorState.todayStats = { visitors: 0, signups: 0, uploads: 0, shares: 0, sales: 0, revenue: 0 };
        monitorState.recentActivities = [];
        monitorState.recentSales = [];
        monitorState.timeline = new Array(24).fill(0);
        monitorState.lastReset = today;
    }
}

// Broadcast to all monitor connections
function broadcastMonitor(data) {
    monitorConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(data));
            } catch (e) {}
        }
    });
}

// Track activity for monitor
function trackMonitorActivity(action, details = {}) {
    checkDailyReset();

    const activity = {
        action,
        description: details.description || action,
        page: details.page || '',
        device: details.device || '',
        user: details.user || 'Anonymous',
        country: details.country || '',
        city: details.city || '',
        timestamp: new Date().toISOString()
    };

    monitorState.recentActivities.unshift(activity);
    if (monitorState.recentActivities.length > 100) {
        monitorState.recentActivities.pop();
    }

    // Update timeline
    const hour = new Date().getHours();
    monitorState.timeline[hour]++;

    // Update geo data
    if (details.country) {
        monitorState.geoData[details.country] = monitorState.geoData[details.country] || { count: 0, cities: {} };
        monitorState.geoData[details.country].count++;
        if (details.city) {
            monitorState.geoData[details.country].cities[details.city] =
                (monitorState.geoData[details.country].cities[details.city] || 0) + 1;
        }
    }

    // Update stats
    if (action === 'visit') monitorState.todayStats.visitors++;
    if (action === 'signup') monitorState.todayStats.signups++;
    if (action === 'upload') monitorState.todayStats.uploads++;
    if (action === 'share') monitorState.todayStats.shares++;

    broadcastMonitor({ type: 'activity', ...activity });

    if (details.country) {
        broadcastMonitor({ type: 'geo', country: details.country, city: details.city });
    }
}

// Track sale for monitor
function trackMonitorSale(sale) {
    checkDailyReset();

    const saleData = {
        plan: sale.plan || 'Subscription',
        amount: sale.amount || 0,
        email: sale.email ? sale.email.replace(/(.{2}).*(@.*)/, '$1***$2') : 'Customer',
        timestamp: new Date().toISOString()
    };

    monitorState.recentSales.unshift(saleData);
    if (monitorState.recentSales.length > 50) {
        monitorState.recentSales.pop();
    }

    monitorState.todayStats.sales++;
    monitorState.todayStats.revenue += sale.amount || 0;

    broadcastMonitor({ type: 'sale', ...saleData });
    broadcastMonitor({
        type: 'stats',
        todayRevenue: monitorState.todayStats.revenue,
        todaySales: monitorState.todayStats.sales
    });
}

// Track issue for monitor
function trackMonitorIssue(issue) {
    const issueData = {
        message: issue.message || 'Unknown error',
        severity: issue.severity || 'error',
        page: issue.page || '',
        user: issue.user || 'Anonymous',
        timestamp: new Date().toISOString()
    };

    monitorState.activeIssues.unshift(issueData);
    if (monitorState.activeIssues.length > 50) {
        monitorState.activeIssues.pop();
    }

    broadcastMonitor({ type: 'issue', ...issueData });
}

// Helper to get geo data from request (using Cloudflare headers)
function getGeoFromRequest(req) {
    return {
        country: req.headers['cf-ipcountry'] || req.headers['x-country'] || 'Unknown',
        city: req.headers['cf-ipcity'] || req.headers['x-city'] || ''
    };
}

// Export for global use
global.trackMonitorActivity = trackMonitorActivity;
global.trackMonitorSale = trackMonitorSale;
global.trackMonitorIssue = trackMonitorIssue;
global.getGeoFromRequest = getGeoFromRequest;

monitorWss.on('connection', (ws, req) => {
    monitorConnections.add(ws);
    console.log(`[WS Monitor] Client connected - Total: ${monitorConnections.size}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                checkDailyReset();

                // Send initial state
                ws.send(JSON.stringify({
                    type: 'init',
                    activeUsers: connectedUsers.size,
                    todayRevenue: monitorState.todayStats.revenue,
                    todaySales: monitorState.todayStats.sales,
                    uploadsToday: monitorState.todayStats.uploads,
                    sharesToday: monitorState.todayStats.shares,
                    funnel: {
                        visitors: monitorState.todayStats.visitors,
                        signups: monitorState.todayStats.signups,
                        trials: 0,
                        paid: monitorState.todayStats.sales
                    },
                    timeline: monitorState.timeline,
                    geoData: monitorState.geoData,
                    recentActivities: monitorState.recentActivities.slice(0, 20),
                    recentSales: monitorState.recentSales.slice(0, 10),
                    activeIssues: monitorState.activeIssues.slice(0, 10)
                }));
            }

            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        monitorConnections.delete(ws);
        console.log(`[WS Monitor] Client disconnected - Total: ${monitorConnections.size}`);
    });

    ws.on('error', () => {
        monitorConnections.delete(ws);
    });
});

// Periodic stats broadcast (every 10s, was 5s)
setInterval(() => {
    if (monitorConnections.size > 0) {
        broadcastMonitor({
            type: 'stats',
            activeUsers: connectedUsers.size,
            uploadsToday: monitorState.todayStats.uploads,
            sharesToday: monitorState.todayStats.shares
        });
    }
}, 10000);

// ============ VIRAL DASHBOARD WEBSOCKET ============
const viralWss = new WebSocket.Server({ noServer: true });

viralWss.on('connection', (ws, req) => {
    const url = new URL(req.url, `https://${HOST}`);
    const token = url.searchParams.get('token');

    // Verify viral admin token
    if (!verifyViralToken(token)) {
        // Allow connection but mark as unauthenticated - auth will happen via HTTP
        console.log('[WS Viral] Unauthenticated connection - will verify via API');
    }

    viralWsClients.add(ws);
    console.log(`[WS Viral] Client connected - Total: ${viralWsClients.size}`);

    // Send initial dashboard data
    ws.send(JSON.stringify({ type: 'dashboard', data: viralAnalytics.getDashboard() }));

    ws.on('close', () => {
        viralWsClients.delete(ws);
        console.log(`[WS Viral] Client disconnected - Total: ${viralWsClients.size}`);
    });

    ws.on('error', () => {
        viralWsClients.delete(ws);
    });
});

// ============ REAL-TIME ANALYTICS SYSTEM ============
const analyticsWss = new WebSocket.Server({ noServer: true });

// Path to persistent analytics data
const ANALYTICS_DATA_FILE = path.join(__dirname, 'data', 'analytics-advanced.json');

// Load persistent analytics data from file
function loadPersistentAnalytics() {
    try {
        if (fs.existsSync(ANALYTICS_DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(ANALYTICS_DATA_FILE, 'utf8'));
            return data;
        }
    } catch (err) {
        console.error('[Analytics] Error loading persistent data:', err.message);
    }
    return { pageViews: [], dailyStats: {}, visitors: {} };
}

// Get aggregated stats from persistent data
function getAggregatedPersistentStats() {
    const data = loadPersistentAnalytics();
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = data.dailyStats || {};

    // Calculate totals from all days
    let totalPageViews = 0;
    let totalUniqueVisitors = new Set();
    let totalSessions = 0;
    let totalBounces = 0;
    const allCountries = {};
    const allDevices = { desktop: 0, mobile: 0, tablet: 0 };
    const allBrowsers = {};
    const allSources = { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 };
    const allPages = {};
    const last7Days = [];

    // Get last 7 days for trend chart
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayStats = dailyStats[dateStr] || { pageViews: 0, uniqueVisitors: [] };
        last7Days.push({
            date: dateStr,
            pageViews: dayStats.pageViews || 0,
            uniqueVisitors: Array.isArray(dayStats.uniqueVisitors) ? dayStats.uniqueVisitors.length : 0
        });
    }

    // Aggregate all historical data
    Object.entries(dailyStats).forEach(([date, stats]) => {
        totalPageViews += stats.pageViews || 0;
        if (Array.isArray(stats.uniqueVisitors)) {
            stats.uniqueVisitors.forEach(v => totalUniqueVisitors.add(v));
        }
        totalSessions += stats.sessions || 0;
        totalBounces += stats.bounces || 0;

        // Merge countries
        if (stats.countries) {
            Object.entries(stats.countries).forEach(([country, count]) => {
                allCountries[country] = (allCountries[country] || 0) + count;
            });
        }

        // Merge devices
        if (stats.devices) {
            allDevices.desktop += stats.devices.desktop || 0;
            allDevices.mobile += stats.devices.mobile || 0;
            allDevices.tablet += stats.devices.tablet || 0;
        }

        // Merge browsers
        if (stats.browsers) {
            Object.entries(stats.browsers).forEach(([browser, count]) => {
                allBrowsers[browser] = (allBrowsers[browser] || 0) + count;
            });
        }

        // Merge sources
        if (stats.sources) {
            Object.entries(stats.sources).forEach(([source, count]) => {
                if (allSources[source] !== undefined) {
                    allSources[source] += count;
                }
            });
        }

        // Merge pages
        if (stats.pages) {
            Object.entries(stats.pages).forEach(([page, count]) => {
                allPages[page] = (allPages[page] || 0) + count;
            });
        }
    });

    // Get today's stats from persistent data
    const todayStats = dailyStats[today] || { pageViews: 0, uniqueVisitors: [], sessions: 0, bounces: 0 };

    return {
        total: {
            pageViews: totalPageViews,
            uniqueVisitors: totalUniqueVisitors.size,
            sessions: totalSessions,
            bounceRate: totalPageViews > 0 ? Math.round((totalBounces / totalPageViews) * 100) : 0
        },
        today: {
            pageViews: todayStats.pageViews || 0,
            uniqueVisitors: Array.isArray(todayStats.uniqueVisitors) ? todayStats.uniqueVisitors.length : 0,
            sessions: todayStats.sessions || 0,
            devices: todayStats.devices || { desktop: 0, mobile: 0, tablet: 0 },
            sources: todayStats.sources || { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 },
            countries: todayStats.countries || {},
            pages: todayStats.pages || {},
            browsers: todayStats.browsers || {},
            hourlyViews: todayStats.hourlyDistribution || Array(24).fill(0)
        },
        historical: {
            last7Days,
            countries: allCountries,
            devices: allDevices,
            browsers: allBrowsers,
            sources: allSources,
            pages: allPages
        },
        recentPageViews: (data.pageViews || []).slice(-50).reverse()
    };
}

// In-memory analytics storage
const realtimeAnalytics = {
    activeSessions: new Map(),
    today: {
        pageViews: 0,
        uniqueVisitors: new Set(),
        sessions: 0,
        uploads: 0,
        downloads: 0,
        bounces: 0,
        totalSessionDuration: 0,
        hourlyViews: Array(24).fill(0),
        pages: {},
        sources: { direct: 0, organic: 0, social: 0, referral: 0, paid: 0, email: 0 },
        countries: {},
        cities: {},
        devices: { desktop: 0, mobile: 0, tablet: 0 },
