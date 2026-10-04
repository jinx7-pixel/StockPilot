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
    password: loginPasswordSchema,
  })
  // Reject unexpected keys so a client cannot smuggle in fields such as
  // `role` or `businessId` and have them silently ignored.
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: loginPasswordSchema,
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
