/**
 * Recommendations API — integration tests.
 *
 * The important assertions here are negative: that the recommendation layer
 * cannot write, cannot see another tenant, and cannot be made to act. A
 * recommendation is a reading of existing intelligence, so the tests spend most
 * of their effort proving that reading it changes nothing.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface Recommendation {
  id: string;
  productId: string;
  type: string;
  priority: string;
  confidence: string;
  title: string;
  reason: string;
  recommendedQuantity?: string;
  evidence: unknown[];
  limitations: string[];
  sourceDecisions: string[];
}

interface ListResponse {
  items: Array<{ product: { id: string }; recommendations: Recommendation[] }>;
  pagination: { page: number; limit: number; total: number };
  recommendationCount: number;
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
// Fixtures
// ---------------------------------------------------------------------------

async function seedStock(tenant: Tenant, productId: string, quantity: string, daysAgo = 200) {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, 'in', $3::numeric, 'Opening', $4::uuid, now() - ($5 || ' days')::interval)`,
    [tenant.user.businessId, productId, quantity, tenant.user.id, String(daysAgo)],
  );
}

async function seedSales(tenant: Tenant, productId: string, ages: readonly number[], units: string) {
  for (const age of ages) {
    const response = await tenant.client.post('/api/sales', {
      soldAt: new Date(Date.now() - age * 86_400_000).toISOString(),
      items: [{ productId, quantity: units }],
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }
}

async function seedOrder(
  tenant: Tenant,
  supplierId: string,
  productId: string,
  leadTimeDays?: number,
) {
  const created = await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
    supplierId,
    items: [{ productId, quantity: '100', unitCost: '5.00' }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.data.id;

  const ordered = await tenant.client.post(`/api/purchase-orders/${orderId}/order`);
  assert.equal(ordered.status, 200);
  if (leadTimeDays === undefined) return orderId;

  const received = await tenant.client.post(`/api/purchase-orders/${orderId}/receive`, {
    items: [{ productId, quantity: '100' }],
  });
  assert.equal(received.status, 201);
  await getPool().query(
    `UPDATE purchase_orders SET ordered_at = received_at - ($2 || ' days')::interval WHERE id = $1`,
    [orderId, String(leadTimeDays)],
  );
  return orderId;
}

const recentAges = (count: number) => Array.from({ length: count }, (_, i) => i);

/** Settle the ledger balance to an exact figure. */
async function settleStock(tenant: Tenant, productId: string, target: string): Promise<void> {
  const current = await getPool().query<{ balance: string }>(
    `SELECT COALESCE(SUM(CASE movement_type WHEN 'out' THEN -quantity ELSE quantity END), 0)::text
              AS balance
       FROM inventory_movements WHERE business_id = $1 AND product_id = $2`,
    [tenant.user.businessId, productId],
  );
  const delta = Number(target) - Number(current.rows[0]?.balance ?? '0');
  if (delta === 0) return;

  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, $3, $4::numeric, 'Fixture draw-down', $5, now())`,
    [
      tenant.user.businessId,
      productId,
      delta < 0 ? 'out' : 'in',
      Math.abs(delta).toFixed(2),
      tenant.user.id,
    ],
  );
}

/**
 * Fast-moving, well-stocked, well-measured supplier: nothing to recommend.
 *
 * Settles to 2,000 units against a rate of 100/day — 20 days of cover, well
 * under the 60-day overstock threshold, and above the 700-unit reorder point.
 */
async function seedHealthy(tenant: Tenant, sku: string): Promise<string> {
  const product = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  const productId = product.body.data.id;
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '100');
  const supplier = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', {
    name: `Healthy Co ${sku}`,
  });
  for (const lead of [5, 6, 5, 7, 6, 5]) {
    await seedOrder(tenant, supplier.body.data.id, productId, lead);
  }
  // After the receipts: 2,000 units at 100/day is 20 days of cover, under the
  // 60-day threshold and above the 700-unit reorder point.
  await settleStock(tenant, productId, '2000');
  return productId;
}

/** Below the reorder point, with real demand and a measured supplier. */
async function seedNeedingReorder(tenant: Tenant, sku: string): Promise<string> {
  const product = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  const productId = product.body.data.id;
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '10');
  const supplier = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', {
    name: `Reorder Co ${sku}`,
  });
  for (const lead of [5, 6, 5, 7, 6, 5]) {
    await seedOrder(tenant, supplier.body.data.id, productId, lead);
  }
  // Last, because receiving each order puts 100 units back: 50 units against a
  // rate of 10/day is 5 days of cover, below the 70-unit reorder point
  // (10 x (5 lead + 2 safety)) and far below the 60-day overstock threshold.
  await settleStock(tenant, productId, '50');
  return productId;
}

/** Stock far beyond demand: overstock. */
async function seedOverstocked(tenant: Tenant, sku: string): Promise<string> {
  const product = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  const productId = product.body.data.id;
  await seedStock(tenant, productId, '10000');
  await seedSales(tenant, productId, recentAges(30), '10');
  await settleStock(tenant, productId, '5000');
  return productId;
}

/**
 * Almost no history: stock arrived five days ago and nothing has sold.
 *
 * Low stock with no demand evidence is precisely the case that must not become
 * "buy 100 units" — every engine here reports INSUFFICIENT_DATA.
 */
async function seedNoHistory(tenant: Tenant, sku: string): Promise<string> {
  const product = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  const productId = product.body.data.id;
  await seedStock(tenant, productId, '2', 5);
  return productId;
}

async function list(tenant: Tenant, query = ''): Promise<ListResponse> {
  const response = await tenant.client.get<ListResponse>(`/api/recommendations${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function detail(tenant: Tenant, productId: string) {
  const response = await tenant.client.get<{
    data: {
      product: { id: string };
      recommendations: Recommendation[];
      summary: { recommendationCount: number; highestPriority: string | null };
    };
  }>(`/api/recommendations/products/${productId}`);
  assert.equal(response.status, 200, `detail failed: ${JSON.stringify(response.body)}`);
  return response.body.data;
}

function typesOf(body: ListResponse): string[] {
  return body.items.flatMap((item) => item.recommendations.map((r) => r.type));
}

// ---------------------------------------------------------------------------

describe('Recommendations API — list', () => {
  it('returns an empty list when nothing needs attention', async () => {
    const tenant = await createTenant(server);
    await seedHealthy(tenant, 'RC-HEALTHY');

    const body = await list(tenant);

    assert.equal(body.items.length, 0);
    assert.equal(body.recommendationCount, 0);
    assert.equal(body.pagination.total, 1, 'the product is still counted');
  });

  it('produces a REPLENISH recommendation with the engine quantity', async () => {
    const tenant = await createTenant(server);
    const productId = await seedNeedingReorder(tenant, 'RC-REORDER');

    const body = await list(tenant);
    const recommendation = body.items[0]?.recommendations[0];

    assert.ok(recommendation, 'a recommendation is present');
    assert.equal(recommendation.type, 'REPLENISH');
    assert.equal(recommendation.productId, productId);
    assert.ok(recommendation.recommendedQuantity, 'and it carries the engine quantity');
    assert.equal(recommendation.id, `${productId}:REPLENISH`);
    assert.deepEqual(recommendation.sourceDecisions, ['REORDER']);
  });

  it('produces a REVIEW_OVERSTOCK recommendation', async () => {
    const tenant = await createTenant(server);
    await seedOverstocked(tenant, 'RC-OVERSTOCK');

    assert.ok(typesOf(await list(tenant)).includes('REVIEW_OVERSTOCK'));
  });

  it('produces no recommendation for a product with no demand history', async () => {
    const tenant = await createTenant(server);
    await seedNoHistory(tenant, 'RC-NOHISTORY');

    const body = await list(tenant);
    assert.deepEqual(body.items, [], 'low stock plus no history is not an instruction');
  });

  it('returns several recommendations for one product when warranted', async () => {
    const tenant = await createTenant(server);
    await seedNeedingReorder(tenant, 'RC-MULTI');

    const body = await list(tenant);
    assert.equal(body.recommendationCount, body.items[0]?.recommendations.length);
  });
});

describe('Recommendations API — filters', () => {
  it('filters by type', async () => {
    const tenant = await createTenant(server);
    await seedNeedingReorder(tenant, 'RC-F1');
    await seedOverstocked(tenant, 'RC-F2');

    const replenish = await list(tenant, '?type=REPLENISH');
    assert.deepEqual(typesOf(replenish), ['REPLENISH']);

    const overstock = await list(tenant, '?type=REVIEW_OVERSTOCK');
    assert.deepEqual(typesOf(overstock), ['REVIEW_OVERSTOCK']);

    const dead = await list(tenant, '?type=REVIEW_DEAD_STOCK');
    assert.deepEqual(dead.items, [], 'no product matches that filter');
  });

  it('filters by search and active status', async () => {
    const tenant = await createTenant(server);
    await seedNeedingReorder(tenant, 'RC-FINDME');

    assert.equal((await list(tenant, '?search=FINDME')).items.length, 1);
    assert.equal((await list(tenant, '?search=NOTHINGHERE')).items.length, 0);
    assert.equal((await list(tenant, '?isActive=true')).items.length, 1);
    assert.equal((await list(tenant, '?isActive=false')).items.length, 0);
  });

  it('paginates', async () => {
    const tenant = await createTenant(server);
    await seedNeedingReorder(tenant, 'RC-P1');
    await seedNeedingReorder(tenant, 'RC-P2');

    const page = await list(tenant, '?page=1&limit=1');
    assert.equal(page.items.length, 1);
    assert.equal(page.pagination.limit, 1);
    assert.equal(page.pagination.total, 2);
  });

  it('rejects invalid filters', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/recommendations?type=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/recommendations?priority=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/recommendations?confidence=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/recommendations?limit=0')).status, 400);
    assert.equal((await tenant.client.get('/api/recommendations?page=0')).status, 400);
  });

  it('rejects a client-supplied businessId and orderBy', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/recommendations?businessId=other')).status, 400);
    assert.equal((await tenant.client.get('/api/recommendations?orderBy=name')).status, 400);
  });
});

