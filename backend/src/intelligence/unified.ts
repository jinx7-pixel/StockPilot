/**
 * Unified Intelligence Engine — orchestration.
 *
 * This module **decides nothing**. It assembles the six existing engines'
 * results into one product snapshot and derives a three-field summary from
 * values those engines already produced. It computes no risk, no demand, no
 * reorder quantity, no overstock, no slow/dead status and no supplier
 * stability, and it defines no confidence ladder of its own.
 *
 * Every figure a reader sees inside `stockRisk`, `demand`, `reorder`,
 * `overstock`, `slowDead` or `supplier` came out of the engine that owns it,
 * envelope included. If this file ever disagrees with an engine, the engine is
 * right — which is why the tests compare the unified response against the six
 * direct endpoints field by field rather than against their own output.
 *
 * Pure: no SQL, no I/O, no clock.
 */

import type {
  DemandResult,
  OverstockResult,
  ReorderResult,
  RiskLevel,
  SlowDeadResult,
  StockRiskResult,
  SupplierLeadTimeObservation,
  SupplierResult,
  SupplierStability,
} from './types.js';

/** Identity fields every product-scoped engine result carries alongside its own. */
export interface ProductIdentity {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;
}

/**
 * Each block is that engine's **own detail response**, byte for byte.
 *
 * The approved detail endpoints are not uniform, and this type does not paper
 * over that: `GET /stock-risk/:id` returns the bare result while the other four
 * wrap theirs in an entry carrying sku, name, category and isActive. Mirroring
 * each one exactly is what lets a test compare the unified response against the
 * direct endpoints field by field and prove nothing was recalculated.
 *
 * Identity is also stated once at the top, under `product`, as the contract
 * requires; repeating it inside a block is not information, it is noise.
 */
export type UnifiedStockRisk = StockRiskResult;
export type UnifiedDemand = DemandResult & ProductIdentity;
export type UnifiedReorder = ReorderResult & ProductIdentity;
export type UnifiedOverstock = OverstockResult & ProductIdentity;
export type UnifiedSlowDead = SlowDeadResult & ProductIdentity;

/**
 * Supplier-scoped, so it carries the supplier's identity rather than the
 * product's.
 *
 * `leadTimeObservations` is present exactly as the Supplier Engine returns it.
 * The unified *list* leaves it empty; the unified detail fills it in, so the
 * block is the complete existing result either way.
 *
 * **Which supplier this is, when a product has several** — the rule is fixed
 * and deliberately not a judgement call:
 *
 *   1. the supplier with the most completed (`received`) orders for this
 *      product;
   *   2. tied on that, the one with the most recent **non-cancelled** order —
   *      a cancellation is the absence of a delivery, so it must not decide
   *      which supplier counts as current;
   *   3. tied on both, the lowest `supplier_id`, so the answer is stable rather
   *      than dependent on row order.
   *
   * A supplier that has never delivered is still returned when it is the only
   * candidate, carrying `INSUFFICIENT` confidence and null lead-time metrics. The
   * block is `null` only when the product has no purchase-order relationship at
   * all.
   */
export type UnifiedSupplier = SupplierResult & {
  leadTimeObservations?: SupplierLeadTimeObservation[];
};

/**
 * Decisions that call for a human to look. Anything not listed here is
 * neutral: either the engine found nothing wrong, or it could not judge.
 */
const ACTIONABLE_RISK: readonly RiskLevel[] = ['OUT_OF_STOCK', 'CRITICAL', 'LOW', 'OVERSTOCK'];
const ACTIONABLE_TREND = ['INCREASING', 'DECREASING'] as const;
const ACTIONABLE_REORDER = ['REORDER', 'DATA_ERROR'] as const;
const ACTIONABLE_OVERSTOCK = ['OVERSTOCK'] as const;
const ACTIONABLE_SLOW_DEAD = ['DEAD', 'SLOW'] as const;
const ACTIONABLE_STABILITY: readonly SupplierStability[] = ['VARIABLE'];

/**
 * Three fields, derived only from what the engines already reported.
 *
 * Deliberately not a score. There is no overall health number because a single
 * number across six independent verdicts hides exactly the thing a reader needs
 * to see: which module is unhappy, and by how much.
 */
