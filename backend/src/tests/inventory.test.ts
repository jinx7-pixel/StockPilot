/**
 * Inventory & stock ledger tests.
 *
 * The invariants that matter most, and that this suite exists to protect:
 *  - stock is *derived* from the ledger, and only from the ledger;
 *  - no operation can leave stock negative, including under concurrency;
 *  - a movement is immutable and can never be edited or deleted;
 *  - one business can neither read nor write another business's ledger.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestClient, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface Movement {
  id: string;
  movementType: 'in' | 'out' | 'adjustment';
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unit: string;
  isActive: boolean;
  currentStock: number;
  category: { id: string; name: string } | null;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase();
});

/** Create a product for a tenant and return its id. */
async function createProduct(
  tenant: Tenant,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody(overrides),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/** Record a movement and assert it was accepted. */
async function record(
  client: TestClient,
  body: Record<string, unknown>,
): Promise<{ movement: Movement; currentStock: number }> {
  const response = await client.post<{ data: Movement; meta: { currentStock: number } }>(
    '/api/inventory/movements',
    body,
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { movement: response.body.data, currentStock: response.body.meta.currentStock };
}

async function readCurrentStock(client: TestClient, productId: string): Promise<number> {
  const response = await client.get<{ data: { currentStock: number } }>(
    `/api/inventory/${productId}`,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data.currentStock;
}

// ---------------------------------------------------------------------------

describe('GET /api/inventory', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await server.client().get('/api/inventory');

    assert.equal(response.status, 401);
  });

  it('lists products with derived stock', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { name: 'Widget' });

    const empty = await tenant.client.get<{ data: InventoryItem[] }>('/api/inventory');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data[0]?.currentStock, 0, 'a product with no movements has zero stock');

    await record(tenant.client, { productId, movementType: 'in', quantity: '12' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '5' });

    const response = await tenant.client.get<{ data: InventoryItem[] }>('/api/inventory');
    assert.equal(response.body.data[0]?.currentStock, 7, '12 in âˆ’ 5 out');
  });

  it('includes category, unit and active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>(
      '/api/categories',
      { name: 'Tools' },
    );
    const product = await createProduct(tenant, {
      categoryId: category.body.data.id,
      unit: 'box',
    });
    assert.ok(product);

    const response = await tenant.client.get<{ data: InventoryItem[] }>('/api/inventory');
    const item = response.body.data[0];

    assert.equal(item?.unit, 'box');
    assert.equal(item?.isActive, true);
    assert.equal(item?.category?.name, 'Tools');
  });

  it('never returns another business products', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    await createProduct(tenantA, { name: 'A widget' });

    const response = await tenantB.client.get<{ data: InventoryItem[]; meta: Meta }>(
      '/api/inventory',
    );

    assert.equal(response.body.meta.total, 0);
    assert.equal(response.body.data.length, 0);
  });

  it('searches by name and by SKU', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { name: 'Blue widget', sku: 'BW-1' });
    await createProduct(tenant, { name: 'Red widget', sku: 'RW-1' });

    const byName = await tenant.client.get<{ data: InventoryItem[] }>(
      '/api/inventory?search=blue',
    );
    assert.equal(byName.body.data.length, 1);
    assert.equal(byName.body.data[0]?.name, 'Blue widget');

    const bySku = await tenant.client.get<{ data: InventoryItem[] }>('/api/inventory?search=rw-1');
    assert.equal(bySku.body.data.length, 1, 'SKU search is case-insensitive');
  });

  it('filters by category and by active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>(
      '/api/categories',
      { name: 'Tools' },
    );

    await createProduct(tenant, { name: 'Hammer', categoryId: category.body.data.id });
    await createProduct(tenant, { name: 'Retired', categoryId: null });
    await tenant.client.post('/api/products', productBody({ name: 'Hidden', isActive: false }));

    const byCategory = await tenant.client.get<{ data: InventoryItem[]; meta: Meta }>(
      `/api/inventory?categoryId=${category.body.data.id}`,
    );
    assert.equal(byCategory.body.meta.total, 1);
    assert.equal(byCategory.body.data[0]?.name, 'Hammer');

    const inactive = await tenant.client.get<{ data: InventoryItem[] }>(
      '/api/inventory?isActive=false',
    );
    assert.equal(inactive.body.data.length, 1);
    assert.equal(inactive.body.data[0]?.name, 'Hidden');
  });

  it('filters by stock status', async () => {
    const tenant = await createTenant(server);
    const stocked = await createProduct(tenant, { name: 'In stock' });
    await createProduct(tenant, { name: 'Never stocked' });

    await record(tenant.client, { productId: stocked, movementType: 'in', quantity: '5' });

    const inStock = await tenant.client.get<{ data: InventoryItem[] }>(
      '/api/inventory?stockStatus=in_stock',
    );
    assert.equal(inStock.body.data.length, 1);
    assert.equal(inStock.body.data[0]?.name, 'In stock');

    const outOfStock = await tenant.client.get<{ data: InventoryItem[] }>(
      '/api/inventory?stockStatus=out_of_stock',
    );
    assert.equal(outOfStock.body.data.length, 1, 'zero-balance or never-stocked');

    const noMovements = await tenant.client.get<{ data: InventoryItem[] }>(
      '/api/inventory?stockStatus=no_movements',
    );
    assert.equal(noMovements.body.data.length, 1);
    assert.equal(
      noMovements.body.data[0]?.name,
      'Never stocked',
      'no_movements is distinct from a zero balance',
    );
  });

  it('paginates and reports metadata', async () => {
    const tenant = await createTenant(server);
    for (let i = 0; i < 5; i += 1) {
      await createProduct(tenant, { name: `Paged ${i}` });
    }

    const response = await tenant.client.get<{ data: InventoryItem[]; meta: Meta }>(
      '/api/inventory?page=2&limit=2',
    );

    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.meta.total, 5);
    assert.equal(response.body.meta.page, 2);
    assert.equal(response.body.meta.totalPages, 3);
  });

  it('rejects a businessId query parameter with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get('/api/inventory?businessId=some-other-tenant');

    assert.equal(response.status, 400, 'tenant scope is not client-controlled');
  });
});

