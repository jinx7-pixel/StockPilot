/**
 * Intelligence service.
 *
 * Its only job is to gather facts and hand them to the pure engine. It contains
 * no formulas: every threshold and calculation lives in `intelligence/`, so the
 * rules can be read, reviewed and tested in one place.
 *
 * Read-only. Nothing here writes to inventory or creates a purchase order — a
 * risk assessment must never change the state it measures.
 */

import { NotFoundError } from '../errors.js';
import {
  assessStockRisk,
  type StockRiskFacts,
  type StockRiskResult,
} from '../intelligence/index.js';
import {
  getStockRiskFacts,
  listStockRiskFacts,
  type StockRiskFactRow,
} from '../repositories/risk.repository.js';
import type { ListStockRiskQuery } from './intelligence.schemas.js';

export interface StockRiskEntry extends StockRiskResult {
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
}

export interface StockRiskPage {
  items: StockRiskEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Counts per risk level for the page's tenant, so a filter can show a summary. */
  riskCounts: Record<string, number>;
}

/** Map a repository row to the pure engine's input contract. */
function toFacts(row: StockRiskFactRow): StockRiskFacts {
  return {
    productId: row.product_id,
    isActive: row.is_active,
    currentStock: row.current_stock,
    unitsSold: row.units_sold,
    averageDailySales: row.average_daily_sales,
    observableHistoryDays: String(row.observable_history_days),
    activeSalesDays: String(row.active_sales_days),
    leadTimeSamples: row.lead_time_samples ?? [],
  };
}

/**
 * Assess every product for a tenant, with the requested filters.
 *
 * `risk` and `confidence` are applied **after** classification rather than in
 * SQL: the risk level is a function of stock, demand and lead time together, so
 * filtering in the database would mean reimplementing the engine's rules in a
 * `WHERE` clause — exactly the duplication this architecture exists to prevent.
 */
export async function listStockRisk(
  businessId: string,
  query: ListStockRiskQuery,
): Promise<StockRiskPage> {
  // Ask for a large page, classify, then filter and paginate in memory. A tenant's
  // catalog is bounded by the product count, which the database already reads in
  // one pass — this is not a per-row query.
  const rows = await listStockRiskFacts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: MAX_RISK_PRODUCTS,
    offset: 0,
  });

  const details = await Promise.all(
    rows.map(async (row) => ({
      row,
      result: assessStockRisk(toFacts(row)),
    })),
  );

  const riskCounts: Record<string, number> = {};
  for (const { result } of details) {
    riskCounts[result.risk] = (riskCounts[result.risk] ?? 0) + 1;
  }

  const filtered = details.filter(
    ({ result }) =>
      (query.risk === undefined || result.risk === query.risk) &&
      (query.confidence === undefined || result.confidence === query.confidence),
  );

  const start = (query.page - 1) * query.limit;
  const paged = filtered.slice(start, start + query.limit);

  return {
    items: paged.map(({ row, result }) => ({
      ...result,
      sku: row.sku,
      name: row.name,
      category:
        row.category_id && row.category_name
          ? { id: row.category_id, name: row.category_name }
          : null,
      isActive: row.is_active,
    })),
    page: query.page,
    limit: query.limit,
    // The total reflects the filters, so a `?risk=CRITICAL` page reports only
    // the critical products it can page through.
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / query.limit)),
    riskCounts,
  };
}

/** A guard so a runaway catalog cannot exhaust memory. */
const MAX_RISK_PRODUCTS = 10_000;

/** Assess a single product. A product in another business is not found. */
export async function getStockRisk(
  businessId: string,
  productId: string,
): Promise<StockRiskResult> {
  const row = await getStockRiskFacts(businessId, productId);
  if (!row) throw new NotFoundError('Product not found.');

  return assessStockRisk(toFacts(row));
}
