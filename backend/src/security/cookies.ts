/**
 * Session cookie handling.
 *
 * The session token lives only in an HTTP-only cookie: it is unreadable from
 * JavaScript (so an XSS bug cannot exfiltrate it) and is never written to
 * `localStorage` or `sessionStorage`.
 */

import type { CookieOptions, Response } from 'express';

import { env } from '../config/env.js';

function cookieAttributes(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.auth.cookieSecure,
    sameSite: env.auth.cookieSameSite,
    // Scoped to the API path; the app's own routes never need to read it.
    path: '/',
  };
}

/** Attach the session cookie to a response. */
export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.auth.cookieName, token, {
    ...cookieAttributes(),
    maxAge: expiresAt.getTime() - Date.now(),
  });
}

/**
 * Clear the session cookie.
 *
 * The attributes must match those used when setting it, or the browser keeps the
 * original cookie. Express turns this into an already-expired cookie.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.auth.cookieName, cookieAttributes());
}
