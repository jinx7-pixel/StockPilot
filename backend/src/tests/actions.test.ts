/**
 * Action Center tests.
 *
 * The properties this suite exists to protect, in priority order:
 *
 *  - **Nothing executes without a live recommendation.** A recommendation is a
 *    snapshot; the action must be revalidated at execution time and refused when
 *    the reason for acting has gone.
 *  - **The order and its audit row commit together.** A purchase order with no
 *    audit row is worse than no purchase order.
 *  - **A double submission cannot double-order.** Idempotency is what makes a
 *    retried request safe.
 *  - **Executing an action never moves stock.** The order is a draft; receiving
 *    is a separate, separate decision.
 *  - **A user may change the quantity but not the decision.**
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CreatedAction {
  id: string;
  businessId: string;
  status: string;
  actionType: string;
  productId: string;
  supplierId: string;
  quantity: string;
  recommendedQuantity: string;
  purchaseOrderId: string | null;
  idempotencyKey: string | null;
  sourceRecommendationType: string;
  sourceRecommendationId: string;
  sourceRecommendationContext: Record<string, unknown>;
  userId: string;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ActionPayload {
  action: CreatedAction;
  purchaseOrder: {
    id: string;
    status: string;
    supplierId: string;
    totalAmount: string;
    items: Array<{ productId: string; quantity: string; unitCost: string }>;
  } | null;
}

/** The standard `{ data }` envelope every successful response is wrapped in. */
interface ActionEnvelope {
  data: ActionPayload;
}

