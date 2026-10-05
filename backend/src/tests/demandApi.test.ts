/**
 * Demand Intelligence API — integration tests.
 *
 * These exercise the real HTTP surface against the real database: authentication,
 * tenant isolation, filters, pagination, and the fact-gathering SQL. The demand
 * *formulas* are proven separately in `demand.test.ts`, which needs no database.
 *
 * Data is created through the API, then backdated with SQL so products have real
 * observable history. Without that, everything is legitimately
 * `INSUFFICIENT_DATA`, because a product stocked a moment ago genuinely has no
 * history — which is the engine behaving correctly, not a fixture gap.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface DemandEntry {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  unitsSold7d: string;
  unitsSold30d: string;
  unitsSold90d: string;
  averageDailySales7d: string;
  averageDailySales30d: string;
  averageDailySales90d: string;
  activeSalesDays7d: number;
  activeSalesDays30d: number;
  activeSalesDays90d: number;
  trend: string;
  trendChangePercent: string | null;
  variability: string;
  coefficientOfVariation: string | null;
  confidence: string;
  reason: string;
  evidence: {
    salesWindowDays: number;
    activeSalesDays: string;
    totalUnitsSold: string;
    demandObservationDays: number;
    consistencyRatio: string;
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

/**
 * Give the product real observable history.
 *
 * INSERT rather than UPDATE: `inventory_movements` is append-only and a BEFORE
 * UPDATE trigger rejects any rewrite. A correctly dated insert is allowed, which
 * is exactly what a real historical import would do.
 */
