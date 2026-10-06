/**
 * Reorder Engine API — integration tests.
 *
 * Exercises the real HTTP surface against the real database: authentication,
 * tenant isolation, purchase-order states, filters, pagination, and the
 * fact-gathering SQL. The reorder *formulas* are proven separately in
 * `reorder.test.ts`, which needs no database.
 *
 * Purchase orders are created through the API and only their timestamps are
 * backdated with SQL, because the API deliberately refuses to accept timestamps
 * from a client. Inventory movements are inserted rather than updated: the
 * ledger is append-only and a trigger rejects any rewrite.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface ReorderEntry {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  currentStock: string;
  onOrderQuantity: string;
  netAvailable: string;
  safetyStock: string | null;
  reorderPoint: string | null;
  recommendedQuantity: string | null;
  reorder: boolean;
  decision: string;
  effectiveLeadTimeDays: string | null;
  safetyStockDays: number;
  confidence: string;
  reason: string;
  evidence: {
    netAvailable: string;
    onOrderQuantity: string;
    leadTimeSamples: number;
    leadTimeSpreadDays: string | null;
    hasLeadTimeEvidence: boolean;
    leadTimeUnreliable: boolean;
    unitsSold30d: string;
    activeSalesDays30d: number;
    safetyStockDays: number;
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

async function createSupplier(tenant: Tenant): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', {
    name: `RO Supplier ${Math.random().toString(36).slice(2, 8)}`,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createDraftOrder(
  tenant: Tenant,
  productId: string,
  quantity: string,
): Promise<string> {
  const supplierId = await createSupplier(tenant);
  const response = await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
    supplierId,
    items: [{ productId, quantity, unitCost: '6.00' }],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/** A draft left in draft: not a commitment, so it must not count as on order. */
async function seedDraftOrder(tenant: Tenant, productId: string, quantity: string) {
  return createDraftOrder(tenant, productId, quantity);
}

