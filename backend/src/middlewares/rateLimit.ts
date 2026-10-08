/**
 * Rate limiting.
 *
 * Two distinct concerns are protected here, and they are deliberately kept apart:
 *
 *   1. **Credential endpoints** — login, registration, the auth router. Keyed on
 *      the client IP, because there is no session yet and the threat is an
 *      anonymous attacker guessing passwords.
 *   2. **Business APIs** — everything behind `requireAuth`. Keyed on the
 *      authenticated user *and* business, because the threat is an abusive
 *      client, not a network scanner.
 *
 * ## Policy
 *
 * | Class                  | Scope                | Limit   | Window | Key                     |
 * |------------------------|----------------------|---------|--------|-------------------------|
 * | Registration           | `POST /auth/register`| 5       | 1 h    | client IP               |
 * | Login                  | `POST /auth/login`   | 10      | 15 min | client IP               |
 * | Auth router backstop   | `/auth/*`            | 60      | 15 min | client IP               |
 * | **Business write**     | `POST/PATCH/DELETE`  | 120     | 15 min | `user` + `business`     |
 * | **Business read**      | `GET/HEAD`           | 600     | 15 min | `user` + `business`     |
 *
 * The two auth rows are pre-existing and unchanged. The two business rows are
 * new. The read budget is roughly three times the write budget because a single
 * page of intelligence is several requests, while a legitimate user writes far
 * less often than they read.
 *
 * ## Why the business key is per-user, not per-business
 *
 * A per-business bucket would let one runaway client, script or browser tab lock
 * out every colleague in that business — a self-inflicted outage. Per-user keeps
 * the blast radius to the offender. `businessId` is still part of the key: a
 * user belongs to exactly one business, so it is strictly redundant today, but it
 * makes the key self-describing and keeps the two dimensions independent if that
 * ever changes.
 *
 * The key is built **only** from `req.auth`, which `requireAuth` derives from the
 * database session. A `businessId` in the query string or request body is never
 * consulted, so a client cannot claim another tenant's quota — or avoid their own.
 *
 * ## Why the limiter is mounted after `requireAuth`
 *
 * The business limiters key on `req.auth`, which does not exist until the session
 * has been resolved. Mounting before `requireAuth` would silently degrade every
 * key to the IP fallback. Each business router therefore applies
 * `businessApiLimiter` immediately after `requireAuth`.
 *
 * That placement is also what keeps `/api/health` open: the health router never
 * authenticates, so it never reaches the limiter. No path string-matching is
 * needed, and there is no list of routes to forget to update.
 *
 * ## Storage
 *
 * The default in-process `MemoryStore`, shared with the existing auth limiters.
 * No Redis and no PostgreSQL table: the counters are ephemeral by nature, and
 * adding durable state for them would buy nothing. The trade-off is that limits
 * are **per process** — see the limitations note in the README section below and
 * in the Step 12.4 report.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { env } from '../config/env.js';
import { RATE_LIMIT_POLICY } from '../config/rateLimitPolicy.js';

/**
 * One conservative message for every throttled request, so the response does not
 * describe the limit and help an attacker tune it.
 */
function respondTooManyRequests(_req: Request, res: Response): void {
  res.status(429).json({
    status: 'error',
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
  });
}

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  /**
   * Return true to bypass this limiter. Only the test suite uses it: it issues
   * far more requests than a real user would, and verifies throttling directly
   * against this factory instead.
   */
  skip?: () => boolean;
}

/** Build a limiter carrying StockPilot's shared response shape. */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    // Standard `RateLimit-*` headers, so clients can back off correctly. These
    // include `RateLimit-Reset`, which is the `Retry-After` equivalent clients
    // can act on without parsing prose.
    standardHeaders: 'draft-7',
    // The deprecated `X-RateLimit-*` headers are not sent.
    legacyHeaders: false,
    handler: respondTooManyRequests,
    ...(options.skip ? { skip: options.skip } : {}),
  });
}

