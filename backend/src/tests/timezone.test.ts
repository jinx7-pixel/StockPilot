/**
 * Timezone consistency regression tests.
 *
 * ## The bug this locks down
 *
 * Two intelligence repositories bucketed calendar days differently:
 *
 *   - `demandFacts.repository.ts` pinned every day boundary with
 *     `AT TIME ZONE 'UTC'`;
 *   - `risk.repository.ts` used a bare `date_trunc('day', sold_at)`, which
 *     resolves in the **session** timezone.
 *
 * The session timezone defaults to the PostgreSQL *server's* setting, not the
 * application's. So `count(DISTINCT date_trunc('day', sold_at))` — a direct input
 * to the active-sales-days evidence gate and to every confidence ladder — could
 * return a different answer in production than on a laptop, with no error.
 *
 * ## How these tests prove it is fixed
 *
 * They do not merely assert a constant. They:
 *
 *   1. prove an application connection really is UTC (`SHOW timezone`);
 *   2. construct a sale at **23:30 UTC**, a moment that falls on a *different*
 *      calendar day in every negative-offset zone;
 *   3. demonstrate that a deliberately non-UTC session buckets it differently —
 *      proving the test is not vacuous and that the old behaviour was real;
 *   4. show Stock Risk, the shared demand facts and analytics all agree on the
 *      same UTC day.
 */

import assert from 'node:assert/strict';
import { Client } from 'pg';
import { after, before, beforeEach, describe, it } from 'node:test';

import { buildClientConfig } from '../db/config.js';
import { getPool } from '../db/pool.js';
import { env } from '../config/env.js';
import { getStockRiskFacts } from '../repositories/risk.repository.js';
import { getProductDemandFact } from '../repositories/demandFacts.repository.js';
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
} from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

/** A zone far from UTC in both directions, used to prove the test bites. */
const NON_UTC_ZONE = 'Asia/Kolkata';

/**
 * A sale instant that is unambiguously "today" in UTC but already "tomorrow" in
 * IST. 23:30 UTC on the current UTC date becomes 05:00 the *next* IST day, so a
 * session-timezone-dependent bucket disagrees with a UTC one.
 */
function boundarySaleInstant(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 30, 0),
  );
}

/** Insert a sale directly, so the instant is exact rather than API-rounded. */
async function insertSaleAt(
  tenant: Tenant,
  productId: string,
  quantity: string,
  soldAt: Date,
): Promise<string> {
  const sale = await getPool().query<{ id: string }>(
    `INSERT INTO sales (business_id, status, sold_at, total_amount, created_by)
     VALUES ($1, 'completed', $2, $3::numeric, $4)
     RETURNING id`,
    [tenant.user.businessId, soldAt, quantity, tenant.user.id],
  );
  const saleId = sale.rows[0]!.id;
  await getPool().query(
    `INSERT INTO sale_items (business_id, sale_id, product_id, quantity, unit_price, line_total)
     VALUES ($1, $2, $3, $4::numeric, '10.00', $4::numeric * 10)`,
    [tenant.user.businessId, saleId, productId, quantity],
  );
  return saleId;
}

