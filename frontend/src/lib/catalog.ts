/**
 * Catalog API client — categories and products.
 *
 * Uses the same `credentials: 'include'` approach as `api.ts`: the session lives
 * in an HTTP-only cookie, the browser holds no token, and the server derives
 * the tenant from the session. No request ever sends a `businessId`.
 */

import { request, requestList } from './request';

export interface Category {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
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
  createdAt: string;
  updatedAt: string;
  categoryName: string | null;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductQuery {
  search?: string;
  categoryId?: string;
  /** `'all'` omits the filter entirely, so inactive items are not hidden by default. */
  isActive?: 'all' | 'true' | 'false';
  page?: number;
  limit?: number;
}

function buildQueryString(query: ProductQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export interface CategoryInput {
  name: string;
  description?: string;
}

export interface ProductInput {
  sku: string;
  name: string;
  description?: string;
  categoryId: string | null;
  unit: string;
  costPrice: string;
  sellingPrice: string;
  isActive?: boolean;
}

/**
 * The catalog client.
 *
 * ## Why every generic here is the *unwrapped* shape
 *
 * `request<T>()` reads `{ data: T }` off the wire and returns `T`. So a client
 * declares what it wants back, never the envelope. Declaring `request<{data: X}>`
 * would be a double unwrap: the helper returns `X`, the type claims a wrapper,
 * and every `.data` in a page silently becomes `undefined`.
 */
export const catalogApi = {
  // ---- Categories ---------------------------------------------------------
  listCategories: () => request<Category[]>('/api/categories'),

  createCategory: (input: CategoryInput) =>
    request<Category>('/api/categories', { method: 'POST', body: input }),

  updateCategory: (id: string, input: Partial<CategoryInput>) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: input }),

  deleteCategory: (id: string) =>
    request<void>(`/api/categories/${id}`, { method: 'DELETE' }),

  // ---- Products -----------------------------------------------------------
  /**
   * Uses `requestList`, not `request`.
   *
   * The route answers `{ data: [...], meta: {...} }`. A plain `request` returns
   * only the array and silently drops `meta`, so a caller reading `result.items`
   * or `result.meta` would get `undefined` — the exact failure this layer exists
   * to prevent. `requestList` folds the pair back into `{ items, meta }`.
   */
  listProducts: (query: ProductQuery) =>
    requestList<Product>(
      `/api/products${buildQueryString(query)}`,
    ),

  createProduct: (input: ProductInput) =>
    request<Product>('/api/products', { method: 'POST', body: input }),

  updateProduct: (id: string, input: Partial<ProductInput>) =>
    request<Product>(`/api/products/${id}`, { method: 'PATCH', body: input }),

  /** Soft delete: deactivates the product. The row is retained. */
  deactivateProduct: (id: string) =>
    request<Product>(`/api/products/${id}`, { method: 'DELETE' }),
};
