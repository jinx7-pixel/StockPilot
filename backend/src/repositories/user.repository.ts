/**
 * User persistence.
 *
 * Tenant scoping is explicit: any lookup driven by client-supplied identity
 * takes a `businessId`. There is deliberately no unscoped "find user by id"
 * helper, so forgetting the scope is a compile error rather than a data leak.
 *
 * The authentication flow can look up an email across tenants. Those lookups
 * are used only to prevent repeat signups and verify login credentials.
 */

import type { PoolClient } from 'pg';

import { query } from '../db/pool.js';
import type { UserRole, UserRow, UserWithBusinessRow } from './auth.types.js';

const COLUMNS = 'id, business_id, name, email, password_hash, role, created_at, updated_at';

const WITH_BUSINESS = `
  SELECT u.id, u.business_id, u.name, u.email, u.password_hash, u.role,
         u.created_at, u.updated_at, b.name AS business_name
    FROM users u
    JOIN businesses b ON b.id = u.business_id
`;

/**
 * Insert a user within a caller-supplied transaction so that business + owner
 * commit or roll back together.
 */
export async function createUser(
  client: PoolClient,
  input: { businessId: string; name: string; email: string; passwordHash: string; role: UserRole },
): Promise<UserRow> {
  const result = await client.query<UserRow>(
    `INSERT INTO users (business_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [input.businessId, input.name, input.email, input.passwordHash, input.role],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create user');
  return row;
}

/**
 * Reserve the normalized email for this registration transaction before checking
 * it. Concurrent signups for the same address wait for the first to commit.
 * The per-business constraint stays in place so existing accounts are preserved.
 */
export async function emailIsTakenForRegistration(client: PoolClient, email: string): Promise<boolean> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
    `auth-register:${email}`,
  ]);
  const result = await client.query<{ taken: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS taken',
    [email],
  );
  return result.rows[0]!.taken;
}

/** Find login candidates, optionally narrowed to the selected workspace. */
export async function findUsersByEmail(email: string, workspaceId?: string): Promise<UserWithBusinessRow[]> {
  const result = await query<UserWithBusinessRow>(
    `${WITH_BUSINESS}
      WHERE u.email = $1 AND ($2::uuid IS NULL OR u.business_id = $2)
      ORDER BY u.created_at, u.id`,
    [email, workspaceId ?? null],
  );
  return result.rows;
}

/** Tenant-scoped lookup by primary key. */
export async function findUserById(
  businessId: string,
  userId: string,
): Promise<UserWithBusinessRow | null> {
  const result = await query<UserWithBusinessRow>(
    `${WITH_BUSINESS} WHERE u.business_id = $1 AND u.id = $2`,
    [businessId, userId],
  );
  return result.rows[0] ?? null;
}
