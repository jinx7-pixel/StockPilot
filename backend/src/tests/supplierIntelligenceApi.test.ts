/**
 * Supplier Intelligence API — integration tests.
 *
 * Exercises the real HTTP surface against the real database: authentication,
 * tenant isolation, filters, pagination, and the pre-aggregated SQL that keeps a
 * multi-line purchase order from contributing its units once per line. The
 * supplier rules are proven separately in `supplierIntelligence.test.ts`.
 *
 * Purchase orders are created through the API and their timestamps backdated
 * with SQL, because the API deliberately refuses to accept timestamps from a
 * client and there is no other way to manufacture a measured lead time.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface SupplierEntry {
  supplierId: string;
  supplierName: string;
  isActive: boolean;
  completedPOCount: number;
  openPOCount: number;
  cancelledPOCount: number;
  draftPOCount: number;
  totalUnitsOrdered: string;
  totalUnitsReceived: string;
  medianLeadTimeDays: string | null;
  p90LeadTimeDays: string | null;
  leadTimeSampleCount: number;
  leadTimeCV: string | null;
  stability: string;
  priority: number;
  confidence: string;
  reason: string;
  evidence: {
    completedPOCount: number;
    leadTimeSampleCount: number;
    minimumSamplesForVariability: number;
    stableMaxCoefficientOfVariation: string;
    minLeadTimeDays: string | null;
    maxLeadTimeDays: string | null;
    hasPromisedDeliveryDate: boolean;
  };
  leadTimeObservations?: Array<{
    purchaseOrderId: string;
    orderedAt: string;
    receivedAt: string;
    leadTimeDays: string;
  }>;
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

async function createProduct(tenant: Tenant): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({}),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createSupplier(
  tenant: Tenant,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', {
    name: `SI Supplier ${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/** Backdate a received order so it carries a measured lead time. */
async function backdateLeadTime(orderId: string, days: number): Promise<void> {
  await getPool().query(
    `UPDATE purchase_orders SET ordered_at = received_at - ($2 || ' days')::interval WHERE id = $1`,
    [orderId, String(days)],
  );
}

interface OrderLine {
  productId: string;
  quantity: string;
  /** Omit to receive the whole line. */
  received?: string;
}

interface OrderOptions {
  leadTimeDays?: number;
  /** Leave the order in draft, with no timestamps at all. */
  asDraft?: boolean;
  /** Receive the order without inventing a lead time. */
  receiveOnly?: boolean;
  lines?: OrderLine[];
}

/** Create an order through the API and drive it to the requested state. */
async function createOrder(
  tenant: Tenant,
  supplierId: string,
  productId: string,
  options: OrderOptions = {},
): Promise<string> {
  const lines: OrderLine[] = options.lines ?? [{ productId, quantity: '100' }];

  const created = await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
    supplierId,
    items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitCost: '5.00' })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.data.id;

  if (options.asDraft) return orderId;

  const ordered = await tenant.client.post(`/api/purchase-orders/${orderId}/order`);
  assert.equal(ordered.status, 200, JSON.stringify(ordered.body));

  if (options.leadTimeDays === undefined && !options.receiveOnly) {
    // Ordered and left open.
    return orderId;
  }

  const received = await tenant.client.post(`/api/purchase-orders/${orderId}/receive`, {
    items: lines.map((line) => ({
      productId: line.productId,
      quantity: line.received ?? line.quantity,
    })),
  });
  assert.equal(received.status, 201, JSON.stringify(received.body));

  if (options.leadTimeDays !== undefined && options.leadTimeDays > 0) {
    await backdateLeadTime(orderId, options.leadTimeDays);
  }
  return orderId;
}

async function cancelOrder(orderId: string): Promise<void> {
  await getPool().query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
}

