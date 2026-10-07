/**
 * Confidence & Evidence — API tests.
 *
 * Asserts the enriched response shape across every intelligence endpoint, that
 * tenant isolation and read-only behaviour are unchanged, and — importantly —
 * that the pre-existing response fields are still exactly where callers expect
 * them. Enrichment must be additive: nothing may be renamed, removed or
 * reinterpreted for an existing consumer.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getPool } from '../db/pool.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

interface EnrichedRow extends Record<string, unknown> {
  explanation: Explanation;
  confidence: string;
}

interface Explanation {
  decision: string;
  confidence: string;
  evidence: Array<{
    source: string;
    metric: string;
    value: string | number;
    unit?: string;
    interpretation: string;
  }>;
  limitations: string[];
}

const VALID_SOURCES = ['demand', 'inventory', 'supplier', 'data_quality'];
const VALID_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'];

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

async function createSupplier(tenant: Tenant, name: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function seedStock(tenant: Tenant, productId: string, quantity: string): Promise<void> {
  await getPool().query(
    `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, reason, created_by, created_at)
     VALUES ($1, $2, 'in', $3::numeric, 'Opening stock', $4::uuid, now() - interval '200 days')`,
    [tenant.user.businessId, productId, quantity, tenant.user.id],
  );
}

async function seedSales(
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

async function seedOrder(
  tenant: Tenant,
  supplierId: string,
  productId: string,
  leadTimeDays?: number,
): Promise<string> {
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

function recentAges(count: number, startAge = 0): number[] {
  return Array.from({ length: count }, (_, index) => startAge + index);
}

/** Assert the locked envelope, field by field. */
function assertEnvelope(explanation: unknown, label: string): Explanation {
  assert.ok(explanation, `${label}: explanation must be present`);
  const exp = explanation as Explanation;

  assert.equal(typeof exp.decision, 'string', `${label}: decision is a string`);
  assert.ok(exp.decision.length > 0, `${label}: decision is non-empty`);

  assert.ok(
    VALID_CONFIDENCE.includes(exp.confidence),
    `${label}: confidence "${exp.confidence}" must be one of ${VALID_CONFIDENCE.join('|')}`,
  );

  assert.ok(Array.isArray(exp.evidence), `${label}: evidence is an array`);
  assert.ok(exp.evidence.length > 0, `${label}: a decision must show its evidence`);
  for (const item of exp.evidence) {
    assert.ok(
      VALID_SOURCES.includes(item.source),
      `${label}: unknown evidence source "${item.source}"`,
    );
    assert.equal(typeof item.metric, 'string');
    assert.notEqual(item.value, null, `${label}: "${item.metric}" must not be null`);
    assert.notEqual(item.value, undefined, `${label}: "${item.metric}" must not be undefined`);
    assert.ok(
      typeof item.value === 'string' || typeof item.value === 'number',
      `${label}: "${item.metric}" value must be a string or number`,
    );
    assert.equal(typeof item.interpretation, 'string');
    assert.ok(item.interpretation.length > 0, `${label}: "${item.metric}" needs an interpretation`);
    if (item.unit !== undefined) assert.equal(typeof item.unit, 'string');
  }

  assert.ok(Array.isArray(exp.limitations), `${label}: limitations is an array`);
  for (const limitation of exp.limitations) {
    assert.equal(typeof limitation, 'string');
    assert.ok(limitation.length > 0, `${label}: an empty limitation says nothing`);
  }

  return exp;
}

/** A tenant with one well-evidenced product and one completed supplier order. */
async function seedEverything(tenant: Tenant) {
  const productId = await createProduct(tenant);
  await seedStock(tenant, productId, '100000');
  await seedSales(tenant, productId, recentAges(30), '10');
  const supplierId = await createSupplier(tenant, 'Envelope Co');
  await seedOrder(tenant, supplierId, productId, 5);
  await seedOrder(tenant, supplierId, productId, 6);
  await seedOrder(tenant, supplierId, productId, 5);
  return { productId, supplierId };
}

const LIST_ENDPOINTS = [
  '/api/intelligence/stock-risk',
  '/api/intelligence/demand',
  '/api/intelligence/reorder',
  '/api/intelligence/overstock',
  '/api/intelligence/slow-dead',
  '/api/intelligence/suppliers',
];

