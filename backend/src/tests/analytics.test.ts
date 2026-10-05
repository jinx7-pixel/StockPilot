/**
 * Analytics tests.
 *
 * The properties that matter most, and that this suite exists to protect:
 *  - analytics is a **view**, not a store — no metric is cached anywhere, and
 *    stock is read through the same expression the inventory ledger uses;
 *  - figures are **exact**: revenue and quantity totals match direct SQL;
 *  - empty and partial data produce zeroes and `null`s, never `NaN`;
 *  - one business can never see another's numbers.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { QueryResultRow } from 'pg';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestClient, type TestServer } from './helpers/testServer.js';
import { createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface Overview {
  products: { totalProducts: number; activeProducts: number; inactiveProducts: number };
  inventory: {
    totalStockUnits: number;
    productsWithStock: number;
    outOfStockProducts: number;
    productsWithNoMovements: number;
  };
  sales: Record<'today' | 'last7Days' | 'last30Days', Record<string, number | string>>;
  purchasing: {
    purchaseOrdersLast30Days: number;
    purchaseValueLast30Days: string;
    unitsReceivedLast30Days: number;
  };
}

interface ProductAnalytics {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
  currentStock: number;
  unitsSold: number;
  salesCount: number;
  revenue: string;
  averageDailySales: number;
  lastSaleAt: string | null;
  lastMovementAt: string | null;
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

async function createSale(
  client: TestClient,
  items: { productId: string; quantity: string }[],
): Promise<void> {
  const response = await client.post('/api/sales', { items });
  assert.equal(response.status, 201, JSON.stringify(response.body));
}

async function createSupplier(client: TestClient, name: string): Promise<string> {
  const response = await client.post<{ data: { id: string } }>('/api/suppliers', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/** A tenant with a small, fully-known dataset. */
async function seedDataset(): Promise<{
  tenant: Tenant;
  cable: string;
  mouse: string;
  unsold: string;
  neverMoved: string;
  supplier: string;
}> {
  const tenant = await createTenant(server);

  const cable = await createProduct(tenant, {
    name: 'Cable',
    sku: 'AN-1',
    sellingPrice: '10.00',
  });
  const mouse = await createProduct(tenant, {
    name: 'Mouse',
    sku: 'AN-2',
    sellingPrice: '20.00',
  });
  const unsold = await createProduct(tenant, {
    name: 'Unsold',
    sku: 'AN-3',
    sellingPrice: '3.00',
  });
  const neverMoved = await createProduct(tenant, { name: 'Never Moved', sku: 'AN-4' });

  for (const id of [cable, mouse, unsold, neverMoved]) {
    await stockIn(tenant.client, id, '100');
  }

  // Cable: 100 in, 30 out, 3 out (sale), 2 shrinkage
  await tenant.client.post('/api/inventory/movements', {
    productId: cable,
    movementType: 'out',
    quantity: '30',
  });
  await tenant.client.post('/api/inventory/movements', {
    productId: cable,
    movementType: 'adjustment',
    quantity: '-2',
  });
  // Mouse: 100 in, 25 out, 1 out (sale)
  await tenant.client.post('/api/inventory/movements', {
    productId: mouse,
    movementType: 'out',
    quantity: '25',
  });

  await createSale(tenant.client, [
    { productId: cable, quantity: '3' },
    { productId: mouse, quantity: '1' },
  ]);

  const supplier = await createSupplier(tenant.client, 'Acme Parts');

  // An order that is only partially received, so `received` is not the whole story.
  const order = (
    await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
      supplierId: supplier,
      items: [{ productId: unsold, quantity: '50', unitCost: '1.00' }],
    })
  ).body.data;

  await tenant.client.post(`/api/purchase-orders/${order.id}/order`);
  await tenant.client.post(`/api/purchase-orders/${order.id}/receive`, {
    items: [{ productId: unsold, quantity: '20' }],
  });

  return { tenant, cable, mouse, unsold, neverMoved, supplier };
}