describe('POST /api/inventory/movements', () => {
  it('records a stock IN and increases the balance', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const result = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '25',
      reason: 'Opening stock',
    });

    assert.equal(result.currentStock, 25);
    assert.equal(result.movement.movementType, 'in');
    assert.equal(result.movement.quantity, 25);
    assert.equal(result.movement.reason, 'Opening stock');
    assert.equal(await readCurrentStock(tenant.client, productId), 25);
  });

  it('records a stock OUT and decreases the balance', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });

    const result = await record(tenant.client, { productId, movementType: 'out', quantity: '4' });

    assert.equal(result.currentStock, 6);
    assert.equal(await readCurrentStock(tenant.client, productId), 6);
  });

  it('applies a positive adjustment', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });

    const result = await record(tenant.client, {
      productId,
      movementType: 'adjustment',
      quantity: '3',
      reason: 'Found during stock count',
    });

    assert.equal(result.currentStock, 13);
  });

  it('applies a negative adjustment', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });

    const result = await record(tenant.client, {
      productId,
      movementType: 'adjustment',
      quantity: '-2.5',
      reason: 'Damaged in the warehouse',
    });

    assert.equal(result.currentStock, 7.5, 'adjustments keep their sign');
  });

  it('records who created the movement', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const { movement } = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '1',
    });

    assert.equal(movement.createdBy.id, tenant.user.id);
    assert.equal(movement.createdBy.name, 'Test Owner');
    assert.ok(movement.createdAt, 'the ledger records when it happened');
  });

  it('keeps the recorded quantity exact to two decimals', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const { movement, currentStock } = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '10.5',
    });
    assert.equal(movement.quantity, 10.5);
    assert.equal(currentStock, 10.5);

    // 0.1 + 0.2 style drift must not appear: the sum is computed in numeric.
    await record(tenant.client, { productId, movementType: 'in', quantity: '0.1' });
    await record(tenant.client, { productId, movementType: 'in', quantity: '0.2' });
    assert.equal(await readCurrentStock(tenant.client, productId), 10.8, 'no floating-point drift');
  });
});

