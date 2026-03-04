'use strict';

const { z } = require('zod');

// ── Upload Schemas ─────────────────────────────────────────────────────────────────────────────────

/**
 * Metadata accompanying a file upload.
 * Used with multipart/form-data routes where file is handled by multer
 * and the remaining fields arrive as form fields or JSON body.
 */
const uploadMetadataSchema = z.object({
  title: z.string().min(1).max(200).transform((v) => v.trim()).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional().default(false),
  tags: z
    .array(z.string().min(1).max(50))
    .max(20, 'Too many tags (max 20)')
    .optional(),
});

/**
 * Settings for browser-based screenshot capture routes.
 */
const captureSettingsSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048).optional(),
  selector: z.string().max(200).optional(),
  viewport: z
    .object({
      width: z.number().int().min(320).max(3840).optional().default(1280),
      height: z.number().int().min(240).max(2160).optional().default(720),
    })
    .optional(),
  quality: z.number().int().min(1).max(100).optional().default(90),
  format: z.enum(['png', 'jpg', 'webp']).optional().default('png'),
  fullPage: z.boolean().optional().default(false),
  delay: z.number().int().min(0).max(10000).optional().default(0),
});

module.exports = {
  uploadMetadataSchema,
  captureSettingsSchema,
};
