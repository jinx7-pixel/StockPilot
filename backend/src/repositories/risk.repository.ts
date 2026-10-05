/**
 * Stock-risk fact gathering.
 *
 * This is the only place SQL touches the risk engine's inputs. The engine
 * itself is pure, so swapping PostgreSQL for a cached read — or for a future
 * forecasting model — changes this file alone.
 *
 * Three rules are load-bearing:
 *
 *  - **Current stock is never recomputed here.** It comes from the inventory
 *    ledger through the shared {@link BALANCE_EXPRESSION}, so the engine can
 *    never disagree with stock.
 *  - **Numbers are rounded in SQL** to at most four decimal places, which the
 *    engine's exact-decimal arithmetic then handles without a float.
 *  - **Products with no sales and no movements are kept.** `LEFT JOIN LATERAL`
 *    is exactly what preserves them, and they are the ones most likely to need
 *    an `INSUFFICIENT_DATA` verdict.
 */

import { query } from '../db/pool.js';
import { BALANCE_EXPRESSION } from './inventory.repository.js';
import { STOCK_RISK_POLICY } from '../intelligence/policies.js';

export interface StockRiskFactRow {
  product_id: string;
  business_id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;
  current_stock: string;
  units_sold: string;
  average_daily_sales: string;
  observable_history_days: number;
  active_sales_days: number;
  /** Lead time in days, one per qualifying completed purchase order. */
  lead_time_samples: string[] | null;
}

const WINDOW_DAYS = STOCK_RISK_POLICY.analysisWindowDays;

/**
 * The shared per-product projection.
 *
 * Built by a function rather than a constant because the window placeholders
 * depend on how many filter parameters preceded them in the calling query.
 */
function riskProjection(windowStart: string, windowEnd: string, windowDays: string): string {
  return `
  SELECT p.id                                   AS product_id,
         p.business_id                         AS business_id,
         p.sku, p.name, p.category_id, c.name AS category_name,
         p.is_active,
         COALESCE(st.balance, 0.00)::numeric    AS current_stock,
         COALESCE(sa.units_sold, 0.00)::numeric AS units_sold,
         CASE
           WHEN COALESCE(sa.units_sold, 0) > 0
           THEN ROUND(COALESCE(sa.units_sold, 0) / ${windowDays}::numeric, 4)
           ELSE 0
         END::numeric                           AS average_daily_sales,
         COALESCE(obs.observable_days, 0)::int AS observable_history_days,
         COALESCE(sa.active_days, 0)::int      AS active_sales_days,
         lt.samples                            AS lead_time_samples
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(${BALANCE_EXPRESSION}), 0) AS balance
        FROM inventory_movements im
       WHERE im.business_id = p.business_id AND im.product_id = p.id
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(si.quantity), 0) AS units_sold,
             count(DISTINCT date_trunc('day', s.sold_at))::int AS active_days
        FROM sales s
        JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
       WHERE s.business_id = p.business_id
         AND s.status = 'completed'
         AND si.product_id = p.id
         AND s.sold_at >= ${windowStart} AND s.sold_at < ${windowEnd}
    ) sa ON true
    LEFT JOIN LATERAL (
      -- Days since the product first became observable in the ledger, not the
      -- product record's age: a product created long ago but stocked yesterday
      -- has one day of evidence, not ninety.
      --
      -- Extracting the DAY component is exact here because both sides are
      -- truncated to midnight, so the difference is a whole number of days.
      SELECT GREATEST(0, EXTRACT(DAY FROM (
               date_trunc('day', now()) - date_trunc('day', MIN(created_at))
             ))::int) AS observable_days
        FROM inventory_movements im
       WHERE im.business_id = p.business_id AND im.product_id = p.id
    ) obs ON true
    LEFT JOIN LATERAL (
      -- Lead time only from **fully received, non-cancelled** purchase orders
      -- that contain this product and carry both timestamps. Drafts, incomplete
      -- orders, cancellations and timestamp gaps are all excluded.
      --
      -- The cast to text is load-bearing: the driver parses a numeric array into
      -- JavaScript *numbers*, while a scalar numeric stays a string. The engine
      -- takes decimal strings, so this keeps one consistent boundary type and keeps
      -- a JS float out of exact-decimal arithmetic.
      SELECT array_agg(
               ROUND(EXTRACT(EPOCH FROM (po.received_at - po.ordered_at)) / 86400.0, 2)::text
               ORDER BY po.received_at - po.ordered_at
             ) AS samples
        FROM purchase_order_items poi
        JOIN purchase_orders po
          ON po.id = poi.purchase_order_id AND po.business_id = poi.business_id
       WHERE poi.business_id = p.business_id
         AND poi.product_id = p.id
         AND po.status = 'received'
         AND po.ordered_at IS NOT NULL
         AND po.received_at IS NOT NULL
         AND po.received_at >= po.ordered_at
    ) lt ON true
`;
}

export interface ProductRiskFilter {
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  limit: number;
  offset: number;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listStockRiskFacts(
  businessId: string,
  filter: ProductRiskFilter,
): Promise<StockRiskFactRow[]> {
  // Conditions are written against the `risks` subquery alias, because the
  // filters are applied outside the projection.
  const conditions: string[] = ['risks.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filter.search !== undefined) {
    params.push(`%${escapeLikePattern(filter.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(risks.name ILIKE ${placeholder} ESCAPE '\\' OR risks.sku ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filter.categoryId !== undefined) {
    params.push(filter.categoryId);
    conditions.push(`risks.category_id = $${params.length}`);
  }

  if (filter.isActive !== undefined) {
    params.push(filter.isActive);
    conditions.push(`risks.is_active = $${params.length}`);
  }

  // Filters occupy $1..$n, so the window placeholders must be computed from the
  // current parameter count rather than hard-coded.
  const windowStart = `$${params.length + 1}`;
  const windowEnd = `$${params.length + 2}`;
  const windowDays = `$${params.length + 3}`;

  const pageParams = [...params, ...windowBounds(), WINDOW_DAYS, filter.limit, filter.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<StockRiskFactRow>(
    `SELECT * FROM (${riskProjection(windowStart, windowEnd, windowDays)}) risks
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(name) ASC, product_id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return result.rows;
}

/** Facts for a single product, or `null` when it does not exist in this business. */
export async function getStockRiskFacts(
  businessId: string,
  productId: string,
): Promise<StockRiskFactRow | null> {
  const windowStart = '$2';
  const windowEnd = '$3';
  const windowDays = '$4';

  const result = await query<StockRiskFactRow>(
    `SELECT * FROM (${riskProjection(windowStart, windowEnd, windowDays)}) risks
      WHERE risks.business_id = $1 AND risks.product_id = $5`,
    [businessId, ...windowBounds(), WINDOW_DAYS, productId],
  );

  return result.rows[0] ?? null;
}

/**
 * The demand window as `[from, toExclusive]`.
 *
 * UTC calendar days, matching `analytics.service.resolveWindow`, so the two
 * surfaces always describe the same period. Spread at the call site so each date
 * becomes its own bind parameter.
 */
function windowBounds(): [Date, Date] {
  const now = new Date();
  const lastDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [
    new Date(lastDay - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000),
    new Date(lastDay + 24 * 60 * 60 * 1000),
  ];
}

