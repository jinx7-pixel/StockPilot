/**
 * Shared fixtures for the auth suite.
 */

import type { TestClient, TestServer } from './testServer.js';

export const PASSWORD = 'correct-horse-battery-staple';
export const WEAK_PASSWORD = 'short';

/** Build a valid registration body, with unique values per call. */
let sequence = 0;

export function registrationBody(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  const unique = `${Date.now().toString(36)}.${sequence}`;

  return {
    businessName: `Test Business ${unique}`,
    name: 'Test Owner',
    email: `owner+${unique}@example.com`,
    password: PASSWORD,
    ...overrides,
  };
}

/** Register a business and return a client already holding its session cookie. */
export async function registerOwner(
  server: TestServer,
  overrides: Record<string, unknown> = {},
): Promise<{ client: TestClient; user: { id: string; businessId: string; role: string; email: string } }> {
  const client = server.client();
  const response = await client.post<{
    data: { user: { id: string; businessId: string; role: string; email: string; business: { name: string } } };
  }>('/api/auth/register', registrationBody(overrides));

  if (response.status !== 201) {
    throw new Error(`Registration failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return { client, user: response.body.data.user };
}

/**
 * Create a staff user inside an existing business.
 *
 * Registers a throwaway owner to obtain a tenant, then adds a second account by
 * inserting it directly — the product has no "invite staff" flow yet, and
 * building one is out of scope for this step.
 */
export async function createStaffUser(business: { id: string }, email: string): Promise<void> {
  const { hashPassword } = await import('../../security/password.js');
  const { getPool } = await import('../../db/pool.js');

  const passwordHash = await hashPassword(PASSWORD);

  await getPool().query(
    `INSERT INTO users (business_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, 'staff')`,
    [business.id, 'Test Staff', email, passwordHash],
  );
}
