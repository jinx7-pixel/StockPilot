/**
 * Supplier Intelligence Engine.
 *
 * A **pure function** from structured facts to a `SupplierResult`. No SQL, no
 * HTTP, no clock, no randomness — the same facts always produce the same result.
 *
 * The question it answers:
 *
 * > How has this supplier actually performed, in terms of receiving speed and
 * > consistency?
 *
 * ## What is deliberately absent
 *
 * There is no "good supplier" or "bad supplier" score, and no judgement about
 * anyone. A long lead time may be a supplier's problem or a shipping distance;
 * a cancellation may be their fault or a stockout on our side. This module
 * reports elapsed time and its spread, and stops there. Calling a supplier bad
 * on that evidence would be an opinion dressed as a measurement.
 *
 * There is also **no on-time percentage and no SLA compliance**. The schema
 * records no promised delivery date, so there is nothing to be late against.
 * Estimating one would produce a confident percentage with no data behind it,
 * which is exactly the failure this system is built to avoid.
 *
 * ## Reuse
 *
 * The median and the coefficient of variation come from the Demand Engine's own
 * decimal helpers, so "median" and "coefficient of variation" mean exactly one
 * thing across the whole intelligence layer.
 */

import { coefficientOfVariation } from './demand.js';
import { compare, compareScaled, fromScaled, median, toScaled } from './decimal.js';
import { explainSupplier } from './explanations.js';
import { SUPPLIER_POLICY, SUPPLIER_PRIORITY } from './policies.js';
import {
  type ConfidenceLevel,
  type SupplierEvidence,
  type SupplierFacts,
  type SupplierResult,
  type SupplierStability,
} from './types.js';

const P = SUPPLIER_POLICY;

/**
 * The 90th percentile of the observed lead times, by **nearest rank**.
 *
 * `sorted[ceil(0.9 × n) − 1]`, so the answer is always a delivery time that
 * actually happened and can be pointed at in the observation list. Linear
 * interpolation would be the other defensible choice — it is what
 * `percentile_cont` does — but it reports a number no order ever took, and a
 * reader auditing the figure would not find it anywhere in the evidence.
 *
 * Rank arithmetic is exact integer maths; the percentile never touches a float.
 */
export function percentile90(values: readonly string[]): string | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => compare(a, b));
  // ceil(0.9 * n) = ceil(9n / 10), computed in integers.
  const rank = Number((9n * BigInt(sorted.length) + 9n) / 10n);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;

  return sorted[index] ?? null;
}

/**
 * Coefficient of variation of the delivery times, or `null` when there are too
 * few observations to say anything.
 *
 * Below the minimum sample count the result is `null` rather than a number,
 * because two deliveries give a spread but not a distribution.
 *
 * One special case: when every observation is identical the variance is zero,
 * which the shared helper reports as `null` because it divides a zero mean. That
 * is the *most* consistent record a supplier can have — not a missing one — so
 * it is read as zero variability rather than as no evidence.
 */
export function supplierCoefficientOfVariation(
  values: readonly string[],
): bigint | null {
  if (values.length < P.minimumSamplesForVariability) return null;

  const scaled = values.map((value) => toScaled(value));
  const total = scaled.reduce((sum, value) => sum + value, 0n);

  if (total === 0n) return 0n;

  // The second argument is the population size, which here is the number of
  // observations — the same quantity the Demand Engine passes as its window.
  return coefficientOfVariation(scaled, values.length);
}

/**
 * Classify delivery-time consistency.
 *
 * `INSUFFICIENT_DATA` first: a verdict about consistency cannot be reached
 * without enough deliveries to have one.
 */
export function classifySupplierStability(coefficient: bigint | null): SupplierStability {
  if (coefficient === null) return 'INSUFFICIENT_DATA';
  if (compareScaled(coefficient, toScaled(P.stableMaxCoefficientOfVariation)) <= 0) {
    return 'STABLE';
  }
  return 'VARIABLE';
}

/**
 * Confidence in the supplier-performance evidence, counted in completed orders.
 *
 * Deliberately independent of the Demand Intelligence ladder: a supplier with
 * six clean deliveries is well-measured even though we know nothing about the
 * demand for what it supplies.
 */
export function assessSupplierConfidence(completedPOCount: number): ConfidenceLevel {
  const c = P.confidence;

  if (completedPOCount < c.insufficientBelowCompletedOrders) return 'INSUFFICIENT';
  if (completedPOCount < c.lowBelowCompletedOrders) return 'LOW';
  if (completedPOCount < c.mediumBelowCompletedOrders) return 'MEDIUM';
  return 'HIGH';
}

/** Render a quantity for a sentence: `12.50` reads as `12.5`, `120.00` as `120`. */
function formatQuantity(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction === '') return whole;
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed === '' ? whole : `${whole}.${trimmed}`;
}