export interface UnifiedSummary {
  /**
   * True when at least one engine produced an actionable decision.
   *
   * "Insufficient data" does **not** count. It records that an engine could
   * not judge the product, not that the product is in trouble; treating it as
   * actionable would make every unmeasured product look urgent.
   */
  attentionRequired: boolean;
  /**
   * The highest priority any engine already produced.
   *
   * Demand and Reorder contribute nothing here: their approved contracts define
   * no priority, and inventing one for them would be a new scale, which this
   * module is forbidden from creating. Their decisions still count toward
   * `decisionCount`, so a reorder need is never invisible.
   */
  highestPriority: number;
  /** How many of the six engines produced an actionable decision. */
  decisionCount: number;
}

export interface UnifiedProductIntelligence {
  product: {
    id: string;
    sku: string;
    name: string;
    category: { id: string; name: string } | null;
  };
  stockRisk: UnifiedStockRisk;
  demand: UnifiedDemand;
  reorder: UnifiedReorder;
  overstock: UnifiedOverstock;
  slowDead: UnifiedSlowDead;
  /** `null` when the product has never been ordered from anyone. */
  supplier: UnifiedSupplier | null;
  summary: UnifiedSummary;
}

/**
 * Derive the summary from the six engine results.
 *
 * `supplier` is optional because a product nobody has ordered from has no
 * supplier result at all — a missing history, not an error. Everything else is
 * required, because every product-facing engine can always say something, even
 * when that something is `INSUFFICIENT_DATA`.
 */
export function summarise(results: {
  stockRisk: UnifiedStockRisk;
  demand: UnifiedDemand;
  reorder: UnifiedReorder;
  overstock: UnifiedOverstock;
  slowDead: UnifiedSlowDead;
  supplier: UnifiedSupplier | null;
}): UnifiedSummary {
  const { stockRisk, demand, reorder, overstock, slowDead, supplier } = results;

  // Only the engines whose approved contract defines a priority.
  const priorities: number[] = [
    stockRisk.priority,
    overstock.priority,
    slowDead.priority,
    ...(supplier === null ? [] : [supplier.priority]),
  ];

  let decisionCount = 0;
  if (ACTIONABLE_RISK.includes(stockRisk.risk)) decisionCount += 1;
  if (ACTIONABLE_TREND.includes(demand.trend as (typeof ACTIONABLE_TREND)[number])) decisionCount += 1;
  if (ACTIONABLE_REORDER.includes(reorder.decision as (typeof ACTIONABLE_REORDER)[number])) decisionCount += 1;
  if (ACTIONABLE_OVERSTOCK.includes(overstock.status as (typeof ACTIONABLE_OVERSTOCK)[number])) decisionCount += 1;
  if (ACTIONABLE_SLOW_DEAD.includes(slowDead.status as (typeof ACTIONABLE_SLOW_DEAD)[number])) decisionCount += 1;
  if (supplier !== null && ACTIONABLE_STABILITY.includes(supplier.stability)) decisionCount += 1;

  return {
    attentionRequired: decisionCount > 0,
    highestPriority: priorities.reduce((highest, value) => Math.max(highest, value), 0),
    decisionCount,
  };
}

/**
 * Assemble one product's unified snapshot.
 *
 * A pure function of already-computed engine results: given the same six
 * outputs it always returns the same snapshot, and it never consults anything
 * else. That is what makes the unified view safe to compare against the six
 * direct endpoints.
 */
export function assembleUnifiedProduct(input: {
  product: UnifiedProductIntelligence['product'];
  stockRisk: UnifiedStockRisk;
  demand: UnifiedDemand;
  reorder: UnifiedReorder;
  overstock: UnifiedOverstock;
  slowDead: UnifiedSlowDead;
  supplier: UnifiedSupplier | null;
}): UnifiedProductIntelligence {
  const { product } = input;

  return {
    product,
    stockRisk: input.stockRisk,
    demand: input.demand,
    reorder: input.reorder,
    overstock: input.overstock,
    slowDead: input.slowDead,
    supplier: input.supplier,
    summary: summarise(input),
  };
}