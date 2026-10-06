/**
 * Slow / Dead Stock Detection service.
 *
 * Gathers facts, hands them to the pure engine, and does nothing else. It holds
 * no formula: the classification order, the thresholds, the status and the
 * priority all come from `intelligence/`.
 *
 * ## Where the facts come from
 *
 * This service deliberately has **no repository of its own**. The facts it needs
 * — stock on hand from the ledger, the 90-day unit and active-day aggregates
 * over the same UTC window the Demand Intelligence Engine uses, and observable
 * history — are exactly what `demandFacts.repository` already gathers in a single
 * parameterised query. The on-order and lead-time columns arrive in that same
 * row at no extra cost and this module ignores them.
 *
 * That query is named for what it returns, not for the first feature that needed
 * it, and several modules now read it.
 * A second projection would mean two copies of the window arithmetic that could
 * drift apart, so the single implementation wins and the naming debt is recorded
 * here and in the Overstock service rather than paid for with an unrelated
 * refactor of approved code.
 *
 * Read-only. Nothing here writes to inventory, sales or purchase orders.
 */

import { NotFoundError } from '../errors.js';
import {
  assessDemandConfidenceFromTotals,
  averageDailyRate,
  DEMAND_POLICY,
  SLOW_DEAD_POLICY,
  type SlowDeadFacts,
  type SlowDeadResult,
} from '../intelligence/index.js';
import { assessSlowDead } from '../intelligence/slowDead.js';
import {
  getProductDemandFact,
  listProductDemandFacts,
  type ProductDemandFactRow,
} from '../repositories/demandFacts.repository.js';
import type { ListSlowDeadQuery } from './slowDead.schemas.js';

export interface SlowDeadEntry extends SlowDeadResult {
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
}

export interface SlowDeadPage {
  items: SlowDeadEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Counts per status for the scoped catalog, so a filter can show a summary. */
  statusCounts: Record<string, number>;
}

/**
 * Run the Slow/Dead Engine on one row.
 *
 * The 90-day rate and confidence both come from the Demand Engine's own
 * calculations, through the same seams the Reorder and Overstock engines use.
 * Nothing is re-derived here.
 */
function assess(row: ProductDemandFactRow): SlowDeadResult {
  const observableHistoryDays = String(row.observable_history_days);

  const facts: SlowDeadFacts = {
    productId: row.product_id,
    isActive: row.is_active,
    currentStock: row.current_stock,
    unitsSold90d: row.units_sold_90d,
    activeSalesDays90d: row.active_sales_days_90d,
    averageDailySales90d: averageDailyRate(row.units_sold_90d, DEMAND_POLICY.longDays),
    observableHistoryDays,
  };

  const confidence = assessDemandConfidenceFromTotals({
    observableHistoryDays,
    activeDays30: row.active_sales_days_30d,
    activeDays90: row.active_sales_days_90d,
    unitsSold30: row.units_sold_30d,
    longWindowDays: DEMAND_POLICY.longDays,
  });

  return assessSlowDead(facts, { confidence });
}

function toEntry(row: ProductDemandFactRow, result: SlowDeadResult): SlowDeadEntry {
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
 * `status` and `confidence` are applied **after** classification rather than in
 * SQL: each is a function of the whole fact set, so filtering in the database
 * would mean reimplementing the engine's rules in a `WHERE` clause.
 */
export async function listSlowDead(
  businessId: string,
  query: ListSlowDeadQuery,
): Promise<SlowDeadPage> {
  // One wide read, classify, then filter and paginate in memory. Bounded by the
  // policy's product guard so a runaway catalog cannot exhaust memory.
  const rows = await listProductDemandFacts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: SLOW_DEAD_POLICY.maxProducts,
    offset: 0,
  });

  const details = rows.map((row) => ({ row, result: assess(row) }));

  const statusCounts: Record<string, number> = {};
  for (const { result } of details) {
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
  }

  const filtered = details.filter(
    ({ result }) =>
      (query.status === undefined || result.status === query.status) &&
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
    statusCounts,
  };
}

/** Assess a single product. A product in another business is not found. */
export async function getSlowDead(
  businessId: string,
  productId: string,
): Promise<SlowDeadEntry> {
  const row = await getProductDemandFact(businessId, productId);
  if (!row) throw new NotFoundError('Product not found.');

  return toEntry(row, assess(row));
}