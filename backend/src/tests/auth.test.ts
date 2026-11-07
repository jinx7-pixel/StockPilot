/**
 * Auth endpoint tests: registration, login, session lifecycle and validation.
 *
 * The suite drives the real Express app over HTTP against a dedicated test
 * database, so middleware order, cookie handling, validation and the database
 * constraints are exercised together rather than mocked.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { hashPassword } from '../security/password.js';
import { PASSWORD, WEAK_PASSWORD, registerOwner, registrationBody, verifiedRegistration } from './helpers/fixtures.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;

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
});

describe('POST /api/auth/register', () => {
  it('creates the business and its owner together', async () => {
    const body = registrationBody();
    const response = await server.client().post<{
      data: {
        user: {
          id: string;
          businessId: string;
          role: string;
          email: string;
          business: { name: string };
        };
      };
    }>('/api/auth/register', await verifiedRegistration(server, body));

    assert.equal(response.status, 201);

    const user = response.body.data.user;
    assert.equal(user.role, 'owner', 'the first user of a business is its owner');
    assert.equal(user.email, body.email);
    assert.equal(user.business.name, body.businessName);
    assert.ok(user.businessId, 'businessId is present');

    const { rows } = await getPool().query<{ business_name: string }>(
      `SELECT b.name AS business_name
         FROM users u
         JOIN businesses b ON b.id = u.business_id
        WHERE u.id = $1`,
      [user.id],
    );
    assert.equal(rows.length, 1, 'the owner is persisted and linked to the business');
    assert.equal(rows[0]?.business_name, body.businessName);
  });

  it('never returns password material', async () => {
    const response = await server.client().post('/api/auth/register', await verifiedRegistration(server));
    assert.equal(response.status, 201);

    const serialised = JSON.stringify(response.body);
    assert.ok(!serialised.includes('$argon2'), 'no Argon2 hash in the response');
    assert.ok(!('password_hash' in (response.body as object)));
  });

  it('sets an HTTP-only cookie and no token in the body', async () => {
    const response = await server.client().post('/api/auth/register', await verifiedRegistration(server));

    const cookie = response.setCookie.find((c) => c.startsWith(`${env.auth.cookieName}=`));
    assert.ok(cookie, 'a session cookie is set');
    assert.match(cookie, /HttpOnly/i, 'the cookie is HttpOnly');
    assert.ok(!/token/i.test(JSON.stringify(response.body)), 'the token is not in the body');
  });

  it('normalises the email to lower case', async () => {
    const response = await server.client().post<{ data: { user: { email: string } } }>(
      '/api/auth/register',
      await verifiedRegistration(server, registrationBody({ email: '  MiXeD.Case@Example.COM  ' })),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.email, 'mixed.case@example.com');
  });

  it('rejects a repeat signup without locking the original owner out', async () => {
    const { client: original, user } = await registerOwner(server);
    const credentials = { email: user.email, password: PASSWORD };
    await original.post('/api/auth/logout');

    const duplicate = server.client();
    const response = await duplicate.post('/api/auth/register/request', { email: user.email.toUpperCase() });
    const unknown = await duplicate.post('/api/auth/register/request', { email: 'unknown@example.com' });
    // Check sign-in before the signup status to catch the original lockout.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const login = await original.post<{ data: { user: { id: string } } }>(
        '/api/auth/login', credentials,
      );
      assert.equal(login.status, 200);
      assert.equal(login.body.data.user.id, user.id);
      await original.post('/api/auth/logout');
    }

    assert.equal(response.status, 202);
    assert.deepEqual(response.body, unknown.body);
    assert.deepEqual(response.setCookie, []);
    assert.equal((await duplicate.get('/api/auth/me')).status, 401);
    assert.equal(await countRows('businesses'), 1, 'a duplicate leaves no orphan workspace');
    assert.equal(await countRows('users'), 1);
  });

  it('creates only one workspace when signups for the same email overlap', async () => {
    const body = registrationBody();
    const first = await verifiedRegistration(server, body);
    const second = await verifiedRegistration(server, registrationBody({ email: body.email.toUpperCase() }));

    const responses = await Promise.all([
      server.client().post('/api/auth/register', first),
      server.client().post('/api/auth/register', second),
    ]);

    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 400]);
    assert.equal(await countRows('businesses'), 1);
    assert.equal(await countRows('users'), 1);
    assert.equal(await countRows('auth_sessions'), 1);
  });

  it('rejects a weak password with 400 and creates nothing', async () => {
    const before = await countRows('businesses');

    const response = await server
      .client()
      .post('/api/auth/register', await verifiedRegistration(server, registrationBody({ password: WEAK_PASSWORD })));

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(response.body), /12 characters/i);
    assert.equal(await countRows('businesses'), before, 'no orphaned business is left behind');
  });

  it('rejects a missing field with a clear 400', async () => {
    const body = await verifiedRegistration(server);
    delete (body as Record<string, unknown>).businessName;

    const response = await server.client().post('/api/auth/register', body);

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(response.body), /businessName/i);
  });

  it('rejects an invalid email with a clear 400', async () => {
    const response = await server
      .client()
      .post('/api/auth/register/request', { email: 'not-an-email' });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(response.body), /valid email/i);
  });

  it('rejects unexpected fields instead of ignoring them', async () => {
    const response = await server
      .client()
      .post('/api/auth/register', { ...await verifiedRegistration(server), role: 'owner', businessId: 'other-tenant' });

    assert.equal(response.status, 400, 'a client cannot smuggle in role or businessId');
  });
});

describe('POST /api/auth/login', () => {
  it('authenticates a registered owner and issues a session cookie', async () => {
    const body = registrationBody();
    await registerOwner(server, body);

    // A separate client proves the session comes from this login, not a stale jar.
    const client = server.client();
    const response = await client.post<{ data: { user: { email: string; role: string } } }>(
      '/api/auth/login',
      { email: body.email, password: PASSWORD },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.user.email, body.email);
    assert.equal(response.body.data.user.role, 'owner');
    assert.ok(
      response.setCookie.some((c) => c.startsWith(`${env.auth.cookieName}=`)),
      'login issues a session cookie',
    );
  });

  it('accepts a differently-cased email', async () => {
    const body = registrationBody();
    await registerOwner(server, body);

    const response = await server
      .client()
      .post('/api/auth/login', { email: body.email.toUpperCase(), password: PASSWORD });

    assert.equal(response.status, 200);
  });

  it('signs legacy accounts with the same email into the workspace matching their password', async () => {
    const { user: first } = await registerOwner(server);
    const { user: second } = await registerOwner(server);
    const secondPassword = 'another-valid-password';
    await getPool().query('UPDATE users SET email = $1, password_hash = $2 WHERE id = $3', [
      first.email, await hashPassword(secondPassword), second.id,
    ]);

    for (const [user, password] of [[first, PASSWORD], [second, secondPassword]] as const) {
      const login = await server.client().post<{ data: { user: { id: string; businessId: string } } }>(
        '/api/auth/login', { email: first.email, password },
      );
      assert.equal(login.status, 200);
      assert.equal(login.body.data.user.id, user.id);
      assert.equal(login.body.data.user.businessId, user.businessId);
    }

    const wrongWorkspace = await server.client().post('/api/auth/login', {
      email: first.email, password: PASSWORD, workspaceId: second.businessId,
    });
    assert.equal(wrongWorkspace.status, 401);
    assert.deepEqual(wrongWorkspace.setCookie, []);
  });

  it('requires an explicit workspace when multiple legacy accounts match the same credentials', async () => {
    const { user: first } = await registerOwner(server);
    const { user: second } = await registerOwner(server);
    const { user: third } = await registerOwner(server, { password: 'different-valid-password' });
    await getPool().query('UPDATE users SET email = $1 WHERE id IN ($2, $3)', [
      first.email, second.id, third.id,
    ]);

    const client = server.client();
    const credentials = { email: first.email, password: PASSWORD };
    const choice = await client.post<{ data: { workspaces: { id: string; name: string }[] } }>(
      '/api/auth/login', credentials,
    );
    assert.equal(choice.status, 200);
    assert.deepEqual(choice.body.data.workspaces.map(({ id }) => id).sort(),
      [first.businessId, second.businessId].sort());
    assert.deepEqual(choice.setCookie, []);
    assert.equal((await client.get('/api/auth/me')).status, 401);

    const wrongPassword = await client.post('/api/auth/login', {
      ...credentials, workspaceId: second.businessId, password: 'incorrect-password',
    });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.setCookie, []);

    const selected = await client.post<{ data: { user: { id: string; businessId: string } } }>(
      '/api/auth/login', { ...credentials, workspaceId: second.businessId },
    );
    assert.equal(selected.status, 200);
    assert.equal(selected.body.data.user.id, second.id);
    assert.equal(selected.body.data.user.businessId, second.businessId);
    assert.equal((await client.get('/api/auth/me')).status, 200);
  });

  it('rejects a wrong password with 401 and issues no cookie', async () => {
    const body = registrationBody();
    await registerOwner(server, body);

    const response = await server
      .client()
      .post('/api/auth/login', { email: body.email, password: 'definitely-not-the-password' });

    assert.equal(response.status, 401);
    assert.ok(!response.setCookie.some((c) => c.startsWith(`${env.auth.cookieName}=`)));
  });

  it('is indistinguishable for an unknown email, so accounts cannot be enumerated', async () => {
    const body = registrationBody();
    await registerOwner(server, body);

    const wrongPassword = await server
      .client()
      .post('/api/auth/login', { email: body.email, password: 'definitely-not-the-password' });
    const unknownEmail = await server
      .client()
      .post('/api/auth/login', {
        email: 'nobody-here@example.com',
        password: 'definitely-not-the-password',
      });

    assert.equal(unknownEmail.status, 401);
    assert.deepEqual(unknownEmail.body, wrongPassword.body);
  });

  it('rejects a login with no password with 400', async () => {
    const response = await server.client().post('/api/auth/login', { email: 'a@example.com' });

    assert.equal(response.status, 400);
  });
});

describe('GET /api/auth/me', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await server.client().get('/api/auth/me');

    assert.equal(response.status, 401);
  });

  it('returns the authenticated user and their business', async () => {
    const { client, user } = await registerOwner(server);

    const response = await client.get<{
      data: { user: { id: string; businessId: string; role: string; business: { id: string } } };
    }>('/api/auth/me');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.user.id, user.id);
    assert.equal(response.body.data.user.businessId, user.businessId);
    assert.equal(response.body.data.user.business.id, user.businessId);
    assert.equal(response.body.data.user.role, 'owner');
  });

  it('never exposes password material', async () => {
    const { client } = await registerOwner(server);

    const response = await client.get('/api/auth/me');

    assert.ok(!JSON.stringify(response.body).includes('$argon2'));
  });

  it('rejects a forged session cookie with 401', async () => {
    const response = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { Cookie: `${env.auth.cookieName}=not-a-real-token` },
    });

    assert.equal(response.status, 401);
    await response.text();
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session so /me then returns 401', async () => {
    const { client } = await registerOwner(server);

    assert.equal((await client.get('/api/auth/me')).status, 200);

    assert.equal((await client.post('/api/auth/logout')).status, 200);
    assert.equal((await client.get('/api/auth/me')).status, 401, 'the session is revoked');
  });

  it('clears the cookie in the browser', async () => {
    const { client } = await registerOwner(server);

    await client.post('/api/auth/logout');

    assert.ok(!client.hasCookie(env.auth.cookieName), 'the cookie jar no longer holds it');
  });

  it('is idempotent when there is no session', async () => {
    const response = await server.client().post('/api/auth/logout');

    assert.equal(response.status, 200);
  });

  it("does not revoke another client's session", async () => {
    const { client: first } = await registerOwner(server);
    const { client: second } = await registerOwner(server);

    await first.post('/api/auth/logout');

    assert.equal((await first.get('/api/auth/me')).status, 401);
    assert.equal((await second.get('/api/auth/me')).status, 200, 'other sessions are untouched');
  });
});

describe('GET /api/health', () => {
  it('still responds after the auth work', async () => {
    const response = await server.client().get<{ status: string; service: string }>('/api/health');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok', service: 'stockpilot-api' });
  });
});

async function countRows(table: 'businesses' | 'users' | 'auth_sessions'): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return result.rows[0]?.count ?? 0;
}
