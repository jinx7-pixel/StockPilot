/**
 * Opaque session tokens.
 *
 * The cookie carries 256 bits of CSPRNG entropy. Only its SHA-256 digest is
 * persisted, so a database disclosure does not hand an attacker usable session
 * credentials. Lookups are by digest, never by the token itself.
 *
 * HTTP-only cookies are the right transport here: JavaScript cannot read the
 * token, so an XSS bug cannot exfiltrate a long-lived credential. Nothing is
 * ever written to `localStorage`.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes = 256 bits, base64url-encoded for cookie safety. */
const TOKEN_BYTES = 32;

export interface SessionTokenPair {
  /** The value handed to the browser. Never stored. */
  token: string;
  /** SHA-256 hex digest — this is what goes in `auth_sessions.token_hash`. */
  tokenHash: string;
}

/** Generate a fresh session token and its storage digest. */
export function generateSessionToken(): SessionTokenPair {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

/** Hash a token for storage or lookup. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a candidate digest against an expected one.
 *
 * Session lookups are normally by exact index match, so this is belt-and-braces
 * for any path that compares digests directly.
 */
export function digestsMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}
