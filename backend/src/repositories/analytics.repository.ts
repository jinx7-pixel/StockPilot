/**
 * Analytics persistence — the **facts** layer.
 *
 * ## This is not a second source of truth
 *
 * Every number here is derived at query time from the transactional tables.
 * Nothing is stored, cached or materialised: there is no analytics table, no
 * `current_stock` column and no cached stock table. If a movement is corrected,
 * every metric reflects it on the next request.
 *
 * ## Rules this module follows
 *
 *  - **Stock has one definition.** {@link BALANCE_EXPRESSION} is imported from
 *    the inventory repository rather than reimplemented, so a dashboard can
 *    never disagree with the ledger.
 *  - **All aggregation happens in PostgreSQL**, in exact `numeric`. Monetary and
 *    quantity values are returned as strings; nothing is summed or divided in
 *    JavaScript.
 *  - **No N+1.** List endpoints resolve a page of products with `LATERAL`
 *    sub-selects in a single round trip, and the overview uses three well-shaped
 *    aggregate queries rather than dozens of small ones.
 *  - **Everything is parameterised**, including the `date_trunc` unit, which
 *    comes from a validated enum. There is no user-controllable SQL fragment.
 *  - **Tenant-scoped by construction.** Every query takes `business_id` as its
 *    first parameter; the caller only ever supplies it from the session.
 */

import { query } from '../db/pool.js';
import { BALANCE_EXPRESSION } from './inventory.repository.js';

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewRow {
  total_products: string;
  active_products: string;
  inactive_products: string;
  total_stock_units: string;
  products_with_stock: string;
  out_of_stock_products: string;
  products_with_no_movements: string;
}

/**
 * Catalog and stock position, in one query.
 *
 * A `LATERAL` sub-select derives each product's balance using the shared
 * expression, so products with no movements correctly report zero rather than
 * being dropped by an inner join.
 *
 * Stock is counted for *all* products, including inactive ones: a retired
 * product's units are still physically on hand and still in the ledger, so
 * excluding them would understate what the business actually holds.
 */
export async function getCatalogAndStockOverview(
  businessId: string,
): Promise<OverviewRow | null> {
  const result = await query<OverviewRow>(
    `SELECT
       count(*)::int                                          AS total_products,
       count(*) FILTER (WHERE p.is_active)::int               AS active_products,
       count(*) FILTER (WHERE NOT p.is_active)::int            AS inactive_products,
       COALESCE(SUM(b.balance), 0.00)::numeric                   AS total_stock_units,
       count(*) FILTER (WHERE b.balance > 0)::int              AS products_with_stock,
       count(*) FILTER (WHERE b.balance <= 0)::int             AS out_of_stock_products,
       count(*) FILTER (WHERE b.movement_count = 0)::int       AS products_with_no_movements
     FROM products p
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(${BALANCE_EXPRESSION}), 0) AS balance,
              COUNT(*) AS movement_count
         FROM inventory_movements im
        WHERE im.business_id = p.business_id AND im.product_id = p.id
     ) b ON true
     WHERE p.business_id = $1`,
    [businessId],
  );

  return result.rows[0] ?? null;
}

export interface SalesWindowRow {
  sales_today: string;
  units_today: string;
  revenue_today: string;
  sales_last_7_days: string;
  units_last_7_days: string;
  revenue_last_7_days: string;
  sales_last_30_days: string;
  units_last_30_days: string;
  revenue_last_30_days: string;
}

/**
 * Sales metrics for the last 1, 7 and 30 days, in one query.
 *
 * The per-sale CTE aggregates line items **once per sale**, so the window
 * filters can then be applied with `FILTER` clauses without a sale ever being
 * counted twice. Revenue uses the stored `total_amount` (exact `numeric`),
 * units come from summing the line quantities.
 */
/**
 * UTC midnight of "today", as a `timestamptz`.
 *
 * ## Why the round trip
 *
 * `date_trunc('day', now())` truncates in the **session** timezone, so "today" is
 * a different calendar day depending on where the database runs — and a dashboard
 * showing "sales today" would disagree with the intelligence window beside it.
 *
 * The trailing `AT TIME ZONE 'UTC'` is not decoration. Truncating produces a
 * `timestamp` (a bare wall clock), and comparing a `timestamptz` column against a
 * bare `timestamp` makes PostgreSQL reinterpret it **in the session timezone** —
 * reintroducing the exact dependence we are removing. Converting back with
 * `AT TIME ZONE 'UTC'` pins the instant itself, so the comparison is identical
 * everywhere.
 */