// ---------------------------------------------------------------------------

describe('Confidence & Evidence — enriched response shape', () => {
  it('every list endpoint returns the locked envelope on each row', async () => {
    const tenant = await createTenant(server);
    await seedEverything(tenant);

    for (const endpoint of LIST_ENDPOINTS) {
      const response = await tenant.client.get<{ data: Array<{ explanation: unknown }> }>(
        `${endpoint}?limit=100`,
      );
      assert.equal(response.status, 200, `${endpoint}: list failed`);
      assert.ok(response.body.data.length > 0, `${endpoint}: expected at least one row`);

      for (const row of response.body.data) {
        assertEnvelope(row.explanation, endpoint);
      }
    }
  });

  it('every detail endpoint returns the locked envelope', async () => {
    const tenant = await createTenant(server);
    const { productId, supplierId } = await seedEverything(tenant);

    const details = [
      `/api/intelligence/stock-risk/${productId}`,
      `/api/intelligence/demand/${productId}`,
      `/api/intelligence/reorder/${productId}`,
      `/api/intelligence/overstock/${productId}`,
      `/api/intelligence/slow-dead/${productId}`,
      `/api/intelligence/suppliers/${supplierId}`,
    ];

    for (const endpoint of details) {
      const response = await tenant.client.get<{ data: { explanation: unknown } }>(endpoint);
      assert.equal(response.status, 200, `${endpoint}: detail failed`);
      assertEnvelope(response.body.data.explanation, endpoint);
    }
  });

  it('preserves the existing response fields alongside the envelope', async () => {
    const tenant = await createTenant(server);
    await seedEverything(tenant);

    // The fields existing consumers already read must still be there, unchanged
    // in name and meaning. Enrichment is additive.
    const risk = await tenant.client.get<{ data: EnrichedRow[] }>(
      '/api/intelligence/stock-risk?limit=1',
    );
    const riskRow = risk.body.data[0]!;
    for (const field of [
      'risk', 'priority', 'confidence', 'reason', 'evidence', 'daysOfStock',
      'effectiveLeadTimeDays', 'safetyStock', 'reorderPoint', 'analysisWindowDays',
    ]) {
      assert.ok(field in riskRow, `stock risk lost "${field}"`);
    }
    assert.equal(
      riskRow.explanation.confidence,
      riskRow.confidence,
      'the envelope must mirror the authoritative confidence, not restate it',
    );

    const demand = await tenant.client.get<{ data: EnrichedRow[] }>(
      '/api/intelligence/demand?limit=1',
    );
    for (const field of ['trend', 'confidence', 'reason', 'evidence', 'coefficientOfVariation']) {
      assert.ok(field in demand.body.data[0]!, `demand lost "${field}"`);
    }

    const supplier = await tenant.client.get<{ data: EnrichedRow[] }>(
      '/api/intelligence/suppliers?limit=1',
    );
    for (const field of [
      'stability', 'confidence', 'reason', 'evidence', 'medianLeadTimeDays', 'p90LeadTimeDays',
    ]) {
      assert.ok(field in supplier.body.data[0]!, `suppliers lost "${field}"`);
    }
  });

  it('states on-time delivery cannot be measured, without inventing it', async () => {
    const tenant = await createTenant(server);
    await seedEverything(tenant);

    const response = await tenant.client.get<{ data: EnrichedRow[] }>(
      '/api/intelligence/suppliers?limit=100',
    );

    for (const row of response.body.data) {
      const mentions = row.explanation.limitations.some((l: string) =>
        l.toLowerCase().includes('promised delivery date'),
      );
      assert.ok(mentions, 'the missing promised date must be stated, not silently omitted');
    }

    const body = JSON.stringify(response.body);
    assert.ok(!/onTimePercentage|on_time|lateCount|slaCompliance/i.test(body),
      'no on-time or SLA figure may be invented');
  });

  it('reports limitations only where evidence is genuinely weak', async () => {
    const tenant = await createTenant(server);
    const { productId } = await seedEverything(tenant);

    const wellEvidenced = await tenant.client.get<{ data: EnrichedRow[] }>(
      '/api/intelligence/demand?limit=100',
    );
    for (const row of wellEvidenced.body.data) {
      assert.deepEqual(row.explanation.limitations, [],
        '30 dense sales days are not a limitation');
    }

    // A product with almost no history must produce them.
    const thin = await createProduct(tenant);
    await seedStock(tenant, thin, '5');
    const thinResponse = await tenant.client.get<{ data: EnrichedRow[] }>(
      '/api/intelligence/demand?limit=100',
    );
    const thinRow = thinResponse.body.data[1];
    assert.ok(thinRow, 'expected the thin product in the list');
    assert.ok(thinRow.explanation.limitations.length > 0,
      'a product with almost no sales must carry limitations');

    void productId;
  });

  it('the envelope is deterministic across repeated reads', async () => {
    const tenant = await createTenant(server);
    await seedEverything(tenant);

    const first = await tenant.client.get<{ data: EnrichedRow[] }>('/api/intelligence/demand?limit=100');
    const second = await tenant.client.get<{ data: EnrichedRow[] }>('/api/intelligence/demand?limit=100');

    assert.deepEqual(
      first.body.data.map((d) => d.explanation),
      second.body.data.map((d) => d.explanation),
    );
  });
});

