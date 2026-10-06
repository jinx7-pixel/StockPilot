/**
 * Reorder Engine.
 *
 * A **pure function** from structured facts to a `ReorderResult`. No SQL, no
 * HTTP, no clock, no randomness — the same facts always produce the same result.
 *
 * The question it answers:
 *
 * > Given what is in stock, what is already on order, and how fast this product
 * > sells, does a replenishment order need to be placed, and how much?
 *
 * It answers with a *recommendation*. It never places one. Nothing in this file
 * writes, and no route in the API accepts a write.
 *
 * ## What is reused, and why
 *
 * The two formulas at the heart of this — safety stock and the reorder point —
 * are imported from `calculations.ts`, which the Stock Risk Engine also calls.
 * Both engines therefore compute the same number for the same product on the
 * same day, which is the property that makes the two pages safe to compare
 * side by side. The demand rate is taken as a fact from the Demand Intelligence
 * Engine rather than recomputed, for the same reason.
 *
 * ## Refusing to advise
 *
 * Two conditions produce advice rather than a number, and both are deliberate:
 *
 *  - **Negative stock** is a corrupt ledger, not a reason to buy more. The
 *    result is `DATA_ERROR` with no recommendation, because a recommendation
 *    derived from an impossible figure is worse than no recommendation.
 *  - **Missing evidence** yields `INSUFFICIENT_DATA` with `null` throughout.
 *    A null is a statement that nothing is known; a zero would claim that
 *    nothing is needed, which is a different and wrong thing to say.
 */

import { calculateReorderPoint, calculateSafetyStock } from './calculations.js';
import { add, compare, fromScaled, isPositive, median, subtract, toScaled } from './decimal.js';
import { REORDER_POLICY, STOCK_RISK_POLICY } from './policies.js';
import {
  type ConfidenceLevel,
  type ReorderDecision,
  type ReorderEvidence,
  type ReorderFacts,
  type ReorderResult,
} from './types.js';

const P = REORDER_POLICY;

/** The safety buffer, in days, is a stock-risk policy value both engines share. */
const SAFETY_STOCK_DAYS = STOCK_RISK_POLICY.safetyStockDays;

/** True when there is enough demand history to size a buffer from. */
function hasDemandEvidence(facts: ReorderFacts): boolean {
  return (
    isPositive(facts.unitsSold30d) &&
    facts.activeSalesDays30d >= P.minimumActiveDays30d &&
    compare(facts.observableHistoryDays, P.minimumObservableDays) >= 0
  );
}

/**
 * True when a lead time exists and is usable.
 *
 * A lead time of exactly zero counts: same-day supplier turnaround is a real,
 * measurable thing, and treating it as missing would quietly penalise a fast
 * supplier. A negative one is impossible and is refused.
 */
function hasUsableLeadTime(medianLeadTimeDays: string | null): medianLeadTimeDays is string {
  return medianLeadTimeDays !== null && compare(medianLeadTimeDays, 0) >= 0;
}

/**
 * Max minus min across the lead-time samples, or `null` with fewer than two.
 *
 * Reported so a reader can see *how* consistent the supplier has actually been,
 * rather than being asked to trust the median alone.
 */
function leadTimeSpread(samples: readonly string[]): string | null {
  if (samples.length < 2) return null;

  let lowest = samples[0]!;
  let highest = samples[0]!;

  for (const sample of samples) {
    if (compare(sample, lowest) < 0) lowest = sample;
    if (compare(sample, highest) > 0) highest = sample;
  }

  return fromScaled(subtract(toScaled(highest), toScaled(lowest)), 2);
}

/**
 * A long or inconsistent lead time stays usable but stops being reassuring.
 *
 * Neither condition is a reason to hide the lead time — a 40-day supplier still
 * sets a 40-day reorder point. They only prevent that single figure from being
 * what makes confidence high on its own.
 */
function isLeadTimeUnreliable(
  medianLeadTimeDays: string,
  spreadDays: string | null,
): boolean {
  if (compare(medianLeadTimeDays, P.leadTime.unusuallyLongDays) >= 0) return true;
  if (spreadDays !== null && compare(spreadDays, P.leadTime.unusuallyVariableSpreadDays) >= 0) {
    return true;
  }
  return false;
}

/**
 * The decision: `REORDER` when net available stock is below the reorder point.
 *
 * This is the definition, not a tunable, so there is no epsilon and no policy
 * knob here. `recommendedQuantity > 0` is exactly equivalent to
 * `netAvailable < reorderPoint`, and the result exposes both so a reader can
 * check the arithmetic rather than trust it.
 */