async function createProduct(tenant: Tenant, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody(overrides),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createSupplier(tenant: Tenant, name: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

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

const recentAges = (count: number) => Array.from({ length: count }, (_, i) => i);

/**
 * Settle the ledger to an exact balance. Always runs last: receiving a purchase
 * order puts stock back, so settling earlier would simply be undone.
 */
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
     VALUES ($1, $2, $3, $4::numeric, 'Fixture', $5, now())`,
    [
      tenant.user.businessId,
      productId,
      delta < 0 ? 'out' : 'in',
      Math.abs(delta).toFixed(2),
      tenant.user.id,
    ],
  );
}

async function seedOrder(tenant: Tenant, supplierId: string, productId: string, leadTimeDays: number) {
  const created = await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
    supplierId,
    items: [{ productId, quantity: '100', unitCost: '5.00' }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.data.id;
  assert.equal((await tenant.client.post(`/api/purchase-orders/${orderId}/order`)).status, 200);
  const received = await tenant.client.post(`/api/purchase-orders/${orderId}/receive`, {
    items: [{ productId, quantity: '100' }],
  });
  assert.equal(received.status, 201);
  await getPool().query(
    `UPDATE purchase_orders SET ordered_at = received_at - ($2 || ' days')::interval WHERE id = $1`,
    [orderId, String(leadTimeDays)],
  );
}

/**
 * A product with a live REPLENISH recommendation: 50 units against a 75-unit
 * reorder point, with a supplier whose lead time is measured and stable.
 */
async function seedActionableProduct(tenant: Tenant, sku: string): Promise<{ productId: string; supplierId: string }> {
  const productId = await createProduct(tenant, { sku });
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '10');
  const supplierId = await createSupplier(tenant, `Supplier ${sku}`);
  for (const lead of [5, 6, 5, 7, 6, 5]) await seedOrder(tenant, supplierId, productId, lead);
  await settleStock(tenant, productId, '50');
  return { productId, supplierId };
}

/** A well-covered product with no recommendation of any kind. */
async function seedHealthyProduct(tenant: Tenant, sku: string): Promise<{ productId: string; supplierId: string }> {
  const productId = await createProduct(tenant, { sku });
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '100');
  const supplierId = await createSupplier(tenant, `Healthy ${sku}`);
  await settleStock(tenant, productId, '2000');
  return { productId, supplierId };
}

/**
 * A product whose supplier is measured but whose stock is comfortable.
 *
 * The distinction from {@link seedHealthyProduct} matters: here the Reorder Engine
 * *can* compute a reorder point and still finds nothing wrong, so the only reason
 * an action is refused is that stock is adequate. Drawing the stock down afterwards
 * therefore produces a genuine recommendation, which is what makes a "retry after
 * fixing the problem" test meaningful.
 */
async function seedMeasuredButCoveredProduct(
  tenant: Tenant,
  sku: string,
): Promise<{ productId: string; supplierId: string }> {
  const productId = await createProduct(tenant, { sku });
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '10');
  const supplierId = await createSupplier(tenant, `Measured ${sku}`);
  for (const lead of [5, 6, 5, 7, 6, 5]) await seedOrder(tenant, supplierId, productId, lead);
  // 2,000 units at 10/day is 200 days of cover: ample, and far above the
  // 75-unit reorder point, so no REPLENISH is raised.
  await settleStock(tenant, productId, '2000');
  return { productId, supplierId };
}

async function countRows(table: string, businessId: string): Promise<number> {
  const result = await getPool().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE business_id = $1`,
    [businessId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function stockBalance(businessId: string, productId: string): Promise<number> {
  const result = await getPool().query<{ balance: string }>(
    `SELECT COALESCE(SUM(CASE movement_type WHEN 'out' THEN -quantity ELSE quantity END), 0)::text
              AS balance
       FROM inventory_movements WHERE business_id = $1 AND product_id = $2`,
    [businessId, productId],
  );
  return Number(result.rows[0]?.balance ?? '0');
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

describe('Action Center — executing a reviewed recommendation', () => {
  it('creates a draft purchase order and an audit row for a live REPLENISH', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-OK');

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '120',
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.action.status, 'COMPLETED');
    assert.equal(response.body.data.action.actionType, 'CREATE_DRAFT_PURCHASE_ORDER');
    assert.equal(response.body.data.action.quantity, '120.00');
    assert.equal(response.body.data.action.productId, productId);
    assert.equal(response.body.data.action.supplierId, supplierId);

    // The order is a DRAFT and belongs to this tenant and this supplier.
    assert.ok(response.body.data.purchaseOrder);
    assert.equal(response.body.data.purchaseOrder.status, 'draft');
    assert.equal(response.body.data.purchaseOrder.supplierId, supplierId);
    assert.equal(response.body.data.action.purchaseOrderId, response.body.data.purchaseOrder.id);

    // The line carries the user's confirmed quantity.
    assert.equal(response.body.data.purchaseOrder.items.length, 1);
    assert.equal(response.body.data.purchaseOrder.items[0]!.quantity, '120.00');
    assert.equal(response.body.data.purchaseOrder.items[0]!.productId, productId);

    assert.equal(await countRows('actions', tenant.user.businessId), 1);
  });

  it('derives the draft unit cost from the product, never from the request body', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, { sku: 'ACT-COST', costPrice: '7.25' });
    await seedStock(tenant, productId, '100000');
    await seedSales(tenant, productId, recentAges(30), '10');
    const supplierId = await createSupplier(tenant, 'Cost Supplier');
    for (const lead of [5, 6, 5, 7, 6, 5]) await seedOrder(tenant, supplierId, productId, lead);
    await settleStock(tenant, productId, '50');

    // `unitCost` is not in the schema, so this is rejected outright rather than
    // silently letting a client price its own order.
    const smuggled = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
      unitCost: '0.01',
    });
    assert.equal(smuggled.status, 400);

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.purchaseOrder!.items[0]!.unitCost, '7.25');
  });

  it('lets the user override the quantity but never the decision', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-OVERRIDE');

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '999',
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    // The confirmed figure is recorded...
    assert.equal(response.body.data.action.quantity, '999.00');
    assert.equal(response.body.data.purchaseOrder!.items[0]!.quantity, '999.00');
    // ...and the engine's suggestion is kept beside it, so the override is visible.
    assert.ok(Number(response.body.data.action.recommendedQuantity) > 0);
    assert.notEqual(response.body.data.action.recommendedQuantity, response.body.data.action.quantity);
  });

  it('never moves stock — the order is a draft, not a receipt', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-NOSTOCK');
    const before = await stockBalance(tenant.user.businessId, productId);

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    assert.equal(response.status, 201);

    assert.equal(await stockBalance(tenant.user.businessId, productId), before);
    // No `in` movement was written by the action itself.
    const movements = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_movements
        WHERE business_id = $1 AND product_id = $2 AND reason LIKE '%purchase%'`,
      [tenant.user.businessId, productId],
    );
    assert.equal(Number(movements.rows[0]!.count), 0);
  });

  it('records the acting user from the session, not the body', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-ACTOR');

    // `userId` is not in the schema.
    const spoof = await tenant.client.post('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
      userId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    assert.equal(spoof.status, 400);

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.action.userId, tenant.user.id);
  });
});

describe('Action Center — nothing executes without a live recommendation', () => {
  it('refuses a product that has no recommendation at all', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedHealthyProduct(tenant, 'ACT-NOREC');

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });

    assert.equal(response.status, 409, JSON.stringify(response.body));
    // A refusal has no action payload at all.
    assert.equal(response.body.data, undefined);
    assert.equal(await countRows('purchase_orders', tenant.user.businessId), 0);
    // The rejected attempt is recorded, but never as COMPLETED.
    assert.equal(await countRows('actions', tenant.user.businessId), 1);
  });

  it('refuses when the reviewed recommendation has since been resolved', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-STALE');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);

    const first = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    // Receiving the draft order puts 100 units back. Stock is now comfortable, so
    // the reorder engine no longer agrees the product needs buying.
    await getPool().query(
      `UPDATE purchase_orders SET status = 'received', received_at = now()
        WHERE business_id = $1 AND id = $2`,
      [tenant.user.businessId, first.body.data.action.purchaseOrderId],
    );
    await getPool().query(
      `UPDATE purchase_order_items SET received_quantity = quantity
        WHERE business_id = $1 AND purchase_order_id = $2`,
      [tenant.user.businessId, first.body.data.action.purchaseOrderId],
    );
    await getPool().query(
      `INSERT INTO inventory_movements
         (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
       VALUES ($1, $2, 'in', '100.00', 'purchase_order', $3, now())`,
      [tenant.user.businessId, productId, tenant.user.id],
    );

    const second = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });

    assert.equal(second.status, 409, JSON.stringify(second.body));
    // The fixture raises six orders to measure lead time, so the invariant is
    // that the stale attempt adds nothing to that baseline.
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore + 1,
      'the refused attempt must not create a second order',
    );
  });

  it('rejects every recommendation kind that is review-only', async () => {
    const tenant = await createTenant(server);
    // A product that is overstocked and dead: both are review-only verdicts.
    const productId = await createProduct(tenant, { sku: 'ACT-REVIEWONLY' });
    await seedStock(tenant, productId, '100000', 400);
    await seedSales(tenant, productId, [200, 210, 220], '5');
    await settleStock(tenant, productId, '800');
    const supplierId = await createSupplier(tenant, 'Review Only Supplier');

    // Confirm there really is a review-only recommendation to act on.
    const recommendations = await tenant.client.get<{
      data: { recommendations: Array<{ type: string; recommendedQuantity?: string }> };
    }>(`/api/recommendations/products/${productId}`);
    assert.ok(recommendations.body.data.recommendations.length > 0);
    for (const recommendation of recommendations.body.data.recommendations) {
      assert.notEqual(recommendation.type, 'REPLENISH');
    }

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
      sourceRecommendationId: `${productId}:REVIEW_DEAD_STOCK`,
    });

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(await countRows('purchase_orders', tenant.user.businessId), 0);
  });
});

describe('Action Center — atomicity', () => {
  it('writes the purchase order, its line and the audit row or none of them', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-ATOMIC');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    assert.equal(response.status, 201);

    // Every artefact exists, and they point at each other consistently. The
    // fixture's six lead-time orders are the baseline; the action adds exactly one
    // header and exactly one line.
    const orders = await countRows('purchase_orders', tenant.user.businessId);
    const items = await getPool().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM purchase_order_items WHERE business_id = $1',
      [tenant.user.businessId],
    );
    assert.equal(orders, ordersBefore + 1);
    assert.equal(Number(items.rows[0]!.count), ordersBefore + 1);
    assert.equal(await countRows('actions', tenant.user.businessId), 1);

    // The audit row and the order share a business, as the schema requires.
    const linked = await getPool().query<{ business_id: string }>(
      `SELECT po.business_id
         FROM actions a
         JOIN purchase_orders po ON po.id = a.purchase_order_id
        WHERE a.id = (SELECT id FROM actions WHERE business_id = $1)`,
      [tenant.user.businessId],
    );
    assert.equal(linked.rows[0]?.business_id, tenant.user.businessId);
  });

  it('leaves no order behind when the supplier is unusable', async () => {
    const tenant = await createTenant(server);
    const { productId } = await seedActionableProduct(tenant, 'ACT-BADSUP');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);
    const inactiveSupplier = await createSupplier(tenant, 'Retired Supplier');

    // Deactivate the supplier, then try to order from it.
    const patch = await tenant.client.patch(`/api/suppliers/${inactiveSupplier}`, {
      isActive: false,
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId: inactiveSupplier,
      quantity: '100',
    });

    assert.equal(response.status, 409, JSON.stringify(response.body));
    // The six fixture orders are the baseline; the refused attempt adds nothing.
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore,
      'an unusable supplier must not produce an order',
    );
    // No line may reference an order that does not exist — the foreign key makes
    // an orphan structurally impossible, and this asserts it did not happen by
    // some other route.
    const orphans = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM purchase_order_items i
        WHERE i.business_id = $1
          AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = i.purchase_order_id)`,
      [tenant.user.businessId],
    );
    assert.equal(orphans.rows[0]!.count, '0');
  });

  it('leaves no order behind when the product is inactive', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-INACTIVE');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);

    const retire = await tenant.client.delete(`/api/products/${productId}`);
    assert.ok(retire.status === 200 || retire.status === 204, String(retire.status));

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });

    assert.ok(response.status === 409 || response.status === 400, String(response.status));
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore,
      'an inactive product must not produce an order',
    );
  });

  it('records a rejected attempt as FAILED with no purchase order', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedHealthyProduct(tenant, 'ACT-FAILEDAUDIT');

    await tenant.client.post<ActionEnvelope>('/api/actions', { productId, supplierId, quantity: '10' });

    const rows = await getPool().query<{ status: string; purchase_order_id: string | null; failure_reason: string | null }>(
      'SELECT status, purchase_order_id, failure_reason FROM actions WHERE business_id = $1',
      [tenant.user.businessId],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.status, 'FAILED');
    assert.equal(rows.rows[0]!.purchase_order_id, null);
    assert.ok((rows.rows[0]!.failure_reason ?? '').length > 0);
  });
});

