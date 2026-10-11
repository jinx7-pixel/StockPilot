/**
 * Expired-session cleanup.
 *
 * Two properties, in priority order:
 *
 *  - **Dead sessions are actually removed.** `deleteExpiredSessions()` existed
 *    and was never called, so the table grew one row per login forever.
 *  - **A cleanup problem never becomes an outage.** A failed sweep, an
 *    overlapping sweep, or a shutdown mid-sweep must not reject, must not
 *    double-run, and must not use a pool that is closing.
 *
 * Runs entirely against `stockpilot_test` via the existing `tests/setup.ts`
 * guard, which refuses to start if it ever equals `PGDATABASE`. The scheduling
 * behaviour is driven with an injected timer, so nothing here waits an hour and
 * nothing depends on wall-clock timing.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import crypto from 'node:crypto';

import { getPool } from '../db/pool.js';
import { createSessionCleanup } from '../jobs/sessionCleanup.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createTenant } from './helpers/tenancy.js';

let server: TestServer;
let userId: string;

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase();
  // A fresh tenant per test: `resetTestDatabase` truncates `users` too, so the
  // owner registered here is the only valid `auth_sessions.user_id` for the
  // rows this test inserts.
  const tenant = await createTenant(server);
  userId = tenant.user.id;
});

/** Insert a session with a chosen expiry, directly, so the test controls the clock. */
async function insertSession(expiresAt: Date): Promise<string> {
  const tokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, tokenHash, expiresAt],
  );
  const row = rows[0];
  if (!row) throw new Error('INSERT … RETURNING id produced no row');
  return row.id;
}

async function countSessions(): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    'SELECT count(*)::int AS n FROM auth_sessions',
  );
  const row = rows[0];
  if (!row) throw new Error('count(*) produced no row');
  return row.n;
}

// ---------------------------------------------------------------------------
// What the sweep actually deletes
// ---------------------------------------------------------------------------

