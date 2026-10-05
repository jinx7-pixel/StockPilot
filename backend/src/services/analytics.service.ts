/**
 * Analytics service — the **facts** layer.
 *
 * Every metric is derived at query time from the transactional tables. Nothing
 * is stored, so analytics can never become a second source of truth, and a
 * corrected movement is reflected on the very next request.
 *
 * ## Conventions
 *
 *  - Money crosses the API as a **string**, matching the sales and
 *    purchase-order APIs, because those values were computed in PostgreSQL
 *    `numeric` and must not round-trip through a JavaScript float.
 *  - Quantities and counts are **numbers**, matching the inventory API.
 *  - `null` means "genuinely unavailable" (a metric that needs data this
 *    business does not have); `0` means "logically zero".
 *  - The analysis window is returned alongside the metrics, so a future
 *    intelligence layer always knows what period a number describes.
 */

import { NotFoundError, ValidationError } from '../errors.js';
import {
  getCatalogAndStockOverview,
  getInventoryPosition,
  getMovementTotals,
  getProductAnalyticsDetail,
  getProductMovementHistory,
  getProductSalesHistory,
  getPurchasingWindows,
  getSalesSeries,
  getSalesWindows,
  // Aliased: this module also exports a `listProductAnalytics` service function.
  listProductAnalytics as listProductAnalyticsRows,
  listSupplierAnalytics,
  type ProductAnalyticsRow,
  type SalesSeriesRow,
  type SupplierAnalyticsRow,
} from '../repositories/analytics.repository.js';
import { MOVEMENT_HISTORY_LIMIT, type GroupBy } from './analytics.schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The default analysis window, in days, when no range is supplied. */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * An inclusive calendar window, with an **exclusive** upper bound for SQL.
 *
 * A bare date such as `2026-06-30` is treated as "through the end of that day",
 * which is what a user means by a date range picker. Without that adjustment
 * the upper bound would silently exclude everything after midnight on the chosen
 * day.
 *
 * ## Days are UTC
 *
 * `z.coerce.date()` parses `"2026-06-30"` as UTC midnight, so the window is
 * computed in **UTC** throughout rather than in server-local time. Mixing the
 * two once collapsed a single-day range to zero length, and would otherwise
 * make the same request mean different things on different servers.
 */
export interface AnalysisWindow {
  /** Inclusive start, at UTC midnight. */
  from: Date;
  /** Exclusive end. */
  to: Date;
  /** Calendar days the window touches. Always >= 1. */
  days: number;
}

