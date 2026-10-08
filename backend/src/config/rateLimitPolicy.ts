/**
 * Rate-limit policy, in one place.
 *
 * Kept out of `middlewares/rateLimit.ts` so the numbers can be read — and
 * argued about — without wading through middleware wiring, and so the tests can
 * assert the *documented* policy rather than the limits that happen to be wired.
 *
 * ## Choosing these numbers
 *
 * The read budget is the one worth scrutinising. StockPilot's intelligence pages
 * are genuinely request-heavy: opening the unified view, the recommendations
 * view and the Action Center fires several calls, and browsing for fifteen
 * minutes is realistic. `businessRead` allows 600 per window, which is far above
 * genuine use but still bounds a runaway loop at roughly 40 requests a minute.
 *
 * `businessWrite` is tighter at 120. A user creating products, recording sales
 * and raising purchase orders does not come close to that, while a script
 * hammering `POST` is stopped quickly. Writes are the operations that mutate
 * state, so they get the smaller budget.
 *
 * Both windows are 15 minutes, matching the auth router's window so the whole API
 * has one retry rhythm.
 *
 * ## Multi-replica caveat
 *
 * The default in-process store means these are **per process** limits. Running N
 * replicas raises the effective ceiling to roughly N x the stated limit, and a
 * rolling restart clears every counter. That is a deliberate trade for this
 * milestone: the counters are ephemeral, and introducing Redis or a database
 * table would add infrastructure for state that never needs to survive. Revisit
 * only when the API runs on more than one instance.
 */

/** One row of the policy table. */
export interface RateLimitRule {
  /** Requests permitted per window, per key. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMIT_POLICY = {
  /** `POST /api/auth/register` — per client IP. */
  register: { limit: 5, windowMs: 60 * 60 * 1000 },

  /** `POST /api/auth/login` — per client IP. */
  login: { limit: 10, windowMs: 15 * 60 * 1000 },

  /** Backstop across `/api/auth/*` — per client IP. */
  authRouter: { limit: 60, windowMs: 15 * 60 * 1000 },

  /** Business `GET`/`HEAD` — per authenticated user and business. */
  businessRead: { limit: 600, windowMs: 15 * 60 * 1000 },

  /** Business `POST`/`PATCH`/`PUT`/`DELETE` — per authenticated user and business. */
  businessWrite: { limit: 120, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitClass = keyof typeof RATE_LIMIT_POLICY;
