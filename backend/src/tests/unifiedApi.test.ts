/**
 * Unified Intelligence API — integration tests.
 *
 * The most important test in this file is `unified detail equals the six
 * direct endpoints`: it fetches the same product from all seven routes and
 * compares every field, which is what actually proves the orchestrator
 * recalculates nothing.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface UnifiedItem {
  product: { id: string; sku: string; name: string; category: { id: string; name: string } | null };
  stockRisk: Record<string, unknown>;
  demand: Record<string, unknown>;
  reorder: Record<string, unknown>;
  overstock: Record<string, unknown>;
  slowDead: Record<string, unknown>;
  supplier: Record<string, unknown> | null;
  summary: { attentionRequired: boolean; highestPriority: number; decisionCount: number };
}

/**
 * The wire shape of `GET /api/intelligence/products`.
 *
 * The route answers with the application's standard `{ data }` envelope, exactly
 * like every other list route. Tests type against this and read `body.data.*`,
 * which is what a client does after unwrapping.
 */
interface UnifiedListResponse {
  data: {
    items: UnifiedItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

interface TestTenant extends Tenant {
  productId: string;
  supplierId: string;
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

function recentAges(count: number, startAge = 0) {
  return Array.from({ length: count }, (_, i) => i + startAge);
}

/** A product with dense demand and a well-measured supplier. */
async function seedRichProduct(tenant: Tenant): Promise<TestTenant> {
  const product = await tenant.client.post<{ data: { id: string } }>('/api/products', productBody({ sku: 'UN-RICH' }));
  const productId = product.body.data.id;
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '10');

  const supplier = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', { name: 'Unified Supplier' });
  const supplierId = supplier.body.data.id;
  for (const lead of [5, 6, 5, 7, 6, 5]) await seedOrder(tenant, supplierId, productId, lead);

  return { ...tenant, productId, supplierId } as TestTenant;
}

/** A product with stock but no sales and no supplier at all. */
async function seedBareProduct(tenant: Tenant): Promise<TestTenant> {
  const product = await tenant.client.post<{ data: { id: string } }>('/api/products', productBody({ sku: 'UN-BARE' }));
  const productId = product.body.data.id;
  await seedStock(tenant, productId, '250');
  return { ...tenant, productId, supplierId: '' } as TestTenant;
}

async function unifiedDetail(tenant: Tenant, productId: string) {
  const response = await tenant.client.get<{ data: UnifiedItem }>(
    `/api/intelligence/products/${productId}`,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

/** Compare two engine blocks, ignoring only the documented key-name difference. */
function assertSameEngine(unified: Record<string, unknown>, direct: Record<string, unknown>, label: string) {
  const keys = new Set([...Object.keys(unified), ...Object.keys(direct)]);
  const drift: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(unified[key]) !== JSON.stringify(direct[key])) {
      drift.push(`${key}: ${JSON.stringify(unified[key])} != ${JSON.stringify(direct[key])}`);
    }
  }
  assert.deepEqual(drift, [], `${label} drifted from its direct endpoint`);
}

// ---------------------------------------------------------------------------

describe('Unified Intelligence — detail', () => {
  it('returns all six engines for one product', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const item = await unifiedDetail(tenant, tenant.productId);

    assert.deepEqual(Object.keys(item).sort(), [
      'demand', 'overstock', 'product', 'reorder', 'slowDead', 'stockRisk', 'summary', 'supplier',
    ]);
    assert.equal(item.product.id, tenant.productId);
    assert.equal(item.product.sku, 'UN-RICH');
    assert.ok(item.supplier, 'the supplier block is present');
    assert.equal(item.supplier.supplierName, 'Unified Supplier');
  });

  it('equals the six direct endpoints field for field', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const item = await unifiedDetail(tenant, tenant.productId);

    const [risk, demand, reorder, overstock, slowDead, supplier] = await Promise.all([
      tenant.client.get<{ data: Record<string, unknown> }>(`/api/intelligence/stock-risk/${tenant.productId}`),
      tenant.client.get<{ data: Record<string, unknown> }>(`/api/intelligence/demand/${tenant.productId}`),
      tenant.client.get<{ data: Record<string, unknown> }>(`/api/intelligence/reorder/${tenant.productId}`),
      tenant.client.get<{ data: Record<string, unknown> }>(`/api/intelligence/overstock/${tenant.productId}`),
      tenant.client.get<{ data: Record<string, unknown> }>(`/api/intelligence/slow-dead/${tenant.productId}`),
      tenant.client.get<{ data: Record<string, unknown> }>(`/api/intelligence/suppliers/${tenant.supplierId}`),
    ]);

    assertSameEngine(item.stockRisk, risk.body.data, 'stockRisk');
    assertSameEngine(item.demand, demand.body.data, 'demand');
    assertSameEngine(item.reorder, reorder.body.data, 'reorder');
    assertSameEngine(item.overstock, overstock.body.data, 'overstock');
    assertSameEngine(item.slowDead, slowDead.body.data, 'slowDead');

    // The supplier block additionally carries observations on the direct route;
    // everything else must match exactly.
    const { leadTimeObservations: _observations, ...unifiedSupplier } = item.supplier!;
    const { leadTimeObservations: directObservations, ...directSupplier } = supplier.body.data;
    assert.deepEqual(unifiedSupplier, directSupplier, 'supplier drifted');
    assert.ok(Array.isArray(directObservations));
  });

  it('preserves each engine confidence and 11.7 explanation', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const item = await unifiedDetail(tenant, tenant.productId);

    for (const block of [
      item.stockRisk, item.demand, item.reorder, item.overstock, item.slowDead, item.supplier,
    ] as Array<Record<string, unknown> | null>) {
      assert.ok(block, 'every module must be present');
      const confidence = block!.confidence;
      const explanation = block!.explanation as {
        confidence: string; evidence: unknown[]; limitations: string[]; decision: string;
      };
      assert.ok(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'].includes(confidence as string));
      assert.ok(Array.isArray(explanation.evidence));
      assert.ok(Array.isArray(explanation.limitations));
      assert.equal(explanation.confidence, confidence, 'the envelope mirrors the engine');
    }
  });

  it('generates the summary from the engine decisions', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const item = await unifiedDetail(tenant, tenant.productId);

    assert.deepEqual(Object.keys(item.summary).sort(), [
      'attentionRequired', 'decisionCount', 'highestPriority',
    ]);
    assert.equal(typeof item.summary.attentionRequired, 'boolean');
    assert.equal(item.summary.attentionRequired, item.summary.decisionCount > 0);
    assert.ok(item.summary.highestPriority >= 0);
  });

