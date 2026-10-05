/**
 * Intelligence API — integration tests.
 *
 * These exercise the real HTTP surface against the real database: authentication,
 * tenant isolation, filters, and the fact-gathering SQL. The risk *formulas* are
 * proven separately in `stockRisk.test.ts`, which needs no database.
 *
 * Data is created through the API, then backdated with SQL so products have real
 * observable history — otherwise everything is legitimately
 * `INSUFFICIENT_DATA`, because a product stocked a moment ago genuinely has no
 * history.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface RiskEntry {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  risk: string;
  priority: number;
  confidence: string;
  currentStock: string;
  unitsSold: string;
  averageDailySales: string;
  analysisWindowDays: number;
  daysOfStock: string | null;
  effectiveLeadTimeDays: string | null;
  leadTimeSampleCount: number;
  safetyStock: string | null;
  reorderPoint: string | null;
  reason: string;
  evidence: {
    salesWindowDays: number;
    unitsSold: string;
    observableHistoryDays: string;
    activeSalesDays: string;
    leadTimeSamples: number;
    hasLeadTimeEvidence: boolean;
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

async function createProduct(tenant: Tenant, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody(overrides),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function stockIn(tenant: Tenant, productId: string, quantity: string): Promise<void> {
  const response = await tenant.client.post('/api/inventory/movements', {
    productId,
    movementType: 'in',
    quantity,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
}

async function listRisk(
  tenant: Tenant,
  query = '',
): Promise<{ data: RiskEntry[]; meta: Meta; riskCounts: Record<string, number> }> {
  const response = await tenant.client.get<{
    data: RiskEntry[];
    meta: Meta;
    riskCounts: Record<string, number>;
  }>(`/api/intelligence/stock-risk${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

function find(items: RiskEntry[], sku: string): RiskEntry {
  const entry = items.find((item) => item.sku === sku);
  assert.ok(entry, `no entry for ${sku}`);
  return entry;
}

/**
 * Record an opening stock movement dated in the past, so the product has real
 * observable history.
 *
 * INSERT rather than UPDATE: `inventory_movements` is append-only and a
 * `BEFORE UPDATE` trigger rejects any attempt to rewrite one. A correctly-dated
 * insert is allowed, which is exactly what a real historical import would do.
 */