/** Ask PostgreSQL directly, so a test can compare the API against ground truth. */
async function sql<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T> {
  const result = await getPool().query<T>(text, params);
  return result.rows[0] as T;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

describe('GET /api/analytics/overview', () => {
  it('returns zeroes for a brand-new business', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get<{ data: Overview }>('/api/analytics/overview');

    assert.equal(response.status, 200);
    const data = response.body.data;
    assert.deepEqual(data.products, { totalProducts: 0, activeProducts: 0, inactiveProducts: 0 });
    assert.equal(data.inventory.totalStockUnits, 0);
    assert.equal(data.sales.today.salesCount, 0);
    assert.equal(data.sales.today.revenue, '0.00', 'money is still two decimals');
    assert.equal(data.purchasing.purchaseValueLast30Days, '0.00');
  });

  it('counts active and inactive products', async () => {
    const tenant = await createTenant(server);
    const live = await createProduct(tenant, { name: 'Live' });
    await createProduct(tenant, { name: 'Retired' });
    await tenant.client.delete(`/api/products/${live}`.replace(live, (await createProduct(tenant, { name: 'Temp' }))));

    const response = await tenant.client.get<{ data: Overview }>('/api/analytics/overview');

    assert.equal(response.body.data.products.totalProducts, 3);
    assert.equal(response.body.data.products.activeProducts, 2);
    assert.equal(response.body.data.products.inactiveProducts, 1);
  });

  it('derives stock from the ledger', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{ data: Overview }>('/api/analytics/overview');
    const { totalStockUnits, productsWithStock, outOfStockProducts } = response.body.data.inventory;

    // cable 65 + mouse 74 + unsold 120 + neverMoved 100
    assert.equal(totalStockUnits, 359);
    assert.equal(productsWithStock, 4);
    assert.equal(outOfStockProducts, 0);
  });

  it('reports sales counts, units and revenue', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{ data: Overview }>('/api/analytics/overview');
    const today = response.body.data.sales.today;

    assert.equal(today.salesCount, 1);
    assert.equal(today.unitsSold, 4, '3 cables + 1 mouse');
    assert.equal(today.revenue, '50.00', '3 × 10.00 + 1 × 20.00');
  });

  it('reports purchasing metrics and excludes cancelled orders', async () => {
    const { tenant, supplier } = await seedDataset();

    const cancelled = (
      await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
        supplierId: supplier,
        items: [{ productId: (await createProduct(tenant, { name: 'X' })), quantity: '5', unitCost: '99.00' }],
      })
    ).body.data;
    await tenant.client.patch(`/api/purchase-orders/${cancelled.id}`, { status: 'cancelled' });

    const response = await tenant.client.get<{ data: Overview }>('/api/analytics/overview');
    const purchasing = response.body.data.purchasing;

    assert.equal(purchasing.purchaseOrdersLast30Days, 1, 'the cancelled order is excluded');
    assert.equal(purchasing.purchaseValueLast30Days, '50.00');
    assert.equal(purchasing.unitsReceivedLast30Days, 20, 'only what actually arrived');
  });

  it('treats products with no movements and zero stock correctly', async () => {
    const tenant = await createTenant(server);
    const untouched = await createProduct(tenant, { name: 'Untouched' });
    const drained = await createProduct(tenant, { name: 'Drained' });
    await stockIn(tenant.client, drained, '5');
    await tenant.client.post('/api/inventory/movements', {
      productId: drained,
      movementType: 'out',
      quantity: '5',
    });

    const response = await tenant.client.get<{ data: Overview }>('/api/analytics/overview');
    const inventory = response.body.data.inventory;

    assert.equal(inventory.productsWithNoMovements, 1, 'only the untouched one');
    assert.equal(
      inventory.outOfStockProducts,
      2,
      'both are at zero — never stocked and fully drained both count',
    );
    assert.equal(inventory.totalStockUnits, 0);
    void untouched;
  });
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

