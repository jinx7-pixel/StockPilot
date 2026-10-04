/**
 * Tenancy fixtures for the catalog tests.
 *
 * The central property under test is that one business can never see or change
 * another business's data, so these helpers make it cheap to stand up two
 * independent tenants with different roles.
 */

import type { TestClient, TestServer } from './testServer.js';
import { PASSWORD, createStaffUser, registerOwner } from './fixtures.js';

export interface Tenant {
  /** Client already holding this tenant's owner session cookie. */
  client: TestClient;
  user: { id: string; businessId: string; email: string };
}

/** Register a business and return a signed-in client for it. */
export async function createTenant(server: TestServer): Promise<Tenant> {
  const { client, user } = await registerOwner(server);
  return { client, user };
}

/**
 * Add a staff user to a tenant and return a client signed in as that user.
 *
 * Staff rows are inserted directly: the product has no invitation flow yet.
 */
export async function createStaffSession(
  server: TestServer,
  businessId: string,
): Promise<{ client: TestClient; user: { id: string; businessId: string; email: string } }> {
  const email = `staff+${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
  await createStaffUser({ id: businessId }, email);

  const client = server.client();
  const login = await client.post<{ data: { user: { id: string; businessId: string; email: string } } }>(
    '/api/auth/login',
    { email, password: PASSWORD },
  );

  if (login.status !== 200) {
    throw new Error(`Staff login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }

  return { client, user: login.body.data.user };
}

/** A minimal valid product body, with unique-enough values per call. */
let productSequence = 0;

export function productBody(overrides: Record<string, unknown> = {}) {
  productSequence += 1;
  const unique = `${Date.now().toString(36)}${productSequence}`;

  return {
    sku: `SKU-${unique}`.toUpperCase(),
    name: `Product ${unique}`,
    description: 'A test product',
    unit: 'piece',
    costPrice: '10.00',
    sellingPrice: '25.00',
    ...overrides,
  };
}

/** A minimal valid category body, with unique-enough values per call. */
let categorySequence = 0;

export function categoryBody(overrides: Record<string, unknown> = {}) {
  categorySequence += 1;
  const unique = `${Date.now().toString(36)}${categorySequence}`;

  return {
    name: `Category ${unique}`,
    description: 'A test category',
    ...overrides,
  };
}

/** Create a category and return its id. Fails the test if creation did not succeed. */
export async function createCategoryFor(
  client: TestClient,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await client.post<{ data: { id: string } }>(
    '/api/categories',
    categoryBody(overrides),
  );

  if (response.status !== 201) {
    throw new Error(`Category creation failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body.data.id;
}
