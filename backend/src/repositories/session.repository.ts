/**
 * Session persistence.
 *
 * Rows are keyed by the SHA-256 digest of the session token; the raw token is
 * never written to the database.
 */

import { query } from '../db/pool.js';
import type { AuthSessionRow, UserRole } from './auth.types.js';

const COLUMNS = 'id, user_id, token_hash, expires_at, created_at, last_used_at';

/** Row returned by `findSessionContextByTokenHash`. */
export interface SessionContextRow {
  session_id: string;
  user_id: string;
  business_id: string;
  user_name: string;
  user_email: string;
  user_role: UserRole;
  business_name: string;
}

export async function createSession(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<AuthSessionRow> {
  const result = await query<AuthSessionRow>(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [input.userId, input.tokenHash, input.expiresAt],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create session');
  return row;
}

/**
 * Resolve a live session token to its user *and* owning business in one query.
 *
 * `business_id` is selected straight from the database via the join, so the
 * tenant context attached to the request can never originate from client input.
 * Expired sessions are excluded in the WHERE clause rather than filtered in
 * application code, so an expired token can never read as valid.
 */
export async function findSessionContextByTokenHash(
  tokenHash: string,
): Promise<SessionContextRow | null> {
  const result = await query<SessionContextRow>(
    `SELECT s.id           AS session_id,
            u.id           AS user_id,
            u.business_id  AS business_id,
            u.name         AS user_name,
            u.email        AS user_email,
            u.role         AS user_role,
            b.name         AS business_name
       FROM auth_sessions s
       JOIN users u      ON u.id = s.user_id
       JOIN businesses b ON b.id = u.business_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

/** Best-effort "last seen" update. Failure must not fail the request. */
export async function touchSession(sessionId: string): Promise<void> {
  await query(`UPDATE auth_sessions SET last_used_at = now() WHERE id = $1`, [sessionId]);
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<boolean> {
  const result = await query(`DELETE FROM auth_sessions WHERE token_hash = $1 RETURNING id`, [
    tokenHash,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/** Remove expired sessions. Meant for a periodic job. */
export async function deleteExpiredSessions(): Promise<number> {
  const result = await query(`DELETE FROM auth_sessions WHERE expires_at <= now()`);
  return result.rowCount ?? 0;
}