/** An order placed with the supplier and awaiting delivery. */
async function seedOrderedOrder(tenant: Tenant, productId: string, quantity: string) {
  const orderId = await createDraftOrder(tenant, productId, quantity);
  const response = await tenant.client.post(`/api/purchase-orders/${orderId}/order`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return orderId;
}

/** Part delivered, part still outstanding. */
async function seedPartiallyReceivedOrder(
  tenant: Tenant,
  productId: string,
  ordered: string,
  received: string,
) {
  const orderId = await createDraftOrder(tenant, productId, ordered);
  const order = await tenant.client.post(`/api/purchase-orders/${orderId}/order`);
  assert.equal(order.status, 200);
  const done = await tenant.client.post(`/api/purchase-orders/${orderId}/receive`, {
    items: [{ productId, quantity: received }],
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return orderId;
}

/** Fully received, then backdated to manufacture the lead time. */
async function seedReceivedOrder(
  tenant: Tenant,
  productId: string,
  leadTimeDays: number,
  quantity = '50',
): Promise<string> {
  const orderId = await createDraftOrder(tenant, productId, quantity);
  const order = await tenant.client.post(`/api/purchase-orders/${orderId}/order`);
  assert.equal(order.status, 200);
  const received = await tenant.client.post(`/api/purchase-orders/${orderId}/receive`, {
    items: [{ productId, quantity }],
  });
  assert.equal(received.status, 201, JSON.stringify(received.body));

  await getPool().query(
    `UPDATE purchase_orders SET ordered_at = received_at - ($2 || ' days')::interval WHERE id = $1`,
    [orderId, leadTimeDays],
  );
  return orderId;
}

/** Cancelled: never a commitment, and never a lead-time measurement. */
async function seedCancelledOrder(tenant: Tenant, productId: string, leadTimeDays: number) {
  const orderId = await seedReceivedOrder(tenant, productId, leadTimeDays);
  await getPool().query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
  return orderId;
}

/**
 * Opening stock, backdated.
 *
 * INSERT rather than UPDATE: `inventory_movements` is append-only and a BEFORE
 * UPDATE trigger rejects any rewrite.
 */
async function stockIn(
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

/** A large opening balance, so every sale and receipt a fixture needs can succeed. */
async function stockInLarge(tenant: Tenant, productId: string): Promise<void> {
  await stockIn(tenant, productId, '100000');
}

/**
 * Move the ledger balance to an exact figure, so a decision boundary — stock
 * exactly *at* the reorder point, say — can be tested rather than approximated.
 *
 * Written as a movement rather than an edit because the ledger is append-only,
 * and because the balance is the sum of the ledger rather than a stored column.
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

  if (delta < 0) {
    await stockOutDirect(tenant, productId, Math.abs(delta).toFixed(2));
  } else {
    await stockIn(tenant, productId, delta.toFixed(2), 1);
  }
}

/**
 * A stock-out, inserted directly.
 *
 * The API refuses to oversell, which is the right behaviour for an application
 * and exactly wrong for a fixture: a negative balance is precisely the corrupt
 * ledger the engine must report, and it can only be produced by writing the
 * movement directly.
 */
async function stockOutDirect(tenant: Tenant, productId: string, quantity: string): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     SELECT $1, $2, 'out', $3::numeric, 'Fixture stock-out', $4::uuid, now()`,
    [tenant.user.businessId, productId, quantity, tenant.user.id],
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

async function listReorder(
  tenant: Tenant,
  query = '',
): Promise<{ data: ReorderEntry[]; meta: Meta; decisionCounts: Record<string, number> }> {
  const response = await tenant.client.get<{
    data: ReorderEntry[];
    meta: Meta;
    decisionCounts: Record<string, number>;
  }>(`/api/intelligence/reorder${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

function find(items: ReorderEntry[], sku: string): ReorderEntry {
  const entry = items.find((item) => item.sku === sku);
  assert.ok(entry, `no entry for ${sku}`);
  return entry;
}

/** A product selling 10/day over 30 days, with a 5-day lead time. */
async function seedStandardProduct(tenant: Tenant, sku: string): Promise<string> {
  const productId = await createProduct(tenant, { sku });
  await stockInLarge(tenant, productId);
  await seedSalesOnDays(tenant, productId, recentAges(30), '10');
  await seedReceivedOrder(tenant, productId, 5);
  return productId;
}

async function countRows(): Promise<Record<string, number>> {
  const result = await getPool().query<Record<string, number>>(
    `SELECT
       (SELECT count(*) FROM products)::int            AS products,
       (SELECT count(*) FROM sales)::int               AS sales,
       (SELECT count(*) FROM sale_items)::int          AS sale_items,
       (SELECT count(*) FROM inventory_movements)::int AS movements,
       (SELECT count(*) FROM purchase_orders)::int     AS purchase_orders,
       (SELECT count(*) FROM purchase_order_items)::int AS purchase_order_items`,
  );
  return result.rows[0] ?? {};
}

// ---------------------------------------------------------------------------

describe('GET /api/intelligence/reorder — integration', () => {
  it('computes a reorder point and recommends a quantity', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-REORDER' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await adjustStockTo(tenant, productId, '20');

    const entry = find((await listReorder(tenant)).data, 'RO-REORDER');

    // 10 units/day × (5 days lead + 2 days safety) = 70 units.
    assert.equal(entry.safetyStock, '20.00');
    assert.equal(entry.reorderPoint, '70.00');
    assert.equal(entry.netAvailable, '20.00');
    assert.equal(entry.decision, 'REORDER');
    assert.equal(entry.reorder, true);
    assert.equal(entry.recommendedQuantity, '50.00');
    assert.equal(entry.effectiveLeadTimeDays, '5.00');
    assert.match(entry.reason, /below the reorder point/);
  });

  it('reports NO_REORDER when stock is above the point', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-OK' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await adjustStockTo(tenant, productId, '500');

    const entry = find((await listReorder(tenant)).data, 'RO-OK');

    assert.equal(entry.decision, 'NO_REORDER');
    assert.equal(entry.reorder, false);
    assert.equal(entry.recommendedQuantity, '0.00');
    assert.match(entry.reason, /No reorder is needed/);
  });

  it('treats stock exactly at the reorder point as NO_REORDER', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-EXACT' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await adjustStockTo(tenant, productId, '70');

    const entry = find((await listReorder(tenant)).data, 'RO-EXACT');

    assert.equal(entry.netAvailable, '70.00');
    assert.equal(entry.decision, 'NO_REORDER');
  });

  it('reports INSUFFICIENT_DATA when nothing has sold', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-NOSALES' });
    await stockInLarge(tenant, productId);
    await seedReceivedOrder(tenant, productId, 5);
    await adjustStockTo(tenant, productId, '5');

    const entry = find((await listReorder(tenant)).data, 'RO-NOSALES');

    assert.equal(entry.decision, 'INSUFFICIENT_DATA');
    assert.equal(entry.reorderPoint, null);
    assert.equal(entry.recommendedQuantity, null);
    assert.equal(entry.reorder, false);
  });

  it('reports INSUFFICIENT_DATA when no completed purchase order exists', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-NOPO' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await adjustStockTo(tenant, productId, '5');

    const entry = find((await listReorder(tenant)).data, 'RO-NOPO');

    assert.equal(entry.decision, 'INSUFFICIENT_DATA');
    assert.equal(entry.evidence.hasLeadTimeEvidence, false);
    assert.equal(entry.evidence.leadTimeSamples, 0);
  });

  it('reports INSUFFICIENT_DATA for a product with too little history', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-NEW' });
    await stockIn(tenant, productId, '100000', 3);
    await seedSalesOnDays(tenant, productId, recentAges(3), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await adjustStockTo(tenant, productId, '5');

    const entry = find((await listReorder(tenant)).data, 'RO-NEW');

    assert.equal(entry.decision, 'INSUFFICIENT_DATA');
  });

  it('reports DATA_ERROR for a negative ledger balance and recommends nothing', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-CORRUPT' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await adjustStockTo(tenant, productId, '-15');

    const entry = find((await listReorder(tenant)).data, 'RO-CORRUPT');

    assert.equal(entry.currentStock, '-15.00');
    assert.equal(entry.decision, 'DATA_ERROR');
    assert.equal(entry.recommendedQuantity, null);
    assert.equal(entry.reorder, false);
    assert.match(entry.reason, /inventory ledger is inconsistent/);
  });
});

