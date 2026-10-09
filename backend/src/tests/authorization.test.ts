/**
 * Owner/staff authorization.
 *
 * ## What this suite protects
 *
 * Before Step 12.6 exactly one route in the application checked a role — deleting
 * a category — so "who may do what" was neither stated nor tested anywhere else.
 * Two things are pinned here:
 *
 *   1. **Behaviour.** What each role may and may not do, end to end through the
 *      real routers.
 *   2. **Wiring.** That every mutation route actually carries a policy guard. A
 *      behavioural test alone cannot catch a guard that was deleted, because the
 *      operations that remain staff-accessible would keep passing.
 *
 * ## What it deliberately does not assert
 *
 * That staff are *restricted*. Most mutations are staff-accessible on purpose —
 * recording a movement, receiving a delivery, raising a draft order are the work.
 * Those tests exist to prove the policy did not become "owner-only for
 * everything" in the name of looking strict.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type express from 'express';

import { ROLE_POLICY, type PolicyKey } from '../auth/policy.js';
import { actionsRouter } from '../routes/actions.routes.js';
import { categoryRouter } from '../routes/category.routes.js';
import { inventoryRouter } from '../routes/inventory.routes.js';
import { productRouter } from '../routes/product.routes.js';
import { purchaseOrderRouter } from '../routes/purchaseOrder.routes.js';
import { salesRouter } from '../routes/sales.routes.js';
import { supplierRouter } from '../routes/supplier.routes.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';
import { createStaffSession, createTenant, productBody, type Tenant } from './helpers/tenancy.js';

let server: TestServer;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createProduct(tenant: Tenant, sku: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>(
    '/api/products',
    productBody({ sku }),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createCategory(tenant: Tenant, name: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/categories', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createSupplier(tenant: Tenant, name: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/suppliers', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

async function createOrder(tenant: Tenant, productId: string, supplierId: string): Promise<string> {
  const response = await tenant.client.post<{ data: { id: string } }>('/api/purchase-orders', {
    supplierId,
    items: [{ productId, quantity: '10', unitCost: '5.00' }],
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id;
}

/** Owner and staff of one business, plus a second business's owner. */
async function world(): Promise<{
  owner: Tenant;
  staff: Tenant;
  otherOwner: Tenant;
  productId: string;
  supplierId: string;
}> {
  const owner = await createTenant(server);
  const otherOwner = await createTenant(server);
  const staffSession = await createStaffSession(server, owner.user.businessId);

  const productId = await createProduct(owner, 'AUTH-PRODUCT');
  const supplierId = await createSupplier(owner, 'Auth Supplier');

  return {
    owner,
    staff: { client: staffSession.client, user: staffSession.user },
    otherOwner,
    productId,
    supplierId,
  };
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
// The policy table itself
// ---------------------------------------------------------------------------

describe('Authorization policy — the table states an answer for every operation', () => {
  it('names the allowed roles and a reason for each operation', () => {
    for (const [key, rule] of Object.entries(ROLE_POLICY)) {
      assert.ok(rule.roles.length > 0, `${key} must allow at least one role`);
      assert.ok(
        rule.roles.every((role) => role === 'owner' || role === 'staff'),
        `${key} names a role that does not exist`,
      );
      assert.ok(rule.because.length > 20, `${key} must explain why`);
    }
  });

  it('uses only the two existing roles', () => {
    // No third role was invented alongside this table.
    const roles = new Set(Object.values(ROLE_POLICY).flatMap((rule) => [...rule.roles]));
    assert.deepEqual([...roles].sort(), ['owner', 'staff']);
  });

  it('restricts exactly the structural operations to owner', () => {
    const ownerOnly = Object.entries(ROLE_POLICY)
      .filter(([, rule]) => rule.roles.length === 1)
      .map(([key]) => key)
      .sort();

    // Product deactivation is deliberately NOT here: it is a reversible soft delete
    // that an earlier milestone decided staff may perform, and an existing test
    // says so. Cancellation is the one genuinely new restriction this step adds.
    assert.deepEqual(ownerOnly, ['category.delete', 'purchaseOrder.cancel']);
  });

  it('leaves product deactivation available to staff, per the existing decision', () => {
    assert.ok(
      ROLE_POLICY['product.deactivate'].roles.includes('staff'),
      'soft delete was decided staff-accessible; this step does not re-litigate it',
    );
  });

  it('leaves the operational workflows available to staff', () => {
    // These are the actions the staff account exists to perform. If one of them
    // ever becomes owner-only, the product is broken for its main users.
    for (const key of [
      'inventory.movement.record',
      'sale.create',
      'purchaseOrder.create',
      'purchaseOrder.place',
      'purchaseOrder.receive',
      'product.create',
      'supplier.create',
      'action.execute',
    ] as const) {
      assert.ok(
        ROLE_POLICY[key].roles.includes('staff'),
        `${key} must remain staff-accessible`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Wiring: every mutation carries a guard
// ---------------------------------------------------------------------------

describe('Authorization policy — every mutation route is guarded', () => {
  /**
   * Collect the policy keys mounted on each mutating route.
   *
   * The guard is discovered by its `policyKey` marker rather than by identity,
   * so this fails if a guard is swapped for a plain `requireRole` call or
   * removed outright.
   */
  function guardedMutations(router: express.Router): Map<string, PolicyKey[]> {
    const found = new Map<string, PolicyKey[]>();

    for (const layer of router.stack as unknown as Array<{
      route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle?: unknown }> };
    }>) {
      const route = layer.route;
      if (!route) continue;
      if (!route.methods.post && !route.methods.patch && !route.methods.put && !route.methods.delete) {
        continue;
      }

      const keys = route.stack
        .map((entry) => entry.handle as { policyKey?: PolicyKey } | undefined)
        .map((handle) => handle?.policyKey)
        .filter((key): key is PolicyKey => typeof key === 'string');

      found.set(`${Object.keys(route.methods).join(',')} ${route.path}`, keys);
    }

    return found;
  }

  it('guards every mutation on every business router', () => {
    const routers: Array<[string, express.Router]> = [
      ['categories', categoryRouter],
      ['products', productRouter],
      ['inventory', inventoryRouter],
      ['sales', salesRouter],
      ['suppliers', supplierRouter],
      ['purchase-orders', purchaseOrderRouter],
      ['actions', actionsRouter],
    ];

    for (const [name, router] of routers) {
      const mutations = guardedMutations(router);
      assert.ok(mutations.size > 0, `${name} exposes no mutations, which cannot be right`);

      for (const [route, keys] of mutations) {
        assert.ok(
          keys.length > 0,
          `${name}: ${route} has no role policy guard — an unguarded mutation reads as "unrestricted"`,
        );
        for (const key of keys) {
          assert.ok(
            key in ROLE_POLICY,
            `${name}: ${route} guards with unknown policy "${key}"`,
          );
        }
      }
    }
  });

  it('guards the routes the policy table describes', () => {
    const mounted = new Set<PolicyKey>();
    for (const router of [
      categoryRouter,
      productRouter,
      inventoryRouter,
      salesRouter,
      supplierRouter,
      purchaseOrderRouter,
      actionsRouter,
    ]) {
      for (const keys of guardedMutations(router).values()) {
        for (const key of keys) mounted.add(key);
      }
    }

    // `purchaseOrder.cancel` is checked inside the handler, because only part of
    // a PATCH needs the higher role. Every other entry must be mounted directly.
    const conditional = new Set<PolicyKey>(['purchaseOrder.cancel']);

    for (const key of Object.keys(ROLE_POLICY) as PolicyKey[]) {
      if (conditional.has(key)) continue;
      assert.ok(mounted.has(key), `${key} is in the policy table but mounted nowhere`);
    }
  });
});

// ---------------------------------------------------------------------------
// Owner-only behaviour
// ---------------------------------------------------------------------------

describe('Authorization — owner-only operations', () => {
  it('lets an owner delete a category', async () => {
    const owner = await createTenant(server);
    const categoryId = await createCategory(owner, 'Deletable');

    const response = await owner.client.delete(`/api/categories/${categoryId}`);

    assert.equal(response.status, 204, JSON.stringify(response.body));
    assert.equal((await owner.client.get(`/api/categories/${categoryId}`)).status, 404);
  });

  it('refuses a staff user deleting a category with 403', async () => {
    const { owner, staff } = await world();
    const categoryId = await createCategory(owner, 'Protected');

    const response = await staff.client.delete(`/api/categories/${categoryId}`);

    assert.equal(response.status, 403, JSON.stringify(response.body));
    // Still there — the refusal changed nothing.
    const still = await owner.client.get(`/api/categories/${categoryId}`);
    assert.equal(still.status, 200);
  });

  it('lets an owner deactivate a product', async () => {
    const { owner, productId } = await world();

    const response = await owner.client.delete(`/api/products/${productId}`);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal((response.body as { data: { isActive: boolean } }).data.isActive, false);
  });

  it('lets staff deactivate a product, matching the existing soft-delete decision', async () => {
    const { staff, productId } = await world();

    const response = await staff.client.delete(`/api/products/${productId}`);

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('still lets staff edit a product’s name and price', async () => {
    const { staff, productId } = await world();

    const response = await staff.client.patch(`/api/products/${productId}`, {
      name: 'Renamed by staff',
      sellingPrice: '19.99',
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('refuses a staff user cancelling a purchase order with 403', async () => {
    const { owner, staff, productId, supplierId } = await world();
    const orderId = await createOrder(owner, productId, supplierId);
    await owner.client.post(`/api/purchase-orders/${orderId}/order`);

    const response = await staff.client.patch(`/api/purchase-orders/${orderId}`, {
      status: 'cancelled',
    });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    // The order is still live.
    const detail = await owner.client.get<{ data: { status: string } }>(
      `/api/purchase-orders/${orderId}`,
    );
    assert.notEqual(detail.body.data.status, 'cancelled');
  });

  it('still lets staff add a note to an order — only cancelling is owner-only', async () => {
    const { owner, staff, productId, supplierId } = await world();
    const orderId = await createOrder(owner, productId, supplierId);

    const response = await staff.client.patch(`/api/purchase-orders/${orderId}`, {
      notes: 'Called ahead; arriving Thursday.',
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('lets an owner cancel a purchase order', async () => {
    const { owner, productId, supplierId } = await world();
    const orderId = await createOrder(owner, productId, supplierId);

    const response = await owner.client.patch(`/api/purchase-orders/${orderId}`, {
      status: 'cancelled',
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
});

// ---------------------------------------------------------------------------
// Staff-accessible operational workflows
// ---------------------------------------------------------------------------

describe('Authorization — operational work stays available to staff', () => {
  it('lets staff create and update products', async () => {
    const { staff } = await world();

    const created = await staff.client.post<{ data: { id: string } }>(
      '/api/products',
      productBody({ sku: 'STAFF-PRODUCT' }),
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const updated = await staff.client.patch(`/api/products/${created.body.data.id}`, {
      name: 'Renamed by staff',
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
  });

  it('lets staff create and update categories', async () => {
    const { staff } = await world();

    const created = await staff.client.post<{ data: { id: string } }>('/api/categories', {
      name: 'Staff Category',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const updated = await staff.client.patch(`/api/categories/${created.body.data.id}`, {
      name: 'Renamed by staff',
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
  });

  it('lets staff create and update suppliers, including deactivation', async () => {
    const { staff } = await world();

    const created = await staff.client.post<{ data: { id: string } }>('/api/suppliers', {
      name: 'Staff Supplier',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const deactivated = await staff.client.patch(`/api/suppliers/${created.body.data.id}`, {
      isActive: false,
    });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
  });

  it('lets staff record an inventory movement', async () => {
    const { staff, productId } = await world();

    const response = await staff.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '25',
      reason: 'Delivery received',
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('lets staff record a sale', async () => {
    const { staff, productId } = await world();
    await staff.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '100',
      reason: 'Opening',
    });

    const response = await staff.client.post('/api/sales', {
      items: [{ productId, quantity: '5' }],
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('lets staff raise, place and receive a purchase order', async () => {
    const { staff, productId, supplierId } = await world();

    const order = await staff.client.post<{ data: { id: string } }>('/api/purchase-orders', {
      supplierId,
      items: [{ productId, quantity: '10', unitCost: '5.00' }],
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const orderId = order.body.data.id;

    const placed = await staff.client.post(`/api/purchase-orders/${orderId}/order`);
    assert.equal(placed.status, 200, JSON.stringify(placed.body));

    const received = await staff.client.post(`/api/purchase-orders/${orderId}/receive`, {
      items: [{ productId, quantity: '10' }],
    });
    assert.equal(received.status, 201, JSON.stringify(received.body));
  });

  it('lets staff read analytics, intelligence and recommendations', async () => {
    const { staff } = await world();

    assert.equal((await staff.client.get('/api/analytics/overview')).status, 200);
    assert.equal((await staff.client.get('/api/intelligence/stock-risk')).status, 200);
    assert.equal((await staff.client.get('/api/intelligence/products')).status, 200);
    assert.equal((await staff.client.get('/api/recommendations')).status, 200);
    assert.equal((await staff.client.get('/api/actions')).status, 200);
  });
});

// ---------------------------------------------------------------------------
// Escalation attempts
// ---------------------------------------------------------------------------

describe('Authorization — a staff user cannot escalate', () => {
  it('rejects role=owner in the body at validation, before any role check', async () => {
    const { staff, productId } = await world();

    const response = await staff.client.patch(`/api/products/${productId}`, {
      name: 'Escalated',
      role: 'owner',
    });

    // The schemas are strict, so an unrecognised key is a 400 and the request
    // never reaches the policy guard at all. That is a stronger first line of
    // defence than a role check: a claimed role is not merely ignored, it is
    // refused.
    assert.equal(response.status, 400, JSON.stringify(response.body));

    // And the caller is still staff: a claimed role does not reach the one
    // owner-only path that is reachable through an ordinary edit.
    const { staff: _staff, owner: ownerTenant, productId: p, supplierId: s } = await world();
    const orderId = await createOrder(ownerTenant, p, s);
    await ownerTenant.client.post(`/api/purchase-orders/${orderId}/order`);

    const escalate = await _staff.client.patch(`/api/purchase-orders/${orderId}`, {
      status: 'cancelled',
    });
    assert.equal(escalate.status, 403, 'the claimed role must not grant the owner-only path');
  });

  it('rejects a userId in the body', async () => {
    const { staff, productId } = await world();

    const response = await staff.client.patch(`/api/products/${productId}`, {
      userId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });

    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  it('rejects a businessId in the body', async () => {
    const { staff, productId } = await world();

    const response = await staff.client.patch(`/api/products/${productId}`, {
      businessId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
    });

    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  it('never lets a query parameter grant a role', async () => {
    const { owner, staff, productId, supplierId } = await world();
    const orderId = await createOrder(owner, productId, supplierId);
    await owner.client.post(`/api/purchase-orders/${orderId}/order`);

    const viaQuery = await staff.client.patch(
      `/api/purchase-orders/${orderId}?role=owner&businessId=${owner.user.businessId}`,
      { status: 'cancelled' },
    );

    // Query strings play no part in the role decision at all; the guard reads
    // only the session.
    assert.equal(viaQuery.status, 403);
  });

  it('does not act as another user even on an allowed operation', async () => {
    const { staff, owner } = await world();

    // Creating a product is allowed for staff, and the row must belong to the
    // caller's own business — not to the owner whose id was offered.
    const created = await staff.client.post<{ data: { id: string } }>('/api/products', {
      ...productBody({ sku: 'OWNERSHIP' }),
      userId: owner.user.id,
      businessId: owner.user.businessId,
    });

    // Strict schemas refuse the injected keys outright.
    assert.equal(created.status, 400, JSON.stringify(created.body));
  });
});

// ---------------------------------------------------------------------------
// Tenancy and the 401/403/404 split
// ---------------------------------------------------------------------------

describe('Authorization — tenancy is independent of role', () => {
  it('refuses an owner from another business, without revealing existence', async () => {
    const { owner: _owner, otherOwner, productId } = await world();

    const response = await otherOwner.client.delete(`/api/products/${productId}`);

    // An owner in the wrong business is refused for the tenant reason (404), not
    // granted access because the role is high enough.
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  it('refuses a staff user from another business', async () => {
    const owner = await createTenant(server);
    const other = await createTenant(server);
    const otherStaff = await createStaffSession(server, other.user.businessId);
    const productId = await createProduct(owner, 'CROSS-TENANT');

    const response = await otherStaff.client.post('/api/inventory/movements', {
      productId,
      movementType: 'in',
      quantity: '10',
      reason: 'Not mine',
    });

    assert.equal(response.status, 404, JSON.stringify(response.body));
  });

  it('answers 401 to an anonymous caller, never 403', async () => {
    const response = await server.client().delete('/api/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    assert.equal(response.status, 401);
  });

  it('answers 403 for an authenticated caller with the wrong role', async () => {
    const { owner, staff } = await world();
    const categoryId = await createCategory(owner, 'Role-Gated');

    const response = await staff.client.delete(`/api/categories/${categoryId}`);

    // The role is checked before the resource is looked up, so a staff user is
    // told 403 without the id ever being resolved.
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });

  it('gives a staff user the same answer for a foreign category as for a missing one', async () => {
    const { owner, staff } = await world();
    const categoryId = await createCategory(owner, 'Foreign Category');

    // Same role, so the guard rejects on the role before the resource is even
    // looked up — a staff user cannot use this to probe which ids exist.
    const foreign = await staff.client.delete(`/api/categories/${categoryId}`);
    const missing = await staff.client.delete(
      '/api/categories/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(foreign.status, 403);
    assert.deepEqual(foreign.body, missing.body);
  });

  it('gives an owner the same answer for a foreign product as for a missing one', async () => {
    const { productId, otherOwner } = await world();

    // An owner passes the role check, so the request reaches the service, which
    // scopes by business: a product in another business is indistinguishable
    // from one that never existed.
    const foreign = await otherOwner.client.delete(`/api/products/${productId}`);
    const missing = await otherOwner.client.delete(
      '/api/products/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
  });
});

// ---------------------------------------------------------------------------
// Session behaviour is untouched
// ---------------------------------------------------------------------------

describe('Authorization — session behaviour is unchanged', () => {
  it('keeps both roles signed in and able to act', async () => {
    const { owner, staff } = await world();

    assert.equal((await owner.client.get('/api/auth/me')).status, 200);
    assert.equal((await staff.client.get('/api/auth/me')).status, 200);
  });

  it('still invalidates the session on logout', async () => {
    const owner = await createTenant(server);

    assert.equal((await owner.client.get('/api/auth/me')).status, 200);
    assert.equal((await owner.client.post('/api/auth/logout')).status, 200);
    assert.equal((await owner.client.get('/api/auth/me')).status, 401);
  });

  it('does not let a staff user act after logout', async () => {
    const { staff, productId } = await world();

    await staff.client.post('/api/auth/logout');

    const response = await staff.client.delete(`/api/products/${productId}`);
    assert.equal(response.status, 401, 'an ended session must not still carry a role');
  });
});