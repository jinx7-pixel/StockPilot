// @vitest-environment node
/**
 * API client shape tests.
 *
 * ## What is being protected
 *
 * Step 12.1 found clients that declared `request<{ data: X }>` while `request<T>`
 * returns `X`. TypeScript could not catch it, because the cast inside `request`
 * is unchecked. Every page then read `.data` on `undefined` and the app rendered a
 * white screen.
 *
 * These tests mock `fetch` at the transport boundary and assert what a caller
 * actually receives: the **unwrapped** shape. They deliberately do not assert a
 * duplicated `.data` — that is the mistake, not the contract.
 *
 * ## Scope
 *
 * One representative list call per client, plus a detail call where the client has
 * one. This is a contract suite, not a coverage exercise: it exists to fail loudly
 * if a client is re-declared against the envelope. Page rendering is deliberately
 * out of scope and belongs to the UI/UX phase.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyticsApi } from './analytics';
import { catalogApi } from './catalog';
import { demandApi } from './demand';
import { intelligenceApi } from './intelligence';
import { inventoryApi } from './inventory';
import { overstockApi } from './overstock';
import { purchaseOrderApi, supplierApi } from './purchasing';
import { recommendationsApi } from './recommendations';
import { reorderApi } from './reorder';
import { salesApi } from './sales';
import { slowDeadApi } from './slowDead';
import { supplierIntelligenceApi } from './supplierIntelligence';
import { unifiedApi } from './unified';
import { actionsApi } from './actions';

const META = { total: 1, page: 1, limit: 25, totalPages: 1 };

/** Reply to the next `fetch` with this JSON body. */
function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(body)),
      } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('catalog client', () => {
  it('returns categories as a plain array', async () => {
    respondWith({ data: [{ id: 'c1', name: 'Tools' }] });

    const result = await catalogApi.listCategories();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns products with { items, meta }', async () => {
    respondWith({ data: [{ id: 'p1', sku: 'A-1' }], meta: META });

    const result = await catalogApi.listProducts({ limit: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('returns a single product unwrapped', async () => {
    respondWith({ data: { id: 'p1', sku: 'A-1' } });

    const result = await catalogApi.deactivateProduct('p1');

    expect(result.id).toBe('p1');
  });
});

describe('inventory client', () => {
  it('returns items with { items, meta }', async () => {
    respondWith({ data: [{ id: 'p1', currentStock: 10 }], meta: META });

    const result = await inventoryApi.list({});

    expect(result.items[0]!.currentStock).toBe(10);
    expect(result.meta.limit).toBe(25);
  });

  it('returns the summary unwrapped', async () => {
    respondWith({ data: { productCount: 3, productsWithMovements: 2 } });

    const result = await inventoryApi.summary();

    expect(result.productCount).toBe(3);
  });

  it('keeps meta alongside the recorded movement, so the new balance survives', async () => {
    // This route pairs the movement with meta.currentStock. A plain `request`
    // would discard it and the form could never show the resulting balance.
    respondWith({ data: { id: 'm1' }, meta: { currentStock: 42 } });

    const result = await inventoryApi.record({
      productId: 'p1',
      movementType: 'in',
      quantity: '5',
      reason: 'Delivery',
    });

    expect(result.data.id).toBe('m1');
    expect(result.meta?.currentStock).toBe(42);
  });
});

describe('sales client', () => {
  it('returns items with { items, meta }', async () => {
    respondWith({ data: [{ id: 's1' }], meta: META });

    const result = await salesApi.list({});

    expect(result.items).toHaveLength(1);
  });

  it('returns a single sale unwrapped', async () => {
    respondWith({ data: { id: 's1', status: 'completed' } });

    const result = await salesApi.detail('s1');

    expect(result.status).toBe('completed');
  });
});

describe('purchasing clients', () => {
  it('returns suppliers with { items, meta }', async () => {
    respondWith({ data: [{ id: 'sup1' }], meta: META });

    const result = await supplierApi.list({ isActive: 'all' });

    expect(result.items).toHaveLength(1);
  });

  it('returns purchase orders with { items, meta }', async () => {
    respondWith({ data: [{ id: 'po1', status: 'draft' }], meta: META });

    const result = await purchaseOrderApi.list({});

    expect(result.items[0]!.status).toBe('draft');
  });

  it('returns a single purchase order unwrapped', async () => {
    respondWith({ data: { id: 'po1', status: 'ordered' } });

    const result = await purchaseOrderApi.detail('po1');

    expect(result.status).toBe('ordered');
  });
});

describe('analytics client', () => {
  it('returns the overview unwrapped', async () => {
    respondWith({ data: { products: { totalProducts: 4 } } });

    const result = await analyticsApi.overview();

    expect(result.products.totalProducts).toBe(4);
  });

  it('returns product analytics with { items, meta }', async () => {
    respondWith({ data: [{ id: 'p1' }], meta: META });

    const result = await analyticsApi.products();

    expect(result.items).toHaveLength(1);
  });
});

describe('intelligence engine clients', () => {
  it('stock risk returns { items, meta } and surfaces riskCounts', async () => {
    respondWith({ data: [{ id: 'p1', risk: 'LOW' }], meta: META, riskCounts: { LOW: 1 } });

    const result = await intelligenceApi.list({});

    expect(result.items[0]!.risk).toBe('LOW');
    expect(result.riskCounts).toEqual({ LOW: 1 });
  });

  it('demand returns { items, meta } and surfaces trendCounts', async () => {
    respondWith({ data: [{ id: 'p1' }], meta: META, trendCounts: { STABLE: 1 } });

    const result = await demandApi.list({});

    expect(result.trendCounts).toEqual({ STABLE: 1 });
  });

  it('reorder returns { items, meta } and surfaces decisionCounts', async () => {
    respondWith({ data: [{ id: 'p1' }], meta: META, decisionCounts: { NO_REORDER: 1 } });

    const result = await reorderApi.list({});

    expect(result.decisionCounts).toEqual({ NO_REORDER: 1 });
  });

  it('overstock returns { items, meta } and surfaces statusCounts', async () => {
    respondWith({ data: [{ id: 'p1' }], meta: META, statusCounts: { OVERSTOCK: 1 } });

    const result = await overstockApi.list({});

    expect(result.statusCounts).toEqual({ OVERSTOCK: 1 });
  });

  it('slow/dead returns { items, meta } and surfaces statusCounts', async () => {
    respondWith({ data: [{ id: 'p1' }], meta: META, statusCounts: { SLOW: 1 } });

    const result = await slowDeadApi.list({});

    expect(result.statusCounts).toEqual({ SLOW: 1 });
  });

  it('supplier intelligence returns { items, meta } and surfaces stabilityCounts', async () => {
    respondWith({ data: [{ id: 'sup1' }], meta: META, stabilityCounts: { STABLE: 1 } });

    const result = await supplierIntelligenceApi.list({});

    expect(result.stabilityCounts).toEqual({ STABLE: 1 });
  });

  it('returns a single engine detail unwrapped', async () => {
    respondWith({ data: { id: 'p1', risk: 'CRITICAL' } });

    const result = await intelligenceApi.detail('p1');

    expect(result.risk).toBe('CRITICAL');
  });
});

describe('unified intelligence client', () => {
  it('returns items and pagination straight from `data`', async () => {
    respondWith({ data: { items: [{ product: { id: 'p1' } }], pagination: META } });

    const result = await unifiedApi.list({});

    expect(result.items).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('returns a single unified product unwrapped', async () => {
    respondWith({ data: { product: { id: 'p1' }, summary: { decisionCount: 2 } } });

    const result = await unifiedApi.detail('p1');

    expect(result.product.id).toBe('p1');
    expect(result.summary.decisionCount).toBe(2);
  });
});

describe('recommendations client', () => {
  it('returns items and pagination straight from `data`', async () => {
    respondWith({
      data: {
        items: [{ product: { id: 'p1' }, recommendations: [{ type: 'REPLENISH' }] }],
        pagination: META,
        recommendationCount: 1,
      },
    });

    const result = await recommendationsApi.list({});

    expect(result.items).toHaveLength(1);
    expect(result.recommendationCount).toBe(1);
  });

  it('returns a single product detail unwrapped', async () => {
    respondWith({
      data: {
        product: { id: 'p1' },
        recommendations: [{ id: 'p1:REPLENISH', type: 'REPLENISH' }],
        summary: { recommendationCount: 1, highestPriority: 'HIGH' },
      },
    });

    const result = await recommendationsApi.forProduct('p1');

    expect(result.recommendations).toHaveLength(1);
    expect(result.summary.highestPriority).toBe('HIGH');
  });
});

describe('actions client', () => {
  it('returns history with { items, meta }', async () => {
    respondWith({ data: { items: [{ id: 'a1', status: 'COMPLETED' }], pagination: META } });

    const result = await actionsApi.list({});

    expect(result.items[0]!.status).toBe('COMPLETED');
    expect(result.pagination.total).toBe(1);
  });

  it('returns the created action and its purchase order', async () => {
    respondWith({
      data: {
        action: { id: 'a1', status: 'COMPLETED', quantity: '10.00' },
        purchaseOrder: { id: 'po1', status: 'draft' },
      },
    });

    const result = await actionsApi.execute({
      productId: 'p1',
      supplierId: 'sup1',
      quantity: '10',
    });

    expect(result.action.status).toBe('COMPLETED');
    expect(result.purchaseOrder?.status).toBe('draft');
  });
});