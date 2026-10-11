/**
 * Periodic removal of expired sessions.
 *
 * ## Why this exists
 *
 * `deleteExpiredSessions()` has been in the repository since sessions were
 * introduced, documented as being "meant for a periodic job" — and no such job
 * existed. Nothing else ever removes a row, so `auth_sessions` grows by one row
 * per login, forever.
 *
 * This is a storage problem, not a security one. An expired token is already
 * refused: `findSessionContextByTokenHash` filters `expires_at > now()` in SQL,
 * so a dead row can never authenticate. The index on `expires_at` was created
 * for exactly this sweep.
 *
 * ## Why a single unbounded DELETE is correct here
 *
 * `DELETE ... WHERE expires_at <= now()` is one statement, so `now()` is fixed
 * for the whole sweep and the row set cannot shift under it. Readers never take
 * row locks — they filter on the same column — so a cleanup running alongside
 * live traffic cannot block a request or be blocked by one. Running it twice
 * deletes nothing the second time. That is why there is no batching: it would
 * add a second SQL path for a scan the index already answers.
 *
 * ## Multi-instance deployments
 *
 * Every instance sweeps on its own timer. That is harmless but wasteful: the
 * DELETE is idempotent, so the losers simply delete 0 rows.
 */

import { env } from '../config/env.js';
import { deleteExpiredSessions } from '../repositories/session.repository.js';

/** One sweep. Resolves to the number of rows removed, or `null` if it did not run. */
export type CleanupRun = () => Promise<number | null>;

export interface SessionCleanupOptions {
  /** Delay between sweeps. */
  intervalMs?: number;
  /** The sweep itself. Injected so tests need no timer and no database. */
  cleanup?: () => Promise<number>;
  /** Where to report. Defaults to stdout. */
  log?: (message: string) => void;
  /** When false, `start()` is a no-op. Defaults to "not under test". */
  enabled?: boolean;
  /** Injected timer functions, so a test can drive ticks synchronously. */
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface SessionCleanup {
  /** Begin scheduling. A no-op when disabled, or when already started. */
  start(): void;
  /** Stop scheduling and wait for any in-flight sweep. Safe to call repeatedly. */
  stop(): Promise<void>;
  /** Run one sweep now, honouring the same guards as a scheduled tick. */
  runOnce(): Promise<number | null>;
  /** True once `stop()` has been called. */
  isStopped(): boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export function createSessionCleanup(options: SessionCleanupOptions = {}): SessionCleanup {
  const {
    intervalMs = env.sessionCleanup.intervalMs,
    cleanup = deleteExpiredSessions,
    log = (message: string) => console.log(message),
    enabled = !env.isTest,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options;

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let inFlight: Promise<number | null> | null = null;

  const runOnce = async (): Promise<number | null> => {
    // A stopped job never sweeps again, and a sweep still running is never
    // joined by a second one: a slow database degrades to "less often", never
    // to a pile of concurrent DELETEs.
    if (stopped || inFlight) return null;

    const attempt = (async (): Promise<number> => {
      try {
        const removed = await cleanup();
        // Counts only. Never the rows, which would mean logging session data.
        if (removed > 0) log(`[jobs] session cleanup removed ${removed} expired session(s)`);
        return removed;
      } catch (error) {
        // Swallowed deliberately. A failed sweep is a background nuisance; the
        // next one may well succeed, and an unhandled rejection here would take
        // the whole process down.
        log(
          `[jobs] session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return -1;
      }
    })();

    inFlight = attempt;
    try {
      return await attempt;
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  };

  const start = (): void => {
    if (!enabled || stopped || timer !== null) return;

    timer = setIntervalFn(() => {
      void runOnce();
    }, intervalMs);
    // Never let the job hold the process open; `server.ts` owns the lifetime.
    timer.unref?.();
  };

  const stop = async (): Promise<void> => {
    stopped = true;

    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }

    // Drain before the caller closes the pool: a sweep still using it would
    // otherwise fail against a closing connection.
    if (inFlight) {
      await inFlight;
    }
  };

  return { start, stop, runOnce, isStopped: () => stopped };
}

/** The production instance: real repository, real interval, disabled under test. */
export function startSessionCleanup(): SessionCleanup {
  const job = createSessionCleanup();
  job.start();
  return job;
}

export { HOUR_MS };
