            description: `Demo scheduled: ${demo.company} - ${demo.date} at ${demo.time}`,
            entityType: 'demo',
            entityId: demo.id,
            entityName: demo.company
        });

        // Trigger webhooks
        webhookService.trigger('demo.scheduled', demo);

        res.json({ success: true, demo });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get demo by ID
app.get('/api/scheduling/demos/:id', (req, res) => {
    const demo = schedulingService.getDemo(req.params.id);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Get all demos
app.get('/api/scheduling/demos', (req, res) => {
    const filters = {
        status: req.query.status,
        date: req.query.date,
        leadId: req.query.leadId
    };
    const demos = schedulingService.getDemos(filters);
    res.json({ success: true, demos, count: demos.length });
});

// Get upcoming demos
app.get('/api/scheduling/upcoming', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const demos = schedulingService.getUpcomingDemos(limit);
    res.json({ success: true, demos, count: demos.length });
});

// Get today's demos
app.get('/api/scheduling/today', (req, res) => {
    const demos = schedulingService.getTodaysDemos();
    res.json({ success: true, demos, count: demos.length });
});

// Update demo
app.put('/api/scheduling/demos/:id', express.json(), (req, res) => {
    const demo = schedulingService.updateDemo(req.params.id, req.body);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Complete demo with outcome
app.post('/api/scheduling/demos/:id/complete', express.json(), (req, res) => {
    const demo = schedulingService.completeDemo(req.params.id, req.body);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Cancel demo
app.post('/api/scheduling/demos/:id/cancel', express.json(), (req, res) => {
    const reason = req.body.reason || '';
    const demo = schedulingService.cancelDemo(req.params.id, reason);
    if (!demo) {
        return res.status(404).json({ error: 'Demo not found' });
    }
    res.json({ success: true, demo });
});

// Reschedule demo
app.post('/api/scheduling/demos/:id/reschedule', express.json(), (req, res) => {
    try {
        const { date, time } = req.body;
        const demo = schedulingService.rescheduleDemo(req.params.id, date, time);
        if (!demo) {
            return res.status(404).json({ error: 'Demo not found' });
        }
        res.json({ success: true, demo });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get scheduling stats
app.get('/api/scheduling/stats', (req, res) => {
    const stats = schedulingService.getStats();
    res.json({ success: true, ...stats });
});

// Get availability settings
app.get('/api/scheduling/availability', (req, res) => {
    const availability = schedulingService.getAvailability();
    res.json({ success: true, availability });
});

// Update availability settings
app.put('/api/scheduling/availability', express.json(), (req, res) => {
    const availability = schedulingService.updateAvailability(req.body);
    res.json({ success: true, availability });
});

// Get demos needing reminders
app.get('/api/scheduling/reminders', (req, res) => {
    const reminders = schedulingService.getDemosNeedingReminders();
    res.json({ success: true, ...reminders });
});

// ============ PROPOSALS API ============

// Create proposal
app.post('/api/proposals', express.json(), (req, res) => {
    try {
        const proposal = proposalService.createProposal(req.body);
        res.json({ success: true, proposal });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get proposal by ID
app.get('/api/proposals/:id', (req, res) => {
    const proposal = proposalService.getProposal(req.params.id);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Get proposal by number
app.get('/api/proposals/number/:number', (req, res) => {
    const proposal = proposalService.getProposalByNumber(req.params.number);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Get all proposals
app.get('/api/proposals', (req, res) => {
    const filters = {
        status: req.query.status,
        leadId: req.query.leadId,
        company: req.query.company
    };
    const proposals = proposalService.getProposals(filters);
    res.json({ success: true, proposals, count: proposals.length });
});

// Update proposal
app.put('/api/proposals/:id', express.json(), (req, res) => {
    const proposal = proposalService.updateProposal(req.params.id, req.body);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Send proposal
app.post('/api/proposals/:id/send', (req, res) => {
    const proposal = proposalService.sendProposal(req.params.id);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Track proposal view
app.post('/api/proposals/:id/view', (req, res) => {
    const proposal = proposalService.trackView(req.params.id);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }

    // Notify when proposal is viewed (only on first view or significant views)
    if (proposal.viewCount === 1 || proposal.viewCount % 5 === 0) {
        notificationService.notifyProposalViewed(proposal);
    }

    res.json({ success: true, proposal });
});

// Accept proposal
app.post('/api/proposals/:id/accept', express.json(), (req, res) => {
    const acceptedBy = req.body.acceptedBy || '';
    const proposal = proposalService.acceptProposal(req.params.id, acceptedBy);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }

    // Notify and log proposal acceptance
    notificationService.notifyProposalAccepted(proposal);
    activityService.log('PROPOSAL_ACCEPTED', {
        description: `Proposal accepted: ${proposal.company} - $${(proposal.finalPrice / 100).toLocaleString()}`,
        entityType: 'proposal',
        entityId: proposal.id,
        entityName: proposal.company
    });
    webhookService.trigger('proposal.accepted', proposal);

    res.json({ success: true, proposal });
});

// Decline proposal
app.post('/api/proposals/:id/decline', express.json(), (req, res) => {
    const reason = req.body.reason || '';
    const proposal = proposalService.declineProposal(req.params.id, reason);
    if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json({ success: true, proposal });
});

// Generate HTML proposal
app.get('/api/proposals/:id/html', (req, res) => {
    const html = proposalService.generateHTML(req.params.id);
    if (!html) {
        return res.status(404).json({ error: 'Proposal not found' });
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// Get proposal stats
app.get('/api/proposals/stats/overview', (req, res) => {
    const stats = proposalService.getStats();
    res.json({ success: true, ...stats });
});

// Check for expired proposals
app.post('/api/proposals/check-expired', (req, res) => {
    const expiredCount = proposalService.checkExpired();
    res.json({ success: true, expiredCount });
});

// Public proposal view page (for clients)
app.get('/v2/proposal/:id', (req, res) => {
    const proposal = proposalService.getProposal(req.params.id);
    if (!proposal) {
        return res.status(404).send('Proposal not found');
    }
    // Track view
    proposalService.trackView(req.params.id);
    // Return HTML
    const html = proposalService.generateHTML(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// Public proposal accept endpoint
app.get('/v2/accept/:id', (req, res) => {
    const proposal = proposalService.getProposal(req.params.id);
    if (!proposal) {
        return res.status(404).send('Proposal not found');
    }
    // Show acceptance confirmation page
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Accept Proposal - DOZ UP</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 500px; text-align: center; }
        h1 { color: #4CAF50; }
        .proposal-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
        .btn { background: #4CAF50; color: white; border: none; padding: 15px 40px; font-size: 16px; border-radius: 6px; cursor: pointer; margin: 10px; }
        .btn:hover { background: #45a049; }
        .btn-secondary { background: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Confirm Acceptance</h1>
        <p>You are about to accept the proposal for:</p>
        <div class="proposal-details">
            <strong>${proposal.company}</strong><br>
            Plan: ${proposal.tierName}<br>
            Price: $${(proposal.finalPrice / 100).toLocaleString()}/year<br>
            Proposal #: ${proposal.proposalNumber}
        </div>
        <form action="/api/proposals/${proposal.id}/accept" method="POST">
            <input type="hidden" name="acceptedBy" value="${proposal.contactEmail}">
            <button type="submit" class="btn">Confirm & Accept</button>
            <a href="/v2/proposal/${proposal.id}" class="btn btn-secondary">View Proposal</a>
        </form>
    </div>
</body>
</html>
    `);
});

// V2 Admin pages
app.get('/v2/admin', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'index.html'));
});

// Sales Dashboard
app.get('/v2/admin/sales', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'sales.html'));
});

// Security Dashboard
app.get('/v2/admin/security', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'security.html'));
});

// Admin Login
app.get('/v2/admin/login', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'login.html'));
});

app.get('/v2/admin/*', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'admin', 'index.html'));
});

// V2 Landing page
app.get('/v2', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'index.html'));
});

// V2 Pricing page
app.get('/v2/pricing', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'pricing.html'));
});

// V2 Enterprise page
app.get('/v2/enterprise', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'enterprise.html'));
});

// V2 Dashboard
app.get('/v2/dashboard', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'dashboard.html'));
});

// V2 Payment success page
app.get('/v2/payment/success', (req, res) => {
    res.sendFile(path.join(subscriptionDir, 'public', 'payment', 'success.html'));
});

// V2 Payment cancel page
app.get('/v2/payment/cancel', (req, res) => {
    res.redirect('/v2/pricing?cancelled=true');
});

// ============ SECURITY MIDDLEWARE ============
// (Security headers middleware moved to early middleware chain — before routes)

// Rate limiting middleware for API routes
const rateLimitMiddleware = (endpoint = 'default') => {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const config = securityService.getRateLimitConfig(endpoint);
        const result = securityService.checkRateLimit(ip + ':' + endpoint, config.limit, config.window);

        res.setHeader('X-RateLimit-Limit', config.limit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', result.resetAt);

        if (!result.allowed) {
            res.setHeader('Retry-After', result.retryAfter);
            return res.status(429).json({ error: 'Too many requests', retryAfter: result.retryAfter });
        }
        next();
    };
};

// ============ ADMIN AUTHENTICATION API ============

// Test endpoint to verify code changes are loaded
app.get('/api/test-code-update', (req, res) => {
    console.log('[TEST] Code update endpoint called');
    res.json({ updated: true, timestamp: Date.now() });
});

app.post('/api/admin/auth/login', (req, res, next) => {
    // Wrap express.json in error handling
    express.json()(req, res, (err) => {
        if (err) {
            console.error('[Admin Login] JSON parse error:', err.message);
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        next();
    });
}, async (req, res) => {
    try {
        console.log('[Admin Login] Request received, body:', JSON.stringify(req.body));
        const { username, password, deviceId } = req.body;
        console.log('[Admin Login] Username:', username, 'Password length:', password?.length);
        const ip = req.ip || req.connection.remoteAddress;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Check device binding before login
        const adminSettingsPath = path.join(__dirname, 'data', 'admin-settings.json');
        try {
            if (fs.existsSync(adminSettingsPath)) {
                const settings = JSON.parse(fs.readFileSync(adminSettingsPath, 'utf8'));
                if (settings.deviceBinding && settings.deviceBinding.enabled) {
                    if (!deviceId || deviceId !== settings.deviceBinding.deviceId) {
                        return res.status(403).json({
                            error: 'Access denied: This device is not authorized to access admin panel',
                            code: 'DEVICE_NOT_BOUND'
                        });
                    }
                }
            }
        } catch (e) {
            console.error('[Admin] Error checking device binding at login:', e);
        }

        const result = await adminService.login(username, password, ip);
        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }
        activityService.log('ADMIN_LOGIN', { userId: result.admin.id, userName: result.admin.username, ip, deviceId });
        res.json(result);
    } catch (error) {
        console.error('[Admin Login Error]', error.message, error.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/auth/logout', requireAdmin(), (req, res) => {
    adminService.logout(req.session?.sessionId);
    res.json({ success: true });
});

app.get('/api/admin/auth/me', requireAdmin(), (req, res) => {
    const { getDashboardPermissions } = require('./services/admin');
    const dashboardPerms = getDashboardPermissions(req.admin.role);
    res.json({
        success: true,
        admin: req.admin,
        permissions: adminService.getPermissions(req.admin.id),
        dashboardPermissions: dashboardPerms
    });
});

// Get dashboard permissions for current user's role
app.get('/api/admin/dashboard-permissions', requireAdmin(), (req, res) => {
    const { getDashboardPermissions, ROLES } = require('./services/admin');
    const dashboardPerms = getDashboardPermissions(req.admin.role);
    res.json({
        success: true,
        ...dashboardPerms,
        allRoles: Object.entries(ROLES).map(([id, role]) => ({
            id,
            name: role.name,
            level: role.level,
            type: role.type
        }))
    });
});

app.post('/api/admin/auth/change-password', requireAdmin(), express.json(), (req, res) => {
    try {
        adminService.changePassword(req.admin.id, req.body.currentPassword, req.body.newPassword);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ============ ADMIN MANAGEMENT API ============

app.get('/api/admin/users/admins', requireAdmin('users:read'), (req, res) => {
    res.json({ success: true, admins: adminService.getAdmins() });
});

app.post('/api/admin/users/admins', requireAdmin('users:write'), express.json(), (req, res) => {
    try {
        const admin = adminService.createAdmin(req.body, req.admin.id);
        res.json({ success: true, admin });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/admin/roles', requireAdmin(), (req, res) => {
    res.json({ success: true, roles: adminService.getRoles() });
});

// ============ ACTIVITY LOG API ============

app.get('/api/admin/activities', requireAdmin('analytics:read'), (req, res) => {
    const result = activityService.getActivities({
        category: req.query.category,
        type: req.query.type,
        offset: parseInt(req.query.offset) || 0,
        limit: parseInt(req.query.limit) || 50
    });
