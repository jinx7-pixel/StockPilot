/**
 * Unified Intelligence — supplier-selection rule.
 *
 * A product can be bought from several suppliers, so the snapshot has to name
 * one. These tests pin the locked rule exactly:
 *
 *   1. most completed (`received`) purchase orders wins;
 *   2. tied on that, the most recent **non-cancelled** order;
 *   3. tied on both, the lowest `supplier_id`;
 *   4. suppliers exist but none delivered — still return one, with
 *      `INSUFFICIENT` confidence and null lead-time metrics;
 *   5. no purchase-order relationship at all — `supplier` is `null`.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface UnifiedItem {
  product: { id: string; sku: string; name: string; category: null };
  supplier: {
    supplierId: string;
    supplierName: string;
    confidence: string;
    medianLeadTimeDays: string | null;
    p90LeadTimeDays: string | null;
    completedPOCount: number;
    leadTimeSampleCount: number;
    explanation: { limitations: string[] };
  } | null;
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

async function createSupplier(tenant: Tenant, name: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createProduct(tenant: Tenant, sku: string, stock = '100000'): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const productId = response.body.data.id;

  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, 'in', $3::numeric, 'Opening', $4::uuid, now() - interval '200 days')`,
    [tenant.user.businessId, productId, stock, tenant.user.id],
  );
  return productId;
}

interface OrderSpec {
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
  /** Days ago the order was placed; also drives the tie-break ordering. */
  orderedDaysAgo: number;
  leadTimeDays?: number;
  quantity?: string;
  received?: string;
  /**
   * Insert the same product twice on this order. Nothing prevents it in the
   * schema, and it is exactly why the count uses DISTINCT.
   */
  duplicateProductLine?: boolean;
}

async function insertOrder(
  tenant: Tenant,
  supplierId: string,
  productId: string,
  spec: OrderSpec,
): Promise<void> {
  const orderId = crypto.randomUUID();
  const quantity = spec.quantity ?? '100';
  const received = spec.received ?? quantity;

  const orderedAt = new Date(Date.now() - spec.orderedDaysAgo * 86_400_000);
  const receivedAt =
    spec.leadTimeDays === undefined
      ? null
      : new Date(orderedAt.getTime() + spec.leadTimeDays * 86_400_000);

  await getPool().query(
    `INSERT INTO purchase_orders
       (id, business_id, supplier_id, status, total_amount, ordered_at, received_at, created_by, created_at)
     VALUES ($1, $2, $3, $4::purchase_order_status, 100::numeric, $5, $6, $7::uuid, now())`,
    [orderId, tenant.user.businessId, supplierId, spec.status, orderedAt, receivedAt, tenant.user.id],
  );

  const lines = spec.duplicateProductLine ? [quantity, quantity] : [quantity];
  for (const line of lines) {
    await getPool().query(
      `INSERT INTO purchase_order_items
         (id, purchase_order_id, business_id, product_id, quantity, received_quantity, unit_cost, line_total, created_at)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, 5, 5::numeric, now())`,
      [
        crypto.randomUUID(),
        orderId,
        tenant.user.businessId,
        productId,
        line,
        spec.status === 'received' ? received : '0',
      ],
    );
  }
}

