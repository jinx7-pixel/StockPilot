/**
 * Authentication and tenancy middleware.
 *
 * `requireAuth` is the single place a request gains an identity. It reads only
 * the HTTP-only session cookie, and the tenant (`businessId`) it attaches comes
 * from the database — never from the request body, query or headers. Every
 * business-scoped feature must sit behind it.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { env } from '../config/env.js';
import { AuthenticationError, AuthorizationError } from '../errors.js';
import { resolveSession } from '../services/auth.service.js';
import type { UserRole } from '../repositories/auth.types.js';

/**
 * Require a valid session.
 *
 * Responds 401 with no hint about *why* — a missing cookie, an unknown token
 * and an expired token are indistinguishable to the caller.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    const token = readSessionToken(req);

    if (!token) {
      next(new AuthenticationError());
      return;
    }

    const session = await resolveSession(token);
    if (!session) {
      next(new AuthenticationError());
      return;
    }

    req.auth = session.user;
    next();
  })();
};

/**
 * Restrict a route to specific roles. Must be mounted *after* `requireAuth`.
 *
 * A signed-in user without the required role gets 403, never 404 and never a
 * silent success.
 */
export function requireRole(...allowed: readonly UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;

    // Reaching this middleware without `requireAuth` is a wiring bug, not a
    // client error, so surface it loudly rather than as a misleading 401.
    if (!auth) {
      next(new Error('requireRole must be mounted after requireAuth'));
      return;
    }

    if (!allowed.includes(auth.role)) {
      next(
        new AuthorizationError(
          `This action requires one of the following roles: ${allowed.join(', ')}.`,
        ),
      );
      return;
    }

    next();
  };
}

/** Read the session cookie, ignoring the body and any client-supplied header. */
export function readSessionToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.[env.auth.cookieName];

  return typeof token === 'string' && token.length > 0 ? token : null;
}
