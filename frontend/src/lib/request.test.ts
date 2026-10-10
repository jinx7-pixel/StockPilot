// @vitest-environment node
/**
 * Tests for the shared HTTP transport.
 *
 * ## Why these tests exist
 *
 * The production-readiness review found that the frontend shipped with a broken
 * transport contract that compiled cleanly and failed at runtime. `request<T>`
 * performs an **unchecked** generic cast, so declaring `request<{ data: X }>`
 * when the helper returns `X` is invisible to the compiler — every `.data` in
 * every page silently became `undefined`, and the app rendered a white screen.
 *
 * These tests pin the contract itself, so the mistake cannot be reintroduced
 * quietly. They mock `fetch` and make no network request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request, requestList, requestWithMeta } from './request';

/** The options object the last `fetch` call received. */
interface CallOptions {
  method?: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  body?: string;
}

let lastUrl: string | undefined;
let lastOptions: CallOptions | undefined;

/**
 * Replace `fetch` with a stub that records the call and replies with `body`.
 *
 * `status: 204` is treated as a genuinely empty response, exactly as a real
 * server would send it — which is the case that must not attempt JSON parsing.
 */
function mockFetch(body: unknown, init: { status?: number; contentType?: string } = {}): void {
  const status = init.status ?? 200;
  const text = status === 204 || body === undefined ? '' : JSON.stringify(body);

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options: CallOptions) => {
      lastUrl = url;
      lastOptions = options;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(text),
      } as unknown as Response);
    }),
  );
}

beforeEach(() => {
  lastUrl = undefined;
  lastOptions = undefined;
});

afterEach(() => {
  // Every test starts from a clean slate: a leaked stub would let one test's
  // response satisfy another's assertion.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request() — the unwrapping contract', () => {
  it('returns the value inside `data`, not the envelope', async () => {
    mockFetch({ data: { value: 123 } });

    const result = await request<{ value: number }>('/api/thing');

    // The documented behaviour: one unwrap.
    expect(result).toEqual({ value: 123 });
  });

  it('does NOT return the envelope — the exact regression that shipped', async () => {
    mockFetch({ data: { value: 123 } });

    const result = (await request<{ value: number }>('/api/thing')) as unknown;

    // If a future change makes `request` return `{ data: … }`, a caller that
    // already unwrapped would break all over again. This assertion is the alarm.
    expect(result).not.toHaveProperty('data');
    expect(typeof result).toBe('object');
  });

  it('unwraps an array payload too', async () => {
    mockFetch({ data: [{ id: '1' }, { id: '2' }] });

    const result = await request<Array<{ id: string }>>('/api/things');

    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('unwraps a list that nests items and pagination', async () => {
    // The Step 11.8 wire shape.
    mockFetch({ data: { items: [{ id: 'p1' }], pagination: { page: 1, total: 1 } } });

    const result = await request<{ items: unknown[]; pagination: { page: number } }>(
      '/api/intelligence/products',
    );

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(1);
  });
});

describe('request() — error responses', () => {
  it('throws ApiError and preserves the status and machine-readable code', async () => {
    mockFetch(
      { status: 'error', error: 'Product not found.', code: 'PRODUCT_NOT_FOUND' },
      { status: 404 },
    );

    await expect(request('/api/products/3f2504e0')).rejects.toThrowError(ApiError);

    const error = await request('/api/products/3f2504e0').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.code).toBe('PRODUCT_NOT_FOUND');
    expect(apiError.message).toBe('Product not found.');
  });

  it('classifies a 401 as needing sign-in', async () => {
    mockFetch({ status: 'error', error: 'Sign in required.', code: 'UNAUTHENTICATED' }, { status: 401 });

    const error = (await request('/api/secure').catch((cause: unknown) => cause)) as ApiError;

    expect(error.isUnauthenticated).toBe(true);
  });

  it('classifies a 403 as forbidden', async () => {
    mockFetch({ status: 'error', error: 'Owner only.', code: 'FORBIDDEN' }, { status: 403 });

    const error = (await request('/api/admin').catch((cause: unknown) => cause)) as ApiError;

    expect(error.isForbidden).toBe(true);
  });

  it('falls back when the server sends no machine-readable code', async () => {
    mockFetch({}, { status: 500 });

    const error = (await request('/api/boom').catch((cause: unknown) => cause)) as ApiError;

    expect(error.status).toBe(500);
    expect(error.code).toBe('UNKNOWN');
  });
});

describe('request() — empty and unparseable bodies', () => {
  it('resolves to undefined for a 204 without attempting to parse a body', async () => {
    mockFetch(undefined, { status: 204 });

    await expect(request<void>('/api/categories/abc')).resolves.toBeUndefined();
  });

  it('resolves to undefined when a 2xx carries an empty body', async () => {
    mockFetch(undefined, { status: 200 });

    await expect(request<void>('/api/quiet')).resolves.toBeUndefined();
  });

  it('does not throw on a malformed success body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{ not json'),
        } as unknown as Response),
      ),
    );

    await expect(request('/api/garbage')).resolves.toBeUndefined();
  });
});