async function listSuppliers(
  tenant: Tenant,
  query = '',
): Promise<{ data: SupplierEntry[]; meta: Meta; stabilityCounts: Record<string, number> }> {
  const response = await tenant.client.get<{
    data: SupplierEntry[];
    meta: Meta;
    stabilityCounts: Record<string, number>;
  }>(`/api/intelligence/suppliers${query}`);
  assert.equal(response.status, 200, `list failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

function find(items: SupplierEntry[], name: string): SupplierEntry {
  const entry = items.find((item) => item.supplierName === name);
  assert.ok(entry, `no entry for ${name}`);
  return entry;
}

/** A supplier with `leadTimes` completed deliveries at the given days. */
async function seedSupplier(
  tenant: Tenant,
  name: string,
  leadTimes: readonly number[],
  productId: string,
): Promise<string> {
  const supplierId = await createSupplier(tenant, { name });
  for (const days of leadTimes) {
    await createOrder(tenant, supplierId, productId, { leadTimeDays: days });
  }
  return supplierId;
}

async function countRows(): Promise<Record<string, number>> {
  const result = await getPool().query<Record<string, number>>(
    `SELECT
       (SELECT count(*) FROM suppliers)::int            AS suppliers,
       (SELECT count(*) FROM products)::int             AS products,
       (SELECT count(*) FROM categories)::int           AS categories,
       (SELECT count(*) FROM inventory_movements)::int  AS inventory_movements,
       (SELECT count(*) FROM sales)::int                AS sales,
       (SELECT count(*) FROM sale_items)::int           AS sale_items,
       (SELECT count(*) FROM purchase_orders)::int      AS purchase_orders,
       (SELECT count(*) FROM purchase_order_items)::int AS purchase_order_items`,
  );
  return result.rows[0] ?? {};
}

// ---------------------------------------------------------------------------

describe('GET /api/intelligence/suppliers — integration', () => {
  it('measures a consistent supplier as STABLE with HIGH confidence', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await seedSupplier(tenant, 'Stable Supplier', [5, 6, 5, 7, 6, 5], productId);

    const entry = find((await listSuppliers(tenant)).data, 'Stable Supplier');

    assert.equal(entry.completedPOCount, 6);
    assert.equal(entry.leadTimeSampleCount, 6);
    assert.equal(entry.medianLeadTimeDays, '5.50');
    assert.equal(entry.p90LeadTimeDays, '7.00');
    assert.equal(entry.leadTimeCV, '0.13');
    assert.equal(entry.stability, 'STABLE');
    assert.equal(entry.confidence, 'HIGH');
    assert.equal(entry.priority, 0);
  });

  it('measures an erratic supplier as VARIABLE, still with HIGH confidence', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await seedSupplier(tenant, 'Erratic Supplier', [5, 20, 7, 25, 6, 22], productId);

    const entry = find((await listSuppliers(tenant)).data, 'Erratic Supplier');

    assert.equal(entry.stability, 'VARIABLE');
    assert.equal(entry.confidence, 'HIGH', 'stability and confidence are separate axes');
    assert.equal(entry.leadTimeCV, '0.58');
    assert.equal(entry.priority, 60);
    assert.equal(entry.evidence.minLeadTimeDays, '5.00');
    assert.equal(entry.evidence.maxLeadTimeDays, '25.00');
  });

  it('reports a supplier with two orders as LOW confidence and no stability verdict', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await seedSupplier(tenant, 'Thin Supplier', [5, 9], productId);

    const entry = find((await listSuppliers(tenant)).data, 'Thin Supplier');

    assert.equal(entry.completedPOCount, 2);
    assert.equal(entry.confidence, 'LOW');
    assert.equal(entry.stability, 'INSUFFICIENT_DATA');
    assert.equal(entry.leadTimeCV, null);
    assert.equal(entry.medianLeadTimeDays, '7.00', 'the median still reports');
  });

  it('reports a supplier with no completed orders as entirely unmeasured', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const supplierId = await createSupplier(tenant, { name: 'Never Delivered' });
    await createOrder(tenant, supplierId, productId, { asDraft: true });
    await createOrder(tenant, supplierId, productId);

    const entry = find((await listSuppliers(tenant)).data, 'Never Delivered');

    assert.equal(entry.completedPOCount, 0);
    assert.equal(entry.openPOCount, 1);
    assert.equal(entry.draftPOCount, 1);
    assert.equal(entry.confidence, 'INSUFFICIENT');
    assert.equal(entry.stability, 'INSUFFICIENT_DATA');
    assert.equal(entry.medianLeadTimeDays, null);
    assert.equal(entry.p90LeadTimeDays, null);
    assert.equal(entry.evidence.hasPromisedDeliveryDate, false);
  });

  it('counts each purchase-order state into its own bucket, drafts into none', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const supplierId = await createSupplier(tenant, { name: 'Mixed States' });

    await createOrder(tenant, supplierId, productId, { asDraft: true });
    await createOrder(tenant, supplierId, productId, { asDraft: true });
    await createOrder(tenant, supplierId, productId, { leadTimeDays: 4 });
    await createOrder(tenant, supplierId, productId, { leadTimeDays: 6 });
    await createOrder(tenant, supplierId, productId);
    await createOrder(tenant, supplierId, productId);
    const cancelled = await createOrder(tenant, supplierId, productId, { leadTimeDays: 5 });
    await cancelOrder(cancelled);

    const entry = find((await listSuppliers(tenant)).data, 'Mixed States');

    assert.equal(entry.draftPOCount, 2);
    assert.equal(entry.completedPOCount, 2, 'the cancelled order is not completed');
    assert.equal(entry.openPOCount, 2);
    assert.equal(entry.cancelledPOCount, 1);
    assert.equal(entry.leadTimeSampleCount, 2, 'cancelled orders contribute no lead time');
  });

  it('counts multi-line orders once rather than once per line', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const supplierId = await createSupplier(tenant, { name: 'Multi Line' });

    const second = await createProduct(tenant);
    const third = await createProduct(tenant);
    await createOrder(tenant, supplierId, productId, {
      leadTimeDays: 5,
      lines: [
        { productId, quantity: '100' },
        { productId: second, quantity: '50' },
        { productId: third, quantity: '25' },
      ],
    });

    const entry = find((await listSuppliers(tenant)).data, 'Multi Line');

    assert.equal(entry.totalUnitsOrdered, '175.00', '100 + 50 + 25, not 175 x 3 lines');
    assert.equal(entry.totalUnitsReceived, '175.00');
  });

  it('reports ordered and received units separately for a partial delivery', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const supplierId = await createSupplier(tenant, { name: 'Partial' });

    await createOrder(tenant, supplierId, productId, {
      receiveOnly: true,
      lines: [{ productId, quantity: '200', received: '120' }],
    });

    const entry = find((await listSuppliers(tenant)).data, 'Partial');

    assert.equal(entry.totalUnitsOrdered, '200.00');
    assert.equal(entry.totalUnitsReceived, '120.00');
    assert.equal(entry.openPOCount, 1, 'a partial delivery is still open');
  });

  it('returns an empty result set for a tenant with no suppliers', async () => {
    const tenant = await createTenant(server);

    const body = await listSuppliers(tenant);

    assert.deepEqual(body.data, []);
    assert.equal(body.meta.total, 0);
    assert.deepEqual(body.stabilityCounts, {});
  });
});

describe('GET /api/intelligence/suppliers — filters and pagination', () => {
  it('filters by stability and confidence', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await seedSupplier(tenant, 'Stable Co', [5, 6, 5, 7, 6, 5], productId);
    await seedSupplier(tenant, 'Erratic Co', [5, 20, 7, 25, 6, 22], productId);
    await seedSupplier(tenant, 'Thin Co', [5, 9], productId);

    const stable = await listSuppliers(tenant, '?stability=STABLE');
    assert.equal(stable.meta.total, 1);
    assert.equal(stable.data[0]?.supplierName, 'Stable Co');

    const variable = await listSuppliers(tenant, '?stability=VARIABLE');
    assert.equal(variable.meta.total, 1);
    assert.equal(variable.data[0]?.supplierName, 'Erratic Co');

    assert.equal((await listSuppliers(tenant, '?stability=INSUFFICIENT_DATA')).meta.total, 1);

    const low = await listSuppliers(tenant, '?confidence=LOW');
    assert.equal(low.meta.total, 1);
    assert.equal(low.data[0]?.supplierName, 'Thin Co');

    assert.equal((await listSuppliers(tenant, '?confidence=HIGH')).meta.total, 2);
  });

  it('filters by search and active status', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant, { name: 'Northwind Tools' });
    const inactive = await createSupplier(tenant, { name: 'Southgate Tools' });
    const deactivated = await tenant.client.patch(`/api/suppliers/${inactive}`, {
      isActive: false,
    });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));

    assert.equal((await listSuppliers(tenant, '?search=Northwind')).meta.total, 1);
    assert.equal((await listSuppliers(tenant, '?search=Tools')).meta.total, 2);
    assert.equal((await listSuppliers(tenant, '?isActive=true')).meta.total, 1);
    assert.equal((await listSuppliers(tenant, '?isActive=false')).meta.total, 1);
  });

  it('paginates', async () => {
    const tenant = await createTenant(server);
    for (let index = 0; index < 5; index += 1) {
      await createSupplier(tenant, { name: `Paged ${index}` });
    }

    const page = await listSuppliers(tenant, '?page=2&limit=2');

    assert.equal(page.meta.total, 5);
    assert.equal(page.meta.page, 2);
    assert.equal(page.meta.totalPages, 3);
    assert.equal(page.data.length, 2);
  });

  it('returns a valid empty page past the end', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant, { name: 'Only One' });

    const page = await listSuppliers(tenant, '?page=9&limit=10');

    assert.deepEqual(page.data, []);
    assert.equal(page.meta.total, 1);
  });

  it('rejects invalid enums, pagination, businessId and orderBy', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/suppliers?stability=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/suppliers?confidence=NOPE')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/suppliers?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/intelligence/suppliers?page=0')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/intelligence/suppliers?businessId=other')).status,
      400,
      'the tenant is never client-controlled',
    );
    assert.equal((await tenant.client.get('/api/intelligence/suppliers?orderBy=1')).status, 400);
  });

  it('treats a SQL-injection search term as a literal', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant, { name: 'Injected' });

    const response = await tenant.client.get<{ data: SupplierEntry[] }>(
      `/api/intelligence/suppliers?search=${encodeURIComponent("' ; DROP TABLE suppliers --")}`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);

    const tables = await getPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'suppliers'`,
    );
    assert.equal(tables.rows[0]?.count, 1, 'the suppliers table is intact');
  });
});

