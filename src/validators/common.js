'use strict';

const { z } = require('zod');

// ── Common / Shared Schemas ────────────────────────────────────────────────────────────────────────────

/**
 * URL param: /:id  (UUID)
 * Usage: validate(idParamSchema, 'params')
 */
const idParamSchema = z.object({
  id: z
    .string({ required_error: 'ID is required' })
    .uuid('ID must be a valid UUID'),
});

/**
 * Query string pagination.
 * z.coerce.number() accepts both numeric strings ('10') and numbers.
 * Usage: validate(paginationSchema, 'query')
 */
const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  sort: z.enum(['createdAt', 'updatedAt', 'title', 'views']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

/**
 * Query string search.
 * Usage: validate(searchSchema, 'query')
 */
const searchSchema = z.object({
  q: z
    .string({ required_error: 'Search query is required' })
    .min(1, 'Search query cannot be empty')
    .max(200, 'Search query is too long'),
});

module.exports = {
  idParamSchema,
  paginationSchema,
  searchSchema,
};
