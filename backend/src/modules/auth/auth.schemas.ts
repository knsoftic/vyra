/**
 * Request schemas.
 *
 * Validation happens before a handler runs, so services can trust their inputs.
 * Unknown keys are stripped rather than passed through — a client cannot smuggle
 * an extra field into an UPDATE by adding it to the body.
 */

import { z } from 'zod';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.ts';
import { USERNAME_MAX, USERNAME_MIN } from '../users/username.ts';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(191)
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX);

export const deviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z.string().max(20).optional(),
  pushToken: z.string().max(255).optional(),
});

export const otpPurposeSchema = z.enum(['signup', 'login', 'reset', 'email_change']);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(60).optional(),
  // ISO date. The age check itself lives in the service, where the rule belongs.
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.'),
  referralCode: z.string().trim().max(20).optional(),
  device: deviceSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: rejecting a short password at sign-in would tell an
  // attacker their guess was too short to be this account's password.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  device: deviceSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const otpRequestSchema = z.object({
  email: emailSchema,
  purpose: otpPurposeSchema,
});

export const otpVerifySchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  purpose: otpPurposeSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

// ── Profile and graph ──

export const profileLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().url('Enter a valid URL.').max(500),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(500).optional(),
  avatarKey: z.string().trim().max(500).optional(),
  links: z.array(profileLinkSchema).max(5).optional(),
  language: z.string().trim().min(2).max(10).optional(),
});

export const audienceSchema = z.enum(['everyone', 'followers', 'nobody']);

export const privacySchema = z.object({
  isPrivate: z.boolean().optional(),
  whoCanComment: audienceSchema.optional(),
  whoCanMessage: audienceSchema.optional(),
  whoCanDuet: audienceSchema.optional(),
  whoCanMention: audienceSchema.optional(),
  allowDownload: z.boolean().optional(),
  suggestAccount: z.boolean().optional(),
  allowRemix: z.boolean().optional(),
  personalisedAds: z.boolean().optional(),
  showActivityStatus: z.boolean().optional(),
});

export const switchAccountTypeSchema = z.object({
  category: z.enum(['individual', 'business']),
  type: z.enum([
    'normal', 'creator', 'public_figure', 'professional',
    'company', 'brand', 'shop', 'organization', 'advertiser', 'service_provider',
  ]),
});

export const businessProfileSchema = z.object({
  category: z.string().trim().max(80).optional(),
  website: z.string().trim().url().max(255).optional(),
  contactEmail: emailSchema.optional(),
  contactPhone: z.string().trim().max(40).optional(),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaUrl: z.string().trim().url().max(500).optional(),
});

export const reportSchema = z.object({
  targetType: z.enum(['user', 'video', 'comment', 'live', 'community', 'message']),
  targetId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(1000).optional(),
});

export const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const usernameQuerySchema = z.object({
  username: usernameSchema,
});
