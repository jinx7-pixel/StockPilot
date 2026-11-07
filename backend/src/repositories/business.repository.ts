/**
 * Business persistence.
 *
 * Deliberately tiny — one business is created per registration.
 */

import type { PoolClient } from 'pg';

import { query } from '../db/pool.js';
import type { BusinessRow } from './auth.types.js';

const COLUMNS = 'id, name, created_at, updated_at';

/** Insert a business in the caller's registration transaction. */
export async function createBusiness(client: PoolClient, name: string): Promise<BusinessRow> {
  const result = await client.query<BusinessRow>(
    `INSERT INTO businesses (name)
     VALUES ($1)
     RETURNING ${COLUMNS}`,
    [name],
  );

  // INSERT ... RETURNING always yields exactly one row.
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create business');
  return row;
}

export async function findBusinessById(id: string): Promise<BusinessRow | null> {
  const result = await query<BusinessRow>(
    `SELECT ${COLUMNS} FROM businesses WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
