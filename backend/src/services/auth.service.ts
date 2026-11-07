/**
 * Authentication service.
 *
 * Owns registration, login, logout and session resolution. Nothing above this
 * layer (routes, middleware) touches the database, and nothing below it knows
 * about HTTP.
 *
 * Three invariants drive the design:
 *
 *  1. **Atomic registration.** A business and its owner user are created in one
 *     transaction, so a half-registered tenant can never exist.
 *  2. **Tenant context comes from the session.** `business_id` is never read
 *     from a body, query parameter or header. It is selected from the database
 *     via a join, and repositories require an explicit `businessId` for any
 *     lookup driven by client-supplied identity.
 *  3. **Login requires valid credentials.** Unknown emails and wrong passwords
 *     return the same error. A legacy workspace choice only includes accounts
 *     whose passwords were verified.
 */

import type { PoolClient } from 'pg';

import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { AuthenticationError, RateLimitError } from '../errors.js';
import { consumeEmailToken, findAccountSecurity, findEmailToken, takeAuthAttempt } from '../repositories/accountSecurity.repository.js';
import type { UserRole, UserWithBusinessRow } from '../repositories/auth.types.js';
import { createBusiness } from '../repositories/business.repository.js';
import {
  createSession,
  deleteSessionByTokenHash,
  findSessionContextByTokenHash,
  touchSession,
} from '../repositories/session.repository.js';
import { createUser, emailIsTakenForRegistration, findUsersByEmail } from '../repositories/user.repository.js';
import {
  assertPasswordPolicy,
  hashPassword,
  simulatePasswordVerification,
  verifyPassword,
} from '../security/password.js';
import { generateSessionToken, hashSessionToken } from '../security/session.js';
import { decryptTotpSecret, matchingTotpStep } from '../security/totp.js';
import { invalidEmailToken } from './accountEmail.service.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';

/**
 * The only user shape allowed to leave this module.
 *
 * `password_hash` is absent by construction: redaction happens here, once,
 * rather than being repeated — and eventually forgotten — at each call site.
 */
export interface AuthenticatedUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: UserRole;
  business: { id: string; name: string };
}

export interface IssuedSession {
  user: AuthenticatedUser;
  /** Raw token — handed to the browser once and never stored. */
  token: string;
  expiresAt: Date;
}

export interface SessionContext {
  user: AuthenticatedUser;
  sessionId: string;
}

type LoginResult = { session: IssuedSession } | { workspaces: AuthenticatedUser['business'][] };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function sessionExpiry(): Date {
  return new Date(Date.now() + env.auth.sessionTtlDays * ONE_DAY_MS);
}

/** One error for every failed login, so the response cannot be used as an oracle. */
function invalidCredentials(): AuthenticationError {
  return new AuthenticationError('Invalid email or password.', 'INVALID_CREDENTIALS');
}

/** Create a business and its owner atomically, then open a session for them. */
export async function registerBusinessOwner(input: RegisterInput): Promise<IssuedSession> {
  const tokenHash = hashSessionToken(input.token);
  const pending = await findEmailToken(tokenHash, 'register');
  if (pending?.email !== input.email) throw invalidEmailToken();
  assertPasswordPolicy(input.password);

  // Hash *before* opening the transaction: Argon2id is deliberately slow, and
  // holding a transaction open across it would needlessly serialise writers.
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const claimed = await consumeEmailToken(client, tokenHash, 'register');
    if (claimed?.email !== input.email || await emailIsTakenForRegistration(client, input.email)) {
      throw invalidEmailToken();
    }

    const createdBusiness = await createBusiness(client, input.businessName);
    const createdUser = await createUser(client, {
      businessId: createdBusiness.id,
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'owner',
    });

    await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [createdUser.id]);
    return issueSession({
      id: createdUser.id,
      businessId: createdBusiness.id,
      name: createdUser.name,
      email: createdUser.email,
      role: createdUser.role,
      business: { id: createdBusiness.id, name: createdBusiness.name },
    }, client);
  });
}

/** Authenticate an existing user, asking them to choose if multiple accounts match. */
export async function login(input: LoginInput): Promise<LoginResult> {
  if (!(await takeAuthAttempt('login', input.email, 15, 900))) throw new RateLimitError();
  const candidates = await findUsersByEmail(input.email, input.workspaceId);
  if (candidates.length === 0) {
    await simulatePasswordVerification(input.password);
    throw invalidCredentials();
  }

  // Older registrations may share an email. Check each password before showing
  // any workspace choices, and re-check the selected account on the next request.
  const matches: UserWithBusinessRow[] = [];
  for (const user of candidates) {
    if (await verifyPassword(user.password_hash, input.password)) {
      matches.push(user);
    }
  }

  const [user] = matches;
  if (!user) throw invalidCredentials();
  if (matches.length > 1) {
    return { workspaces: matches.map((match) => ({ id: match.business_id, name: match.business_name })) };
  }

  return withTransaction(async (client) => {
    const account = await findAccountSecurity(user.id, client);
    if (!account || account.password_hash !== user.password_hash) throw invalidCredentials();
    if (account.mfa_secret) {
      const code = input.mfaCode;
      if (!code) throw new AuthenticationError('Enter your authenticator or recovery code.', 'MFA_REQUIRED');
      const step = matchingTotpStep(decryptTotpSecret(user.id, account.mfa_secret), code, account.mfa_last_step);
      if (step !== undefined) {
        await client.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [user.id, step]);
      } else {
        const recoveryHash = hashSessionToken(code.toLowerCase());
        if (!account.mfa_recovery_hashes?.includes(recoveryHash)) {
          throw new AuthenticationError('Incorrect authenticator or recovery code.', 'INVALID_MFA_CODE');
        }
        await client.query('UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1',
          [user.id, recoveryHash]);
      }
    }
    return { session: await issueSession({
      id: user.id,
      businessId: user.business_id,
      name: user.name,
      email: user.email,
      role: user.role,
      business: { id: user.business_id, name: user.business_name },
    }, client) };
  });
}

/** Resolve a session token to its user and tenant, or null when absent/expired. */
export async function resolveSession(token: string): Promise<SessionContext | null> {
  const row = await findSessionContextByTokenHash(hashSessionToken(token));
  if (!row) return null;

  // Bookkeeping only — never let it fail an otherwise valid request.
  await touchSession(row.session_id).catch(() => undefined);

  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      // Straight from the database join, never from the request.
      businessId: row.business_id,
      name: row.user_name,
      email: row.user_email,
      role: row.user_role,
      business: { id: row.business_id, name: row.business_name },
    },
  };
}

/** Revoke a session. Returns false when the token was already unknown. */
export async function logout(token: string): Promise<boolean> {
  return deleteSessionByTokenHash(hashSessionToken(token));
}

export async function issueSession(user: AuthenticatedUser, client: PoolClient): Promise<IssuedSession> {
  const { token, tokenHash } = generateSessionToken();
  const expiresAt = sessionExpiry();

  await createSession({ userId: user.id, tokenHash, expiresAt }, client);

  return { user, token, expiresAt };
}
