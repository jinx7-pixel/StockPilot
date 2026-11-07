import type { PoolClient } from 'pg';

import { env } from '../config/env.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError, AuthenticationError, ValidationError } from '../errors.js';
import {
  consumeEmailToken,
  findAccountSecurity,
  findEmailToken,
  revokeUserSessions,
  saveEmailToken,
  takeAuthAttempt,
  type EmailPurpose,
} from '../repositories/accountSecurity.repository.js';
import type { SendAuthMail } from '../security/authMail.js';
import { assertPasswordPolicy, hashPassword } from '../security/password.js';
import { generateSessionToken, hashSessionToken } from '../security/session.js';

const emailAction = {
  register: { path: '/register', subject: 'Finish creating your StockPilot account' },
  verify: { path: '/verify-email', subject: 'Verify your StockPilot email' },
  reset: { path: '/reset-password', subject: 'Reset your StockPilot password' },
} satisfies Record<EmailPurpose, { path: string; subject: string }>;

export function requireMail(send: SendAuthMail | undefined): SendAuthMail {
  if (!send) throw new AppError('Account email is temporarily unavailable.', 503, 'EMAIL_UNAVAILABLE');
  return send;
}

async function emailLink(send: SendAuthMail, purpose: EmailPurpose, email: string, userId?: string): Promise<void> {
  const { token, tokenHash } = generateSessionToken();
  const { path, subject } = emailAction[purpose];
  const url = new URL(path, env.auth.publicUrl);
  url.hash = new URLSearchParams({ token }).toString();
  await saveEmailToken(tokenHash, purpose, email, userId);
  await send({ email, subject, link: url.href });
}

export async function requestPublicEmail(send: SendAuthMail, purpose: 'register' | 'reset', email: string): Promise<void> {
  if (!(await takeAuthAttempt(purpose, email, 3, 1800))) return;

  const result = await query<{ id: string; email_verified_at: Date | null }>(
    'SELECT id, email_verified_at FROM users WHERE email = $1',
    [email],
  );
  if (purpose === 'register') {
    if (result.rows.length === 0) await emailLink(send, purpose, email);
    return;
  }
  for (const user of result.rows) {
    if (user.email_verified_at) await emailLink(send, purpose, email, user.id);
  }
}

export async function requestVerification(send: SendAuthMail, userId: string): Promise<void> {
  const account = await findAccountSecurity(userId);
  if (!account || account.email_verified_at || !(await takeAuthAttempt('verify', userId, 3, 1800))) return;
  await emailLink(send, 'verify', account.email, userId);
}

export function invalidEmailToken(): ValidationError {
  return new ValidationError('This link is invalid or has expired. Request a new one.', 'INVALID_EMAIL_LINK');
}

export async function verifyEmail(userId: string, token: string): Promise<void> {
  await withTransaction(async (client) => {
    const account = await findAccountSecurity(userId, client);
    const claimed = await consumeEmailToken(client, hashSessionToken(token), 'verify');
    if (!account || claimed?.user_id !== userId || claimed.email !== account.email) throw invalidEmailToken();
    await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);
    await clearEmailTokens(client, userId, 'verify');
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  const pending = await findEmailToken(tokenHash, 'reset');
  if (!pending?.user_id) throw invalidEmailToken();
  const userId = pending.user_id;
  assertPasswordPolicy(password);
  const passwordHash = await hashPassword(password);

  await withTransaction(async (client) => {
    const account = await findAccountSecurity(userId, client);
    const claimed = await consumeEmailToken(client, tokenHash, 'reset');
    if (!account?.email_verified_at || claimed?.user_id !== userId || claimed.email !== account.email) {
      throw invalidEmailToken();
    }
    await client.query(
      `UPDATE users SET password_hash = $2, mfa_pending_secret = NULL,
        mfa_pending_session = NULL, mfa_pending_until = NULL WHERE id = $1`,
      [userId, passwordHash],
    );
    await clearEmailTokens(client, userId, 'reset');
    await revokeUserSessions(client, userId);
  });
}

export async function logoutEverywhere(userId: string): Promise<void> {
  await withTransaction(async (client) => {
    if (!(await findAccountSecurity(userId, client))) throw new AuthenticationError();
    await revokeUserSessions(client, userId);
  });
}

async function clearEmailTokens(client: PoolClient, userId: string, purpose: EmailPurpose): Promise<void> {
  await client.query('DELETE FROM auth_email_tokens WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
}
