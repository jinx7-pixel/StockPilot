/**
 * Unified Intelligence service — orchestration only.
 *
 * Assembles the six existing engines into one product snapshot. It computes no
 * intelligence of its own: every figure below came from the engine that owns
 * it, and this file's only job is to fetch each engine's facts, call that
 * engine, and hand the results to `assembleUnifiedProduct`.
 *
 * ## Query budget
 *
 * The list is the interesting case. Calling six services would fetch six
 * *different* pages — Reorder alone defaults to active-only — so the row sets
 * would not line up. Instead each engine's repository is fetched once with
 * identical filters and the rows are joined on product id:
 *
 *   1. `demandFacts`           → Reorder + Overstock + Slow/Dead (3 engines, 1 query)
 *   2. `risk`                  → Stock Risk
 *   3. `demand`                → Demand
 *   4. `countProductDemandFacts` → the real row total for pagination
 *   5. `primarySupplierFacts`  → the product's primary supplier
 *
 * Five queries for a page of up to 25, **independent of how many products are
 * shown**. No N+1, and no formula copied to achieve it.
 *
 * Each engine deliberately reads **its own** repository row rather than a shared
 * one. The projections are not interchangeable: Stock Risk counts active sales
 * days with a session-timezone `date_trunc` while Demand and Reorder use UTC, so
 * feeding Stock Risk a different row would silently change its numbers. Reading
 * each from its own source is what makes the unified view identical to the six
 * direct endpoints.
 */

import { NotFoundError } from '../errors.js';
import {
  assembleUnifiedProduct,
  assessDemand,
  assessDemandConfidenceFromTotals,
  assessOverstock,
  assessReorder,
  assessSlowDead,
  assessStockRisk,
  assessSupplier,
  averageDailyRate,
  DEMAND_POLICY,
  type UnifiedDemand,
  type UnifiedOverstock,
  type UnifiedProductIntelligence,
  type UnifiedReorder,
  type UnifiedSlowDead,
  type UnifiedStockRisk,
  type UnifiedSupplier,
} from '../intelligence/index.js';
import { getDemandFacts, listDemandFacts } from '../repositories/demand.repository.js';
import {
  countProductDemandFacts,
  currentWindowEndDate,
  getProductDemandFact,
  listProductDemandFacts,
  type ProductDemandFactRow,
} from '../repositories/demandFacts.repository.js';
import {
  getStockRiskFacts,
  listStockRiskFacts,
  type StockRiskFactRow,
} from '../repositories/risk.repository.js';
import {
  listPrimarySupplierFacts,
  type SupplierFactRow,
} from '../repositories/supplierIntelligence.repository.js';
import type { ListUnifiedIntelligenceQuery } from './unified.schemas.js';

/** The shape the Demand repository returns, as far as this file cares. */
type DemandFactRow = {
  product_id: string;
  observable_history_days: number;
  day_keys: string[] | null;
  day_units: string[] | null;
};

// ---------------------------------------------------------------------------
// Fact adapters — pure mapping from a repository row to that engine's facts.
// Every field is read straight off the row; no formula is repeated here.
// ---------------------------------------------------------------------------

function stockRiskFactsFrom(row: StockRiskFactRow) {
  return {
    productId: row.product_id,
    currentStock: row.current_stock,
    unitsSold: row.units_sold,
    // The risk projection already carries the rate it published; read it rather
    // than recomputing it, so this cannot drift from the direct endpoint.
    averageDailySales: row.average_daily_sales,
    observableHistoryDays: String(row.observable_history_days),
    activeSalesDays: String(row.active_sales_days),
    leadTimeSamples: row.lead_time_samples ?? [],
    isActive: row.is_active,
  };
}

/** The daily series the Demand Engine expects, rebuilt from its own row. */
function demandFactsFrom(row: DemandFactRow, windowEndDate: string) {
  const keys = row.day_keys ?? [];
  const units = row.day_units ?? [];
  return {
    productId: row.product_id,
    windowEndDate,
    days: keys.map((date, index) => ({ date, units: units[index] ?? '0' })),
    observableHistoryDays: String(row.observable_history_days),
  };
}

