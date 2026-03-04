'use strict';

const { z } = require('zod');

// ── Share Schemas ─────────────────────────────────────────────────────────────────────────────────
// DOZ UP serves per-file share pages at /:filename and tracks views/stats
// in data/shares.json.  These schemas cover the programmatic share-link
// creation endpoints used by the API.

/**
 * POST /api/share  (or similar endpoint)
 * Create a public share link for a file.
 */
const createShareLinkSchema = z.object({
  filename: z
    .string({ required_error: 'Filename is required' })
    .min(1, 'Filename cannot be empty')
    .max(255),
  expiresIn: z
    .number()
    .int()
    .min(1, 'expiresIn must be at least 1 minute')
    .max(525960, 'expiresIn cannot exceed 1 year (525 960 minutes)')
    .optional(), // minutes from now
  password: z
    .string()
    .min(4, 'Password must be at least 4 characters')
    .max(128)
    .optional(),
  maxViews: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .optional(),
});

/**
 * POST /api/share/secure  (or similar endpoint)
 * Create a password-protected or expiring share link.
 * Mirrors createShareLinkSchema but marks password as a primary feature.
 */
const secureShareSchema = z.object({
  filename: z
    .string({ required_error: 'Filename is required' })
    .min(1)
    .max(255),
  password: z
    .string()
    .min(4, 'Password must be at least 4 characters')
    .max(128)
    .optional(),
  expiresIn: z
    .number()
    .int()
    .min(1)
    .max(525960)
    .optional(), // minutes
  maxViews: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .optional(),
});

module.exports = {
  createShareLinkSchema,
  secureShareSchema,
};