describe('request() — request behaviour', () => {
  it('always sends the session cookie and accepts JSON', async () => {
    mockFetch({ data: { ok: true } });

    await request('/api/thing');

    expect(lastOptions?.credentials).toBe('include');
    expect(lastOptions?.headers?.['Accept']).toBe('application/json');
  });

  it('omits the JSON content type when there is no body', async () => {
    mockFetch({ data: { ok: true } });

    await request('/api/thing');

    expect(lastOptions?.headers?.['Content-Type']).toBeUndefined();
    expect(lastOptions?.body).toBeUndefined();
  });

  it('sets the JSON content type and serialises the body when one is given', async () => {
    mockFetch({ data: { ok: true } });

    await request('/api/thing', { method: 'POST', body: { name: 'Widget' } });

    expect(lastOptions?.method).toBe('POST');
    expect(lastOptions?.headers?.['Content-Type']).toBe('application/json');
    expect(lastOptions?.body).toBe(JSON.stringify({ name: 'Widget' }));
  });

  it('preserves custom headers alongside the defaults', async () => {
    mockFetch({ data: { ok: true } });

    await request('/api/actions', {
      method: 'POST',
      body: {},
      headers: { 'Idempotency-Key': 'key-1' },
    });

    expect(lastOptions?.headers?.['Idempotency-Key']).toBe('key-1');
    expect(lastOptions?.headers?.['Accept']).toBe('application/json');
  });

  it('requests the path it was given', async () => {
    mockFetch({ data: { ok: true } });

    await request('/api/products?limit=5');

    expect(lastUrl).toBe('/api/products?limit=5');
  });
});

describe('requestWithMeta() — responses that pair data with meta', () => {
  it('returns both the payload and the sibling meta', async () => {
    mockFetch({ data: { items: [{ id: '1' }] }, meta: { total: 5 } });

    const result = await requestWithMeta<{ items: unknown[] }, { total: number }>('/api/things');

    expect(result.data).toEqual({ items: [{ id: '1' }] });
    expect(result.meta).toEqual({ total: 5 });
  });

  it('reports meta as absent when the route sends none', async () => {
    mockFetch({ data: { id: '1' } });

    const result = await requestWithMeta<{ id: string }>('/api/thing');

    expect(result.data).toEqual({ id: '1' });
    expect(result.meta).toBeUndefined();
  });

  it('survives a 204 without attempting to parse a body', async () => {
    mockFetch(undefined, { status: 204 });

    const result = await requestWithMeta<void>('/api/categories/abc');

    expect(result.data).toBeUndefined();
  });
});

describe('requestList() — rows, pagination and count summaries', () => {
  const meta = { total: 1, page: 1, limit: 25, totalPages: 1 };

  it('folds the wire shape into { items, meta, counts }', async () => {
    mockFetch({ data: [{ id: '1' }], meta });

    const result = await requestList<{ id: string }>('/api/things');

    expect(result.items).toEqual([{ id: '1' }]);
    expect(result.meta).toEqual(meta);
    expect(result.counts).toBeUndefined();
  });

  it('surfaces a sibling count summary through `counts`', async () => {
    mockFetch({ data: [{ id: '1' }], meta, riskCounts: { CRITICAL: 1 } });

    const result = await requestList<{ id: string }, { riskCounts?: { CRITICAL: number } }>(
      '/api/intelligence/stock-risk',
    );

    // Without this the breakdown would be silently dropped and the page would
    // render an empty summary rather than fail.
    expect(result.counts?.riskCounts).toEqual({ CRITICAL: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('synthesises a meta block when the route omits one', async () => {
    mockFetch({ data: [{ id: '1' }, { id: '2' }] });

    const result = await requestList<{ id: string }>('/api/things');

    // Never `undefined`: a page reading `meta.total` must get a number.
    expect(result.meta.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('treats a missing data array as empty rather than undefined', async () => {
    // `items.length` on undefined is the crash this guards.
    mockFetch({ meta });

    const result = await requestList<{ id: string }>('/api/things');

    expect(result.items).toEqual([]);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('still throws ApiError for a failed list request', async () => {
    mockFetch({ status: 'error', error: 'Invalid limit.', code: 'INVALID_REQUEST' }, { status: 400 });

    const error = (await requestList('/api/things').catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
  });
});