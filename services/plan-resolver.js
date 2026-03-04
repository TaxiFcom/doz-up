/**
 * DOZ UP - Unified Plan Resolver
 * Single source of truth for user subscription plans across the entire platform.
 *
 * Resolves plan with priority:
 *   1. Stripe subscriptions (authoritative - real purchases)
 *   2. Auth-security subscriptions (legacy fallback)
 *   3. Free tier (default)
 *
 * Handles both ARRAY format (stripe-payments.js) and OBJECT format (auth-security.js)
 * for subscriptions.json backward compatibility.
 */

const fs = require('fs');
const path = require('path');

const subscriptionsPath = path.join(__dirname, '..', 'data', 'subscriptions.json');
const userDeviceLinksPath = path.join(__dirname, '..', 'data', 'user-device-links.json');
const authUsersPath = path.join(__dirname, '..', 'data', 'auth-users.json');
const stripeCustomersPath = path.join(__dirname, '..', 'data', 'stripe-customers.json');

// Canonical plan limits - THE single source of truth for all tiers
const PLAN_LIMITS = {
    free: {
        tier: 'free',
        planName: 'Free',
        uploadsPerDay: 7,
        maxFileSizeMB: 1024,
        storageMB: 1024,
        retention: '30 days',
        retentionDays: 30,
        maxSessions: 3,
        crossDeviceUploads: true,
        features: ['1 GB Storage', '1 GB max file size', '30-day link expiry', '7 uploads/day', 'Cross-device uploads'],
        appAccess: { web: true, desktop: false, mobile: false, extension: false }
    },
    starter: {
        tier: 'starter',
        planName: 'Starter',
        uploadsPerDay: -1,
        maxFileSizeMB: 256,
        storageMB: 5120,
        retention: 'forever',
        retentionDays: -1,
        maxSessions: 5,
        crossDeviceUploads: true,
        features: ['5 GB Storage', 'Links never expire', 'Desktop app included', 'Email support'],
        appAccess: { web: true, desktop: true, mobile: false, extension: true }
    },
    pro: {
        tier: 'pro',
        planName: 'Pro',
        uploadsPerDay: -1,
        maxFileSizeMB: 512,
        storageMB: -1,
        retention: 'forever',
        retentionDays: -1,
        maxSessions: 10,
        crossDeviceUploads: true,
        features: ['Unlimited storage', 'All devices + Mobile app', 'Links never expire', 'Priority support 24/7'],
        appAccess: { web: true, desktop: true, mobile: true, extension: true }
    },
    team: {
        tier: 'team',
        planName: 'Team',
        uploadsPerDay: -1,
        maxFileSizeMB: 1024,
        storageMB: 7168,
        retention: 'forever',
        retentionDays: -1,
        maxSessions: 25,
        crossDeviceUploads: true,
        features: ['Everything in Pro', 'Team workspace', 'Admin dashboard', 'API access'],
        appAccess: { web: true, desktop: true, mobile: true, extension: true }
    },
    enterprise: {
        tier: 'enterprise',
        planName: 'Enterprise',
        uploadsPerDay: -1,
        maxFileSizeMB: -1,
        storageMB: -1,
        retention: 'forever',
        retentionDays: -1,
        maxSessions: -1,
        crossDeviceUploads: true,
        features: ['Everything in Team', 'SSO & SAML', 'Dedicated support', 'Custom integrations'],
        appAccess: { web: true, desktop: true, mobile: true, extension: true }
    }
};

// Map planId patterns to tier names
const PLAN_ID_TO_TIER = {
    'free': 'free',
    'starter_monthly': 'starter',
    'starter_yearly': 'starter',
    'pro_monthly': 'pro',
    'pro_yearly': 'pro',
    'team_monthly': 'team',
    'team_yearly': 'team',
    'enterprise_monthly': 'enterprise',
    'enterprise_yearly': 'enterprise'
};

// Legacy plan name mapping (auth-security uses different names)
const LEGACY_PLAN_TO_TIER = {
    'monthly': 'starter',
    'yearly': 'starter',
    'pro': 'pro',
    'premium': 'pro',
    'team': 'team',
    'enterprise': 'enterprise',
    'lifetime': 'enterprise',
    'starter': 'starter',
    'starter_monthly': 'starter',
    'starter_yearly': 'starter',
    'pro_monthly': 'pro',
    'pro_yearly': 'pro',
    'team_monthly': 'team',
    'team_yearly': 'team',
    'enterprise_monthly': 'enterprise',
    'enterprise_yearly': 'enterprise'
};