describe('GET /api/intelligence/reorder — purchase order states', () => {
  it('counts only ordered and partially received stock as on order', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-ONORDER' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await seedOrderedOrder(tenant, productId, '40');
    await seedPartiallyReceivedOrder(tenant, productId, '30', '10');
    await adjustStockTo(tenant, productId, '10');

    const entry = find((await listReorder(tenant)).data, 'RO-ONORDER');

    // 40 still outstanding + (30 ordered - 10 received) = 60.
    assert.equal(entry.onOrderQuantity, '60.00');
    assert.equal(entry.netAvailable, '70.00');
    assert.equal(entry.decision, 'NO_REORDER', 'the order on the way already covers the gap');
  });

  it('ignores a draft order, which is not yet a commitment', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-DRAFT' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 5);
    await seedDraftOrder(tenant, productId, '500');
    // 20 on hand with a 500-unit draft outstanding. If the draft were counted as
    // a commitment the decision would flip to NO_REORDER, so this balance is
    // what makes the test able to fail.
    await adjustStockTo(tenant, productId, '20');

    const entry = find((await listReorder(tenant)).data, 'RO-DRAFT');

    assert.equal(entry.onOrderQuantity, '0.00');
    assert.equal(entry.netAvailable, '20.00');
    assert.equal(entry.decision, 'REORDER');
  });

  it('ignores a cancelled order in both directions', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-CANCELLED' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedCancelledOrder(tenant, productId, 5);

    const entry = find((await listReorder(tenant)).data, 'RO-CANCELLED');

    // A cancelled order is neither a commitment on the way nor a lead-time
    // measurement, so both of its effects must be gone.
    assert.equal(entry.onOrderQuantity, '0.00');
    assert.equal(entry.evidence.leadTimeSamples, 0);
    assert.equal(entry.decision, 'INSUFFICIENT_DATA');
  });

  it('uses the median lead time across several completed orders', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'RO-MEDIAN' });
    await stockInLarge(tenant, productId);
    await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    await seedReceivedOrder(tenant, productId, 4);
    await seedReceivedOrder(tenant, productId, 5);
    await seedReceivedOrder(tenant, productId, 40);

    const entry = find((await listReorder(tenant)).data, 'RO-MEDIAN');

    assert.equal(entry.effectiveLeadTimeDays, '5.00', 'the 40-day outlier must not win');
    assert.equal(entry.evidence.leadTimeSamples, 3);
    assert.equal(entry.reorderPoint, '70.00');
    assert.equal(entry.evidence.leadTimeSpreadDays, '36.00');
    assert.equal(entry.evidence.leadTimeUnreliable, true);
    assert.notEqual(entry.decision, 'INSUFFICIENT_DATA', 'still usable, just less certain');
  });

  it('raises the reorder point as the lead time grows', async () => {
    const tenant = await createTenant(server);
    const short = await createProduct(tenant, { sku: 'RO-LEAD-SHORT' });
    const long = await createProduct(tenant, { sku: 'RO-LEAD-LONG' });
    for (const productId of [short, long]) {
      await stockInLarge(tenant, productId);
      await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    }
    await seedReceivedOrder(tenant, short, 5);
    await seedReceivedOrder(tenant, long, 60);

    const body = await listReorder(tenant);
    assert.equal(find(body.data, 'RO-LEAD-SHORT').reorderPoint, '70.00');
    assert.equal(find(body.data, 'RO-LEAD-LONG').reorderPoint, '620.00');
  });

  it('agrees with the Stock Risk Engine on the reorder point', async () => {
    const tenant = await createTenant(server);
    const productId = await seedStandardProduct(tenant, 'RO-AGREE');

    const reorder = find((await listReorder(tenant)).data, 'RO-AGREE');
    const risk = await tenant.client.get<{ data: { reorderPoint: string | null } }>(
      `/api/intelligence/stock-risk/${productId}`,
    );

    assert.equal(reorder.reorderPoint, '70.00');
    assert.equal(
      reorder.reorderPoint,
      risk.body.data.reorderPoint,
      'the two engines must never report different reorder points',
    );
  });
});

