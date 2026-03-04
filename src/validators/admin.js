'use strict';

const { z } = require('zod');

// ── Admin Schemas ─────────────────────────────────────────────────────────────────────────────────

const VALID_ROLES = ['user', 'moderator', 'admin', 'superadmin'];
const VALID_STATUSES = ['active', 'suspended', 'banned', 'pending'];
const VALID_PLANS = ['free', 'pro', 'business', 'enterprise'];

/**
 * POST /api/admin/login
 */
const adminLoginSchema = z.object({
  username: z
    .string({ required_error: 'Username is required' })
    .min(1, 'Username is required')
    .max(100),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

/**
 * PATCH /api/admin/users/:id
 * All fields optional — supports partial updates.
 */
const updateUserSchema = z.object({
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: `Role must be one of: ${VALID_ROLES.join(', ')}` }),
  }).optional(),
  status: z.enum(VALID_STATUSES, {
    errorMap: () => ({ message: `Status must be one of: ${VALID_STATUSES.join(', ')}` }),
  }).optional(),
  plan: z.enum(VALID_PLANS, {
    errorMap: () => ({ message: `Plan must be one of: ${VALID_PLANS.join(', ')}` }),
  }).optional(),
});

/**
 * POST /api/admin/promo-codes
 */
const promoCodeSchema = z.object({
  code: z
    .string({ required_error: 'Promo code is required' })
    .min(3, 'Code must be at least 3 characters')
    .max(50)
    .transform((v) => v.toUpperCase().trim()),
  discount: z
    .number({ required_error: 'Discount is required' })
    .min(0, 'Discount cannot be negative')
    .max(100, 'Discount cannot exceed 100'),
  maxUses: z.number().int().min(1).optional().nullable(),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be a valid ISO 8601 date' })
    .optional()
    .nullable(),
});

/**
 * PUT /api/admin/system/config
 * Flexible object — any key/value pair is accepted.
 * Specific keys are validated when present.
 */
const systemConfigSchema = z
  .object({
    maxUploadSizeMB: z.number().int().min(1).max(500).optional(),
    allowPublicRegistration: z.boolean().optional(),
    requireEmailVerification: z.boolean().optional(),
    defaultStorageQuotaMB: z.number().int().min(100).optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceMessage: z.string().max(500).optional(),
    maxUploadsPerUser: z.number().int().min(1).optional().nullable(),
    rateLimit: z
      .object({
        windowMs: z.number().int().min(1000),
        max: z.number().int().min(1),
      })
      .optional(),
  })
  .passthrough(); // allow additional config keys not listed above

module.exports = {
  adminLoginSchema,
  updateUserSchema,
  promoCodeSchema,
  systemConfigSchema,
};