  it('still answers when there is no supplier at all', async () => {
    const tenant = await seedBareProduct(await createTenant(server));

    const item = await unifiedDetail(tenant, tenant.productId);

    assert.equal(item.supplier, null);
    for (const block of [item.stockRisk, item.demand, item.reorder, item.overstock, item.slowDead]) {
      assert.ok(block, 'a weak module must not remove the others');
    }
  });

  it('returns a product with no sales without failing', async () => {
    const tenant = await seedBareProduct(await createTenant(server));

    const item = await unifiedDetail(tenant, tenant.productId);

    assert.equal(item.demand.trend, 'INSUFFICIENT_DATA');
    assert.equal(item.slowDead.unitsSold90d, '0.00');
    assert.ok(item.summary, 'the summary is still produced');
  });
});

describe('Unified Intelligence — list', () => {
  it('wraps the list in the standard { data } envelope', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const response = await tenant.client.get<Record<string, unknown>>(
      '/api/intelligence/products',
    );

    assert.equal(response.status, 200);

    // The contract this endpoint used to break: `items` and `pagination` sat at
    // the top level, so a client that unwraps `data` received undefined.
    assert.ok('data' in response.body, 'the response must have a top-level `data` key');
    assert.ok(!('items' in response.body), '`items` must not leak to the top level');
    assert.ok(!('pagination' in response.body), '`pagination` must not leak to the top level');

    const payload = response.body.data as {
      items: unknown[];
      pagination: Record<string, number>;
    };
    assert.ok(Array.isArray(payload.items));
    assert.equal(typeof payload.pagination.total, 'number');
    assert.equal(typeof payload.pagination.page, 'number');
    assert.equal(typeof payload.pagination.limit, 'number');
  });

  it('leaves the contents inside data unchanged', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const wrapped = await tenant.client.get<UnifiedListResponse>('/api/intelligence/products');
    const payload = wrapped.body.data;

    // The six engine blocks and the summary must all survive the rewrapping —
    // only the outermost key changed.
    assert.equal(payload.items.length, 1);
    const item = payload.items[0]!;
    assert.ok(item.product && item.stockRisk && item.demand && item.reorder);
    assert.ok(item.overstock && item.slowDead && item.summary);
  });

  it('defaults to a limit of 25', async () => {
    const tenant = await createTenant(server);
    const response = await tenant.client.get<UnifiedListResponse>('/api/intelligence/products');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.pagination.limit, 25);
  });

  it('caps the limit at 25 and rejects anything larger', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/products?limit=25')).status, 200);
    assert.equal((await tenant.client.get('/api/intelligence/products?limit=26')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/products?limit=100')).status, 400);
  });

  it('rejects a limit below 1 and a page below 1', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/products?limit=0')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/products?page=0')).status, 400);
  });

  it('rejects businessId and orderBy', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/products?businessId=x')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/products?orderBy=name')).status, 400);
  });

  it('paginates and reports a real total', async () => {
    const tenant = await createTenant(server);
    for (let i = 0; i < 5; i += 1) {
      await tenant.client.post('/api/products', productBody({ sku: `UN-PAGE-${i}` }));
    }

    const page1 = await tenant.client.get<UnifiedListResponse>(
      '/api/intelligence/products?limit=2&page=1',
    );
    const page3 = await tenant.client.get<UnifiedListResponse>(
      '/api/intelligence/products?limit=2&page=3',
    );

    assert.equal(page1.body.data.pagination.total, 5, 'total is the catalog, not the page');
    assert.equal(page1.body.data.items.length, 2);
    assert.equal(page3.body.data.items.length, 1);
    assert.equal(page3.body.data.pagination.page, 3);
  });

  it('filters by search, category and active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>('/api/categories', { name: 'Unified Tools' });
    await tenant.client.post('/api/products', productBody({ sku: 'UN-HAMMER', name: 'Hammer Drill', categoryId: category.body.data.id }));
    const brush = await tenant.client.post<{ data: { id: string } }>('/api/products', productBody({ sku: 'UN-BRUSH', name: 'Paint Brush' }));
    await tenant.client.delete(`/api/products/${brush.body.data.id}`);

    const bySearch = await tenant.client.get<UnifiedListResponse>('/api/intelligence/products?search=hammer');
    assert.equal(bySearch.body.data.items.length, 1);

    const byCategory = await tenant.client.get<UnifiedListResponse>(
      `/api/intelligence/products?categoryId=${category.body.data.id}`,
    );
    assert.equal(byCategory.body.data.items.length, 1);

    const activeOnly = await tenant.client.get<UnifiedListResponse>('/api/intelligence/products?isActive=true');
    assert.equal(activeOnly.body.data.items.length, 1);

    const inactiveOnly = await tenant.client.get<UnifiedListResponse>('/api/intelligence/products?isActive=false');
    assert.equal(inactiveOnly.body.data.items.length, 1);
  });
});