describe('Action Center — idempotency', () => {
  it('replays the stored result for a repeated key and creates one order', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-IDEM');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);
    const headers = { 'Idempotency-Key': 'order-key-1' };
    const body = { productId, supplierId, quantity: '100' };

    const first = await tenant.client.post<ActionEnvelope>('/api/actions', body, { headers });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await tenant.client.post<ActionEnvelope>('/api/actions', body, { headers });
    assert.equal(second.status, 200, JSON.stringify(second.body));

    // Same action, same order — not a second one.
    assert.equal(second.body.data.action.id, first.body.data.action.id);
    assert.equal(second.body.data.action.purchaseOrderId, first.body.data.action.purchaseOrderId);
    assert.equal(second.body.data.purchaseOrder!.id, first.body.data.purchaseOrder!.id);
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore + 1,
      'a replayed key must not raise a second order',
    );
    assert.equal(await countRows('actions', tenant.user.businessId), 1);
  });

  it('refuses a key replayed with different data rather than lying about the order', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-IDEM-CONFLICT');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);
    const headers = { 'Idempotency-Key': 'order-key-2' };

    const first = await tenant.client.post<ActionEnvelope>(
      '/api/actions',
      { productId, supplierId, quantity: '100' },
      { headers },
    );
    assert.equal(first.status, 201);

    const second = await tenant.client.post<ActionEnvelope>(
      '/api/actions',
      { productId, supplierId, quantity: '250' },
      { headers },
    );

    assert.equal(second.status, 409, JSON.stringify(second.body));
    // The original order is untouched — the conflicting request changed nothing.
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore + 1,
    );
    const line = await getPool().query<{ quantity: string }>(
      'SELECT quantity::text AS quantity FROM purchase_order_items WHERE purchase_order_id = $1',
      [first.body.data.action.purchaseOrderId],
    );
    assert.equal(line.rows[0]!.quantity, '100.00');
  });

  it('rolls back the whole transaction when a concurrent request wins the key', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-RACE');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);
    // Remember what existed *before* the race, so the orphan check below cannot
    // count the fixture's six legitimate lead-time orders as leftovers.
    const preexisting = await getPool().query<{ id: string }>(
      'SELECT id FROM purchase_orders WHERE business_id = $1',
      [tenant.user.businessId],
    );
    const preexistingIds = preexisting.rows.map((row) => row.id);
    const headers = { 'Idempotency-Key': 'race-key' };
    const body = { productId, supplierId, quantity: '100' };

    // Five simultaneous submissions, exactly as a double-clicking button produces.
    // This is the case that motivated the savepoint-and-rollback design: without a
    // statement-level savepoint the losers cannot read the winner's row, and
    // without a whole-transaction rollback they commit a purchase order nobody
    // asked for.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => tenant.client.post<ActionEnvelope>('/api/actions', body, { headers })),
    );

    // Exactly one order, and exactly one audit row.
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore + 1,
      'only the winning request may leave an order behind',
    );
    assert.equal(await countRows('actions', tenant.user.businessId), 1, 'one audit row, not five');

    // Nobody is left holding a 500, and everyone who succeeded got the same answer.
    for (const response of responses) {
      assert.ok(
        response.status === 200 || response.status === 201,
        `a concurrent submission answered ${response.status}`,
      );
    }
    const ids = new Set(responses.map((response) => response.body.data.action.id));
    assert.equal(ids.size, 1, 'every caller is told about the same single action');

    const after = await getPool().query<{ id: string }>(
      'SELECT id FROM purchase_orders WHERE business_id = $1',
      [tenant.user.businessId],
    );
    const newIds = after.rows.map((row) => row.id).filter((id) => !preexistingIds.includes(id));
    assert.equal(newIds.length, 1, 'exactly one new order exists');

    const orphans = await getPool().query<{ c: string }>(
      `SELECT count(*)::text AS c FROM purchase_order_items i
        WHERE i.business_id = $1
          AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = i.purchase_order_id)`,
      [tenant.user.businessId],
    );
    assert.equal(
      Number(orphans.rows[0]!.c),
      0,
      'no line may survive from a rolled-back order',
    );

    const unlinked = await getPool().query<{ c: string }>(
      `SELECT count(*)::text AS c FROM purchase_orders po
        WHERE po.business_id = $1
          AND po.id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.purchase_order_id = po.id)`,
      [tenant.user.businessId, newIds],
    );
    assert.equal(
      Number(unlinked.rows[0]!.c),
      0,
      'the surviving order must be the one the audit row points at',
    );
  });

  it('creates independent orders when no key is sent', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-NOKEY');
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);
    const body = { productId, supplierId, quantity: '100' };

    const first = await tenant.client.post<ActionEnvelope>('/api/actions', body);
    const second = await tenant.client.post<ActionEnvelope>('/api/actions', body);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.data.action.id, second.body.data.action.id);
    assert.equal(
      await countRows('purchase_orders', tenant.user.businessId),
      ordersBefore + 2,
      'two keyless requests are two independent orders',
    );
  });

  it('does not consume the key when the attempt was rejected', async () => {
    const tenant = await createTenant(server);

    // A product with a *measured* supplier but comfortable stock: the reorder
    // engine can compute a reorder point and still find nothing wrong, so the
    // action is correctly refused. Settling stock down later then creates a real
    // REPLENISH, which is what makes the retry meaningful.
    const { productId, supplierId } = await seedMeasuredButCoveredProduct(
      tenant,
      'ACT-IDEM-FAILED',
    );
    const headers = { 'Idempotency-Key': 'retry-key' };

    const first = await tenant.client.post<ActionEnvelope>(
      '/api/actions',
      { productId, supplierId, quantity: '100' },
      { headers },
    );
    assert.equal(first.status, 409);

    // The user fixes the underlying problem by drawing stock down, then retries
    // with the same key. A failed attempt must not block a good one.
    await settleStock(tenant, productId, '50');
    const second = await tenant.client.post<ActionEnvelope>(
      '/api/actions',
      { productId, supplierId, quantity: '100' },
      { headers },
    );

    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.data.action.status, 'COMPLETED');
    // The rejected attempt left a FAILED row that did not take the key.
    const rows = await getPool().query<{ status: string }>(
      'SELECT status FROM actions WHERE business_id = $1 ORDER BY created_at',
      [tenant.user.businessId],
    );
    assert.deepEqual(
      rows.rows.map((row) => row.status),
      ['FAILED', 'COMPLETED'],
    );
  });
});