describe('session cleanup — what it deletes', () => {
  it('removes expired sessions and keeps live ones', async () => {
    // `createTenant` leaves one live session of its own; it must survive too.
    const baseline = await countSessions();
    const expiredA = await insertSession(new Date(Date.now() - HOUR));
    const expiredB = await insertSession(new Date(Date.now() - MINUTE));
    const live = await insertSession(new Date(Date.now() + 7 * 24 * HOUR));

    const removed = await createSessionCleanup({ enabled: true }).runOnce();

    assert.equal(removed, 2, 'both expired sessions are removed');
    assert.equal(await countSessions(), baseline + 1, 'only the new live session was added back');

    const { rows } = await getPool().query<{ id: string }>('SELECT id FROM auth_sessions');
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(live), 'the live session survived');
    assert.ok(!ids.includes(expiredA), 'the expired session is gone');
    assert.ok(!ids.includes(expiredB), 'the other expired session is gone');
  });

  it('is idempotent — a second sweep removes nothing', async () => {
    await insertSession(new Date(Date.now() - HOUR));

    const job = createSessionCleanup({ enabled: true });
    assert.equal(await job.runOnce(), 1);
    assert.equal(await job.runOnce(), 0, 'nothing left to delete');
    assert.equal(await job.runOnce(), 0);
  });
  it('leaves a table of only-live sessions untouched', async () => {
    const baseline = await countSessions();
    await insertSession(new Date(Date.now() + HOUR));
    await insertSession(new Date(Date.now() + 2 * HOUR));

    assert.equal(await createSessionCleanup({ enabled: true }).runOnce(), 0);
    assert.equal(await countSessions(), baseline + 2, 'nothing was removed');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: timing, overlap, failures, shutdown
// ---------------------------------------------------------------------------

describe('session cleanup — lifecycle', () => {
  /** A timer we drive by hand, so nothing sleeps. */
  function fakeTimer() {
    let handler: (() => void) | null = null;
    let scheduledMs: number | null = null;
    let cleared = false;
    let setCount = 0;
    return {
      setIntervalFn: (fn: () => void, ms: number) => {
        handler = fn;
        scheduledMs = ms;
        setCount++;
        return { fake: true, unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {
        cleared = true;
      },
      tick: () => handler?.(),
      isCleared: () => cleared,
      intervalMs: () => scheduledMs,
      setCount: () => setCount,
    };
  }

  it('does not schedule anything when disabled (the test-mode default)', () => {
    const t = fakeTimer();
    const job = createSessionCleanup({ enabled: false, setIntervalFn: t.setIntervalFn, clearIntervalFn: t.clearIntervalFn });

    job.start();

    assert.equal(t.intervalMs(), null, 'no timer was created');
    assert.equal(t.isCleared(), false);
  });

  it('schedules at the configured interval and unrefs the timer', () => {
    const t = fakeTimer();
    let unrefCalled = false;
    const job = createSessionCleanup({
      enabled: true,
      intervalMs: 90_000,
      setIntervalFn: ((fn: () => void, ms: number) => {
        t.setIntervalFn(fn, ms);
        return {
          unref: () => {
            unrefCalled = true;
          },
        } as unknown as ReturnType<typeof setInterval>;
      }) as never,
      clearIntervalFn: t.clearIntervalFn,
    });

    job.start();

    assert.equal(t.intervalMs(), 90_000, 'uses the configured interval');
    assert.ok(unrefCalled, 'the timer is unref-ed so it cannot hold the process open');
  });

  it('a scheduled tick runs the cleanup', async () => {
    const t = fakeTimer();
    let runs = 0;
    const job = createSessionCleanup({
      enabled: true,
      setIntervalFn: t.setIntervalFn,
      clearIntervalFn: t.clearIntervalFn,
      cleanup: async () => {
        runs++;
        return 0;
      },
    });

    job.start();
    t.tick();
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(runs, 1);
  });

  it('never runs two sweeps at once', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let release!: () => void;

    const job = createSessionCleanup({
      enabled: true,
      cleanup: () =>
        new Promise<number>((resolve) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          release = () => {
            concurrent--;
            resolve(0);
          };
        }),
    });

    const first = job.runOnce();
    // A second sweep while the first is still in flight must be skipped, not queued.
    const second = await job.runOnce();
    release();
    await first;

    assert.equal(second, null, 'the overlapping sweep is skipped');
    assert.equal(maxConcurrent, 1, 'never more than one sweep at a time');
  });

  it('a failed sweep is caught, and later sweeps still run', async () => {
    const messages: string[] = [];
    let attempt = 0;

    const job = createSessionCleanup({
      enabled: true,
      log: (m) => messages.push(m),
      cleanup: async () => {
        attempt++;
        if (attempt === 1) throw new Error('connection reset');
        return 3;
      },
    });

    // Must not reject: the job swallows its own failures.
    const first = await job.runOnce();
    assert.equal(first, -1, 'the failure is reported, not thrown');
    assert.match(messages.join('\n'), /session cleanup failed: connection reset/);

    const second = await job.runOnce();
    assert.equal(second, 3, 'a later sweep still works');
    assert.match(messages.join('\n'), /removed 3 expired session/);
  });

  it('a stopped job runs no further sweeps', async () => {
    const t = fakeTimer();
    let runs = 0;
    const job = createSessionCleanup({
      enabled: true,
      setIntervalFn: t.setIntervalFn,
      clearIntervalFn: t.clearIntervalFn,
      cleanup: async () => {
        runs++;
        return 0;
      },
    });

    job.start();
    await job.stop();
    t.tick(); // a tick that was already queued
    assert.equal(await job.runOnce(), null, 'runOnce is refused after stop');

    assert.equal(runs, 0, 'no sweep ran after shutdown began');
    assert.ok(t.isCleared(), 'the interval was cleared');
    assert.ok(job.isStopped());
  });

  it('stop() waits for an in-flight sweep before resolving', async () => {
    let finished = false;
    let release!: () => void;

    const job = createSessionCleanup({
      enabled: true,
      cleanup: () =>
        new Promise<number>((resolve) => {
          release = () => {
            finished = true;
            resolve(0);
          };
        }),
    });

    void job.runOnce();

    let stopped = false;
    const stopping = job.stop().then(() => {
      stopped = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(stopped, false, 'stop() has not resolved while the sweep is in flight');

    release();
    await stopping;
    assert.equal(stopped, true);
    assert.equal(finished, true, 'the sweep completed before stop() resolved');
  });

  it('stop() is safe to call repeatedly, and a later start() does not revive it', async () => {
    const t = fakeTimer();
    const job = createSessionCleanup({
      enabled: true,
      setIntervalFn: t.setIntervalFn,
      clearIntervalFn: t.clearIntervalFn,
    });

    job.start();
    assert.equal(t.setCount(), 1, 'the timer was armed once');

    await job.stop();
    await job.stop();
    await job.stop();
    assert.equal(t.setCount(), 1, 'repeated stops do not re-arm anything');

    // A second start after stop must not resurrect the timer.
    job.start();
    assert.equal(t.setCount(), 1, 'start() after stop() is a no-op');
    assert.equal(await job.runOnce(), null, 'and the job still refuses to run');
    assert.ok(job.isStopped());
  });
});