async function unifiedSupplier(tenant: Tenant, productId: string) {
  const response = await tenant.client.get<{ data: UnifiedItem }>(
    `/api/intelligence/products/${productId}`,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

// ---------------------------------------------------------------------------

describe('Unified Intelligence — supplier selection', () => {
  it('1. a product with one supplier returns that supplier', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-ONE');
    const supplierId = await createSupplier(tenant, 'Only Supplier');
    await insertOrder(tenant, supplierId, productId, {
      status: 'received', orderedDaysAgo: 40, leadTimeDays: 5,
    });

    const item = await unifiedSupplier(tenant, productId);

    assert.ok(item.supplier, 'a supplier block is present');
    assert.equal(item.supplier.supplierId, supplierId);
    assert.equal(item.supplier.supplierName, 'Only Supplier');
    assert.equal(item.supplier.completedPOCount, 1);
  });

  it('2. the supplier with the most completed orders wins, not the most recent', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-MOST');

    // Recent but thin: one completed order, placed yesterday.
    const recent = await createSupplier(tenant, 'Recent Thin');
    await insertOrder(tenant, recent, productId, {
      status: 'received', orderedDaysAgo: 1, leadTimeDays: 3,
    });

    // Older but proven: three completed orders, the oldest placed first.
    const proven = await createSupplier(tenant, 'Proven Heavy');
    for (const daysAgo of [120, 100, 80]) {
      await insertOrder(tenant, proven, productId, {
        status: 'received', orderedDaysAgo: daysAgo, leadTimeDays: 6,
      });
    }

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier?.supplierName, 'Proven Heavy',
      'rule 1 outranks recency: three completed orders beat one');
    assert.equal(item.supplier?.completedPOCount, 3);
  });

  it('2b. a supplier with more open orders does not beat one with completed orders', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-OPEN');

    const proven = await createSupplier(tenant, 'Proven One');
    await insertOrder(tenant, proven, productId, {
      status: 'received', orderedDaysAgo: 90, leadTimeDays: 6,
    });

    // Three orders placed but never delivered: not completed work.
    const open = await createSupplier(tenant, 'Open Three');
    for (const daysAgo of [10, 9, 8]) {
      await insertOrder(tenant, open, productId, { status: 'ordered', orderedDaysAgo: daysAgo });
    }

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier?.supplierName, 'Proven One',
      'only received orders count towards completed');
  });

  it('2c. duplicate lines on one order count as a single completed order', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-DUPES');

    const one = await createSupplier(tenant, 'One Real Order');
    // The same product twice on one order must not read as two deliveries.
    await insertOrder(tenant, one, productId, {
      status: 'received', orderedDaysAgo: 60, leadTimeDays: 4, duplicateProductLine: true,
    });

    const other = await createSupplier(tenant, 'Two Real Orders');
    await insertOrder(tenant, other, productId, {
      status: 'received', orderedDaysAgo: 50, leadTimeDays: 4,
    });
    await insertOrder(tenant, other, productId, {
      status: 'received', orderedDaysAgo: 40, leadTimeDays: 4,
    });

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier?.supplierName, 'Two Real Orders',
      'COUNT(DISTINCT po.id) keeps duplicated lines from inflating a score');
  });

  it('3. on a tie, the most recent non-cancelled order wins', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-TIE');

    const earlier = await createSupplier(tenant, 'Earlier Order');
    await insertOrder(tenant, earlier, productId, {
      status: 'received', orderedDaysAgo: 100, leadTimeDays: 6,
    });

    const later = await createSupplier(tenant, 'Later Order');
    await insertOrder(tenant, later, productId, {
      status: 'received', orderedDaysAgo: 20, leadTimeDays: 6,
    });

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier?.supplierName, 'Later Order');
  });

  it('3b. a cancelled order cannot win the tie-break on recency', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-CANCELLED-TIE');

    const working = await createSupplier(tenant, 'Working Supplier');
    await insertOrder(tenant, working, productId, {
      status: 'received', orderedDaysAgo: 60, leadTimeDays: 6,
    });

    // Same completed count, but its most recent order is cancelled — the
    // absence of a delivery, which must not decide who is current.
    const cancelled = await createSupplier(tenant, 'Cancelled Latest');
    await insertOrder(tenant, cancelled, productId, {
      status: 'received', orderedDaysAgo: 70, leadTimeDays: 6,
    });
    await insertOrder(tenant, cancelled, productId, {
      status: 'cancelled', orderedDaysAgo: 5,
    });

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier?.supplierName, 'Working Supplier',
      'cancelled orders are excluded from the recency tie-break');
  });

  it('3c. an identical tie falls back to supplier_id ascending', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-IDENTICAL');

    // Same completed count and the same order date: only supplier_id can decide.
    const ids = await Promise.all([
      createSupplier(tenant, 'Tie Alpha'),
      createSupplier(tenant, 'Tie Beta'),
    ]);
    const orderedAt = new Date(Date.now() - 50 * 86_400_000);
    for (const supplierId of ids) {
      const orderId = crypto.randomUUID();
      await getPool().query(
        `INSERT INTO purchase_orders
           (id, business_id, supplier_id, status, total_amount, ordered_at, received_at, created_by, created_at)
         VALUES ($1, $2, $3, 'received', 100::numeric, $4, $4::timestamptz + interval '5 days', $5::uuid, now())`,
        [orderId, tenant.user.businessId, supplierId, orderedAt, tenant.user.id],
      );
      await getPool().query(
        `INSERT INTO purchase_order_items
           (id, purchase_order_id, business_id, product_id, quantity, received_quantity, unit_cost, line_total, created_at)
         VALUES ($1, $2, $3, $4, 100, 100, 5, 5, now())`,
        [crypto.randomUUID(), orderId, tenant.user.businessId, productId],
      );
    }

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(
      item.supplier?.supplierId,
      [...ids].sort()[0],
      'with history and dates identical, the lowest supplier_id wins',
    );
  });

  it('4. suppliers exist but none delivered: one is returned, unmeasurable', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-NEVER');
    const supplierId = await createSupplier(tenant, 'Never Delivered');
    await insertOrder(tenant, supplierId, productId, { status: 'ordered', orderedDaysAgo: 10 });

    const item = await unifiedSupplier(tenant, productId);

    assert.ok(item.supplier, 'a relationship exists, so a supplier is still reported');
    assert.equal(item.supplier?.supplierName, 'Never Delivered');
    assert.equal(item.supplier?.confidence, 'INSUFFICIENT');
    assert.equal(item.supplier?.medianLeadTimeDays, null);
    assert.equal(item.supplier?.p90LeadTimeDays, null);
    assert.equal(item.supplier?.leadTimeSampleCount, 0);
    assert.ok(
      item.supplier?.explanation.limitations.some((l) => l.includes('completed order')),
      'and the reason says why',
    );
  });

  it('4b. two suppliers with nothing delivered pick by recency and stay unmeasurable', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-NEVER-TWO');

    const older = await createSupplier(tenant, 'Never Older');
    await insertOrder(tenant, older, productId, { status: 'draft', orderedDaysAgo: 90 });

    const newer = await createSupplier(tenant, 'Never Newer');
    await insertOrder(tenant, newer, productId, { status: 'ordered', orderedDaysAgo: 5 });

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier?.supplierName, 'Never Newer',
      'all counts are zero, so recency decides');
    assert.equal(item.supplier?.confidence, 'INSUFFICIENT');
    assert.equal(item.supplier?.medianLeadTimeDays, null);
  });

  it('5. a product with no purchase-order relationship returns supplier null', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'SS-NOSUPPLIER');

    const item = await unifiedSupplier(tenant, productId);

    assert.equal(item.supplier, null, 'no relationship at all means no supplier block');
  });

  it('5b. another tenant’s supplier is never selected or visible', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await createProduct(tenantA, 'SS-ISO');
    const supplierB = await createSupplier(tenantB, 'Tenant B Supplier');
    await insertOrder(tenantB, supplierB, productA, {
      status: 'received', orderedDaysAgo: 5, leadTimeDays: 4,
    });

    const itemA = await unifiedSupplier(tenantA, productA);
    assert.equal(itemA.supplier, null, 'tenant B orders do not attach to tenant A products');

    // Tenant B cannot even read tenant A's product — not even to discover that
    // it once had a supplier.
    const crossRead = await tenantB.client.get(
      `/api/intelligence/products/${productA}`,
    );
    assert.equal(crossRead.status, 404);
    assert.ok(
      !JSON.stringify(crossRead.body).includes(supplierB),
      'and the supplier id does not leak through the error body',
    );

    const listB = await tenantB.client.get<{ data: { items: Array<{ supplier: unknown }> } }>(
      '/api/intelligence/products?limit=25',
    );
    assert.equal(listB.status, 200);
    for (const row of listB.body.data.items) {
      assert.equal(row.supplier, null, 'and no supplier leaks into another tenant list');
    }
  });
});