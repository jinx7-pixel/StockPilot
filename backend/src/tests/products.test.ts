/**
 * Products API tests.
 *
 * Covers CRUD, SKU normalisation and uniqueness, money validation, listing
 * (search / filter / pagination), role restrictions, and the isolation
 * guarantees that keep one business out of another's catalog.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import {
  createCategoryFor,
  createStaffSession,
  createTenant,
  productBody,
} from './helpers/tenancy.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;

interface Product {
  id: string;
  businessId: string;
  categoryId: string | null;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  isActive: boolean;
  categoryName: string | null;
}

interface ListMeta {
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

describe('GET /api/products', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await server.client().get('/api/products');

    assert.equal(response.status, 401);
  });

  it('lists only the caller business products', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    await tenantA.client.post('/api/products', productBody({ name: 'A product' }));
    await tenantB.client.post('/api/products', productBody({ name: 'B product' }));

    const response = await tenantA.client.get<{ data: Product[] }>('/api/products');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0]?.name, 'A product');
  });

  it('searches by name', async () => {
    const tenant = await createTenant(server);
    await tenant.client.post('/api/products', productBody({ name: 'Blue widget' }));
    await tenant.client.post('/api/products', productBody({ name: 'Red widget' }));

    const response = await tenant.client.get<{ data: Product[] }>('/api/products?search=blue');

    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0]?.name, 'Blue widget');
  });

  it('searches by SKU', async () => {
    const tenant = await createTenant(server);
    await tenant.client.post('/api/products', productBody({ sku: 'FIND-ME-1' }));
    await tenant.client.post('/api/products', productBody({ sku: 'OTHER-1' }));

    const response = await tenant.client.get<{ data: Product[] }>('/api/products?search=find-me');

    assert.equal(response.body.data.length, 1, 'SKU search is case-insensitive');
    assert.equal(response.body.data[0]?.sku, 'FIND-ME-1');
  });

  it('treats LIKE wildcards in the search term as literals', async () => {
    const tenant = await createTenant(server);
    await tenant.client.post('/api/products', productBody({ name: 'Widget' }));
    await tenant.client.post('/api/products', productBody({ name: 'Gadget' }));

    const response = await tenant.client.get<{ data: Product[] }>('/api/products?search=%25');

    assert.equal(response.body.data.length, 0, 'a bare % must not match everything');
  });

  it('filters by category', async () => {
    const tenant = await createTenant(server);
    const categoryId = await createCategoryFor(tenant.client, { name: 'Tools' });
    const otherCategoryId = await createCategoryFor(tenant.client, { name: 'Paint' });

    await tenant.client.post('/api/products', productBody({ name: 'Hammer', categoryId }));
    await tenant.client.post('/api/products', productBody({ name: 'Emulsion', categoryId: otherCategoryId }));

    const response = await tenant.client.get<{ data: Product[] }>(
      `/api/products?categoryId=${categoryId}`,
    );

    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0]?.name, 'Hammer');
  });

  it('filters by active and inactive', async () => {
    const tenant = await createTenant(server);
    await tenant.client.post('/api/products', productBody({ name: 'Active one' }));
    await tenant.client.post('/api/products', productBody({ name: 'Retired one', isActive: false }));

    const active = await tenant.client.get<{ data: Product[] }>('/api/products?isActive=true');
    assert.equal(active.body.data.length, 1);
    assert.equal(active.body.data[0]?.name, 'Active one');

    const inactive = await tenant.client.get<{ data: Product[] }>('/api/products?isActive=false');
    assert.equal(inactive.body.data.length, 1);
    assert.equal(inactive.body.data[0]?.name, 'Retired one');
  });

  it('paginates and reports metadata', async () => {
    const tenant = await createTenant(server);
    for (let i = 0; i < 7; i += 1) {
      await tenant.client.post('/api/products', productBody({ name: `Paged ${i}` }));
    }

    const first = await tenant.client.get<{ data: Product[]; meta: ListMeta }>(
      '/api/products?page=1&limit=3',
    );

    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 3);
    assert.equal(first.body.meta.total, 7);
    assert.equal(first.body.meta.page, 1);
    assert.equal(first.body.meta.totalPages, 3);

    const last = await tenant.client.get<{ data: Product[]; meta: ListMeta }>(
      '/api/products?page=3&limit=3',
    );
    assert.equal(last.body.data.length, 1, 'the final page holds the remainder');

    const beyond = await tenant.client.get<{ data: Product[]; meta: ListMeta }>(
      '/api/products?page=9&limit=3',
    );
    assert.equal(beyond.body.data.length, 0);
    assert.equal(beyond.body.meta.total, 7, 'the total is still correct on an empty page');
  });

  it('rejects a page size above the maximum with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.get('/api/products?limit=5000');

    assert.equal(response.status, 400);
  });

  it('ignores an attempt to control ordering', async () => {
    const tenant = await createTenant(server);
    await tenant.client.post('/api/products', productBody({ name: 'Alpha' }));
    await tenant.client.post('/api/products', productBody({ name: 'Bravo' }));

    const response = await tenant.client.get<{ data: Product[] }>(
      '/api/products?orderBy=cost_price%3B+DROP+TABLE+products--',
    );

    assert.equal(response.status, 200, 'unknown query keys are ignored, not interpolated');
    assert.equal(response.body.data.length, 2);
  });
});

describe('POST /api/products', () => {
  it('creates a product with normalised SKU and money', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post<{ data: Product }>(
      '/api/products',
      productBody({
        sku: '  abc-123  ',
        name: 'Widget',
        costPrice: '12.5',
        sellingPrice: 30,
      }),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.sku, 'ABC-123', 'SKU is trimmed and upper-cased');
    assert.equal(response.body.data.costPrice, 12.5);
    assert.equal(response.body.data.sellingPrice, 30);
    assert.equal(response.body.data.isActive, true, 'active by default');
    assert.equal(response.body.data.categoryId, null, 'a product may have no category');
  });

  it('allows a product without a category', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post<{ data: Product }>('/api/products', productBody());

    assert.equal(response.status, 201);
    assert.equal(response.body.data.categoryId, null);
  });

  it('accepts a category belonging to the same business', async () => {
    const tenant = await createTenant(server);
    const categoryId = await createCategoryFor(tenant.client, { name: 'Tools' });

    const response = await tenant.client.post<{ data: Product }>(
      '/api/products',
      productBody({ categoryId }),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.categoryId, categoryId);
    assert.equal(response.body.data.categoryName, 'Tools');
  });

  it('rejects a category belonging to another business with 400', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const categoryId = await createCategoryFor(tenantA.client, { name: 'Private' });

    const response = await tenantB.client.post('/api/products', productBody({ categoryId }));

    assert.equal(response.status, 400, "another tenant's category is not assignable");
    assert.match(JSON.stringify(response.body), /categoryId/i);
  });

  it('rejects a duplicate SKU within the same business with 409', async () => {
    const tenant = await createTenant(server);
    await tenant.client.post('/api/products', productBody({ sku: 'DUP-1' }));

    const response = await tenant.client.post('/api/products', productBody({ sku: 'dup-1' }));

    assert.equal(response.status, 409, 'uniqueness is case-insensitive');
  });

  it('allows the same SKU in two different businesses', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);

    await tenantA.client.post('/api/products', productBody({ sku: 'SHARED-SKU' }));
    const response = await tenantB.client.post('/api/products', productBody({ sku: 'SHARED-SKU' }));

    assert.equal(response.status, 201, 'SKU uniqueness is per business');
  });

  it('rejects a negative price with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post(
      '/api/products',
      productBody({ costPrice: '-1.00' }),
    );

    assert.equal(response.status, 400);
  });

  it('rejects more than two decimal places with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post(
      '/api/products',
      productBody({ sellingPrice: '10.999' }),
    );

    assert.equal(response.status, 400);
  });

  it('accepts a zero price', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post<{ data: Product }>(
      '/api/products',
      productBody({ costPrice: '0', sellingPrice: '0' }),
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.costPrice, 0);
  });

  it('rejects a missing SKU with 400', async () => {
    const tenant = await createTenant(server);
    const body = productBody();
    delete (body as Record<string, unknown>).sku;

    const response = await tenant.client.post('/api/products', body);

    assert.equal(response.status, 400);
  });

  it('rejects unknown fields with 400', async () => {
    const tenant = await createTenant(server);

    const response = await tenant.client.post(
      '/api/products',
      productBody({ businessId: 'other', stockQuantity: 500 }),
    );

    assert.equal(response.status, 400, 'stock does not belong on a product');
  });
});

describe('GET /api/products/:id', () => {
  it('returns the product for the owning business', async () => {
    const tenant = await createTenant(server);
    const created = await tenant.client.post<{ data: Product }>('/api/products', productBody());
    const id = created.body.data.id;

    const response = await tenant.client.get<{ data: Product }>(`/api/products/${id}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, id);
  });

  it('returns 404 for a product in another business', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const created = await tenantA.client.post<{ data: Product }>('/api/products', productBody());

    const response = await tenantB.client.get(`/api/products/${created.body.data.id}`);

    assert.equal(response.status, 404);
  });
});

describe('PATCH /api/products/:id', () => {
  it('updates the product', async () => {
    const tenant = await createTenant(server);
    const created = await tenant.client.post<{ data: Product }>('/api/products', productBody());
    const id = created.body.data.id;

    const response = await tenant.client.patch<{ data: Product }>(`/api/products/${id}`, {
      name: 'Renamed',
      sellingPrice: '99.00',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, 'Renamed');
    assert.equal(response.body.data.sellingPrice, 99);
  });

  it('clears the category when categoryId is null', async () => {
    const tenant = await createTenant(server);
    const categoryId = await createCategoryFor(tenant.client, { name: 'Tools' });
    const created = await tenant.client.post<{ data: Product }>(
      '/api/products',
      productBody({ categoryId }),
    );

    const response = await tenant.client.patch<{ data: Product }>(
      `/api/products/${created.body.data.id}`,
      { categoryId: null },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.data.categoryId, null);
  });

  it('rejects reassigning to another business category with 400', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const foreignCategory = await createCategoryFor(tenantA.client, { name: 'Private' });
    const created = await tenantB.client.post<{ data: Product }>('/api/products', productBody());

    const response = await tenantB.client.patch(`/api/products/${created.body.data.id}`, {
      categoryId: foreignCategory,
    });

    assert.equal(response.status, 400);
  });

  it('returns 404 when updating another business product', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const created = await tenantA.client.post<{ data: Product }>(
      '/api/products',
      productBody({ name: 'Untouched' }),
    );

    const response = await tenantB.client.patch(`/api/products/${created.body.data.id}`, {
      name: 'Hijacked',
    });

    assert.equal(response.status, 404);

    const original = await tenantA.client.get<{ data: Product }>(
      `/api/products/${created.body.data.id}`,
    );
    assert.equal(original.body.data.name, 'Untouched', 'the original is unchanged');
  });

  it('is allowed for a staff user', async () => {
    const tenant = await createTenant(server);
    const created = await tenant.client.post<{ data: Product }>('/api/products', productBody());
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.patch<{ data: Product }>(`/api/products/${created.body.data.id}`, {
      name: 'Edited by staff',
    });

    assert.equal(response.status, 200, 'staff manage the catalog day to day');
    assert.equal(response.body.data.name, 'Edited by staff');
  });
});

describe('DELETE /api/products/:id', () => {
  it('deactivates rather than removing, and can be reversed', async () => {
    const tenant = await createTenant(server);
    const created = await tenant.client.post<{ data: Product }>('/api/products', productBody());
    const id = created.body.data.id;

    const deleted = await tenant.client.delete<{ data: Product }>(`/api/products/${id}`);

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.isActive, false, 'a soft delete returns the new state');

    // The row still exists, which is what protects future movement history.
    const stillThere = await tenant.client.get<{ data: Product }>(`/api/products/${id}`);
    assert.equal(stillThere.status, 200);

    const restored = await tenant.client.patch<{ data: Product }>(`/api/products/${id}`, {
      isActive: true,
    });
    assert.equal(restored.body.data.isActive, true, 'deactivation is reversible');
  });

  it('is idempotent', async () => {
    const tenant = await createTenant(server);
    const created = await tenant.client.post<{ data: Product }>('/api/products', productBody());
    const id = created.body.data.id;

    assert.equal((await tenant.client.delete(`/api/products/${id}`)).status, 200);
    assert.equal((await tenant.client.delete(`/api/products/${id}`)).status, 200);
  });

  it('is allowed for a staff user', async () => {
    const tenant = await createTenant(server);
    const created = await tenant.client.post<{ data: Product }>('/api/products', productBody());
    const { client: staff } = await createStaffSession(server, tenant.user.businessId);

    const response = await staff.delete(`/api/products/${created.body.data.id}`);

    assert.equal(response.status, 200, 'deactivating is not destructive, so staff may do it');
  });

  it('returns 404 for another business product and leaves it active', async () => {
    const tenantA = await createTenant(server);
    const tenantB = await createTenant(server);
    const created = await tenantA.client.post<{ data: Product }>('/api/products', productBody());

    const response = await tenantB.client.delete(`/api/products/${created.body.data.id}`);
    assert.equal(response.status, 404);

    const original = await tenantA.client.get<{ data: Product }>(
      `/api/products/${created.body.data.id}`,
    );
    assert.equal(original.body.data.isActive, true);
  });
});

describe('catalog integrity', () => {
  it('keeps products when their category is deleted by cascade-to-null semantics', async () => {
    const tenant = await createTenant(server);
    const categoryId = await createCategoryFor(tenant.client, { name: 'Doomed' });
    const created = await tenant.client.post<{ data: Product }>(
      '/api/products',
      productBody({ categoryId }),
    );

    // A category with products cannot be deleted through the API, so the
    // ON DELETE SET NULL behaviour is exercised at the database level here.
    const { getPool } = await import('../db/pool.js');
    await getPool().query('DELETE FROM categories WHERE id = $1', [categoryId]);

    const response = await tenant.client.get<{ data: Product }>(
      `/api/products/${created.body.data.id}`,
    );

    assert.equal(response.status, 200, 'the product survives its category');
    assert.equal(response.body.data.categoryId, null);
  });
});
