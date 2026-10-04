/**
 * User persistence.
 *
 * Tenant scoping is explicit: any lookup driven by client-supplied identity
 * takes a `businessId`. There is deliberately no unscoped "find user by id"
 * helper, so forgetting the scope is a compile error rather than a data leak.
 *
 * The two unscoped reads here are safe by construction — `findUsersByEmail` is
 * only ever used to *authenticate* (the caller must still prove knowledge of the
 * password), and it always joins the owning business.
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
 * Every user registered with this email address, across all businesses.
 *
 * Email is unique per business rather than globally, so this can legitimately
 * return more than one row. Callers must handle the ambiguous case.
 */
export async function findUsersByEmail(email: string): Promise<UserWithBusinessRow[]> {
  const result = await query<UserWithBusinessRow>(
    `${WITH_BUSINESS} WHERE u.email = $1`,
    [email],
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
