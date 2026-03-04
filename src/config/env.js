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

  // Database — required in production, optional in dev/test
  DATABASE_URL: z.string().min(1, { message: 'DATABASE_URL is required' }).optional(),

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
      .map((e) => `  \u2022 ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      console.error('[env] Invalid environment variables:\n' + errors);
      console.error('[env] See .env.example for required values.');
      process.exit(1);
    } else {
      console.warn('[env] WARNING \u2014 environment variables have issues:\n' + errors);
      console.warn('[env] Continuing with defaults for development...');
      // Use defaults from schema for missing values
      const defaults = {
        NODE_ENV: 'development',
        PORT: 3000,
        JWT_SECRET: 'dev_jwt_secret_change_me_in_production_min32',
        REDIS_URL: 'redis://localhost:6379',
        UPLOAD_MAX_SIZE_MB: 10,
        UPLOAD_MAX_SYNC_SIZE_MB: 50,
        BASE_URL: 'https://up.doz.com',
      };
      // Merge: process.env values take priority over defaults
      const merged = { ...defaults };
      for (const [key] of Object.entries(EnvSchema.shape)) {
        if (process.env[key] !== undefined && process.env[key] !== '') {
          merged[key] = process.env[key];
        }
      }
      // Coerce numeric fields
      if (typeof merged.PORT === 'string') merged.PORT = Number(merged.PORT);
      if (typeof merged.SMTP_PORT === 'string') merged.SMTP_PORT = Number(merged.SMTP_PORT);
      if (typeof merged.UPLOAD_MAX_SIZE_MB === 'string') merged.UPLOAD_MAX_SIZE_MB = Number(merged.UPLOAD_MAX_SIZE_MB);
      if (typeof merged.UPLOAD_MAX_SYNC_SIZE_MB === 'string') merged.UPLOAD_MAX_SYNC_SIZE_MB = Number(merged.UPLOAD_MAX_SYNC_SIZE_MB);
      return merged;
    }
  }

  // In production, enforce critical requirements
  if (result.data.NODE_ENV === 'production') {
    if (!result.data.DATABASE_URL) {
      console.error('[env] DATABASE_URL is required in production.');
      process.exit(1);
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev_jwt_secret')) {
      console.error('[env] JWT_SECRET must be set to a strong secret in production.');
      process.exit(1);
    }
  }

  return result.data;
}

// Computed once on first import \u2014 Node.js module cache ensures single evaluation
const env = loadEnv();

module.exports = env;
