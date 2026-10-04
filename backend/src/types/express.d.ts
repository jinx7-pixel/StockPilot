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
    }
  }
}

/** A request that has passed through `requireAuth`. */
export type AuthedRequest = Request & { auth: AuthenticatedUser };

export {};