export function classifyReorder(
  netAvailable: string,
  reorderPoint: string | null,
): ReorderDecision {
  if (reorderPoint === null) return 'INSUFFICIENT_DATA';
  return compare(netAvailable, reorderPoint) < 0 ? 'REORDER' : 'NO_REORDER';
}

/**
 * Confidence in the recommendation, from two independent kinds of evidence:
 * how well we know the demand rate, and how well we know the supplier.
 *
 * Both are needed. A product with perfect demand history and a single
 * one-off order behind its lead time is not well evidenced, and neither is a
 * supplier with three clean deliveries for a product nobody has data on.
 */
export function assessReorderConfidence(options: {
  demandConfidence: ConfidenceLevel;
  leadTimeSampleCount: number;
  leadTimeUnreliable: boolean;
  leadTimeUsable: boolean;
  demandEvidenced: boolean;
}): ConfidenceLevel {
  if (!options.demandEvidenced || !options.leadTimeUsable) return 'INSUFFICIENT';

  const samples = options.leadTimeSampleCount;
  const { demandConfidence } = options;

  // What the evidence supports before the reliability cap is applied.
  const uncapped: ConfidenceLevel =
    demandConfidence === 'HIGH' && samples >= P.leadTime.highConfidenceMinimumSamples
      ? 'HIGH'
      : (demandConfidence === 'HIGH' || demandConfidence === 'MEDIUM') &&
          samples >= P.leadTime.mediumConfidenceMinimumSamples
        ? 'MEDIUM'
        : 'LOW';

  // A long or inconsistent lead time lowers confidence by one step rather than
  // removing it: the number is still used, it just cannot be what makes this
  // assessment sound strong on its own.
  if (!options.leadTimeUnreliable || uncapped === 'LOW') return uncapped;
  return uncapped === 'HIGH' ? 'MEDIUM' : 'LOW';
}

/** Render a quantity for a sentence: `12.50` reads as `12.5`, `12.00` as `12`. */
function formatQuantity(value: string): string {
  const oneDecimal = fromScaled(toScaled(value), 1);
  return oneDecimal.endsWith('.0') ? oneDecimal.slice(0, -2) : oneDecimal;
}

/**
 * The explanation, assembled from fixed templates.
 *
 * It states the arithmetic that produced the verdict and stops there. It never
 * says a supplier is "reliable" or a shipment is "late" — the numbers are
 * offered, and the reading is left to the user.
 */
function buildReason(
  decision: ReorderDecision,
  facts: ReorderFacts,
  options: {
    reorderPoint: string | null;
    recommendedQuantity: string | null;
    effectiveLeadTimeDays: string | null;
    demandEvidenced: boolean;
    leadTimeUsable: boolean;
  },
): string {
  if (decision === 'DATA_ERROR') {
    return (
      'Current stock is negative, which means the inventory ledger is inconsistent. ' +
      'No replenishment quantity can be calculated until that is resolved.'
    );
  }

  const lead = options.effectiveLeadTimeDays;
  const net = formatQuantity(facts.currentStock);
  const ordered = formatQuantity(facts.onOrderQuantity);
  const onOrderClause = compare(facts.onOrderQuantity, 0) > 0
    ? ` Stock on hand is ${net}, with ${ordered} already on order.`
    : ` Stock on hand is ${net}, with nothing on order.`;

  if (!options.demandEvidenced) {
    return (
      'Not enough recent sales activity is available to calculate a reorder point, ' +
      'so no replenishment quantity can be recommended.'
    );
  }

  if (!options.leadTimeUsable || lead === null || options.reorderPoint === null) {
    return (
      'No completed purchase order is available to measure supplier lead time, ' +
      'so no reorder point can be calculated and no quantity can be recommended.'
    );
  }

  if (decision === 'REORDER' && options.recommendedQuantity !== null) {
    return (
      `Available stock (including what is on order) is below the reorder point of ` +
      `${formatQuantity(options.reorderPoint)} units, which covers ${formatQuantity(lead)} days ` +
      `of supplier lead time plus ${SAFETY_STOCK_DAYS} days of safety stock. ` +
      `Reordering ${formatQuantity(options.recommendedQuantity)} units would bring ` +
      `available stock back up to the reorder point.${onOrderClause}`
    );
  }

  return (
    `Available stock (including what is on order) is at or above the reorder point of ` +
    `${formatQuantity(options.reorderPoint)} units, which covers ${formatQuantity(lead)} days ` +
    `of supplier lead time plus ${SAFETY_STOCK_DAYS} days of safety stock. ` +
    `No reorder is needed.${onOrderClause}`
  );
}