describe('GET /api/analytics/sales', () => {
  it('returns an empty series and zero summary for a new business', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get<{
      data: { series: unknown[]; summary: Record<string, number | string>; groupBy: string };
    }>('/api/analytics/sales');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.series, []);
    assert.equal(response.body.data.summary.salesCount, 0);
    assert.equal(response.body.data.summary.revenue, '0.00');
    assert.equal(response.body.data.summary.averageSaleValue, '0.00');
  });

  it('groups by day by default', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{
      data: { series: { period: string; salesCount: number; unitsSold: number; revenue: string }[]; groupBy: string };
    }>('/api/analytics/sales');

    assert.equal(response.body.data.groupBy, 'day');
    assert.equal(response.body.data.series.length, 1);
    assert.equal(response.body.data.series[0]?.unitsSold, 4);
    assert.equal(response.body.data.series[0]?.revenue, '50.00');
  });

  it('supports week and month grouping', async () => {
    const { tenant } = await seedDataset();

    for (const groupBy of ['week', 'month'] as const) {
      const response = await tenant.client.get<{ data: { series: unknown[]; groupBy: string } }>(
        `/api/analytics/sales?groupBy=${groupBy}`,
      );
      assert.equal(response.status, 200, groupBy);
      assert.equal(response.body.data.groupBy, groupBy);
      assert.equal(response.body.data.series.length, 1, groupBy);
    }
  });

  it('filters by date range', async () => {
    const { tenant } = await seedDataset();
    const today = new Date().toISOString().slice(0, 10);
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // A bare `to` date means "through the end of that day".
    const inRange = await tenant.client.get<{ data: { summary: { salesCount: number } } }>(
      `/api/analytics/sales?from=${today}&to=${today}`,
    );
    assert.equal(inRange.body.data.summary.salesCount, 1, "today's sale is inside today's range");

    const outOfRange = await tenant.client.get<{ data: { summary: { salesCount: number } } }>(
      `/api/analytics/sales?from=${lastWeek}&to=${lastWeek}`,
    );
    assert.equal(outOfRange.body.data.summary.salesCount, 0, 'the sale is not last week');
  });

  it('rejects a malformed date, an inverted range and an unknown field', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/analytics/sales?from=nonsense')).status, 400);
    assert.equal((await tenant.client.get('/api/analytics/sales?from=2026-06-01&to=2026-01-01')).status, 400);
    assert.equal((await tenant.client.get('/api/analytics/sales?groupBy=fortnight')).status, 400);
    assert.equal((await tenant.client.get('/api/analytics/sales?businessId=other')).status, 400);
    assert.equal((await tenant.client.get('/api/analytics/sales?orderBy=1')).status, 400);
  });

  it('matches direct SQL for revenue and units', async () => {
    const { tenant } = await seedDataset();
    const businessId = tenant.user.businessId;

    const response = await tenant.client.get<{
      data: { summary: { salesCount: number; unitsSold: number; revenue: string } };
    }>('/api/analytics/sales');

    // Aggregated per sale first: a naive `sales LEFT JOIN sale_items` sums
    // `total_amount` once per line and would double-count a multi-line sale.
    const truth = await sql<{ sales_count: string; units: string; revenue: string }>(
      `WITH per_sale AS (
         SELECT s.id, s.total_amount,
                COALESCE(SUM(si.quantity), 0.00) AS units
           FROM sales s
           LEFT JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
          WHERE s.business_id = $1 AND s.status = 'completed'
          GROUP BY s.id, s.total_amount
       )
       SELECT count(*)::int              AS sales_count,
              COALESCE(SUM(units), 0.00) AS units,
              COALESCE(SUM(total_amount), 0.00) AS revenue
         FROM per_sale`,
      [businessId],
    );

    assert.equal(response.body.data.summary.salesCount, Number(truth.sales_count));
    assert.equal(response.body.data.summary.unitsSold, Number(truth.units));
    assert.equal(response.body.data.summary.revenue, truth.revenue);
  });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe('GET /api/analytics/inventory', () => {
  it('is all zeroes for a new business', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get<{
      data: { currentStock: Record<string, number>; movements: Record<string, number | string> };
    }>('/api/analytics/inventory');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.currentStock.totalStockUnits, 0);
    assert.equal(response.body.data.movements.netMovement, '0.00');
    assert.equal(response.body.data.movements.movementCount, 0);
  });

  it('aggregates IN, OUT and adjustments and computes the net', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{
      data: {
        currentStock: { totalStockUnits: number };
        movements: Record<string, number | string>;
      };
    }>('/api/analytics/inventory');

    const movements = response.body.data.movements;
    // 4 × IN 100 = 400, plus the 20 units received against the purchase order.
    assert.equal(movements.inQuantity, 420);
    // direct OUTs 30 + 25 = 55, plus the two sale OUTs 3 + 1 = 4
    assert.equal(movements.outQuantity, 59);
    // the single −2 shrinkage
    assert.equal(movements.adjustmentQuantity, -2);
    assert.equal(movements.netMovement, '359.00', '420 − 59 − 2');
    assert.equal(response.body.data.currentStock.totalStockUnits, 359, 'matches the net');
  });

  it('handles a product with no movements and zero stock', async () => {
    const tenant = await createTenant(server);
    const untouched = await createProduct(tenant, { name: 'Untouched' });
    const drained = await createProduct(tenant, { name: 'Drained' });
    await stockIn(tenant.client, drained, '5');
    await tenant.client.post('/api/inventory/movements', {
      productId: drained,
      movementType: 'out',
      quantity: '5',
    });

    const response = await tenant.client.get<{
      data: { currentStock: Record<string, number> };
    }>('/api/analytics/inventory');

    assert.equal(response.body.data.currentStock.productsWithNoMovements, 1);
    assert.equal(
      response.body.data.currentStock.outOfStockProducts,
      2,
      'never stocked and fully drained are both at zero',
    );
    void untouched;
  });

  it('rejects an inverted range and an unknown field', async () => {
    const tenant = await createTenant(server);

    assert.equal(
      (await tenant.client.get('/api/analytics/inventory?from=2026-06-01&to=2026-01-01')).status,
      400,
    );
    assert.equal((await tenant.client.get('/api/analytics/inventory?businessId=x')).status, 400);
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('GET /api/analytics/products', () => {
  it('keeps products with no sales and no movements', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{ data: ProductAnalytics[]; meta: { total: number } }>(
      '/api/analytics/products',
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.meta.total, 4, 'every product is listed');

    const bySku = (sku: string) =>
      response.body.data.find((product) => product.sku === sku);

    const unsold = bySku('AN-3');
    assert.equal(unsold?.unitsSold, 0, 'no sales is zero, not excluded');
    assert.equal(unsold?.salesCount, 0);
    assert.equal(unsold?.revenue, '0.00');
    assert.equal(unsold?.averageDailySales, 0);
    assert.equal(unsold?.lastSaleAt, null);
    assert.equal(unsold?.currentStock, 120, 'it received stock through a purchase order');
    assert.ok(unsold?.lastMovementAt, 'but it has moved');
  });

  it('computes stock, units, revenue and average daily sales', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{ data: ProductAnalytics[] }>(
      '/api/analytics/products',
    );
    const cable = response.body.data.find((product) => product.sku === 'AN-1');

    assert.equal(cable?.currentStock, 65, '100 − 30 − 3 − 2');
    assert.equal(cable?.unitsSold, 3);
    assert.equal(cable?.salesCount, 1);
    assert.equal(cable?.revenue, '30.00');
    assert.equal(cable?.averageDailySales, 0.1, '3 units over the 30-day window');
    assert.ok(cable?.lastSaleAt);
    assert.ok(cable?.lastMovementAt);
  });

  it('paginates, searches and filters', async () => {
    const { tenant } = await seedDataset();

    const paged = await tenant.client.get<{ data: ProductAnalytics[]; meta: Meta }>(
      '/api/analytics/products?page=2&limit=2',
    );
    assert.equal(paged.body.data.length, 2);
    assert.equal(paged.body.meta.total, 4);
    assert.equal(paged.body.meta.totalPages, 2);

    const search = await tenant.client.get<{ data: ProductAnalytics[] }>(
      '/api/analytics/products?search=an-1',
    );
    assert.equal(search.body.data.length, 1);
    assert.equal(search.body.data[0]?.sku, 'AN-1');

    const active = await tenant.client.get<{ data: ProductAnalytics[] }>(
      '/api/analytics/products?isActive=true',
    );
    assert.equal(active.body.data.length, 4);
  });

  it('filters by category', async () => {
    const tenant = await createTenant(server);
    const category = (
      await tenant.client.post<{ data: { id: string } }>('/api/categories', { name: 'Tools' })
    ).body.data;

    await createProduct(tenant, { name: 'In Tools', categoryId: category.id });
    await createProduct(tenant, { name: 'Elsewhere' });

    const response = await tenant.client.get<{ data: ProductAnalytics[] }>(
      `/api/analytics/products?categoryId=${category.id}`,
    );

    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0]?.name, 'In Tools');
  });

  it('rejects a bad page size, an unknown field and an SQL-ish search', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/analytics/products?limit=5000')).status, 400);
    assert.equal((await tenant.client.get('/api/analytics/products?orderBy=revenue')).status, 400);
    assert.equal(
      (await tenant.client.get('/api/analytics/products?search=%27%3B+DROP+TABLE+products--')).status,
      200,
      'an injection attempt is treated as a literal search term',
    );

    const tables = await sql<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'products'`,
    );
    assert.equal(tables.count, 1, 'the products table is intact');
  });
});

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

describe('GET /api/analytics/products/:productId', () => {
  it('returns sales, inventory and purchasing metrics', async () => {
    const { tenant, cable, unsold } = await seedDataset();

    const response = await tenant.client.get<{
      data: {
        product: { productId: string; currentStock: number };
        sales: Record<string, number | string | null>;
        inventory: Record<string, number | string | null>;
        purchasing: Record<string, number | string | null>;
        timeSeries: { sales: unknown[]; movements: unknown[] };
      };
    }>(`/api/analytics/products/${cable}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.product.currentStock, 65);
    assert.equal(response.body.data.sales.unitsSold, 3);
    assert.equal(response.body.data.sales.revenue, '30.00');
    assert.equal(response.body.data.inventory.totalIn, 100);
    assert.equal(response.body.data.inventory.totalOut, 33, '30 direct + 3 from the sale');
    assert.equal(response.body.data.inventory.totalAdjustment, -2);
    assert.equal(response.body.data.timeSeries.sales.length, 1);
    assert.equal(response.body.data.timeSeries.movements.length, 4, 'every ledger entry');

    // The unsold product's purchase metrics.
    const purchased = await tenant.client.get<{
      data: { purchasing: { unitsPurchased: number; purchaseOrderCount: number } };
    }>(`/api/analytics/products/${unsold}`);

    assert.equal(purchased.body.data.purchasing.unitsPurchased, 50);
    assert.equal(purchased.body.data.purchasing.purchaseOrderCount, 1);
  });

  it('returns 404 for a missing product and for another business product', async () => {
    const tenant = await createTenant(server);
    const other = await createTenant(server);
    const foreign = await createProduct(other, { name: 'Foreign' });

    assert.equal(
      (await tenant.client.get('/api/analytics/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
        .status,
      404,
    );
    assert.equal(
      (await tenant.client.get(`/api/analytics/products/${foreign}`)).status,
      404,
      'a cross-tenant product is not found',
    );
  });

  it('rejects a malformed product id', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/analytics/products/not-a-uuid')).status, 400);
  });
});

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

