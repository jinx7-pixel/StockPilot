/**
 * Demand Intelligence service.
 *
 * Its only job is to gather facts and hand them to the pure engine. It contains
 * no formulas: every window, threshold and calculation lives in
 * `intelligence/`, so the rules can be read, reviewed and tested in one place.
 *
 * Read-only. Nothing here writes to sales, inventory or purchase orders — a
 * demand assessment must never change the history it measures.
 */

import { NotFoundError } from '../errors.js';
import { assessDemand, type DemandFacts, type DemandResult } from '../intelligence/index.js';
import {
  currentWindowEndDate,
  getDemandFacts,
  listDemandFacts,
  type DemandFactRow,
} from '../repositories/demand.repository.js';
import type { ListDemandQuery } from './demand.schemas.js';

export interface DemandEntry extends DemandResult {
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
}

export interface DemandPage {
  items: DemandEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Counts per trend for the scoped catalog, so a filter can show a summary. */
  trendCounts: Record<string, number>;
}

/**
 * Zip the two parallel day arrays the repository returns into engine facts.
 *
 * The arrays are built by the same `array_agg ... ORDER BY day`, so index `i`
 * of one always describes the same day as index `i` of the other. A length
 * mismatch would be a repository bug, and is reported rather than half-read.
 */
function toFacts(row: DemandFactRow, windowEndDate: string): DemandFacts {
  const keys = row.day_keys ?? [];
  const units = row.day_units ?? [];

  if (keys.length !== units.length) {
    throw new Error(
      `Demand series for product ${row.product_id} is malformed: ` +
        `${keys.length} day(s) but ${units.length} unit total(s).`,
    );
  }

  return {
    productId: row.product_id,
    windowEndDate,
    days: keys.map((date, index) => ({ date, units: units[index] ?? '0' })),
    observableHistoryDays: String(row.observable_history_days),
  };
}

function toEntry(row: DemandFactRow, result: DemandResult): DemandEntry {
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

/** A guard so a runaway catalog cannot exhaust memory. */
const MAX_DEMAND_PRODUCTS = 10_000;

/**
 * Assess every product for a tenant, with the requested filters.
 *
 * `trend`, `variability` and `confidence` are applied **after** classification
 * rather than in SQL: each is a function of the whole daily series, so
 * filtering in the database would mean reimplementing the engine's rules in a
 * `WHERE` clause — exactly the duplication this architecture exists to prevent.
 */
export async function listDemand(
  businessId: string,
  query: ListDemandQuery,
): Promise<DemandPage> {
  const windowEndDate = currentWindowEndDate();

  // Ask for a large page, classify, then filter and paginate in memory. A
  // tenant's catalog is bounded by the product count, which the database already
  // reads in one pass — this is not a per-row query.
  const rows = await listDemandFacts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: MAX_DEMAND_PRODUCTS,
    offset: 0,
  });

  const details = rows.map((row) => ({
    row,
    result: assessDemand(toFacts(row, windowEndDate)),
  }));

  const trendCounts: Record<string, number> = {};
  for (const { result } of details) {
    trendCounts[result.trend] = (trendCounts[result.trend] ?? 0) + 1;
  }

  const filtered = details.filter(
    ({ result }) =>
      (query.trend === undefined || result.trend === query.trend) &&
      (query.variability === undefined || result.variability === query.variability) &&
      (query.confidence === undefined || result.confidence === query.confidence),
  );

  const start = (query.page - 1) * query.limit;

  return {
    items: filtered.slice(start, start + query.limit).map(({ row, result }) => toEntry(row, result)),
    page: query.page,
    limit: query.limit,
    // The total reflects the filters, so a `?trend=DECREASING` page reports only
    // the products it can page through.
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / query.limit)),
    trendCounts,
  };
}

/** Assess a single product. A product in another business is not found. */
export async function getDemand(businessId: string, productId: string): Promise<DemandEntry> {
  const row = await getDemandFacts(businessId, productId);
  if (!row) throw new NotFoundError('Product not found.');

  return toEntry(row, assessDemand(toFacts(row, currentWindowEndDate())));
}