function loadJSON(filepath, defaultValue) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {
        console.error(`[PlanResolver] Error loading ${filepath}:`, e.message);
    }
    return defaultValue;
}

/**
 * Read subscriptions.json and normalize to array format regardless of stored format.
 * Handles both:
 *   - ARRAY format: [{userId, planId, status, ...}] (stripe-payments.js)
 *   - OBJECT format: {userId: {plan, status, ...}} (auth-security.js legacy)
 */
function loadSubscriptionsNormalized() {
    const raw = loadJSON(subscriptionsPath, null);
    if (!raw) return [];

    // Already an array (Stripe format)
    if (Array.isArray(raw)) {
        return raw;
    }

    // Object format (legacy auth-security format) - convert to array
    const arr = [];
    for (const [userId, sub] of Object.entries(raw)) {
        if (sub && typeof sub === 'object') {
            arr.push({
                ...sub,
                userId: sub.userId || userId,
                // Map legacy fields
                planId: sub.planId || sub.plan || 'free',
                planName: sub.planName || sub.plan || 'Free',
                currentPeriodEnd: sub.currentPeriodEnd || sub.expiresAt,
                currentPeriodStart: sub.currentPeriodStart || sub.createdAt
            });
        }
    }
    return arr;
}

/**
 * Get userId from a browser deviceId using device links
 */
function resolveUserIdFromDevice(deviceId) {
    if (!deviceId) return null;
    const links = loadJSON(userDeviceLinksPath, { byUserId: {}, byDeviceId: {} });
    return links.byDeviceId?.[deviceId]?.userId || null;
}

/**
 * Determine the tier from a planId string
 */
function getTierFromPlanId(planId) {
    if (!planId) return 'free';
    const id = String(planId).toLowerCase().trim();
    return PLAN_ID_TO_TIER[id] || LEGACY_PLAN_TO_TIER[id] || 'free';
}

/**
 * Check if a subscription is currently active
 */
function isSubscriptionActive(sub) {
    if (!sub) return false;
    if (sub.status !== 'active') return false;

    const endField = sub.currentPeriodEnd || sub.expiresAt;
    if (!endField) return false;

    return new Date(endField) > new Date();
}

/**
 * Resolve the definitive plan for a user.
 *
 * @param {string|null} userId - The user's account ID
 * @param {string|null} deviceId - The browser/device ID (fallback to resolve userId)
 * @returns {object} Complete plan info with tier, limits, features, subscription data
 */
function resolvePlan(userId, deviceId) {
    // Step 1: Resolve userId from deviceId if needed
    let resolvedUserId = userId;
    if (!resolvedUserId && deviceId) {
        resolvedUserId = resolveUserIdFromDevice(deviceId);
    }

    // Step 2: No user at all → free tier
    if (!resolvedUserId) {
        return buildPlanResponse('free', null, null);
    }

    // Step 3: Load all subscriptions (normalized to array)
    const allSubs = loadSubscriptionsNormalized();

    // Step 4: Find this user's subscriptions
    // Try direct userId match first, then cross-reference alternate IDs
    let userSubs = allSubs.filter(s => s.userId === resolvedUserId);

    // If no direct match, try to find by cross-referencing email/alternate IDs
    // Auth uses SHA-256(email), Stripe may use base64(email) or other formats
    if (userSubs.length === 0) {
        const alternateIds = resolveAlternateUserIds(resolvedUserId);
        for (const altId of alternateIds) {
            const altSubs = allSubs.filter(s => s.userId === altId);
            if (altSubs.length > 0) {
                userSubs = userSubs.concat(altSubs);
            }
        }
    }

    // Find the best active subscription (highest tier)
    const tierOrder = ['enterprise', 'team', 'pro', 'starter', 'free'];
    let bestSub = null;
    let bestTierIndex = tierOrder.length;

    for (const sub of userSubs) {
        if (!isSubscriptionActive(sub)) continue;

        const tier = getTierFromPlanId(sub.planId || sub.plan);
        const tierIndex = tierOrder.indexOf(tier);
        if (tierIndex < bestTierIndex) {
            bestTierIndex = tierIndex;
            bestSub = sub;
        }
    }

    if (bestSub) {
        const tier = getTierFromPlanId(bestSub.planId || bestSub.plan);
        return buildPlanResponse(tier, bestSub, resolvedUserId);
    }

    // Step 5: No active subscription → free tier
    return buildPlanResponse('free', null, resolvedUserId);
}