const UTC_TODAY = "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";

export async function getSalesWindows(
  businessId: string,
): Promise<SalesWindowRow | null> {
  const result = await query<SalesWindowRow>(
    `WITH per_sale AS (
       SELECT s.id, s.sold_at, s.total_amount,
              COALESCE(SUM(si.quantity), 0) AS units
         FROM sales s
         LEFT JOIN sale_items si
                ON si.sale_id = s.id AND si.business_id = s.business_id
        WHERE s.business_id = $1
          AND s.status = 'completed'
          AND s.sold_at >= ${UTC_TODAY} - interval '30 days'
        GROUP BY s.id, s.sold_at, s.total_amount
     )
     SELECT
       count(*) FILTER (WHERE sold_at >= ${UTC_TODAY})::int                              AS sales_today,
       COALESCE(SUM(units) FILTER (WHERE sold_at >= ${UTC_TODAY}), 0.00)::numeric         AS units_today,
       COALESCE(SUM(total_amount) FILTER (WHERE sold_at >= ${UTC_TODAY}), 0.00)::numeric  AS revenue_today,

       count(*) FILTER (WHERE sold_at >= now() - interval '7 days')::int                  AS sales_last_7_days,
       COALESCE(SUM(units) FILTER (WHERE sold_at >= now() - interval '7 days'), 0.00)::numeric AS units_last_7_days,
       COALESCE(SUM(total_amount) FILTER (WHERE sold_at >= now() - interval '7 days'), 0.00)::numeric AS revenue_last_7_days,

       count(*) FILTER (WHERE sold_at >= now() - interval '30 days')::int                 AS sales_last_30_days,
       COALESCE(SUM(units) FILTER (WHERE sold_at >= now() - interval '30 days'), 0.00)::numeric AS units_last_30_days,
       COALESCE(SUM(total_amount) FILTER (WHERE sold_at >= now() - interval '30 days'), 0.00)::numeric AS revenue_last_30_days
     FROM per_sale`,
    [businessId],
  );

  return result.rows[0] ?? null;
}

export interface PurchasingWindowRow {
  purchase_orders_last_30_days: string;
  purchase_value_last_30_days: string;
  units_received_last_30_days: string;
}

/**
 * Purchasing metrics for the last 30 days.
 *
 * Cancelled orders are excluded throughout: a cancelled order was never
 * committed to a supplier, so counting it would overstate both spend and
 * ordering activity.
 *
 * `units_received` comes from the **inventory ledger** rather than the order
 * rows, because a purchase order only carries `received_at` once it is *fully*
 * received. The ledger records the exact moment of every receipt, including
 * partial ones, and cannot count a cancelled order — nothing was received
 * against one.
 */
