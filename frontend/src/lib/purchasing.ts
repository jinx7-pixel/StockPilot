/**
 * Purchasing API client — suppliers and purchase orders.
 *
 * Two server-owned values are absent from every payload and cannot be set by the
 * client: `businessId` / `createdBy` (derived from the session) and
 * `totalAmount` / `lineTotal` / `receivedQuantity` (computed by PostgreSQL).
 *
 * Money and quantity values come back as **strings**, because the server
 * computed them in `numeric` and they must not round-trip through a JavaScript
 * float. Use `formatAmount` / `formatQuantity` to display them.
 */

import { request } from './request';

export type PurchaseOrderStatus =
  | 'draft'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
];

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: string;
  receivedQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  totalAmount: string;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdBy: { id: string; name: string };
  itemCount: number;
  createdAt: string;
  items?: PurchaseOrderItem[];
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SupplierInput {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface PurchaseOrderItemInput {
  productId: string;
  quantity: string;
  /** What the business will pay. Not the product's selling price. */
  unitCost: string;
}

export interface PurchaseOrderInput {
  supplierId: string;
  expectedAt?: string;
  notes?: string;
  items: PurchaseOrderItemInput[];
}

export interface SuppliersQuery {
  search?: string;
  isActive?: 'all' | 'true' | 'false';
  page?: number;
  limit?: number;
}

export interface PurchaseOrdersQuery {
  search?: string;
  supplierId?: string;
  status?: 'all' | PurchaseOrderStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
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

/**
 * Format an exact decimal string for display.
 *
 * The input is a plain decimal such as `"1234.50"`, so this is formatting, not
 * arithmetic — no rounding decisions are made here.
 */
export function formatAmount(value: string, fractionDigits = 2): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;

  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a quantity, trimming a meaningless `.00`. */
export function formatQuantity(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;

  return Number.isInteger(parsed) ? String(parsed) : formatAmount(value);
}

export const supplierApi = {
  list: (query: SuppliersQuery) =>
    request<{ data: Supplier[]; meta: ListMeta }>(
      `/api/suppliers${buildQueryString({
        search: query.search,
        isActive: query.isActive && query.isActive !== 'all' ? query.isActive : undefined,
        page: query.page,
        limit: query.limit,
      })}`,
    ),

  create: (input: SupplierInput) =>
    request<{ data: Supplier }>('/api/suppliers', { method: 'POST', body: input }),

  update: (id: string, input: Partial<SupplierInput> & { isActive?: boolean }) =>
    request<{ data: Supplier }>(`/api/suppliers/${id}`, { method: 'PATCH', body: input }),

  // There is deliberately no delete: purchase orders reference suppliers, so a
  // supplier with history can never be removed. Deactivate instead.
};

export const purchaseOrderApi = {
  list: (query: PurchaseOrdersQuery) =>
    request<{ data: PurchaseOrder[]; meta: ListMeta }>(
      `/api/purchase-orders${buildQueryString({
        search: query.search,
        supplierId: query.supplierId,
        status: query.status && query.status !== 'all' ? query.status : undefined,
        from: query.from,
        to: query.to,
        page: query.page,
        limit: query.limit,
      })}`,
    ),

  detail: (id: string) => request<{ data: PurchaseOrder }>(`/api/purchase-orders/${id}`),

  /** Raises a draft. Does not move stock. */
  create: (input: PurchaseOrderInput) =>
    request<{ data: PurchaseOrder }>('/api/purchase-orders', { method: 'POST', body: input }),

  /** `draft -> ordered`. Touches no inventory. */
  place: (id: string) =>
    request<{ data: PurchaseOrder }>(`/api/purchase-orders/${id}/order`, { method: 'POST' }),

  /**
   * Record an arrival. Each quantity is a **newly received increment**, not a new
   * total. The server appends immutable `in` movements and recomputes the status,
   * all in one transaction.
   */
  receive: (id: string, items: { productId: string; quantity: string }[]) =>
    request<{ data: PurchaseOrder }>(`/api/purchase-orders/${id}/receive`, {
      method: 'POST',
      body: { items },
    }),

  /** Only `expectedAt`, `notes` and `status: 'cancelled'` are accepted. */
  update: (id: string, input: { expectedAt?: string | null; notes?: string | null; status?: 'cancelled' }) =>
    request<{ data: PurchaseOrder }>(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      body: input,
    }),
};