/** Facts the three shared-row engines all read. */
function sharedFactsFrom(row: ProductDemandFactRow) {
  return {
    productId: row.product_id,
    isActive: row.is_active,
    currentStock: row.current_stock,
    onOrderQuantity: row.on_order_quantity,
    unitsSold30d: row.units_sold_30d,
    activeSalesDays30d: row.active_sales_days_30d,
    averageDailySales30d: averageDailyRate(row.units_sold_30d, DEMAND_POLICY.baselineDays),
    observableHistoryDays: String(row.observable_history_days),
    leadTimeSamples: row.lead_time_samples ?? [],
  };
}

function identityFrom(row: {
  product_id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;
}) {
  return {
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    category:
      row.category_id !== null && row.category_name !== null
        ? { id: row.category_id, name: row.category_name }
        : null,
    isActive: row.is_active,
  };
}

/** The Demand Engine's own confidence ladder, applied to the same row. */
function demandConfidenceFrom(row: {
  observable_history_days: number;
  active_sales_days_30d: number;
  active_sales_days_90d: number;
  units_sold_30d: string;
}) {
  return assessDemandConfidenceFromTotals({
    observableHistoryDays: String(row.observable_history_days),
    activeDays30: row.active_sales_days_30d,
    activeDays90: row.active_sales_days_90d,
    unitsSold30: row.units_sold_30d,
    longWindowDays: DEMAND_POLICY.longDays,
  });
}