describe('Confidence & Evidence — security and read-only', () => {
  it('still requires authentication on every intelligence endpoint', async () => {
    const client = server.client();
    for (const endpoint of LIST_ENDPOINTS) {
      assert.equal((await client.get(endpoint)).status, 401, `${endpoint} must require auth`);
    }
  });

  it('still refuses a client-supplied businessId on every endpoint', async () => {
    const tenant = await createTenant(server);
    for (const endpoint of LIST_ENDPOINTS) {
      assert.equal(
        (await tenant.client.get(`${endpoint}?businessId=some-other-business`)).status,
        400,
        `${endpoint} must reject businessId`,
      );
    }
  });

  it('never leaks another tenant through the explanation', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const { productId: productB } = await seedEverything(tenantB);

    for (const endpoint of LIST_ENDPOINTS) {
      const response = await tenantA.client.get<{ data: Array<Record<string, unknown>> }>(
        `${endpoint}?limit=100`,
      );
      assert.equal(response.status, 200, `${endpoint}: tenant A read failed`);
      const body = JSON.stringify(response.body);
      assert.ok(!body.includes('Envelope Co'), `${endpoint}: leaked tenant B's supplier`);
      assert.ok(!body.includes(productB), `${endpoint}: leaked tenant B's product id`);
    }

    for (const endpoint of [
      '/api/intelligence/stock-risk',
      '/api/intelligence/demand',
      '/api/intelligence/reorder',
      '/api/intelligence/overstock',
      '/api/intelligence/slow-dead',
    ]) {
      const response = await tenantA.client.get(`${endpoint}/${productB}`);
      assert.equal(response.status, 404, `${endpoint}: cross-tenant detail must not be found`);
      assert.ok(!JSON.stringify(response.body).includes(productB),
        `${endpoint}: product id leaked through the error body`);
    }
  });

  it('mutates nothing: the envelope is built from facts already in memory', async () => {
    const tenant = await createTenant(server);
    await seedEverything(tenant);

    const count = async () => {
      const r = await getPool().query<Record<string, number>>(
        `SELECT
           (SELECT count(*) FROM products)::int            AS products,
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
    for (const endpoint of LIST_ENDPOINTS) {
      await tenant.client.get(`${endpoint}?limit=100`);
    }
    assert.equal(await count(), before, 'reading an explanation must not change a single row');
  });

  it('exposes no write route for the explanation layer', async () => {
    const tenant = await createTenant(server);
    for (const endpoint of [...LIST_ENDPOINTS, '/api/intelligence/explanations']) {
      for (const method of ['post', 'patch', 'delete'] as const) {
        assert.equal(
          (await tenant.client[method](endpoint)).status,
          404,
          `${method.toUpperCase()} ${endpoint} must not exist`,
        );
      }
    }
  });

  it('is readable by staff, exactly as before', async () => {
    const tenant = await createTenant(server);
    await seedEverything(tenant);
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    for (const endpoint of LIST_ENDPOINTS) {
      const response = await staff.get<{ data: Array<{ explanation: unknown }> }>(endpoint);
      assert.equal(response.status, 200, `${endpoint}: staff read failed`);
      for (const row of response.body.data) assertEnvelope(row.explanation, endpoint);
    }
  });
});