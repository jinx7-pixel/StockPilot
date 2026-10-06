/**
 * Slow / Dead Stock API — integration tests.
 *
 * Exercises the real HTTP surface against the real database: authentication,
 * tenant isolation, filters, pagination and the shared demand-facts SQL. The
 * classification rules are proven separately in `slowDead.test.ts`.
 *
 * Stock levels a threshold test needs are not reachable by selling alone — the
 * API correctly refuses to oversell — so the balance is settled with a direct
 * movement. The ledger is append-only and a trigger rejects rewrites, so every
 * adjustment is an insert rather than an edit.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface SlowDeadEntry {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  status: string;
  priority: number;
  currentStock: string;
  unitsSold90d: string;
  activeSalesDays90d: number;
  averageDailySales90d: string;
  analysisWindowDays: number;
  confidence: string;
  reason: string;
  evidence: {
    analysisWindowDays: number;
    minimumObservableDays: number;
    slowMaxActiveSalesDays: number;
    holdsInventory: boolean;
    hasSufficientHistory: boolean;
    classificationBasis: string;
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
 * A large opening balance, backdated so the product also has observable history.
 *
 * `historyDays` controls how long the product has existed: the ledger's first
 * movement is what "observable history" means, not the product record.
 */
async function seedOpening(
  tenant: Tenant,
  productId: string,
  historyDays = 200,
  quantity = '100000',
): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, 'in', $3::numeric, 'Opening stock', $4::uuid, now() - ($5 || ' days')::interval)`,
    [tenant.user.businessId, productId, quantity, tenant.user.id, String(historyDays)],
  );
}

/** Settle the ledger balance to an exact figure, by writing a movement. */
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

async function listSlowDead(
  tenant: Tenant,
  query = '',
): Promise<{ data: SlowDeadEntry[]; meta: Meta; statusCounts: Record<string, number> }> {
  const response = await tenant.client.get<{
    data: SlowDeadEntry[];
    meta: Meta;
    statusCounts: Record<string, number>;
  }>(`/api/intelligence/slow-dead${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

function find(items: SlowDeadEntry[], sku: string): SlowDeadEntry {
  const entry = items.find((item) => item.sku === sku);
  assert.ok(entry, `no entry for ${sku}`);
  return entry;
}

/** A product with `activeDays90` consecutive sale days and `units` on each. */
async function seedProduct(
  tenant: Tenant,
  sku: string,
  options: { activeDays90: number; units: string; stock: string; historyDays?: number },
): Promise<string> {
  const productId = await createProduct(tenant, { sku });
  await seedOpening(tenant, productId, options.historyDays ?? 200);
  await seedSalesOnDays(tenant, productId, recentAges(options.activeDays90), options.units);
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

describe('GET /api/intelligence/slow-dead — integration', () => {
  it('classifies inventory with no sales in the window as DEAD', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'SD-DEAD' });
    await seedOpening(tenant, productId, 200);
    await adjustStockTo(tenant, productId, '100');

    const entry = find((await listSlowDead(tenant)).data, 'SD-DEAD');

    assert.equal(entry.status, 'DEAD');
    assert.equal(entry.priority, 80);
    assert.equal(entry.currentStock, '100.00');
    assert.equal(entry.unitsSold90d, '0.00');
    assert.equal(entry.activeSalesDays90d, 0);
    assert.equal(entry.averageDailySales90d, '0.0000');
    assert.equal(entry.analysisWindowDays, 90);
    assert.equal(entry.evidence.holdsInventory, true);
    assert.equal(entry.evidence.hasSufficientHistory, true);
  });

  it('refuses to call a young product DEAD', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'SD-YOUNG' });
    await seedOpening(tenant, productId, 10, '100');
    await adjustStockTo(tenant, productId, '100');

    const entry = find((await listSlowDead(tenant)).data, 'SD-YOUNG');

    assert.equal(entry.status, 'INSUFFICIENT_DATA');
    assert.equal(entry.priority, 20);
    assert.equal(entry.evidence.hasSufficientHistory, false);
    assert.match(entry.reason, /observable for only 10 day\(s\)/);
  });

  it('classifies sales on exactly 10 active days as SLOW', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'SD-SLOW-10', { activeDays90: 10, units: '5', stock: '50' });

    const entry = find((await listSlowDead(tenant)).data, 'SD-SLOW-10');

    assert.equal(entry.status, 'SLOW');
    assert.equal(entry.priority, 50);
    assert.equal(entry.activeSalesDays90d, 10);
    assert.equal(entry.unitsSold90d, '50.00');
    assert.equal(entry.averageDailySales90d, '0.5555', '50 units over 90 days, truncated at 4dp');
  });

  it('classifies sales on exactly 11 active days as NORMAL', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'SD-11-DAYS', { activeDays90: 11, units: '5', stock: '50' });

    const entry = find((await listSlowDead(tenant)).data, 'SD-11-DAYS');

    assert.equal(entry.status, 'NORMAL');
    assert.equal(entry.priority, 0);
    assert.equal(entry.activeSalesDays90d, 11);
  });

  it('never calls a product with nothing held DEAD or SLOW', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'SD-NO-STOCK' });
    await seedOpening(tenant, productId, 200);
    await seedSalesOnDays(tenant, productId, [1, 5, 9], '4');
    await adjustStockTo(tenant, productId, '0');

    const entry = find((await listSlowDead(tenant)).data, 'SD-NO-STOCK');

    assert.equal(entry.currentStock, '0.00');
    assert.equal(entry.status, 'NORMAL');
    assert.notEqual(entry.status, 'DEAD');
    assert.notEqual(entry.status, 'SLOW');
  });

  it('classifies a single active sales day as SLOW', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'SD-ONE-DAY', { activeDays90: 1, units: '12', stock: '100' });

    const entry = find((await listSlowDead(tenant)).data, 'SD-ONE-DAY');

    assert.equal(entry.status, 'SLOW');
    assert.equal(entry.activeSalesDays90d, 1);
    assert.match(entry.evidence.classificationBasis, /sales on 1 active day/);
  });

  it('classifies healthy, regular demand as NORMAL', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'SD-HEALTHY', { activeDays90: 45, units: '10', stock: '500' });

    const entry = find((await listSlowDead(tenant)).data, 'SD-HEALTHY');

    assert.equal(entry.status, 'NORMAL');
    assert.equal(entry.priority, 0);
    assert.match(entry.reason, /Demand is regular/);
  });

  it('reports a corrupt negative balance as a server error, not a classification', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'SD-CORRUPT' });
    // A small opening so the stock-out below genuinely drives the balance
    // negative. The API would refuse to oversell, which is why this is a direct
    // insert: the point is to reach a state only corruption can produce.
    await seedOpening(tenant, productId, 200, '10');
    await seedSalesOnDays(tenant, productId, [1, 2, 3], '1');
    await getPool().query(
      `INSERT INTO inventory_movements
         (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
       VALUES ($1, $2, 'out', 50, 'Fixture stock-out', $3, now())`,
      [tenant.user.businessId, productId, tenant.user.id],
    );

    const balance = await getPool().query<{ balance: string }>(
      `SELECT COALESCE(SUM(CASE movement_type WHEN 'out' THEN -quantity ELSE quantity END), 0)::text
                AS balance
         FROM inventory_movements WHERE business_id = $1 AND product_id = $2`,
      [tenant.user.businessId, productId],
    );
    assert.ok(Number(balance.rows[0]?.balance ?? '0') < 0, 'fixture must actually be negative');

    const response = await tenant.client.get('/api/intelligence/slow-dead');

    assert.equal(response.status, 500, 'corrupt inventory fails loudly');
    const body = response.body as { error?: string } | undefined;
    assert.equal(body?.error, 'Internal Server Error', 'and leaks nothing');
    assert.ok(
      !JSON.stringify(response.body).includes('SD-CORRUPT'),
      'a corrupt row must not be silently reported as normal',
    );
  });

  it('reuses the Demand Intelligence confidence rather than inventing one', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'SD-CONFIDENCE', { activeDays90: 45, units: '10', stock: '500' });

    const [slowDead, demand] = await Promise.all([
      tenant.client.get<{ data: SlowDeadEntry[] }>('/api/intelligence/slow-dead?limit=100'),
      tenant.client.get<{ data: Array<{ sku: string; confidence: string }> }>(
        '/api/intelligence/demand?limit=100',
      ),
    ]);

    const mine = slowDead.body.data.find((d) => d.sku === 'SD-CONFIDENCE');
    const theirs = demand.body.data.find((d) => d.sku === 'SD-CONFIDENCE');

    assert.ok(mine);
    assert.ok(theirs);
    assert.equal(
      mine.confidence,
      theirs.confidence,
      'both features must report the same confidence for the same product',
    );
  });

  it('returns an empty result set for a tenant with no products', async () => {
    const tenant = await createTenant(server);

    const body = await listSlowDead(tenant);

    assert.deepEqual(body.data, []);
    assert.equal(body.meta.total, 0);
    assert.deepEqual(body.statusCounts, {});
  });

  it('reports status counts for the scoped catalog', async () => {
    const tenant = await createTenant(server);
    const dead = await createProduct(tenant, { sku: 'SD-C-DEAD' });
    await seedOpening(tenant, dead, 200);
    await adjustStockTo(tenant, dead, '100');
    await seedProduct(tenant, 'SD-C-SLOW', { activeDays90: 4, units: '5', stock: '50' });
    await seedProduct(tenant, 'SD-C-NORMAL', { activeDays90: 45, units: '10', stock: '500' });

    const body = await listSlowDead(tenant);

    assert.equal(body.statusCounts.DEAD, 1);
    assert.equal(body.statusCounts.SLOW, 1);
    assert.equal(body.statusCounts.NORMAL, 1);
  });
});

