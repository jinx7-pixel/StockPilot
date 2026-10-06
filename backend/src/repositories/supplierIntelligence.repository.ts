/**
 * Supplier fact gathering.
 *
 * The only place SQL touches the supplier engine's inputs. The engine is pure,
 * so replacing PostgreSQL changes this file alone.
 *
 * ## Avoiding double-counting
 *
 * A purchase order has many line items, so joining items straight onto a
 * per-supplier aggregate would multiply every order's unit totals by its item
 * count. Items are therefore summed **per order first**, in their own CTE, and
 * only those per-order totals join to the supplier roll-up. An order with five
 * lines contributes five units once, not five times.
 *
 * ## What counts as what
 *
 * Every figure comes from an explicit status bucket, and a `draft` order is in
 * none of the three that count:
 *
 *  - **completed** — `received`, and the only source of lead-time evidence.
 *  - **open** — `ordered` and `partially_received`: committed but not yet here.
 *  - **cancelled** — `cancelled`, counted as a fact about our order book and
 *    never as a fact about the supplier. A cancellation may equally be our
 *    stockout or a reorder; the number says only that it happened.
 *
 * Lead times need more than a status: `ordered_at` and `received_at` must both
 * be present and in order. Anything else is excluded from the statistics rather
 * than defaulted to zero, which would look like an impossibly fast supplier.
 *
 * No write of any kind: this projection only selects.
 */

import { query } from '../db/pool.js';
import { SUPPLIER_POLICY } from '../intelligence/index.js';
import { escapeLikePattern } from './demandFacts.repository.js';

export interface SupplierFactRow {
  supplier_id: string;
  business_id: string;
  supplier_name: string;
  is_active: boolean;

  completed_po_count: number;
  open_po_count: number;
  cancelled_po_count: number;
  draft_po_count: number;

  total_units_ordered: string;
  total_units_received: string;

  /** Lead time in days per completed order with valid timestamps. Empty, never null. */
  lead_time_days: string[] | null;
}

export interface SupplierLeadTimeRow {
  purchase_order_id: string;
  ordered_at: Date;
  received_at: Date;
  lead_time_days: string;
}

/**
 * Per-order unit totals, summed before any supplier roll-up.
 *
 * This is what keeps a multi-line purchase order from contributing its units
 * once per line.
 */
const PER_ORDER_UNITS = `
  SELECT poi.purchase_order_id,
         SUM(poi.quantity)::numeric           AS units_ordered,
         SUM(poi.received_quantity)::numeric AS units_received
    FROM purchase_order_items poi
   WHERE poi.business_id = $1
   GROUP BY poi.purchase_order_id
`;

/**
 * The shared per-supplier projection.
 *
 * A function because the filter placeholders depend on how many parameters
 * preceded this query.
 */
function supplierProjection(isActivePlaceholder?: string): string {
  const activeClause = isActivePlaceholder === undefined ? '' : ` AND s.is_active = ${isActivePlaceholder}`;

  return `
  SELECT s.id                                   AS supplier_id,
         s.business_id                          AS business_id,
         s.name                                 AS supplier_name,
         s.is_active,
         po.completed::int                       AS completed_po_count,
         po.open::int                            AS open_po_count,
         po.cancelled::int                       AS cancelled_po_count,
         po.drafted::int                         AS draft_po_count,
         to_char(COALESCE(units.ordered_total, 0),   'FM9999999999990.00') AS total_units_ordered,
         to_char(COALESCE(units.received_total, 0), 'FM9999999999990.00') AS total_units_received,
         leads.lead_times                        AS lead_time_days
    FROM suppliers s
    LEFT JOIN LATERAL (
      -- Status buckets, counted from orders only. Drafts get their own column so
      -- a draft is visibly not counted rather than quietly absent.
      SELECT COUNT(*) FILTER (WHERE status = 'received')            AS completed,
             COUNT(*) FILTER (WHERE status IN ('ordered', 'partially_received')) AS open,
             COUNT(*) FILTER (WHERE status = 'cancelled')           AS cancelled,
             COUNT(*) FILTER (WHERE status = 'draft')               AS drafted
        FROM purchase_orders o
       WHERE o.business_id = s.business_id AND o.supplier_id = s.id
    ) po ON true
    LEFT JOIN LATERAL (
      -- Unit totals from the pre-aggregated per-order CTE, so a five-line order
      -- contributes its units once.
      SELECT SUM(u.units_ordered)   AS ordered_total,
             SUM(u.units_received)  AS received_total
        FROM purchase_orders o
        JOIN (${PER_ORDER_UNITS}) u ON u.purchase_order_id = o.id
       WHERE o.business_id = s.business_id AND o.supplier_id = s.id
    ) units ON true
    LEFT JOIN LATERAL (
      -- Lead times, text so the driver hands the engine decimal strings.
      SELECT array_agg(
               ROUND(EXTRACT(EPOCH FROM (o.received_at - o.ordered_at)) / 86400.0, 2)::text
               ORDER BY o.received_at - o.ordered_at
             ) AS lead_times
        FROM purchase_orders o
       WHERE o.business_id = s.business_id
         AND o.supplier_id = s.id
         AND o.status = 'received'
         AND o.ordered_at IS NOT NULL
         AND o.received_at IS NOT NULL
         AND o.received_at >= o.ordered_at
    ) leads ON true
   WHERE s.business_id = $1${activeClause}
`;
}