export async function getPurchasingWindows(
  businessId: string,
): Promise<PurchasingWindowRow | null> {
  const result = await query<PurchasingWindowRow>(
    `WITH ordered AS (
       SELECT count(*)::int AS order_count,
              COALESCE(SUM(total_amount), 0.00)::numeric AS order_value
         FROM purchase_orders
        WHERE business_id = $1
          AND status <> 'cancelled'
          AND created_at >= now() - interval '30 days'
     ),
     received AS (
       SELECT COALESCE(SUM(quantity), 0.00)::numeric AS units
         FROM inventory_movements
        WHERE business_id = $1
          AND movement_type = 'in'
          AND reference_type = 'purchase_order'
          AND created_at >= now() - interval '30 days'
     )
     SELECT ordered.order_count  AS purchase_orders_last_30_days,
            ordered.order_value  AS purchase_value_last_30_days,
            received.units       AS units_received_last_30_days
       FROM ordered, received`,
    [businessId],
  );

  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sales time series
// ---------------------------------------------------------------------------

export interface SalesSeriesRow {
  period: string;
  sales_count: string;
  units_sold: string;
  revenue: string;
  total_sales: string;
  total_units: string;
  total_revenue: string;
  average_sale_value: string;
}

/**
 * Time series plus range summary for completed sales, in one query.
 *
 * The per-sale CTE aggregates line items once per sale; the grouped query then
 * rolls up by period, and window functions carry the range totals alongside so
 * the series and its summary never disagree.
 *
 * `average_sale_value` is computed in `numeric` and guarded against a
 * zero-sale range. `$3` is the `date_trunc` unit, taken from a validated enum.
 */
export async function getSalesSeries(
  businessId: string,
  from: Date,
  to: Date,
  groupBy: 'day' | 'week' | 'month',
): Promise<SalesSeriesRow[]> {
  const result = await query<SalesSeriesRow>(
    `WITH per_sale AS (
       SELECT s.id, s.sold_at, s.total_amount,
              COALESCE(SUM(si.quantity), 0) AS units
         FROM sales s
         LEFT JOIN sale_items si
                ON si.sale_id = s.id AND si.business_id = s.business_id
        WHERE s.business_id = $1
          AND s.status = 'completed'
          AND s.sold_at >= $2
          AND s.sold_at < $3
        GROUP BY s.id, s.sold_at, s.total_amount
     ),
     grouped AS (
       -- Bucket in UTC so a daily series is the same series everywhere. The unit
       -- stays the validated parameter $4; only the value being bucketed is pinned.
       SELECT to_char(date_trunc($4, sold_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
              count(*)::int                AS sales_count,
              SUM(units)::numeric         AS units_sold,
              SUM(total_amount)::numeric   AS revenue
         FROM per_sale
        GROUP BY 1
     )
     SELECT period,
            sales_count,
            units_sold,
            revenue,
            SUM(sales_count) OVER ()::int               AS total_sales,
            SUM(units_sold) OVER ()::numeric           AS total_units,
            SUM(revenue) OVER ()::numeric              AS total_revenue,
            CASE
              WHEN SUM(sales_count) OVER () > 0
              THEN ROUND(SUM(revenue) OVER () / SUM(sales_count) OVER (), 2)
              ELSE 0.00
            END::numeric AS average_sale_value
       FROM grouped
      ORDER BY period ASC`,
    [businessId, from, to, groupBy],
  );

  return result.rows;
}

// ---------------------------------------------------------------------------
// Inventory analytics
// ---------------------------------------------------------------------------

export interface InventoryPositionRow {
  total_stock_units: string;
  products_with_stock: string;
  out_of_stock_products: string;
  products_with_no_movements: string;
}

/** Current stock position, using the shared balance expression. */
export async function getInventoryPosition(
  businessId: string,
): Promise<InventoryPositionRow | null> {
  const result = await query<InventoryPositionRow>(
    `SELECT COALESCE(SUM(b.balance), 0.00)::numeric              AS total_stock_units,
            count(*) FILTER (WHERE b.balance > 0)::int        AS products_with_stock,
            count(*) FILTER (WHERE b.balance <= 0)::int       AS out_of_stock_products,
            count(*) FILTER (WHERE b.movement_count = 0)::int AS products_with_no_movements
       FROM products p
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(${BALANCE_EXPRESSION}), 0) AS balance,
                COUNT(*) AS movement_count
           FROM inventory_movements im
          WHERE im.business_id = p.business_id AND im.product_id = p.id
       ) b ON true
      WHERE p.business_id = $1`,
    [businessId],
  );

  return result.rows[0] ?? null;
}

export interface MovementTotalsRow {
  in_quantity: string;
  out_quantity: string;
  adjustment_quantity: string;
  movement_count: string;
}

/** Movement totals across a date window, by type. */
export async function getMovementTotals(
  businessId: string,
  from: Date,
  to: Date,
): Promise<MovementTotalsRow | null> {
  const result = await query<MovementTotalsRow>(
    `SELECT
       COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'in'), 0.00)::numeric         AS in_quantity,
       COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'out'), 0.00)::numeric        AS out_quantity,
       COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'adjustment'), 0.00)::numeric AS adjustment_quantity,
       count(*)::int                                                                   AS movement_count
     FROM inventory_movements
    WHERE business_id = $1 AND created_at >= $2 AND created_at < $3`,
    [businessId, from, to],
  );

  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Product analytics
// ---------------------------------------------------------------------------

export interface ProductAnalyticsRow {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;
  current_stock: string;
  units_sold: string;
  sales_count: string;
  revenue: string;
  average_daily_sales: string;
  last_sale_at: Date | null;
  last_movement_at: Date | null;
}

export interface ListProductAnalyticsFilters {
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  from: Date;
  to: Date;
  /** Calendar days in the analysis window. Guaranteed >= 1 by the service. */
  days: number;
  limit: number;
  offset: number;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Product-level facts for a page of products, in one query.
 *
 * Two `LATERAL` sub-selects — one for the stock balance, one for sales inside
 * the window — mean a page of 25 products costs one round trip, not 25 or 50.
 * `LEFT JOIN LATERAL` keeps products with no sales and no movements, reporting
 * zeroes instead of silently dropping them.
 *
 * `average_daily_sales` divides in `numeric` by the window length, which the
 * service guarantees is at least one day, so there is no division by zero.
 */
export async function listProductAnalytics(
  businessId: string,
  filters: ListProductAnalyticsFilters,
): Promise<{ items: ProductAnalyticsRow[]; total: number }> {
  const conditions: string[] = ['p.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filters.search !== undefined) {
    params.push(`%${escapeLikePattern(filters.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(p.name ILIKE ${placeholder} ESCAPE '\\' OR p.sku ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filters.categoryId !== undefined) {
    params.push(filters.categoryId);
    conditions.push(`p.category_id = $${params.length}`);
  }

  if (filters.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`p.is_active = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  // $3 = window start, $4 = window end (exclusive), $5 = window length in days.
  const windowStart = `$${params.length + 1}`;
  const windowEnd = `$${params.length + 2}`;
  const windowDays = `$${params.length + 3}`;

  const sqlParams = [
    ...params,
    filters.from,
    filters.to,
    filters.days,
  ];

  const pageParams = [...sqlParams, filters.limit, filters.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<ProductAnalyticsRow>(
    `SELECT p.id, p.sku, p.name, p.category_id, p.is_active,
            c.name AS category_name,
            COALESCE(st.balance, 0.00)::numeric      AS current_stock,
            COALESCE(sa.units_sold, 0.00)::numeric  AS units_sold,
            COALESCE(sa.sales_count, 0)::int      AS sales_count,
            COALESCE(sa.revenue, 0.00)::numeric      AS revenue,
            CASE
              WHEN sa.sales_count IS NULL THEN 0
              ELSE ROUND(sa.units_sold / ${windowDays}::numeric, 4)
            END::numeric                         AS average_daily_sales,
            sa.last_sale_at,
            st.last_movement_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(${BALANCE_EXPRESSION}), 0) AS balance,
                MAX(created_at) AS last_movement_at
           FROM inventory_movements im
          WHERE im.business_id = p.business_id AND im.product_id = p.id
       ) st ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(si.quantity), 0.00)::numeric  AS units_sold,
                count(DISTINCT s.id)::int              AS sales_count,
                COALESCE(SUM(si.line_total), 0.00)::numeric AS revenue,
                MAX(s.sold_at)                          AS last_sale_at
           FROM sales s
           JOIN sale_items si
                ON si.sale_id = s.id AND si.business_id = s.business_id
          WHERE s.business_id = p.business_id
            AND s.status = 'completed'
            AND s.sold_at >= ${windowStart}
            AND s.sold_at < ${windowEnd}
            AND si.product_id = p.id
       ) sa ON true
      WHERE ${where}
      ORDER BY lower(p.name) ASC, p.id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  // The count reuses the same filters but not the LATERALs, which cannot change
  // how many rows match.
  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where}`,
    sqlParams.slice(0, params.length),
  );

  return {
    items: result.rows,
    total: countResult.rows[0]?.count ?? 0,
  };
}

export interface ProductDetailAnalyticsRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;
  current_stock: string;
  units_sold: string;
  sales_count: string;
  revenue: string;
  average_daily_sales: string;
  last_sale_at: Date | null;
  total_in: string;
  total_out: string;
  total_adjustment: string;
  last_movement_at: Date | null;
  units_purchased: string;
  purchase_order_count: string;
  last_received_at: Date | null;
}

/**
 * Everything known about one product's activity, in a single query.
 *
 * Existence and tenant ownership are checked in the same statement, so a
 * product in another business produces no row and the service reports 404.
 * Sales figures are windowed; inventory and purchasing figures are lifetime.
 */
export async function getProductAnalyticsDetail(
  businessId: string,
  productId: string,
  from: Date,
  to: Date,
  days: number,
): Promise<ProductDetailAnalyticsRow | null> {
  const result = await query<ProductDetailAnalyticsRow>(
    `SELECT p.id, p.sku, p.name, p.description, p.category_id, p.is_active,
            c.name AS category_name,
            COALESCE((
              SELECT SUM(${BALANCE_EXPRESSION})
                FROM inventory_movements im
               WHERE im.business_id = p.business_id AND im.product_id = p.id
            ), 0.00)::numeric AS current_stock,

            COALESCE((
              SELECT SUM(si.quantity)
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
               WHERE s.business_id = p.business_id AND s.status = 'completed'
                 AND s.sold_at >= $3 AND s.sold_at < $4
                 AND si.product_id = p.id
            ), 0.00)::numeric AS units_sold,
            COALESCE((
              SELECT count(DISTINCT s.id)
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
               WHERE s.business_id = p.business_id AND s.status = 'completed'
                 AND s.sold_at >= $3 AND s.sold_at < $4
                 AND si.product_id = p.id
            ), 0)::int AS sales_count,
            COALESCE((
              SELECT SUM(si.line_total)
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
               WHERE s.business_id = p.business_id AND s.status = 'completed'
                 AND s.sold_at >= $3 AND s.sold_at < $4
                 AND si.product_id = p.id
            ), 0.00)::numeric AS revenue,
            COALESCE((
              SELECT ROUND(SUM(si.quantity) / $5::numeric, 4)
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
               WHERE s.business_id = p.business_id AND s.status = 'completed'
                 AND s.sold_at >= $3 AND s.sold_at < $4
                 AND si.product_id = p.id
            ), 0.00)::numeric AS average_daily_sales,
            (SELECT MAX(s.sold_at)
               FROM sales s
               JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
              WHERE s.business_id = p.business_id AND s.status = 'completed'
                AND si.product_id = p.id) AS last_sale_at,

            COALESCE((
              SELECT SUM(im.quantity) FILTER (WHERE im.movement_type = 'in')
                FROM inventory_movements im
               WHERE im.business_id = p.business_id AND im.product_id = p.id
            ), 0.00)::numeric AS total_in,
            COALESCE((
              SELECT SUM(im.quantity) FILTER (WHERE im.movement_type = 'out')
                FROM inventory_movements im
               WHERE im.business_id = p.business_id AND im.product_id = p.id
            ), 0.00)::numeric AS total_out,
            COALESCE((
              SELECT SUM(im.quantity) FILTER (WHERE im.movement_type = 'adjustment')
                FROM inventory_movements im
               WHERE im.business_id = p.business_id AND im.product_id = p.id
            ), 0.00)::numeric AS total_adjustment,
            (SELECT MAX(im.created_at)
               FROM inventory_movements im
              WHERE im.business_id = p.business_id AND im.product_id = p.id) AS last_movement_at,

            COALESCE((
              SELECT SUM(poi.quantity)
                FROM purchase_order_items poi
                JOIN purchase_orders po
                  ON po.id = poi.purchase_order_id AND po.business_id = poi.business_id
               WHERE poi.business_id = p.business_id AND poi.product_id = p.id
                 AND po.status <> 'cancelled'
            ), 0.00)::numeric AS units_purchased,
            COALESCE((
              SELECT count(DISTINCT poi.purchase_order_id)
                FROM purchase_order_items poi
                JOIN purchase_orders po
                  ON po.id = poi.purchase_order_id AND po.business_id = poi.business_id
               WHERE poi.business_id = p.business_id AND poi.product_id = p.id
                 AND po.status <> 'cancelled'
            ), 0)::int AS purchase_order_count,
            (SELECT MAX(po.received_at)
               FROM purchase_order_items poi
               JOIN purchase_orders po
                 ON po.id = poi.purchase_order_id AND po.business_id = poi.business_id
              WHERE poi.business_id = p.business_id AND poi.product_id = p.id
                AND po.status <> 'cancelled') AS last_received_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.business_id = $1 AND p.id = $2`,
    [businessId, productId, from, to, days],
  );

  return result.rows[0] ?? null;
}

export interface ProductSalesHistoryRow {
  period: string;
  sales_count: string;
  units_sold: string;
  revenue: string;
}

export async function getProductSalesHistory(
  businessId: string,
  productId: string,
  from: Date,
  to: Date,
  groupBy: 'day' | 'week' | 'month',
): Promise<ProductSalesHistoryRow[]> {
  const result = await query<ProductSalesHistoryRow>(
    `SELECT to_char(date_trunc($5, s.sold_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
            count(DISTINCT s.id)::int              AS sales_count,
            COALESCE(SUM(si.quantity), 0.00)::numeric  AS units_sold,
            COALESCE(SUM(si.line_total), 0.00)::numeric AS revenue
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
      WHERE s.business_id = $1
        AND s.status = 'completed'
        AND si.product_id = $2
        AND s.sold_at >= $3
        AND s.sold_at < $4
      GROUP BY 1
      ORDER BY 1 ASC`,
    [businessId, productId, from, to, groupBy],
  );

  return result.rows;
}

export interface ProductMovementHistoryRow {
  created_at: Date;
  movement_type: string;
  quantity: string;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  user_name: string;
}

export async function getProductMovementHistory(
  businessId: string,
  productId: string,
  limit: number,
): Promise<ProductMovementHistoryRow[]> {
  const result = await query<ProductMovementHistoryRow>(
    `SELECT im.created_at, im.movement_type, im.quantity, im.reason,
            im.reference_type, im.reference_id, u.name AS user_name
       FROM inventory_movements im
       JOIN users u ON u.id = im.created_by
      WHERE im.business_id = $1 AND im.product_id = $2
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT $3`,
    [businessId, productId, limit],
  );

  return result.rows;
}

// ---------------------------------------------------------------------------
// Supplier analytics
// ---------------------------------------------------------------------------

export interface SupplierAnalyticsRow {
  id: string;
  name: string;
  is_active: boolean;
  purchase_order_count: string;
  received_purchase_order_count: string;
  units_ordered: string;
  units_received: string;
  purchase_value: string;
  last_order_at: Date | null;
  last_received_at: Date | null;
  average_lead_time_days: string | null;
  product_count: string;
}

/**
 * Supplier purchasing facts, in one query.
 *
 * Cancelled orders are excluded from every figure. `units_received` is the sum
 * of `received_quantity`, which is only ever greater than zero for goods that
 * actually arrived — so a cancelled or still-open order contributes nothing.
 *
 * `average_lead_time_days` averages `received_at - ordered_at` over **fully
 * received orders that have both timestamps**. Incomplete orders are excluded
 * rather than estimated, and with no qualifying order the average is `null`
 * rather than a misleading zero.
 *
 * Pre-aggregating orders and line items in separate CTEs avoids the row
 * multiplication that joining both would cause.
 */
export async function listSupplierAnalytics(
  businessId: string,
): Promise<SupplierAnalyticsRow[]> {
  const result = await query<SupplierAnalyticsRow>(
    `WITH order_stats AS (
       SELECT supplier_id,
              count(*)::int AS order_count,
              count(*) FILTER (WHERE status = 'received')::int AS received_count,
              COALESCE(SUM(total_amount), 0.00)::numeric AS order_value,
              max(ordered_at)  AS last_order_at,
              max(received_at) AS last_received_at,
              -- Rounded to two decimals: a lead time is a day-scale figure, and
              -- unrounded microsecond precision is float noise, not information.
              round(
                avg(
                  CASE
                    WHEN received_at IS NOT NULL AND ordered_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (received_at - ordered_at)) / 86400.0
                  END
                )::numeric, 2
              ) AS lead_time_days
         FROM purchase_orders
        WHERE business_id = $1 AND status <> 'cancelled'
        GROUP BY supplier_id
     ),
     item_stats AS (
       SELECT po.supplier_id,
              COALESCE(SUM(poi.quantity), 0.00)::numeric          AS units_ordered,
              COALESCE(SUM(poi.received_quantity), 0.00)::numeric AS units_received,
              count(DISTINCT poi.product_id)::int              AS product_count
         FROM purchase_order_items poi
         JOIN purchase_orders po
           ON po.id = poi.purchase_order_id AND po.business_id = poi.business_id
        WHERE poi.business_id = $1 AND po.status <> 'cancelled'
        GROUP BY po.supplier_id
     )
     SELECT s.id, s.name, s.is_active,
            COALESCE(o.order_count, 0)::int        AS purchase_order_count,
            COALESCE(o.received_count, 0)::int     AS received_purchase_order_count,
            COALESCE(i.units_ordered, 0.00)::numeric  AS units_ordered,
            COALESCE(i.units_received, 0.00)::numeric AS units_received,
            COALESCE(o.order_value, 0.00)::numeric    AS purchase_value,
            o.last_order_at,
            o.last_received_at,
            o.lead_time_days                       AS average_lead_time_days,
            COALESCE(i.product_count, 0)::int      AS product_count
       FROM suppliers s
       LEFT JOIN order_stats o ON o.supplier_id = s.id
       LEFT JOIN item_stats  i ON i.supplier_id = s.id
      WHERE s.business_id = $1
      ORDER BY lower(s.name) ASC, s.id ASC`,
    [businessId],
  );

  return result.rows;
}

