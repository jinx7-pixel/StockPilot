/**
 * Overstock Detection service.
 *
 * Gathers facts, hands them to the pure engine, and does nothing else. It holds
 * no formula: days of cover, the evidence gate, the status and the priority all
 * come from `intelligence/`.
 *
 * ## Where the facts come from
 *
 * This service deliberately has **no repository of its own**. The facts it needs
 * — stock on hand from the ledger, and the 30- and 90-day demand aggregates
 * over the same UTC window the Demand Intelligence Engine uses — are exactly
 * what `demandFacts.repository` already gathers in a single parameterised query. The
 * over-order and lead-time columns come along in that same row at no extra cost,
 * and this module ignores them.
 *
 * Reading them again here would mean a second projection of the same tables: two
 * copies of the window arithmetic that could drift, and two places to fix when
 * the demand definition changes. So the demand-facts query is read from where it
 * already lives, and there is exactly one implementation of it in the codebase.
 *
 * Read-only. Nothing here writes to inventory, sales or purchase orders.
 */

import { NotFoundError } from '../errors.js';
import {
  assessDemandConfidenceFromTotals,
  averageDailyRate,
  DEMAND_POLICY,
  OVERSTOCK_POLICY,
  type OverstockFacts,
  type OverstockResult,
} from '../intelligence/index.js';
import { assessOverstock } from '../intelligence/overstock.js';
import {
  getProductDemandFact,
  listProductDemandFacts,
  type ProductDemandFactRow,
} from '../repositories/demandFacts.repository.js';
import type { ListOverstockQuery } from './overstock.schemas.js';

export interface OverstockEntry extends OverstockResult {
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
}

export interface OverstockPage {
  items: OverstockEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Counts per status for the scoped catalog, so a filter can show a summary. */
  statusCounts: Record<string, number>;
}

/**
 * Run the Overstock Engine on one row.
 *
 * The demand rate and confidence both come from the Demand Engine's own
 * calculations, through the same seams the Reorder Engine uses. Nothing is
 * re-derived here.
 */
function assess(row: ProductDemandFactRow): OverstockResult {
  const observableHistoryDays = String(row.observable_history_days);

  const facts: OverstockFacts = {
    productId: row.product_id,
    isActive: row.is_active,
    currentStock: row.current_stock,
    unitsSold30d: row.units_sold_30d,
    activeSalesDays30d: row.active_sales_days_30d,
    averageDailySales30d: averageDailyRate(row.units_sold_30d, DEMAND_POLICY.baselineDays),
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

  return assessOverstock(facts, { confidence });
}

function toEntry(row: ProductDemandFactRow, result: OverstockResult): OverstockEntry {
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
export async function listOverstock(
  businessId: string,
  query: ListOverstockQuery,
): Promise<OverstockPage> {
  // One wide read, classify, then filter and paginate in memory. Bounded by the
  // policy's product guard so a runaway catalog cannot exhaust memory.
  const rows = await listProductDemandFacts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: OVERSTOCK_POLICY.maxProducts,
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
export async function getOverstock(
  businessId: string,
  productId: string,
): Promise<OverstockEntry> {
  const row = await getProductDemandFact(businessId, productId);
  if (!row) throw new NotFoundError('Product not found.');

  return toEntry(row, assess(row));
}