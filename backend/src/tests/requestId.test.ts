/**
 * Request correlation ids.
 *
 * The property this suite protects:
 *
 *  - **Every response carries an id, and the log line carries the same one.**
 *    Without that, a user reporting "it failed at 14:32" can only be matched to
 *    a log line by guessing the timestamp.
 *
 *  - **A client id is trusted only when it is provably harmless.** The accepted
 *    shape is deliberately narrow — bounded, ASCII, and free of CR/LF — because
 *    the value is echoed into a response header and into a log line. An id
 *    containing a newline could otherwise forge an extra log entry.
 *
 * No dependency is added: the id is `crypto.randomUUID()` and the pattern is a
 * literal.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { REQUEST_ID_HEADER } from '../app.js';
import { closeTestDatabase, prepareTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;
let lines: string[];
let originalLog: typeof console.log;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
  originalLog = console.log;
  lines = [];
  // Captured, not forwarded: forwarding would print the very log lines this
  // suite inspects.
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
});

after(async () => {
  console.log = originalLog;
  await server.close();
  await closeTestDatabase();
});

function capture(): string {
  return lines.join('\n');
}

describe('request id', () => {
  it('generates a valid UUID when the client supplies nothing', async () => {
    const response = await server.client().get('/api/health');

    const id = response.headers.get(REQUEST_ID_HEADER);
    assert.ok(id, 'the header is present');
    assert.match(id, UUID_V4);
  });

  it('generates a different id for each request', async () => {
    const first = await server.client().get('/api/health');
    const second = await server.client().get('/api/health');

    assert.notEqual(
      first.headers.get(REQUEST_ID_HEADER),
      second.headers.get(REQUEST_ID_HEADER),
    );
  });

  it('returns a valid supplied id unchanged', async () => {
    const supplied = 'client_trace_ABC-123';
    const response = await server.client().get('/api/health', {
      headers: { [REQUEST_ID_HEADER]: supplied },
    });

    assert.equal(response.headers.get(REQUEST_ID_HEADER), supplied);
  });

  it('replaces invalid ids rather than echoing them', async () => {
    // Values a conforming HTTP client will actually transmit.
    const sendable: readonly string[] = [
      '', // empty
      'short', // too short (< 8)
      'a'.repeat(65), // too long (> 64)
      'has space here', // whitespace
      '<script>alert(1)</script>', // HTML-like
      'quote"and<angle>', // header-hostile characters
      'üñïçødé-id-12345', // non-ASCII
      'semi;colon=1', // punctuation
    ];

    for (const value of sendable) {
      lines = [];
      const response = await server.client().get('/api/health', {
        headers: { [REQUEST_ID_HEADER]: value },
      });

      const id = response.headers.get(REQUEST_ID_HEADER);
      assert.ok(id, `a replacement was issued for ${JSON.stringify(value)}`);
      assert.match(id, UUID_V4, `rejected ${JSON.stringify(value)}, got ${JSON.stringify(id)}`);
      if (value.length > 0) assert.ok(!capture().includes(value), 'and it never reached the log');
    }
  });

  it('cannot be forced to smuggle a newline — the client refuses to send one', async () => {
    // A stronger guarantee than validation: such a value never leaves the
    // client, so it can never forge an extra log line downstream either.
    for (const value of ['line\nbreak', 'carriage\rreturn']) {
      await assert.rejects(
        () =>
          server.client().get('/api/health', {
            headers: { [REQUEST_ID_HEADER]: value },
          }),
        /invalid header|Headers\.append|illegal/i,
        `${JSON.stringify(value)} should be unsendable`,
      );
    }
  });

  it('logs the same id it returns in the header', async () => {
    const supplied = 'log_correlation_ID-1';
    const response = await server.client().get('/api/health', {
      headers: { [REQUEST_ID_HEADER]: supplied },
    });

    const returned = response.headers.get(REQUEST_ID_HEADER);
    const entry = capture().split('\n').find((l) => l.includes(supplied));
    assert.ok(entry, 'the access log line contains the id');
    assert.ok(entry.includes('GET'), 'and still logs the method');
    assert.ok(entry.includes('/api/health'), 'and still logs the path');
    assert.ok(entry.includes('200'), 'and still logs the status');
    assert.ok(entry.includes('ms'), 'and still logs the duration');
    assert.equal(returned, supplied);
  });

  it('carries the header on successful, error, health and ready responses', async () => {
    // A success, an unauthenticated 401, an unmatched 404, liveness, readiness.
    const cases = await Promise.all([
      server.client().get('/api/health'),
      server.client().get('/api/ready'),
      server.client().get('/api/auth/me'),
      server.client().get('/api/definitely-not-a-route'),
    ]);

    for (const response of cases) {
      assert.ok(
        response.headers.get(REQUEST_ID_HEADER),
        `missing on ${response.status}`,
      );
      assert.match(response.headers.get(REQUEST_ID_HEADER)!, UUID_V4);
    }
  });

  it('keeps the id out of the response body', async () => {
    const response = await server.client().get<Record<string, unknown>>('/api/health');
    const id = response.headers.get(REQUEST_ID_HEADER);

    // A body-level id would make two 404s differ, which tenancy tests rely on.
    assert.equal(JSON.stringify(response.body).includes(id!), false);
  });
});