export interface SupplierFilter {
  search?: string;
  isActive?: boolean;
  limit: number;
  offset: number;
}

/**
 * Escape LIKE wildcards so a search term is always a literal.
 *
 * Imported from the shared demand-facts module rather than copied: two copies of
 * a security-relevant helper can drift, and a fix applied to one would leave the
 * other open to wildcard injection.
 */
export { escapeLikePattern };

export async function listSupplierFacts(
  businessId: string,
  filter: SupplierFilter,
): Promise<SupplierFactRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [businessId];

  if (filter.search !== undefined) {
    const { escapeLikePattern } = await import('./demandFacts.repository.js');
    params.push(`%${escapeLikePattern(filter.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(`s.supplier_name ILIKE ${placeholder} ESCAPE '\\'`);
  }

  if (filter.isActive !== undefined) {
    params.push(filter.isActive);
    conditions.push(`s.is_active = $${params.length}`);
  }

  const where = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';

  const pageParams = [...params, filter.limit, filter.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<SupplierFactRow>(
    `SELECT * FROM (${supplierProjection()}) s
      WHERE true${where}
      ORDER BY lower(supplier_name) ASC, supplier_id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return result.rows;
}

/** Facts for a single supplier, or `null` when it does not exist in this business. */
export async function getSupplierFact(
  businessId: string,
  supplierId: string,
): Promise<SupplierFactRow | null> {
  const result = await query<SupplierFactRow>(
    `SELECT * FROM (${supplierProjection()}) s
      WHERE s.business_id = $1 AND s.supplier_id = $2`,
    [businessId, supplierId],
  );

  return result.rows[0] ?? null;
}

/**
 * The individual completed orders behind a supplier's lead-time figures.
 *
 * Fetched only for the detail view: a list of a hundred suppliers does not need
 * every observation, and returning them all would turn one query into a payload
 * nobody reads.
 */
export async function listSupplierLeadTimes(
  businessId: string,
  supplierId: string,
): Promise<SupplierLeadTimeRow[]> {
  const result = await query<SupplierLeadTimeRow>(
    `SELECT o.id                  AS purchase_order_id,
            o.ordered_at          AS ordered_at,
            o.received_at         AS received_at,
            ROUND(EXTRACT(EPOCH FROM (o.received_at - o.ordered_at)) / 86400.0, 2)::text
                                   AS lead_time_days
       FROM purchase_orders o
      WHERE o.business_id = $1
        AND o.supplier_id = $2
        AND o.status = 'received'
        AND o.ordered_at IS NOT NULL
        AND o.received_at IS NOT NULL
        AND o.received_at >= o.ordered_at
      ORDER BY o.received_at - o.ordered_at ASC
      LIMIT $3`,
    [businessId, supplierId, SUPPLIER_POLICY.maxSuppliers],
  );

  return result.rows;
}