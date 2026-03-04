    } catch (error) {
        console.error('[Login] Exception:', error.message, error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Forgot Password - Request password reset email
app.post('/api/auth/forgot-password', express.json(), async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const result = authService.generatePasswordResetToken(email);

        // If token was generated, send email directly via SMTP
        if (result.token) {
            const resetUrl = `https://doz.com/reset-password.html?token=${result.token}`;
            const resetHtml = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #10b981; margin: 0;">DOZ UP</h1>
                        <p style="color: #64748b; margin: 5px 0;">Password Reset Request</p>
                    </div>
                    <div style="background: #f8fafc; border-radius: 12px; padding: 30px;">
                        <p style="color: #334155; margin: 0 0 20px;">Hi,</p>
                        <p style="color: #334155; margin: 0 0 20px;">We received a request to reset your password. Click the button below to create a new password:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600;">Reset Password</a>
                        </div>
                        <p style="color: #64748b; font-size: 14px; margin: 0 0 10px;">Or copy this link:</p>
                        <p style="color: #10b981; font-size: 14px; word-break: break-all; margin: 0 0 20px;">${resetUrl}</p>
                        <p style="color: #64748b; font-size: 14px; margin: 0;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 30px;">DOZ UP - Instant Screenshot Sharing</p>
                </div>
            `;

            // Send directly via nodemailer SMTP (no Redis/queue dependency)
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '465'),
                    secure: process.env.SMTP_SECURE !== 'false',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                });
                await transporter.sendMail({
                    from: `"${process.env.EMAIL_FROM_NAME || 'DOZ UP'}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
                    to: result.email,
                    subject: 'DOZ UP - Password Reset Request',
                    html: resetHtml,
                    text: `DOZ UP Password Reset\n\nWe received a request to reset your password.\n\nClick this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`
                });
                console.log('[Auth] Password reset email sent directly to:', result.email);
            } catch (emailError) {
                console.error('[Auth] Failed to send reset email:', emailError.message);
                console.log('[Auth] Reset URL for manual recovery:', resetUrl);
            }
        }

        // Always return success to prevent email enumeration
        res.json({ success: true, message: 'If an account exists with this email, a password reset link has been sent.' });
    } catch (error) {
        console.error('[Auth] Forgot password error:', error);
        res.status(500).json({ success: false, error: 'Failed to process request' });
    }
});

