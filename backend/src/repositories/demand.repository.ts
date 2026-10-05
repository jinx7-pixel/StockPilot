/**
 * Demand fact gathering.
 *
 * The only place SQL touches the demand engine's inputs. The engine itself is
 * pure, so swapping PostgreSQL for a cached read changes this file alone.
 *
 * Two rules are load-bearing:
 *
 *  - **One daily series, not three aggregates.** Window totals are *derived* by
 *    the engine from the same day rows, so a 7-day figure can never disagree
 *    with the same days counted in the 30-day figure.
 *  - **Days are UTC calendar days.** Both the window bounds and the day
 *    truncation are pinned to UTC, so a deployment in another time zone reports
 *    the same numbers rather than shifting a day's sales across a boundary.
 *
 * No write of any kind: the projection selects, and nothing here creates a
 * movement, a sale or a purchase order.
 */

import { query } from '../db/pool.js';
import { utcToday } from '../intelligence/calendar.js';
import { DEMAND_POLICY } from '../intelligence/policies.js';

export interface DemandFactRow {
  product_id: string;
  business_id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;
  observable_history_days: number;
  /** `YYYY-MM-DD` per day that had a sale, ascending. Empty, never null. */
  day_keys: string[] | null;
  /** Units for the matching entry in `day_keys`. */
  day_units: string[] | null;
}

const WINDOW_DAYS = DEMAND_POLICY.longDays;

/**
 * The shared per-product projection.
 *
 * A function rather than a constant because the window placeholder depends on
 * how many filter parameters preceded it in the calling query.
 */
function demandProjection(windowStart: string, windowEnd: string): string {
  return `
  SELECT p.id                                   AS product_id,
         p.business_id                         AS business_id,
         p.sku, p.name, p.category_id, c.name AS category_name,
         p.is_active,
         COALESCE(obs.observable_days, 0)::int AS observable_history_days,
         ser.day_keys                          AS day_keys,
         ser.day_units                         AS day_units
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      -- Days since the product first appeared in the ledger, not since the
      -- product record was created: a long-lived record with one movement
      -- yesterday has a day of evidence, not a year of it.
      SELECT GREATEST(0, EXTRACT(DAY FROM (
               date_trunc('day', now() AT TIME ZONE 'UTC') -
               date_trunc('day', MIN(created_at) AT TIME ZONE 'UTC')
             ))::int) AS observable_days
        FROM inventory_movements im
       WHERE im.business_id = p.business_id AND im.product_id = p.id
    ) obs ON true
    LEFT JOIN LATERAL (
      -- One row per calendar day that had a completed sale of this product.
      -- Days without a sale are simply absent; the engine accounts for them
      -- using the policy window length, so they need not be materialised.
      --
      -- Both aggregate keys are text so the driver hands the engine decimal
      -- strings rather than JavaScript numbers.
      SELECT array_agg(to_char(d.day, 'YYYY-MM-DD') ORDER BY d.day) AS day_keys,
             array_agg(d.units::text               ORDER BY d.day) AS day_units
        FROM (
          SELECT date_trunc('day', s.sold_at AT TIME ZONE 'UTC') AS day,
                 SUM(si.quantity)                              AS units
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
           WHERE s.business_id = p.business_id
             AND s.status = 'completed'
             AND si.product_id = p.id
             AND s.sold_at >= ${windowStart} AND s.sold_at < ${windowEnd}
           GROUP BY 1
        ) d
    ) ser ON true
`;
}

export interface ProductDemandFilter {
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  limit: number;
  offset: number;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** UTC midnight bounds of the last `WINDOW_DAYS` calendar days, end-exclusive. */
function windowBounds(): [Date, Date] {
  const now = new Date();
  const lastDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [
    new Date(lastDay - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000),
    new Date(lastDay + 24 * 60 * 60 * 1000),
  ];
}

export async function listDemandFacts(
  businessId: string,
  filter: ProductDemandFilter,
): Promise<DemandFactRow[]> {
  // Conditions are written against the `demand` subquery alias, because the
  // filters are applied outside the projection.
  const conditions: string[] = ['demand.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filter.search !== undefined) {
    params.push(`%${escapeLikePattern(filter.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(demand.name ILIKE ${placeholder} ESCAPE '\\' OR demand.sku ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filter.categoryId !== undefined) {
    params.push(filter.categoryId);
    conditions.push(`demand.category_id = $${params.length}`);
  }

  if (filter.isActive !== undefined) {
    params.push(filter.isActive);
    conditions.push(`demand.is_active = $${params.length}`);
  }

  // Filters occupy $1..$n, so the window placeholders follow the current count.
  const windowStart = `$${params.length + 1}`;
  const windowEnd = `$${params.length + 2}`;

  const pageParams = [...params, ...windowBounds(), filter.limit, filter.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<DemandFactRow>(
    `SELECT * FROM (${demandProjection(windowStart, windowEnd)}) demand
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(name) ASC, product_id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return result.rows;
}

/** Facts for a single product, or `null` when it does not exist in this business. */
export async function getDemandFacts(
  businessId: string,
  productId: string,
): Promise<DemandFactRow | null> {
  const result = await query<DemandFactRow>(
    `SELECT * FROM (${demandProjection('$2', '$3')} ) demand
      WHERE demand.business_id = $1 AND demand.product_id = $4`,
    [businessId, ...windowBounds(), productId],
  );

  return result.rows[0] ?? null;
}

/** The last calendar day every window ends on, as an engine fact. */
export function currentWindowEndDate(): string {
  return utcToday();
}