describe('Action Center — tenancy', () => {
  it('cannot act on another tenant’s product or supplier', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenantA, 'ACT-ISO');

    const response = await tenantB.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });

    assert.equal(response.status, 404, JSON.stringify(response.body));
    // Tenant A's own orders are untouched, and tenant B created nothing at all.
    assert.equal(await countRows('purchase_orders', tenantA.user.businessId), 6);
    assert.equal(await countRows('purchase_orders', tenantB.user.businessId), 0);
    assert.equal(await countRows('actions', tenantB.user.businessId), 0);
  });

  it('cannot mix another tenant’s product with its own supplier', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const { productId } = await seedActionableProduct(tenantA, 'ACT-MIXA');
    const ownSupplier = await createSupplier(tenantB, 'B Supplier');

    const response = await tenantB.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId: ownSupplier,
      quantity: '100',
    });

    assert.ok(response.status === 404 || response.status === 409, String(response.status));
    assert.equal(await countRows('purchase_orders', tenantB.user.businessId), 0);
  });

  it('shows a tenant only its own action history', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const a = await seedActionableProduct(tenantA, 'ACT-HIST-A');
    const b = await seedActionableProduct(tenantB, 'ACT-HIST-B');

    await tenantA.client.post<ActionEnvelope>('/api/actions', {
      productId: a.productId,
      supplierId: a.supplierId,
      quantity: '100',
    });

    const history = await tenantB.client.get<{ data: { items: CreatedAction[] } }>('/api/actions');
    assert.equal(history.status, 200);
    assert.equal(history.body.data.items.length, 0);

    const own = await tenantA.client.get<{ data: { items: CreatedAction[] } }>('/api/actions');
    assert.equal(own.body.data.items.length, 1);
    assert.equal(own.body.data.items[0]!.productId, a.productId);
    assert.ok(!JSON.stringify(own.body).includes(b.productId));
  });

  it('cannot read another tenant’s history by forging a businessId filter', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const a = await seedActionableProduct(tenantA, 'ACT-FORGE-A');
    await tenantA.client.post<ActionEnvelope>('/api/actions', {
      productId: a.productId,
      supplierId: a.supplierId,
      quantity: '100',
    });

    const response = await tenantB.client.get(
      `/api/actions?businessId=${tenantA.user.businessId}`,
    );
    assert.equal(response.status, 400);
  });
});

