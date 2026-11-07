/**
 * Request validation for the auth endpoints.
 *
 * Schemas own *shape* (required fields, types, string lengths, email format).
 * Password policy lives in `security/password.ts` so there is exactly one
 * definition of it, enforced by the service.
 *
 * Email is trimmed and lowercased here, which is the single entry point for
 * normalisation — the database additionally enforces `email = lower(email)`.
 */

import { z } from 'zod';

/** Matches the `users.email_lowercase_check` constraint. */
const emailSchema = z
  .string({ error: 'Email is required.' })
  .trim()
  .min(1, 'Email is required.')
  .max(255, 'Email must be at most 255 characters.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

/**
 * Login accepts any non-empty password: length policy is enforced at
 * registration, and must not be re-applied to existing credentials.
 */
const loginPasswordSchema = z
  .string({ error: 'Password is required.' })
  .min(1, 'Password is required.')
  .max(200, 'Password must be at most 200 characters.');

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enter a valid account link.');
const codeSchema = z.string().trim().regex(/^(?:[0-9]{6}|[a-fA-F0-9]{20})$/, 'Enter a valid authenticator or recovery code.');
export const emailRequestSchema = z.object({ email: emailSchema }).strict();
export const verifyEmailSchema = z.object({ token: tokenSchema }).strict();
export const resetPasswordSchema = z.object({ token: tokenSchema, password: loginPasswordSchema }).strict();
export const mfaStartSchema = z.object({ password: loginPasswordSchema }).strict();
export const mfaConfirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();
export const mfaDisableSchema = z.object({ password: loginPasswordSchema, code: codeSchema }).strict();

/** Matches the `businesses.name` column width. */
const businessNameSchema = z
  .string({ error: 'Business name is required.' })
  .trim()
  .min(1, 'Business name is required.')
  .max(150, 'Business name must be at most 150 characters.');

/** Matches the `users.name` column width. */
const userNameSchema = z
  .string({ error: 'Your name is required.' })
  .trim()
  .min(1, 'Your name is required.')
  .max(100, 'Your name must be at most 100 characters.');

export const registerSchema = z
  .object({
    businessName: businessNameSchema,
    name: userNameSchema,
    email: emailSchema,
    token: tokenSchema,
    password: loginPasswordSchema,
  })
  // Reject unexpected keys so a client cannot smuggle in fields such as
  // `role` or `businessId` and have them silently ignored.
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: loginPasswordSchema,
    workspaceId: z.uuid().optional(),
    mfaCode: codeSchema.optional(),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
