/**
 * Inventory API client — the stock ledger.
 *
 * Read-only apart from appending movements: the ledger has no update or delete
 * route, by design. A mistake is corrected by recording another movement.
 *
 * The browser never sends `businessId`, `createdBy` or a stock figure — the
 * server derives the tenant and the actor from the session, and the balance
 * from the ledger.
 */

import { request } from './request';

export type MovementType = 'in' | 'out' | 'adjustment';

export type StockStatus = 'in_stock' | 'out_of_stock' | 'no_movements';

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  unit: string;
  isActive: boolean;
  /** Derived from the ledger. Never stored, never accepted as input. */
  currentStock: number;
}

export interface Movement {
  id: string;
  movementType: MovementType;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface ProductInventory {
  product: {
    id: string;
    sku: string;
    name: string;
    description: string | null;
    unit: string;
    costPrice: number;
    sellingPrice: number;
    isActive: boolean;
    categoryId: string | null;
    categoryName: string | null;
  };
  currentStock: number;
  movementCount: number;
  lastMovementAt: string | null;
  totals: { in: number; out: number; adjustment: number };
}

export interface InventorySummary {
  productCount: number;
  productsWithMovements: number;
  outOfStockCount: number;
  totalMovementCount: number;
  lastMovementAt: string | null;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InventoryQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  stockStatus?: 'all' | StockStatus;
  page?: number;
  limit?: number;
}

export interface MovementsQuery {
  movementType?: 'all' | MovementType;
  page?: number;
  limit?: number;
}

export interface MovementInput {
  productId: string;
  movementType: MovementType;
  quantity: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
}

function buildQueryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export const inventoryApi = {
  list: (query: InventoryQuery) =>
    request<{ data: InventoryItem[]; meta: ListMeta }>(
      `/api/inventory${buildQueryString({
        search: query.search,
        categoryId: query.categoryId,
        isActive: query.isActive && query.isActive !== 'all' ? query.isActive : undefined,
        stockStatus: query.stockStatus && query.stockStatus !== 'all' ? query.stockStatus : undefined,
        page: query.page,
        limit: query.limit,
      })}`,
    ),

  summary: () => request<{ data: InventorySummary }>('/api/inventory/summary'),

  detail: (productId: string) =>
    request<{ data: ProductInventory }>(`/api/inventory/${productId}`),

  movements: (productId: string, query: MovementsQuery) =>
    request<{ data: Movement[]; meta: ListMeta }>(
      `/api/inventory/${productId}/movements${buildQueryString({
        movementType: query.movementType && query.movementType !== 'all' ? query.movementType : undefined,
        page: query.page,
        limit: query.limit,
      })}`,
    ),

  /** Append one immutable movement. The response carries the new balance. */
  record: (input: MovementInput) =>
    request<{ data: Movement; meta: { currentStock: number } }>('/api/inventory/movements', {
      method: 'POST',
      body: input,
    }),
};
