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
 *  3. **No account enumeration.** Login returns one indistinguishable error for
 *     an unknown email, a wrong password and an ambiguous email, and spends
 *     comparable CPU in the "no such user" branch.
 */

import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { AuthenticationError } from '../errors.js';
import type { UserRole } from '../repositories/auth.types.js';
import { createBusiness } from '../repositories/business.repository.js';
import {
  createSession,
  deleteSessionByTokenHash,
  findSessionContextByTokenHash,
  touchSession,
} from '../repositories/session.repository.js';
import { createUser, findUsersByEmail } from '../repositories/user.repository.js';
import {
  assertPasswordPolicy,
  hashPassword,
  simulatePasswordVerification,
  verifyPassword,
} from '../security/password.js';
import { generateSessionToken, hashSessionToken } from '../security/session.js';
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
  assertPasswordPolicy(input.password);

  // Hash *before* opening the transaction: Argon2id is deliberately slow, and
  // holding a transaction open across it would needlessly serialise writers.
  const passwordHash = await hashPassword(input.password);

  const { business, user } = await withTransaction(async (client) => {
    const createdBusiness = await createBusiness(input.businessName);
    const createdUser = await createUser(client, {
      businessId: createdBusiness.id,
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'owner',
    });

    return { business: createdBusiness, user: createdUser };
  });

  return issueSession({
    id: user.id,
    businessId: user.business_id,
    name: user.name,
    email: user.email,
    role: user.role,
    business: { id: business.id, name: business.name },
  });
}

/** Authenticate an existing user and open a session. */
export async function login(input: LoginInput): Promise<IssuedSession> {
  const candidates = await findUsersByEmail(input.email);

  // Email is unique per business rather than globally, so the same address may
  // legitimately exist in several tenants. Login is keyed on (email, password)
  // only, so more than one match is unresolvable — fail closed rather than guess
  // which tenant the caller meant. See "Limitations" in the step report.
  if (candidates.length !== 1) {
    // Spend comparable CPU so response timing does not distinguish this branch.
    await simulatePasswordVerification(input.password);
    throw invalidCredentials();
  }

  const user = candidates[0];
  if (!user) {
    await simulatePasswordVerification(input.password);
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(user.password_hash, input.password);
  if (!passwordMatches) {
    throw invalidCredentials();
  }

  return issueSession({
    id: user.id,
    businessId: user.business_id,
    name: user.name,
    email: user.email,
    role: user.role,
    business: { id: user.business_id, name: user.business_name },
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

async function issueSession(user: AuthenticatedUser): Promise<IssuedSession> {
  const { token, tokenHash } = generateSessionToken();
  const expiresAt = sessionExpiry();

  await createSession({ userId: user.id, tokenHash, expiresAt });

  return { user, token, expiresAt };
}
