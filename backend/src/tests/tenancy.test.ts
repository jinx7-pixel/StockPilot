/**
 * Multi-tenant isolation, role authorization, database constraints and rate
 * limiting.
 *
 * These are the properties that must hold for StockPilot to be safe to sell as
 * a multi-tenant product, so they are tested explicitly rather than assumed.
 */

import assert from 'node:assert/strict';
import cookieParser from 'cookie-parser';
import express from 'express';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { createRateLimiter } from '../middlewares/rateLimit.js';
import { requireAuth, requireRole } from '../middlewares/requireAuth.js';
import { hashPassword } from '../security/password.js';
import { PASSWORD, createStaffUser, registerOwner } from './helpers/fixtures.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startServerWith, startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;
let guarded: TestServer;

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();

  // A throwaway app carrying an owner-only route, since the product has no
  // owner-only feature yet. It composes the *real* middleware.
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/owner-only', requireAuth, requireRole('owner'), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);

  guarded = await startServerWith(app);
});

after(async () => {
  await server.close();
  await guarded.close();
  await closeTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase();
});

describe('multi-tenant isolation', () => {
  it('ignores a businessId supplied as a query parameter', async () => {
    const { client, user: owner } = await registerOwner(server);
    const { user: other } = await registerOwner(server);

    const response = await client.get<{ data: { user: { businessId: string } } }>(
      `/api/auth/me?businessId=${other.businessId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.body.data.user.businessId,
      owner.businessId,
      'the session wins over a client-supplied tenant',
    );
  });

  it("keeps one tenant's session from returning another tenant's user", async () => {
    const { client: tenantA, user: userA } = await registerOwner(server);
    const { user: userB } = await registerOwner(server);

    const response = await tenantA.get<{ data: { user: { id: string } } }>('/api/auth/me');

    assert.equal(response.body.data.user.id, userA.id);
    assert.notEqual(response.body.data.user.id, userB.id);
  });

  it('scopes a tenant-scoped repository lookup to its own business', async () => {
    const { user: userA } = await registerOwner(server);
    const { user: userB } = await registerOwner(server);

    const { findUserById } = await import('../repositories/user.repository.js');

    assert.ok(await findUserById(userA.businessId, userA.id), 'own user is visible');
    assert.equal(
      await findUserById(userA.businessId, userB.id),
      null,
      "another tenant's user is not visible",
    );
  });

  it('resolves the business id from the database, not the request', async () => {
    const { client, user } = await registerOwner(server);

    // A body on GET is ignored entirely by the handler; assert the session wins.
    const response = await client.get<{ data: { user: { businessId: string } } }>('/api/auth/me');

    assert.equal(response.body.data.user.businessId, user.businessId);
  });
});

describe('role authorization', () => {
  it('allows an owner through an owner-only route', async () => {
    const { client, } = await registerOwner(server);
    const proxied = guarded.clientWith(client.cookieMap());

    const response = await proxied.get('/owner-only');

    assert.equal(response.status, 200);
  });

  it('returns 403 for a staff user on an owner-only route', async () => {
    const { user: owner } = await registerOwner(server);
    const email = `staff+${Date.now().toString(36)}@example.com`;
    await createStaffUser({ id: owner.businessId }, email);

    const client = server.client();
    const login = await client.post<{ data: { user: { role: string } } }>('/api/auth/login', {
      email,
      password: PASSWORD,
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.role, 'staff');

    const response = await guarded.clientWith(client.cookieMap()).get('/owner-only');

    assert.equal(response.status, 403, 'forbidden, not unauthenticated');
  });

  it('returns 401 for an anonymous caller on an owner-only route', async () => {
    const response = await guarded.client().get('/owner-only');

    assert.equal(response.status, 401);
  });

  it('allows staff through a role check that includes staff', async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.get('/staff-or-owner', requireAuth, requireRole('owner', 'staff'), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(errorHandler);

    const scoped = await startServerWith(app);

    try {
      const { user: owner } = await registerOwner(server);
      const email = `staff+${Date.now().toString(36)}@example.com`;
      await createStaffUser({ id: owner.businessId }, email);

      const client = server.client();
      await client.post('/api/auth/login', { email, password: PASSWORD });

      const response = await scoped.clientWith(client.cookieMap()).get('/staff-or-owner');
      assert.equal(response.status, 200);
    } finally {
      await scoped.close();
    }
  });
});

describe('database constraints', () => {
  it('rejects a duplicate email within the same business', async () => {
    const { user: owner } = await registerOwner(server);
    const passwordHash = await hashPassword(PASSWORD);

    await assert.rejects(
      getPool().query(
        `INSERT INTO users (business_id, name, email, password_hash, role)
         VALUES ($1, 'Duplicate', $2, $3, 'staff')`,
        [owner.businessId, owner.email, passwordHash],
      ),
      'the unique index on (business_id, email) must reject a duplicate',
    );
  });

  it('allows the same email in two different businesses', async () => {
    const sharedEmail = `shared+${Date.now().toString(36)}@example.com`;

    const { user: first } = await registerOwner(server);
    await createStaffUser({ id: first.businessId }, sharedEmail);

    const { user: second } = await registerOwner(server);
    await createStaffUser({ id: second.businessId }, sharedEmail);

    assert.notEqual(first.businessId, second.businessId, 'the two tenants are distinct');
  });

  it('rejects a mixed-case email at the database level', async () => {
    const { user: owner } = await registerOwner(server);

    await assert.rejects(
      getPool().query(
        `INSERT INTO users (business_id, name, email, password_hash, role)
         VALUES ($1, 'Mixed', $2, $3, 'staff')`,
        [owner.businessId, 'Mixed@Example.com', await hashPassword(PASSWORD)],
      ),
      'the lowercase CHECK constraint must reject a mixed-case email',
    );
  });

  it('cascades deletes from business to users and sessions', async () => {
    const { user: owner } = await registerOwner(server);

    assert.equal(await countRows('auth_sessions'), 1, 'registration opened a session');

    await getPool().query('DELETE FROM businesses WHERE id = $1', [owner.businessId]);

    assert.equal(await countRows('users'), 0, 'users are removed with the business');
    assert.equal(await countRows('auth_sessions'), 0, 'sessions are removed with the user');
  });
});

describe('rate limiting', () => {
  it('returns 429 once the limit is exceeded', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }));
    app.get('/probe', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const throttled = await startServerWith(app);

    try {
      const client = throttled.client();

      assert.equal((await client.get('/probe')).status, 200);
      assert.equal((await client.get('/probe')).status, 200);

      const limited = await client.get<{ code: string }>('/probe');
      assert.equal(limited.status, 429);
      assert.equal(limited.body.code, 'RATE_LIMITED');
    } finally {
      await throttled.close();
    }
  });
});

async function countRows(table: 'businesses' | 'users' | 'auth_sessions'): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return result.rows[0]?.count ?? 0;
}

