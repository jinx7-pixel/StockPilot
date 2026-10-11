/**
 * Access-log privacy.
 *
 * The property this suite protects:
 *
 *  - **A query string never reaches the access log.** `search` is matched
 *    against customer names, phone numbers and free-text notes, so logging the
 *    full URL wrote real personal data into stdout, and from there into whatever
 *    log aggregator is attached — indefinitely, with no redaction and no
 *    retention limit.
 *
 *  - **The log line stays useful.** Method, path, status and timing must all
 *    survive, or the fix would just be a quieter log nobody can work from.
 *
 * No database, tenant or session is needed: the logging middleware runs before
 * routing, so an unauthenticated request still produces a line — which is
 * exactly the case that matters, because the request never has to be valid.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;
let lines: string[];
let originalLog: typeof console.log;

/** A value that appears nowhere else, so a match can only come from the log. */
const SENSITIVE = 'PrivateCustomerName987';

function captured(): string {
  return lines.join('\n');
}

before(async () => {
  server = await startTestServer();

  originalLog = console.log;
  lines = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    // Not forwarded: forwarding would print the captured lines, which is exactly
    // what this test exists to keep out of the console.
  };
});

after(async () => {
  console.log = originalLog;
  await server.close();
});

describe('access log — query strings never logged', () => {
  it('does not log a sensitive value from a search parameter', async () => {
    const response = await server.client().get(`/api/sales?search=${SENSITIVE}`);

    // The route requires a session, so this is a 401 — and the line is still
    // emitted, because the logger is mounted before authentication.
    assert.equal(response.status, 401);

    const log = captured();
    assert.ok(log.includes('/api/sales'), 'the path is logged');
    assert.ok(!log.includes(SENSITIVE), 'the search value is not logged');
  });

  it('still logs method, path, status and timing', async () => {
    lines = [];
    await server.client().get(`/api/health?probe=${SENSITIVE}`);

    const entry = lines.find((l) => l.includes('[http]'));
    assert.ok(entry, 'an access-log line was emitted');

    assert.match(entry, /^\[http\] GET \/api\/health 200 \d+\.\d+ms$/);
  });

  it('strips the query string but keeps multi-parameter URLs diagnosable', async () => {
    lines = [];
    await server.client().get(`/api/products?search=${SENSITIVE}&page=2&limit=10`);

    const log = captured();
    assert.ok(!log.includes(SENSITIVE), 'the search value is not logged');
    assert.ok(!log.includes('limit=10'), 'no query value of any kind is logged');
    assert.ok(log.includes('/api/products'), 'the path survives');
  });

  it('does not leak a sensitive value through an unauthenticated 404 either', async () => {
    lines = [];
    await server.client().get(`/api/no-such-route?search=${SENSITIVE}`);

    const log = captured();
    assert.ok(log.includes('/api/no-such-route'), 'the 404 path is still logged');
    assert.ok(!log.includes(SENSITIVE), 'the value is not logged on the 404 path');
  });
});