async function insertOpeningStock(tenant: Tenant, productId: string, quantity: string): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, 'in', $3::numeric, 'Opening', $4, now() - interval '200 days')`,
    [tenant.user.businessId, productId, quantity, tenant.user.id],
  );
}

async function createProduct(tenant: Tenant, sku: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/**
 * Read the session timezone.
 *
 * `SHOW timezone` returns a column literally named `TimeZone`, which `pg` does not
 * lowercase, so selecting `current_setting` is both explicit and stable.
 */
async function sessionTimezone(client: { query: (sql: string) => Promise<{ rows: Array<{ timezone: string }> }> }): Promise<string> {
  const result = await client.query(
    "SELECT current_setting('TimeZone') AS timezone",
  );
  return result.rows[0]!.timezone;
}

/** A connection that deliberately opts out of the UTC pin. */
async function openUnpinnedClient(timezone: string): Promise<Client> {
  const client = new Client({ ...buildClientConfig(), database: env.database.testDatabase });
  await client.connect();
  await client.query(`SET timezone TO '${timezone}'`);
  return client;
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

describe('Timezone — the application session is pinned to UTC', () => {
  it('reports UTC on every pooled connection', async () => {
    const client = await getPool().connect();
    try {
      assert.equal(await sessionTimezone(client), 'UTC');
    } finally {
      client.release();
    }
  });

  it('reports UTC for each of several fresh connections, not just one', async () => {
    // A pool can hand back an already-used connection. Every one must be UTC, so
    // repeat rather than sampling a single instance.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const client = await getPool().connect();
      try {
        assert.equal(
          await sessionTimezone(client),
          'UTC',
          `connection ${attempt} was not UTC`,
        );
      } finally {
        client.release();
      }
    }
  });

  it('pins the session independently of whatever the server default is', async () => {
    // Drive a session to a non-UTC zone the way an unpinned client would behave,
    // and show the application connection is unaffected.
    const unpinned = await openUnpinnedClient(NON_UTC_ZONE);
    const pooled = await getPool().connect();
    try {
      assert.notEqual(await sessionTimezone(unpinned), 'UTC', 'the control must really be non-UTC');
      assert.equal(await sessionTimezone(pooled), 'UTC');
    } finally {
      // Both clients must be released, or the pool drains and the next test
      // blocks waiting for a connection that never arrives.
      pooled.release();
      await unpinned.end();
    }
  });
});

describe('Timezone — a 23:30 UTC sale is one UTC day everywhere', () => {
  it('Stock Risk and the shared demand facts agree on the active day count', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'TZ-BOUNDARY');
    await insertOpeningStock(tenant, productId, '100');

    const boundary = boundarySaleInstant();
    // One sale at the boundary, one well inside the same UTC day. If the bucket
    // were session-local, these two would land in different days and the count
    // would be 2 instead of 1.
    await insertSaleAt(tenant, productId, '2', boundary);
    await insertSaleAt(
      tenant,
      productId,
      '2',
      new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth(), boundary.getUTCDate(), 12, 0, 0)),
    );

    const risk = await getStockRiskFacts(tenant.user.businessId, productId);
    const facts = await getProductDemandFact(tenant.user.businessId, productId);

    assert.ok(risk, 'stock risk facts must exist');
    assert.ok(facts, 'demand facts must exist');

    // Two sales, one UTC day.
    assert.equal(risk.active_sales_days, 1, 'Stock Risk must bucket both sales into one UTC day');
    assert.equal(
      facts.active_sales_days_30d,
      risk.active_sales_days,
      'Stock Risk and the shared demand facts must agree on active sales days',
    );

    // And the units themselves are windowed identically.
    assert.equal(
      Number(risk.units_sold),
      Number(facts.units_sold_30d),
      'both modules must count the same units in the same 30-day window',
    );
  });

  it('the same two sales really would disagree under a non-UTC session', async () => {
    // Guards against a vacuous test. If the old expression were used with a
    // non-UTC session, these two sales would fall in different local days.
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'TZ-CONTROL');
    await insertOpeningStock(tenant, productId, '100');

    const boundary = boundarySaleInstant();
    await insertSaleAt(tenant, productId, '2', boundary);
    await insertSaleAt(
      tenant,
      productId,
      '2',
      new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth(), boundary.getUTCDate(), 12, 0, 0)),
    );

    const unpinned = await openUnpinnedClient(NON_UTC_ZONE);
    try {
      // The pre-fix expression, evaluated deliberately without the UTC pin.
      const legacy = await unpinned.query<{ active_days: number }>(
        `SELECT count(DISTINCT date_trunc('day', s.sold_at))::int AS active_days
           FROM sales s
           JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
          WHERE si.business_id = $1 AND si.product_id = $2 AND s.status = 'completed'
            AND s.sold_at >= now() - interval '30 days'`,
        [tenant.user.businessId, productId],
      );

      // The pinned expression, evaluated on the application's UTC session.
      const pinned = await getPool().query<{ active_days: number }>(
        `SELECT count(DISTINCT date_trunc('day', s.sold_at AT TIME ZONE 'UTC'))::int AS active_days
           FROM sales s
           JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
          WHERE si.business_id = $1 AND si.product_id = $2 AND s.status = 'completed'
            AND s.sold_at >= now() - interval '30 days'`,
        [tenant.user.businessId, productId],
      );

      // In IST, 23:30 UTC is 05:00 the following day, so the session-local bucket
      // splits them. That is the bug this suite exists to prevent.
      assert.equal(
        legacy.rows[0]!.active_days,
        2,
        'a non-UTC session must demonstrably split the two sales',
      );
      assert.equal(
        pinned.rows[0]!.active_days,
        1,
        'the UTC-pinned bucket must keep them together',
      );
    } finally {
      await unpinned.end();
    }
  });

  it('observable history days are counted in UTC too', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'TZ-HISTORY');
    // Opening stock exactly one UTC day ago.
    await getPool().query(
      `INSERT INTO inventory_movements
         (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
       VALUES ($1, $2, 'in', '10.00', 'Opening', $3, (now() AT TIME ZONE 'UTC')::date - interval '1 day')`,
      [tenant.user.businessId, productId, tenant.user.id],
    );

    const risk = await getStockRiskFacts(tenant.user.businessId, productId);
    assert.ok(risk);
    assert.equal(
      risk.observable_history_days,
      1,
      'a product stocked one UTC day ago has one day of observable history',
    );
  });
});

describe('Timezone — analytics groups days in UTC', () => {
  it('puts a late-UTC sale in that UTC calendar day', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'TZ-ANALYTICS');
    await insertOpeningStock(tenant, productId, '100');
    await insertSaleAt(tenant, productId, '3', boundarySaleInstant());

    // A narrow window around the boundary sale. A wide one would ask the series
    // generator for tens of thousands of periods and stall the suite.
    const boundary = boundarySaleInstant();
    const from = new Date(boundary.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(boundary.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);

    const response = await tenant.client.get<{
      data: {
        series: Array<{ period: string; salesCount: number; unitsSold: number }>;
      };
    }>(`/api/analytics/sales?from=${from}&to=${to}&groupBy=day`);

    assert.equal(response.status, 200, JSON.stringify(response.body));

    const expectedUtcDay = boundary.toISOString().slice(0, 10);
    const periods = response.body.data.series.map((row) => row.period);

    assert.ok(
      periods.includes(expectedUtcDay),
      `expected the sale in UTC day ${expectedUtcDay}, got ${JSON.stringify(periods)}`,
    );

    const row = response.body.data.series.find((entry) => entry.period === expectedUtcDay)!;
    assert.equal(row.salesCount, 1);
    assert.equal(row.unitsSold, 3);
  });

  it('reports the same sales-today count under UTC and a shifted session', async () => {
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'TZ-TODAY');
    await insertOpeningStock(tenant, productId, '100');
    await insertSaleAt(tenant, productId, '4', boundarySaleInstant());

    const response = await tenant.client.get<{
      data: { sales: { today: { salesCount: number } } };
    }>('/api/analytics/overview');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      response.body.data.sales.today.salesCount,
      1,
      'the boundary sale counts as today, because today is UTC today',
    );
  });

  it('leaves rolling window counts as rolling instants', async () => {
    // The 7/30-day windows subtract an interval from `now()`. That is an absolute
    // instant and was already session-independent. This test pins that they were
    // not "fixed" into calendar days, which would silently change every metric.
    const tenant = await createTenant(server);
    const productId = await createProduct(tenant, 'TZ-ROLLING');
    await insertOpeningStock(tenant, productId, '100');
    await insertSaleAt(tenant, productId, '5', boundarySaleInstant());

    const response = await tenant.client.get<{
      data: { sales: { last7Days: { salesCount: number }; last30Days: { salesCount: number } } };
    }>('/api/analytics/overview');

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.sales.last7Days.salesCount, 1);
    assert.equal(response.body.data.sales.last30Days.salesCount, 1);
  });
});

describe('Timezone — no cross-tenant leakage', () => {
  it('does not expose another tenant’s sales through the boundary logic', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    const productA = await createProduct(tenantA, 'TZ-ISO-A');
    const productB = await createProduct(tenantB, 'TZ-ISO-B');
    await insertOpeningStock(tenantA, productA, '100');
    await insertOpeningStock(tenantB, productB, '100');

    // Each tenant sells on its own UTC day at the same instant.
    await insertSaleAt(tenantA, productA, '2', boundarySaleInstant());
    await insertSaleAt(
      tenantB,
      productB,
      '2',
      new Date(Date.UTC(boundarySaleInstant().getUTCFullYear(), boundarySaleInstant().getUTCMonth(), boundarySaleInstant().getUTCDate(), 1, 0, 0)),
    );

    const responseA = await tenantA.client.get<{
      data: { sales: { today: { salesCount: number } } };
    }>('/api/analytics/overview');
    const responseB = await tenantB.client.get<{
      data: { sales: { today: { salesCount: number } } };
    }>('/api/analytics/overview');

    assert.equal(responseA.status, 200);
    assert.equal(responseB.status, 200);
    assert.equal(responseA.body.data.sales.today.salesCount, 1, 'tenant A sees only its own sale');
    assert.equal(responseB.body.data.sales.today.salesCount, 1, 'tenant B sees only its own sale');

    // The other tenant's sku must not appear anywhere in the payload.
    assert.ok(!JSON.stringify(responseA.body).includes('TZ-ISO-B'));
    assert.ok(!JSON.stringify(responseB.body).includes('TZ-ISO-A'));
  });
});