/**
 * The explanation, assembled from fixed templates.
 *
 * It states the arithmetic and stops. It never calls a supplier good or bad,
 * never blames one for a cancellation, and never suggests replacing, rewarding
 * or penalising them — those are judgements and actions for later modules.
 */
function buildReason(
  facts: SupplierFacts,
  stability: SupplierStability,
  options: {
    medianLeadTimeDays: string | null;
    p90LeadTimeDays: string | null;
    coefficient: bigint | null;
  },
): string {
  const completed = facts.completedPOCount;
  const parts: string[] = [];

  parts.push(
    completed === 0
      ? 'No completed purchase orders, so no delivery speed has been measured'
      : `${completed} completed purchase order${completed === 1 ? '' : 's'}, ` +
          `with a median delivery time of ${formatQuantity(options.medianLeadTimeDays ?? '0')} days ` +
          `and a 90th-percentile delivery time of ${formatQuantity(options.p90LeadTimeDays ?? '0')} days`,
  );

  if (options.coefficient === null) {
    parts.push(
      `fewer than ${P.minimumSamplesForVariability} completed orders with usable timestamps, ` +
        `so consistency is not reported`,
    );
  } else {
    parts.push(
      `delivery times vary by ${formatQuantity(fromScaled(options.coefficient, 2))} of the average, ` +
        `which is ${stability === 'STABLE' ? 'within' : 'above'} the ` +
        `${P.stableMaxCoefficientOfVariation} limit for consistent delivery`,
    );
  }

  if (facts.openPOCount > 0) {
    parts.push(
      `${facts.openPOCount} purchase order${facts.openPOCount === 1 ? ' is' : 's are'} still open`,
    );
  }

  if (facts.cancelledPOCount > 0) {
    parts.push(
      `${facts.cancelledPOCount} purchase order${facts.cancelledPOCount === 1 ? ' was' : 's were'} cancelled, ` +
        `which says nothing about the supplier on its own`,
    );
  }

  return `${parts.join('. ')}.`;
}

/**
 * Assess a supplier's historical receiving speed and consistency.
 *
 * @throws {InvalidDecimalError} when a supplied figure is not a valid decimal.
 * That is corrupt input, and is reported rather than silently treated as zero.
 */
export function assessSupplier(facts: SupplierFacts): SupplierResult {
  const leadTimes = [...facts.leadTimeDays];
  const sampleCount = leadTimes.length;

  const sorted = [...leadTimes].sort((a, b) => compare(a, b));
  const medianLeadTimeDays = median(leadTimes);
  const p90LeadTimeDays = percentile90(leadTimes);

  const coefficient = supplierCoefficientOfVariation(leadTimes);
  const stability = classifySupplierStability(coefficient);

  const evidence: SupplierEvidence = {
    completedPOCount: facts.completedPOCount,
    leadTimeSampleCount: sampleCount,
    minimumSamplesForVariability: P.minimumSamplesForVariability,
    stableMaxCoefficientOfVariation: P.stableMaxCoefficientOfVariation,
    minLeadTimeDays: sorted[0] ?? null,
    maxLeadTimeDays: sorted[sorted.length - 1] ?? null,
    hasPromisedDeliveryDate: false,
  };

  // Built without its explanation, then enriched from the finished result so the
  // evidence can never describe a calculation the engine did not perform.
  const result: Omit<SupplierResult, 'explanation'> = {
    supplierId: facts.supplierId,
    supplierName: facts.supplierName,
    isActive: facts.isActive,

    completedPOCount: facts.completedPOCount,
    openPOCount: facts.openPOCount,
    cancelledPOCount: facts.cancelledPOCount,
    draftPOCount: facts.draftPOCount,

    totalUnitsOrdered: facts.totalUnitsOrdered,
    totalUnitsReceived: facts.totalUnitsReceived,

    medianLeadTimeDays,
    p90LeadTimeDays,
    leadTimeSampleCount: sampleCount,
    leadTimeCV: coefficient === null ? null : fromScaled(coefficient, 2),

    stability,
    priority: SUPPLIER_PRIORITY[stability],
    confidence: assessSupplierConfidence(facts.completedPOCount),

    reason: buildReason(facts, stability, {
      medianLeadTimeDays,
      p90LeadTimeDays,
      coefficient,
    }),
    evidence,
  };

  // Evidence is read from the finished result, so it can never describe a calculation
  // this engine did not actually perform.
  return { ...result, explanation: explainSupplier(facts, result) };
}

// Re-exported so callers get the policy and the vocabulary from the same module
// as the engine, mirroring every other engine in this layer.
export { SUPPLIER_POLICY, SUPPLIER_PRIORITY } from './policies.js';
export { SUPPLIER_STABILITIES } from './types.js';
export type { SupplierPriority } from './policies.js';
export type {
  SupplierEvidence,
  SupplierFacts,
  SupplierLeadTimeObservation,
  SupplierResult,
  SupplierStability,
} from './types.js';