function startOfDayUtc(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/**
 * True when the value denotes a bare calendar date, which `date_trunc` and a
 * range picker both read as "this whole day".
 */
function isBareDate(value: Date): boolean {
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

export function resolveWindow(from?: Date, to?: Date): AnalysisWindow {
  if (from !== undefined && to !== undefined && from > to) {
    throw new ValidationError('`from` must not be later than `to`.', 'INVALID_RANGE');
  }

  const endExclusive =
    to === undefined
      ? new Date()
      : new Date(isBareDate(to) ? startOfDayUtc(to).getTime() + DAY_MS : to.getTime());

  // The last calendar day the window touches.
  const lastDay = startOfDayUtc(new Date(endExclusive.getTime() - 1)).getTime();

  // With no explicit start, span exactly DEFAULT_WINDOW_DAYS calendar days
  // ending today, so `days` and therefore `averageDailySales` mean what the
  // caller expects rather than one day more.
  const start =
    from === undefined ? new Date(lastDay - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS) : from;

  const firstDay = startOfDayUtc(start).getTime();
  const days = Math.round((lastDay - firstDay) / DAY_MS) + 1;

  if (days < 1) {
    // A zero-day window would make `averageDailySales` a division by zero.
    throw new ValidationError('The selected period must span at least one day.', 'INVALID_RANGE');
  }

  return { from: new Date(firstDay), to: endExclusive, days };
}

function describeWindow(window: AnalysisWindow) {
  return {
    from: window.from.toISOString(),
    /** Exclusive, as the query uses it. */
    toExclusive: window.to.toISOString(),
    days: window.days,
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface AnalyticsOverview {
  products: {
    totalProducts: number;
    activeProducts: number;
    inactiveProducts: number;
  };
  inventory: {
    totalStockUnits: number;
    productsWithStock: number;
    outOfStockProducts: number;
    productsWithNoMovements: number;
  };
  sales: {
    today: { salesCount: number; unitsSold: number; revenue: string };
    last7Days: { salesCount: number; unitsSold: number; revenue: string };
    last30Days: { salesCount: number; unitsSold: number; revenue: string };
  };
  purchasing: {
    purchaseOrdersLast30Days: number;
    purchaseValueLast30Days: string;
    unitsReceivedLast30Days: number;
  };
  generatedAt: string;
}

/**
 * High-level business metrics.
 *
 * Three aggregate queries cover every metric: catalog + stock position, sales
 * windows, purchasing windows. Each returns one row, so the whole overview is
 * three round trips rather than the two dozen a metric-per-query approach would
 * need.
 *
 * A business with no data at all yields zeroes everywhere, never `null`,
 * `NaN` or `Infinity`.
 */
export async function getOverview(businessId: string): Promise<AnalyticsOverview> {
  const [catalog, sales, purchasing] = await Promise.all([
    getCatalogAndStockOverview(businessId),
    getSalesWindows(businessId),
    getPurchasingWindows(businessId),
  ]);

  return {
    products: {
      totalProducts: Number(catalog?.total_products ?? 0),
      activeProducts: Number(catalog?.active_products ?? 0),
      inactiveProducts: Number(catalog?.inactive_products ?? 0),
    },
    inventory: {
      totalStockUnits: Number(catalog?.total_stock_units ?? 0),
      productsWithStock: Number(catalog?.products_with_stock ?? 0),
      outOfStockProducts: Number(catalog?.out_of_stock_products ?? 0),
      productsWithNoMovements: Number(catalog?.products_with_no_movements ?? 0),
    },
    sales: {
      today: {
        salesCount: Number(sales?.sales_today ?? 0),
        unitsSold: Number(sales?.units_today ?? 0),
        revenue: sales?.revenue_today ?? '0.00',
      },
      last7Days: {
        salesCount: Number(sales?.sales_last_7_days ?? 0),
        unitsSold: Number(sales?.units_last_7_days ?? 0),
        revenue: sales?.revenue_last_7_days ?? '0.00',
      },
      last30Days: {
        salesCount: Number(sales?.sales_last_30_days ?? 0),
        unitsSold: Number(sales?.units_last_30_days ?? 0),
        revenue: sales?.revenue_last_30_days ?? '0.00',
      },
    },
    purchasing: {
      purchaseOrdersLast30Days: Number(purchasing?.purchase_orders_last_30_days ?? 0),
      purchaseValueLast30Days: purchasing?.purchase_value_last_30_days ?? '0.00',
      unitsReceivedLast30Days: Number(purchasing?.units_received_last_30_days ?? 0),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Sales time series
// ---------------------------------------------------------------------------

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
  analysisWindow: ReturnType<typeof describeWindow>;
  groupBy: GroupBy;
}

function mapSeriesRow(row: SalesSeriesRow): SalesSeriesPoint {
  return {
    period: row.period,
    salesCount: Number(row.sales_count),
    unitsSold: Number(row.units_sold),
    revenue: row.revenue,
  };
}

/** Completed sales, time series plus range summary. */
export async function getSalesAnalytics(
  businessId: string,
  options: { from?: Date | undefined; to?: Date | undefined; groupBy: GroupBy },
): Promise<SalesAnalytics> {
  const window = resolveWindow(options.from, options.to);
  const rows = await getSalesSeries(businessId, window.from, window.to, options.groupBy);

  // The window totals ride along with every row, so read them from the first.
  // With no sales in range there are no rows, and the summary is all zeroes.
  const first = rows[0];

  return {
    series: rows.map(mapSeriesRow),
    summary: {
      salesCount: Number(first?.total_sales ?? 0),
      unitsSold: Number(first?.total_units ?? 0),
      revenue: first?.total_revenue ?? '0.00',
      averageSaleValue: first?.average_sale_value ?? '0.00',
    },
    analysisWindow: describeWindow(window),
    groupBy: options.groupBy,
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

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
    /**
     * The signed effect of the window: `in - out + adjustment`. Computed in
     * PostgreSQL, not here.
     */
    netMovement: string;
    movementCount: number;
  };
  analysisWindow: ReturnType<typeof describeWindow>;
}

/** Stock position and movement facts, both derived from the ledger. */
export async function getInventoryAnalytics(
  businessId: string,
  options: { from?: Date | undefined; to?: Date | undefined },
): Promise<InventoryAnalytics> {
  const window = resolveWindow(options.from, options.to);
  const [position, totals] = await Promise.all([
    getInventoryPosition(businessId),
    getMovementTotals(businessId, window.from, window.to),
  ]);

  const inQuantity = Number(totals?.in_quantity ?? 0);
  const outQuantity = Number(totals?.out_quantity ?? 0);
  const adjustmentQuantity = Number(totals?.adjustment_quantity ?? 0);

  return {
    currentStock: {
      totalStockUnits: Number(position?.total_stock_units ?? 0),
      productsWithStock: Number(position?.products_with_stock ?? 0),
      outOfStockProducts: Number(position?.out_of_stock_products ?? 0),
      productsWithNoMovements: Number(position?.products_with_no_movements ?? 0),
    },
    movements: {
      inQuantity,
      outQuantity,
      adjustmentQuantity,
      // Signed net, formatted to two decimals without float error: built from
      // the string values the database returned.
      netMovement: netMovementString(
        totals?.in_quantity ?? '0',
        totals?.out_quantity ?? '0',
        totals?.adjustment_quantity ?? '0',
      ),
      movementCount: Number(totals?.movement_count ?? 0),
    },
    analysisWindow: describeWindow(window),
  };
}

/**
 * `in - out + adjustment` on exact decimal strings.
 *
 * This is a sign convention over already-computed sums, not arithmetic on
 * quantities — the individual figures come straight from the database. Done
 * with `BigInt` on scaled integers so no float rounding is involved.
 */
function netMovementString(
  inQuantity: string,
  outQuantity: string,
  adjustment: string,
): string {
  const cents =
    toScaledCents(inQuantity) - toScaledCents(outQuantity) + toScaledCents(adjustment);
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function toScaledCents(value: string): bigint {
  const negative = value.trim().startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.trim().slice(1) : value.trim()).split('.');
  return BigInt(`${whole}${fraction.padEnd(2, '0').slice(0, 2) || '0'}`) * (negative ? -1n : 1n);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

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
  /**
   * Units sold divided by the length of the analysis window, in `numeric`.
   *
   * A **historical** metric only — the average over a period, not a forecast.
   */
  averageDailySales: number;
  lastSaleAt: string | null;
  lastMovementAt: string | null;
}

function mapProductRow(row: ProductAnalyticsRow): ProductAnalytics {
  return {
    productId: row.id,
    sku: row.sku,
    name: row.name,
    category:
      row.category_id && row.category_name
        ? { id: row.category_id, name: row.category_name }
        : null,
    isActive: row.is_active,
    currentStock: Number(row.current_stock),
    unitsSold: Number(row.units_sold),
    salesCount: Number(row.sales_count),
    revenue: row.revenue,
    averageDailySales: Number(row.average_daily_sales),
    lastSaleAt: row.last_sale_at ? row.last_sale_at.toISOString() : null,
    lastMovementAt: row.last_movement_at ? row.last_movement_at.toISOString() : null,
  };
}

export interface ProductAnalyticsPage {
  items: ProductAnalytics[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  analysisWindow: ReturnType<typeof describeWindow>;
}

/**
 * Product-level facts for a page of products.
 *
 * Products with no sales and no movements are kept, reporting zeroes and `null`
 * timestamps — an empty storefront is not the same as a product that has never
 * moved.
 */
export async function listProductAnalytics(
  businessId: string,
  options: {
    search?: string | undefined;
    categoryId?: string | undefined;
    isActive?: boolean | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    page: number;
    limit: number;
  },
): Promise<ProductAnalyticsPage> {
  const window = resolveWindow(options.from, options.to);

  const { items, total } = await listProductAnalyticsPage(businessId, options, window);

  return {
    items: items.map(mapProductRow),
    page: options.page,
    limit: options.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / options.limit)),
    analysisWindow: describeWindow(window),
  };
}

async function listProductAnalyticsPage(
  businessId: string,
  options: {
    search?: string | undefined;
    categoryId?: string | undefined;
    isActive?: boolean | undefined;
    page: number;
    limit: number;
  },
  window: AnalysisWindow,
): Promise<{ items: ProductAnalyticsRow[]; total: number }> {
  return listProductAnalyticsRows(businessId, {
    ...(options.search !== undefined ? { search: options.search } : {}),
    ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
    ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
    from: window.from,
    to: window.to,
    days: window.days,
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
  });
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
  analysisWindow: ReturnType<typeof describeWindow>;
}

/**
 * Everything known about one product's activity.
 *
 * A product in another business yields no row and is reported as `404`, so the
 * endpoint never confirms that another tenant's product exists.
 */
export async function getProductAnalytics(
  businessId: string,
  productId: string,
  options: { from?: Date | undefined; to?: Date | undefined; groupBy: GroupBy },
): Promise<ProductAnalyticsDetail> {
  const window = resolveWindow(options.from, options.to);

  // Existence, ownership and the base metrics in one statement. Checked before
  // the series so a cross-tenant product costs a single query, not three.
  const row = await getProductAnalyticsDetail(
    businessId,
    productId,
    window.from,
    window.to,
    window.days,
  );
  if (!row) throw new NotFoundError('Product not found.');

  const [salesHistory, movementHistory] = await Promise.all([
    getProductSalesHistory(businessId, productId, window.from, window.to, options.groupBy),
    getProductMovementHistory(businessId, productId, MOVEMENT_HISTORY_LIMIT),
  ]);

  return {
    product: {
      productId: row.id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      category:
        row.category_id && row.category_name
          ? { id: row.category_id, name: row.category_name }
          : null,
      isActive: row.is_active,
      currentStock: Number(row.current_stock),
    },
    sales: {
      unitsSold: Number(row.units_sold),
      salesCount: Number(row.sales_count),
      revenue: row.revenue,
      averageDailySales: Number(row.average_daily_sales),
      lastSaleAt: row.last_sale_at ? row.last_sale_at.toISOString() : null,
    },
    inventory: {
      totalIn: Number(row.total_in),
      totalOut: Number(row.total_out),
      totalAdjustment: Number(row.total_adjustment),
      lastMovementAt: row.last_movement_at ? row.last_movement_at.toISOString() : null,
    },
    purchasing: {
      unitsPurchased: Number(row.units_purchased),
      purchaseOrderCount: Number(row.purchase_order_count),
      lastReceivedAt: row.last_received_at ? row.last_received_at.toISOString() : null,
    },
    timeSeries: {
      sales: salesHistory.map((point) => ({
        period: point.period,
        salesCount: Number(point.sales_count),
        unitsSold: Number(point.units_sold),
        revenue: point.revenue,
      })),
      movements: movementHistory.map((movement) => ({
        createdAt: movement.created_at.toISOString(),
        movementType: movement.movement_type,
        quantity: Number(movement.quantity),
        reason: movement.reason,
        referenceType: movement.reference_type,
        referenceId: movement.reference_id,
        recordedBy: movement.user_name,
      })),
    },
    analysisWindow: describeWindow(window),
  };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

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
  /**
   * Historical mean of `received_at - ordered_at` across fully received
   * orders, in days.
   *
   * `null` when no order has both timestamps — a metric that needs data this
   * supplier does not have, which is different from a lead time of zero.
   * A historical observation, **not** a prediction.
   */
  averageLeadTimeDays: number | null;
  productCount: number;
}

/**
 * Supplier purchasing facts.
 *
 * Cancelled orders contribute nothing to any figure, and a supplier with no
 * orders still appears, reporting zeroes.
 */
export async function getSupplierAnalytics(businessId: string): Promise<SupplierAnalytics[]> {
  const rows = await listSupplierAnalytics(businessId);

  return rows.map((row: SupplierAnalyticsRow) => ({
    supplierId: row.id,
    supplierName: row.name,
    isActive: row.is_active,
    purchaseOrderCount: Number(row.purchase_order_count),
    receivedPurchaseOrderCount: Number(row.received_purchase_order_count),
    unitsOrdered: Number(row.units_ordered),
    unitsReceived: Number(row.units_received),
    purchaseValue: row.purchase_value,
    lastOrderAt: row.last_order_at ? row.last_order_at.toISOString() : null,
    lastReceivedAt: row.last_received_at ? row.last_received_at.toISOString() : null,
    averageLeadTimeDays:
      row.average_lead_time_days === null ? null : Number(row.average_lead_time_days),
    productCount: Number(row.product_count),
  }));
}