async function openStockHistorically(
  tenant: Tenant,
  productId: string,
  quantity: string,
  daysAgo: number,
): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     SELECT $1, $2, 'in', $3::numeric, 'Opening stock', $4::uuid,
            now() - ($5 || ' days')::interval`,
    [tenant.user.businessId, productId, quantity, tenant.user.id, daysAgo],
  );
}

/**
 * Spread a product's sales across distinct days inside the analysis window, so
 * `activeSalesDays` is realistic. `sales` rows are not append-only, so the
 * timestamp can be adjusted for fixtures.
 */
async function spreadSalesAcrossDays(tenant: Tenant, productId: string, spanDays = 12): Promise<void> {
  await getPool().query(
    `WITH ranked AS (
       SELECT s.id,
              row_number() OVER (ORDER BY s.created_at) AS n
         FROM sales s
        WHERE s.business_id = $1
          AND EXISTS (SELECT 1 FROM sale_items si
                       WHERE si.sale_id = s.id AND si.product_id = $2)
     )
     UPDATE sales s
        SET sold_at = now() - (r.n - 1) * ($3 || ' days')::interval / $4::numeric
       FROM ranked r
      WHERE s.id = r.id`,
    [tenant.user.businessId, productId, spanDays, Math.max(1, spanDays)],
  );
}

/** A product with real history: an opening movement and daily sales. */
async function seedProductWithHistory(
  tenant: Tenant,
  sku: string,
  options: {
    openingStock: string;
    salesCount: number;
    unitsPerSale: number;
    daysAgo?: number;
    /**
     * Runs after the opening movement and before the sales — the hook a test
     * needs to deliver a purchase order's receipt in time, so the sales do not
     * drive stock negative part-way through.
     */
    beforeSales?: (productId: string) => Promise<void>;
  },
): Promise<string> {
  const productId = await createProduct(tenant, { sku, sellingPrice: '10.00' });
  await openStockHistorically(tenant, productId, options.openingStock, options.daysAgo ?? 70);
  if (options.beforeSales) await options.beforeSales(productId);
  await seedDailySales(tenant, productId, options.salesCount, options.unitsPerSale);
  await spreadSalesAcrossDays(tenant, productId, 12);
  return productId;
}

/** Create `count` sales of `units` each, on distinct days, for one product. */
async function seedDailySales(
  tenant: Tenant,
  productId: string,
  count: number,
  units: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const response = await tenant.client.post('/api/sales', {
      items: [{ productId, quantity: String(units) }],
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }
}

// ---------------------------------------------------------------------------

describe('GET /api/intelligence/stock-risk — integration', () => {
  it('returns every product, including ones with no sales or movements', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'IT-SOLD', name: 'Sold' });
    // Stock on hand but never sold: the "cannot judge coverage" case.
    const idle = await createProduct(tenant, { sku: 'IT-IDLE', name: 'Never sold' });
    await stockIn(tenant, idle, '40');

    const body = await listRisk(tenant);
    const sold = find(body.data, 'IT-SOLD');
    const neverSold = find(body.data, 'IT-IDLE');

    assert.equal(body.meta.total, 2, 'products with no sales are still listed');
    assert.equal(sold.currentStock, '0.00');
    assert.equal(sold.risk, 'OUT_OF_STOCK', 'an empty shelf outranks any evidence question');
    assert.equal(neverSold.currentStock, '40.00');
    assert.equal(
      neverSold.risk,
      'INSUFFICIENT_DATA',
      'stock with no demand evidence is not called healthy',
    );
    assert.equal(neverSold.daysOfStock, null, 'no velocity, so no days of cover');
    assert.equal(neverSold.safetyStock, null);
    assert.equal(neverSold.reorderPoint, null, 'no fake reorder point without evidence');
  });

  it('derives current stock from the inventory ledger', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'IT-STOCK' });

    await stockIn(tenant, productId, '40');
    await tenant.client.post('/api/inventory/movements', {
      productId,
      movementType: 'out',
      quantity: '12',
    });

    const entry = find((await listRisk(tenant)).data, 'IT-STOCK');
    assert.equal(entry.currentStock, '28.00');
  });

  it('never mutates inventory, and creates no purchase order', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'IT-RO' });
    await stockIn(tenant, productId, '10');

    const before = await countRows();
    await listRisk(tenant);
    await listRisk(tenant, '?limit=100');

    assert.deepEqual(await countRows(), before, 'a risk assessment changes nothing');
  });

  it('classifies a critical product and computes the reorder point', async () => {
    const tenant = await createTenant(server);
    // 148 opening + 50 received = 198, then 180 sold leaves 18 → 3 days of cover.
    await seedProductWithHistory(tenant, 'IT-CRIT', {
      openingStock: '148',
      salesCount: 12,
      unitsPerSale: 15,
      // The completed order supplies both the 50 received units and a 5-day lead time.
      beforeSales: (productId) => seedCompletedPurchaseOrder(tenant, productId, 5),
    });

    const entry = find((await listRisk(tenant)).data, 'IT-CRIT');

    assert.equal(entry.unitsSold, '180.00');
    assert.equal(entry.averageDailySales, '6.0000', '180 / 30');
    assert.equal(entry.currentStock, '18.00', '148 + 50 − 180');
    assert.equal(entry.daysOfStock, '3.00', '18 / 6');
    assert.equal(entry.effectiveLeadTimeDays, '5.00');
    assert.equal(entry.safetyStock, '12.00', '6 × 2');
    assert.equal(entry.reorderPoint, '42.00', '6 × (5 + 2)');
    assert.equal(entry.risk, 'CRITICAL', '3 days of cover against a 5-day lead time');
    assert.equal(entry.priority, 80);
    assert.match(entry.reason, /covers approximately 3(\.0)? days/i);
  });

  it('classifies a healthy product', async () => {
    const tenant = await createTenant(server);
    // 190 opening + 50 received = 240, minus 180 sold = 60 → 10 days of cover.
    await seedProductWithHistory(tenant, 'IT-HEALTH', {
      openingStock: '190',
      salesCount: 12,
      unitsPerSale: 15,
      beforeSales: (id) => seedCompletedPurchaseOrder(tenant, id, 5),
    });

    const entry = find((await listRisk(tenant)).data, 'IT-HEALTH');

    assert.equal(entry.daysOfStock, '10.00');
    assert.equal(entry.risk, 'HEALTHY', '10 days is above the 7-day threshold');
    assert.equal(entry.priority, 0);
  });

  it('classifies a low-risk product', async () => {
    const tenant = await createTenant(server);
    // 166 opening + 50 received = 216, minus 180 sold = 36 → 6 days of cover.
    await seedProductWithHistory(tenant, 'IT-LOW', {
      openingStock: '166',
      salesCount: 12,
      unitsPerSale: 15,
      beforeSales: (id) => seedCompletedPurchaseOrder(tenant, id, 5),
    });

    const entry = find((await listRisk(tenant)).data, 'IT-LOW');

    assert.equal(entry.daysOfStock, '6.00');
    assert.equal(entry.risk, 'LOW', '6 days is above 5 but below 7');
  });

  it('classifies an out-of-stock product regardless of evidence', async () => {
    const tenant = await createTenant(server);
    // Opening 180 and selling 180 leaves nothing, so the sale itself empties it.
    await seedProductWithHistory(tenant, 'IT-OOS', {
      openingStock: '180',
      salesCount: 12,
      unitsPerSale: 15,
    });

    const entry = find((await listRisk(tenant)).data, 'IT-OOS');

    assert.equal(entry.currentStock, '0.00');
    assert.equal(entry.risk, 'OUT_OF_STOCK');
    assert.equal(entry.priority, 100);
  });

  it('classifies an overstocked product only with demand evidence', async () => {
    const tenant = await createTenant(server);
    await seedProductWithHistory(tenant, 'IT-OVER', {
      openingStock: '2530',
      salesCount: 12,
      unitsPerSale: 15,
      beforeSales: (id) => seedCompletedPurchaseOrder(tenant, id, 5),
    });

    const overstocked = find((await listRisk(tenant)).data, 'IT-OVER');
    assert.equal(overstocked.daysOfStock, '400.00');
    assert.equal(overstocked.risk, 'OVERSTOCK');

    // The same volume with no sales must not be called overstocked.
    const idleTenant = await createTenant(server);
    const idleId = await createProduct(idleTenant, { sku: 'IT-IDLELOTS' });
    await stockIn(idleTenant, idleId, '99999');
    const idle = find((await listRisk(idleTenant)).data, 'IT-IDLELOTS');
    assert.equal(idle.risk, 'INSUFFICIENT_DATA');
  });

  it('excludes a cancelled purchase order from lead time', async () => {
    const tenant = await createTenant(server);
    const productId = await seedProductWithHistory(tenant, 'IT-CANCEL', {
      openingStock: '198',
      salesCount: 12,
      unitsPerSale: 15,
    });

    const order = await createPurchaseOrder(tenant, productId, 50);
    await tenant.client.post(`/api/purchase-orders/${order}/order`);
    await tenant.client.patch(`/api/purchase-orders/${order}`, { status: 'cancelled' });

    const entry = find((await listRisk(tenant)).data, 'IT-CANCEL');

    assert.equal(entry.effectiveLeadTimeDays, null, 'a cancelled order proves nothing about lead time');
    assert.equal(entry.reorderPoint, null);
    assert.equal(entry.risk, 'INSUFFICIENT_DATA');
  });

  it('excludes an incomplete purchase order from lead time', async () => {
    const tenant = await createTenant(server);
    const productId = await seedProductWithHistory(tenant, 'IT-OPEN', {
      openingStock: '198',
      salesCount: 12,
      unitsPerSale: 15,
    });

    const order = await createPurchaseOrder(tenant, productId, 50);
    await tenant.client.post(`/api/purchase-orders/${order}/order`);
    // Still `ordered` — never fully received.

    const entry = find((await listRisk(tenant)).data, 'IT-OPEN');

    assert.equal(entry.effectiveLeadTimeDays, null);
    assert.equal(entry.leadTimeSampleCount, 0);
  });

  it('uses the median lead time across several completed orders', async () => {
    const tenant = await createTenant(server);
    // Four completed orders, each delivering 50 units, before the sales begin.
    await seedProductWithHistory(tenant, 'IT-MEDIAN', {
      openingStock: '148',
      salesCount: 12,
      unitsPerSale: 15,
      beforeSales: async (productId) => {
        for (const days of [4, 5, 5, 31]) {
          await seedCompletedPurchaseOrder(tenant, productId, days);
        }
      },
    });

    const entry = find((await listRisk(tenant)).data, 'IT-MEDIAN');

    assert.equal(entry.leadTimeSampleCount, 4);
    assert.equal(entry.effectiveLeadTimeDays, '5.00', 'the 31-day outlier must not skew the median');
  });

  it('reports evidence and the analysis window alongside the verdict', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'IT-EV' });
    await stockIn(tenant, productId, '10');

    const entry = find((await listRisk(tenant)).data, 'IT-EV');

    assert.equal(entry.analysisWindowDays, 30);
    assert.equal(entry.evidence.salesWindowDays, 30);
    assert.equal(entry.evidence.hasLeadTimeEvidence, false);
    assert.equal(entry.evidence.leadTimeSamples, 0);
    assert.equal(typeof entry.evidence.observableHistoryDays, 'string');
  });

  it('marks an inactive product but does not hide it', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'IT-INACT', name: 'Retired' });
    await stockIn(tenant, productId, '5');
    await tenant.client.delete(`/api/products/${productId}`);

    const entry = find((await listRisk(tenant)).data, 'IT-INACT');

    assert.equal(entry.isActive, false);
    assert.equal(entry.risk, 'INSUFFICIENT_DATA');
  });
});

describe('GET /api/intelligence/stock-risk — filters and pagination', () => {
  it('paginates', async () => {
    const tenant = await createTenant(server);
    for (const i of [0, 1, 2, 3, 4]) {
      await createProduct(tenant, { sku: `IT-PAGE-${i}`, name: `Paged ${i}` });
    }

    const page = await listRisk(tenant, '?page=2&limit=2');

    assert.equal(page.meta.total, 5);
    assert.equal(page.meta.page, 2);
    assert.equal(page.meta.totalPages, 3);
    assert.equal(page.data.length, 2);
  });

  it('filters by search, category and active status', async () => {
    const tenant = await createTenant(server);
    const category = await tenant.client.post<{ data: { id: string } }>('/api/categories', {
      name: 'IT Tools',
    });

    await createProduct(tenant, { sku: 'IT-A', name: 'Alpha', categoryId: category.body.data.id });
    await createProduct(tenant, { sku: 'IT-B', name: 'Beta' });

    const bySearch = await listRisk(tenant, '?search=alpha');
    assert.equal(bySearch.meta.total, 1);

    const byCategory = await listRisk(tenant, `?categoryId=${category.body.data.id}`);
    assert.equal(byCategory.meta.total, 1);

    const active = await listRisk(tenant, '?isActive=true');
    assert.equal(active.meta.total, 2);

    const inactive = await listRisk(tenant, '?isActive=false');
    assert.equal(inactive.meta.total, 0);
  });

  it('filters by risk and confidence, and reports counts', async () => {
    const tenant = await createTenant(server);
    const oos = await createProduct(tenant, { sku: 'IT-F-OOS' });
    // Stock but no sales: the only combination that is *not* out of stock and
    // still has no demand evidence. A product with no stock at all is
    // OUT_OF_STOCK, which would make this a two-of-the-same test.
    const idle = await createProduct(tenant, { sku: 'IT-F-IDLE' });
    await stockIn(tenant, idle, '10');
    await stockIn(tenant, oos, '5');
    await tenant.client.post('/api/inventory/movements', {
      productId: oos,
      movementType: 'out',
      quantity: '5',
    });

    const all = await listRisk(tenant);
    assert.equal(all.riskCounts.OUT_OF_STOCK, 1);
    assert.equal(all.riskCounts.INSUFFICIENT_DATA, 1);

    const criticalOnly = await listRisk(tenant, '?risk=OUT_OF_STOCK');
    assert.equal(criticalOnly.meta.total, 1);
    assert.equal(criticalOnly.data[0]?.sku, 'IT-F-OOS');

    const byConfidence = await listRisk(tenant, '?confidence=INSUFFICIENT');
    assert.equal(byConfidence.meta.total, 2);
  });

  it('rejects an invalid page size, invalid enum values and unknown fields', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/stock-risk?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/stock-risk?page=0')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/stock-risk?risk=NOPE')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/stock-risk?confidence=NOPE')).status,
      400,
    );
    assert.equal(
      (await tenant.client.get('/api/intelligence/stock-risk?businessId=other')).status,
      400,
      'the tenant is never client-controlled',
    );
    assert.equal(
      (await tenant.client.get('/api/intelligence/stock-risk?orderBy=1')).status,
      400,
    );
  });

  it('treats a SQL-injection search term as a literal', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'IT-INJ', name: 'Injected' });

    const response = await tenant.client.get<{ data: RiskEntry[] }>(
      `/api/intelligence/stock-risk?search=${encodeURIComponent("' ; DROP TABLE products --")}`,
    );

    assert.equal(response.status, 200);

    const tables = await getPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'products'`,
    );
    assert.equal(tables.rows[0]?.count, 1, 'the products table is intact');
  });
});