describe('Action Center — authorization and surface', () => {
  it('requires authentication', async () => {
    const response = await server.client().get('/api/actions');
    assert.equal(response.status, 401);

    const post = await server.client().post('/api/actions', {
      productId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      supplierId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
      quantity: '10',
    });
    assert.equal(post.status, 401);
  });

  it('is writable by staff, matching purchase-order authorization', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-STAFF');
    const staff = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });

    // The purchase-order module is open to any authenticated member, so the action
    // module is too — a stricter gate here would be a policy change in the wrong place.
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.action.userId, staff.user.id);
  });

  it('exposes no update or delete route', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-NOWRITE');
    const created = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    const actionId = created.body.data.action.id;

    for (const [method, path] of [
      ['put', '/api/actions'],
      ['patch', '/api/actions'],
      ['delete', '/api/actions'],
      ['put', `/api/actions/${actionId}`],
      ['patch', `/api/actions/${actionId}`],
      ['delete', `/api/actions/${actionId}`],
    ] as const) {
      const response = await tenant.client[method](path);
      assert.equal(response.status, 404, `${method.toUpperCase()} ${path} returned ${response.status}`);
    }
  });
});

describe('Action Center — request validation', () => {
  it('rejects malformed and out-of-range input', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-VALID');

    // The fixture itself raises purchase orders to measure lead time, so the
    // invariant is "no *new* order", measured as a delta.
    const ordersBefore = await countRows('purchase_orders', tenant.user.businessId);

    const cases: Array<[string, unknown]> = [
      ['missing productId', { supplierId, quantity: '10' }],
      ['missing supplierId', { productId, quantity: '10' }],
      ['missing quantity', { productId, supplierId }],
      ['non-uuid productId', { productId: 'nope', supplierId, quantity: '10' }],
      ['non-uuid supplierId', { productId, supplierId: 'nope', quantity: '10' }],
      ['zero quantity', { productId, supplierId, quantity: '0' }],
      ['negative quantity', { productId, supplierId, quantity: '-5' }],
      ['non-numeric quantity', { productId, supplierId, quantity: 'ten' }],
      ['numeric quantity (floats are not accepted)', { productId, supplierId, quantity: 10 }],
      ['quantity with 3 decimals', { productId, supplierId, quantity: '10.123' }],
      ['unknown key', { productId, supplierId, quantity: '10', supplierSwitch: true }],
      ['attempted actionType override', { productId, supplierId, quantity: '10', actionType: 'DELETE_PRODUCT' }],
      ['attempted status override', { productId, supplierId, quantity: '10', status: 'APPROVED' }],
    ];

    for (const [label, body] of cases) {
      const response = await tenant.client.post('/api/actions', body);
      assert.equal(response.status, 400, `${label} should be rejected, got ${response.status}`);
    }

    assert.equal(await countRows('purchase_orders', tenant.user.businessId), ordersBefore);
    assert.equal(await countRows('actions', tenant.user.businessId), 0);
  });

  it('rejects unknown query parameters on the history endpoint', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/actions?businessId=x')).status, 400);
    assert.equal((await tenant.client.get('/api/actions?orderBy=id')).status, 400);
    assert.equal((await tenant.client.get('/api/actions?status=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/actions?actionType=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/actions?page=0')).status, 400);
    assert.equal((await tenant.client.get('/api/actions?limit=0')).status, 400);
  });
});

