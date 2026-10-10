// @vitest-environment node
/**
 * Regression tests for the production-readiness finding.
 *
 * ## The incident
 *
 * Two list endpoints introduced in Steps 11.8 and 11.9 answered
 *
 *   { items: [...], pagination: {...} }
 *
 * with no `data` wrapper, while every other route answered `{ data: … }`. The
 * frontend transport unconditionally read `payload.data`, so on these two routes
 * it returned `undefined`. Every page then did `result.data.items` or
 * `result.items` on `undefined` and the React render threw: a **white screen on
 * every page**, with a green build and a green test pipeline.
 *
 * ## Why a test is the only real defence
 *
 * `request<T>` casts with `(payload as ApiEnvelope<T>).data`. That cast is
 * unchecked, so `request<{ data: X }>` compiles exactly like `request<X>` even
 * though the first one is a double unwrap. No amount of type checking catches it —
 * only a runtime assertion on the value a caller actually receives.
 *
 * These tests therefore assert on the **runtime value**, not on the declared
 * type. Changing a client back to `request<{ data: … }>` makes them fail.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { recommendationsApi } from './recommendations';
import { unifiedApi } from './unified';

const PAGINATION = { page: 1, limit: 25, total: 1, totalPages: 1 };

function respondWith(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Regression — GET /api/intelligence/products', () => {
  it('exposes a top-level `data` and puts items and pagination inside it', async () => {
    // The wire shape after Step 12.1.
    const wire = {
      data: {
        items: [{ product: { id: 'product-1' } }],
        pagination: PAGINATION,
      },
    };

    expect(wire).toHaveProperty('data');
    // And the pre-12.1 shape, which is the thing that must not return:
    expect(wire).not.toHaveProperty('items');

    respondWith(wire);

    const result = await unifiedApi.list({});

    // The assertions a page actually makes.
    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items[0]!.product.id).toBe('product-1');
    expect(result.pagination.total).toBe(1);
  });

  it('would break a page if the client were re-declared against the envelope', async () => {
    respondWith({ data: { items: [{ product: { id: 'product-1' } }], pagination: PAGINATION } });

    // Exactly what a page does when rendering the table.
    const renderRows = (page: { items: Array<{ product: { id: string } }> }) =>
      page.items.map((item) => item.product.id);

    const result = await unifiedApi.list({});

    // `result.items.length === 0` — not a crash — would mean an empty table;
    // throwing here is what the white screen actually was.
    expect(() => renderRows(result)).not.toThrow();
    expect(renderRows(result)).toEqual(['product-1']);
  });
});

describe('Regression — GET /api/recommendations', () => {
  it('exposes a top-level `data` and puts items and pagination inside it', async () => {
    const wire = {
      data: {
        items: [
          {
            product: { id: 'product-1' },
            recommendations: [{ id: 'product-1:REPLENISH', type: 'REPLENISH' }],
          },
        ],
        pagination: PAGINATION,
        recommendationCount: 1,
      },
    };

    expect(wire).toHaveProperty('data');
    expect(wire).not.toHaveProperty('items');
    expect(wire).not.toHaveProperty('recommendationCount');

    respondWith(wire);

    const result = await recommendationsApi.list({});

    expect(result).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.recommendationCount).toBe(1);
    expect(result.pagination.total).toBe(1);
  });

  it('does not hand a caller an object that still needs unwrapping', async () => {
    respondWith({
      data: {
        items: [{ product: { id: 'product-1' }, recommendations: [] }],
        pagination: PAGINATION,
        recommendationCount: 0,
      },
    });

    const result = (await recommendationsApi.list({})) as unknown;

    // The precise shape of the original bug: a caller that wrote `.items` would
    // be reaching for a property that does not exist.
    expect(result).not.toHaveProperty('data');
    expect(result).toHaveProperty('items');
  });
});

describe('Regression — the same trap on a detail route', () => {
  it('recommendations detail is returned unwrapped', async () => {
    respondWith({
      data: {
        product: { id: 'product-1' },
        recommendations: [{ id: 'product-1:REVIEW_OVERSTOCK', type: 'REVIEW_OVERSTOCK' }],
        summary: { recommendationCount: 1, highestPriority: 'MEDIUM' },
      },
    });

    const result = await recommendationsApi.forProduct('product-1');

    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.recommendations[0]!.type).toBe('REVIEW_OVERSTOCK');
    expect(result.summary.recommendationCount).toBe(1);
  });

  it('an empty list is still an array, never undefined', async () => {
    // `result.items.length` on undefined is the render-time TypeError.
    respondWith({ data: { items: [], pagination: PAGINATION, recommendationCount: 0 } });

    const result = await recommendationsApi.list({});

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(() => result.items.map((item) => item.product.id)).not.toThrow();
  });
});