describe('Unified Intelligence — security and read-only', () => {
  it('requires authentication', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/products')).status, 401);
    assert.equal(
      (await client.get('/api/intelligence/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status,
      401,
    );
  });

  it('exposes no write route', async () => {
    const tenant = await createTenant(server);

    for (const path of ['/api/intelligence/products', '/api/intelligence/products/some-id']) {
      for (const method of ['post', 'patch', 'delete'] as const) {
        assert.equal(
          (await tenant.client[method](path)).status,
          404,
          `${method.toUpperCase()} ${path} must not exist`,
        );
      }
    }
  });

  it('isolates tenants completely', async () => {
    const tenantA = await seedRichProduct(await createTenant(server));
    const tenantB = await createTenant(server);

    const list = await tenantB.client.get<UnifiedListResponse>('/api/intelligence/products?limit=25');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 0);
    assert.ok(!JSON.stringify(list.body).includes(tenantA.productId));

    const detail = await tenantB.client.get(`/api/intelligence/products/${tenantA.productId}`);
    assert.equal(detail.status, 404);
    assert.ok(!JSON.stringify(detail.body).includes(tenantA.productId), 'id must not leak');
  });

  it('answers 404 for a product that does not exist', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/intelligence/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/products/not-a-uuid')).status, 400);
  });

  it('mutates nothing', async () => {
    const tenant = await seedRichProduct(await createTenant(server));

    const count = async () => {
      const r = await getPool().query<Record<string, number>>(
        `SELECT
           (SELECT count(*) FROM products)::int             AS products,
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
    await tenant.client.get('/api/intelligence/products?limit=25');
    await tenant.client.get(`/api/intelligence/products/${tenant.productId}`);
    await tenant.client.get('/api/intelligence/products?limit=25&page=2');

    assert.equal(await count(), before);
  });

  it('is readable by staff', async () => {
    const tenant = await seedBareProduct(await createTenant(server));
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.get('/api/intelligence/products');
    assert.equal(response.status, 200);
  });
});