describe('Action Center — audit trail', () => {
  it('records enough to explain the order later, without the live intelligence', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-AUDIT');

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '150',
    });
    assert.equal(response.status, 201);

    const row = await getPool().query<{
      source_recommendation_type: string;
      source_recommendation_id: string;
      source_recommendation_context: Record<string, unknown>;
      recommended_quantity: string;
    }>(
      `SELECT source_recommendation_type, source_recommendation_id, source_recommendation_context,
              recommended_quantity
         FROM actions WHERE id = $1`,
      [response.body.data.action.id],
    );
    const record = row.rows[0]!;

    assert.equal(record.source_recommendation_type, 'REPLENISH');
    assert.equal(record.source_recommendation_id, `${productId}:REPLENISH`);

    // The stored context is compact traceability, not a copy of the snapshot.
    const context = record.source_recommendation_context;
    assert.equal(context['type'], 'REPLENISH');
    assert.equal(context['recommendedQuantity'], record.recommended_quantity);
    assert.deepEqual(context['sourceDecisions'], ['REORDER']);
    assert.ok(!('stockRisk' in context), 'the whole intelligence snapshot must not be stored');
    assert.ok(!('explanation' in context), 'raw explanation blobs must not be stored');
  });

  it('lists history newest first with working pagination and filters', async () => {
    const tenant = await createTenant(server);
    const a = await seedActionableProduct(tenant, 'ACT-PAGE-A');
    const b = await seedActionableProduct(tenant, 'ACT-PAGE-B');

    await tenant.client.post('/api/actions', { productId: a.productId, supplierId: a.supplierId, quantity: '100' });
    await tenant.client.post('/api/actions', { productId: b.productId, supplierId: b.supplierId, quantity: '100' });
    await tenant.client.post('/api/actions', { productId: a.productId, supplierId: a.supplierId, quantity: '100' });

    const all = await tenant.client.get<{
      data: { items: CreatedAction[]; pagination: { total: number; page: number; limit: number } };
    }>('/api/actions?limit=50');
    assert.equal(all.body.data.pagination.total, 3);

    // Newest first.
    const timestamps = all.body.data.items.map((item) => Date.parse(item.createdAt));
    assert.deepEqual(timestamps, [...timestamps].sort((x, y) => y - x));

    const byProduct = await tenant.client.get<{ data: { items: CreatedAction[] } }>(
      `/api/actions?productId=${a.productId}`,
    );
    assert.equal(byProduct.body.data.items.length, 2);
    assert.ok(byProduct.body.data.items.every((item) => item.productId === a.productId));

    const completed = await tenant.client.get<{ data: { items: CreatedAction[] } }>(
      '/api/actions?status=COMPLETED',
    );
    assert.equal(completed.body.data.items.length, 3);

    const paged = await tenant.client.get<{
      data: { items: CreatedAction[]; pagination: { total: number; page: number } };
    }>('/api/actions?limit=2&page=1');
    assert.equal(paged.body.data.items.length, 2);
    assert.equal(paged.body.data.pagination.total, 3);
  });

  it('never reconstructs the justification from today’s intelligence', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedActionableProduct(tenant, 'ACT-IMMUTABLE');

    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    const recordedConfidence = response.body.data.action.sourceRecommendationContext['confidence'];

    // Change the underlying facts so today's intelligence would say something else.
    await getPool().query(
      `UPDATE actions SET source_recommendation_context = source_recommendation_context || '{"confidence":"MUTATED"}'::jsonb
        WHERE business_id = $1`,
      [tenant.user.businessId],
    );

    const history = await tenant.client.get<{ data: { items: CreatedAction[] } }>('/api/actions');
    assert.equal(history.body.data.items[0]!.sourceRecommendationContext['confidence'], 'MUTATED');
    // The stored value is what is read back; no live evaluation is involved.
    assert.equal(recordedConfidence !== undefined, true);
  });
});

