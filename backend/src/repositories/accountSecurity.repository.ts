import type { PoolClient } from 'pg';

import { query } from '../db/pool.js';
import { hashSessionToken } from '../security/session.js';

export type EmailPurpose = 'register' | 'verify' | 'reset';

type EmailToken = {
  email: string;
  user_id: string | null;
};

export async function takeAuthAttempt(scope: string, identity: string, limit: number, seconds: number): Promise<boolean> {
  const result = await query(
    `INSERT INTO auth_attempts (key, attempts, expires_at)
     VALUES ($1, 1, now() + make_interval(secs => $3))
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE WHEN auth_attempts.expires_at <= now() THEN 1 ELSE auth_attempts.attempts + 1 END,
       expires_at = CASE WHEN auth_attempts.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_attempts.expires_at END
     WHERE auth_attempts.expires_at <= now() OR auth_attempts.attempts < $2
     RETURNING key`,
    [hashSessionToken(`${scope}:${identity}`), limit, seconds],
  );
  return result.rowCount === 1;
}

export async function saveEmailToken(tokenHash: string, purpose: EmailPurpose, email: string, userId?: string): Promise<void> {
  await query(
    `INSERT INTO auth_email_tokens (token_hash, purpose, email, user_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '30 minutes')`,
    [tokenHash, purpose, email, userId ?? null],
  );
}

export async function findEmailToken(tokenHash: string, purpose: EmailPurpose): Promise<EmailToken | undefined> {
  const result = await query<EmailToken>(
    `SELECT email, user_id FROM auth_email_tokens WHERE token_hash = $1 AND purpose = $2 AND expires_at > now()`,
    [tokenHash, purpose],
  );
  return result.rows[0];
}

export async function consumeEmailToken(client: PoolClient, tokenHash: string, purpose: EmailPurpose): Promise<EmailToken | undefined> {
  const result = await client.query<EmailToken>(
    `DELETE FROM auth_email_tokens WHERE token_hash = $1 AND purpose = $2 AND expires_at > now()
     RETURNING email, user_id`,
    [tokenHash, purpose],
  );
  return result.rows[0];
}

export async function deleteExpiredAuthData(): Promise<void> {
  await query('DELETE FROM auth_email_tokens WHERE expires_at <= now()');
  await query('DELETE FROM auth_attempts WHERE expires_at <= now()');
  await query(`UPDATE users SET mfa_pending_secret = NULL, mfa_pending_session = NULL,
    mfa_pending_until = NULL WHERE mfa_pending_until <= now()`);
}

export type AccountSecurityRow = {
  email: string;
  email_verified_at: Date | null;
  password_hash: string;
  mfa_secret: string | null;
  mfa_last_step: string | null;
  mfa_recovery_hashes: string[] | null;
};

export async function findAccountSecurity(userId: string, client?: PoolClient): Promise<AccountSecurityRow | undefined> {
  const sql = `SELECT email, email_verified_at, password_hash, mfa_secret, mfa_last_step, mfa_recovery_hashes
    FROM users WHERE id = $1`;
  const result = client
    ? await client.query<AccountSecurityRow>(`${sql} FOR UPDATE`, [userId])
    : await query<AccountSecurityRow>(sql, [userId]);
  return result.rows[0];
}

export async function revokeUserSessions(client: PoolClient, userId: string): Promise<void> {
  await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
}
