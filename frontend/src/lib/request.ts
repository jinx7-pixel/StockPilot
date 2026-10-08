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

/** The shape returned by the one route that pairs `data` with a sibling `meta`. */
interface ApiEnvelopeWithMeta<T, M> {
  data: T;
  meta?: M;
}

/**
 * Perform a request and return the **unwrapped** `data` value.
 *
 * ## The contract, stated once
 *
 * Every success response on this API is `{ data: … }`. This helper reads that key
 * and hands back what is inside it. Therefore:
 *
 *   - an API client declares the **unwrapped** shape — `request<Product>`, never
 *     `request<{ data: Product }>`;
 *   - a page reads the returned value directly — `result.items`, never
 *     `result.data.items`.
 *
 * Declaring the envelope here would be a double unwrap: the runtime would return
 * the inner value while the type promised a wrapper, so every `.data` downstream
 * silently became `undefined`. That is a type error the compiler cannot catch,
 * because the cast below is unchecked — which is exactly why the rule is written
 * down rather than left to be remembered.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestWithMeta<T, never>(path, options)).data;
}

/**
 * Perform a request that also needs the response's sibling `meta` object.
 *
 * Most routes put everything the caller needs inside `data`, so {@link request} is
 * the right tool and this one is not. It exists for the handful of routes that
 * send `{ data, meta }` together — a list plus its pagination totals, or a created
 * row plus a derived value such as the new stock balance.
 *
 * Split out rather than folded into {@link request} so that the common path keeps
 * a single, unmissable rule: unwrap once, and only here.
 */
export async function requestWithMeta<T, M = unknown, S = never>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: M; siblings?: S }> {
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
  if (payload === undefined) return { data: undefined as T };

  if (typeof payload !== 'object' || payload === null) {
    return { data: payload as T };
  }

  const envelope = payload as ApiEnvelopeWithMeta<T, M>;

  // Anything the route sent beside `data` and `meta` — the per-engine count
  // summaries, for instance — is returned intact rather than discarded.
  const { data: _data, meta, ...siblings } = payload as Record<string, unknown>;
  void _data;

  return {
    data: envelope.data,
    meta: meta as M | undefined,
    siblings: (Object.keys(siblings).length > 0 ? siblings : undefined) as S | undefined,
  };
}

/** The pagination block every list route returns as a sibling of `data`. */
export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** A guaranteed-non-empty fallback, for the rare list route that omits `meta`. */
const NO_META: ListMeta = { total: 0, page: 1, limit: 0, totalPages: 1 };

/**
 * Perform a paged list request and return `{ items, meta, counts }`.
 *
 * List routes answer `{ data: [...], meta: {...}, …counts }` — the rows, their
 * pagination totals and a route-specific count summary are **siblings**, not
 * nested. A plain `request` would hand back the rows and silently discard the
 * other two.
 *
 * The transport shape is absorbed here so every list client — and every page that
 * consumes one — sees `{ items, meta, counts }`. A page never has to know that the
 * rows arrived under a `data` key.
 *
 * `counts` is whatever the route put beside `data` and `meta`, so it is typed by
 * the caller's generic `C` and is `undefined` for a route that sends nothing.
 */
export async function requestList<T, C = never>(
  path: string,
  options: RequestOptions = {},
): Promise<{ items: T[]; meta: ListMeta; counts: C | undefined }> {
  const { data, meta, siblings } = await requestWithMeta<T[], ListMeta, C>(path, options);
  const items = data ?? [];
  return { items, meta: meta ?? { ...NO_META, total: items.length, limit: items.length }, counts: siblings };
}