describe('GET /api/intelligence/stock-risk/:productId', () => {
  it('returns one product', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'IT-ONE' });
    await stockIn(tenant, productId, '25');

    const response = await tenant.client.get<{ data: RiskEntry }>(
      `/api/intelligence/stock-risk/${productId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.productId, productId);
    assert.equal(response.body.data.currentStock, '25.00');
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal(
      (await tenant.client.get('/api/intelligence/stock-risk/not-a-uuid')).status,
      400,
    );
  });
});

describe('intelligence security', () => {
  it('rejects unauthenticated access to both endpoints', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/stock-risk')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/intelligence/stock-risk/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await createProduct(tenantA, { sku: 'IT-ISO-A', name: 'A product' });
    await stockIn(tenantA, productA, '500');

    // B cannot see A's product at all.
    const listB = await listRisk(tenantB);
    assert.equal(listB.meta.total, 0);
    assert.deepEqual(listB.data, []);

    const detailB = await tenantB.client.get(`/api/intelligence/stock-risk/${productA}`);
    assert.equal(detailB.status, 404, 'a cross-tenant product is not found');
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await createProduct(tenant, { sku: 'IT-STAFF' });
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.get('/api/intelligence/stock-risk');

    assert.equal(response.status, 200);
  });
});

// ---------------------------------------------------------------------------

async function countRows(): Promise<Record<string, number>> {
  const result = await getPool().query<{
    movements: number;
    purchase_orders: number;
    sale_items: number;
    products: number;
  }>(
    `SELECT
       (SELECT count(*) FROM inventory_movements)::int AS movements,
       (SELECT count(*) FROM purchase_orders)::int    AS purchase_orders,
       (SELECT count(*) FROM sale_items)::int        AS sale_items,
       (SELECT count(*) FROM products)::int          AS products`,
  );
  const row = result.rows[0];
  return {
    movements: row?.movements ?? 0,
    purchase_orders: row?.purchase_orders ?? 0,
    sale_items: row?.sale_items ?? 0,
    products: row?.products ?? 0,
  };
}

async function createPurchaseOrder(
  tenant: Tenant,
  productId: string,
  quantity: number,
): Promise<string> {
  const supplier = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', {
    name: `IT Supplier ${Math.random().toString(36).slice(2, 8)}`,
  });
  const response = await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
    supplierId: supplier.body.data.id,
    items: [{ productId, quantity: String(quantity), unitCost: '6.00' }],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/** Create a purchase order and force it fully received with the given lead time. */
async function seedCompletedPurchaseOrder(
  tenant: Tenant,
  productId: string,
  leadTimeDays: number,
): Promise<void> {
  const orderId = await createPurchaseOrder(tenant, productId, 50);
  const order = await tenant.client.post(`/api/purchase-orders/${orderId}/order`);
  assert.equal(order.status, 200);
  const received = await tenant.client.post(`/api/purchase-orders/${orderId}/receive`, {
    items: [{ productId, quantity: '50' }],
  });
  assert.equal(received.status, 201, JSON.stringify(received.body));

  // Backdate `ordered_at` to manufacture the lead time. The API deliberately
  // refuses to set timestamps, so this is fixture-only work.
  await getPool().query(
    `UPDATE purchase_orders SET ordered_at = received_at - ($2 || ' days')::interval WHERE id = $1`,
    [orderId, leadTimeDays],
  );
}
