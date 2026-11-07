import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

import { query, withTransaction } from '../db/pool.js';
import { AuthenticationError, ConflictError, RateLimitError } from '../errors.js';
import { findAccountSecurity, revokeUserSessions, takeAuthAttempt } from '../repositories/accountSecurity.repository.js';
import { verifyPassword } from '../security/password.js';
import { hashSessionToken } from '../security/session.js';
import { decryptTotpSecret, encryptTotpSecret, formatTotpSecret, matchingTotpStep, newTotpSecret } from '../security/totp.js';
import { issueSession, type AuthenticatedUser } from './auth.service.js';

async function checkPassword(userId: string, password: string): Promise<string> {
  if (!(await takeAuthAttempt('manage-mfa', userId, 10, 900))) throw new RateLimitError();
  const account = await findAccountSecurity(userId);
  if (!account || !(await verifyPassword(account.password_hash, password))) {
    throw new AuthenticationError('Incorrect password.', 'INVALID_CREDENTIALS');
  }
  return account.password_hash;
}

export async function startMfa(userId: string, sessionId: string, password: string): Promise<string> {
  const passwordHash = await checkPassword(userId, password);
  const secret = newTotpSecret();
  const result = await query(
    `UPDATE users SET mfa_pending_secret = $2, mfa_pending_session = $4,
        mfa_pending_until = now() + interval '10 minutes'
     WHERE id = $1 AND password_hash = $3 AND mfa_secret IS NULL AND email_verified_at IS NOT NULL`,
    [userId, encryptTotpSecret(userId, secret), passwordHash, sessionId],
  );
  if (result.rowCount !== 1) {
    throw new ConflictError('Verify your email before setting up a new authenticator.');
  }
  return formatTotpSecret(secret);
}

async function assertLiveSession(client: PoolClient, userId: string, sessionId: string): Promise<void> {
  const live = await client.query(
    'SELECT 1 FROM auth_sessions WHERE id = $1 AND user_id = $2 AND expires_at > now() FOR UPDATE',
    [sessionId, userId],
  );
  if (live.rowCount !== 1) throw new AuthenticationError();
}

export async function enableMfa(user: AuthenticatedUser, sessionId: string, code: string) {
  if (!(await takeAuthAttempt('confirm-mfa', user.id, 10, 900))) throw new RateLimitError();
  return withTransaction(async (client) => {
    const result = await client.query<{ mfa_pending_secret: string }>(
      `SELECT mfa_pending_secret FROM users WHERE id = $1 AND mfa_pending_until > now()
        AND mfa_pending_session = $2 AND mfa_secret IS NULL AND email_verified_at IS NOT NULL FOR UPDATE`,
      [user.id, sessionId],
    );
    const encrypted = result.rows[0]?.mfa_pending_secret;
    if (!encrypted) throw new ConflictError('Authenticator setup expired. Start again.');
    await assertLiveSession(client, user.id, sessionId);
    const step = matchingTotpStep(decryptTotpSecret(user.id, encrypted), code, null);
    if (step === undefined) throw new AuthenticationError('Incorrect authenticator code.', 'INVALID_MFA_CODE');

    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(10).toString('hex'));
    await client.query(
      `UPDATE users SET mfa_secret = $2, mfa_last_step = $3, mfa_recovery_hashes = $4,
          mfa_pending_secret = NULL, mfa_pending_session = NULL, mfa_pending_until = NULL WHERE id = $1`,
      [user.id, encrypted, step, recoveryCodes.map(hashSessionToken)],
    );
    await revokeUserSessions(client, user.id);
    return { recoveryCodes, session: await issueSession(user, client) };
  });
}

export async function disableMfa(user: AuthenticatedUser, sessionId: string, password: string, code: string) {
  const passwordHash = await checkPassword(user.id, password);
  return withTransaction(async (client) => {
    const account = await findAccountSecurity(user.id, client);
    if (!account?.mfa_secret || account.password_hash !== passwordHash) {
      throw new ConflictError('Account security settings changed. Try again.');
    }
    await assertLiveSession(client, user.id, sessionId);
    const recoveryHash = hashSessionToken(code.toLowerCase());
    const recoveryCode = account.mfa_recovery_hashes?.includes(recoveryHash);
    const step = matchingTotpStep(decryptTotpSecret(user.id, account.mfa_secret), code, account.mfa_last_step);
    if (step === undefined && !recoveryCode) {
      throw new AuthenticationError('Incorrect authenticator or recovery code.', 'INVALID_MFA_CODE');
    }

    await client.query(
      'UPDATE users SET mfa_secret = NULL, mfa_last_step = NULL, mfa_recovery_hashes = NULL WHERE id = $1',
      [user.id],
    );
    await revokeUserSessions(client, user.id);
    return issueSession(user, client);
  });
}
