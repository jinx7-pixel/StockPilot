/**
 * The error-response contract.
 *
 * Clients switch on `code` and display `error`; `frontend/src/lib/request.ts`
 * reads exactly those two fields and nothing else. This suite pins that shape
 * so it cannot drift:
 *
 *  - **One 404 shape.** A real route reached with a bad id and a path that
 *    matched no route at all must look identical — both `{status, error, code}`.
 *  - **No URL reflection.** The unmatched-route 404 used to echo
 *    `req.originalUrl`, including a query string that list endpoints match
 *    against customer names and phone numbers.
 *  - **A 500 says nothing about why.** The client gets a stable code; the log
 *    line keeps the detail, tied to the request id.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { REQUEST_ID_HEADER } from '../app.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startServerWith, startTestServer, type TestServer } from './helpers/testServer.js';
import { createTenant } from './helpers/tenancy.js';

let server: TestServer;

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeTestDatabase();
});

describe('unmatched route — 404', () => {
  it('uses the consistent shape', async () => {
    const response = await server
      .client()
      .get<{ status: string; error: string; code: string }>('/api/definitely-not-a-route');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      status: 'error',
      error: 'Not Found',
      code: 'NOT_FOUND',
    });
  });

  it('never reflects the URL or its query parameters', async () => {
    const secret = 'PrivateCustomerName987';
    const response = await server
      .client()
      .get<Record<string, unknown>>(`/api/definitely-not-a-route?search=${secret}&page=2`);

    const body = JSON.stringify(response.body);
    assert.equal(response.status, 404);
    assert.ok(!body.includes(secret), 'the search value is not echoed');
    assert.ok(!body.includes('page=2'), 'no query parameter is echoed');
    assert.ok(!body.includes('definitely-not-a-route'), 'not even the path is echoed');
    assert.ok(!('message' in response.body), 'the old message field is gone');
  });
});

describe('unexpected server errors — 500', () => {
  /**
   * Drives the real `errorHandler` through a minimal app rather than stubbing
   * the pool.
   *
   * Stubbing `pool.connect` looks tempting but deadlocks: `Pool.query` calls it
   * in callback form, so a replacement that only throws a rejected promise never
   * invokes the callback and the query promise never settles. Throwing from a
   * route reaches the same handler deterministically.
   */
  it('returns a stable code and leaks no internal detail', async () => {
    const secret = 'pq: relation "secret_table" does not exist at /srv/app/db/pool.ts:88';
    const app = express();
    app.get('/boom', () => {
      throw new Error(secret);
    });
    // Wrapped in an explicit four-argument arrow so Express treats it as error
    // middleware; passing `errorHandler` directly does not type-check against
    // `use`'s three-argument overload.
    app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
      errorHandler(error, _req, res, next);
    });

    const isolated = await startServerWith(app);
    try {
      const response = await fetch(`${isolated.baseUrl}/boom`);
      const body = (await response.json()) as { status: string; error: string; code: string };

      assert.equal(response.status, 500);
      assert.deepEqual(body, {
        status: 'error',
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
      });

      const serialised = JSON.stringify(body);
      assert.ok(!serialised.includes('secret_table'), 'no SQL detail');
      assert.ok(!serialised.includes('/srv/app'), 'no internal path');
      assert.ok(!serialised.includes('relation'), 'no driver text');
    } finally {
      await isolated.close();
    }
  });
});

describe('existing domain errors are unchanged', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('keeps the 401 shape and code', async () => {
    const response = await server
      .client()
      .get<{ status: string; error: string; code: string }>('/api/auth/me');

    assert.equal(response.status, 401);
    assert.equal(response.body.status, 'error');
    assert.equal(response.body.code, 'UNAUTHENTICATED');
  });

  it('answers 401 — not 403 — to an anonymous request for a protected route', async () => {
    const response = await server
      .client()
      .get<{ status: string; error: string; code: string }>('/api/products');

    // A signed-out caller must not be told "forbidden" — that would confirm the
    // route exists. It gets the same 401 an unauthenticated probe receives.
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      status: 'error',
      error: 'Authentication required.',
      code: 'UNAUTHENTICATED',
    });
  });

  it('keeps the 404 code for a cross-tenant id on a real route', async () => {
    const tenant = await createTenant(server);
    const foreign = await tenant.client.get<{ status: string; error: string; code: string }>(
      '/api/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    // Same {status, error, code} shape as the unmatched-route 404 — that is the
    // point. The message is the route's own, which tenancy tests rely on.
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.status, 'error');
    assert.equal(foreign.body.code, 'NOT_FOUND');
    assert.equal(foreign.body.error, 'Product not found.');
  });

  it('keeps validation errors as 400 with their code', async () => {
    const tenant = await createTenant(server);
    const response = await tenant.client.post<{ status: string; error: string; code: string }>(
      '/api/products',
      {},
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'error');
    assert.equal(response.body.code, 'INVALID_REQUEST');
    assert.match(response.body.error, /sku/i);
  });

  it('keeps health and readiness bodies exactly as they were', async () => {
    const health = await server.client().get<{ status: string; service: string }>('/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok', service: 'stockpilot-api' });

    const ready = await server.client().get<{ status: string; service: string }>('/api/ready');
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: 'ok', service: 'stockpilot-api' });

    // They gained the header, but their bodies are untouched.
    assert.ok(health.headers.get(REQUEST_ID_HEADER));
    assert.ok(ready.headers.get(REQUEST_ID_HEADER));
  });
});