async function openStockHistorically(
  tenant: Tenant,
  productId: string,
  quantity: string,
  daysAgo = 200,
): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     SELECT $1, $2, 'in', $3::numeric, 'Opening stock', $4::uuid,
            now() - ($5 || ' days')::interval`,
    [tenant.user.businessId, productId, quantity, tenant.user.id, daysAgo],
  );
}

async function listDemand(
  tenant: Tenant,
  query = '',
): Promise<{ data: DemandEntry[]; meta: Meta; trendCounts: Record<string, number> }> {
  const response = await tenant.client.get<{
    data: DemandEntry[];
    meta: Meta;
    trendCounts: Record<string, number>;
  }>(`/api/intelligence/demand${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

function find(items: DemandEntry[], sku: string): DemandEntry {
  const entry = items.find((item) => item.sku === sku);
  assert.ok(entry, `no entry for ${sku}`);
  return entry;
}

/**
 * Create one sale per day at the given ages, so the engine sees a realistic
 * daily series rather than one lump on a single day.
 */
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

/** `count` consecutive days ending today, as ages. */
function recentAges(count: number, startAge = 0): number[] {
  return Array.from({ length: count }, (_, index) => startAge + index);
}

/** A product with a long history and `count` consecutive daily sales of `units`. */
async function seedDailyDemand(
  tenant: Tenant,
  sku: string,
  options: { count: number; units: string; startAge?: number; opening?: string },
): Promise<string> {
  const productId = await createProduct(tenant, { sku });
  await openStockHistorically(tenant, productId, options.opening ?? '100000');
  await seedSalesOnDays(tenant, productId, recentAges(options.count, options.startAge ?? 0), options.units);
  return productId;
}

/** Snapshot every table the feature must never touch. */
async function countRows(): Promise<Record<string, number>> {
  const result = await getPool().query<Record<string, number>>(
    `SELECT
       (SELECT count(*) FROM products)::int            AS products,
       (SELECT count(*) FROM sales)::int               AS sales,
       (SELECT count(*) FROM sale_items)::int          AS sale_items,
       (SELECT count(*) FROM inventory_movements)::int AS movements,
       (SELECT count(*) FROM purchase_orders)::int     AS purchase_orders`,
  );
  return result.rows[0] ?? {};
}

// ---------------------------------------------------------------------------

describe('GET /api/intelligence/demand — integration', () => {
  it('lists products that have never sold, without inventing demand', async () => {
    const tenant = await createTenant(server);
    const quiet = await createProduct(tenant, { sku: 'DM-QUIET', name: 'Quiet' });
    await openStockHistorically(tenant, quiet, '50');

    const body = await listDemand(tenant);
    const entry = find(body.data, 'DM-QUIET');

    assert.equal(body.meta.total, 1);
    assert.equal(entry.unitsSold7d, '0.00');
    assert.equal(entry.unitsSold30d, '0.00');
    assert.equal(entry.unitsSold90d, '0.00');
    assert.equal(entry.averageDailySales90d, '0.0000', 'never NaN');
    assert.equal(entry.activeSalesDays90d, 0);
    assert.equal(entry.trend, 'INSUFFICIENT_DATA');
    assert.equal(entry.variability, 'INSUFFICIENT_DATA');
    assert.equal(entry.coefficientOfVariation, null);
    assert.equal(entry.confidence, 'INSUFFICIENT');
    assert.equal(
      entry.reason,
      'No sales were recorded in the 90-day window, so demand behavior cannot be assessed.',
    );
  });

  it('returns an empty result set for a tenant with no products', async () => {
    const tenant = await createTenant(server);

    const body = await listDemand(tenant);

    assert.deepEqual(body.data, []);
    assert.equal(body.meta.total, 0);
    assert.equal(body.meta.totalPages, 1);
    assert.deepEqual(body.trendCounts, {});
  });

  it('derives velocity from real sales inside each window', async () => {
    const tenant = await createTenant(server);
    await seedDailyDemand(tenant, 'DM-VELOCITY', { count: 30, units: '10' });

    const entry = find((await listDemand(tenant)).data, 'DM-VELOCITY');

    assert.equal(entry.unitsSold7d, '70.00', '7 days of 10 units');
    assert.equal(entry.unitsSold30d, '300.00');
    assert.equal(entry.unitsSold90d, '300.00', 'only 30 days of sales exist');
    assert.equal(entry.averageDailySales7d, '10.0000');
    assert.equal(entry.averageDailySales30d, '10.0000');
    assert.equal(entry.averageDailySales90d, '3.3333', '300 spread across the 90-day window');
    assert.equal(entry.activeSalesDays7d, 7);
    assert.equal(entry.activeSalesDays30d, 30);
    assert.equal(entry.activeSalesDays90d, 30);
    assert.equal(entry.trend, 'STABLE');
  });

  it('separates recent demand from a slower baseline', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'DM-RISING' });
    await openStockHistorically(tenant, productId, '100000');
    // 7 recent days at 20, then 23 days at 10.
    await seedSalesOnDays(tenant, productId, recentAges(7), '20');
    await seedSalesOnDays(tenant, productId, recentAges(23, 7), '10');

    const entry = find((await listDemand(tenant)).data, 'DM-RISING');

    assert.equal(entry.averageDailySales7d, '20.0000');
    assert.equal(entry.averageDailySales30d, '12.3333');
    assert.equal(entry.trend, 'INCREASING');
    assert.equal(entry.trendChangePercent, '62.16');
    assert.match(entry.reason, /above the 30-day baseline\./);
  });

  it('reports a fall in demand', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'DM-FALLING' });
    await openStockHistorically(tenant, productId, '100000');
    await seedSalesOnDays(tenant, productId, recentAges(7), '10');
    await seedSalesOnDays(tenant, productId, recentAges(23, 7), '20');

    const entry = find((await listDemand(tenant)).data, 'DM-FALLING');

    assert.equal(entry.trend, 'DECREASING');
    assert.equal(entry.trendChangePercent, '-43.39');
  });

  it('does not treat a long but empty calendar as strong evidence', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'DM-SPARSE' });
    await openStockHistorically(tenant, productId, '100000');
    // Two sale days in a ninety-day window.
    await seedSalesOnDays(tenant, productId, [2, 60], '40');

    const entry = find((await listDemand(tenant)).data, 'DM-SPARSE');

    assert.equal(entry.evidence.salesWindowDays, 90);
    assert.equal(entry.evidence.demandObservationDays, 2);
    assert.equal(entry.evidence.hasSufficientEvidence, true, 'two days is minimal evidence');
    assert.notEqual(entry.confidence, 'HIGH', 'calendar length alone is not confidence');
    assert.notEqual(entry.variability, 'LOW_VARIABILITY');
    assert.equal(entry.variability, 'INSUFFICIENT_DATA');
  });

  it('reports evidence and never a non-finite number', async () => {
    const tenant = await createTenant(server);
    await seedDailyDemand(tenant, 'DM-EVIDENCE', { count: 90, units: '4' });

    const entry = find((await listDemand(tenant)).data, 'DM-EVIDENCE');

    assert.equal(entry.evidence.salesWindowDays, 90);
    assert.equal(entry.evidence.activeSalesDays, '30');
    assert.equal(entry.evidence.totalUnitsSold, '360.00');
    assert.equal(entry.evidence.demandObservationDays, 90);
    assert.equal(entry.evidence.consistencyRatio, '1.0000');
    assert.equal(entry.evidence.hasSufficientEvidence, true);
    assert.equal(entry.confidence, 'HIGH');
    assert.equal(entry.variability, 'LOW_VARIABILITY', 'a flat daily series is steady');

    for (const value of Object.values(entry)) {
      if (typeof value === 'number') {
        assert.ok(Number.isFinite(value), `numeric field must be finite: ${String(value)}`);
      }
    }
  });

  it('handles large quantities and keeps exact decimals', async () => {
    const tenant = await createTenant(server);
    // 90 days at 99,999.99 needs an opening balance that can actually cover it.
    await seedDailyDemand(tenant, 'DM-LARGE', {
      count: 90,
      units: '99999.99',
      opening: '10000000',
    });

    const entry = find((await listDemand(tenant)).data, 'DM-LARGE');

    assert.equal(entry.unitsSold90d, '8999999.10');
    assert.equal(entry.unitsSold7d, '699999.93');
    assert.equal(entry.averageDailySales7d, '99999.9900');
  });

  it('marks an inactive product but does not hide it', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'DM-INACTIVE', name: 'Retired' });
    await openStockHistorically(tenant, productId, '100000');
    await seedSalesOnDays(tenant, productId, recentAges(20), '5');
    await tenant.client.delete(`/api/products/${productId}`);

    const entry = find((await listDemand(tenant)).data, 'DM-INACTIVE');

    assert.equal(entry.isActive, false);
    assert.equal(entry.activeSalesDays30d, 20, 'history is still reported for a retired product');
  });

  it('never mutates anything, and creates no purchase order', async () => {
    const tenant = await createTenant(server);
    await seedDailyDemand(tenant, 'DM-READONLY', { count: 10, units: '3' });

    const before = await countRows();
    await listDemand(tenant);
    await listDemand(tenant, '?limit=100');
    await tenant.client.get(
      `/api/intelligence/demand/${find((await listDemand(tenant)).data, 'DM-READONLY').productId}`,
    );

    assert.deepEqual(await countRows(), before, 'a demand assessment changes nothing');
  });
});

