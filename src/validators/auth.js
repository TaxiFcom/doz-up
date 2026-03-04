'use strict';

const { z } = require('zod');

// ── Reusable primitives ─────────────────────────────────────────────────────────────────────────────────

const emailSchema = z
  .string({ required_error: 'Email is required' })
  .email('Invalid email address')
  .max(254, 'Email is too long')
  .transform((v) => v.toLowerCase().trim());

const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password is too long');

const strongPasswordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

// ── Auth Schemas ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 */
const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

/**
 * POST /api/auth/register
 */
const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ required_error: 'Please confirm your password' }),
    name: z.string().min(1).max(100).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * POST /api/auth/forgot-password
 */
const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/**
 * POST /api/auth/reset-password
 */
const resetPasswordSchema = z
  .object({
    token: z.string({ required_error: 'Reset token is required' }).min(1),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().optional(),
  })
  .refine(
    (data) => !data.confirmPassword || data.newPassword === data.confirmPassword,
    {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }
  );

/**
 * POST /api/auth/change-password
 */
const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'Current password is required' }).min(1),
    newPassword: strongPasswordSchema,
    confirmNewPassword: z.string().optional(),
  })
  .refine(
    (data) => !data.confirmNewPassword || data.newPassword === data.confirmNewPassword,
    {
      message: 'New passwords do not match',
      path: ['confirmNewPassword'],
    }
  )
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

module.exports = {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
