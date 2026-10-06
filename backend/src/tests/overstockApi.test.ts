/**
 * Overstock Detection API — integration tests.
 *
 * Exercises the real HTTP surface against the real database: authentication,
 * tenant isolation, filters, pagination, and the fact-gathering SQL that this
 * feature shares with the Reorder Engine. The overstock *rules* are proven
 * separately in `overstock.test.ts`, which needs no database.
 *
 * Products are created through the API and their stock is then settled with a
 * direct movement, because the API refuses to oversell and the stock levels a
 * threshold test needs are not reachable by selling alone. The ledger is
 * append-only and a trigger rejects rewrites, so every adjustment is an insert.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface OverstockEntry {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  status: string;
  priority: number;
  currentStock: string;
  averageDailySales30d: string;
  unitsSold30d: string;
  activeSalesDays30d: number;
  analysisWindowDays: number;
  daysOfStock: string | null;
  thresholdDays: number;
  confidence: string;
  reason: string;
  evidence: {
    analysisWindowDays: number;
    unitsSold90d: string;
    activeSalesDays90d: number;
    observableHistoryDays: string;
    minimumActiveSalesDays30d: number;
    minimumUnitsSold30d: string;
    thresholdDays: number;
    unmetEvidenceGates: string[];
    hasSufficientEvidence: boolean;
  };
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** A large, backdated opening balance so every sale a fixture needs can succeed. */
async function stockInLarge(tenant: Tenant, productId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     SELECT $1, $2, 'in', 100000, 'Opening stock', $3::uuid, now() - interval '200 days'`,
    [tenant.user.businessId, productId, tenant.user.id],
  );
}

/**
 * Settle the ledger balance to an exact figure.
 *
 * The balance is the sum of an append-only ledger rather than a stored column,
 * so the only way to hit a precise level is to write a movement.
 */
async function adjustStockTo(
  tenant: Tenant,
  productId: string,
  target: string,
): Promise<void> {
  const current = await getPool().query<{ balance: string }>(
    `SELECT COALESCE(SUM(CASE movement_type WHEN 'out' THEN -quantity ELSE quantity END), 0)::text
              AS balance
       FROM inventory_movements
      WHERE business_id = $1 AND product_id = $2`,
    [tenant.user.businessId, productId],
  );

  const delta = Number(target) - Number(current.rows[0]?.balance ?? '0');
  if (delta === 0) return;

  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, $3, $4::numeric, 'Fixture adjustment', $5::uuid, now())`,
    [
      tenant.user.businessId,
      productId,
      delta < 0 ? 'out' : 'in',
      Math.abs(delta).toFixed(2),
      tenant.user.id,
    ],
  );
}

