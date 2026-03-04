'use strict';

const { z } = require('zod');

// ── Gallery Schemas ─────────────────────────────────────────────────────────────────────────────────
// Based on gallery routes in gateway.js (~lines 6009–6342).
//
// The gateway accepts:
//   POST /api/galleries        → { name, template, deviceId, ownerName }
//   POST /api/galleries/join   → { inviteCode, deviceId, memberName }
//   POST /api/galleries/:id/photos → { uploadId, deviceId }

/**
 * POST /api/galleries
 * Create a new shared gallery.
 */
const createGallerySchema = z.object({
  name: z
    .string({ required_error: 'Gallery name is required' })
    .min(1, 'Gallery name cannot be empty')
    .max(100, 'Gallery name is too long')
    .transform((v) => v.trim()),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional().default(false),
  template: z.string().max(50).optional().default('classic'),
  deviceId: z.string().min(1, 'Device ID is required').optional(),
  ownerName: z.string().max(100).optional(),
});

/**
 * POST /api/galleries/join
 * Join an existing gallery with an invite code.
 */
const joinGallerySchema = z.object({
  code: z
    .string({ required_error: 'Invite code is required' })
    .min(1, 'Invite code cannot be empty')
    .max(20)
    .transform((v) => v.toUpperCase().trim()),
  // Gateway field alias — also accept 'inviteCode' directly
  inviteCode: z.string().max(20).optional(),
  deviceId: z.string().min(1, 'Device ID is required').optional(),
  memberName: z.string().max(100).optional(),
});

/**
 * POST /api/galleries/:id/photos
 * Add a photo (by upload ID or image URL/filename) to a gallery.
 */
const addPhotoSchema = z.object({
  galleryId: z.string().min(1).optional(), // may also come from URL param
  uploadId: z.string().min(1).optional(),  // preferred: reference to uploads DB
  imageUrl: z.string().url('imageUrl must be a valid URL').optional(),
  filename: z.string().min(1).max(255).optional(),
  deviceId: z.string().min(1, 'Device ID is required').optional(),
}).refine(
  (data) => data.uploadId || data.imageUrl || data.filename,
  {
    message: 'Provide at least one of: uploadId, imageUrl, or filename',
    path: ['uploadId'],
  }
);

module.exports = {
  createGallerySchema,
  joinGallerySchema,
  addPhotoSchema,
};
