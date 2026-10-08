/**
 * Analytics API client.
 *
 * Every figure here is derived server-side at query time. The client never
 * computes an authoritative total — it formats what the API returns and
 * nothing more. An empty dataset arrives as zeros and `null`s, never `NaN`.
 */

import { request, requestList } from './request';

export interface Overview {
  products: { totalProducts: number; activeProducts: number; inactiveProducts: number };
  inventory: {
    totalStockUnits: number;
    productsWithStock: number;
    outOfStockProducts: number;
    productsWithNoMovements: number;
  };
  sales: Record<'today' | 'last7Days' | 'last30Days', WindowSales>;
  purchasing: {
    purchaseOrdersLast30Days: number;
    purchaseValueLast30Days: string;
    unitsReceivedLast30Days: number;
  };
  generatedAt: string;
}

export interface WindowSales {
  salesCount: number;
  unitsSold: number;
  /** Exact decimal string from the server. */
  revenue: string;
}

export interface AnalysisWindow {
  from: string;
  toExclusive: string;
  days: number;
}

export type GroupBy = 'day' | 'week' | 'month';

export interface SalesSeriesPoint {
  period: string;
  salesCount: number;
  unitsSold: number;
  revenue: string;
}

export interface SalesAnalytics {
  series: SalesSeriesPoint[];
  summary: {
    salesCount: number;
    unitsSold: number;
    revenue: string;
    averageSaleValue: string;
  };
  analysisWindow: AnalysisWindow;
  groupBy: GroupBy;
}

export interface InventoryAnalytics {
  currentStock: {
    totalStockUnits: number;
    productsWithStock: number;
    outOfStockProducts: number;
    productsWithNoMovements: number;
  };
  movements: {
    inQuantity: number;
    outQuantity: number;
    adjustmentQuantity: number;
    netMovement: string;
    movementCount: number;
  };
  analysisWindow: AnalysisWindow;
}

export interface ProductAnalytics {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
  currentStock: number;
  unitsSold: number;
  salesCount: number;
  revenue: string;
  averageDailySales: number;
  lastSaleAt: string | null;
  lastMovementAt: string | null;
}

export interface ProductAnalyticsDetail {
  product: {
    productId: string;
    sku: string;
    name: string;
    description: string | null;
    category: { id: string; name: string } | null;
    isActive: boolean;
    currentStock: number;
  };
  sales: {
    unitsSold: number;
    salesCount: number;
    revenue: string;
    averageDailySales: number;
    lastSaleAt: string | null;
  };
  inventory: {
    totalIn: number;
    totalOut: number;
    totalAdjustment: number;
    lastMovementAt: string | null;
  };
  purchasing: {
    unitsPurchased: number;
    purchaseOrderCount: number;
    lastReceivedAt: string | null;
  };
  timeSeries: {
    sales: { period: string; salesCount: number; unitsSold: number; revenue: string }[];
    movements: {
      createdAt: string;
      movementType: string;
      quantity: number;
      reason: string | null;
      referenceType: string | null;
      referenceId: string | null;
      recordedBy: string;
    }[];
  };
  analysisWindow: AnalysisWindow;
}

export interface SupplierAnalytics {
  supplierId: string;
  supplierName: string;
  isActive: boolean;
  purchaseOrderCount: number;
  receivedPurchaseOrderCount: number;
  unitsOrdered: number;
  unitsReceived: number;
  purchaseValue: string;
  lastOrderAt: string | null;
  lastReceivedAt: string | null;
  /** `null` when no order has both timestamps — unavailable, not zero. */
  averageLeadTimeDays: number | null;
  productCount: number;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AnalyticsQuery {
  from?: string;
  to?: string;
  groupBy?: GroupBy;
}

/**
 * Serialise a set of optional parameters, dropping anything undefined or empty
 * so the server sees a clean query string. Values are read via `Object.entries`,
 * so a caller's typed interface can be passed straight in.
 */
function buildQueryString(values: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/** Format an exact decimal string for display. */
export function formatAmount(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Generics are the **unwrapped** payload: `request()` reads `{ data }` off the
 * wire and returns what is inside it, so declaring the envelope here would be a
 * double unwrap and every `.data` in a page would become `undefined`.
 */
export const analyticsApi = {
  overview: () => request<Overview>('/api/analytics/overview'),

  sales: (query: AnalyticsQuery = {}) =>
    request<SalesAnalytics>(`/api/analytics/sales${buildQueryString(query)}`),

  inventory: (query: AnalyticsQuery = {}) =>
    request<InventoryAnalytics>(`/api/analytics/inventory${buildQueryString(query)}`),

  products: (
    query: AnalyticsQuery & {
      search?: string;
      categoryId?: string;
      isActive?: 'all' | 'true' | 'false';
      page?: number;
      limit?: number;
    } = {},
  ) =>
    requestList<ProductAnalytics>(
      `/api/analytics/products${buildQueryString({
        search: query.search,
        categoryId: query.categoryId,
        isActive: query.isActive && query.isActive !== 'all' ? query.isActive : undefined,
        from: query.from,
        to: query.to,
        page: query.page,
        limit: query.limit,
      })}`,
    ),

  product: (productId: string, query: AnalyticsQuery = {}) =>
    request<ProductAnalyticsDetail>(
      `/api/analytics/products/${productId}${buildQueryString(query)}`,
    ),

  suppliers: () => request<SupplierAnalytics[]>('/api/analytics/suppliers'),
};