function supplierResultFrom(row: SupplierFactRow): UnifiedSupplier {
  return {
    ...assessSupplier({
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      isActive: row.is_active,
      completedPOCount: row.completed_po_count,
      openPOCount: row.open_po_count,
      cancelledPOCount: row.cancelled_po_count,
      draftPOCount: row.draft_po_count,
      totalUnitsOrdered: row.total_units_ordered,
      totalUnitsReceived: row.total_units_received,
      leadTimeDays: row.lead_time_days ?? [],
    }),
    // Observations are the detail view's job; a 25-row list does not need them.
    leadTimeObservations: [],
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildUnified(rows: {
  shared: ProductDemandFactRow;
  risk: StockRiskFactRow | undefined;
  demand: DemandFactRow | undefined;
  supplier: SupplierFactRow | undefined;
  windowEndDate: string;
}): UnifiedProductIntelligence {
  const identity = identityFrom(rows.shared);
  const shared = sharedFactsFrom(rows.shared);
  const confidence = demandConfidenceFrom(rows.shared);
  const averageDailySales90d = averageDailyRate(rows.shared.units_sold_90d, DEMAND_POLICY.longDays);
  const observableHistoryDays = shared.observableHistoryDays;

  const stockRisk: UnifiedStockRisk = {
    ...assessStockRisk(
      // Defensive only: both repositories ran with identical filters, so a
      // missing row cannot normally happen. Map the shared row explicitly
      // rather than casting it, so the fallback cannot smuggle in a field the
      // Stock Risk projection never had.
      rows.risk === undefined
        ? stockRiskFactsFrom({
            product_id: rows.shared.product_id,
            current_stock: rows.shared.current_stock,
            units_sold: rows.shared.units_sold_30d,
            average_daily_sales: averageDailyRate(
              rows.shared.units_sold_30d,
              DEMAND_POLICY.baselineDays,
            ),
            observable_history_days: rows.shared.observable_history_days,
            active_sales_days: rows.shared.active_sales_days_30d,
            lead_time_samples: rows.shared.lead_time_samples,
          } as StockRiskFactRow)
        : stockRiskFactsFrom(rows.risk),
    ),
  };

  const demand: UnifiedDemand = {
    ...identity,
    ...assessDemand(
      demandFactsFrom(
        rows.demand ?? {
          product_id: rows.shared.product_id,
          observable_history_days: rows.shared.observable_history_days,
          day_keys: [],
          day_units: [],
        },
        rows.windowEndDate,
      ),
    ),
  };

  const reorder: UnifiedReorder = {
    ...identity,
    ...assessReorder(shared, { demandConfidence: confidence }),
  };

  const overstock: UnifiedOverstock = {
    ...identity,
    ...assessOverstock(
      {
        ...identity,
        currentStock: shared.currentStock,
        averageDailySales30d: shared.averageDailySales30d,
        unitsSold30d: shared.unitsSold30d,
        activeSalesDays30d: shared.activeSalesDays30d,
        unitsSold90d: rows.shared.units_sold_90d,
        activeSalesDays90d: rows.shared.active_sales_days_90d,
        averageDailySales90d,
        observableHistoryDays,
      },
      { confidence },
    ),
  };

  const slowDead: UnifiedSlowDead = {
    ...identity,
    ...assessSlowDead(
      {
        ...identity,
        currentStock: shared.currentStock,
        unitsSold90d: rows.shared.units_sold_90d,
        activeSalesDays90d: rows.shared.active_sales_days_90d,
        averageDailySales90d,
        observableHistoryDays,
      },
      { confidence },
    ),
  };

  const supplier: UnifiedSupplier | null =
    rows.supplier === undefined ? null : supplierResultFrom(rows.supplier);

  return assembleUnifiedProduct({
    product: {
      id: identity.productId,
      sku: identity.sku,
      name: identity.name,
      category: identity.category,
    },
    stockRisk,
    demand,
    reorder,
    overstock,
    slowDead,
    supplier,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UnifiedIntelligencePage {
  items: UnifiedProductIntelligence[];
  pagination: { page: number; limit: number; total: number };
}

/** One page of products, each carrying all six engine results. */
export async function listUnifiedIntelligence(
  businessId: string,
  query: ListUnifiedIntelligenceQuery,
): Promise<UnifiedIntelligencePage> {
  const windowEndDate = currentWindowEndDate();

  const base = {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
  const offset = (query.page - 1) * query.limit;

  const [sharedRows, riskRows, demandRows, total] = await Promise.all([
    listProductDemandFacts(businessId, {
      ...base,
      limit: query.limit,
      offset,
    }),
    listStockRiskFacts(businessId, { ...base, limit: query.limit, offset }),
    listDemandFacts(businessId, { ...base, limit: query.limit, offset }),
    countProductDemandFacts(businessId, base),
  ]);

  const suppliersByProduct = new Map(
    (
      await listPrimarySupplierFacts(
        businessId,
        sharedRows.map((row) => row.product_id),
      )
    ).map((row) => [row.product_id, row]),
  );
  const riskByProduct = new Map(riskRows.map((row) => [row.product_id, row]));
  const demandByProduct = new Map(demandRows.map((row) => [row.product_id, row]));

  const items = sharedRows.map((row) =>
    buildUnified({
      shared: row,
      risk: riskByProduct.get(row.product_id),
      demand: demandByProduct.get(row.product_id),
      supplier: suppliersByProduct.get(row.product_id),
      windowEndDate,
    }),
  );

  return { items, pagination: { page: query.page, limit: query.limit, total } };
}

/**
 * One product with all six engine results.
 *
 * Reads each engine's own repository and calls that engine, so the unified
 * detail response is identical to the six direct endpoints by construction —
 * which the cross-module tests then assert field by field.
 */
export async function getUnifiedIntelligence(
  businessId: string,
  productId: string,
): Promise<UnifiedProductIntelligence> {
  const windowEndDate = currentWindowEndDate();

  const [shared, risk, demand] = await Promise.all([
    getProductDemandFact(businessId, productId),
    getStockRiskFacts(businessId, productId),
    getDemandFacts(businessId, productId),
  ]);

  // 404 before the supplier lookup, so a cross-tenant id cannot be probed.
  if (shared === null) throw new NotFoundError('Product not found.');

  const suppliers = await listPrimarySupplierFacts(businessId, [productId]);

  return buildUnified({
    shared,
    risk: risk ?? undefined,
    demand: demand ?? undefined,
    supplier: suppliers[0],
    windowEndDate,
  });
}