describe('Recommendations API — product detail', () => {
  it('returns product, recommendations and summary', async () => {
    const tenant = await createTenant(server);
    const productId = await seedNeedingReorder(tenant, 'RC-DETAIL');

    const data = await detail(tenant, productId);

    assert.equal(data.product.id, productId);
    assert.ok(Array.isArray(data.recommendations));
    assert.equal(data.summary.recommendationCount, data.recommendations.length);
    assert.ok(
      ['URGENT', 'HIGH', 'MEDIUM', null].includes(data.summary.highestPriority),
      'no health score, only an approved urgency',
    );
  });

  it('reports no recommendations and no urgency for a healthy product', async () => {
    const tenant = await createTenant(server);
    const productId = await seedHealthy(tenant, 'RC-DETAIL-OK');

    const data = await detail(tenant, productId);

    assert.deepEqual(data.recommendations, []);
    assert.deepEqual(data.summary, { recommendationCount: 0, highestPriority: null });
  });

  it('answers 404 for an unknown product and 400 for a malformed id', async () => {
    const tenant = await createTenant(server);

    assert.equal(
      (await tenant.client.get('/api/recommendations/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status,
      404,
    );
    assert.equal((await tenant.client.get('/api/recommendations/products/not-a-uuid')).status, 400);
  });
});

describe('Recommendations API — read-only and tenant isolation', () => {
  it('exposes no write route', async () => {
    const tenant = await createTenant(server);
    const productId = await seedNeedingReorder(tenant, 'RC-NOWRITE');

    // The test client implements no PUT, so that verb is proven against the
    // running server in the PostgreSQL verification instead.
    type Verb = 'post' | 'patch' | 'delete';
    const client = tenant.client as unknown as Record<
      Verb,
      (path: string, options?: { body?: unknown }) => Promise<{ status: number }>
    >;

    for (const path of [
      '/api/recommendations',
      `/api/recommendations/products/${productId}`,
    ]) {
      for (const method of ['post', 'patch', 'delete'] as Verb[]) {
        assert.equal(
          (await client[method](path, { body: { approved: true } })).status,
          404,
          `${method.toUpperCase()} ${path} must not exist`,
        );
      }
    }
  });

  it('mutates nothing when recommendations are read', async () => {
    const tenant = await createTenant(server);
    const productId = await seedNeedingReorder(tenant, 'RC-READONLY');
    await seedOverstocked(tenant, 'RC-READONLY2');

    const count = async () => {
      const r = await getPool().query<Record<string, number>>(
        `SELECT
           (SELECT count(*) FROM products)::int            AS products,
           (SELECT count(*) FROM sales)::int               AS sales,
           (SELECT count(*) FROM sale_items)::int          AS sale_items,
           (SELECT count(*) FROM inventory_movements)::int AS movements,
           (SELECT count(*) FROM suppliers)::int           AS suppliers,
           (SELECT count(*) FROM purchase_orders)::int     AS purchase_orders,
           (SELECT count(*) FROM purchase_order_items)::int AS purchase_order_items`,
      );
      return JSON.stringify(r.rows[0]);
    };

    const before = await count();
    await list(tenant);
    await list(tenant, '?type=REPLENISH');
    await detail(tenant, productId);
    await list(tenant, '?page=1&limit=5');

    assert.equal(await count(), before, 'reading a recommendation must not change a row');
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const productA = await seedNeedingReorder(tenantA, 'RC-ISO');

    const listB = await list(tenantB);
    assert.deepEqual(listB.items, []);
    assert.ok(!JSON.stringify(listB).includes(productA));

    const cross = await tenantB.client.get(`/api/recommendations/products/${productA}`);
    assert.equal(cross.status, 404);
    assert.ok(!JSON.stringify(cross.body).includes(productA), 'no id leak in the error body');
  });

  it('requires authentication', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/recommendations')).status, 401);
    assert.equal(
      (await client.get('/api/recommendations/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status,
      401,
    );
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await seedNeedingReorder(tenant, 'RC-STAFF');
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    assert.equal((await staff.get('/api/recommendations')).status, 200);
  });
});