/**
 * Categories API tests.
 *
 * The isolation tests matter most: each asserts that tenant B's request against
 * tenant A's category id produces 404 rather than 403, so the API never
 * confirms that another business's data exists.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { categoryBody, createCategoryFor, createStaffSession, createTenant } from './helpers/tenancy.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;

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

describe('GET /api/categories', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await server.client().get('/api/categories');

    assert.equal(response.status, 401);
  });

  it('returns only the caller business categories', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    await createCategoryFor(tenantA.client, { name: 'Alpha tools' });
    await createCategoryFor(tenantB.client, { name: 'Beta tools' });

    const response = await tenantA.client.get<{ data: { name: string }[] }>('/api/categories');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0]?.name, 'Alpha tools', "no other tenant's category leaks");
  });
});

describe('POST /api/categories', () => {
  it('creates a category for the caller business', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post<{ data: { id: string; name: string; description: string | null } }>(
      '/api/categories',
      categoryBody({ name: 'Fasteners', description: 'Nuts and bolts' }),
    );

    assert.equal(response.status, 201);
    assert.ok(response.body.data.id);
    assert.equal(response.body.data.name, 'Fasteners');
    assert.equal(response.body.data.description, 'Nuts and bolts');
  });

  it('rejects a duplicate name within the same business with 409', async () => {
    const tenant = await createTenant(server);
    await createCategoryFor(tenant.client, { name: 'Fasteners' });

    const response = await tenant.client.post('/api/categories', categoryBody({ name: 'Fasteners' }));

    assert.equal(response.status, 409);
  });

  it('treats a differently-cased duplicate name as a conflict', async () => {
    const tenant = await createTenant(server);
    await createCategoryFor(tenant.client, { name: 'Fasteners' });

    const response = await tenant.client.post('/api/categories', categoryBody({ name: 'fasteners' }));

    assert.equal(response.status, 409, 'uniqueness is case-insensitive, like the index');
  });

  it('allows the same category name in two different businesses', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    await createCategoryFor(tenantA.client, { name: 'Shared name' });

    const response = await tenantB.client.post('/api/categories', categoryBody({ name: 'Shared name' }));

    assert.equal(response.status, 201, 'uniqueness is per business');
  });

  it('rejects a missing name with 400', async () => {
    const tenant = await createTenant(server);
    const body = categoryBody();
    delete (body as Record<string, unknown>).name;

    const response = await tenant.client.post('/api/categories', body);

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(response.body), /name/i);
  });

  it('rejects an unknown field with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post(
      '/api/categories',
      categoryBody({ businessId: 'some-other-tenant' }),
    );

    assert.equal(response.status, 400, 'a client cannot smuggle in businessId');
  });
});

describe('GET /api/categories/:id', () => {
  it('returns the category for the owning business', async () => {
    const tenant = await createTenant(server);
    const id = await createCategoryFor(tenant.client, { name: 'Fasteners' });

    const response = await tenant.client.get<{ data: { id: string; name: string } }>(
      `/api/categories/${id}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'Fasteners');
  });

  it('returns 404 for a category in another business', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const id = await createCategoryFor(tenantA.client, { name: 'Private' });

    const response = await tenantB.client.get(`/api/categories/${id}`);

    assert.equal(response.status, 404, 'another tenant category is simply not found');
  });

  it('returns 400 for a malformed id', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get('/api/categories/not-a-uuid');

    assert.equal(response.status, 400);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('updates the category', async () => {
    const tenant = await createTenant(server);
    const id = await createCategoryFor(tenant.client, { name: 'Old name' });

    const response = await tenant.client.patch<{ data: { name: string; description: string | null } }>(
      `/api/categories/${id}`,
      { name: 'New name', description: 'Updated' },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'New name');
    assert.equal(response.body.data.description, 'Updated');
  });

  it('clears the description when null is sent explicitly', async () => {
    const tenant = await createTenant(server);
    const id = await createCategoryFor(tenant.client, { description: 'Something' });

    const response = await tenant.client.patch<{ data: { description: string | null } }>(
      `/api/categories/${id}`,
      { description: null },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.description, null, 'null clears, absent leaves alone');
  });

  it('rejects an empty patch with 400', async () => {
    const tenant = await createTenant(server);
    const id = await createCategoryFor(tenant.client);

    const response = await tenant.client.patch(`/api/categories/${id}`, {});

    assert.equal(response.status, 400);
  });

  it('rejects renaming to an existing category with 409', async () => {
    const tenant = await createTenant(server);
    await createCategoryFor(tenant.client, { name: 'Taken' });
    const id = await createCategoryFor(tenant.client, { name: 'Free' });

    const response = await tenant.client.patch(`/api/categories/${id}`, { name: 'Taken' });

    assert.equal(response.status, 409);
  });

  it('returns 404 when renaming another business category', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const id = await createCategoryFor(tenantA.client, { name: 'Private' });

    const response = await tenantB.client.patch(`/api/categories/${id}`, { name: 'Hijacked' });

    assert.equal(response.status, 404);

    // And the original is untouched.
    const original = await tenantA.client.get<{ data: { name: string } }>(`/api/categories/${id}`);
    assert.equal(original.body.data.name, 'Private');
  });
});

describe('DELETE /api/categories/:id', () => {
  it('deletes an empty category with 204', async () => {
    const tenant = await createTenant(server);
    const id = await createCategoryFor(tenant.client);

    const response = await tenant.client.delete(`/api/categories/${id}`);

    assert.equal(response.status, 204);
    assert.equal((await tenant.client.get(`/api/categories/${id}`)).status, 404);
  });

  it('refuses with 409 while products still reference it', async () => {
    const tenant = await createTenant(server);
    const categoryId = await createCategoryFor(tenant.client, { name: 'In use' });

    const product = await tenant.client.post('/api/products', {
      sku: `SKU-${Date.now().toString(36)}`.toUpperCase(),
      name: 'In-use product',
      unit: 'piece',
      costPrice: '1.00',
      sellingPrice: '2.00',
      categoryId,
    });
    assert.equal(product.status, 201);

    const response = await tenant.client.delete(`/api/categories/${categoryId}`);

    assert.equal(response.status, 409, 'products must not be orphaned');
  });

  it('is forbidden for a staff user with 403', async () => {
    const tenant = await createTenant(server);
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);
    const id = await createCategoryFor(tenant.client);

    const response = await staff.delete(`/api/categories/${id}`);

    assert.equal(response.status, 403, 'staff may read and edit, but not delete');
  });

  it('returns 404 for another business category', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const id = await createCategoryFor(tenantA.client);

    const response = await tenantB.client.delete(`/api/categories/${id}`);

    assert.equal(response.status, 404);

    // Still there for its real owner.
    assert.equal((await tenantA.client.get(`/api/categories/${id}`)).status, 200);
  });
});