// Verify password reset token
app.get('/api/auth/verify-reset-token', (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ valid: false, error: 'Token is required' });
        }

        const result = authService.verifyPasswordResetToken(token);
        res.json(result);
    } catch (error) {
        res.status(500).json({ valid: false, error: error.message });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', express.json(), (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ success: false, error: 'Token and password are required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        }

        const result = authService.resetPassword(token, password);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ GOOGLE OAUTH CALLBACK ============
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '111250241426-duot1f1icje3d5p06nkvd3qreqkgccuk.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            console.error('[Google OAuth] Error:', error);
            return res.send(`
                <html><body><script>
                    window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: '${error}' }));
                    window.close();
                </script></body></html>
            `);
        }

        if (!code) {
            return res.send(`
                <html><body><script>
                    window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: 'No authorization code received' }));
                    window.close();
                </script></body></html>
            `);
        }

        // Exchange code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: `${req.protocol}://${req.get('host')}/auth/google/callback`,
                grant_type: 'authorization_code'
            })
        });

        const tokens = await tokenResponse.json();

        if (tokens.error) {
            console.error('[Google OAuth] Token error:', tokens.error);
            return res.send(`
                <html><body><script>
                    window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: '${tokens.error_description || tokens.error}' }));
                    window.close();
                </script></body></html>
            `);
        }

        // Get user info
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const googleUser = await userResponse.json();

        // Create or get user in our system
        let user = authService.getUserByEmail?.(googleUser.email);
        if (!user) {
            // Auto-register Google user
            const result = authService.registerUser(googleUser.email, null, googleUser.name);
            if (result.success) {
                user = {
                    id: result.userId,
                    email: googleUser.email,
                    name: googleUser.name,
                    avatar: googleUser.picture,
                    provider: 'google'
                };
            }
        } else {
            user = {
                id: user.id,
                email: user.email,
                name: user.name || googleUser.name,
                avatar: googleUser.picture,
                provider: 'google'
            };
        }

        console.log('[Google OAuth] User authenticated:', googleUser.email);

        // Send result back to parent window with multiple fallback methods
        res.send(`
            <html><body>
            <p style="font-family:system-ui;text-align:center;margin-top:50px;">Logging you in...</p>
            <script>
                const result = ${JSON.stringify({ success: true, user })};

                // Method 1: sessionStorage (same origin)
                try {
                    if (window.opener && window.opener.sessionStorage) {
                        window.opener.sessionStorage.setItem('oauth_result', JSON.stringify(result));
                    }
                } catch(e) { console.log('sessionStorage failed:', e); }

                // Method 2: postMessage (cross-origin safe)
                try {
                    if (window.opener) {
                        window.opener.postMessage({ type: 'oauth_result', ...result }, '*');
                    }
                } catch(e) { console.log('postMessage failed:', e); }

                // Method 3: localStorage fallback
                try {
                    localStorage.setItem('oauth_result', JSON.stringify(result));
                } catch(e) {}

                // Close after small delay to ensure message is sent
                setTimeout(() => window.close(), 500);
            </script></body></html>
        `);

    } catch (error) {
        console.error('[Google OAuth] Callback error:', error);
        res.send(`
            <html><body>
            <p style="font-family:system-ui;text-align:center;margin-top:50px;color:red;">Login failed</p>
            <script>
                const result = { success: false, error: 'Authentication failed' };
                try { window.opener?.sessionStorage.setItem('oauth_result', JSON.stringify(result)); } catch(e) {}
                try { window.opener?.postMessage({ type: 'oauth_result', ...result }, '*'); } catch(e) {}
                try { localStorage.setItem('oauth_result', JSON.stringify(result)); } catch(e) {}
                setTimeout(() => window.close(), 1000);
            </script></body></html>
        `);
    }
});

// ============ INSTANT SIGNUP (Biometric/Pattern) ============
// Create account instantly with just fingerprint or pattern - no email/password needed
app.post('/api/auth/instant-signup', express.json(), (req, res) => {
    try {
        const { deviceId, authMethod, userAgent, platform, language } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Generate unique user ID
        const userId = 'bio_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // Create user object
        const user = {
            id: userId,
            deviceId: deviceId,
            name: 'DOZ User',
            email: deviceId + '@doz.com',
            provider: authMethod || 'biometric',
            authMethod: authMethod,
            createdAt: new Date().toISOString(),
            platform: platform,
            language: language,
            subscription: 'free',
            isVerified: true // Biometric = verified
        };

        // Store in auth service if available
        if (authService.createBiometricUser) {
            authService.createBiometricUser(user);
        }

        console.log(`[Auth] Instant signup: ${userId} via ${authMethod}`);

        res.json({
            success: true,
            user: user,
            message: 'Account created successfully'
        });

    } catch (error) {
        console.error('[Auth] Instant signup error:', error);
        res.status(500).json({ success: false, error: 'Signup failed' });
    }
});