describe('GET /api/intelligence/reorder — filters and pagination', () => {
  it('excludes inactive products from operational results by default', async () => {
    const tenant = await createTenant(server);
    const active = await createProduct(tenant, { sku: 'RO-ACTIVE' });
    const inactive = await createProduct(tenant, { sku: 'RO-INACTIVE' });
    for (const productId of [active, inactive]) {
      await stockInLarge(tenant, productId);
      await seedSalesOnDays(tenant, productId, recentAges(30), '10');
      await seedReceivedOrder(tenant, productId, 5);
    }
    await tenant.client.delete(`/api/products/${inactive}`);

    const byDefault = await listReorder(tenant);
    assert.equal(byDefault.meta.total, 1);
    assert.equal(byDefault.data[0]?.sku, 'RO-ACTIVE');

    const includingInactive = await listReorder(tenant, '?isActive=all');
    assert.equal(includingInactive.meta.total, 2);

    const onlyInactive = await listReorder(tenant, '?isActive=inactive');
    assert.equal(onlyInactive.meta.total, 1);
    assert.equal(onlyInactive.data[0]?.sku, 'RO-INACTIVE');
  });

  it('filters by search and category', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>('/api/categories', {
      name: 'RO Tools',
    });
    const inCategory = await createProduct(tenant, {
      sku: 'RO-CAT',
      name: 'Hammer Drill',
      categoryId: category.body.data.id,
    });
    await createProduct(tenant, { sku: 'RO-NOCAT', name: 'Paint Brush' });
    await stockInLarge(tenant, inCategory);

    assert.equal((await listReorder(tenant, '?search=hammer')).meta.total, 1);
    assert.equal(
      (await listReorder(tenant, `?categoryId=${category.body.data.id}`)).meta.total,
      1,
    );
  });

  it('filters by decision and confidence, and reports counts', async () => {
    const tenant = await createTenant(server);
    const low = await createProduct(tenant, { sku: 'RO-F-LOW' });
    const high = await createProduct(tenant, { sku: 'RO-F-HIGH' });
    for (const productId of [low, high]) {
      await stockInLarge(tenant, productId);
      await seedSalesOnDays(tenant, productId, recentAges(30), '10');
    }
    await seedReceivedOrder(tenant, low, 5);
    await seedReceivedOrder(tenant, high, 5);
    await seedReceivedOrder(tenant, high, 6);
    await seedReceivedOrder(tenant, high, 6);

    const all = await listReorder(tenant);
    assert.equal(all.decisionCounts.NO_REORDER, 2);

    const noReorder = await listReorder(tenant, '?decision=NO_REORDER');
    assert.equal(noReorder.meta.total, 2);

    const insufficient = await listReorder(tenant, '?decision=INSUFFICIENT_DATA');
    assert.equal(insufficient.meta.total, 0);

    const lowConfidence = await listReorder(tenant, '?confidence=LOW');
    assert.equal(lowConfidence.meta.total, 1, 'a single completed order is thin evidence');
    assert.equal(lowConfidence.data[0]?.sku, 'RO-F-LOW');

    const highConfidence = await listReorder(tenant, '?confidence=HIGH');
    assert.equal(highConfidence.meta.total, 1);
    assert.equal(highConfidence.data[0]?.sku, 'RO-F-HIGH', 'three consistent orders, dense demand');
  });

  it('paginates', async () => {
    const tenant = await createTenant(server);
    for (let index = 0; index < 5; index += 1) {
      await createProduct(tenant, { sku: `RO-PAGE-${index}` });
    }

    const page = await listReorder(tenant, '?page=2&limit=2');

    assert.equal(page.meta.total, 5);
    assert.equal(page.meta.page, 2);
    assert.equal(page.meta.totalPages, 3);
    assert.equal(page.data.length, 2);
  });

  it('returns a valid empty page past the end of the catalog', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'RO-ONE' });

    const page = await listReorder(tenant, '?page=9&limit=10');

    assert.deepEqual(page.data, []);
    assert.equal(page.meta.total, 1);
    assert.equal(page.meta.page, 9);
  });

  it('returns an empty result set for a tenant with no products', async () => {
    const tenant = await createTenant(server);

    const body = await listReorder(tenant);

    assert.deepEqual(body.data, []);
    assert.equal(body.meta.total, 0);
    assert.deepEqual(body.decisionCounts, {});
  });

  it('rejects an invalid page size, invalid enum values and unknown fields', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/reorder?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/reorder?page=0')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/reorder?decision=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/reorder?confidence=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/reorder?isActive=maybe')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/reorder?businessId=other')).status,
      400,
      'the tenant is never client-controlled',
    );
    assert.equal((await tenant.client.get('/api/intelligence/reorder?orderBy=1')).status, 400);
  });

  it('treats a SQL-injection search term as a literal', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'RO-INJECTION', name: 'Injected' });

    const response = await tenant.client.get<{ data: ReorderEntry[] }>(
      `/api/intelligence/reorder?search=${encodeURIComponent("' ; DROP TABLE products --")}`,
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

describe('GET /api/intelligence/reorder/:productId', () => {
  it('returns one product with its full explanation', async () => {
    const tenant = await createTenant(server);
    const productId = await seedStandardProduct(tenant, 'RO-DETAIL');
    await adjustStockTo(tenant, productId, '20');

    const response = await tenant.client.get<{ data: ReorderEntry }>(
      `/api/intelligence/reorder/${productId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.productId, productId);
    assert.equal(response.body.data.sku, 'RO-DETAIL');
    assert.equal(response.body.data.reorderPoint, '70.00');
    assert.equal(response.body.data.decision, 'REORDER');
    assert.equal(response.body.data.safetyStockDays, 2);
    assert.ok(response.body.data.reason.length > 0);
    assert.equal(response.body.data.evidence.safetyStockDays, 2);
  });

  it('answers 404 for a product that does not exist', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/intelligence/reorder/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/reorder/not-a-uuid')).status, 400);
  });
});

describe('reorder intelligence security', () => {
  it('rejects unauthenticated access to both endpoints', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/reorder')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/intelligence/reorder/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
  });

  it('exposes no write route, and a recommendation places no order', async () => {
    const tenant = await createTenant(server);
    const productId = await seedStandardProduct(tenant, 'RO-NOWRITE');

    for (const method of ['post', 'patch', 'delete'] as const) {
      const response = await tenant.client[method]('/api/intelligence/reorder', {
        body: { productId, quantity: '100' },
      });
      assert.equal(response.status, 404, `${method.toUpperCase()} /reorder must not exist`);
    }

    assert.equal((await tenant.client.post(`/api/intelligence/reorder/${productId}`)).status, 404);
  });

  it('never mutates anything, and creates no purchase order', async () => {
    const tenant = await createTenant(server);
    await seedStandardProduct(tenant, 'RO-READONLY');

    const before = await countRows();
    await listReorder(tenant);
    await listReorder(tenant, '?limit=100&decision=REORDER');

    assert.deepEqual(
      await countRows(),
      before,
      'a reorder recommendation must change nothing, least of all place an order',
    );
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await createProduct(tenantA, { sku: 'RO-ISO-A', name: 'A product' });
    await stockInLarge(tenantA, productA);
    await seedSalesOnDays(tenantA, productA, recentAges(30), '10');
    await seedReceivedOrder(tenantA, productA, 5);

    const listB = await listReorder(tenantB);
    assert.equal(listB.meta.total, 0);
    assert.deepEqual(listB.data, []);

    const detailB = await tenantB.client.get(`/api/intelligence/reorder/${productA}`);
    assert.equal(detailB.status, 404, 'a cross-tenant product is not found');
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'RO-STAFF' });
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    assert.equal((await staff.get('/api/intelligence/reorder')).status, 200);
  });
});
