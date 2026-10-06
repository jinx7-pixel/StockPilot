/**
 * Overstock Detection Engine.
 *
 * A **pure function** from structured facts to an `OverstockResult`. No SQL, no
 * HTTP, no clock, no randomness — the same facts always produce the same result.
 *
 * The question it answers:
 *
 * > Is this product carrying significantly more stock than its historical demand
 * > justifies?
 *
 * The answer is deliberately conservative, because the failure modes are
 * asymmetric. Calling a healthy product "overstocked" invites someone to
 * markdown or return stock that was about to sell. Missing a genuinely
 * overstocked product merely leaves some cash tied up for a while. So the
 * engine refuses to divide by a rate it does not trust, and says
 * `INSUFFICIENT_DATA` rather than guessing.
 *
 * ## What is reused
 *
 * The demand rate comes from the Demand Intelligence Engine's `averageDailyRate`
 * — the same seam the Reorder Engine uses — so three features size their buffers
 * from one definition. Current stock comes from the ledger via the shared
 * balance expression. Confidence is passed in from the Demand Engine's own
 * ladder; this module has no confidence rules of its own.
 *
 * ## The threshold is a coverage rule
 *
 * `daysOfStock >= 60`, never "stock is high". Four hundred units is comfortable
 * cover for something selling two a day and absurd cover for something selling
 * forty, and only a rate normalises that comparison across a catalog.
 */

import { compareScaled, divide, fromScaled, isPositive, toScaled } from './decimal.js';
import { DEMAND_POLICY, OVERSTOCK_POLICY, OVERSTOCK_PRIORITY } from './policies.js';
import {
  type ConfidenceLevel,
  type OverstockEvidence,
  type OverstockFacts,
  type OverstockResult,
  type OverstockStatus,
} from './types.js';

const P = OVERSTOCK_POLICY;

/**
 * Days of cover: `currentStock / averageDailySales30d`, at full working
 * precision.
 *
 * `null` in two cases, and they mean different things:
 *
 *  - **No positive rate.** There is nothing to divide by. A zero here would read
 *    as "this product is fully covered", which is the opposite of the truth.
 *  - **Negative stock.** A negative ledger balance is corrupt data, and
 *    "-3 days of cover" is not a quantity that means anything. It is reported as
 *    unassessable rather than as comfortably under the threshold.
 *
 * Zero stock is *not* one of those cases: zero divided by a positive rate is
 * zero days of cover, a perfectly meaningful figure that is correctly normal.
 */
export function calculateDaysOfStock(
  currentStock: string,
  averageDailySales30d: string,
): bigint | null {
  if (!isPositive(averageDailySales30d)) return null;
  if (compareScaled(toScaled(currentStock), 0n) < 0) return null;

  return divide(toScaled(currentStock), toScaled(averageDailySales30d));
}

/** The demand-evidence gates, reported so a reader can see exactly what was met. */
function evaluateEvidence(facts: OverstockFacts): string[] {
  const unmet: string[] = [];

  if (compareScaled(toScaled(facts.currentStock), 0n) < 0) {
    unmet.push('a non-negative stock-on-hand figure');
  }
  if (!isPositive(facts.averageDailySales30d)) unmet.push('positive 30-day demand rate');
  if (facts.activeSalesDays30d < P.evidence.minimumActiveSalesDays30d) {
    unmet.push(`${P.evidence.minimumActiveSalesDays30d} active sales days in 30 days`);
  }
  if (compareScaled(toScaled(facts.unitsSold30d), toScaled(P.evidence.minimumUnitsSold30d)) < 0) {
    unmet.push(`${P.evidence.minimumUnitsSold30d} units sold in 30 days`);
  }

  return unmet;
}

/**
 * Classify a product.
 *
 * Evidence is checked **first**. A large stock with a thin denominator is the
 * exact shape that produces a frightening days-of-stock figure, so the gate runs
 * before the metric is read rather than after.
 */
export function classifyOverstock(
  daysOfStock: bigint | null,
  hasSufficientEvidence: boolean,
): OverstockStatus {
  if (!hasSufficientEvidence || daysOfStock === null) return 'INSUFFICIENT_DATA';
  return compareScaled(daysOfStock, toScaled(P.thresholdDays)) >= 0 ? 'OVERSTOCK' : 'NORMAL';
}

