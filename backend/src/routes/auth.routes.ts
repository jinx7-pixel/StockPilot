/**
 * Auth routes.
 *
 * Validation, service orchestration and cookie handling only — no business logic
 * and no SQL. `GET /auth/me` sits behind `requireAuth`, so it rejects anonymous
 * callers with 401 and, when authenticated, returns the tenant resolved from the
 * session rather than anything the client sent.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { authRateLimiter, loginRateLimiter, registerRateLimiter } from '../middlewares/rateLimit.js';
import { readSessionToken, requireAuth } from '../middlewares/requireAuth.js';
import { clearSessionCookie, setSessionCookie } from '../security/cookies.js';
import { loginSchema, registerSchema } from '../services/auth.schemas.js';
import * as authService from '../services/auth.service.js';
import type { AuthedRequest } from '../types/express.js';

export const authRouter: Router = Router();

// Broad backstop for the whole router; the per-route limiters below are tighter.
authRouter.use(authRateLimiter);

/** Translate a Zod failure into a 400 that names the offending field. */
function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'request';
    throw new ValidationError(
      issue ? `${field}: ${issue.message}` : 'Invalid request body.',
      'INVALID_REQUEST',
    );
  }

  return result.data;
}

/**
 * POST /api/auth/register
 *
 * Creates a business and its owner in one transaction, then signs the new owner
 * in. The response body deliberately contains no token: the credential travels
 * only in the HTTP-only cookie, so it cannot be read by client-side JavaScript.
 */
authRouter.post(
  '/register',
  registerRateLimiter,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(registerSchema, req.body);

    const session = await authService.registerBusinessOwner(input);

    setSessionCookie(res, session.token, session.expiresAt);

    res.status(201).json({ data: { user: session.user } });
  }),
);

/** POST /api/auth/login — exchanges credentials for a session cookie. */
authRouter.post(
  '/login',
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);

    const session = await authService.login(input);

    setSessionCookie(res, session.token, session.expiresAt);

    res.status(200).json({ data: { user: session.user } });
  }),
);

/**
 * POST /api/auth/logout
 *
 * Revokes the session server-side, then clears the cookie. Idempotent: signing
 * out twice, or without a session, is a success rather than an error.
 */
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = readSessionToken(req);

    if (token) {
      await authService.logout(token);
    }

    clearSessionCookie(res);

    res.status(200).json({ data: { loggedOut: true } });
  }),
);

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user and their business. Rejects anonymous callers
 * with 401 so the frontend can distinguish "signed out" from "signed in".
 */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(200).json({ data: { user: req.auth } });
  }),
);