const skipInTests = () => env.isTest;

/** Generous enough for ordinary use, tight enough to stop password guessing. */
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: RATE_LIMIT_POLICY.login.limit,
  skip: skipInTests,
});

/** Registration is rarer still, and cheaper to abuse at scale. */
export const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: RATE_LIMIT_POLICY.register.limit,
  skip: skipInTests,
});

/** Broad backstop across the whole auth router. */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: RATE_LIMIT_POLICY.authRouter.limit,
  skip: skipInTests,
});

// ---------------------------------------------------------------------------
// Business APIs
// ---------------------------------------------------------------------------

/** Methods that consume the read budget. */
function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * Build the identity used for business-API buckets.
 *
 * Prefers the authenticated session. Falls back to the client IP for anything
 * that reaches a limiter without one, so an unauthenticated request can never
 * collapse into a single shared bucket.
 *
 * Exported so the keying can be tested directly, without a running server.
 */
export function businessKeyGenerator(req: Request): string {
  // `req.auth` is present only after `requireAuth`, and is derived from the
  // database session. Nothing from the request body or query is consulted.
  const auth = (req as Request & { auth?: { id: string; businessId: string } }).auth;

  if (auth?.id && auth.businessId) {
    // Both components are present, so one tenant can never be counted against
    // another: the business id is part of the key, not inferred from the user.
    return `u:${auth.id}:b:${auth.businessId}`;
  }

  // `ipKeyGenerator` normalises IPv6 to a /56 subnet. Using the raw address
  // would let a single client rotate through its own IPv6 prefix and bypass the
  // limit entirely, so the fallback goes through the library's helper.
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/** Skip CORS preflight: it carries no credentials and is answered by `cors()`. */
const skipPreflight = (req: Request) => req.method === 'OPTIONS';

/**
 * Build a business-API limiter.
 *
 * Same factory as the auth limiters, but keyed on the session rather than the IP.
 */
export function createBusinessRateLimiter(options: {
  windowMs: number;
  limit: number;
  skip?: () => boolean;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    keyGenerator: businessKeyGenerator,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: respondTooManyRequests,
    // Both the caller's skip and the preflight skip apply.
    skip: (req: Request) => skipPreflight(req) || (options.skip ? options.skip() : false),
  });
}

/**
 * Build the middleware every business router applies.
 *
 * Reads and writes draw from **separate budgets**, so a page full of intelligence
 * requests cannot exhaust the allowance for recording a sale — and a write loop
 * cannot starve ordinary reading.
 *
 * Exported as a factory for the same reason as {@link createRateLimiter}: the
 * tests need to build the same dispatching pair at a low limit, because the
 * production instances deliberately skip in tests.
 */
export function createBusinessApiLimiter(options: {
  readLimit: number;
  writeLimit: number;
  windowMs: number;
  skip?: () => boolean;
}): RequestHandler {
  const readLimiter = createBusinessRateLimiter({
    windowMs: options.windowMs,
    limit: options.readLimit,
    ...(options.skip ? { skip: options.skip } : {}),
  });

  const writeLimiter = createBusinessRateLimiter({
    windowMs: options.windowMs,
    limit: options.writeLimit,
    ...(options.skip ? { skip: options.skip } : {}),
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const limiter = isReadMethod(req.method) ? readLimiter : writeLimiter;
    return limiter(req, res, next);
  };
}

/**
 * The single middleware every business router applies, right after `requireAuth`.
 *
 * Two underlying limiters behind one exported name, so protecting a new router is
 * a single import and a single line.
 */
export const businessApiLimiter: RequestHandler = createBusinessApiLimiter({
  readLimit: RATE_LIMIT_POLICY.businessRead.limit,
  writeLimit: RATE_LIMIT_POLICY.businessWrite.limit,
  windowMs: RATE_LIMIT_POLICY.businessRead.windowMs,
  skip: skipInTests,
});