/** One sale per day, so the engine sees a realistic daily series. */
async function seedSalesOnDays(
  tenant: Tenant,
  productId: string,
  ages: readonly number[],
  units: string,
): Promise<void> {
  for (const age of ages) {
    const response = await tenant.client.post('/api/sales', {
      soldAt: new Date(Date.now() - age * 86_400_000).toISOString(),
      items: [{ productId, quantity: units }],
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }
}

function recentAges(count: number, startAge = 0): number[] {
  return Array.from({ length: count }, (_, index) => startAge + index);
}

async function listOverstock(
  tenant: Tenant,
  query = '',
): Promise<{ data: OverstockEntry[]; meta: Meta; statusCounts: Record<string, number> }> {
  const response = await tenant.client.get<{
    data: OverstockEntry[];
    meta: Meta;
    statusCounts: Record<string, number>;
  }>(`/api/intelligence/overstock${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

function find(items: OverstockEntry[], sku: string): OverstockEntry {
  const entry = items.find((item) => item.sku === sku);
  assert.ok(entry, `no entry for ${sku}`);
  return entry;
}

/** A product selling `units` a day across `days` active days, settled at `stock`. */
async function seedProduct(
  tenant: Tenant,
  sku: string,
  options: { days: number; units: string; stock: string },
): Promise<string> {
  const productId = await createProduct(tenant, { sku });
  await stockInLarge(tenant, productId);
  await seedSalesOnDays(tenant, productId, recentAges(options.days), options.units);
  await adjustStockTo(tenant, productId, options.stock);
  return productId;
}

async function countRows(): Promise<Record<string, number>> {
  const result = await getPool().query<Record<string, number>>(
    `SELECT
       (SELECT count(*) FROM products)::int             AS products,
       (SELECT count(*) FROM categories)::int           AS categories,
       (SELECT count(*) FROM inventory_movements)::int  AS inventory_movements,
       (SELECT count(*) FROM sales)::int                AS sales,
       (SELECT count(*) FROM sale_items)::int           AS sale_items,
       (SELECT count(*) FROM suppliers)::int            AS suppliers,
       (SELECT count(*) FROM purchase_orders)::int      AS purchase_orders,
       (SELECT count(*) FROM purchase_order_items)::int AS purchase_order_items`,
  );
  return result.rows[0] ?? {};
}

// ---------------------------------------------------------------------------

describe('GET /api/intelligence/overstock — integration', () => {
  it('classifies a product carrying far more stock than it sells', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-OVERSTOCK', { days: 30, units: '10', stock: '2400.00' });

    const entry = find((await listOverstock(tenant)).data, 'OS-OVERSTOCK');

    // 2400 units at 10/day is 240 days of cover, well past the 60-day threshold.
    assert.equal(entry.status, 'OVERSTOCK');
    assert.equal(entry.priority, 70);
    assert.equal(entry.currentStock, '2400.00');
    assert.equal(entry.averageDailySales30d, '10.0000');
    assert.equal(entry.unitsSold30d, '300.00');
    assert.equal(entry.activeSalesDays30d, 30);
    assert.equal(entry.analysisWindowDays, 30);
    assert.equal(entry.daysOfStock, '240.00');
    assert.equal(entry.thresholdDays, 60);
    assert.equal(entry.evidence.hasSufficientEvidence, true);
    assert.deepEqual(entry.evidence.unmetEvidenceGates, []);
    assert.match(entry.reason, /at or above the 60-day threshold/);
  });

  it('classifies a product with ordinary cover as NORMAL', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-NORMAL', { days: 30, units: '10', stock: '300.00' });

    const entry = find((await listOverstock(tenant)).data, 'OS-NORMAL');

    assert.equal(entry.daysOfStock, '30.00');
    assert.equal(entry.status, 'NORMAL');
    assert.equal(entry.priority, 0);
    assert.match(entry.reason, /below the 60-day threshold/);
  });

  it('treats exactly 60 days of cover as OVERSTOCK', async () => {
    const tenant = await createTenant(server);
    // 150 units over 30 days is 5/day; 300 on hand is exactly 60 days.
    await seedProduct(tenant, 'OS-EXACT-60', { days: 30, units: '5', stock: '300.00' });

    const entry = find((await listOverstock(tenant)).data, 'OS-EXACT-60');

    assert.equal(entry.averageDailySales30d, '5.0000');
    assert.equal(entry.daysOfStock, '60.00');
    assert.equal(entry.status, 'OVERSTOCK');
  });

  it('treats 59 days of cover as NORMAL', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-59-DAYS', { days: 30, units: '5', stock: '295.00' });

    const entry = find((await listOverstock(tenant)).data, 'OS-59-DAYS');

    assert.equal(entry.daysOfStock, '59.00');
    assert.equal(entry.status, 'NORMAL');
  });

  it('reports INSUFFICIENT_DATA for a product with no sales', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'OS-NOSALES' });
    await stockInLarge(tenant, productId);
    await adjustStockTo(tenant, productId, '5000.00');

    const entry = find((await listOverstock(tenant)).data, 'OS-NOSALES');

    assert.equal(entry.status, 'INSUFFICIENT_DATA');
    assert.equal(entry.priority, 20);
    assert.equal(entry.daysOfStock, null, 'no rate means no ratio, never Infinity');
    assert.equal(entry.unitsSold30d, '0.00');
    assert.equal(entry.evidence.hasSufficientEvidence, false);
    assert.match(entry.reason, /Not enough demand evidence/);
  });

  it('does not call a thinly-traded product overstocked', async () => {
    const tenant = await createTenant(server);
    // 5,000 units against 2 sale days: a spectacular ratio that means nothing.
    const productId = await createProduct(tenant, { sku: 'OS-SPARSE' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, [1, 25], '2');
    await adjustStockTo(tenant, productId, '5000.00');

    const entry = find((await listOverstock(tenant)).data, 'OS-SPARSE');

    assert.equal(entry.status, 'INSUFFICIENT_DATA');
    assert.notEqual(entry.status, 'OVERSTOCK');
    assert.deepEqual(entry.evidence.unmetEvidenceGates, [
      '3 active sales days in 30 days',
      '5.00 units sold in 30 days',
    ]);
  });

  it('reuses the Demand Intelligence confidence rather than inventing one', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-CONFIDENCE', { days: 30, units: '10', stock: '2400.00' });

    const [overstock, demand] = await Promise.all([
      tenant.client.get<{ data: OverstockEntry[] }>('/api/intelligence/overstock?limit=100'),
      tenant.client.get<{ data: Array<{ sku: string; confidence: string }> }>(
        '/api/intelligence/demand?limit=100',
      ),
    ]);

    const overstockEntry = overstock.body.data.find((d) => d.sku === 'OS-CONFIDENCE');
    const demandEntry = demand.body.data.find((d) => d.sku === 'OS-CONFIDENCE');

    assert.ok(overstockEntry);
    assert.ok(demandEntry);
    assert.equal(
      overstockEntry.confidence,
      demandEntry.confidence,
      'the two features must report the same confidence for the same product',
    );
    assert.equal(overstockEntry.averageDailySales30d, '10.0000');
  });

  it('returns an empty result set for a tenant with no products', async () => {
    const tenant = await createTenant(server);

    const body = await listOverstock(tenant);

    assert.deepEqual(body.data, []);
    assert.equal(body.meta.total, 0);
    assert.deepEqual(body.statusCounts, {});
  });

  it('reports status counts for the scoped catalog', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-C-OVER', { days: 30, units: '10', stock: '2400.00' });
    await seedProduct(tenant, 'OS-C-NORMAL', { days: 30, units: '10', stock: '100.00' });

    const body = await listOverstock(tenant);

    assert.equal(body.statusCounts.OVERSTOCK, 1);
    assert.equal(body.statusCounts.NORMAL, 1);
  });
});

describe('GET /api/intelligence/overstock — filters and pagination', () => {
  it('filters by status and confidence', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-F-OVER', { days: 30, units: '10', stock: '2400.00' });
    await seedProduct(tenant, 'OS-F-NORMAL', { days: 30, units: '10', stock: '100.00' });

    const overstock = await listOverstock(tenant, '?status=OVERSTOCK');
    assert.equal(overstock.meta.total, 1);
    assert.equal(overstock.data[0]?.sku, 'OS-F-OVER');

    const normal = await listOverstock(tenant, '?status=NORMAL');
    assert.equal(normal.meta.total, 1);
    assert.equal(normal.data[0]?.sku, 'OS-F-NORMAL');

    const insufficient = await listOverstock(tenant, '?status=INSUFFICIENT_DATA');
    assert.equal(insufficient.meta.total, 0);

    const highConfidence = await listOverstock(tenant, '?confidence=HIGH');
    assert.equal(highConfidence.meta.total, 2, 'dense, well-established demand on both');
  });

  it('filters by search, category and active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>('/api/categories', {
      name: 'OS Tools',
    });

    const hammer = await createProduct(tenant, {
      sku: 'OS-S-HAMMER',
      name: 'Hammer Drill',
      categoryId: category.body.data.id,
    });
    const brush = await createProduct(tenant, { sku: 'OS-S-BRUSH', name: 'Paint Brush' });
    await stockInLarge(tenant, hammer);
    await stockInLarge(tenant, brush);
    await adjustStockTo(tenant, hammer, '2400.00');
    await adjustStockTo(tenant, brush, '100.00');
    await tenant.client.delete(`/api/products/${brush}`);

    assert.equal((await listOverstock(tenant, '?search=hammer')).meta.total, 1);
    assert.equal(
      (await listOverstock(tenant, `?categoryId=${category.body.data.id}`)).meta.total,
      1,
    );
    assert.equal((await listOverstock(tenant, '?isActive=true')).meta.total, 1);
    assert.equal((await listOverstock(tenant, '?isActive=false')).meta.total, 1);
  });

  it('paginates', async () => {
    const tenant = await createTenant(server);
    for (let index = 0; index < 5; index += 1) {
      await createProduct(tenant, { sku: `OS-PAGE-${index}` });
    }

    const page = await listOverstock(tenant, '?page=2&limit=2');

    assert.equal(page.meta.total, 5);
    assert.equal(page.meta.page, 2);
    assert.equal(page.meta.totalPages, 3);
    assert.equal(page.data.length, 2);
  });

  it('returns a valid empty page past the end of the catalog', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'OS-ONE' });

    const page = await listOverstock(tenant, '?page=9&limit=10');

    assert.deepEqual(page.data, []);
    assert.equal(page.meta.total, 1);
    assert.equal(page.meta.page, 9);
  });

  it('rejects an invalid page size, invalid enum values and unknown fields', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/overstock?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/overstock?page=0')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/overstock?status=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/overstock?confidence=NOPE')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/overstock?businessId=other')).status,
      400,
      'the tenant is never client-controlled',
    );
    assert.equal((await tenant.client.get('/api/intelligence/overstock?orderBy=1')).status, 400);
  });

  it('treats a SQL-injection search term as a literal', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'OS-INJECTION', name: 'Injected' });

    const response = await tenant.client.get<{ data: OverstockEntry[] }>(
      `/api/intelligence/overstock?search=${encodeURIComponent("' ; DROP TABLE products --")}`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);

    const tables = await getPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'products'`,
    );
    assert.equal(tables.rows[0]?.count, 1, 'the products table is intact');
  });
});