describe('GET /api/intelligence/demand — filters and pagination', () => {
  it('paginates', async () => {
    const tenant = await createTenant(server);
    for (let index = 0; index < 5; index += 1) {
      await createProduct(tenant, { sku: `DM-PAGE-${index}`, name: `Paged ${index}` });
    }

    const page = await listDemand(tenant, '?page=2&limit=2');

    assert.equal(page.meta.total, 5);
    assert.equal(page.meta.page, 2);
    assert.equal(page.meta.totalPages, 3);
    assert.equal(page.data.length, 2);
  });

  it('returns a valid empty page past the end of the catalog', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'DM-ONE' });

    const page = await listDemand(tenant, '?page=9&limit=10');

    assert.deepEqual(page.data, []);
    assert.equal(page.meta.total, 1);
    assert.equal(page.meta.page, 9);
  });

  it('filters by search, category and active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>('/api/categories', {
      name: 'DM Tools',
    });
    await createProduct(tenant, {
      sku: 'DM-A',
      name: 'Alpha',
      categoryId: category.body.data.id,
    });
    await createProduct(tenant, { sku: 'DM-B', name: 'Beta' });

    assert.equal((await listDemand(tenant, '?search=alpha')).meta.total, 1);
    assert.equal(
      (await listDemand(tenant, `?categoryId=${category.body.data.id}`)).meta.total,
      1,
    );
    assert.equal((await listDemand(tenant, '?isActive=true')).meta.total, 2);
    assert.equal((await listDemand(tenant, '?isActive=false')).meta.total, 0);
  });

  it('filters by trend, variability and confidence, and reports counts', async () => {
    const tenant = await createTenant(server);
    const rising = await createProduct(tenant, { sku: 'DM-F-RISING' });
    const steady = await createProduct(tenant, { sku: 'DM-F-STeadY'.toUpperCase() });
    await openStockHistorically(tenant, rising, '100000');
    await openStockHistorically(tenant, steady, '100000');
    await seedSalesOnDays(tenant, rising, recentAges(7), '20');
    await seedSalesOnDays(tenant, rising, recentAges(23, 7), '10');
    // 75 equally-sized days in a 90-day window is a coefficient of about 0.45,
    // which is inside the low-variability bound.
    await seedSalesOnDays(tenant, steady, recentAges(75), '5');

    const all = await listDemand(tenant);
    assert.equal(all.trendCounts.INCREASING, 1);
    assert.equal(all.trendCounts.STABLE, 1);

    const increasing = await listDemand(tenant, '?trend=INCREASING');
    assert.equal(increasing.meta.total, 1);
    assert.equal(increasing.data[0]?.sku, 'DM-F-RISING');

    const lowVariability = await listDemand(tenant, '?variability=LOW_VARIABILITY');
    assert.equal(lowVariability.meta.total, 1);
    assert.equal(lowVariability.data[0]?.sku, 'DM-F-STeadY'.toUpperCase());

    // Confidence describes the evidence, not the direction of demand, so a
    // product whose demand is rising is just as well evidenced as a steady one.
    const highConfidence = await listDemand(tenant, '?confidence=HIGH');
    assert.equal(highConfidence.meta.total, 2);
    assert.deepEqual(
      highConfidence.data.map((entry) => entry.sku).sort(),
      ['DM-F-RISING', 'DM-F-STeadY'.toUpperCase()].sort(),
    );
  });

  it('rejects an invalid page size, invalid enum values and unknown fields', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/demand?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/demand?page=0')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/demand?trend=NOPE')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/demand?variability=NOPE')).status,
      400,
    );
    assert.equal(
      (await tenant.client.get('/api/intelligence/demand?confidence=NOPE')).status,
      400,
    );
    assert.equal(
      (await tenant.client.get('/api/intelligence/demand?businessId=other')).status,
      400,
      'the tenant is never client-controlled',
    );
    assert.equal((await tenant.client.get('/api/intelligence/demand?orderBy=1')).status, 400);
  });

  it('treats a SQL-injection search term as a literal', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'DM-INJECTION', name: 'Injected' });

    const response = await tenant.client.get<{ data: DemandEntry[]; meta: Meta }>(
      `/api/intelligence/demand?search=${encodeURIComponent("' ; DROP TABLE products --")}`,
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

describe('GET /api/intelligence/demand/:productId', () => {
  it('returns one product with its evidence and explanation', async () => {
    const tenant = await createTenant(server);
    const productId = await seedDailyDemand(tenant, 'DM-DETAIL', { count: 90, units: '4' });

    const response = await tenant.client.get<{ data: DemandEntry }>(
      `/api/intelligence/demand/${productId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.productId, productId);
    assert.equal(response.body.data.sku, 'DM-DETAIL');
    assert.equal(response.body.data.unitsSold90d, '360.00');
    assert.equal(response.body.data.trend, 'STABLE');
    assert.equal(response.body.data.confidence, 'HIGH');
    assert.equal(
      response.body.data.reason,
      'Recent demand is broadly consistent with the 30-day baseline.',
    );
  });

  it('answers 404 for a product that does not exist', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/intelligence/demand/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal(
      (await tenant.client.get('/api/intelligence/demand/not-a-uuid')).status,
      400,
    );
  });
});

describe('demand intelligence security', () => {
  it('rejects unauthenticated access to both endpoints', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/demand')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/intelligence/demand/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
  });

  it('exposes no write route', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'DM-NOWRITE' });

    for (const method of ['post', 'patch', 'delete'] as const) {
      const response = await tenant.client[method]('/api/intelligence/demand', {
        body: { productId },
      });
      assert.equal(response.status, 404, `${method.toUpperCase()} /demand must not exist`);
    }

    assert.equal(
      (await tenant.client.post(`/api/intelligence/demand/${productId}`)).status,
      404,
    );
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await createProduct(tenantA, { sku: 'DM-ISO-A', name: 'A product' });
    await openStockHistorically(tenantA, productA, '500');
    await seedSalesOnDays(tenantA, productA, recentAges(30), '4');

    // B cannot see A's product at all.
    const listB = await listDemand(tenantB);
    assert.equal(listB.meta.total, 0);
    assert.deepEqual(listB.data, []);

    const detailB = await tenantB.client.get(`/api/intelligence/demand/${productA}`);
    assert.equal(detailB.status, 404, 'a cross-tenant product is not found');
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'DM-STAFF' });
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.get('/api/intelligence/demand');

    assert.equal(response.status, 200);
  });
});