describe('GET /api/intelligence/suppliers/:supplierId', () => {
  it('returns the summary plus the observations behind it', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    const supplierId = await seedSupplier(tenant, 'Observed Co', [5, 6, 7], productId);

    const response = await tenant.client.get<{ data: SupplierEntry }>(
      `/api/intelligence/suppliers/${supplierId}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.supplierId, supplierId);
    assert.equal(response.body.data.medianLeadTimeDays, '6.00');
    assert.equal(response.body.data.leadTimeSampleCount, 3);

    const observations = response.body.data.leadTimeObservations ?? [];
    assert.equal(observations.length, 3);
    for (const observation of observations) {
      assert.ok(observation.purchaseOrderId, 'an order id is shown');
      assert.ok(Date.parse(observation.orderedAt) > 0, 'ordered timestamp is shown');
      assert.ok(Date.parse(observation.receivedAt) > 0, 'received timestamp is shown');
      assert.match(observation.leadTimeDays, /^\d+(\.\d+)?$/);
    }

    // The detail and the list must agree.
    const listed = find((await listSuppliers(tenant)).data, 'Observed Co');
    assert.equal(listed.medianLeadTimeDays, response.body.data.medianLeadTimeDays);
    assert.equal(listed.leadTimeCV, response.body.data.leadTimeCV);
    assert.equal(listed.stability, response.body.data.stability);
    assert.equal(listed.confidence, response.body.data.confidence);
  });

  it('exposes no supplier contact details', async () => {
    const tenant = await createTenant(server);
    const supplierId = await createSupplier(tenant, {
      name: 'Private Co',
      email: 'private@example.com',
      phone: '+1-555-0100',
      address: '1 Example Way',
    });

    const response = await tenant.client.get<{ data: Record<string, unknown> }>(
      `/api/intelligence/suppliers/${supplierId}`,
    );

    const body = JSON.stringify(response.body);
    assert.ok(!body.includes('private@example.com'), 'email is not exposed');
    assert.ok(!body.includes('555-0100'), 'phone is not exposed');
    assert.ok(!body.includes('Example Way'), 'address is not exposed');
  });

  it('answers 404 for a supplier that does not exist', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/intelligence/suppliers/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('rejects a malformed supplier id with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/intelligence/suppliers/not-a-uuid')).status, 400);
  });
});

describe('supplier intelligence security', () => {
  it('rejects unauthenticated access to both endpoints', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/intelligence/suppliers')).status, 401);
    assert.equal(
      (
        await client.get(
          '/api/intelligence/suppliers/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        )
      ).status,
      401,
    );
  });

  it('exposes no write route and triggers no action', async () => {
    const tenant = await createTenant(server);
    const supplierId = await createSupplier(tenant, { name: 'No Write Co' });

    for (const method of ['post', 'patch', 'delete'] as const) {
      const response = await tenant.client[method]('/api/intelligence/suppliers', {
        body: { supplierId },
      });
      assert.equal(response.status, 404, `${method.toUpperCase()} /suppliers must not exist`);
    }

    assert.equal((await tenant.client.post(`/api/intelligence/suppliers/${supplierId}`)).status, 404);
  });

  it('never mutates anything, and creates no purchase order', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant);
    await seedSupplier(tenant, 'Read Only Co', [5, 6, 5], productId);

    const before = await countRows();
    await listSuppliers(tenant);
    await listSuppliers(tenant, '?limit=100&stability=STABLE');
    await listSuppliers(tenant, '?confidence=HIGH&page=2');

    assert.deepEqual(
      await countRows(),
      before,
      'a supplier assessment must change nothing',
    );
  });

  it('isolates tenants completely', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productId = await createProduct(tenantA);
    const supplierA = await seedSupplier(tenantA, 'Tenant A Only', [5, 6, 5], productId);

    const listB = await listSuppliers(tenantB);
    assert.equal(listB.meta.total, 0);
    assert.deepEqual(listB.data, []);

    const detailB = await tenantB.client.get(`/api/intelligence/suppliers/${supplierA}`);
    assert.equal(detailB.status, 404, 'a cross-tenant supplier is not found');
    assert.ok(
      !JSON.stringify(detailB.body).includes('Tenant A Only'),
      'no leakage through the error body either',
    );
  });

  it('is readable by staff', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant, { name: 'Staff Co' });
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    assert.equal((await staff.get('/api/intelligence/suppliers')).status, 200);
  });
});