/** Render a quantity for a sentence: `12.50` reads as `12.5`, `12.00` as `12`. */
function formatQuantity(value: string): string {
  const oneDecimal = fromScaled(toScaled(value), 1);
  return oneDecimal.endsWith('.0') ? oneDecimal.slice(0, -2) : oneDecimal;
}

/**
 * The explanation, assembled from fixed templates.
 *
 * It states the arithmetic that produced the verdict. It does not say what to
 * do about it: no markdown, no supplier return, no recommendation. Those belong
 * to recommendation and action modules, and naming one here would make an
 * assessment look like advice.
 */
function buildReason(
  status: OverstockStatus,
  facts: OverstockFacts,
  daysOfStock: bigint | null,
  unmetEvidenceGates: string[],
): string {
  if (status === 'INSUFFICIENT_DATA') {
    return (
      `Not enough demand evidence to judge whether current stock is excessive: ` +
      `this product needs ${unmetEvidenceGates.join(' and ')}. ` +
      `A large stock against a very small recent sales rate would otherwise look ` +
      `like extreme overstock, so no conclusion is drawn.`
    );
  }

  const stock = formatQuantity(facts.currentStock);
  const rate = formatQuantity(facts.averageDailySales30d);
  const days = daysOfStock === null ? '—' : formatQuantity(fromScaled(daysOfStock, 2));

  const coverage =
    `Current stock of ${stock} units is about ${days} days of cover at the recent average ` +
    `of ${rate} units per day`;

  return status === 'OVERSTOCK'
    ? `${coverage}, which is at or above the ${P.thresholdDays}-day threshold used to flag overstock.`
    : `${coverage}, which is below the ${P.thresholdDays}-day threshold used to flag overstock.`;
}

/**
 * Assess whether a product is carrying excessive stock relative to its own
 * historical demand.
 *
 * @throws {InvalidDecimalError} when a supplied figure is not a valid decimal.
 * That is corrupt input, reported rather than silently treated as zero.
 */
export function assessOverstock(
  facts: OverstockFacts,
  options: { confidence: ConfidenceLevel },
): OverstockResult {
  const unmetEvidenceGates = evaluateEvidence(facts);
  const hasSufficientEvidence = unmetEvidenceGates.length === 0;

  const daysOfStock = calculateDaysOfStock(facts.currentStock, facts.averageDailySales30d);
  const status = classifyOverstock(daysOfStock, hasSufficientEvidence);

  const evidence: OverstockEvidence = {
    analysisWindowDays: DEMAND_POLICY.baselineDays,
    unitsSold90d: facts.unitsSold90d,
    activeSalesDays90d: facts.activeSalesDays90d,
    observableHistoryDays: facts.observableHistoryDays,
    minimumActiveSalesDays30d: P.evidence.minimumActiveSalesDays30d,
    minimumUnitsSold30d: P.evidence.minimumUnitsSold30d,
    thresholdDays: P.thresholdDays,
    unmetEvidenceGates,
    hasSufficientEvidence,
  };

  return {
    productId: facts.productId,
    status,
    priority: OVERSTOCK_PRIORITY[status],
    currentStock: facts.currentStock,
    averageDailySales30d: facts.averageDailySales30d,
    unitsSold30d: facts.unitsSold30d,
    activeSalesDays30d: facts.activeSalesDays30d,
    analysisWindowDays: DEMAND_POLICY.baselineDays,
    daysOfStock: daysOfStock === null ? null : fromScaled(daysOfStock, 2),
    thresholdDays: P.thresholdDays,
    confidence: options.confidence,
    reason: buildReason(status, facts, daysOfStock, unmetEvidenceGates),
    evidence,
  };
}

// Re-exported so callers get the policy and the vocabulary from the same module
// as the engine, mirroring `demand.ts` and `reorder.ts`.
export { DEMAND_POLICY, OVERSTOCK_POLICY, OVERSTOCK_PRIORITY } from './policies.js';
export { OVERSTOCK_STATUSES } from './types.js';
export type {
  OverstockEvidence,
  OverstockFacts,
  OverstockResult,
  OverstockStatus,
} from './types.js';