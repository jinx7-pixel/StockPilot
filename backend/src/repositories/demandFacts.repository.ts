/**
 * Product demand facts.
 *
 * The single query that answers "what does this product look like right now":
 * stock on hand, what is already on order, how much it has sold, and how long
 * its suppliers take. Four intelligence engines — Reorder, Overstock and
 * Slow/Dead, plus any future one — read the same facts from here, so the window
 * arithmetic and the ledger expression exist once and cannot drift apart.
 *
 * This file began life as `reorder.repository.ts`, when Reorder was the only
 * consumer and the name described its purpose. By the fourth consumer the name
 * described only the first of them, which is how shared code ends up looking
 * like private code. The query itself is unchanged: it moved verbatim.
 *
 * Each source is deliberately narrow:
 *
 *  - **Stock on hand** comes from the append-only inventory ledger via the
 *    shared `BALANCE_EXPRESSION_PLAIN`, the same one the Stock Risk Engine reads.
 *    There is no stored stock column to drift out of step with it.
 *  - **On order** counts only purchase orders in `ordered` or
 *    `partially_received` state. A draft is not a commitment, a received order
 *    is already in the ledger, and a cancelled order never will be.
 *  - **Demand** uses the same UTC 30-day window as the Demand Intelligence
 *    Engine, so a rate and the evidence beside it can never describe different
 *    periods. The 90-day totals exist so the confidence ladder can see how much
 *    history backs that rate.
 *  - **Lead time** comes only from fully received orders carrying both
 *    timestamps, and is returned as text so the driver hands the engines decimal
 *    strings rather than numbers.
 *
 * No write of any kind: this projection only selects.
 */

import { query } from '../db/pool.js';
import { utcToday } from '../intelligence/calendar.js';
import { DEMAND_POLICY, REORDER_POLICY } from '../intelligence/index.js';
import { BALANCE_EXPRESSION_PLAIN } from './inventory.repository.js';

/** The demand window must be the Demand Engine's, not a second opinion on it. */
const DEMAND_WINDOW_DAYS = DEMAND_POLICY.baselineDays;

export interface ProductDemandFactRow {
  product_id: string;
  business_id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;

  /** Sum of the inventory ledger. May be negative if the ledger is corrupt. */
  current_stock: string;
  /** Ordered but not yet received. */
  on_order_quantity: string;

  units_sold_30d: string;
  active_sales_days_30d: number;
  units_sold_90d: string;
  active_sales_days_90d: number;
  observable_history_days: number;

  /** Lead time in days per completed order. Empty, never null. */
  lead_time_samples: string[] | null;
}

