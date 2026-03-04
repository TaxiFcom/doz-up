-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('WEB', 'DESKTOP', 'MOBILE', 'TABLET', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LoginRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'OUTBOUND', 'REFERRAL', 'PARTNER', 'ORGANIC', 'PAID', 'SOCIAL', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadTier" AS ENUM ('STARTUP', 'BUSINESS', 'ENTERPRISE', 'WHALE');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('COLD', 'WARM', 'HOT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'CHURNED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DemoStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAUSED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CHECKOUT_CREATED', 'PAYMENT', 'REFUND', 'CHARGEBACK', 'SUBSCRIPTION_RENEWAL', 'UPGRADE', 'DOWNGRADE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'PAYPAL', 'BANK_TRANSFER', 'CRYPTO', 'WIRE');

-- CreateEnum
CREATE TYPE "AffiliateType" AS ENUM ('INDIVIDUAL', 'AGENCY', 'PARTNER', 'INFLUENCER');

-- CreateEnum
CREATE TYPE "AffiliateTier" AS ENUM ('STANDARD', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND');

-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('CLICKED', 'SIGNED_UP', 'CONVERTED', 'PAID');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'ARCHIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "TrafficSourceCategory" AS ENUM ('DIRECT', 'ORGANIC', 'PAID', 'SOCIAL', 'REFERRAL', 'EMAIL', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "DeviceAnalyticsType" AS ENUM ('DESKTOP', 'MOBILE', 'TABLET', 'TV', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('PAGEVIEW', 'CLICK', 'SCROLL', 'FORM_SUBMIT', 'DOWNLOAD', 'SIGNUP', 'PURCHASE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT', 'VIEWER');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_LEAD', 'NEW_DEAL', 'PAYMENT_RECEIVED', 'SUBSCRIPTION_CANCELLED', 'SYSTEM_ALERT', 'SECURITY_ALERT', 'NEW_USER', 'NEW_AFFILIATE');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('ADMIN', 'LEADS', 'DEALS', 'PAYMENTS', 'USERS', 'AFFILIATES', 'SYSTEM', 'SECURITY');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'WAITING_USER', 'WAITING_AGENT', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportChannel" AS ENUM ('WIDGET', 'EMAIL', 'TICKET', 'MOBILE');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'AGENT');

-- CreateEnum
CREATE TYPE "MessageContentType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'ARTICLE_SUGGESTION', 'ACTION_BUTTON', 'TYPING_INDICATOR');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL', 'TECHNICAL', 'BILLING', 'FEATURE_REQUEST', 'BUG_REPORT', 'ACCOUNT', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReplyAuthorType" AS ENUM ('CUSTOMER', 'AGENT', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('IDLE_TIME', 'ERROR_PAGE', 'EXIT_INTENT', 'RAGE_CLICK', 'SCROLL_STUCK', 'REPEATED_VISIT', 'PRICING_PAGE', 'CHECKOUT_ABANDON', 'HELP_SEARCH', 'LONG_FORM_TIME', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ONLINE', 'AWAY', 'BUSY', 'OFFLINE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{"requireBiometric": false, "requireTOTP": false, "requireDeviceConfirmation": true, "theme": "system", "notifications": true}',
    "planId" TEXT,
    "storageLimitMb" BIGINT NOT NULL DEFAULT 512,
    "storageUsedMb" BIGINT NOT NULL DEFAULT 0,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Unknown Device',
    "fingerprint" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'UNKNOWN',
    "browser" TEXT,
    "os" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "trustedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "transports" TEXT[] DEFAULT ARRAY['internal']::TEXT[],
    "name" TEXT NOT NULL DEFAULT 'Biometric',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotpSecret" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'SHA1',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "period" INTEGER NOT NULL DEFAULT 30,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryCodesEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "TotpSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestCode" TEXT,
    "requestingDeviceFingerprint" TEXT,
    "requestingIp" TEXT,
    "requestingUserAgent" TEXT,
    "status" "LoginRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedByDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LoginRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDeviceLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "browserDeviceId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "UserDeviceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseLead" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "industry" TEXT,
    "companySize" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactTitle" TEXT,
    "useCase" TEXT,
    "budget" TEXT,
    "timeline" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'WEBSITE',
    "referralCode" TEXT,
    "affiliateId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "tier" "LeadTier" NOT NULL DEFAULT 'STARTUP',
    "priority" "LeadPriority" NOT NULL DEFAULT 'COLD',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "activities" JSONB NOT NULL DEFAULT '[]',
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contactedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EnterpriseLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "tier" "LeadTier",
    "tierName" TEXT,
    "seats" TEXT,
    "amount" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "finalAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "term" INTEGER NOT NULL DEFAULT 12,
    "status" "DealStatus" NOT NULL DEFAULT 'DISCOVERY',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "affiliateId" TEXT,
    "referralCode" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "proposalNumber" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dealId" TEXT,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactTitle" TEXT,
    "tier" "LeadTier",
    "tierName" TEXT,
    "seats" INTEGER,
    "storageGb" INTEGER,
    "originalPrice" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "finalPrice" INTEGER NOT NULL,
    "savings" INTEGER NOT NULL DEFAULT 0,
    "term" INTEGER NOT NULL DEFAULT 12,
    "paymentTerms" TEXT NOT NULL DEFAULT 'annual',
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bonuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validUntil" TIMESTAMP(3),
    "expiresInDays" INTEGER,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demo" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "company" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "meetingLink" TEXT,
    "meetingType" TEXT NOT NULL DEFAULT 'video_call',
    "status" "DemoStatus" NOT NULL DEFAULT 'SCHEDULED',
    "tier" "LeadTier",
    "source" "LeadSource",
    "notes" TEXT,
    "reminders" JSONB NOT NULL DEFAULT '{"24h": false, "1h": false}',
    "outcome" TEXT,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Demo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" INTEGER,
    "priceYearly" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "storageMb" BIGINT,
    "accounts" INTEGER NOT NULL DEFAULT 1,
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "stripePriceMonthlyId" TEXT,
    "stripePriceYearlyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "defaultPaymentMethodId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "planId" TEXT,
    "planName" TEXT,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelFeedback" TEXT,
    "promoCode" TEXT,
    "discountPercent" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeInvoiceId" TEXT,
    "userId" TEXT,
    "subscriptionId" TEXT,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fee" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER,
    "planId" TEXT,
    "description" TEXT,
    "paymentMethodType" "PaymentMethodType",
    "paymentMethodLast4" TEXT,
    "paymentMethodBrand" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "description" TEXT,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "applicablePlans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minAmount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCodeUsage" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT,
    "transactionId" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discountApplied" INTEGER,

    CONSTRAINT "PromoCodeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "website" TEXT,
    "type" "AffiliateType" NOT NULL DEFAULT 'INDIVIDUAL',
    "tier" "AffiliateTier" NOT NULL DEFAULT 'STANDARD',
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING',
    "code" TEXT NOT NULL,
    "customCode" TEXT,
    "commissionRate" INTEGER NOT NULL DEFAULT 20,
    "cookieDays" INTEGER NOT NULL DEFAULT 30,
    "paymentMethod" "PaymentMethodType" NOT NULL DEFAULT 'PAYPAL',
    "paymentDetails" JSONB,
    "minimumPayout" INTEGER NOT NULL DEFAULT 5000,
    "totalClicks" BIGINT NOT NULL DEFAULT 0,
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "totalConversions" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" BIGINT NOT NULL DEFAULT 0,
    "totalCommission" BIGINT NOT NULL DEFAULT 0,
    "totalPaid" BIGINT NOT NULL DEFAULT 0,
    "pendingCommission" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastPayoutAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralClick" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "fingerprint" TEXT,
    "cookieId" TEXT,
    "cookieExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "clickId" TEXT,
    "userId" TEXT,
    "leadId" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'CLICKED',
    "orderAmount" INTEGER,
    "commissionRate" INTEGER,
    "commissionAmount" INTEGER,
    "clickedAt" TIMESTAMP(3),
    "signedUpAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentMethod" "PaymentMethodType",
    "paymentReference" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "referralIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referralCount" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "filename" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "fileType" "FileType" NOT NULL DEFAULT 'IMAGE',
    "sizeBytes" BIGINT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "cdnUrl" TEXT,
    "thumbnailUrl" TEXT,
    "status" "UploadStatus" NOT NULL DEFAULT 'READY',
    "expiresAt" TIMESTAMP(3),
    "isPermanent" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastAccessedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Download" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "rating" INTEGER,
    "comment" TEXT,
    "category" TEXT,
    "appVersion" TEXT,
    "pageUrl" TEXT,
    "responded" BOOLEAN NOT NULL DEFAULT false,
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "ipAddress" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "referrer" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "sourceCategory" "TrafficSourceCategory" NOT NULL DEFAULT 'DIRECT',
    "deviceType" "DeviceAnalyticsType" NOT NULL DEFAULT 'DESKTOP',
    "browser" TEXT,
    "browserVersion" TEXT,
    "os" TEXT,
    "osVersion" TEXT,
    "isMobile" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "country" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "language" TEXT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "colorDepth" INTEGER,
    "pixelRatio" DOUBLE PRECISION,
    "loadTimeMs" INTEGER,
    "domReadyMs" INTEGER,
    "connectionType" TEXT,
    "botScore" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "pages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entryPage" TEXT,
    "exitPage" TEXT,
    "deviceType" "DeviceAnalyticsType",
    "browser" TEXT,
    "os" TEXT,
    "referrerSource" TEXT,
    "referrerMedium" TEXT,
    "referrerCampaign" TEXT,
    "sourceCategory" "TrafficSourceCategory" NOT NULL DEFAULT 'DIRECT',
    "country" TEXT,
    "city" TEXT,
    "bounce" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "conversionValue" INTEGER,
    "engagementScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "totalPageViews" INTEGER NOT NULL DEFAULT 0,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "totalEvents" INTEGER NOT NULL DEFAULT 0,
    "deviceType" "DeviceAnalyticsType",
    "browser" TEXT,
    "os" TEXT,
    "firstReferrer" JSONB,
    "lastReferrer" JSONB,
    "touchpoints" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "conversionDate" TIMESTAMP(3),
    "lifetimeValue" INTEGER NOT NULL DEFAULT 0,
    "engagementScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "pageViewId" TEXT,
    "eventType" "EventType" NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventCategory" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "value" INTEGER,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAnalytics" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pageViews" BIGINT NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "newVisitors" INTEGER NOT NULL DEFAULT 0,
    "returningVisitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "totalSessionDuration" BIGINT NOT NULL DEFAULT 0,
    "avgSessionDuration" INTEGER NOT NULL DEFAULT 0,
    "avgPagesPerSession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "devices" JSONB NOT NULL DEFAULT '{}',
    "browsers" JSONB NOT NULL DEFAULT '{}',
    "osBreakdown" JSONB NOT NULL DEFAULT '{}',
    "countries" JSONB NOT NULL DEFAULT '{}',
    "topPages" JSONB NOT NULL DEFAULT '{}',
    "entryPages" JSONB NOT NULL DEFAULT '{}',
    "exitPages" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '{}',
    "referrers" JSONB NOT NULL DEFAULT '{}',
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue" BIGINT NOT NULL DEFAULT 0,
    "hourlyDistribution" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "peakHour" INTEGER,
    "avgEngagementScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "appVersion" TEXT,
    "platform" TEXT,
    "os" TEXT,
    "osVersion" TEXT,
    "arch" TEXT,
    "nodeVersion" TEXT,
    "eventName" TEXT NOT NULL,
    "eventData" JSONB NOT NULL DEFAULT '{}',
    "memoryUsageMb" INTEGER,
    "cpuPercent" DOUBLE PRECISION,
    "uptime" INTEGER,
    "status" TEXT,
    "trayStatus" TEXT,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralStats" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "totalCycles" INTEGER NOT NULL DEFAULT 0,
    "totalSubmissions" INTEGER NOT NULL DEFAULT 0,
    "totalSuccess" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "totalTrafficGenerated" INTEGER NOT NULL DEFAULT 0,
    "categories" JSONB NOT NULL DEFAULT '{}',
    "hourlyStats" JSONB NOT NULL DEFAULT '[]',
    "dailyStats" JSONB NOT NULL DEFAULT '[]',
    "topReferrers" JSONB NOT NULL DEFAULT '{}',
    "recentCycles" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPermission" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "link" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "playSound" BOOLEAN NOT NULL DEFAULT false,
    "targetUsers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "category" "ActivityCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityName" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "adminId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminSettings" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "deviceBindingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "boundDeviceId" TEXT,
    "boundAt" TIMESTAMP(3),
    "googleAuthEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedGoogleEmail" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "channel" "SupportChannel" NOT NULL DEFAULT 'WIDGET',
    "aiHandled" BOOLEAN NOT NULL DEFAULT true,
    "aiConfidence" DOUBLE PRECISION,
    "escalatedAt" TIMESTAMP(3),
    "escalatedTo" TEXT,
    "escalationReason" TEXT,
    "pageUrl" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "timezone" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "rating" INTEGER,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" "MessageContentType" NOT NULL DEFAULT 'TEXT',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiModel" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "tokensUsed" INTEGER,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "suggestedActions" JSONB NOT NULL DEFAULT '[]',
    "relatedArticles" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "conversationId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "deviceId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "assignedAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "slaDeadline" TIMESTAMP(3),
    "slaBreach" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "aiSuggestedPriority" "TicketPriority",
    "aiSuggestedCategory" "TicketCategory",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "ReplyAuthorType" NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerEvent" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationId" TEXT,
    "triggerType" "TriggerType" NOT NULL,
    "triggerName" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "pageUrl" TEXT,
    "pageTitle" TEXT,
    "timeOnPage" INTEGER,
    "scrollDepth" INTEGER,
    "behaviorData" JSONB NOT NULL DEFAULT '{}',
    "widgetOpened" BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "convertedToChat" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAgentStatus" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'OFFLINE',
    "maxConcurrentChats" INTEGER NOT NULL DEFAULT 5,
    "currentChats" INTEGER NOT NULL DEFAULT 0,
    "totalChatsHandled" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" INTEGER,
    "avgRating" DOUBLE PRECISION,
    "lastActiveAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAgentStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Device_fingerprint_idx" ON "Device"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprint_key" ON "Device"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_credentialId_idx" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "TotpSecret_userId_key" ON "TotpSecret"("userId");

-- CreateIndex
CREATE INDEX "LoginRequest_userId_idx" ON "LoginRequest"("userId");

-- CreateIndex
CREATE INDEX "LoginRequest_status_idx" ON "LoginRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserDeviceLink_browserDeviceId_key" ON "UserDeviceLink"("browserDeviceId");

-- CreateIndex
CREATE INDEX "UserDeviceLink_userId_idx" ON "UserDeviceLink"("userId");

-- CreateIndex
CREATE INDEX "EnterpriseLead_status_idx" ON "EnterpriseLead"("status");

-- CreateIndex
CREATE INDEX "EnterpriseLead_priority_idx" ON "EnterpriseLead"("priority");

-- CreateIndex
CREATE INDEX "EnterpriseLead_score_idx" ON "EnterpriseLead"("score");

-- CreateIndex
CREATE INDEX "EnterpriseLead_contactEmail_idx" ON "EnterpriseLead"("contactEmail");

-- CreateIndex
CREATE INDEX "EnterpriseLead_company_idx" ON "EnterpriseLead"("company");

-- CreateIndex
CREATE INDEX "EnterpriseLead_affiliateId_idx" ON "EnterpriseLead"("affiliateId");

-- CreateIndex
CREATE INDEX "EnterpriseLead_createdAt_idx" ON "EnterpriseLead"("createdAt");

-- CreateIndex
CREATE INDEX "Deal_leadId_idx" ON "Deal"("leadId");

-- CreateIndex
CREATE INDEX "Deal_status_idx" ON "Deal"("status");

-- CreateIndex
CREATE INDEX "Deal_expectedCloseDate_idx" ON "Deal"("expectedCloseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_proposalNumber_key" ON "Proposal"("proposalNumber");

-- CreateIndex
CREATE INDEX "Proposal_leadId_idx" ON "Proposal"("leadId");

-- CreateIndex
CREATE INDEX "Proposal_proposalNumber_idx" ON "Proposal"("proposalNumber");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Demo_leadId_idx" ON "Demo"("leadId");

-- CreateIndex
CREATE INDEX "Demo_scheduledDate_idx" ON "Demo"("scheduledDate");

-- CreateIndex
CREATE INDEX "Demo_status_idx" ON "Demo"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_userId_key" ON "StripeCustomer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_stripeCustomerId_key" ON "StripeCustomer"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "StripeCustomer_stripeCustomerId_idx" ON "StripeCustomer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_stripePaymentIntentId_idx" ON "Transaction"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_code_idx" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_isActive_idx" ON "PromoCode"("isActive");

-- CreateIndex
CREATE INDEX "PromoCodeUsage_promoCodeId_idx" ON "PromoCodeUsage"("promoCodeId");

-- CreateIndex
CREATE INDEX "PromoCodeUsage_userId_idx" ON "PromoCodeUsage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_email_key" ON "Affiliate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE INDEX "Affiliate_code_idx" ON "Affiliate"("code");

-- CreateIndex
CREATE INDEX "Affiliate_email_idx" ON "Affiliate"("email");

-- CreateIndex
CREATE INDEX "Affiliate_status_idx" ON "Affiliate"("status");

-- CreateIndex
CREATE INDEX "ReferralClick_affiliateId_idx" ON "ReferralClick"("affiliateId");

-- CreateIndex
CREATE INDEX "ReferralClick_createdAt_idx" ON "ReferralClick"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_clickId_key" ON "Referral"("clickId");

-- CreateIndex
CREATE INDEX "Referral_affiliateId_idx" ON "Referral"("affiliateId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "Referral_userId_idx" ON "Referral"("userId");

-- CreateIndex
CREATE INDEX "AffiliatePayout_affiliateId_idx" ON "AffiliatePayout"("affiliateId");

-- CreateIndex
CREATE INDEX "AffiliatePayout_status_idx" ON "AffiliatePayout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_filename_key" ON "Upload"("filename");

-- CreateIndex
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");

-- CreateIndex
CREATE INDEX "Upload_deviceId_idx" ON "Upload"("deviceId");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");

-- CreateIndex
CREATE INDEX "Upload_expiresAt_idx" ON "Upload"("expiresAt");

-- CreateIndex
CREATE INDEX "Upload_createdAt_idx" ON "Upload"("createdAt");

-- CreateIndex
CREATE INDEX "Download_uploadId_idx" ON "Download"("uploadId");

-- CreateIndex
CREATE INDEX "Download_createdAt_idx" ON "Download"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_rating_idx" ON "Feedback"("rating");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "PageView_visitorId_timestamp_idx" ON "PageView"("visitorId", "timestamp");

-- CreateIndex
CREATE INDEX "PageView_sessionId_timestamp_idx" ON "PageView"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "PageView_userId_timestamp_idx" ON "PageView"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "PageView_path_timestamp_idx" ON "PageView"("path", "timestamp");

-- CreateIndex
CREATE INDEX "PageView_sourceCategory_timestamp_idx" ON "PageView"("sourceCategory", "timestamp");

-- CreateIndex
CREATE INDEX "PageView_timestamp_idx" ON "PageView"("timestamp");

-- CreateIndex
CREATE INDEX "VisitorSession_visitorId_idx" ON "VisitorSession"("visitorId");

-- CreateIndex
CREATE INDEX "VisitorSession_userId_idx" ON "VisitorSession"("userId");

-- CreateIndex
CREATE INDEX "VisitorSession_startTime_idx" ON "VisitorSession"("startTime");

-- CreateIndex
CREATE INDEX "Visitor_lastSeen_idx" ON "Visitor"("lastSeen");

-- CreateIndex
CREATE INDEX "Visitor_converted_idx" ON "Visitor"("converted");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_visitorId_timestamp_idx" ON "AnalyticsEvent"("visitorId", "timestamp");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_timestamp_idx" ON "AnalyticsEvent"("eventType", "timestamp");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_timestamp_idx" ON "AnalyticsEvent"("eventName", "timestamp");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_timestamp_idx" ON "AnalyticsEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnalytics_date_key" ON "DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "DailyAnalytics_date_idx" ON "DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "TelemetryEvent_deviceId_timestamp_idx" ON "TelemetryEvent"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "TelemetryEvent_eventName_timestamp_idx" ON "TelemetryEvent"("eventName", "timestamp");

-- CreateIndex
CREATE INDEX "TelemetryEvent_timestamp_idx" ON "TelemetryEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Admin_username_idx" ON "Admin"("username");

-- CreateIndex
CREATE INDEX "Admin_email_idx" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "Permission"("resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON "RolePermission"("role", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPermission_adminId_permissionId_key" ON "AdminPermission"("adminId", "permissionId");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_read_createdAt_idx" ON "Notification"("read", "createdAt");

-- CreateIndex
CREATE INDEX "UserNotification_userId_read_idx" ON "UserNotification"("userId", "read");

-- CreateIndex
CREATE INDEX "UserNotification_createdAt_idx" ON "UserNotification"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_type_timestamp_idx" ON "ActivityLog"("type", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_category_timestamp_idx" ON "ActivityLog"("category", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_timestamp_idx" ON "ActivityLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_adminId_timestamp_idx" ON "ActivityLog"("adminId", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSettings_adminId_key" ON "AdminSettings"("adminId");

-- CreateIndex
CREATE INDEX "SupportConversation_visitorId_idx" ON "SupportConversation"("visitorId");

-- CreateIndex
CREATE INDEX "SupportConversation_userId_idx" ON "SupportConversation"("userId");

-- CreateIndex
CREATE INDEX "SupportConversation_status_idx" ON "SupportConversation"("status");

-- CreateIndex
CREATE INDEX "SupportConversation_createdAt_idx" ON "SupportConversation"("createdAt");

-- CreateIndex
CREATE INDEX "SupportConversation_escalatedTo_idx" ON "SupportConversation"("escalatedTo");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_idx" ON "SupportMessage"("conversationId");

-- CreateIndex
CREATE INDEX "SupportMessage_createdAt_idx" ON "SupportMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_conversationId_key" ON "SupportTicket"("conversationId");

-- CreateIndex
CREATE INDEX "SupportTicket_email_idx" ON "SupportTicket"("email");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_priority_idx" ON "SupportTicket"("priority");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedTo_idx" ON "SupportTicket"("assignedTo");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "TicketReply_ticketId_idx" ON "TicketReply"("ticketId");

-- CreateIndex
CREATE INDEX "TriggerEvent_visitorId_idx" ON "TriggerEvent"("visitorId");

-- CreateIndex
CREATE INDEX "TriggerEvent_triggerType_idx" ON "TriggerEvent"("triggerType");

-- CreateIndex
CREATE INDEX "TriggerEvent_createdAt_idx" ON "TriggerEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAgentStatus_adminId_key" ON "SupportAgentStatus"("adminId");

-- CreateIndex
CREATE INDEX "SupportAgentStatus_status_idx" ON "SupportAgentStatus"("status");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpSecret" ADD CONSTRAINT "TotpSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginRequest" ADD CONSTRAINT "LoginRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDeviceLink" ADD CONSTRAINT "UserDeviceLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseLead" ADD CONSTRAINT "EnterpriseLead_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "EnterpriseLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "EnterpriseLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demo" ADD CONSTRAINT "Demo_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "EnterpriseLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_stripeCustomerId_fkey" FOREIGN KEY ("stripeCustomerId") REFERENCES "StripeCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeUsage" ADD CONSTRAINT "PromoCodeUsage_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralClick" ADD CONSTRAINT "ReferralClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "ReferralClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSettings" ADD CONSTRAINT "AdminSettings_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerEvent" ADD CONSTRAINT "TriggerEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
