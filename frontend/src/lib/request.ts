/**
 * Shared HTTP transport.
 *
 * Every call sends the session cookie (`credentials: 'include'`) and the
 * **server** decides who the caller is. The browser never holds a token — the
 * session lives in an HTTP-only cookie that JavaScript cannot read, and nothing
 * is ever written to `localStorage` or `sessionStorage`.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

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

  /** True when the caller is authenticated but lacks permission. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** True when the request conflicted with existing data, e.g. a duplicate SKU. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Extra request headers.
   *
   * Exists for the cases a body cannot express — notably `Idempotency-Key`, which
   * lets the server recognise a retried submission instead of performing it twice.
   */
  headers?: Record<string, string>;
}

interface ApiEnvelope<T> {
  data: T;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers: extraHeaders } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    // Required for the session cookie to be sent and stored.
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...extraHeaders,
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

  // `DELETE /api/categories/:id` answers 204 with no body.
  if (payload === undefined) return undefined as T;

  return (payload as ApiEnvelope<T>).data;
}
