/**
 * Thin API client.
 *
 * Every call sends the session cookie (`credentials: 'include'`) and the
 * **server** decides who the caller is. The browser never holds a token — the
 * session lives in an HTTP-only cookie that JavaScript cannot read, and nothing
 * is ever written to `localStorage` or `sessionStorage`.
 */

import type { UserRole } from './types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export interface AuthenticatedUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: UserRole;
  business: { id: string; name: string };
}

/** Error carrying the API's machine-readable code and HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** True when the caller simply needs to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

interface ApiEnvelope<T> {
  data: T;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    // Required for the session cookie to be sent and stored.
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let payload: unknown;

  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: string; code?: string } | undefined;
    throw new ApiError(
      errorPayload?.error ?? `Request failed with status ${response.status}`,
      response.status,
      errorPayload?.code ?? 'UNKNOWN',
    );
  }

  return (payload as ApiEnvelope<T>).data;
}

export interface RegisterInput {
  businessName: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const api = {
  register: (input: RegisterInput) =>
    request<{ user: AuthenticatedUser }>('/api/auth/register', { method: 'POST', body: input }),

  login: (input: LoginInput) =>
    request<{ user: AuthenticatedUser }>('/api/auth/login', { method: 'POST', body: input }),

  logout: () => request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),

  /** Throws `ApiError` with status 401 when there is no valid session. */
  me: () => request<{ user: AuthenticatedUser }>('/api/auth/me'),
};
