        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Process gift subscription after payment
app.post('/api/stripe/process-gift', express.json(), async (req, res) => {
    try {
        const { paymentIntentId, planId, buyerEmail, giftData } = req.body;

        if (!paymentIntentId || !giftData || !giftData.recipientEmail) {
            return res.status(400).json({
                success: false,
                error: 'Missing required gift data'
            });
        }

        // Store gift record in database
        const giftRecord = {
            id: `gift_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            paymentIntentId,
            planId,
            buyerEmail,
            recipientName: giftData.recipientName,
            recipientEmail: giftData.recipientEmail,
            message: giftData.message || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        // Store in gifts collection (file-based for now)
        const giftsFile = path.join(__dirname, 'data', 'gifts.json');
        let gifts = [];
        try {
            if (fs.existsSync(giftsFile)) {
                gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
            }
        } catch (e) {}
        gifts.push(giftRecord);
        fs.writeFileSync(giftsFile, JSON.stringify(gifts));

        // Send gift notification email to recipient
        try {
            const notificationService = require('./services/notifications');
            if (notificationService && notificationService.sendEmail) {
                await notificationService.sendEmail(
                    giftData.recipientEmail,
                    `You received a DOZ UP gift from ${buyerEmail}!`,
                    `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <div style="background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 20px; padding: 40px; text-align: center; color: white;">
                            <div style="font-size: 60px; margin-bottom: 20px;">gift</div>
                            <h1 style="margin: 0 0 10px; font-size: 28px;">You've Received a Gift!</h1>
                            <p style="opacity: 0.9; font-size: 16px; margin: 0;">Someone special sent you DOZ UP Premium</p>
                        </div>

                        <div style="background: #f8f9fa; border-radius: 16px; padding: 30px; margin-top: 20px;">
                            ${giftData.recipientName ? `<p style="color: #333; font-size: 18px; margin: 0 0 20px;">Hi ${giftData.recipientName},</p>` : ''}

                            ${giftData.message ? `
                            <div style="background: white; border-left: 4px solid #667eea; padding: 15px 20px; margin: 20px 0; border-radius: 0 10px 10px 0;">
                                <p style="color: #666; font-style: italic; margin: 0;">"${giftData.message}"</p>
                            </div>
                            ` : ''}

                            <p style="color: #333; line-height: 1.6;">
                                <strong>${buyerEmail}</strong> has gifted you a DOZ UP subscription!
                                Click the button below to activate your premium access.
                            </p>

                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://doz.com/up/redeem?gift=${giftRecord.id}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: 600; font-size: 16px;">
                                    Redeem Your Gift
                                </a>
                            </div>
                        </div>

                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
                            DOZ UP - Your Creative Companion
                        </p>
                    </div>
                    `
                );
            }
        } catch (emailError) {
            console.error('[Gift] Email notification failed:', emailError.message);
        }

        res.json({
            success: true,
            giftId: giftRecord.id,
            message: 'Gift processed successfully'
        });

    } catch (error) {
        console.error('[Stripe] Process gift error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get gift details for redemption
app.get('/api/stripe/gift/:giftId', (req, res) => {
    try {
        const { giftId } = req.params;
        const giftsFile = path.join(__dirname, 'data', 'gifts.json');

        if (!fs.existsSync(giftsFile)) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        const gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
        const gift = gifts.find(g => g.id === giftId);

        if (!gift) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        // Don't expose sensitive data
        res.json({
            success: true,
            gift: {
                id: gift.id,
                planId: gift.planId,
                recipientName: gift.recipientName,
                message: gift.message,
                status: gift.status,
                createdAt: gift.createdAt
            },
            plan: stripeService.getPlan(gift.planId)
        });
    } catch (error) {
        console.error('[Gift] Get gift error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Redeem a gift subscription
app.post('/api/stripe/redeem-gift', express.json(), async (req, res) => {
    try {
        const { giftId, email, name } = req.body;

        if (!giftId || !email) {
            return res.status(400).json({ success: false, error: 'Gift ID and email required' });
        }

        const giftsFile = path.join(__dirname, 'data', 'gifts.json');

        if (!fs.existsSync(giftsFile)) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        let gifts = JSON.parse(fs.readFileSync(giftsFile, 'utf8'));
        const giftIndex = gifts.findIndex(g => g.id === giftId);

        if (giftIndex === -1) {
            return res.status(404).json({ success: false, error: 'Gift not found' });
        }

        const gift = gifts[giftIndex];

        if (gift.status === 'redeemed') {
            return res.status(400).json({ success: false, error: 'This gift has already been redeemed' });
        }

        // Generate user ID from email
        const userId = Buffer.from(email).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);

        // Activate subscription for the recipient
        const plan = stripeService.getPlan(gift.planId);
        if (!plan) {
            return res.status(400).json({ success: false, error: 'Invalid plan' });
        }

        // Create subscription record
        const subscriptionData = {
            id: `sub_gift_${Date.now()}`,
            userId,
            email,
            planId: gift.planId,
            status: 'active',
            giftId: gift.id,
            giftedBy: gift.buyerEmail,
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + (plan.interval === 'year' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString()
        };

        // Save subscription
        const subsFile = path.join(__dirname, 'data', 'subscriptions.json');
        let subs = [];
        try {
            if (fs.existsSync(subsFile)) {
                subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
            }
        } catch (e) {}
        subs.push(subscriptionData);
        fs.writeFileSync(subsFile, JSON.stringify(subs));

        // Mark gift as redeemed
        gifts[giftIndex].status = 'redeemed';
        gifts[giftIndex].redeemedAt = new Date().toISOString();
        gifts[giftIndex].redeemedBy = email;
        fs.writeFileSync(giftsFile, JSON.stringify(gifts));

        // Send confirmation email to recipient
        try {
            const notificationService = require('./services/notifications');
            if (notificationService && notificationService.sendEmail) {
                await notificationService.sendEmail(
                    email,
                    'Your DOZ UP Gift Has Been Activated!',
                    `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <div style="background: linear-gradient(135deg, #4CAF50, #2E7D32); border-radius: 20px; padding: 40px; text-align: center; color: white;">
                            <div style="font-size: 60px; margin-bottom: 20px;">check</div>
                            <h1 style="margin: 0 0 10px; font-size: 28px;">Gift Activated!</h1>
                            <p style="opacity: 0.9; font-size: 16px; margin: 0;">Your DOZ UP ${plan.name} subscription is now active</p>
                        </div>

                        <div style="background: #f8f9fa; border-radius: 16px; padding: 30px; margin-top: 20px;">
                            <p style="color: #333; line-height: 1.6;">
                                Hello${name ? ' ' + name : ''}! Your gift subscription has been successfully activated.
                            </p>

                            <div style="background: white; border-radius: 12px; padding: 20px; margin: 20px 0;">
                                <h3 style="margin: 0 0 15px; color: #333;">Your Plan Details</h3>
                                <p style="margin: 5px 0; color: #666;"><strong>Plan:</strong> ${plan.name}</p>
                                <p style="margin: 5px 0; color: #666;"><strong>Storage:</strong> ${plan.storage >= 1024 ? (plan.storage / 1024) + ' GB' : plan.storage + ' MB'}</p>
                                <p style="margin: 5px 0; color: #666;"><strong>Valid Until:</strong> ${new Date(subscriptionData.endDate).toLocaleDateString()}</p>
                            </div>

                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://doz.com/up/app" style="display: inline-block; background: linear-gradient(135deg, #4CAF50, #2E7D32); color: white; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: 600; font-size: 16px;">
                                    Start Using DOZ UP
                                </a>
                            </div>
                        </div>

                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
                            DOZ UP - Your Creative Companion
                        </p>
                    </div>
                    `
                );
            }
        } catch (emailError) {
            console.error('[Gift] Confirmation email failed:', emailError.message);
        }

        // Notify the gift giver
        try {
            const notificationService = require('./services/notifications');
            if (notificationService && notificationService.sendEmail) {
                await notificationService.sendEmail(
                    gift.buyerEmail,
                    `Your gift to ${gift.recipientName || email} was redeemed!`,
                    `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <div style="background: linear-gradient(135deg, #ff6b9d, #c44569); border-radius: 20px; padding: 40px; text-align: center; color: white;">
                            <div style="font-size: 60px; margin-bottom: 20px;">gift</div>
                            <h1 style="margin: 0 0 10px; font-size: 28px;">Gift Redeemed!</h1>
                            <p style="opacity: 0.9; font-size: 16px; margin: 0;">${gift.recipientName || 'Your friend'} activated their gift</p>
                        </div>

                        <div style="background: #f8f9fa; border-radius: 16px; padding: 30px; margin-top: 20px;">
                            <p style="color: #333; line-height: 1.6;">
                                Great news! ${gift.recipientName || 'The recipient'} has redeemed the DOZ UP ${plan.name} subscription you gifted them.
                            </p>
                            <p style="color: #666; line-height: 1.6;">
                                Thank you for sharing DOZ UP with your friends and family!
                            </p>
                        </div>

                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 30px;">
                            DOZ UP - Your Creative Companion
                        </p>
                    </div>
                    `
                );
            }
        } catch (emailError) {
            console.error('[Gift] Giver notification email failed:', emailError.message);
        }

        res.json({
            success: true,
            message: 'Gift redeemed successfully',
            subscription: {
                planId: gift.planId,
                planName: plan.name,
                endDate: subscriptionData.endDate
            }
        });

    } catch (error) {
        console.error('[Gift] Redeem error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stripe Webhook Handler
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];

    try {
        const result = await stripeService.handleWebhook(req.body, signature);

        // Record success/failure in AI Payment Guard
        try {
            const payload = JSON.parse(req.body.toString());
            const eventType = payload.type;
            const obj = payload.data?.object;
            if (eventType === 'payment_intent.succeeded' && obj) {
                paymentGuard.recordSuccess(obj.receipt_email || obj.metadata?.email || '', obj.metadata?.planId || '', obj.amount, obj.id);

                // Track A/B test conversion
                try {
                    const variant = obj.metadata?.abVariant;
                    if (variant) {
                        const abTestTracker = require('./services/ab-test-tracker');
                        abTestTracker.trackConversion(variant, obj.amount, obj.currency?.toUpperCase() || 'USD');
                        console.log(`[A/B Test] Conversion tracked for variant ${variant}: ${obj.amount} ${obj.currency}`);
                    }
                } catch (e) {
                    console.error('[A/B Test] Tracking error:', e.message);
                }

                // Record sale in sales database
                try {
                    salesDatabase.recordSale({
                        stripeId: obj.id,
                        email: obj.receipt_email || obj.metadata?.email || '',
                        plan: obj.metadata?.planId || 'Subscription',
                        amount: (obj.amount || 0) / 100,
                        currency: obj.currency?.toUpperCase() || 'USD',
                        status: 'completed',
                        type: 'purchase',
                        userId: obj.metadata?.userId || ''
                    });
                } catch (e) {
                    console.error('[SalesDB] Record error:', e.message);
                }

                // Fire server-side Purchase event to Meta CAPI (guaranteed delivery)
                if (META_PIXEL_ID && META_ACCESS_TOKEN) {
                    try {
                        const purchaseEmail = obj.receipt_email || obj.metadata?.email || '';
                        const purchaseAmount = (obj.amount || 0) / 100;
                        const purchaseCurrency = obj.currency?.toUpperCase() || 'USD';
                        const purchasePlan = obj.metadata?.planId || 'Subscription';
                        const capiEventId = 'srv_' + Date.now() + '_' + obj.id;

                        const capiPayload = {
                            data: [{
                                event_name: 'Purchase',
                                event_id: capiEventId,
                                event_time: Math.floor(Date.now() / 1000),
                                event_source_url: 'https://doz.com/payment/success',
                                action_source: 'website',
                                user_data: {
                                    em: purchaseEmail ? [hashForMeta(purchaseEmail)] : undefined,
                                    external_id: obj.metadata?.userId ? [hashForMeta(obj.metadata.userId)] : undefined
                                },
                                custom_data: {
                                    content_name: purchasePlan,
                                    content_ids: [purchasePlan],
                                    content_type: 'product',
                                    value: purchaseAmount,
                                    currency: purchaseCurrency,
                                    transaction_id: obj.id,
                                    num_items: 1
                                }
                            }]
                        };

                        const capiUrl = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
                        fetch(capiUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(capiPayload)
                        }).then(r => {
                            if (r.ok) console.log('[CAPI] Server-side Purchase sent for', purchaseEmail, purchaseAmount, purchaseCurrency);
                            else r.text().then(t => console.error('[CAPI] Server Purchase error:', r.status, t));
                        }).catch(e => console.error('[CAPI] Server Purchase fetch error:', e.message));
                    } catch (capiErr) {
                        console.error('[CAPI] Server Purchase error:', capiErr.message);
                    }
                }

                // Track for live monitor
                if (global.trackMonitorSale) {
                    global.trackMonitorSale({
                        plan: obj.metadata?.planId || 'Subscription',
                        amount: (obj.amount || 0) / 100, // Convert cents to dollars
                        email: obj.receipt_email || obj.metadata?.email || ''
                    });
                }
            } else if (eventType === 'invoice.payment_failed' && obj) {
                paymentGuard.recordFailure(obj.customer_email || '', obj.metadata?.planId || '', obj.amount_due, 'invoice_payment_failed');

                // Track issue for live monitor
                if (global.trackMonitorIssue) {
                    global.trackMonitorIssue({
                        message: 'Payment failed: ' + (obj.customer_email || 'unknown'),
                        severity: 'warning',
                        page: 'checkout'
                    });
                }
            }
        } catch (guardErr) {
            // Don't let guard errors affect webhook processing
        }

        res.json(result);
    } catch (error) {
        console.error('[Stripe] Webhook error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get user subscription (Stripe)
app.get('/api/stripe/subscription/:userId', (req, res) => {
    const { userId } = req.params;
    const subscription = stripeService.getSubscription(userId);
    const isActive = stripeService.isSubscriptionActive(userId);

    res.json({
        success: true,
        hasSubscription: !!subscription,
        isActive,
        subscription,
        plan: subscription ? stripeService.getPlan(subscription.planId) : null
    });
});

// Cancel subscription (Stripe)
app.post('/api/stripe/cancel-subscription', express.json(), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId required' });
        }

        const subscription = await stripeService.cancelSubscription(userId);
        res.json({ success: true, subscription });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create customer portal session
app.post('/api/stripe/create-portal-session', express.json(), async (req, res) => {
    try {
        const { userId, returnUrl } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId required' });
        }

        const session = await stripeService.createPortalSession(userId, returnUrl);
        res.json({
            success: true,
            url: session.url
        });
    } catch (error) {
        console.error('[Stripe] Portal session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get transactions (Stripe)
app.get('/api/stripe/transactions/:userId', (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const transactions = stripeService.getTransactions(userId, limit);
    res.json({ success: true, transactions });
});

// Admin: Get all subscriptions
app.get('/api/stripe/admin/subscriptions', (req, res) => {
    const subscriptions = stripeService.getAllSubscriptions() || [];
    const subArray = Array.isArray(subscriptions) ? subscriptions : [];
    res.json({
        success: true,
        total: subArray.length,
        active: subArray.filter(s => s.status === 'active').length,
        subscriptions: subArray
    });
});

// Admin: Get revenue stats
app.get('/api/stripe/admin/revenue', (req, res) => {
    const stats = stripeService.getRevenueStats();
    res.json({ success: true, ...stats });
});

// Admin: Get all transactions
