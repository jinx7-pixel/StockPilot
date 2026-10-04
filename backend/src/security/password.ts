/**
 * Password hashing.
 *
 * Uses Argon2id via `@node-rs/argon2` (prebuilt N-API binaries, so no native
 * toolchain is required on developer machines or CI).
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * Argon2id: 19 MiB of memory, 2 iterations, 1 degree of parallelism, 32-byte
 * output. Raising them later is safe — the parameters are encoded into each
 * hash string, so existing hashes keep verifying.
 */

import { hash, verify } from '@node-rs/argon2';

import { PasswordPolicyError } from '../errors.js';

/**
 * OWASP-recommended Argon2id parameters.
 *
 * `algorithm` is deliberately omitted: Argon2id is the library's documented
 * default, and the exported `Algorithm` symbol is a `const enum`, which
 * `verbatimModuleSyntax` forbids referencing. Verified by hashing and asserting
 * the `$argon2id$` prefix.
 */
const ARGON2_OPTIONS = {
  /** KiB */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Upper bound, kept well below any practical Argon2/bcrypt limit. */
const MAX_PASSWORD_LENGTH = 200;

/**
 * Enforce the password policy.
 *
 * Deliberately modest: length is the dominant factor, and aggressive composition
 * rules mostly produce `Password1!` while frustrating real users.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 12) {
    throw new PasswordPolicyError('Password must be at least 12 characters long.');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`,
    );
  }
  if (/\s$/.test(password)) {
    throw new PasswordPolicyError('Password must not end with whitespace.');
  }
}

/** Hash a plaintext password for storage. Never logs its input. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Verify a candidate password against a stored hash. Returns false on any error. */
export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    // A malformed stored hash must read as "wrong password" rather than a 500
    // that tells an attacker something about the stored value.
    return false;
  }
}

/**
 * Spend comparable CPU to a real verification, so that a login attempt for an
 * unknown account costs about the same as one for a known account.
 *
 * The hash is generated once, lazily, from a value no account can have. It must
 * be a *real* Argon2id hash: verifying against a malformed string would fail
 * instantly and defeat the entire purpose.
 */
let dummyHash: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('stockpilot::no-such-account::timing-equaliser');
  return dummyHash;
}

export async function simulatePasswordVerification(password: string): Promise<void> {
  await verifyPassword(await getDummyHash(), password);
}
