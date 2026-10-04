/**
 * Suppliers and purchase orders tests.
 *
 * The two properties that matter most, and that this suite exists to protect:
 *  - **creating a purchase order never moves stock** — only receiving does;
 *  - a receipt is atomic and concurrency-safe, so a business can never receive
 *    more than it ordered, nor increase stock by more than it received.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestClient, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface Supplier {
  id: string;
  name: string;
  isActive: boolean;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  updatedAt: string;
}

interface OrderItem {
  productId: string;
  sku: string;
  productName: string;
  quantity: string;
  receivedQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  lineTotal: string;
}

interface Order {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  totalAmount: string;
  orderedAt: string | null;
  receivedAt: string | null;
  itemCount: number;
  items?: OrderItem[];
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

async function createSupplier(
  client: TestClient,
  overrides: Record<string, unknown> = {},
): Promise<Supplier> {
  const response = await client.post<{ data: Supplier }>('/api/suppliers', {
    name: 'Acme Parts',
    ...overrides,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data;
}

async function createDraftOrder(
  client: TestClient,
  supplierId: string,
  items: { productId: string; quantity: string; unitCost: string }[],
): Promise<Order> {
  const response = await client.post<{ data: Order }>('/api/purchase-orders', {
    supplierId,
    items,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data;
}

async function placeOrder(client: TestClient, orderId: string): Promise<Order> {
  const response = await client.post<{ data: Order }>(
    `/api/purchase-orders/${orderId}/order`,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function receive(
  client: TestClient,
  orderId: string,
  items: { productId: string; quantity: string }[],
): Promise<{ status: number; body: unknown }> {
  const response = await client.post(`/api/purchase-orders/${orderId}/receive`, { items });
  return { status: response.status, body: response.body };
}

async function readStock(client: TestClient, productId: string): Promise<number> {
  const response = await client.get<{ data: { currentStock: number } }>(
    `/api/inventory/${productId}`,
  );
  assert.equal(response.status, 200);
  return response.body.data.currentStock;
}

async function countReceiptMovements(referenceId: string): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM inventory_movements
      WHERE reference_type = 'purchase_order' AND reference_id = $1`,
    [referenceId],
  );
  return result.rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

describe('suppliers', () => {
  it('rejects unauthenticated access to every route', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/suppliers')).status, 401);
    assert.equal((await client.post('/api/suppliers', { name: 'X' })).status, 401);
    assert.equal(
      (await client.get('/api/suppliers/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status,
      401,
    );
    assert.equal(
      (
        await client.patch(
          '/api/suppliers/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          { name: 'X' },
        )
      ).status,
      401,
    );
  });

  it('creates a supplier', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post<{ data: Supplier }>('/api/suppliers', {
      name: '  Acme Parts  ',
      contactName: 'Sam Supplier',
      phone: '+91 98765 43210',
      email: 'Sales@Acme.COM',
      address: '1 Market Street',
      notes: 'Prefers deliveries before noon',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.name, 'Acme Parts', 'name is trimmed');
    assert.equal(response.body.data.email, 'sales@acme.com', 'email is lower-cased');
    assert.equal(response.body.data.isActive, true, 'active by default');
  });

  it('lists and paginates suppliers', async () => {
    const tenant = await createTenant(server);
    for (let i = 0; i < 5; i += 1) {
      await createSupplier(tenant.client, { name: `Supplier ${i}` });
    }

    const response = await tenant.client.get<{ data: Supplier[]; meta: Meta }>(
      '/api/suppliers?page=2&limit=2',
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.meta.total, 5);
    assert.equal(response.body.meta.totalPages, 3);
  });

  it('searches and filters by active status', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant.client, { name: 'Northern Metals', contactName: 'Nadia' });
    const retired = await createSupplier(tenant.client, { name: 'Southern Plastics' });
    await tenant.client.patch(`/api/suppliers/${retired.id}`, { isActive: false });

    const byName = await tenant.client.get<{ data: Supplier[] }>('/api/suppliers?search=metal');
    assert.equal(byName.body.data.length, 1);

    const byContact = await tenant.client.get<{ data: Supplier[] }>('/api/suppliers?search=nadia');
    assert.equal(byContact.body.data.length, 1);

    const active = await tenant.client.get<{ data: Supplier[] }>('/api/suppliers?isActive=true');
    assert.equal(active.body.data.length, 1);

    const inactive = await tenant.client.get<{ data: Supplier[] }>('/api/suppliers?isActive=false');
    assert.equal(inactive.body.data.length, 1);
    assert.equal(inactive.body.data[0]?.name, 'Southern Plastics');
  });

  it('deactivates and reactivates a supplier', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);

    const off = await tenant.client.patch<{ data: Supplier }>(
      `/api/suppliers/${supplier.id}`,
      { isActive: false },
    );
    assert.equal(off.body.data.isActive, false);

    const on = await tenant.client.patch<{ data: Supplier }>(
      `/api/suppliers/${supplier.id}`,
      { isActive: true },
    );
    assert.equal(on.body.data.isActive, true);
  });

  it('rejects a duplicate name with 409, case-insensitively', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant.client, { name: 'Acme Parts' });

    const response = await tenant.client.post('/api/suppliers', { name: 'acme parts' });

    assert.equal(response.status, 409);
  });

  it('maintains updated_at through the trigger', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);

    const updated = await tenant.client.patch<{ data: Supplier }>(
      `/api/suppliers/${supplier.id}`,
      { contactName: 'New Contact' },
    );

    assert.notEqual(
      updated.body.data.updatedAt,
      supplier.updatedAt,
      'the set_updated_at() trigger advanced the timestamp',
    );
  });

  it('rejects unknown fields, businessId and createdBy', async () => {
    const tenant = await createTenant(server);

    for (const extra of [
      { businessId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
      { createdBy: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
      { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
    ]) {
      const response = await tenant.client.post('/api/suppliers', {
        name: 'Valid Name',
        ...extra,
      });
      assert.equal(response.status, 400, `${Object.keys(extra)[0]} must be rejected`);
    }
  });

  it('validates the email and phone formats', async () => {
    const tenant = await createTenant(server);

    assert.equal(
      (await tenant.client.post('/api/suppliers', { name: 'A', email: 'nope' })).status,
      400,
    );
    assert.equal(
      (await tenant.client.post('/api/suppliers', { name: 'B', phone: 'call me' })).status,
      400,
    );
    assert.equal((await tenant.client.post('/api/suppliers', { name: '' })).status, 400);
  });

  it('exposes no delete route', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);

    const response = await tenant.client.delete(`/api/suppliers/${supplier.id}`);

    assert.ok(response.status === 404 || response.status === 405, `got ${response.status}`);
  });

  it('isolates suppliers between businesses', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const supplier = await createSupplier(tenantA.client, { name: 'Private Supplier' });

    assert.equal((await tenantB.client.get(`/api/suppliers/${supplier.id}`)).status, 404);
    assert.equal(
      (await tenantB.client.patch(`/api/suppliers/${supplier.id}`, { name: 'Hijacked' })).status,
      404,
    );

    const listB = await tenantB.client.get<{ meta: Meta }>('/api/suppliers');
    assert.equal(listB.body.meta.total, 0);

    const original = await tenantA.client.get<{ data: Supplier }>(
      `/api/suppliers/${supplier.id}`,
    );
    assert.equal(original.body.data.name, 'Private Supplier', 'the original is unchanged');
  });

  it('lets staff manage suppliers', async () => {
    const tenant = await createTenant(server);
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.post<{ data: Supplier }>('/api/suppliers', { name: 'Staff Ltd' });
    assert.equal(response.status, 201);
    assert.equal((await staff.get('/api/suppliers')).status, 200);
  });
});

// ---------------------------------------------------------------------------
// Purchase order creation
// ---------------------------------------------------------------------------

describe('purchase order creation', () => {
  it('rejects unauthenticated access', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/purchase-orders')).status, 401);
    assert.equal((await client.post('/api/purchase-orders', { supplierId: 'x' })).status, 401);
  });

  it('creates a draft with server-computed totals', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant, { name: 'Cable', sellingPrice: '9.00' });

    const order = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '100', unitCost: '2.50' },
      { productId: product, quantity: '4', unitCost: '2.50' },
    ]);

    assert.equal(order.status, 'draft');
    assert.equal(order.totalAmount, '260.00', '100×2.50 + 4×2.50, computed in numeric');
    assert.equal(order.orderedAt, null, 'a draft is not yet ordered');
    assert.equal(order.receivedAt, null);
    assert.equal(order.itemCount, 2);
    assert.equal(order.items?.every((item) => item.remainingQuantity === item.quantity), true);
  });

  it('does NOT change inventory on creation', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '100', unitCost: '2.50' },
    ]);
    await placeOrder(tenant.client, (await getOrderId(tenant.client)).toString());

    assert.equal(await readStock(tenant.client, product), 0, 'ordering is not receiving');
    assert.equal(
      await countReceiptMovements((await getOrderId(tenant.client)).toString()),
      0,
      'no inventory movement was created',
    );
  });

  it('rejects an inactive supplier', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    await tenant.client.patch(`/api/suppliers/${supplier.id}`, { isActive: false });
    const product = await createProduct(tenant);

    const response = await tenant.client.post('/api/purchase-orders', {
      supplierId: supplier.id,
      items: [{ productId: product, quantity: '5', unitCost: '1.00' }],
    });

    assert.equal(response.status, 409);
  });

  it('rejects a cross-tenant supplier with 404', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const supplier = await createSupplier(tenantA.client);
    const product = await createProduct(tenantB);

    const response = await tenantB.client.post('/api/purchase-orders', {
      supplierId: supplier.id,
      items: [{ productId: product, quantity: '5', unitCost: '1.00' }],
    });

    assert.equal(response.status, 404, 'a foreign supplier simply does not exist');
  });

  it('rejects a cross-tenant product with 404 and rolls back', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const supplier = await createSupplier(tenantB.client);
    const own = await createProduct(tenantB, { name: 'Own' });
    const foreign = await createProduct(tenantA, { name: 'Foreign' });

    const response = await tenantB.client.post('/api/purchase-orders', {
      supplierId: supplier.id,
      items: [
        { productId: own, quantity: '5', unitCost: '1.00' },
        { productId: foreign, quantity: '5', unitCost: '1.00' },
      ],
    });

    assert.equal(response.status, 404);
    const list = await tenantB.client.get<{ meta: Meta }>('/api/purchase-orders');
    assert.equal(list.body.meta.total, 0, 'the valid line was rolled back too');
  });

  it('rejects an inactive product', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    await tenant.client.delete(`/api/products/${product}`);

    const response = await tenant.client.post('/api/purchase-orders', {
      supplierId: supplier.id,
      items: [{ productId: product, quantity: '5', unitCost: '1.00' }],
    });

    assert.equal(response.status, 400);
  });

  it('rejects every server-owned field and invalid payloads', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const base = {
      supplierId: supplier.id,
      items: [{ productId: product, quantity: '5', unitCost: '1.00' }],
    };

    for (const extra of [
      { businessId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
      { createdBy: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
      { totalAmount: '0.01' },
      { status: 'received' },
      { stock: 5 },
    ]) {
      const response = await tenant.client.post('/api/purchase-orders', { ...base, ...extra });
      assert.equal(response.status, 400, `${Object.keys(extra)[0]} must be rejected`);
    }

    // Empty items, zero/negative quantity, negative cost.
    assert.equal(
      (await tenant.client.post('/api/purchase-orders', { supplierId: supplier.id, items: [] }))
        .status,
      400,
    );
    assert.equal(
      (
        await tenant.client.post('/api/purchase-orders', {
          supplierId: supplier.id,
          items: [{ productId: product, quantity: '0', unitCost: '1.00' }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await tenant.client.post('/api/purchase-orders', {
          supplierId: supplier.id,
          items: [{ productId: product, quantity: '5', unitCost: '-1.00' }],
        })
      ).status,
      400,
    );
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('purchase order lifecycle', () => {
  it('transitions draft to ordered and stamps ordered_at', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);

    const ordered = await placeOrder(tenant.client, draft.id);

    assert.equal(ordered.status, 'ordered');
    assert.ok(ordered.orderedAt, 'ordered_at was stamped');
  });

  it('rejects ordering a non-draft order', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    const again = await tenant.client.post(`/api/purchase-orders/${draft.id}/order`);

    assert.equal(again.status, 409, 'only a draft can be placed');
  });

  it('allows draft to cancelled and then refuses further changes', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);

    const cancelled = await tenant.client.patch<{ data: Order }>(
      `/api/purchase-orders/${draft.id}`,
      { status: 'cancelled' },
    );
    assert.equal(cancelled.body.data.status, 'cancelled');

    const edit = await tenant.client.patch(`/api/purchase-orders/${draft.id}`, { notes: 'nope' });
    assert.equal(edit.status, 409, 'cancelled is terminal');

    const order = await tenant.client.post(`/api/purchase-orders/${draft.id}/order`);
    assert.equal(order.status, 409);
  });

  it('refuses a status other than cancelled through PATCH', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);

    for (const status of ['ordered', 'received', 'partially_received']) {
      const response = await tenant.client.patch(`/api/purchase-orders/${draft.id}`, { status });
      assert.equal(response.status, 400, `status: ${status} must not be settable by hand`);
    }
  });

  it('edits draft fields but not a placed order', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);

    const edited = await tenant.client.patch<{ data: Order }>(
      `/api/purchase-orders/${draft.id}`,
      { notes: 'Updated note', expectedAt: '2026-12-01T00:00:00.000Z' },
    );
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.totalAmount, '5.00', 'the total is unchanged by an edit');

    await placeOrder(tenant.client, draft.id);
    const afterOrder = await tenant.client.patch(`/api/purchase-orders/${draft.id}`, {
      notes: 'Too late',
    });
    assert.equal(afterOrder.status, 409);
  });

  it('rejects receivedQuantity and lineTotal in PATCH', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);

    for (const extra of [{ receivedQuantity: 5 }, { lineTotal: '0.01' }, { totalAmount: '0.01' }]) {
      const response = await tenant.client.patch(`/api/purchase-orders/${draft.id}`, extra);
      assert.equal(response.status, 400, `${Object.keys(extra)[0]} must be rejected`);
    }
  });
});

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

describe('receiving goods', () => {
  it('receives partially, then completes, moving stock each time', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const cable = await createProduct(tenant, { name: 'Cable' });
    const mouse = await createProduct(tenant, { name: 'Mouse' });

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: cable, quantity: '100', unitCost: '2.50' },
      { productId: mouse, quantity: '10', unitCost: '8.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    const partial = await tenant.client.post<{ data: Order }>(
      `/api/purchase-orders/${draft.id}/receive`,
      { items: [{ productId: cable, quantity: '60' }] },
    );

    assert.equal(partial.status, 201, 'a receipt creates new ledger entries');
    assert.equal(partial.body.data.status, 'partially_received');
    assert.equal(partial.body.data.receivedAt, null, 'not fully received yet');

    const cableLine = partial.body.data.items?.find((item) => item.productId === cable);
    assert.equal(cableLine?.receivedQuantity, '60.00');
    assert.equal(cableLine?.remainingQuantity, '40.00');
    assert.equal(await readStock(tenant.client, cable), 60, 'stock rose by exactly 60');
    assert.equal(await readStock(tenant.client, mouse), 0);

    const final = await tenant.client.post<{ data: Order }>(
      `/api/purchase-orders/${draft.id}/receive`,
      {
        items: [
          { productId: cable, quantity: '40' },
          { productId: mouse, quantity: '10' },
        ],
      },
    );

    assert.equal(final.body.data.status, 'received');
    assert.ok(final.body.data.receivedAt, 'received_at was stamped');
    assert.equal(await readStock(tenant.client, cable), 100);
    assert.equal(await readStock(tenant.client, mouse), 10);
  });

  it('creates immutable IN movements referencing the order', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '60', unitCost: '2.00' },
    ]);
    await placeOrder(tenant.client, draft.id);
    await receive(tenant.client, draft.id, [{ productId: product, quantity: '60' }]);

    const movements = await tenant.client.get<{
      data: { movementType: string; quantity: number; referenceType: string | null; referenceId: string | null }[];
    }>(`/api/inventory/${product}/movements`);

    const movement = movements.body.data[0];
    assert.equal(movement?.movementType, 'in');
    assert.equal(movement?.quantity, 60);
    assert.equal(movement?.referenceType, 'purchase_order');
    assert.equal(movement?.referenceId, draft.id);
  });

  it('treats receive quantities as increments, not new totals', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '100', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    await receive(tenant.client, draft.id, [{ productId: product, quantity: '40' }]);
    const second = await tenant.client.post<{ data: Order }>(
      `/api/purchase-orders/${draft.id}/receive`,
      { items: [{ productId: product, quantity: '20' }] },
    );

    const line = second.body.data.items?.find((item) => item.productId === product);
    assert.equal(line?.receivedQuantity, '60.00', '40 + 20, not 20');
    assert.equal(line?.remainingQuantity, '40.00');
    assert.equal(await readStock(tenant.client, product), 60);
  });

  it('refuses to over-receive with 409', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '10', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    const response = await receive(tenant.client, draft.id, [
      { productId: product, quantity: '20' },
    ]);

    assert.equal(response.status, 409);
    assert.equal(await readStock(tenant.client, product), 0, 'nothing was received');
  });

  it('refuses a second receipt once fully received', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);
    await receive(tenant.client, draft.id, [{ productId: product, quantity: '5' }]);

    const again = await receive(tenant.client, draft.id, [{ productId: product, quantity: '1' }]);

    assert.equal(again.status, 409);
    assert.equal(await readStock(tenant.client, product), 5);
  });

  it('refuses to receive a cancelled order', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);
    await tenant.client.patch(`/api/purchase-orders/${draft.id}`, { status: 'cancelled' });

    const response = await receive(tenant.client, draft.id, [
      { productId: product, quantity: '5' },
    ]);

    assert.equal(response.status, 409);
    assert.equal(await readStock(tenant.client, product), 0);
  });

  it('rejects a product that is not on the order', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const ordered = await createProduct(tenant, { name: 'Ordered' });
    const elsewhere = await createProduct(tenant, { name: 'Elsewhere' });

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: ordered, quantity: '5', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    const response = await receive(tenant.client, draft.id, [
      { productId: elsewhere, quantity: '1' },
    ]);

    assert.equal(response.status, 404);
  });

  it('rolls back the whole receipt when one line is over-received', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const plentiful = await createProduct(tenant, { name: 'Plentiful' });
    const scarce = await createProduct(tenant, { name: 'Scarce' });

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: plentiful, quantity: '50', unitCost: '1.00' },
      { productId: scarce, quantity: '2', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    const response = await receive(tenant.client, draft.id, [
      { productId: plentiful, quantity: '10' },
      { productId: scarce, quantity: '99' },
    ]);

    assert.equal(response.status, 409);
    assert.equal(await readStock(tenant.client, plentiful), 0, 'the first line rolled back');
    assert.equal(await readStock(tenant.client, scarce), 0);
    assert.equal(await countReceiptMovements(draft.id), 0, 'no movement survived');

    const order = await tenant.client.get<{ data: Order }>(`/api/purchase-orders/${draft.id}`);
    assert.equal(order.body.data.status, 'ordered', 'the status is unchanged');
    const line = order.body.data.items?.find((item) => item.productId === plentiful);
    assert.equal(line?.receivedQuantity, '0.00');
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe('receiving concurrency', () => {
  it('never over-receives when two receipts race', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '100', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);
    await receive(tenant.client, draft.id, [{ productId: product, quantity: '60' }]);

    // 30 remaining; two simultaneous receipts of 30 cannot both fit.
    const [first, second] = await Promise.all([
      tenant.client.post(`/api/purchase-orders/${draft.id}/receive`, {
        items: [{ productId: product, quantity: '30' }],
      }),
      tenant.client.post(`/api/purchase-orders/${draft.id}/receive`, {
        items: [{ productId: product, quantity: '30' }],
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409], 'exactly one receipt may succeed');

    const order = await tenant.client.get<{ data: Order }>(`/api/purchase-orders/${draft.id}`);
    const line = order.body.data.items?.[0];
    assert.equal(line?.receivedQuantity, '90.00', '60 + 30, never more');
    assert.equal(line?.remainingQuantity, '10.00');
    assert.equal(order.body.data.status, 'partially_received');
    assert.equal(await readStock(tenant.client, product), 90, 'stock matches the receipt');
  });

  it('keeps receipts against different products independent', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const first = await createProduct(tenant, { name: 'A' });
    const second = await createProduct(tenant, { name: 'B' });

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: first, quantity: '5', unitCost: '1.00' },
      { productId: second, quantity: '5', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);

    const results = await Promise.all([
      tenant.client.post(`/api/purchase-orders/${draft.id}/receive`, {
        items: [{ productId: first, quantity: '5' }],
      }),
      tenant.client.post(`/api/purchase-orders/${draft.id}/receive`, {
        items: [{ productId: second, quantity: '5' }],
      }),
    ]);

    // Both are on the same order, so the per-order lock serialises them — but
    // neither is rejected, and no global lock is involved.
    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [201, 201],
      'receipts for different products both succeed',
    );
    assert.equal(await readStock(tenant.client, first), 5);
    assert.equal(await readStock(tenant.client, second), 5);
  });
});

// ---------------------------------------------------------------------------
// Listing, detail, isolation, roles
// ---------------------------------------------------------------------------

describe('purchase order listing and detail', () => {
  it('lists with search, supplier, status and date filters plus pagination', async () => {
    const tenant = await createTenant(server);
    const alpha = await createSupplier(tenant.client, { name: 'Alpha Supplies' });
    const beta = await createSupplier(tenant.client, { name: 'Beta Supplies' });
    const product = await createProduct(tenant);

    await createDraftOrder(tenant.client, alpha.id, [
      { productId: product, quantity: '1', unitCost: '1.00' },
    ]);
    await createDraftOrder(tenant.client, beta.id, [
      { productId: product, quantity: '2', unitCost: '1.00' },
    ]);

    const all = await tenant.client.get<{ meta: Meta }>('/api/purchase-orders');
    assert.equal(all.body.meta.total, 2);

    const bySupplier = await tenant.client.get<{ data: Order[] }>(
      `/api/purchase-orders?supplierId=${alpha.id}`,
    );
    assert.equal(bySupplier.body.data.length, 1);
    assert.equal(bySupplier.body.data[0]?.supplierName, 'Alpha Supplies');

    const byStatus = await tenant.client.get<{ meta: Meta }>(
      '/api/purchase-orders?status=draft',
    );
    assert.equal(byStatus.body.meta.total, 2);

    const bySearch = await tenant.client.get<{ data: Order[] }>(
      '/api/purchase-orders?search=beta',
    );
    assert.equal(bySearch.body.data.length, 1);

    const bogusStatus = await tenant.client.get('/api/purchase-orders?status=nonsense');
    assert.equal(bogusStatus.status, 400);
  });

  it('rejects an out-of-range page size and an unknown query key', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/purchase-orders?limit=5000')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/purchase-orders?orderBy=total_amount--')).status,
      400,
      'an unknown query key is refused outright',
    );
  });

  it('returns detail with computed remaining quantities', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '100', unitCost: '2.50' },
    ]);
    await placeOrder(tenant.client, draft.id);
    await receive(tenant.client, draft.id, [{ productId: product, quantity: '30' }]);

    const response = await tenant.client.get<{ data: Order }>(
      `/api/purchase-orders/${draft.id}`,
    );

    assert.equal(response.status, 200);
    const line = response.body.data.items?.[0];
    assert.equal(line?.quantity, '100.00');
    assert.equal(line?.receivedQuantity, '30.00');
    assert.equal(line?.remainingQuantity, '70.00', 'computed by the server');
    assert.ok(line?.sku, 'product information is included');
  });

  it('isolates purchase orders between businesses', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const supplier = await createSupplier(tenantA.client);
    const product = await createProduct(tenantA);
    const order = await createDraftOrder(tenantA.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);

    assert.equal((await tenantB.client.get(`/api/purchase-orders/${order.id}`)).status, 404);
    assert.equal(
      (await tenantB.client.post(`/api/purchase-orders/${order.id}/order`)).status,
      404,
    );
    assert.equal(
      (
        await tenantB.client.post(`/api/purchase-orders/${order.id}/receive`, {
          items: [{ productId: product, quantity: '1' }],
        })
      ).status,
      404,
    );

    const listB = await tenantB.client.get<{ meta: Meta }>('/api/purchase-orders');
    assert.equal(listB.body.meta.total, 0);
  });

  it('lets staff raise, place and receive orders', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const created = await staff.post<{ data: Order }>('/api/purchase-orders', {
      supplierId: supplier.id,
      items: [{ productId: product, quantity: '10', unitCost: '1.00' }],
    });
    assert.equal(created.status, 201);

    const orderId = created.body.data.id;
    assert.equal((await staff.post(`/api/purchase-orders/${orderId}/order`)).status, 200);

    const received = await staff.post<{ data: Order }>(
      `/api/purchase-orders/${orderId}/receive`,
      { items: [{ productId: product, quantity: '10' }] },
    );
    assert.equal(received.status, 201, 'goods-in is day-to-day work for staff');
    assert.equal(received.body.data.status, 'received');
    assert.equal(await readStock(staff, product), 10);
  });
});

describe('no duplicate source of truth', () => {
  it('stores no stock column on suppliers, orders or order items', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);
    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '5', unitCost: '1.00' },
    ]);
    await placeOrder(tenant.client, draft.id);
    await receive(tenant.client, draft.id, [{ productId: product, quantity: '5' }]);

    const columns = await getPool().query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('suppliers', 'purchase_orders', 'purchase_order_items')
          AND column_name ~ '(stock|on_hand|available|balance)'`,
    );

    assert.deepEqual(columns.rows, [], 'stock lives only in the inventory ledger');
  });

  it('agrees with the inventory ledger about received quantity', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client);
    const product = await createProduct(tenant);

    const draft = await createDraftOrder(tenant.client, supplier.id, [
      { productId: product, quantity: '40', unitCost: '1.25' },
    ]);
    await placeOrder(tenant.client, draft.id);
    await receive(tenant.client, draft.id, [{ productId: product, quantity: '17' }]);

    const order = await tenant.client.get<{ data: Order }>(`/api/purchase-orders/${draft.id}`);
    const line = order.body.data.items?.[0];
    const stock = await readStock(tenant.client, product);

    assert.equal(line?.receivedQuantity, '17.00');
    assert.equal(stock, 17, 'the ledger is the source of truth and they agree');
  });
});

/** Convenience: the most recent order id for this tenant. */
async function getOrderId(client: TestClient): Promise<string> {
  const response = await client.get<{ data: { id: string }[] }>('/api/purchase-orders?limit=1');
  return response.body.data[0]?.id ?? '';
}