describe('GET /api/intelligence/overstock/:productId', () => {
  it('returns one product with its explanation and evidence', async () => {
    const tenant = await createTenant(server);
    const productId = await seedProduct(tenant, 'OS-DETAIL', {
      days: 30,
      units: '10',
      stock: '2400.00',
    });

    const response = await tenant.client.get<{ data: OverstockEntry }>(
      `/api/intelligence/overstock/${productId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.productId, productId);
    assert.equal(response.body.data.sku, 'OS-DETAIL');
    assert.equal(response.body.data.status, 'OVERSTOCK');
    assert.equal(response.body.data.priority, 70);
    assert.equal(response.body.data.daysOfStock, '240.00');
    assert.equal(response.body.data.thresholdDays, 60);
    assert.ok(response.body.data.reason.length > 0);
    assert.equal(response.body.data.evidence.thresholdDays, 60);
    assert.equal(response.body.data.evidence.minimumActiveSalesDays30d, 3);
  });

  it('answers 404 for a product that does not exist', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/intelligence/overstock/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/overstock/not-a-uuid')).status, 400);
  });
});

describe('overstock intelligence security', () => {
  it('rejects unauthenticated access to both endpoints', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/overstock')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/intelligence/overstock/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
  });

  it('exposes no write route and triggers no action', async () => {
    const tenant = await createTenant(server);
    const productId = await seedProduct(tenant, 'OS-NOWRITE', {
      days: 30,
      units: '10',
      stock: '2400.00',
    });

    for (const method of ['post', 'patch', 'delete'] as const) {
      const response = await tenant.client[method]('/api/intelligence/overstock', {
        body: { productId },
      });
      assert.equal(response.status, 404, `${method.toUpperCase()} /overstock must not exist`);
    }

    assert.equal((await tenant.client.post(`/api/intelligence/overstock/${productId}`)).status, 404);
  });

  it('never mutates anything, and creates no purchase order', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'OS-READONLY', { days: 30, units: '10', stock: '2400.00' });

    const before = await countRows();
    await listOverstock(tenant);
    await listOverstock(tenant, '?limit=100&status=OVERSTOCK');
    await listOverstock(tenant, '?limit=100&page=2');
    await tenant.client.get('/api/intelligence/overstock?limit=100');

    assert.deepEqual(
      await countRows(),
      before,
      'an overstock assessment must change nothing',
    );
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await seedProduct(tenantA, 'OS-ISO-A', {
      days: 30,
      units: '10',
      stock: '2400.00',
    });

    const listB = await listOverstock(tenantB);
    assert.equal(listB.meta.total, 0);
    assert.deepEqual(listB.data, []);

    const detailB = await tenantB.client.get(`/api/intelligence/overstock/${productA}`);
    assert.equal(detailB.status, 404, 'a cross-tenant product is not found');
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'OS-STAFF' });
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    assert.equal((await staff.get('/api/intelligence/overstock')).status, 200);
  });
});