'use strict';

const { z } = require('zod');

// ── Payment Schemas ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/payments/checkout
 * Initiates a Stripe Checkout session.
 */
const createCheckoutSchema = z.object({
  planId: z
    .string({ required_error: 'Plan ID is required' })
    .min(1, 'Plan ID cannot be empty'),
  successUrl: z.string().url('successUrl must be a valid URL').optional(),
  cancelUrl: z.string().url('cancelUrl must be a valid URL').optional(),
});

/**
 * POST /api/payments/webhook
 * Stripe sends many different event shapes — accept any object.
 * Actual event type validation is handled inside the controller
 * after verifying the Stripe signature.
 */
const webhookSchema = z.record(z.unknown());

module.exports = {
  createCheckoutSchema,
  webhookSchema,
};
