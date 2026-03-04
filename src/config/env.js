'use strict';

// Load .env before anything else
require('dotenv').config();

const { z } = require('zod');

// Zod schema for all environment variables
const EnvSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // JWT — required in production
  JWT_SECRET: z
    .string()
    .min(32, { message: 'JWT_SECRET must be at least 32 characters' })
    .optional()
    .default('dev_jwt_secret_change_me_in_production_min32'),

  // Database — required
  DATABASE_URL: z.string().min(1, { message: 'DATABASE_URL is required' }),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // S3 / Object Storage
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Upload limits (MB)
  UPLOAD_MAX_SIZE_MB: z.coerce.number().positive().default(10),
  UPLOAD_MAX_SYNC_SIZE_MB: z.coerce.number().positive().default(50),

  // Public base URL
  BASE_URL: z.string().url().default('https://up.doz.com'),

  // Admin panel
  ADMIN_PANEL_SECRET: z.string().optional(),

  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
});

/**
 * Load and validate environment variables.
 * In production: exits immediately on any validation failure (fail-fast).
 * In development/test: logs a warning but continues with defaults.
 *
 * @returns {z.infer<typeof EnvSchema>} Validated config object
 */
function loadEnv() {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      console.error('[env] Invalid environment variables:\n' + errors);
      console.error('[env] See .env.example for required values.');
      process.exit(1);
    } else {
      console.warn('[env] WARNING — environment variables have issues:\n' + errors);
      // Re-parse with partial to return what we can
      return EnvSchema.partial().parse(process.env);
    }
  }

  // In production, enforce JWT_SECRET is not the default placeholder
  if (result.data.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev_jwt_secret')) {
      console.error('[env] JWT_SECRET must be set to a strong secret in production.');
      process.exit(1);
    }
  }

  return result.data;
}

// Computed once on first import — Node.js module cache ensures single evaluation
const env = loadEnv();

module.exports = env;
