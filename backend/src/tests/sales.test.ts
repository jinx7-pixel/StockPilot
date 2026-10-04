/**
 * Sales tests.
 *
 * The central property under test: **a sale is a transaction over the existing
 * inventory ledger.** It must move stock only by appending `out` movements, must
 * do so atomically, and must not be able to oversell even under concurrency.
 *
 * A test also asserts the negative: that no stock total is cached anywhere.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestClient, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface SaleItem {
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

interface Sale {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  totalAmount: string;
  status: string;
  soldAt: string;
  createdBy: { id: string; name: string };
  itemCount: number;
  items?: SaleItem[];
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

/** Create a product and return `{ id, price }`. */
async function createProduct(
  tenant: Tenant,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; price: number }> {
  const response = await tenant.client.post<{ data: { id: string; sellingPrice: number } }>(
    '/api/products',
    productBody(overrides),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { id: response.body.data.id, price: response.body.data.sellingPrice };
}

async function stockIn(
  client: TestClient,
  productId: string,
  quantity: string,
): Promise<void> {
  const response = await client.post('/api/inventory/movements', {
    productId,
    movementType: 'in',
    quantity,
    reason: 'Opening stock',
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
}

async function readStock(client: TestClient, productId: string): Promise<number> {
  const response = await client.get<{ data: { currentStock: number } }>(
    `/api/inventory/${productId}`,
  );
  assert.equal(response.status, 200);
  return response.body.data.currentStock;
}

async function createSale(
  client: TestClient,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await client.post('/api/sales', body);
  return { status: response.status, body: response.body };
}

async function countMovements(productId: string, referenceId: string): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM inventory_movements
      WHERE product_id = $1 AND reference_type = 'sale' AND reference_id = $2`,
    [productId, referenceId],
  );
  return result.rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// 1–7: creating a sale
// ---------------------------------------------------------------------------

describe('POST /api/sales', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { status } = await createSale(server.client(), { items: [] });

    assert.equal(status, 401);
  });

  it('creates a one-item sale and reduces stock', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '10.00' });
    await stockIn(tenant.client, product.id, '20');

    const response = await tenant.client.post<{ data: Sale }>('/api/sales', {
      customerName: 'Walk-in',
      items: [{ productId: product.id, quantity: 3 }],
    });

    assert.equal(response.status, 201);
    const sale = response.body.data;

    assert.equal(sale.totalAmount, '30.00', '3 × 10.00');
    assert.equal(sale.itemCount, 1);
    assert.equal(sale.status, 'completed');
    assert.equal(sale.customerName, 'Walk-in');
    assert.equal(sale.createdBy.id, tenant.user.id, 'the actor comes from the session');
    assert.equal(await readStock(tenant.client, product.id), 17, '20 − 3');
  });

  it('creates a multi-item sale and reduces each product', async () => {
    const tenant = await createTenant(server);
    const first = await createProduct(tenant, { name: 'First', sellingPrice: '4.00' });
    const second = await createProduct(tenant, { name: 'Second', sellingPrice: '2.50' });
    await stockIn(tenant.client, first.id, '10');
    await stockIn(tenant.client, second.id, '10');

    const response = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [
        { productId: first.id, quantity: 2 },
        { productId: second.id, quantity: 3 },
      ],
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.totalAmount, '15.50', '2×4.00 + 3×2.50');
    assert.equal(await readStock(tenant.client, first.id), 8);
    assert.equal(await readStock(tenant.client, second.id), 7);
  });

  it('computes line totals and the total in the database', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '2.50' });
    await stockIn(tenant.client, product.id, '10');

    const response = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 3 }],
    });

    const sale = response.body.data;
    assert.equal(sale.items?.[0]?.lineTotal, '7.50');
    assert.equal(sale.totalAmount, '7.50');
    // Strings, not floats: the money came back as exact NUMERIC.
    assert.equal(typeof sale.totalAmount, 'string');
  });

  it('avoids floating-point drift on fractional quantities', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '0.10' });
    await stockIn(tenant.client, product.id, '10');

    const first = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 3 }],
    });
    const second = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 3 }],
    });

    // Each sale totals 3 × 0.10 = 0.30 exactly — not 0.30000000000000004.
    assert.equal(first.body.data.totalAmount, '0.30');
    assert.equal(second.body.data.totalAmount, '0.30');
    // And the running balance is exact too: 10 − 3 − 3 = 4, not 3.9999...
    assert.equal(await readStock(tenant.client, product.id), 4);
  });

  it('snapshots the current selling price into unit_price', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '10.00' });
    await stockIn(tenant.client, product.id, '20');

    const before = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(before.body.data.items?.[0]?.unitPrice, '10.00');

    // Reprice the product, then sell again.
    await tenant.client.patch(`/api/products/${product.id}`, { sellingPrice: '25.00' });

    const afterPriceChange = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(
      afterPriceChange.body.data.items?.[0]?.unitPrice,
      '25.00',
      'the new sale uses the new price',
    );

    // The older sale is unchanged: history is not rewritten.
    const history = await tenant.client.get<{ data: Sale[] }>('/api/sales?page=1&limit=10');
    const old = history.body.data.find((s) => s.id === before.body.data.id);
    assert.equal(old?.totalAmount, '10.00');
  });

  it('creates one OUT movement per product, referencing the sale', async () => {
    const tenant = await createTenant(server);
    const first = await createProduct(tenant, { name: 'First' });
    const second = await createProduct(tenant, { name: 'Second' });
    await stockIn(tenant.client, first.id, '10');
    await stockIn(tenant.client, second.id, '10');

    const sale = (
      await tenant.client.post<{ data: Sale }>('/api/sales', {
        items: [
          { productId: first.id, quantity: 2 },
          { productId: second.id, quantity: 4 },
        ],
      })
    ).body.data;

    assert.equal(await countMovements(first.id, sale.id), 1);
    assert.equal(await countMovements(second.id, sale.id), 1);

    const movements = await tenant.client.get<{ data: { movementType: string; referenceType: string | null; referenceId: string | null; quantity: number }[] }>(
      `/api/inventory/${first.id}/movements`,
    );
    const latest = movements.body.data[0];
    assert.equal(latest?.movementType, 'out');
    assert.equal(latest?.referenceType, 'sale');
    assert.equal(latest?.referenceId, sale.id);
    assert.equal(latest?.quantity, 2);
  });

  it('aggregates a repeated product before checking stock', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '1.00' });
    await stockIn(tenant.client, product.id, '5');

    // Two lines of 3 must not each pass a balance check of 5.
    const rejected = await createSale(tenant.client, {
      items: [
        { productId: product.id, quantity: 3 },
        { productId: product.id, quantity: 3 },
      ],
    });
    assert.equal(rejected.status, 409, 'summed quantity 6 > 5 available');

    const accepted = await createSale(tenant.client, {
      items: [
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 2 },
      ],
    });
    assert.equal(accepted.status, 201, 'summed quantity 4 ≤ 5');
    assert.equal(await readStock(tenant.client, product.id), 1);
  });

  it('records the optional customer fields and soldAt', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '5');

    const soldAt = '2026-01-15T10:30:00.000Z';
    const response = await tenant.client.post<{ data: Sale }>('/api/sales', {
      customerName: 'Acme Ltd',
      customerPhone: '+91 98765 43210',
      soldAt,
      items: [{ productId: product.id, quantity: 1 }],
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.customerName, 'Acme Ltd');
    assert.equal(response.body.data.customerPhone, '+91 98765 43210');
    assert.equal(response.body.data.soldAt, new Date(soldAt).toISOString());
  });

  it('allows a fractional quantity', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { unit: 'kg' });
    await stockIn(tenant.client, product.id, '10');

    const response = await tenant.client.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 2.5 }],
    });

    assert.equal(response.status, 201);
    assert.equal(await readStock(tenant.client, product.id), 7.5);
  });

  it('accepts a customer name with no phone and vice versa', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');

    const named = await createSale(tenant.client, {
      customerName: 'Named only',
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(named.status, 201);

    const phoned = await createSale(tenant.client, {
      customerPhone: '+91 90000 00000',
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(phoned.status, 201);
  });
});

// ---------------------------------------------------------------------------
// 8–9: stock safety and atomicity
// ---------------------------------------------------------------------------

describe('stock safety', () => {
  it('returns 409 when the sale would oversell', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '5.00' });
    await stockIn(tenant.client, product.id, '5');

    const { status } = await createSale(tenant.client, {
      items: [{ productId: product.id, quantity: 6 }],
    });

    assert.equal(status, 409);
    assert.equal(await readStock(tenant.client, product.id), 5, 'stock is untouched');
  });

  it('rolls back entirely when a later item has insufficient stock', async () => {
    const tenant = await createTenant(server);
    const plentiful = await createProduct(tenant, { name: 'Plentiful', sellingPrice: '1.00' });
    const scarce = await createProduct(tenant, { name: 'Scarce', sellingPrice: '1.00' });
    await stockIn(tenant.client, plentiful.id, '100');
    await stockIn(tenant.client, scarce.id, '2');

    const { status } = await createSale(tenant.client, {
      items: [
        { productId: plentiful.id, quantity: 5 },
        { productId: scarce.id, quantity: 9 },
      ],
    });

    assert.equal(status, 409);

    // Atomic: neither the first product's stock, nor any sale row, nor any
    // movement may survive.
    assert.equal(await readStock(tenant.client, plentiful.id), 100, 'first item rolled back');

    const counts = await getPool().query<{ sales: number; items: number; movements: number }>(
      `SELECT
         (SELECT count(*) FROM sales)::int          AS sales,
         (SELECT count(*) FROM sale_items)::int     AS items,
         (SELECT count(*) FROM inventory_movements WHERE reference_type = 'sale')::int AS movements`,
    );
    assert.deepEqual(counts.rows[0], { sales: 0, items: 0, movements: 0 });
  });

  it('allows a sale that empties the stock exactly', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '5');

    const { status } = await createSale(tenant.client, {
      items: [{ productId: product.id, quantity: 5 }],
    });

    assert.equal(status, 201);
    assert.equal(await readStock(tenant.client, product.id), 0);
  });

  it('refuses a further sale once the stock is gone', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '5');
    await createSale(tenant.client, { items: [{ productId: product.id, quantity: 5 }] });

    const { status } = await createSale(tenant.client, {
      items: [{ productId: product.id, quantity: 1 }],
    });

    assert.equal(status, 409);
  });

  it('refuses to sell an inactive product', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');
    await tenant.client.delete(`/api/products/${product.id}`);

    const { status, body } = await createSale(tenant.client, {
      items: [{ productId: product.id, quantity: 1 }],
    });

    assert.equal(status, 400);
    assert.match(JSON.stringify(body), /inactive/i);
  });
});

// ---------------------------------------------------------------------------
// 10–12: products and tenancy
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  it('returns 404 for a product from another business', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const foreign = await createProduct(tenantA);
    await stockIn(tenantA.client, foreign.id, '10');

    const { status } = await createSale(tenantB.client, {
      items: [{ productId: foreign.id, quantity: 1 }],
    });

    assert.equal(status, 404, 'a foreign product is simply not found');
  });

  it('rejects the whole sale when only one of several products is foreign', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const own = await createProduct(tenantB, { name: 'Own' });
    const foreign = await createProduct(tenantA, { name: 'Foreign' });
    await stockIn(tenantB.client, own.id, '10');
    await stockIn(tenantA.client, foreign.id, '10');

    const { status } = await createSale(tenantB.client, {
      items: [
        { productId: own.id, quantity: 1 },
        { productId: foreign.id, quantity: 1 },
      ],
    });

    assert.equal(status, 404);
    assert.equal(await readStock(tenantB.client, own.id), 10, 'the valid line is rolled back too');
  });

  it('returns 404 for a sale belonging to another business', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const product = await createProduct(tenantA);
    await stockIn(tenantA.client, product.id, '10');

    const sale = (
      await tenantA.client.post<{ data: Sale }>('/api/sales', {
        items: [{ productId: product.id, quantity: 1 }],
      })
    ).body.data;

    assert.equal((await tenantA.client.get(`/api/sales/${sale.id}`)).status, 200);
    assert.equal((await tenantB.client.get(`/api/sales/${sale.id}`)).status, 404);
  });

  it('lists only the caller business sales', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const productA = await createProduct(tenantA);
    const productB = await createProduct(tenantB);
    await stockIn(tenantA.client, productA.id, '10');
    await stockIn(tenantB.client, productB.id, '10');

    await tenantA.client.post('/api/sales', {
      customerName: 'Visible to A',
      items: [{ productId: productA.id, quantity: 1 }],
    });
    await tenantB.client.post('/api/sales', {
      customerName: 'Visible to B',
      items: [{ productId: productB.id, quantity: 1 }],
    });

    const listA = await tenantA.client.get<{ data: Sale[]; meta: Meta }>('/api/sales');
    assert.equal(listA.body.meta.total, 1);
    assert.equal(listA.body.data[0]?.customerName, 'Visible to A');
  });
});

// ---------------------------------------------------------------------------
// 16–17: validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('rejects an empty items array with 400', async () => {
    const tenant = await createTenant(server);

    const { status, body } = await createSale(tenant.client, { items: [] });

    assert.equal(status, 400);
    assert.match(JSON.stringify(body), /at least one item/i);
  });

  it('rejects a missing items array with 400', async () => {
    const tenant = await createTenant(server);

    const { status } = await createSale(tenant.client, { customerName: 'No items' });

    assert.equal(status, 400);
  });

  it('rejects zero and negative quantities with 400', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');

    for (const quantity of ['0', '-1', 0, -2]) {
      const { status } = await createSale(tenant.client, {
        items: [{ productId: product.id, quantity }],
      });
      assert.equal(status, 400, `quantity ${String(quantity)} must be rejected`);
    }
  });

  it('rejects a malformed product id with 400', async () => {
    const tenant = await createTenant(server);

    const { status } = await createSale(tenant.client, {
      items: [{ productId: 'not-a-uuid', quantity: 1 }],
    });

    assert.equal(status, 400);
  });

  it('rejects a malformed sale id with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get('/api/sales/not-a-uuid');

    assert.equal(response.status, 400);
  });

  it('rejects an over-long customer name with 400', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);

    const { status } = await createSale(tenant.client, {
      customerName: 'x'.repeat(151),
      items: [{ productId: product.id, quantity: 1 }],
    });

    assert.equal(status, 400);
  });

  it('rejects an invalid soldAt with 400', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);

    const { status } = await createSale(tenant.client, {
      soldAt: 'not-a-date',
      items: [{ productId: product.id, quantity: 1 }],
    });

    assert.equal(status, 400);
  });

  it('rejects a missing product with 404', async () => {
    const tenant = await createTenant(server);

    const { status } = await createSale(tenant.client, {
      items: [{ productId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', quantity: 1 }],
    });

    assert.equal(status, 404);
  });

  it('rejects every server-owned field as unknown', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');

    for (const extra of [
      { businessId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
      { createdBy: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
      { totalAmount: '1.00' },
      { status: 'refunded' },
      { stock: 5 },
    ]) {
      const { status } = await createSale(tenant.client, {
        items: [{ productId: product.id, quantity: 1 }],
        ...extra,
      });
      assert.equal(status, 400, `${Object.keys(extra)[0]} must be rejected`);
    }
  });

  it('rejects unitPrice and lineTotal on a line', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);

    for (const extra of [{ unitPrice: '0.01' }, { lineTotal: '0.01' }]) {
      const { status } = await createSale(tenant.client, {
        items: [{ productId: product.id, quantity: 1, ...extra }],
      });
      assert.equal(status, 400, `${Object.keys(extra)[0]} must be rejected`);
    }
  });

  it('rejects an out-of-range page size with 400', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/sales?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/sales?page=0')).status, 400);
  });

  it('rejects from later than to with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/sales?from=2026-02-01&to=2026-01-01',
    );

    assert.equal(response.status, 400);
  });
});

// ---------------------------------------------------------------------------
// 18–20: listing and detail
// ---------------------------------------------------------------------------

describe('GET /api/sales', () => {
  it('paginates with metadata', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '100');

    for (let i = 0; i < 5; i += 1) {
      await tenant.client.post('/api/sales', {
        items: [{ productId: product.id, quantity: 1 }],
      });
    }

    const response = await tenant.client.get<{ data: Sale[]; meta: Meta }>(
      '/api/sales?page=2&limit=2',
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.meta.total, 5);
    assert.equal(response.body.meta.page, 2);
    assert.equal(response.body.meta.totalPages, 3);
  });

  it('searches by customer name and phone', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '50');

    await tenant.client.post('/api/sales', {
      customerName: 'Acme Supplies',
      items: [{ productId: product.id, quantity: 1 }],
    });
    await tenant.client.post('/api/sales', {
      customerPhone: '+91 90000 11111',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const byName = await tenant.client.get<{ data: Sale[] }>('/api/sales?search=acme');
    assert.equal(byName.body.data.length, 1);

    const byPhone = await tenant.client.get<{ data: Sale[] }>('/api/sales?search=90000');
    assert.equal(byPhone.body.data.length, 1);
  });

  it('treats LIKE wildcards in the search term as literals', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');
    await tenant.client.post('/api/sales', {
      customerName: 'Customer',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const response = await tenant.client.get<{ data: Sale[] }>('/api/sales?search=%25');

    assert.equal(response.body.data.length, 0, 'a bare % must not match everything');
  });

  it('filters by status', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');
    await tenant.client.post('/api/sales', {
      items: [{ productId: product.id, quantity: 1 }],
    });

    const completed = await tenant.client.get<{ data: Sale[]; meta: Meta }>(
      '/api/sales?status=completed',
    );
    assert.equal(completed.body.meta.total, 1);

    const bogus = await tenant.client.get('/api/sales?status=refunded');
    assert.equal(bogus.status, 400, 'only the supported status is accepted');
  });

  it('filters by a sold-at date range', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '20');

    await tenant.client.post('/api/sales', {
      soldAt: '2026-01-10T00:00:00.000Z',
      items: [{ productId: product.id, quantity: 1 }],
    });
    await tenant.client.post('/api/sales', {
      soldAt: '2026-06-10T00:00:00.000Z',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const january = await tenant.client.get<{ data: Sale[] }>(
      '/api/sales?from=2026-01-01&to=2026-01-31',
    );
    assert.equal(january.body.data.length, 1);
    assert.equal(january.body.data[0]?.soldAt, '2026-01-10T00:00:00.000Z');
  });

  it('rejects an unknown query key such as orderBy with 400', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');
    await tenant.client.post('/api/sales', {
      items: [{ productId: product.id, quantity: 1 }],
    });

    // The list schema is `.strict()`, so an attempt to steer the SQL is refused
    // outright rather than ignored. Either way the value can never reach a query.
    const response = await tenant.client.get<{ data: Sale[] }>(
      '/api/sales?orderBy=total_amount%3B+DROP+TABLE+sales--',
    );

    assert.equal(response.status, 400);

    // The table is, of course, still there.
    const still = await tenant.client.get<{ meta: Meta }>('/api/sales');
    assert.equal(still.body.meta.total, 1);
  });
});

describe('GET /api/sales/:id', () => {
  it('returns the sale with its items and product information', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, {
      name: 'Detailed Widget',
      sku: 'DET-1',
      unit: 'box',
      sellingPrice: '12.50',
    });
    await stockIn(tenant.client, product.id, '10');

    const created = (
      await tenant.client.post<{ data: Sale }>('/api/sales', {
        customerName: 'Acme',
        items: [{ productId: product.id, quantity: 2 }],
      })
    ).body.data;

    const response = await tenant.client.get<{ data: Sale }>(`/api/sales/${created.id}`);

    assert.equal(response.status, 200);
    const sale = response.body.data;

    assert.equal(sale.id, created.id);
    assert.equal(sale.totalAmount, '25.00');
    assert.equal(sale.status, 'completed');
    assert.equal(sale.customerName, 'Acme');
    assert.equal(sale.createdBy.name, 'Test Owner');
    assert.equal(sale.items?.length, 1);
    assert.equal(sale.items?.[0]?.sku, 'DET-1');
    assert.equal(sale.items?.[0]?.productName, 'Detailed Widget');
    assert.equal(sale.items?.[0]?.unit, 'box');
    assert.equal(sale.items?.[0]?.lineTotal, '25.00');
  });

  it('returns 404 for an unknown sale id', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get(
      '/api/sales/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(response.status, 404);
  });

  it('exposes no update or delete route', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '10');
    const sale = (
      await tenant.client.post<{ data: Sale }>('/api/sales', {
        items: [{ productId: product.id, quantity: 1 }],
      })
    ).body.data;

    const patch = await tenant.client.patch(`/api/sales/${sale.id}`, { status: 'refunded' });
    const del = await tenant.client.delete(`/api/sales/${sale.id}`);

    assert.ok(patch.status === 404 || patch.status === 405, `PATCH got ${patch.status}`);
    assert.ok(del.status === 404 || del.status === 405, `DELETE got ${del.status}`);

    // And the ledger is untouched by the attempts.
    assert.equal(await readStock(tenant.client, product.id), 9);
  });
});

// ---------------------------------------------------------------------------
// 14–15: authorization
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('lets a staff user create and view sales', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '3.00' });
    await stockIn(tenant.client, product.id, '10');
    const { client: staff, user: staffUser } = await createStaffSession(
      server,
      tenant.user.businessId,
    );

    assert.equal((await staff.get('/api/sales')).status, 200);

    const response = await staff.post<{ data: Sale }>('/api/sales', {
      items: [{ productId: product.id, quantity: 2 }],
    });

    assert.equal(response.status, 201, 'selling is day-to-day work for staff too');
    assert.equal(response.body.data.createdBy.id, staffUser.id, 'the real actor is recorded');
    assert.equal(response.body.data.totalAmount, '6.00');
    assert.equal(await readStock(staff, product.id), 8);
  });

  it('rejects unauthenticated access to every sales route', async () => {
    const client = server.client();

    assert.equal((await client.get('/api/sales')).status, 401);
    assert.equal((await client.post('/api/sales', { items: [] })).status, 401);
    assert.equal(
      (await client.get('/api/sales/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status,
      401,
    );
  });
});

// ---------------------------------------------------------------------------
// 21: concurrency
// ---------------------------------------------------------------------------

describe('concurrency', () => {
  it('never oversells when two sales race for the same stock', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '10.00' });
    await stockIn(tenant.client, product.id, '5');

    // 4 + 4 = 8 > 5, so at most one may succeed. Both are issued without an
    // await in between, so they overlap in the server. The per-product advisory
    // lock — the same one the direct inventory route uses — is what guarantees
    // it; the assertion holds even if the two happen to serialise.
    const [first, second] = await Promise.all([
      tenant.client.post<{ data: Sale }>('/api/sales', {
        items: [{ productId: product.id, quantity: 4 }],
      }),
      tenant.client.post<{ data: Sale }>('/api/sales', {
        items: [{ productId: product.id, quantity: 4 }],
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409], 'exactly one sale may succeed');

    assert.equal(await readStock(tenant.client, product.id), 1, '5 − 4 = 1, never negative');

    // Exactly one sale exists, and it created exactly one movement.
    const sales = await tenant.client.get<{ meta: Meta }>('/api/sales');
    assert.equal(sales.body.meta.total, 1, 'the losing sale left no row');

    const winner = first.status === 201 ? first : second;
    assert.equal(await countMovements(product.id, winner.body.data.id), 1);

    // The product's whole ledger for this sale must be a single entry: one `in`
    // of 5 and one `out` of 4. Nothing from the rejected sale survived.
    const ledger = await tenant.client.get<{ data: { movementType: string; quantity: number }[] }>(
      `/api/inventory/${product.id}/movements?limit=50`,
    );
    const outMovements = ledger.body.data.filter((m) => m.movementType === 'out');
    assert.equal(outMovements.length, 1, 'only the winning sale moved stock');
    assert.equal(outMovements[0]?.quantity, 4);
  });

  it('keeps sales against different products independent', async () => {
    const tenant = await createTenant(server);
    const first = await createProduct(tenant, { name: 'A' });
    const second = await createProduct(tenant, { name: 'B' });
    await stockIn(tenant.client, first.id, '5');
    await stockIn(tenant.client, second.id, '5');

    const results = await Promise.all([
      tenant.client.post('/api/sales', {
        items: [{ productId: first.id, quantity: 5 }],
      }),
      tenant.client.post('/api/sales', {
        items: [{ productId: second.id, quantity: 5 }],
      }),
    ]);

    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [201, 201],
      'the lock is per product, so neither sale blocks the other',
    );
  });
});

// ---------------------------------------------------------------------------
// No duplicate source of truth
// ---------------------------------------------------------------------------

describe('no duplicate source of truth', () => {
  it('stores no balance column on sales, sale_items or products', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant);
    await stockIn(tenant.client, product.id, '5');
    await tenant.client.post('/api/sales', {
      items: [{ productId: product.id, quantity: 1 }],
    });

    // `sale_items.quantity` is legitimately present: it records how much was
    // *sold*, not how much is left. What must not exist anywhere is a column
    // that could be mistaken for a cached stock balance.
    const columns = await getPool().query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('sales', 'sale_items', 'products')
          AND column_name ~ '(stock|on_hand|available|balance)'
          AND NOT (table_name = 'sale_items' AND column_name = 'quantity')`,
    );

    assert.deepEqual(
      columns.rows,
      [],
      'no cached stock balance may exist; the ledger is the only source of truth',
    );
  });

  it('recomputes a sale total from its lines rather than trusting a cache', async () => {
    const tenant = await createTenant(server);
    const product = await createProduct(tenant, { sellingPrice: '1.10' });
    await stockIn(tenant.client, product.id, '10');

    const sale = (
      await tenant.client.post<{ data: Sale }>('/api/sales', {
        items: [{ productId: product.id, quantity: 3 }],
      })
    ).body.data;

    const recomputed = await getPool().query<{ total: string }>(
      'SELECT COALESCE(SUM(line_total), 0) AS total FROM sale_items WHERE sale_id = $1',
      [sale.id],
    );

    assert.equal(sale.totalAmount, '3.30', '3 × 1.10 in exact numeric');
    assert.equal(recomputed.rows[0]?.total, sale.totalAmount, 'the stored total matches its lines');
  });
});