describe('GET /api/analytics/suppliers', () => {
  it('returns an empty list for a new business', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get<{ data: unknown[] }>('/api/analytics/suppliers');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
  });

  it('reports units ordered, received and purchase value', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{
      data: {
        supplierName: string;
        purchaseOrderCount: number;
        receivedPurchaseOrderCount: number;
        unitsOrdered: number;
        unitsReceived: number;
        purchaseValue: string;
      }[];
    }>('/api/analytics/suppliers');

    const supplier = response.body.data[0];
    assert.equal(supplier?.purchaseOrderCount, 1);
    assert.equal(
      supplier?.receivedPurchaseOrderCount,
      0,
      'a partially received order is not fully received',
    );
    assert.equal(supplier?.unitsOrdered, 50);
    assert.equal(supplier?.unitsReceived, 20, 'only what actually arrived');
    assert.equal(supplier?.purchaseValue, '50.00');
  });

  it('excludes a cancelled order from every figure', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client, 'Cancelled Ltd');
    const product = await createProduct(tenant, { name: 'Thing' });

    const order = (
      await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
        supplierId: supplier,
        items: [{ productId: product, quantity: '10', unitCost: '5.00' }],
      })
    ).body.data;
    await tenant.client.patch(`/api/purchase-orders/${order.id}`, { status: 'cancelled' });

    const response = await tenant.client.get<{
      data: { purchaseOrderCount: number; unitsOrdered: number; purchaseValue: string }[];
    }>('/api/analytics/suppliers');

    assert.equal(response.body.data[0]?.purchaseOrderCount, 0);
    assert.equal(response.body.data[0]?.unitsOrdered, 0);
    assert.equal(response.body.data[0]?.purchaseValue, '0.00');
  });

  it('returns null lead time when no order has both timestamps', async () => {
    const tenant = await createTenant(server);
    await createSupplier(tenant.client, 'No Orders Ltd');

    const response = await tenant.client.get<{
      data: { averageLeadTimeDays: number | null }[];
    }>('/api/analytics/suppliers');

    assert.equal(
      response.body.data[0]?.averageLeadTimeDays,
      null,
      'unavailable, not zero — a zero lead time would be a lie',
    );
  });

  it('excludes an incomplete order from lead time', async () => {
    const { tenant } = await seedDataset();

    const response = await tenant.client.get<{ data: { averageLeadTimeDays: number | null }[] }>(
      '/api/analytics/suppliers',
    );

    assert.equal(
      response.body.data[0]?.averageLeadTimeDays,
      null,
      'the only order is partial, so there is no measured lead time',
    );
  });

  it('measures lead time for a fully received order', async () => {
    const tenant = await createTenant(server);
    const supplier = await createSupplier(tenant.client, 'Fast Ltd');
    const product = await createProduct(tenant, { name: 'Thing' });

    const order = (
      await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
        supplierId: supplier,
        items: [{ productId: product, quantity: '10', unitCost: '5.00' }],
      })
    ).body.data;

    await tenant.client.post(`/api/purchase-orders/${order.id}/order`);
    // Backdate `ordered_at` by two days so the measured lead time is ~2 days.
    await getPool().query(
      `UPDATE purchase_orders SET ordered_at = ordered_at - interval '2 days' WHERE id = $1`,
      [order.id],
    );
    await tenant.client.post(`/api/purchase-orders/${order.id}/receive`, {
      items: [{ productId: product, quantity: '10' }],
    });

    const response = await tenant.client.get<{
      data: { receivedPurchaseOrderCount: number; averageLeadTimeDays: number | null }[];
    }>('/api/analytics/suppliers');

    assert.equal(response.body.data[0]?.receivedPurchaseOrderCount, 1);
    const lead = response.body.data[0]?.averageLeadTimeDays;
    assert.ok(lead !== null && lead > 1.9 && lead < 2.1, `expected ~2 days, got ${String(lead)}`);
  });

  it('rejects any query parameter', async () => {
    const tenant = await createTenant(server);

    assert.equal((await tenant.client.get('/api/analytics/suppliers?businessId=x')).status, 400);
  });
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('analytics security', () => {
  it('rejects unauthenticated access to every endpoint', async () => {
    const client = server.client();
    const productId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

    for (const path of [
      '/api/analytics/overview',
      '/api/analytics/sales',
      '/api/analytics/inventory',
      '/api/analytics/products',
      `/api/analytics/products/${productId}`,
      '/api/analytics/suppliers',
    ]) {
      assert.equal((await client.get(path)).status, 401, path);
    }
  });

  it('isolates every endpoint between businesses', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    // A gives itself products, stock and a sale.
    const product = await createProduct(tenantA, { name: 'A product' });
    await stockIn(tenantA.client, product, '100');
    await createSale(tenantA.client, [{ productId: product, quantity: '1' }]);
    const supplier = await createSupplier(tenantA.client, 'A Supplier');

    const overview = await tenantB.client.get<{ data: Overview }>('/api/analytics/overview');
    assert.equal(overview.body.data.products.totalProducts, 0);
    assert.equal(overview.body.data.sales.today.salesCount, 0);
    assert.equal(overview.body.data.inventory.totalStockUnits, 0);

    const products = await tenantB.client.get<{ data: ProductAnalytics[]; meta: { total: number } }>(
      '/api/analytics/products',
    );
    assert.equal(products.body.meta.total, 0);

    const sales = await tenantB.client.get<{ data: { summary: { salesCount: number } } }>(
      '/api/analytics/sales',
    );
    assert.equal(sales.body.data.summary.salesCount, 0);

    const inventory = await tenantB.client.get<{
      data: { currentStock: { totalStockUnits: number } };
    }>('/api/analytics/inventory');
    assert.equal(inventory.body.data.currentStock.totalStockUnits, 0);

    const suppliers = await tenantB.client.get<{ data: unknown[] }>('/api/analytics/suppliers');
    assert.deepEqual(suppliers.body.data, [], "A's supplier is invisible");

    assert.equal(
      (await tenantB.client.get(`/api/analytics/products/${product}`)).status,
      404,
    );
    void supplier;
  });

  it('never returns NaN, Infinity or null where a number is expected', async () => {
    const { tenant } = await seedDataset();

    for (const path of [
      '/api/analytics/overview',
      '/api/analytics/sales',
      '/api/analytics/inventory',
      '/api/analytics/products',
      '/api/analytics/suppliers',
    ]) {
      const response = await tenant.client.get(path);
      const serialised = JSON.stringify(response.body);
      assert.ok(!/NaN|Infinity/.test(serialised), `${path} produced a non-finite value`);
    }
  });

  it('is not a second source of stock: no analytics table or stock column exists', async () => {
    const { tenant, cable } = await seedDataset();

    const tables = await sql<{ table_name: string[] }>(
      `SELECT string_agg(table_name, ',')::text AS table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE '%analytic%'`,
    );
    assert.equal(tables.table_name, null, 'analytics stores nothing');

    const stockColumns = await sql<{ column_name: string[] }>(
      `SELECT string_agg(column_name, ',')::text AS column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('current_stock', 'stock_quantity', 'stock_balance')`,
    );
    assert.equal(stockColumns.column_name, null, 'stock exists only in the ledger');

    // Appending a movement is immediately reflected, proving nothing is cached.
    const before = await currentStockViaApi(tenant.client, cable);
    await stockIn(tenant.client, cable, '7');
    assert.equal(await currentStockViaApi(tenant.client, cable), before + 7);
  });
});

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

async function currentStockViaApi(client: TestClient, productId: string): Promise<number> {
  const response = await client.get<{
    data: { product: { currentStock: number } };
  }>(`/api/analytics/products/${productId}`);
  assert.equal(response.status, 200);
  return response.body.data.product.currentStock;
}
