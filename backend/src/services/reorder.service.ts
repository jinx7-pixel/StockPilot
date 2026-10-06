/**
 * Reorder Engine service.
 *
 * Gathers facts, hands them to the pure engine, and does nothing else. It holds
 * no formula: safety stock, the reorder point, the decision and the recommended
 * quantity all come from `intelligence/`, so the rules stay in one readable
 * place and this layer stays a translation.
 *
 * The demand rate and its confidence are produced by the Demand Intelligence
 * Engine's own calculations, called through the shared seams in
 * `intelligence/`. Nothing is re-derived here, so the rate used to size the
 * buffer and the evidence reported beside it can never disagree.
 *
 * Read-only. Nothing here writes to inventory or purchase orders, and there is
 * no route that can ask it to.
 */

import { NotFoundError } from '../errors.js';
import {
  assessDemandConfidenceFromTotals,
  assessReorder,
  averageDailyRate,
  DEMAND_POLICY,
  type ReorderFacts,
  type ReorderResult,
} from '../intelligence/index.js';
import {
  getReorderFacts,
  listReorderFacts,
  MAX_REORDER_PRODUCTS,
  type ReorderFactRow,
} from '../repositories/reorder.repository.js';
import type { ListReorderQuery } from './reorder.schemas.js';

export interface ReorderEntry extends ReorderResult {
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
}

export interface ReorderPage {
  items: ReorderEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Counts per decision for the scoped catalog, so a filter can show a summary. */
  decisionCounts: Record<string, number>;
}

/**
 * Run the Reorder Engine on one row.
 *
 * The projection deliberately carries window aggregates rather than ninety daily
 * rows per product: the reorder decision needs a rate and a confidence, not a
 * trend or a coefficient of variation, and the daily series would cost an order
 * of magnitude more memory for figures nothing here reads.
 */
function assess(row: ReorderFactRow): ReorderResult {
  const observableHistoryDays = String(row.observable_history_days);

  // The Demand Engine's own rate, and the Demand Engine's own confidence ladder.
  const averageDailySales30d = averageDailyRate(
    row.units_sold_30d,
    DEMAND_POLICY.baselineDays,
  );

  const demandConfidence = assessDemandConfidenceFromTotals({
    observableHistoryDays,
    activeDays30: row.active_sales_days_30d,
    activeDays90: row.active_sales_days_90d,
    unitsSold30: row.units_sold_30d,
    longWindowDays: DEMAND_POLICY.longDays,
  });

  const facts: ReorderFacts = {
    productId: row.product_id,
    isActive: row.is_active,
    currentStock: row.current_stock,
    onOrderQuantity: row.on_order_quantity,
    unitsSold30d: row.units_sold_30d,
    activeSalesDays30d: row.active_sales_days_30d,
    averageDailySales30d,
    observableHistoryDays,
    leadTimeSamples: row.lead_time_samples ?? [],
  };

  return assessReorder(facts, { demandConfidence });
}

function toEntry(row: ReorderFactRow, result: ReorderResult): ReorderEntry {
  return {
    ...result,
    sku: row.sku,
    name: row.name,
    category:
      row.category_id && row.category_name
        ? { id: row.category_id, name: row.category_name }
        : null,
    isActive: row.is_active,
  };
}

/**
 * Assess every product for a tenant, with the requested filters.
 *
 * `decision` and `confidence` are applied **after** classification rather than in
 * SQL: each is a function of the whole fact set, so filtering in the database
 * would mean reimplementing the engine's rules in a `WHERE` clause.
 */
export async function listReorder(
  businessId: string,
  query: ListReorderQuery,
): Promise<ReorderPage> {
  // One wide read, classify, then filter and paginate in memory. Bounded by the
  // product count, which the database already reads in a single pass.
  const rows = await listReorderFacts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: MAX_REORDER_PRODUCTS,
    offset: 0,
  });

  const details = rows.map((row) => ({ row, result: assess(row) }));

  const decisionCounts: Record<string, number> = {};
  for (const { result } of details) {
    decisionCounts[result.decision] = (decisionCounts[result.decision] ?? 0) + 1;
  }

  const filtered = details.filter(
    ({ result }) =>
      (query.decision === undefined || result.decision === query.decision) &&
      (query.confidence === undefined || result.confidence === query.confidence),
  );

  const start = (query.page - 1) * query.limit;

  return {
    items: filtered
      .slice(start, start + query.limit)
      .map(({ row, result }) => toEntry(row, result)),
    page: query.page,
    limit: query.limit,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / query.limit)),
    decisionCounts,
  };
}

/** Assess a single product. A product in another business is not found. */
export async function getReorder(businessId: string, productId: string): Promise<ReorderEntry> {
  const row = await getReorderFacts(businessId, productId);
  if (!row) throw new NotFoundError('Product not found.');

  return toEntry(row, assess(row));
}