/**
 * Find alternate user IDs that may refer to the same person.
 * Auth system uses SHA-256(email), Stripe uses base64(email) or raw email.
 * This cross-references auth-users.json and stripe-customers.json.
 */
function resolveAlternateUserIds(userId) {
    const alternates = [];

    try {
        // Load auth users to find email for this userId
        const authUsers = loadJSON(authUsersPath, {});
        const user = authUsers[userId];

        if (user && user.email) {
            const email = user.email;

            // Check all Stripe customer IDs for this email
            const customers = loadJSON(stripeCustomersPath, {});
            for (const [custUserId, stripeCustomerId] of Object.entries(customers)) {
                if (custUserId !== userId) {
                    // Check if this Stripe userId is a base64 of the same email
                    try {
                        const decoded = Buffer.from(custUserId, 'base64').toString();
                        if (decoded.startsWith(email.split('@')[0])) {
                            alternates.push(custUserId);
                        }
                    } catch (e) {}
                }
            }

            // Also check all subscription userIds that might be base64 of this email
            const allSubs = loadSubscriptionsNormalized();
            for (const sub of allSubs) {
                if (sub.userId !== userId && !alternates.includes(sub.userId)) {
                    try {
                        const decoded = Buffer.from(sub.userId, 'base64').toString();
                        if (decoded.startsWith(email.split('@')[0])) {
                            alternates.push(sub.userId);
                        }
                    } catch (e) {}
                }
            }
        } else {
            // userId might itself be a base64 or Stripe-format ID
            // Try to decode it and find the matching auth user
            try {
                const decoded = Buffer.from(userId, 'base64').toString();
                if (decoded.includes('@') || decoded.length > 3) {
                    // Find auth user by email prefix match
                    for (const [authId, authUser] of Object.entries(authUsers)) {
                        if (authUser.email && decoded.startsWith(authUser.email.split('@')[0])) {
                            alternates.push(authId);
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {
        // Fail silently - alternate lookup is best-effort
    }

    return alternates;
}

/**
 * Build a complete plan response object
 */
function buildPlanResponse(tier, subscription, userId) {
    const limits = PLAN_LIMITS[tier] || PLAN_LIMITS.free;

    return {
        userId: userId,
        tier: limits.tier,
        planId: subscription?.planId || subscription?.plan || 'free',
        planName: subscription?.planName || limits.planName,
        isActive: tier !== 'free',
        isPaid: tier !== 'free',
        expiresAt: subscription?.currentPeriodEnd || subscription?.expiresAt || null,
        startedAt: subscription?.currentPeriodStart || subscription?.createdAt || null,
        stripeSubscriptionId: subscription?.stripeSubscriptionId || null,
        limits: {
            uploadsPerDay: limits.uploadsPerDay,
            maxFileSizeMB: limits.maxFileSizeMB,
            storageMB: limits.storageMB,
            retention: limits.retention,
            retentionDays: limits.retentionDays,
            maxSessions: limits.maxSessions
        },
        features: limits.features,
        appAccess: limits.appAccess,
        subscription: subscription || null
    };
}

/**
 * Get plan limits for a user (lightweight version for middleware/upload checks)
 */
function getPlanLimits(userId, deviceId) {
    const plan = resolvePlan(userId, deviceId);
    return plan.limits;
}

/**
 * Quick check: is this user on a paid plan?
 */
function isPaidUser(userId, deviceId) {
    const plan = resolvePlan(userId, deviceId);
    return plan.isPaid;
}

/**
 * Get the max sessions allowed for a user's plan
 */
function getMaxSessions(userId, deviceId) {
    const plan = resolvePlan(userId, deviceId);
    return plan.limits.maxSessions;
}

/**
 * Get the retention period in milliseconds for a user's plan
 */
function getRetentionMs(userId, deviceId) {
    const plan = resolvePlan(userId, deviceId);
    if (plan.limits.retentionDays === -1) {
        return 365 * 24 * 60 * 60 * 1000; // "forever" = 1 year for file system purposes
    }
    return plan.limits.retentionDays * 24 * 60 * 60 * 1000;
}

module.exports = {
    resolvePlan,
    getPlanLimits,
    isPaidUser,
    getMaxSessions,
    getRetentionMs,
    getTierFromPlanId,
    isSubscriptionActive,
    loadSubscriptionsNormalized,
    PLAN_LIMITS,
    PLAN_ID_TO_TIER,
    LEGACY_PLAN_TO_TIER
};
