import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, beforeEach, it } from 'node:test';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { hashSessionToken } from '../security/session.js';
import { matchingTotpStep } from '../security/totp.js';
import { PASSWORD, registerOwner, registrationBody, takeEmailToken, verifiedRegistration } from './helpers/fixtures.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
});
beforeEach(resetTestDatabase);
after(async () => {
  await server.close();
  await closeTestDatabase();
});

it('blocks cross-origin login and authenticated writes, and rejects form bodies', async () => {
  const { client, user } = await registerOwner(server);
  const credentials = { email: user.email, password: PASSWORD };
  const visitor = server.client();
  const hostile = await visitor.post('/api/auth/login', credentials, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(hostile.status, 403);
  assert.deepEqual(hostile.setCookie, []);
  const crossSite = await visitor.post('/api/auth/login', credentials, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const form = await visitor.post('/api/auth/login', credentials, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(form.status, 415);
  assert.deepEqual(form.setCookie, []);
  const write = await client.post('/api/auth/logout', undefined, { headers: { Origin: 'null' } });
  assert.equal(write.status, 403);
  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.equal((await visitor.post('/api/auth/login', credentials, { headers: { Origin: env.corsOrigins[0]! } })).status, 200);
});

it('returns a generic error when the database fails during session lookup', async () => {
  const { client } = await registerOwner(server);
  const pool = getPool();
  const original = pool.query;
  pool.query = (async () => { throw new Error('simulated database outage'); }) as typeof pool.query;
  try {
    const response = await client.get<{ code: string }>('/api/auth/me');
    assert.equal(response.status, 500);
    assert.equal(response.body.code, 'INTERNAL_ERROR');
  } finally {
    pool.query = original;
  }
});

it('requires an unexpired registration link and binds it to the verified address', async () => {
  const fields = registrationBody();
  const { email } = fields;
  const client = server.client();
  assert.equal((await client.post('/api/auth/register', { ...fields, token: 'a'.repeat(43) })).status, 400);
  assert.equal((await client.get('/api/auth/me')).status, 401);

  const expired = await verifiedRegistration(server, fields);
  await getPool().query("UPDATE auth_email_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
    [hashSessionToken(expired.token)]);
  assert.equal((await client.post('/api/auth/register', expired)).status, 400);

  const claimed = await verifiedRegistration(server, fields);
  assert.equal((await client.post('/api/auth/register', { ...claimed, email: 'other@example.com' })).status, 400);
  const success = await client.post<{ data: { user: { email: string } } }>('/api/auth/register', claimed);
  assert.equal(success.status, 201);
  assert.equal(success.body.data.user.email, email);
  assert.equal((await server.client().post('/api/auth/register', claimed)).status, 400);
});

it('verifies legacy accounts only within their own session and resets passwords once', async () => {
  const { client, user } = await registerOwner(server);
  const secondDevice = server.client();
  const credentials = { email: user.email, password: PASSWORD };
  await getPool().query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [user.id]);
  assert.equal((await secondDevice.post('/api/auth/login', credentials)).status, 200);
  const initial = await client.get<{ data: { emailVerified: boolean } }>('/api/auth/security');
  assert.equal(initial.body.data.emailVerified, false);
  assert.equal((await client.post('/api/auth/email/request')).status, 202);
  const proof = await takeEmailToken(server, user.email, '/verify-email');
  const { client: wrongAccount } = await registerOwner(server);
  assert.equal((await wrongAccount.post('/api/auth/email/verify', { token: proof })).status, 400);
  assert.equal((await client.post('/api/auth/email/verify', { token: proof })).status, 200);

  const requester = server.client();
  const known = await requester.post('/api/auth/password/request', { email: user.email });
  const unknown = await requester.post('/api/auth/password/request', { email: 'unknown-reset@example.com' });
  assert.equal(known.status, 202);
  assert.deepEqual(known.body, unknown.body);
  assert.deepEqual(known.setCookie, []);
  const token = await takeEmailToken(server, user.email, '/reset-password');
  const password = 'different-strong-password';
  const reset = await requester.post('/api/auth/password/reset', { token, password });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.setCookie, []);
  assert.equal((await requester.post('/api/auth/password/reset', { token, password })).status, 400);
  assert.equal((await client.get('/api/auth/me')).status, 401);
  assert.equal((await secondDevice.get('/api/auth/me')).status, 401);
  assert.equal((await requester.post('/api/auth/login', credentials)).status, 401);
  assert.equal((await requester.post('/api/auth/login', { ...credentials, password })).status, 200);
  assert.equal((await wrongAccount.get('/api/auth/me')).status, 200);
});

function currentAuthenticatorCode(base32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...base32].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

it('implements the RFC 6238 TOTP vector and rejects replayed time steps', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(matchingTotpStep(secret, '287082', null, 59_000), 1);
  assert.equal(matchingTotpStep(secret, '287082', '1', 59_000), undefined);
});

it('enforces two-step verification, consumes recovery codes once, and revokes all sessions', async () => {
  const { client, user } = await registerOwner(server);
  const other = server.clientWith(client.cookieMap());
  const setup = await client.post<{ data: { secret: string } }>('/api/auth/mfa/start', { password: PASSWORD });
  assert.equal(setup.status, 200);
  const code = currentAuthenticatorCode(setup.body.data.secret);
  const enabled = await client.post<{ data: { recoveryCodes: string[] } }>('/api/auth/mfa/enable', { code });
  assert.equal(enabled.status, 200);
  const [recovery, spare] = enabled.body.data.recoveryCodes;
  assert.ok(recovery && spare);
  assert.equal((await other.get('/api/auth/me')).status, 401);
  assert.equal((await client.get('/api/auth/me')).status, 200);

  const credentials = { email: user.email, password: PASSWORD };
  const challenged = await other.post<{ code: string }>('/api/auth/login', credentials);
  assert.equal(challenged.body.code, 'MFA_REQUIRED');
  assert.deepEqual(challenged.setCookie, []);
  assert.equal((await other.post('/api/auth/login', { ...credentials, mfaCode: code })).status, 401);
  const recoveryResults = await Promise.all([
    other.post('/api/auth/login', { ...credentials, mfaCode: recovery }),
    server.client().post('/api/auth/login', { ...credentials, mfaCode: recovery }),
  ]);
  assert.deepEqual(recoveryResults.map(({ status }) => status).sort(), [200, 401]);

  assert.equal((await client.post('/api/auth/logout-all')).status, 200);
  assert.equal((await other.get('/api/auth/me')).status, 401);
  assert.equal((await client.get('/api/auth/me')).status, 401);
  await other.post('/api/auth/password/request', { email: user.email });
  const token = await takeEmailToken(server, user.email, '/reset-password');
  const password = 'changed-password-with-mfa';
  assert.equal((await other.post('/api/auth/password/reset', { token, password })).status, 200);
  const stillChallenged = await other.post<{ code: string }>('/api/auth/login', { ...credentials, password });
  assert.equal(stillChallenged.body.code, 'MFA_REQUIRED');
  assert.equal((await other.post('/api/auth/login', { ...credentials, password, mfaCode: spare })).status, 200);
});

it('limits failed login attempts across clients using the normalized email', async () => {
  const { user } = await registerOwner(server);
  for (let index = 0; index < 15; index += 1) {
    const email = index % 2 ? user.email : user.email.toUpperCase();
    assert.equal((await server.client().post('/api/auth/login', { email, password: 'incorrect' })).status, 401);
  }
  assert.equal((await server.client().post('/api/auth/login', { email: user.email, password: PASSWORD })).status, 429);
});
