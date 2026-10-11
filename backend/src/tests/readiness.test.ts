/**
 * Readiness probe — `GET /api/ready`.
 *
 * The properties, in priority order:
 *
 *  - **Liveness is untouched.** `/api/health` must keep answering `200` with its
 *    exact existing body even when the database is unreachable. If it did not, a
 *    database outage would make an orchestrator restart a healthy process and
 *    turn a dependency failure into an availability one.
 *  - **Readiness fails closed and promptly.** A database that is down, refusing
 *    connections, or accepting them and then going silent must produce `503`
 *    within a bounded time — never a hung request.
 *  - **A probe leaks nothing.** It is unauthenticated, so its body must contain
 *    no host, port, DSN or driver text. The detail belongs in the server log.
 *
 * Runs against `stockpilot_test` through the existing `tests/setup.ts` guard.
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

type ConnectFn = ReturnType<typeof getPool>['connect'];

let server: TestServer;
let originalConnect: ConnectFn | undefined;

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeTestDatabase();
});

afterEach(() => {
  // Restore the real pool behaviour after any test that stubbed it.
  if (originalConnect) getPool().connect = originalConnect;
});

/** Replace `pool.connect()` for one test. */
function stubConnect(impl: () => Promise<never>): void {
  if (!originalConnect) originalConnect = getPool().connect;
  getPool().connect = impl as unknown as ConnectFn;
}

/** A client whose `query` never settles — a connected-but-silent database. */
function silentClient() {
  return {
    query: () => new Promise<never>(() => {}),
    release: () => {},
  };
}

describe('GET /api/ready', () => {
  it('returns 200 and the exact body when the database is reachable', async () => {
    const response = await server.client().get<{ status: string; service: string }>('/api/ready');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok', service: 'stockpilot-api' });
  });

  it('requires no authentication cookie', async () => {
    // The probe has to work for an instance that has lost its database, before
    // any session could exist.
    const response = await server.client().get('/api/ready');
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().length, 0, 'no session is issued');
  });

  it('returns 503 with a generic body when the database refuses connections', async () => {
    stubConnect(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    });

    const response = await server
      .client()
      .get<{ status: string; service: string }>('/api/ready');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: 'unavailable', service: 'stockpilot-api' });
  });

  it('does not hang when the database accepts a connection and then goes silent', async () => {
    stubConnect(async () => silentClient() as never);

    const startedAt = Date.now();
    const response = await server
      .client()
      .get<{ status: string; service: string }>('/api/ready');
    const elapsed = Date.now() - startedAt;

    assert.equal(response.status, 503, 'a silent database is reported unready');
    assert.deepEqual(response.body, { status: 'unavailable', service: 'stockpilot-api' });
    // The probe's own budget is 2s; allow headroom for the HTTP round trip.
    assert.ok(elapsed < 8_000, `answered in ${elapsed}ms rather than hanging`);
  });

  it('never exposes connection details or driver text', async () => {
    const secret = 'postgresql://user:hunter2@db.internal:5432/stockpilot';
    stubConnect(async () => {
      throw new Error(`connection failed: ${secret}`);
    });

    const response = await server.client().get<string>('/api/ready');
    const body = JSON.stringify(response.body);

    assert.equal(response.status, 503);
    assert.ok(!body.includes(secret), 'no DSN');
    assert.ok(!body.includes('hunter2'), 'no password');
    assert.ok(!body.includes('db.internal'), 'no hostname');
    assert.ok(!body.includes('ECONNREFUSED'), 'no driver text');
    assert.ok(!body.includes('connection failed'), 'no error message');
  });

  it('destroys an abandoned client instead of returning it to the pool', async () => {
    // A client left running a query must never be handed to an application query.
    let releasedWith: boolean | undefined;
    getPool().connect = (async () => ({
      query: () => new Promise<never>(() => {}),
      release: (destroy?: boolean) => {
        releasedWith = destroy;
      },
    })) as never;

    await server.client().get('/api/ready');

    assert.equal(releasedWith, true, 'the wedged client was destroyed, not released');
  });
});

describe('GET /api/health — liveness is unchanged', () => {
  it('still answers 200 with its original body when the database is down', async () => {
    stubConnect(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    });

    const response = await server
      .client()
      .get<{ status: string; service: string }>('/api/health');

    // The whole point of the split: liveness stays green while readiness does not.
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok', service: 'stockpilot-api' });
  });
});