describe('Action Center — action detail', () => {
  /** Create one real action and return its id, to read back by detail. */
  async function createOne(tenant: Tenant, sku: string): Promise<string> {
    const { productId, supplierId } = await seedActionableProduct(tenant, sku);
    const response = await tenant.client.post<ActionEnvelope>('/api/actions', {
      productId,
      supplierId,
      quantity: '100',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.data.action.id;
  }

  it('lets the owning business read its own action', async () => {
    const tenant = await createTenant(server);
    const actionId = await createOne(tenant, 'ACT-DETAIL');

    const response = await tenant.client.get<ActionEnvelope>(`/api/actions/${actionId}`);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.action.id, actionId);
    assert.equal(response.body.data.action.status, 'COMPLETED');
    assert.equal(response.body.data.action.businessId, tenant.user.businessId);
  });

  it('returns the purchase order the action produced', async () => {
    const tenant = await createTenant(server);
    const actionId = await createOne(tenant, 'ACT-DETAIL-ORDER');

    const response = await tenant.client.get<ActionEnvelope>(`/api/actions/${actionId}`);

    // The detail document is structurally identical to the creation response, so a
    // client can re-fetch an action later and get the same shape it first received.
    assert.ok(response.body.data.purchaseOrder, 'the draft order must be included');
    assert.equal(response.body.data.action.purchaseOrderId, response.body.data.purchaseOrder!.id);
    assert.equal(response.body.data.purchaseOrder!.status, 'draft');
    assert.equal(response.body.data.purchaseOrder!.items.length, 1);
    assert.equal(response.body.data.purchaseOrder!.items[0]!.quantity, '100.00');
  });

  it('lets staff in the same business read the action', async () => {
    const tenant = await createTenant(server);
    const actionId = await createOne(tenant, 'ACT-DETAIL-STAFF');
    const staff = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.client.get<ActionEnvelope>(`/api/actions/${actionId}`);

    // Read authorization mirrors write authorization: the module is open to any
    // authenticated member of the business.
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.action.id, actionId);
  });

  it('returns the recorded justification, not a fresh evaluation', async () => {
    const tenant = await createTenant(server);
    const actionId = await createOne(tenant, 'ACT-DETAIL-STAMP');

    const recorded = await tenant.client.get<ActionEnvelope>(`/api/actions/${actionId}`);
    const recordedConfidence = recorded.body.data.action.sourceRecommendationContext['confidence'];
    assert.ok(recordedConfidence, 'the action must carry the confidence it was created with');

    await getPool().query(
      `UPDATE actions SET source_recommendation_context = source_recommendation_context || '{"confidence":"MUTATED"}'::jsonb
        WHERE id = $1`,
      [actionId],
    );

    const reread = await tenant.client.get<ActionEnvelope>(`/api/actions/${actionId}`);
    assert.equal(
      reread.body.data.action.sourceRecommendationContext['confidence'],
      'MUTATED',
      'the stored context is returned verbatim; no live intelligence is consulted',
    );
  });

  it('returns 404 for an unknown action', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/actions/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  it('returns 400 for a malformed action id', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get('/api/actions/not-a-uuid');

    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  it('returns 404 for another tenant’s action and leaks nothing', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const actionId = await createOne(tenantA, 'ACT-DETAIL-ISO');

    const response = await tenantB.client.get(`/api/actions/${actionId}`);

    assert.equal(response.status, 404, JSON.stringify(response.body));

    // The refusal must be indistinguishable from "no such id", and must carry no
    // trace of the other tenant: not the action id, not the business id, not any
    // product, supplier or quantity.
    const serialised = JSON.stringify(response.body);
    assert.ok(!serialised.includes(actionId), 'the action id leaked');
    assert.ok(!serialised.includes(tenantA.user.businessId), 'the business id leaked');
    assert.ok(!serialised.includes(tenantA.user.id), "the other tenant's user id leaked");
    assert.ok(!serialised.includes('REPLENISH'), 'the decision kind leaked');
    assert.ok(!serialised.includes('100.00'), 'the quantity leaked');

    // And it is the very same body an unknown id produces.
    const unknown = await tenantB.client.get(
      '/api/actions/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
    assert.deepEqual(response.body, unknown.body, 'cross-tenant and unknown must be indistinguishable');
  });

  it('cannot be steered at another tenant by a businessId parameter', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const actionId = await createOne(tenantA, 'ACT-DETAIL-FORGED');

    for (const query of [
      `?businessId=${tenantA.user.businessId}`,
      '?businessId=00000000-0000-0000-0000-000000000000',
    ]) {
      const response = await tenantB.client.get(`/api/actions/${actionId}${query}`);
      // `businessId` is not an accepted parameter, so it is either rejected outright
      // or ignored — in neither case may it widen the scope of the lookup.
      assert.ok(
        response.status === 400 || response.status === 404,
        `${query} returned ${response.status}`,
      );
      assert.ok(
        !JSON.stringify(response.body).includes(actionId),
        'the parameter must never surface another tenant’s action',
      );
    }
  });

  it('requires authentication', async () => {
    const response = await server.client().get(
      '/api/actions/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
    assert.equal(response.status, 401);
  });

  it('is read-only — no verb may change a recorded action', async () => {
    const tenant = await createTenant(server);
    const actionId = await createOne(tenant, 'ACT-DETAIL-RO');

    const snapshot = await getPool().query<Record<string, string | number | null>>(
      'SELECT quantity::text, recommended_quantity::text, status, failure_reason, updated_at::text FROM actions WHERE id = $1',
      [actionId],
    );
    const before = JSON.stringify(snapshot.rows[0]);

    for (const [method, body] of [
      ['put', { status: 'APPROVED' }],
      ['patch', { quantity: '9999.00' }],
      ['delete', undefined],
      ['post', { approved: true }],
    ] as const) {
      const response = await tenant.client[method](`/api/actions/${actionId}`, body as never);
      assert.equal(
        response.status,
        404,
        `${method.toUpperCase()} /api/actions/:id must not exist, got ${response.status}`,
      );
    }

    const after = await getPool().query<Record<string, string | number | null>>(
      'SELECT quantity::text, recommended_quantity::text, status, failure_reason, updated_at::text FROM actions WHERE id = $1',
      [actionId],
    );
    assert.deepEqual(after.rows[0], snapshot.rows[0], 'the audit row must be untouched');
    assert.equal(JSON.stringify(after.rows[0]), before);
  });

  it('agrees with the list endpoint for the same action', async () => {
    const tenant = await createTenant(server);
    const actionId = await createOne(tenant, 'ACT-DETAIL-LIST');

    const detail = await tenant.client.get<ActionEnvelope>(`/api/actions/${actionId}`);
    const history = await tenant.client.get<{ data: { items: CreatedAction[] } }>('/api/actions');

    const listed = history.body.data.items.find((item) => item.id === actionId);
    assert.ok(listed, 'the action must appear in the history');
    assert.deepEqual(listed, detail.body.data.action, 'detail and list must describe the same row');
  });
});