/** UTC midnight bounds of the 30-day demand window, end-exclusive. */
function demandWindowBounds(): [Date, Date] {
  const now = new Date();
  const lastDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [
    new Date(lastDay - (DEMAND_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000),
    new Date(lastDay + 24 * 60 * 60 * 1000),
  ];
}

/**
 * The shared per-product projection.
 *
 * A function because the window placeholders depend on how many filter
 * parameters preceded this query.
 */
function demandFactsProjection(windowStart: string, windowEnd: string): string {
  return `
  SELECT p.id                                         AS product_id,
         p.business_id                               AS business_id,
         p.sku, p.name, p.category_id, c.name       AS category_name,
         p.is_active,
         stock.current_stock                         AS current_stock,
         to_char(COALESCE(onorder.quantity, 0), 'FM9999999999990.00') AS on_order_quantity,
         to_char(COALESCE(sales.units_sold, 0), 'FM9999999999990.00') AS units_sold_30d,
         COALESCE(sales.active_days, 0)::int         AS active_sales_days_30d,
         to_char(COALESCE(wide.units_sold, 0), 'FM9999999999990.00')  AS units_sold_90d,
         COALESCE(wide.active_days, 0)::int          AS active_sales_days_90d,
         COALESCE(obs.observable_days, 0)::int       AS observable_history_days,
         lead.samples                                AS lead_time_samples
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      -- Stock on hand straight from the append-only ledger. No stored column,
      -- so this cannot silently disagree with the Stock Risk Engine.
      SELECT to_char(COALESCE(SUM(${BALANCE_EXPRESSION_PLAIN}), 0), 'FM9999999999990.00')
               AS current_stock
        FROM inventory_movements im
       WHERE im.business_id = p.business_id AND im.product_id = p.id
    ) stock ON true
    LEFT JOIN LATERAL (
      -- Outstanding on ordered and partially received orders only. GREATEST
      -- guards a line whose received quantity was corrected above its order
      -- quantity, which would otherwise make net available look *smaller* than
      -- physical stock and provoke a pointless reorder.
      SELECT SUM(GREATEST(poi.quantity - poi.received_quantity, 0)) AS quantity
        FROM purchase_order_items poi
        JOIN purchase_orders po
          ON po.id = poi.purchase_order_id AND po.business_id = poi.business_id
       WHERE poi.business_id = p.business_id
         AND poi.product_id = p.id
         AND po.status IN ('ordered', 'partially_received')
    ) onorder ON true
    LEFT JOIN LATERAL (
      -- Same UTC 30-day window the Demand Engine used, so the rate and the
      -- evidence beside it always describe the same period.
      SELECT ROUND(COALESCE(SUM(si.quantity), 0), 2)     AS units_sold,
             COUNT(DISTINCT date_trunc('day', s.sold_at AT TIME ZONE 'UTC')) AS active_days
        FROM sales s
        JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
       WHERE s.business_id = p.business_id
         AND s.status = 'completed'
         AND si.product_id = p.id
         AND s.sold_at >= ${windowStart} AND s.sold_at < ${windowEnd}
    ) sales ON true
    LEFT JOIN LATERAL (
      -- The 90-day totals, needed only for the Demand Engine's confidence
      -- ladder. The reorder point itself is sized from the 30-day rate; the
      -- wider window exists so confidence reflects how much history backs that
      -- rate, which is the same ladder the Demand Engine applies.
      SELECT ROUND(COALESCE(SUM(si.quantity), 0), 2)     AS units_sold,
             COUNT(DISTINCT date_trunc('day', s.sold_at AT TIME ZONE 'UTC')) AS active_days
        FROM sales s
        JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
       WHERE s.business_id = p.business_id
         AND s.status = 'completed'
         AND si.product_id = p.id
         AND s.sold_at >= (${windowEnd}::timestamptz - interval '89 days')
         AND s.sold_at < ${windowEnd}
    ) wide ON true
    LEFT JOIN LATERAL (
      SELECT GREATEST(0, EXTRACT(DAY FROM (
               date_trunc('day', now() AT TIME ZONE 'UTC') -
               date_trunc('day', MIN(created_at) AT TIME ZONE 'UTC')
             ))::int) AS observable_days
        FROM inventory_movements im
       WHERE im.business_id = p.business_id AND im.product_id = p.id
    ) obs ON true
    LEFT JOIN LATERAL (
      -- Fully received orders only, with both timestamps present. Drafts,
      -- in-flight orders, cancellations and timestamp gaps are all excluded.
      -- The ::text cast is load-bearing: the driver parses a numeric array into
      -- JavaScript numbers, and the engines take decimal strings.
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
    ) lead ON true
`;
}

export interface ProductDemandFilter {
  search?: string;
  categoryId?: string;
  /** Inactive products are excluded unless a caller explicitly asks for them. */
  isActive?: boolean;
  limit: number;
  offset: number;
}

/**
 * Escape LIKE wildcards so a search term is always a literal.
 *
 * Shared because it is security-relevant: two copies of this helper can drift,
 * and a fix applied to one would leave the other open to wildcard injection.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listProductDemandFacts(
  businessId: string,
  filter: ProductDemandFilter,
): Promise<ProductDemandFactRow[]> {
  const conditions: string[] = ['r.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filter.search !== undefined) {
    params.push(`%${escapeLikePattern(filter.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(r.name ILIKE ${placeholder} ESCAPE '\\' OR r.sku ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filter.categoryId !== undefined) {
    params.push(filter.categoryId);
    conditions.push(`r.category_id = $${params.length}`);
  }

  if (filter.isActive !== undefined) {
    params.push(filter.isActive);
    conditions.push(`r.is_active = $${params.length}`);
  }

  const windowStart = `$${params.length + 1}`;
  const windowEnd = `$${params.length + 2}`;

  const pageParams = [...params, ...demandWindowBounds(), filter.limit, filter.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<ProductDemandFactRow>(
    `SELECT * FROM (${demandFactsProjection(windowStart, windowEnd)}) r
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(name) ASC, product_id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return result.rows;
}

/**
 * How many products match the same filters, ignoring pagination.
 *
 * Exists so the unified list can report a real `total` rather than the number
 * of rows on the current page, which would report 25 for a catalog of 4,000 and
 * make the last page look like the only one.
 *
 * Reuses the projection's filters verbatim so the count cannot disagree with the
 * rows it is counting.
 */
export async function countProductDemandFacts(
  businessId: string,
  filter: Omit<ProductDemandFilter, 'limit' | 'offset'>,
): Promise<number> {
  const conditions: string[] = ['p.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filter.search !== undefined) {
    params.push(`%${escapeLikePattern(filter.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(p.name ILIKE ${placeholder} ESCAPE '\\' OR p.sku ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filter.categoryId !== undefined) {
    params.push(filter.categoryId);
    conditions.push(`p.category_id = $${params.length}`);
  }

  if (filter.isActive !== undefined) {
    params.push(filter.isActive);
    conditions.push(`p.is_active = $${params.length}`);
  }

  // Counts rows, so it needs only the selection — none of the projection's
  // window, lead-time or observable-history columns affect how many products
  // match, and reusing the projection would force timestamp parameters onto
  // placeholders that are compared against the ledger.
  const result = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM products p
      WHERE ${conditions.join(' AND ')}`,
    params,
  );

  return Number(result.rows[0]?.total ?? '0');
}

/** Facts for a single product, or `null` when it does not exist in this business. */
export async function getProductDemandFact(
  businessId: string,
  productId: string,
): Promise<ProductDemandFactRow | null> {
  const result = await query<ProductDemandFactRow>(
    `SELECT * FROM (${demandFactsProjection('$2', '$3')} ) r
      WHERE r.business_id = $1 AND r.product_id = $4`,
    [businessId, ...demandWindowBounds(), productId],
  );

  return result.rows[0] ?? null;
}

/** The last calendar day the demand window ends on, as an engine fact. */
export function currentWindowEndDate(): string {
  return utcToday();
}

/** Guard so a runaway catalog cannot exhaust memory. */
export const MAX_PRODUCT_DEMAND_FACTS = REORDER_POLICY.maxProducts;