describe('GET /api/intelligence/slow-dead — filters and pagination', () => {
  it('filters by status and confidence', async () => {
    const tenant = await createTenant(server);
    const dead = await createProduct(tenant, { sku: 'SD-F-DEAD' });
    await seedOpening(tenant, dead, 200);
    await adjustStockTo(tenant, dead, '100');
    await seedProduct(tenant, 'SD-F-SLOW', { activeDays90: 4, units: '5', stock: '50' });
    await seedProduct(tenant, 'SD-F-NORMAL', { activeDays90: 45, units: '10', stock: '500' });

    const deadOnly = await listSlowDead(tenant, '?status=DEAD');
    assert.equal(deadOnly.meta.total, 1);
    assert.equal(deadOnly.data[0]?.sku, 'SD-F-DEAD');

    const slow = await listSlowDead(tenant, '?status=SLOW');
    assert.equal(slow.meta.total, 1);
    assert.equal(slow.data[0]?.sku, 'SD-F-SLOW');

    assert.equal((await listSlowDead(tenant, '?status=INSUFFICIENT_DATA')).meta.total, 0);

    const highConfidence = await listSlowDead(tenant, '?confidence=HIGH');
    assert.ok(
      highConfidence.data.some((d) => d.sku === 'SD-F-NORMAL'),
      'the well-evidenced product carries high demand confidence',
    );
  });

  it('filters by search, category and active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>('/api/categories', {
      name: 'SD Tools',
    });

    const hammer = await createProduct(tenant, {
      sku: 'SD-S-HAMMER',
      name: 'Hammer Drill',
      categoryId: category.body.data.id,
    });
    const brush = await createProduct(tenant, { sku: 'SD-S-BRUSH', name: 'Paint Brush' });
    for (const id of [hammer, brush]) await seedOpening(tenant, id, 200);
    await adjustStockTo(tenant, hammer, '100');
    await adjustStockTo(tenant, brush, '100');
    await tenant.client.delete(`/api/products/${brush}`);

    assert.equal((await listSlowDead(tenant, '?search=hammer')).meta.total, 1);
    assert.equal(
      (await listSlowDead(tenant, `?categoryId=${category.body.data.id}`)).meta.total,
      1,
    );
    assert.equal((await listSlowDead(tenant, '?isActive=true')).meta.total, 1);
    assert.equal((await listSlowDead(tenant, '?isActive=false')).meta.total, 1);
  });

  it('paginates', async () => {
    const tenant = await createTenant(server);
    for (let index = 0; index < 5; index += 1) {
      await createProduct(tenant, { sku: `SD-PAGE-${index}` });
    }

    const page = await listSlowDead(tenant, '?page=2&limit=2');

    assert.equal(page.meta.total, 5);
    assert.equal(page.meta.page, 2);
    assert.equal(page.meta.totalPages, 3);
    assert.equal(page.data.length, 2);
  });

  it('returns a valid empty page past the end of the catalog', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'SD-ONE' });

    const page = await listSlowDead(tenant, '?page=9&limit=10');

    assert.deepEqual(page.data, []);
    assert.equal(page.meta.total, 1);
    assert.equal(page.meta.page, 9);
  });

  it('rejects invalid enums, invalid pagination and client-supplied tenant or ordering', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/slow-dead?status=NOPE')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/slow-dead?confidence=NOPE')).status,
      400,
    );
    assert.equal((await tenant.client.get('/api/intelligence/slow-dead?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/slow-dead?page=0')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/slow-dead?businessId=other')).status,
      400,
      'the tenant is never client-controlled',
    );
    assert.equal((await tenant.client.get('/api/intelligence/slow-dead?orderBy=1')).status, 400);
  });

  it('treats a SQL-injection search term as a literal', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'SD-INJECTION', name: 'Injected' });

    const response = await tenant.client.get<{ data: SlowDeadEntry[] }>(
      `/api/intelligence/slow-dead?search=${encodeURIComponent("' ; DROP TABLE products --")}`,
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

describe('GET /api/intelligence/slow-dead/:productId', () => {
  it('returns one product with its explanation and evidence', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'SD-DETAIL' });
    await seedOpening(tenant, productId, 200);
    await adjustStockTo(tenant, productId, '100');

    const response = await tenant.client.get<{ data: SlowDeadEntry }>(
      `/api/intelligence/slow-dead/${productId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.productId, productId);
    assert.equal(response.body.data.status, 'DEAD');
    assert.equal(response.body.data.priority, 80);
    assert.equal(response.body.data.analysisWindowDays, 90);
    assert.equal(response.body.data.evidence.minimumObservableDays, 30);
    assert.equal(response.body.data.evidence.slowMaxActiveSalesDays, 10);
    assert.ok(response.body.data.reason.length > 0);
  });

  it('answers 404 for a product that does not exist', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/intelligence/slow-dead/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/slow-dead/not-a-uuid')).status, 400);
  });
});

describe('slow/dead intelligence security', () => {
  it('rejects unauthenticated access to both endpoints', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/slow-dead')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/intelligence/slow-dead/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
  });

  it('exposes no write route and triggers no action', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'SD-NOWRITE' });
    await seedOpening(tenant, productId, 200);
    await adjustStockTo(tenant, productId, '100');

    for (const method of ['post', 'patch', 'delete'] as const) {
      const response = await tenant.client[method]('/api/intelligence/slow-dead', {
        body: { productId },
      });
      assert.equal(response.status, 404, `${method.toUpperCase()} /slow-dead must not exist`);
    }

    assert.equal((await tenant.client.post(`/api/intelligence/slow-dead/${productId}`)).status, 404);
  });

  it('never mutates anything, and creates no purchase order', async () => {
    const tenant = await createTenant(server);
    await seedProduct(tenant, 'SD-READONLY', { activeDays90: 4, units: '5', stock: '50' });

    const before = await countRows();
    await listSlowDead(tenant);
    await listSlowDead(tenant, '?limit=100&status=SLOW');
    await listSlowDead(tenant, '?limit=100&page=2');
    await listSlowDead(tenant, '?confidence=HIGH');

    assert.deepEqual(
      await countRows(),
      before,
      'a slow/dead assessment must change nothing',
    );
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await createProduct(tenantA, { sku: 'SD-ISO-A' });
    await seedOpening(tenantA, productA, 200);
    await adjustStockTo(tenantA, productA, '100');

    const listB = await listSlowDead(tenantB);
    assert.equal(listB.meta.total, 0);
    assert.deepEqual(listB.data, []);

    const detailB = await tenantB.client.get(`/api/intelligence/slow-dead/${productA}`);
    assert.equal(detailB.status, 404, 'a cross-tenant product is not found');
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'SD-STAFF' });
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    assert.equal((await staff.get('/api/intelligence/slow-dead')).status, 200);
  });
});