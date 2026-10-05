/**
 * Stock Risk Engine.
 *
 * A **pure function** from structured facts to a `StockRiskResult`. No SQL, no
 * HTTP, no clock, no randomness — the same facts always produce the same
 * result, which is what makes the rules testable and explainable.
 *
 * The question it answers:
 *
 * > Given current stock, historical sales velocity, supplier lead time and the
 * > evidence behind both, how risky is this stock position?
 *
 * It answers with a deterministic category, a deterministic priority and a
 * deterministic sentence. It never invents a number it does not have: a missing
 * lead time yields `null`, never a default. And it never mutates anything — no
 * stock write, no purchase order, no movement.
 */

import { compare, divide, fromScaled, isPositive, median, multiply, toScaled } from './decimal.js';
import { RISK_PRIORITY, STOCK_RISK_POLICY } from './policies.js';
import {
  CONFIDENCE_LEVELS,
  DataError,
  RISK_LEVELS,
  type ConfidenceLevel,
  type RiskLevel,
  type StockRiskEvidence,
  type StockRiskFacts,
  type StockRiskResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Evidence gates
// ---------------------------------------------------------------------------

/** Enough demand signal to say anything operational at all. */
function hasDemandEvidence(facts: StockRiskFacts): boolean {
  return isPositive(facts.unitsSold) && compare(facts.observableHistoryDays, 0) > 0;
}

/**
 * Confidence in the evidence, independent of the risk it implies.
 *
 * Age alone never earns confidence: a product observable for 90 days with a
 * single sale day is `LOW`, not `HIGH`. `HIGH` additionally requires supplier
 * lead-time evidence, because without knowing how long a supplier actually takes,
 * coverage cannot be called comfortable.
 */
export function assessConfidence(facts: StockRiskFacts): ConfidenceLevel {
  const policy = STOCK_RISK_POLICY;

  if (!isPositive(facts.unitsSold)) return 'INSUFFICIENT';
  if (compare(facts.observableHistoryDays, policy.minimumObservableDays) < 0) return 'INSUFFICIENT';

  const hasLeadTime = facts.leadTimeSamples.length > 0;

  if (
    compare(facts.observableHistoryDays, policy.highConfidenceObservableDays) >= 0 &&
    Number(facts.activeSalesDays) >= policy.highConfidenceActiveDays &&
    (!policy.highConfidenceRequiresLeadTimeEvidence || hasLeadTime)
  ) {
    return 'HIGH';
  }

  if (
    compare(facts.observableHistoryDays, policy.mediumConfidenceObservableDays) >= 0 &&
    Number(facts.activeSalesDays) >= policy.mediumConfidenceActiveDays
  ) {
    return 'MEDIUM';
  }

  return 'LOW';
}

/** There is enough signal to classify COVERAGE against lead time. */
function canClassifyCoverage(facts: StockRiskFacts, effectiveLeadTimeDays: string | null): boolean {
  return (
    hasDemandEvidence(facts) &&
    isPositive(facts.averageDailySales) &&
    effectiveLeadTimeDays !== null
  );
}

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

/**
 * Classify one product, in a fixed order.
 *
 * The order is deliberate and is the whole point of the function:
 *
 *  1. `OUT_OF_STOCK` wins over everything — an empty shelf is the most urgent
 *     fact about a business, whatever the evidence quality.
 *  2. Demand evidence, then lead-time evidence. Without both, the honest answer
 *     is `INSUFFICIENT_DATA`, not a reassuring `HEALTHY`.
 *  3. `OVERSTOCK` before `CRITICAL`, as policy specifies.
 *  4. `CRITICAL` → `LOW` → `HEALTHY` by comparing coverage against the lead
 *     time and then the lead time plus the safety buffer.
 *
 * `OVERSTOCK` is only reachable with sufficient demand evidence, so a large
 * quantity of a product nobody buys stays `INSUFFICIENT_DATA`; slow and dead
 * stock are a separate concern for a future engine.
 */
export function classifyRisk(
  facts: StockRiskFacts,
  daysOfStock: string | null,
  effectiveLeadTimeDays: string | null,
): RiskLevel {
  if (compare(facts.currentStock, 0) <= 0) return 'OUT_OF_STOCK';
  if (!canClassifyCoverage(facts, effectiveLeadTimeDays)) return 'INSUFFICIENT_DATA';

  const lead = effectiveLeadTimeDays!;
  const days = daysOfStock!;

  if (compare(days, STOCK_RISK_POLICY.overstockDaysOfStock) >= 0) return 'OVERSTOCK';
  if (compare(days, lead) < 0) return 'CRITICAL';

  const safetyThreshold = fromScaled(
    addDays(toScaled(lead), STOCK_RISK_POLICY.safetyStockDays),
    2,
  );
  if (compare(days, safetyThreshold) < 0) return 'LOW';

  return 'HEALTHY';
}

function addDays(scaled: bigint, days: number): bigint {
  return scaled + toScaled(days);
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

function days(value: string): string {
  return fromScaled(toScaled(value), 1);
}

function buildReason(
  risk: RiskLevel,
  facts: StockRiskFacts,
  daysOfStock: string | null,
  leadTime: string | null,
): string {
  const stock = fromScaled(toScaled(facts.currentStock), 0);

  switch (risk) {
    case 'OUT_OF_STOCK':
      return 'Current stock is zero.';

    case 'INSUFFICIENT_DATA': {
      if (!isPositive(facts.unitsSold)) {
        return 'No sales were recorded in the analysis window, so stock risk cannot be reliably assessed.';
      }
      if (leadTime === null) {
        return 'Supplier lead-time evidence is unavailable, so replenishment risk cannot be reliably assessed.';
      }
      return 'Not enough sales history is available to reliably assess stock risk.';
    }

    case 'CRITICAL':
      return (
        `Current stock covers approximately ${days(daysOfStock!)} days, ` +
        `while historical supplier lead time is ${days(leadTime!)} days.`
      );

    case 'LOW': {
      const threshold = fromScaled(
        addDays(toScaled(leadTime!), STOCK_RISK_POLICY.safetyStockDays),
        2,
      );
      return (
        `Current stock covers approximately ${days(daysOfStock!)} days, which is above the ` +
        `${days(leadTime!)}-day supplier lead time but below the ${days(threshold)}-day safety threshold.`
      );
    }

    case 'HEALTHY': {
      const threshold = fromScaled(
        addDays(toScaled(leadTime!), STOCK_RISK_POLICY.safetyStockDays),
        2,
      );
      return (
        `Current stock covers approximately ${days(daysOfStock!)} days, above the ` +
        `${days(threshold)}-day replenishment and safety threshold.`
      );
    }

    case 'OVERSTOCK':
      return (
        `Current stock of ${stock} units covers approximately ${days(daysOfStock!)} days, ` +
        `at or above the ${STOCK_RISK_POLICY.overstockDaysOfStock}-day overstock threshold.`
      );

    default:
      return 'Stock risk could not be assessed.';
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Assess one product's stock risk.
 *
 * @throws {DataError} when the facts are self-contradictory — negative stock
 * cannot arise under the inventory rules, so seeing it means corrupt data and
 * it is reported rather than quietly clamped to zero.
 */
export function assessStockRisk(facts: StockRiskFacts): StockRiskResult {
  if (compare(facts.currentStock, 0) < 0) {
    throw new DataError(
      `Product ${facts.productId} has negative stock (${facts.currentStock}); ` +
        'this indicates corrupt data rather than a stock position.',
    );
  }

  const analysisWindowDays = STOCK_RISK_POLICY.analysisWindowDays;
  const hasDemand = hasDemandEvidence(facts) && isPositive(facts.averageDailySales);

  // daysOfStock = currentStock / averageDailySales, exact decimal division.
  const daysOfStock = hasDemand
    ? fromScaled(divide(toScaled(facts.currentStock), toScaled(facts.averageDailySales)), 2)
    : null;

  // Median, so one abnormal supplier delay cannot inflate the whole figure.
  const effectiveLeadTimeDays = median(facts.leadTimeSamples);
  const leadTimeSampleCount = facts.leadTimeSamples.length;

  // safetyStock = averageDailySales × safetyStockDays
  const safetyStock = hasDemand
    ? fromScaled(
        multiply(
          toScaled(facts.averageDailySales),
          toScaled(STOCK_RISK_POLICY.safetyStockDays),
        ),
        2,
      )
    : null;

  // reorderPoint = averageDailySales × (leadTime + safetyStockDays)
  const reorderPoint =
    hasDemand && effectiveLeadTimeDays !== null
      ? fromScaled(
          multiply(
            toScaled(facts.averageDailySales),
            addDays(toScaled(effectiveLeadTimeDays), STOCK_RISK_POLICY.safetyStockDays),
          ),
          2,
        )
      : null;

  const risk = classifyRisk(facts, daysOfStock, effectiveLeadTimeDays);
  const confidence = assessConfidence(facts);

  const evidence: StockRiskEvidence = {
    salesWindowDays: analysisWindowDays,
    unitsSold: facts.unitsSold,
    observableHistoryDays: facts.observableHistoryDays,
    activeSalesDays: facts.activeSalesDays,
    leadTimeSamples: leadTimeSampleCount,
    hasLeadTimeEvidence: leadTimeSampleCount > 0,
  };

  return {
    productId: facts.productId,
    risk,
    priority: RISK_PRIORITY[risk],
    currentStock: fromScaled(toScaled(facts.currentStock), 2),
    averageDailySales: facts.averageDailySales,
    unitsSold: facts.unitsSold,
    analysisWindowDays,
    daysOfStock,
    effectiveLeadTimeDays,
    leadTimeSampleCount,
    safetyStockDays: STOCK_RISK_POLICY.safetyStockDays,
    safetyStock,
    reorderPoint,
    confidence,
    reason: buildReason(risk, facts, daysOfStock, effectiveLeadTimeDays),
    evidence,
  };
}

export { CONFIDENCE_LEVELS, RISK_LEVELS };
export { RISK_PRIORITY, STOCK_RISK_POLICY } from './policies.js';
export { DataError } from './types.js';
export type {
  ConfidenceLevel,
  RiskLevel,
  StockRiskEvidence,
  StockRiskFacts,
  StockRiskResult,
} from './types.js';