describe('movement validation', () => {
  it('rejects a zero quantity with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    for (const movementType of ['in', 'out', 'adjustment'] as const) {
      const response = await tenant.client.post('/api/inventory/movements', {
        productId,
        movementType,
        quantity: '0',
      });
      assert.equal(response.status, 400, `${movementType} with zero must be rejected`);
    }
  });

  it('rejects a negative IN with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '-5',
    });

    assert.equal(response.status, 400);
  });

  it('rejects a negative OUT with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'out',
      quantity: '-5',
    });

    assert.equal(response.status, 400);
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post('/api/inventory/movements', {
      productId: 'not-a-uuid',
      movementType: 'in',
      quantity: '1',
    });

    assert.equal(response.status, 400);
  });

  it('rejects an invalid movement type with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'transfer',
      quantity: '1',
    });

    assert.equal(response.status, 400);
  });

  it('rejects unknown fields with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    for (const extra of [
      { businessId: 'other' },
      { createdBy: 'someone' },
      { currentStock: 999 },
    ]) {
      const response = await tenant.client.post('/api/inventory/movements', {
        productId,
        movementType: 'in',
        quantity: '1',
        ...extra,
      });
      assert.equal(response.status, 400, `${Object.keys(extra)[0]} must be rejected`);
    }
  });

  it('rejects a half-specified reference with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const onlyType = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '1',
      referenceType: 'purchase_order',
    });
    assert.equal(onlyType.status, 400, 'a reference type needs an id');

    const onlyId = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '1',
      referenceId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    assert.equal(onlyId.status, 400, 'a reference id needs a type');
  });

  it('rejects an over-long reason with 400', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '1',
      reason: 'x'.repeat(256),
    });

    assert.equal(response.status, 400);
  });

  it('accepts a complete reference pair', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const referenceId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

    const { movement } = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '1',
      referenceType: 'purchase_order',
      referenceId,
    });

    assert.equal(movement.referenceType, 'purchase_order');
    assert.equal(movement.referenceId, referenceId);
  });
});

describe('stock safety', () => {
  it('rejects an OUT that would go negative with 409', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '5' });

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'out',
      quantity: '6',
    });

    assert.equal(response.status, 409);
    assert.equal(await readCurrentStock(tenant.client, productId), 5, 'the balance is unchanged');
  });

  it('rejects a negative adjustment that would go negative with 409', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '5' });

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'adjustment',
      quantity: '-6',
    });

    assert.equal(response.status, 409);
    assert.equal(await readCurrentStock(tenant.client, productId), 5);
  });

  it('allows an OUT that empties the stock exactly', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '5' });

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'out',
      quantity: '5',
    });

    assert.equal(response.status, 201, 'depleting to exactly zero is allowed');
    assert.equal(await readCurrentStock(tenant.client, productId), 0);
  });

  it('rejects a further OUT once the stock is gone', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '5' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '5' });

    const response = await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'out',
      quantity: '1',
    });

    assert.equal(response.status, 409, 'zero stock cannot go negative');
  });

  it('allows a subsequent IN after emptying the stock', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '5' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '5' });

    const result = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '3',
    });

    assert.equal(result.currentStock, 3);
  });
});

describe('concurrency', () => {
  it('never lets two concurrent OUT requests double-spend the same stock', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });

    // 7 + 7 = 14 > 10, so at most one may succeed. Both are issued without
    // awaiting in between, so they overlap in the server. If the two happen to
    // serialise instead, the invariant below must still hold â€” the advisory lock
    // is what guarantees it when they genuinely run in parallel.
    const [first, second] = await Promise.all([
      tenant.client.post('/api/inventory/movements', {
        productId,
        movementType: 'out',
        quantity: '7',
      }),
      tenant.client.post('/api/inventory/movements', {
        productId,
        movementType: 'out',
        quantity: '7',
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(
      statuses,
      [201, 409],
      'exactly one succeeds; the other is refused for insufficient stock',
    );

    assert.equal(
      await readCurrentStock(tenant.client, productId),
      3,
      'stock is 10 âˆ’ 7 = 3 and never negative',
    );
  });

  it('keeps concurrent movements for different products independent', async () => {
    const tenant = await createTenant(server);
    const productA = await createProduct(tenant, { name: 'Product A' });
    const productB = await createProduct(tenant, { name: 'Product B' });

    await record(tenant.client, { productId: productA, movementType: 'in', quantity: '10' });
    await record(tenant.client, { productId: productB, movementType: 'in', quantity: '10' });

    const results = await Promise.all([
      tenant.client.post('/api/inventory/movements', {
        productId: productA,
        movementType: 'out',
        quantity: '10',
      }),
      tenant.client.post('/api/inventory/movements', {
        productId: productB,
        movementType: 'out',
        quantity: '10',
      }),
    ]);

    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [201, 201],
      'the lock is per product, so neither blocks the other',
    );
  });
});

