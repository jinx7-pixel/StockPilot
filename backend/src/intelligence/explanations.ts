/**
 * Per-engine explanation builders.
 *
 * Each function takes the facts and the result its engine already produced and
 * assembles the shared {@link DecisionExplanation} envelope. They live together
 * rather than inside each engine so the six shapes can be read side by side —
 * which is the point: every engine must surface the same four fields, and a
 * reader should be able to confirm that in one screen.
 *
 * Rules these all follow:
 *
 *  - Evidence is read from the finished result. Nothing here recomputes a
 *    figure, so no engine can drift from what it actually decided.
 *  - Confidence is mirrored, never recalculated. Each engine's ladder is
 *    already decision-specific and already combines its sources conservatively.
 *  - Limitations are emitted only where something is genuinely weak. A verdict
 *    resting on good evidence reports no limitations at all.
 */

import {
  buildEvidence,
  buildLimitations,
  combineConfidence,
  evidence as item,
  type DecisionExplanation,
} from './confidence.js';
import { compare } from './decimal.js';
import { DEMAND_POLICY, SUPPLIER_POLICY } from './policies.js';
import type {
  DemandFacts,
  DemandResult,
  OverstockFacts,
  OverstockResult,
  ReorderFacts,
  ReorderResult,
  SlowDeadFacts,
  SlowDeadResult,
  StockRiskFacts,
  StockRiskResult,
  SupplierFacts,
  SupplierResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Stock Risk
// ---------------------------------------------------------------------------

/**
 * Stock Risk rests on demand, inventory and supplier evidence together, and its
 * confidence already reflects that. The limitations name whichever of the three
 * is thin, so a confident-looking verdict cannot hide a missing lead time.
 */
export function explainStockRisk(
  facts: StockRiskFacts,
  result: Omit<StockRiskResult, 'explanation'>,
): DecisionExplanation {
  const evidence = buildEvidence([
    item('demand', 'Units sold in the analysis window', facts.unitsSold,
      `Total units sold across the ${result.analysisWindowDays}-day window.`, 'units'),
    item('demand', 'Active sales days', facts.activeSalesDays,
      `Days on which at least one unit sold, out of ${result.analysisWindowDays}.`, 'days'),
    item('demand', 'Average daily sales', facts.averageDailySales,
      'Demand rate the coverage figures are built on.', 'units/day'),
    item('inventory', 'Current stock', facts.currentStock,
      'Sum of the append-only inventory ledger.', 'units'),
    item('inventory', 'Days of stock', result.daysOfStock,
      'Current stock divided by the recent daily rate.', 'days'),
    item('inventory', 'Reorder point', result.reorderPoint,
      `Demand rate multiplied by lead time plus ${result.safetyStockDays} days of safety stock.`, 'units'),
    item('supplier', 'Completed orders measured', result.leadTimeSampleCount,
      'Fully received purchase order(s) behind the median lead time.', 'orders'),
    item('supplier', 'Median lead time', result.effectiveLeadTimeDays,
      'Middle observed delivery time; resists one abnormal order.', 'days'),
    item('data_quality', 'Observable history', facts.observableHistoryDays,
      'Days since the product first appeared in the ledger.', 'days'),
  ]);

  const limitations: string[] = [];

  if (result.effectiveLeadTimeDays === null) {
    limitations.push(
      'No completed purchase order is available, so supplier lead time could not be measured ' +
      'and no reorder point was calculated.',
    );
  } else if (result.leadTimeSampleCount < 3) {
    limitations.push(
      `Only ${result.leadTimeSampleCount} completed order(s) support the median lead time, ` +
      'which is very little evidence about delivery speed.',
    );
  }

  if (!hasUsableDemand(facts)) {
    limitations.push(
      'Too little recent sales activity to characterise demand, so coverage could not be measured.',
    );
  }

  if (compare(facts.observableHistoryDays, DEMAND_POLICY.minimumObservableDays) < 0) {
    limitations.push(
      `Limited observable history: the product has only ${facts.observableHistoryDays} days in ` +
      'the ledger, so a longer-run pattern cannot be seen.',
    );
  }

  return {
    decision: result.risk,
    confidence: result.confidence,
    evidence,
    limitations: buildLimitations(limitations),
  };
}

function hasUsableDemand(facts: StockRiskFacts): boolean {
  return (
    compare(facts.unitsSold, 0) > 0 && compare(facts.observableHistoryDays, 0) > 0
  );
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

/**
 * A demand verdict reads demand evidence and the quality of that history, and
 * nothing else. Its confidence is the demand ladder itself, so it is mirrored
 * rather than combined.
 */
export function explainDemand(
  facts: DemandFacts,
  result: Omit<DemandResult, 'explanation'>,
): DecisionExplanation {
  const evidence = buildEvidence([
    item('demand', 'Units sold (7-day window)', result.unitsSold7d,
      'Most recent window, the "recent" side of the trend comparison.', 'units'),
    item('demand', 'Units sold (30-day window)', result.unitsSold30d,
      'Baseline window the trend is measured against.', 'units'),
    item('demand', 'Units sold (90-day window)', result.unitsSold90d,
      'Widest window, covering the full observation period.', 'units'),
    item('demand', 'Average daily sales (30-day)', result.averageDailySales30d,
      'Demand rate the baseline is expressed as.', 'units/day'),
    item('demand', 'Active sales days (30-day)', result.activeSalesDays30d,
      'Days on which at least one unit sold.', 'days'),
    item('demand', 'Trend', result.trend,
      `Direction of the 7-day rate against the 30-day baseline${result.trendChangePercent === null ? '' : `, ${result.trendChangePercent}%`}.`),
    item('demand', 'Lead-time-independent variability', result.coefficientOfVariation,
      'Standard deviation over mean of the daily series; how uneven demand is.', 'ratio'),
    item('data_quality', 'Observable history', facts.observableHistoryDays,
      'Days since the product first appeared in the ledger.', 'days'),
    item('data_quality', 'Consistency ratio', result.evidence.consistencyRatio,
      'Share of the window that had a sale; stops calendar length reading as evidence.', 'ratio'),
    item('data_quality', 'Observations used', result.evidence.demandObservationDays,
      'Days with a sale across the whole window.', 'days'),
  ]);

  const limitations: string[] = [];

  if (!result.evidence.hasSufficientEvidence) {
    limitations.push(
      'Not enough sales activity to characterise demand reliably, so trend and variability ' +
      'are reported as insufficient rather than estimated.',
    );
  }

  if (
    result.activeSalesDays90d > 0 &&
    result.activeSalesDays90d < DEMAND_POLICY.highConfidence.activeDays30
  ) {
    limitations.push(
      `Sparse sales activity: only ${result.activeSalesDays90d} sale day(s) across the ` +
      '90-day window, so the rates rest on few observations.',
    );
  }

  if (result.variability === 'INSUFFICIENT_DATA') {
    limitations.push(
      `Variability needs at least ${DEMAND_POLICY.minimumActiveDaysForVariability} active sales ` +
      'days; below that the spread is arithmetic rather than a pattern.',
    );
  }

  if (compare(facts.observableHistoryDays, DEMAND_POLICY.minimumObservableDays) < 0) {
    limitations.push(
      `Limited observable history: the product has only ${facts.observableHistoryDays} days in ` +
      'the ledger.',
    );
  }

  return {
    decision: result.trend,
    confidence: result.confidence,
    evidence,
    limitations: buildLimitations(limitations),
  };
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

/**
 * The clearest case of decision-specific confidence: this decision depends on
 * demand *and* supplier speed, so a strong demand reading cannot rescue a weak
 * supplier one. The engine's own confidence already applies that rule; the
 * combination is restated here with {@link combineConfidence} so the contract is
 * visible where the evidence is.
 */
export function explainReorder(
  facts: ReorderFacts,
  result: Omit<ReorderResult, 'explanation'>,
): DecisionExplanation {
  const supplierConfidence = supplierEvidenceConfidence(facts);

  const evidence = buildEvidence([
    item('demand', 'Average daily sales (30-day)', facts.averageDailySales30d,
      'Demand rate the reorder point is sized from.', 'units/day'),
    item('demand', 'Units sold (30-day)', facts.unitsSold30d,
      'Total units sold in the baseline window.', 'units'),
    item('demand', 'Active sales days (30-day)', facts.activeSalesDays30d,
      'Days on which at least one unit sold.', 'days'),
    item('inventory', 'Current stock', facts.currentStock,
      'Sum of the append-only inventory ledger.', 'units'),
    item('inventory', 'On order', facts.onOrderQuantity,
      'Ordered but not yet received, from ordered and partly received orders only.', 'units'),
    item('inventory', 'Net available', result.netAvailable,
      'Stock on hand plus everything already on the way.', 'units'),
    item('inventory', 'Safety stock', result.safetyStock,
      `Demand rate multiplied by ${result.safetyStockDays} days of cover.`, 'units'),
    item('inventory', 'Reorder point', result.reorderPoint,
      'Demand rate multiplied by lead time plus the safety buffer.', 'units'),
    item('inventory', 'Recommended quantity', result.recommendedQuantity,
      'The gap between net available stock and the reorder point.', 'units'),
    item('supplier', 'Completed orders measured', result.evidence.leadTimeSamples,
      'Fully received purchase order(s) behind the median lead time.', 'orders'),
    item('supplier', 'Supplier-side confidence', supplierConfidence,
      'Confidence the supplier evidence alone supports; combined conservatively with demand ' +
      'to give the decision confidence above.', 'level'),
    item('supplier', 'Median lead time', result.effectiveLeadTimeDays,
      'Middle observed delivery time; resists one abnormal order.', 'days'),
    item('data_quality', 'Observable history', facts.observableHistoryDays,
      'Days since the product first appeared in the ledger.', 'days'),
  ]);

  const limitations: string[] = [];

  if (result.effectiveLeadTimeDays === null) {
    limitations.push(
      'No completed purchase order is available, so supplier lead time could not be measured ' +
      'and no reorder point was calculated.',
    );
  } else if (facts.leadTimeSamples.length < 3) {
    limitations.push(
      `Only ${facts.leadTimeSamples.length} completed order(s) support the median lead time, ` +
      'so the reorder point rests on very little supplier evidence.',
    );
  }

  if (compare(facts.unitsSold30d, 0) <= 0 || facts.activeSalesDays30d < 2) {
    limitations.push(
      'Very little recent sales activity, so the demand rate driving the reorder point is thin.',
    );
  }

  if (compare(facts.observableHistoryDays, DEMAND_POLICY.minimumObservableDays) < 0) {
    limitations.push(
      `Limited observable history: the product has only ${facts.observableHistoryDays} days in ` +
      'the ledger.',
    );
  }

  if (compare(facts.currentStock, 0) < 0) {
    limitations.push(
      'The inventory ledger balance is negative, which means the ledger is inconsistent; no ' +
      'quantity can be recommended until that is resolved.',
    );
  }

  return {
    decision: result.decision,
    confidence: result.confidence,
    evidence,
    limitations: buildLimitations(limitations),
  };
}

/**
 * The supplier-side confidence a reorder decision leans on.
 *
 * Mirrors the Supplier Engine's ladder exactly — 0 INSUFFICIENT, 1-2 LOW, 3-5
 * MEDIUM, 6+ HIGH — and reads every boundary from the same
 * `SUPPLIER_POLICY.confidence` constants the Supplier Engine uses. A hand-typed
 * threshold here drifted once already (capping everything at MEDIUM); sourcing
 * them from the policy makes that divergence impossible rather than merely fixed.
 */
function supplierEvidenceConfidence(facts: ReorderFacts): ReorderResult['confidence'] {
  const ladder = SUPPLIER_POLICY.confidence;
  const completed = facts.leadTimeSamples.length;

  if (completed < ladder.insufficientBelowCompletedOrders) return 'INSUFFICIENT';
  if (completed < ladder.lowBelowCompletedOrders) return 'LOW';
  if (completed < ladder.mediumBelowCompletedOrders) return 'MEDIUM';
  return 'HIGH';
}

// ---------------------------------------------------------------------------
// Overstock
// ---------------------------------------------------------------------------

/**
 * An overstock verdict turns on one ratio — days of cover — so its evidence is
 * mostly demand, with inventory as the numerator. The evidence gate is the
 * reason for any limitation, and each unmet gate is named verbatim.
 */
export function explainOverstock(
  facts: OverstockFacts,
  result: Omit<OverstockResult, 'explanation'>,
): DecisionExplanation {
  const evidence = buildEvidence([
    item('inventory', 'Current stock', facts.currentStock,
      'Sum of the append-only inventory ledger; the numerator of the cover ratio.', 'units'),
    item('inventory', 'Days of stock', result.daysOfStock,
      `Current stock divided by the recent daily rate; ${result.thresholdDays} or more is overstocked.`, 'days'),
    item('inventory', 'Overstock threshold', result.thresholdDays,
      'Days of cover at or above this are flagged.', 'days'),
    item('demand', 'Average daily sales (30-day)', facts.averageDailySales30d,
      'Demand rate the cover ratio divides by.', 'units/day'),
    item('demand', 'Units sold (30-day)', facts.unitsSold30d,
      'Total units sold in the classification window.', 'units'),
    item('demand', 'Active sales days (30-day)', facts.activeSalesDays30d,
      'Days on which at least one unit sold.', 'days'),
    item('demand', 'Units sold (90-day)', facts.unitsSold90d,
      'Wider window, reported for context only.', 'units'),
    item('data_quality', 'Observable history', facts.observableHistoryDays,
      'Days since the product first appeared in the ledger.', 'days'),
    item('data_quality', 'Unmet evidence gates', result.evidence.unmetEvidenceGates.length,
      result.evidence.unmetEvidenceGates.length === 0
        ? 'Every evidence gate was met.'
        : `Gates not met: ${result.evidence.unmetEvidenceGates.join('; ')}.`, 'gates'),
  ]);

  const limitations: string[] = [];

  for (const gate of result.evidence.unmetEvidenceGates) {
    limitations.push(
      `The evidence gate "${gate}" was not met, so the cover ratio is not trustworthy enough ` +
      'to call this product overstocked.',
    );
  }

  if (result.daysOfStock === null) {
    limitations.push(
      'No positive demand rate is available, so days of cover could not be calculated at all.',
    );
  }

  if (compare(facts.observableHistoryDays, DEMAND_POLICY.minimumObservableDays) < 0) {
    limitations.push(
      `Limited observable history: the product has only ${facts.observableHistoryDays} days in ` +
      'the ledger.',
    );
  }

  return {
    decision: result.status,
    confidence: result.confidence,
    evidence,
    limitations: buildLimitations(limitations),
  };
}

// ---------------------------------------------------------------------------
// Slow / Dead Stock
// ---------------------------------------------------------------------------

/**
 * A slow/dead verdict is a statement about inventory currently held, so the
 * inventory figure and the demand window are both load-bearing. The
 * classification basis the engine already recorded is surfaced verbatim, which
 * keeps the reason and the evidence from telling different stories.
 */
export function explainSlowDead(
  facts: SlowDeadFacts,
  result: Omit<SlowDeadResult, 'explanation'>,
): DecisionExplanation {
  const evidence = buildEvidence([
    item('inventory', 'Current stock', facts.currentStock,
      'Sum of the append-only inventory ledger; zero means there is no inventory to be a problem.', 'units'),
    item('demand', 'Units sold (90-day)', facts.unitsSold90d,
      'Total units sold across the observation window; zero with stock held is dead.', 'units'),
    item('demand', 'Active sales days (90-day)', facts.activeSalesDays90d,
      `Days with a sale; ${result.evidence.slowMaxActiveSalesDays} or fewer is slow.`, 'days'),
    item('demand', 'Average daily sales (90-day)', facts.averageDailySales90d,
      'Demand rate over the whole window.', 'units/day'),
    item('data_quality', 'Observable history', facts.observableHistoryDays,
      `Days since the product first appeared in the ledger; ${result.evidence.minimumObservableDays} are needed before any verdict.`, 'days'),
    item('data_quality', 'Classification basis', result.evidence.classificationBasis,
      'The ordered rule that produced this status.', 'rule'),
    item('data_quality', 'Holds inventory', result.evidence.holdsInventory ? 'yes' : 'no',
      'Whether there was stock on hand to be a problem at all.', 'boolean'),
  ]);

  const limitations: string[] = [];

  if (!result.evidence.hasSufficientHistory) {
    limitations.push(
      `Only ${facts.observableHistoryDays} days of observable history, below the ` +
      `${result.evidence.minimumObservableDays} needed to tell slow demand from a product that ` +
      'has simply not had time to sell.',
    );
  }

  if (result.evidence.holdsInventory && result.unitsSold90d === '0.00') {
    limitations.push(
      'No sales at all in the window; without a demand history there is no way to tell whether ' +
      'this is a seasonal gap or a product that has stopped moving for good.',
    );
  }

  if (result.evidence.holdsInventory && Number(facts.activeSalesDays90d) > 0 &&
      Number(facts.activeSalesDays90d) < 5) {
    limitations.push(
      `Sparse sales activity: only ${facts.activeSalesDays90d} sale day(s) in the ` +
      `${result.analysisWindowDays}-day window.`,
    );
  }

  return {
    decision: result.status,
    confidence: result.confidence,
    evidence,
    limitations: buildLimitations(limitations),
  };
}

// ---------------------------------------------------------------------------
// Supplier Intelligence
// ---------------------------------------------------------------------------

/**
 * Supplier Intelligence measures elapsed delivery time and nothing else. The
 * limitations state plainly what cannot be concluded — including the one that
 * will always be true, because the schema records no promised date.
 */
export function explainSupplier(
  facts: SupplierFacts,
  result: Omit<SupplierResult, 'explanation'>,
): DecisionExplanation {
  const evidence = buildEvidence([
    item('supplier', 'Completed purchase orders', result.completedPOCount,
      'Received orders, the only source of delivery-time evidence.', 'orders'),
    item('supplier', 'Median lead time', result.medianLeadTimeDays,
      'Middle observed delivery time; resists one abnormal order.', 'days'),
    item('supplier', '90th-percentile lead time', result.p90LeadTimeDays,
      'The slow end of the observed range.', 'days'),
    item('supplier', 'Lead-time variability', result.leadTimeCV,
      `Standard deviation over mean; ${result.evidence.stableMaxCoefficientOfVariation} or below is consistent.`, 'ratio'),
    item('supplier', 'Delivery-time range', result.evidence.minLeadTimeDays,
      `Fastest observed ${result.evidence.minLeadTimeDays} days, slowest ${result.evidence.maxLeadTimeDays} days.`, 'days'),
    item('supplier', 'Open purchase orders', result.openPOCount,
      'Ordered or partly received; not yet evidence of delivery speed.', 'orders'),
    item('supplier', 'Cancelled purchase orders', result.cancelledPOCount,
      'Cancelled orders, counted as a fact about our order book and not as supplier fault.', 'orders'),
    item('data_quality', 'Lead-time observations', result.leadTimeSampleCount,
      `Completed orders with both timestamps; variability needs ${SUPPLIER_POLICY.minimumSamplesForVariability}.`, 'orders'),
  ]);

  const limitations: string[] = [
    // Always true, and worth saying out loud rather than leaving a reader to
    // assume an on-time figure is hiding somewhere.
    'No promised delivery date is recorded anywhere in the system, so on-time delivery ' +
    'performance, late deliveries and SLA compliance cannot be calculated from this data.',
  ];

  if (result.leadTimeSampleCount < SUPPLIER_POLICY.minimumSamplesForVariability) {
    limitations.push(
      `Only ${result.leadTimeSampleCount} completed order(s) with usable timestamps, below the ` +
      `${SUPPLIER_POLICY.minimumSamplesForVariability} needed to judge delivery consistency.`,
    );
  }

  if (result.leadTimeSampleCount === 0) {
    limitations.push(
      'No completed purchase order exists for this supplier, so no delivery speed has been ' +
      'measured at all.',
    );
  }

  if (result.completedPOCount < 6) {
    limitations.push(
      `Supplier-performance confidence rests on ${result.completedPOCount} completed order(s); ` +
      'six or more are needed for high confidence.',
    );
  }

  if (result.cancelledPOCount > 0) {
    limitations.push(
      'A cancellation can have many causes and is not evidence about this supplier in ' +
      'particular; no reason was recorded either way.',
    );
  }

  void facts;

  return {
    decision: result.stability,
    confidence: result.confidence,
    evidence,
    limitations: buildLimitations(limitations),
  };
}

/** Re-exported so the confidence combination rule can be exercised directly. */
export { combineConfidence };