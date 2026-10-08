/**
 * Sales API client.
 *
 * Two things are worth knowing:
 *  - The browser never sends `businessId`, `createdBy`, `totalAmount`,
 *    `unitPrice`, `lineTotal`, `stock` or `status`. The server derives all of
 *    them, and rejects them as unknown fields.
 *  - Monetary and quantity values come back as **strings**, because the server
 *    computed them in PostgreSQL `numeric` and must not round-trip them through
 *    a JavaScript float. Use `formatAmount` to display them.
 */

import { request, requestList } from './request';

export type SaleStatus = 'completed';

export interface SaleItem {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface Sale {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  totalAmount: string;
  status: SaleStatus;
  soldAt: string;
  createdBy: { id: string; name: string };
  itemCount: number;
  items?: SaleItem[];
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SalesQuery {
  search?: string;
  status?: 'all' | SaleStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface SaleItemInput {
  productId: string;
  quantity: string;
}

export interface CreateSaleInput {
  customerName?: string;
  customerPhone?: string;
  soldAt?: string;
  items: SaleItemInput[];
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

/**
 * Generics are the **unwrapped** payload: `request()` reads `{ data }` off the
 * wire and returns what is inside it, so declaring the envelope here would be a
 * double unwrap and every `.data` in a page would become `undefined`.
 */
export const salesApi = {
  list: (query: SalesQuery) =>
    requestList<Sale>(
      `/api/sales${buildQueryString({
        search: query.search,
        status: query.status && query.status !== 'all' ? query.status : undefined,
        from: query.from,
        to: query.to,
        page: query.page,
        limit: query.limit,
      })}`,
    ),

  detail: (id: string) => request<Sale>(`/api/sales/${id}`),

  /**
   * Record a sale. Stock is reduced by the server as immutable `out` movements
   * in the same transaction, so an accepted sale has already moved stock.
   */
  create: (input: CreateSaleInput) => request<Sale>('/api/sales', { method: 'POST', body: input }),
};
