/**
 * Rate limiting for credential endpoints.
 *
 * Login and registration are the two places where an attacker can either guess
 * passwords or enumerate accounts, so both are limited. Buckets are keyed on the
 * client IP using the default `keyGenerator`, which requires `TRUST_PROXY` to be
 * set correctly in production — otherwise every request appears to come from the
 * proxy and shares a single bucket.
 */

import type { Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

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
   * more credential requests than a real user would, and verifies throttling
   * directly against this factory instead.
   */
  skip?: () => boolean;
}

/** Build a limiter carrying StockPilot's shared response shape. */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    // Standard `RateLimit-*` headers, so clients can back off correctly.
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
  limit: 10,
  skip: skipInTests,
});

/** Registration is rarer still, and cheaper to abuse at scale. */
export const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  skip: skipInTests,
});

/** Broad backstop across the whole auth router. */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  skip: skipInTests,
});
