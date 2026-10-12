/**
 * Express type augmentation for the authenticated request.
 *
 * `req.auth` is populated by `requireAuth`, so it is only present on routes
 * behind that middleware. `AuthedRequest` expresses exactly that, letting route
 * handlers use a non-optional `req.auth` without a cast or a runtime guard.
 */

import type { Request } from 'express';

import type { AuthenticatedUser } from '../services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      /**
       * Identity and tenant of the caller, attached by `requireAuth`.
       *
       * Carries only safe fields: no `password_hash`, no session token.
       */
      auth?: AuthenticatedUser;
      /**
       * Correlation id for this request, attached by the request-id middleware.
       *
       * Always a validated `[A-Za-z0-9_-]{8,64}` value: either a safe client id
       * or a freshly generated UUID. Never empty, never unbounded, and free of
       * characters that could forge a log line.
       */
      requestId: string;
    }
  }
}

/** A request that has passed through `requireAuth`. */
export type AuthedRequest = Request & { auth: AuthenticatedUser };

export {};