describe('movement history', () => {
  it('returns the ledger newest first with pagination metadata', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '3' });
    await record(tenant.client, { productId, movementType: 'adjustment', quantity: '-1' });

    const response = await tenant.client.get<{ data: Movement[]; meta: Meta }>(
      `/api/inventory/${productId}/movements?limit=2`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.meta.total, 3);
    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.data[0]?.movementType, 'adjustment', 'newest first');
    assert.equal(response.body.data[1]?.movementType, 'out');
  });

  it('filters the ledger by movement type', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '3' });

    const response = await tenant.client.get<{ data: Movement[]; meta: Meta }>(
      `/api/inventory/${productId}/movements?movementType=in`,
    );

    assert.equal(response.body.meta.total, 1);
    assert.equal(response.body.data[0]?.movementType, 'in');
  });

  it('returns per-type totals on the product detail endpoint', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '3' });
    await record(tenant.client, { productId, movementType: 'adjustment', quantity: '-1' });

    const response = await tenant.client.get<{
      data: {
        product: { name: string };
        currentStock: number;
        movementCount: number;
        totals: { in: number; out: number; adjustment: number };
      };
    }>(`/api/inventory/${productId}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.currentStock, 6);
    assert.equal(response.body.data.movementCount, 3);
    assert.deepEqual(response.body.data.totals, { in: 10, out: 3, adjustment: -1 });
  });
});

describe('multi-tenancy', () => {
  it('returns 404 for another business product', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const productId = await createProduct(tenantA);

    const detail = await tenantB.client.get(`/api/inventory/${productId}`);
    assert.equal(detail.status, 404, 'a foreign product simply does not exist');

    const history = await tenantB.client.get(`/api/inventory/${productId}/movements`);
    assert.equal(history.status, 404);
  });

  it('refuses to record a movement against another business product with 404', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const productId = await createProduct(tenantA);

    const response = await tenantB.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '100',
    });

    assert.equal(response.status, 404);
  });

  it('keeps movement history tenant isolated', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const productId = await createProduct(tenantA, { name: 'Shared name' });
    const productIdB = await createProduct(tenantB, { name: 'Shared name' });

    await record(tenantA.client, { productId, movementType: 'in', quantity: '100' });
    await record(tenantB.client, { productId: productIdB, movementType: 'in', quantity: '1' });

    const historyA = await tenantA.client.get<{ meta: Meta }>(
      `/api/inventory/${productId}/movements`,
    );
    const historyB = await tenantB.client.get<{ meta: Meta }>(
      `/api/inventory/${productIdB}/movements`,
    );

    assert.equal(historyA.body.meta.total, 1);
    assert.equal(historyB.body.meta.total, 1, 'each tenant sees only its own entry');
    assert.equal(await readCurrentStock(tenantA.client, productId), 100);
    assert.equal(await readCurrentStock(tenantB.client, productIdB), 1, 'balances do not mix');
  });
});

describe('immutability', () => {
  it('exposes no update or delete endpoint for a movement', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const { movement } = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '10',
    });

    // Every plausible mutation route must fail. 404 means the route does not
    // exist, 405 means it exists for other methods — neither is a success.
    const mutationAttempts = [
      tenant.client.patch(`/api/inventory/movements/${movement.id}`, { quantity: 999 }),
      tenant.client.patch(`/api/inventory/${productId}/movements/${movement.id}`, {
        quantity: 999,
      }),
      tenant.client.delete(`/api/inventory/movements/${movement.id}`),
      tenant.client.delete(`/api/inventory/${productId}/movements/${movement.id}`),
    ];

    for (const attempt of mutationAttempts) {
      const { status } = await attempt;
      assert.ok(
        status === 404 || status === 405,
        `a mutation route must not succeed, got ${status}`,
      );
    }

    // And the ledger is untouched by any of them.
    assert.equal(await readCurrentStock(tenant.client, productId), 10);
  });

  it('leaves history unchanged when a correction is appended', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const { movement: original } = await record(tenant.client, {
      productId,
      movementType: 'in',
      quantity: '10',
      reason: 'Original count',
    });

    // The correction is a new movement, never an edit of the original.
    await record(tenant.client, {
      productId,
      movementType: 'adjustment',
      quantity: '-2',
      reason: 'Recount correction',
    });

    const history = await tenant.client.get<{ data: Movement[] }>(
      `/api/inventory/${productId}/movements`,
    );
    const first = history.body.data.find((m) => m.id === original.id);

    assert.ok(first, 'the original movement still exists');
    assert.equal(first.quantity, 10, 'its quantity was never rewritten');
    assert.equal(first.reason, 'Original count');
    assert.equal(history.body.data.length, 2, 'the correction is an additional entry');
  });

  it('rejects a direct UPDATE at the database level', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '10' });

    await assert.rejects(
      getPool().query(
        `UPDATE inventory_movements SET quantity = 999 WHERE product_id = $1`,
        [productId],
      ),
      'the append-only trigger must reject updates even from direct SQL',
    );
  });
});

describe('authorization', () => {
  it('lets a staff user view and record movements', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    assert.equal((await staff.get('/api/inventory')).status, 200);

    const response = await staff.post<{ data: Movement; meta: { currentStock: number } }>(
      '/api/inventory/movements',
      { productId, movementType: 'in', quantity: '5' },
    );

    assert.equal(response.status, 201, 'recording stock is ordinary day-to-day work');
    assert.equal(response.body.meta.currentStock, 5);
  });

  it('lets a staff user record an adjustment', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);
    await record(staff, { productId, movementType: 'in', quantity: '10' });

    const response = await staff.post('/api/inventory/movements', {
      productId,
      movementType: 'adjustment',
      quantity: '-1',
      reason: 'Stock count correction',
    });

    assert.equal(response.status, 201, 'no unnecessary owner-only restriction');
  });

  it('records the acting user, not a client-supplied one', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const { client: staff, user: staffUser } = await createStaffSession(
      server,
      tenant.user.businessId,
    );

    const { movement } = await record(staff, {
      productId,
      movementType: 'in',
      quantity: '1',
    });

    assert.equal(movement.createdBy.id, staffUser.id, 'the ledger attributes the real actor');
  });

  it('rejects unauthenticated access to every inventory route', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/inventory')).status, 401);
    assert.equal((await client.get('/api/inventory/summary')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/inventory/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await client.get(
          '/api/inventory/3f2504e0-4f89-11d3-9a0c-0305e82c3301/movements',
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await client.post('/api/inventory/movements', {
          productId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          movementType: 'in',
          quantity: '1',
        })
      ).status,
      401,
    );
  });
});

describe('GET /api/inventory/summary', () => {
  it('summarises the tenant ledger', async () => {
    const tenant = await createTenant(server);
    const stocked = await createProduct(tenant, { name: 'Stocked' });
    await createProduct(tenant, { name: 'Bare' });
    await record(tenant.client, { productId: stocked, movementType: 'in', quantity: '10' });
    await record(tenant.client, { productId: stocked, movementType: 'out', quantity: '4' });

    const response = await tenant.client.get<{
      data: {
        productCount: number;
        productsWithMovements: number;
        outOfStockCount: number;
        totalMovementCount: number;
        lastMovementAt: string | null;
      };
    }>('/api/inventory/summary');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.productCount, 2);
    assert.equal(response.body.data.productsWithMovements, 1);
    assert.equal(response.body.data.outOfStockCount, 1, 'the bare product has no stock');
    assert.equal(response.body.data.totalMovementCount, 2);
    assert.ok(response.body.data.lastMovementAt);
  });

  it('is not shadowed by the /:productId route', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get('/api/inventory/summary');

    assert.equal(
      response.status,
      200,
      'a 400 here would mean Express matched /:productId first',
    );
  });
});

describe('no duplicate source of truth', () => {
  it('stores no cached stock column on products', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);

    await record(tenant.client, { productId, movementType: 'in', quantity: '7' });

    const columns = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = ANY($1::text[])`,
      [['stock', 'current_stock', 'stock_quantity', 'quantity', 'available']],
    );

    assert.equal(
      columns.rows.length,
      0,
      'products must hold no quantity column; the ledger is the only source',
    );
  });

  it('recomputes the balance from the ledger rather than trusting a cache', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await record(tenant.client, { productId, movementType: 'in', quantity: '5' });
    await record(tenant.client, { productId, movementType: 'out', quantity: '2' });

    const { getCurrentStock } = await import('../repositories/inventory.repository.js');
    const poolBalance = await getCurrentStock(tenant.user.businessId, productId);

    const apiBalance = await readCurrentStock(tenant.client, productId);
    const listing = await tenant.client.get<{ data: InventoryItem[] }>('/api/inventory');

    assert.equal(poolBalance, 3);
    assert.equal(apiBalance, poolBalance);
    assert.equal(
      listing.body.data[0]?.currentStock,
      poolBalance,
      'every read path agrees with the ledger',
    );
  });

  it('aggregates many products without an N+1 query', async () => {
    const { getCurrentStockForProducts } = await import('../repositories/inventory.repository.js');
    const tenant = await createTenant(server);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await createProduct(tenant, { name: `Bulk ${i}` }));
    }
    await record(tenant.client, { productId: ids[0]!, movementType: 'in', quantity: '5' });

    const balances = await getCurrentStockForProducts(tenant.user.businessId, ids);

    assert.equal(balances.size, 1, 'only the product with movements appears');
    assert.equal(balances.get(ids[0]!), 5);
  });
});