// ============ FRICTIONLESS AUTO-REGISTRATION ============
// Auto-register user based on device fingerprint (no signup form needed)
app.post('/api/auth/auto-register', express.json(), (req, res) => {
    try {
        const { deviceId, userAgent, platform, timezone, language } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Check if device already registered
        let existingUser = authService.getUserByDeviceId?.(deviceId);
        if (existingUser) {
            return res.json({
                success: true,
                user: {
                    id: existingUser.id,
                    deviceId: deviceId,
                    isNewUser: false,
                    demoMode: existingUser.demoMode !== false,
                    demoExpiresAt: existingUser.demoExpiresAt
                }
            });
        }

        // Create anonymous user with device fingerprint
        const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const demoExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days demo

        const newUser = {
            id: userId,
            deviceId: deviceId,
            email: null, // Will be collected at payment
            name: null,
            createdAt: new Date().toISOString(),
            demoMode: true,
            demoExpiresAt: demoExpiresAt.toISOString(),
            uploadCount: 0,
            storageUsed: 0,
            platform: platform || 'web',
            userAgent: userAgent,
            timezone: timezone,
            language: language
        };

        // Store the user (using existing storage mechanism)
        if (authService.createAnonymousUser) {
            authService.createAnonymousUser(newUser);
        }

        console.log('[Auto-Register] New anonymous user created:', userId.substring(0, 16) + '...');

        res.json({
            success: true,
            user: {
                id: userId,
                deviceId: deviceId,
                isNewUser: true,
                demoMode: true,
                demoExpiresAt: demoExpiresAt.toISOString()
            }
        });

    } catch (error) {
        console.error('[Auto-Register] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check device status (is demo active, is paid, etc.)
app.get('/api/auth/device-status', (req, res) => {
    try {
        const deviceId = req.headers['x-device-id'] || req.query.deviceId;

        if (!deviceId) {
            return res.json({ success: false, error: 'No device ID' });
        }

        const user = authService.getUserByDeviceId?.(deviceId);

        if (!user) {
            return res.json({
                success: true,
                status: 'new',
                demoMode: true,
                needsRegistration: true
            });
        }

        const now = new Date();
        const demoExpired = user.demoExpiresAt && new Date(user.demoExpiresAt) < now;

        res.json({
            success: true,
            status: user.isPaid ? 'paid' : (demoExpired ? 'demo_expired' : 'demo_active'),
            demoMode: !user.isPaid,
            demoExpired: demoExpired,
            demoExpiresAt: user.demoExpiresAt,
            uploadCount: user.uploadCount || 0,
            storageUsed: user.storageUsed || 0,
            hasEmail: !!user.email
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Setup biometric (get registration options)
app.post('/api/auth/biometric/setup', express.json(), (req, res) => {
    try {
        const { userId } = req.body;
        const options = authService.setupBiometric(userId);
        res.json({ success: true, options });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Complete biometric setup (verify registration) - auto-upgrades security level
app.post('/api/auth/biometric/complete', express.json(), async (req, res) => {
    try {
        const { userId, credential } = req.body;
        const result = await authService.completeBiometricSetup(userId, credential);

        // Auto-upgrade security when biometric is first registered
        if (result.success) {
            authService.onBiometricRegistered(userId);
            result.securityUpgraded = true;
            result.securityLevel = 'high';
            result.message = 'Biometric registered. Your security has been auto-upgraded to High level.';
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get biometric auth options
app.post('/api/auth/biometric/auth-options', express.json(), (req, res) => {
    try {
        const { userId } = req.body;
        const result = authService.getBiometricAuthOptions(userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Authenticate with biometric
app.post('/api/auth/biometric/authenticate', express.json(), async (req, res) => {
    try {
        const { userId, credential } = req.body;
        const result = await authService.authenticateWithBiometric(userId, credential);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ PASSWORDLESS BIOMETRIC LOGIN (One-tap login like Apple Pay) ============

// Step 1: Get passwordless auth options (no email/userId needed!)
app.post('/api/auth/passkey/options', express.json(), (req, res) => {
    try {
        const result = authService.getPasswordlessAuthOptions();
        res.json(result);
    } catch (error) {
        console.error('[Passkey] Options error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Step 2: Complete passwordless login with biometric credential
app.post('/api/auth/passkey/login', express.json(), async (req, res) => {
    try {
        const { challengeId, credential } = req.body;

        // Get device info from request
        const deviceInfo = {
            platform: req.body.platform || req.headers['sec-ch-ua-platform'] || 'Unknown',
            browser: req.body.browser || 'Unknown',
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection.remoteAddress,
            screenResolution: req.body.screenResolution,
            timezone: req.body.timezone,
            language: req.headers['accept-language']
        };

        const result = await authService.passwordlessLogin(challengeId, credential, deviceInfo);

        if (result.success) {
            console.log(`[Passkey] Login successful: ${result.email}`);
        }

        res.json(result);
    } catch (error) {
        console.error('[Passkey] Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Setup TOTP (Google Authenticator)
app.post('/api/auth/totp/setup', express.json(), (req, res) => {
    try {
        const { userId } = req.body;
        const result = authService.setupTOTP(userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