/**
 * Decide whether a product needs a replenishment order, and how much of one.
 *
 * @throws {InvalidDecimalError} when a supplied figure is not a valid decimal.
 * That is corrupt input, and is reported rather than silently treated as zero.
 */
export function assessReorder(
  facts: ReorderFacts,
  options: { demandConfidence: ConfidenceLevel },
): ReorderResult {
  // Fail fast on a corrupt ledger before doing any arithmetic with it.
  const negativeStock = compare(facts.currentStock, 0) < 0;

  // netAvailable = stock on hand + everything already on order. Both are
  // already exact decimal strings, so the sum is exact too.
  const netAvailable = fromScaled(
    add(toScaled(facts.currentStock), toScaled(facts.onOrderQuantity)),
    2,
  );

  const medianLeadTimeDays = median(facts.leadTimeSamples);
  const leadTimeSampleCount = facts.leadTimeSamples.length;
  const leadTimeUsable = hasUsableLeadTime(medianLeadTimeDays);
  const demandEvidenced = hasDemandEvidence(facts);

  const spreadDays = leadTimeSpread(facts.leadTimeSamples);
  const leadTimeUnreliable =
    leadTimeUsable && isLeadTimeUnreliable(medianLeadTimeDays, spreadDays);

  const safetyStock = demandEvidenced
    ? calculateSafetyStock(facts.averageDailySales30d, SAFETY_STOCK_DAYS)
    : null;

  const reorderPoint =
    demandEvidenced && leadTimeUsable
      ? calculateReorderPoint(facts.averageDailySales30d, medianLeadTimeDays, SAFETY_STOCK_DAYS)
      : null;

  // A corrupt ledger yields no quantity at all, even though the arithmetic
  // would happily produce one from an impossible starting position.
  let recommendedQuantity: string | null = null;
  if (!negativeStock && reorderPoint !== null) {
    const gap = subtract(toScaled(reorderPoint), toScaled(netAvailable));
    recommendedQuantity = fromScaled(gap > 0n ? gap : 0n, 2);
  }

  const decision: ReorderDecision = negativeStock
    ? 'DATA_ERROR'
    : classifyReorder(netAvailable, reorderPoint);

  const reorder = recommendedQuantity !== null && isPositive(recommendedQuantity);

  const confidence = negativeStock
    ? 'INSUFFICIENT'
    : assessReorderConfidence({
        demandConfidence: options.demandConfidence,
        leadTimeSampleCount,
        leadTimeUnreliable,
        leadTimeUsable,
        demandEvidenced,
      });

  const evidence: ReorderEvidence = {
    netAvailable,
    onOrderQuantity: facts.onOrderQuantity,
    leadTimeSamples: leadTimeSampleCount,
    leadTimeSpreadDays: spreadDays,
    hasLeadTimeEvidence: leadTimeUsable,
    leadTimeUnreliable,
    unitsSold30d: facts.unitsSold30d,
    activeSalesDays30d: facts.activeSalesDays30d,
    safetyStockDays: SAFETY_STOCK_DAYS,
  };

  return {
    productId: facts.productId,
    currentStock: facts.currentStock,
    onOrderQuantity: facts.onOrderQuantity,
    netAvailable,
    safetyStock,
    reorderPoint,
    recommendedQuantity,
    reorder,
    decision,
    effectiveLeadTimeDays: medianLeadTimeDays,
    safetyStockDays: SAFETY_STOCK_DAYS,
    confidence,
    reason: buildReason(decision, facts, {
      reorderPoint,
      recommendedQuantity,
      effectiveLeadTimeDays: medianLeadTimeDays,
      demandEvidenced,
      leadTimeUsable,
    }),
    evidence,
  };
}

// Re-exported so callers get the policy and the decision vocabulary from the
// same module as the engine, mirroring `demand.ts`.
export { REORDER_POLICY } from './policies.js';
export { REORDER_DECISIONS } from './types.js';
export type {
  ReorderDecision,
  ReorderEvidence,
  ReorderFacts,
  ReorderResult,
} from './types.js';
