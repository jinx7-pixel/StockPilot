/**
 * Slow / Dead Stock Detection Engine.
 *
 * A **pure function** from structured facts to a `SlowDeadResult`. No SQL, no
 * HTTP, no clock, no randomness — the same facts always produce the same result.
 *
 * The question it answers:
 *
 * > Is this product's historical demand unusually slow, or has it had no
 * > meaningful demand for a sustained period while still holding inventory?
 *
 * Three rules, evaluated in a fixed order, and the order is the whole design:
 *
 *   1. **Not enough history to judge** → `INSUFFICIENT_DATA`. A product created
 *      last week that has never sold is "dead" by the letter of the data and
 *      wrong by the meaning of the word. Every new product looks identical until
 *      it has had time to fail on its own.
 *   2. **No inventory held** → `NORMAL`. This module exists to find problematic
 *      stock *currently being held*. A product with nothing on the shelf has no
 *      slow-stock problem, whatever its demand history says.
 *   3. **No sales in the window** → `DEAD`.
 *   4. **Sales on too few days** → `SLOW`.
 *   5. Otherwise `NORMAL`.
 *
 * ## Three concepts, kept apart
 *
 * `OVERSTOCK` measures days of cover; `SLOW` measures how *infrequently* demand
 * arrives; `DEAD` measures inventory held against no demand at all. A fast-moving
 * product can be badly overstocked, and a slow one can be perfectly covered.
 * Collapsing them into a single "not moving well" score would hide both, so each
 * rule here tests only its own concept.
 *
 * ## Corrupt inventory
 *
 * A negative ledger balance throws {@link DataError}, exactly as the Stock Risk
 * Engine does for the same corruption. It is deliberately *not* mapped onto one
 * of the four public statuses: a corrupt balance reported as `NORMAL` would read
 * as "checked and fine", which is the most dangerous possible answer.
 */

import { isPositive, toScaled } from './decimal.js';
import { SLOW_DEAD_POLICY, SLOW_DEAD_PRIORITY } from './policies.js';
import {
  DataError,
  type ConfidenceLevel,
  type SlowDeadEvidence,
  type SlowDeadFacts,
  type SlowDeadResult,
  type SlowDeadStatus,
} from './types.js';

const P = SLOW_DEAD_POLICY;

/**
 * Render a quantity for a sentence: `12.50` reads as `12.5`, `12.00` as `12`.
 *
 * Only the fractional part is trimmed. Stripping trailing zeros from the whole
 * string would turn `120` into `12`, which is how "120 days of observable
 * history" becomes a confidently wrong sentence.
 */
function formatQuantity(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction === '') return whole;
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed === '' ? whole : `${whole}.${trimmed}`;
}

/**
 * Classify a product.
 *
 * The order below is the contract. Every early return states which rule fired,
 * and the rule is carried into the evidence so a reader can see why.
 */
export function classifySlowDead(facts: SlowDeadFacts): {
  status: SlowDeadStatus;
  basis: string;
  hasSufficientHistory: boolean;
  holdsInventory: boolean;
} {
  // Compared directly as scaled values: `compareScaled` reports a sign, not a
  // magnitude, so it cannot answer "is this at least N days".
  const observableHistory = toScaled(facts.observableHistoryDays);
  const stock = toScaled(facts.currentStock);

  const hasSufficientHistory = observableHistory >= toScaled(P.minimumObservableDays);
  const holdsInventory = stock > 0n;

  if (!hasSufficientHistory) {
    return {
      status: 'INSUFFICIENT_DATA',
      basis: `observable history below ${P.minimumObservableDays} days`,
      hasSufficientHistory,
      holdsInventory,
    };
  }

  if (!holdsInventory) {
    return {
      status: 'NORMAL',
      basis: 'no inventory currently held',
      hasSufficientHistory,
      holdsInventory,
    };
  }

  if (!isPositive(facts.unitsSold90d)) {
    return {
      status: 'DEAD',
      basis: `no sales in the ${P.analysisWindowDays}-day window`,
      hasSufficientHistory,
      holdsInventory,
    };
  }

  if (facts.activeSalesDays90d <= P.slowMaxActiveSalesDays) {
    return {
      status: 'SLOW',
      basis: `sales on ${facts.activeSalesDays90d} active day(s), at or below ${P.slowMaxActiveSalesDays}`,
      hasSufficientHistory,
      holdsInventory,
    };
  }

  return {
    status: 'NORMAL',
    basis: `sales on ${facts.activeSalesDays90d} active days, above ${P.slowMaxActiveSalesDays}`,
    hasSufficientHistory,
    holdsInventory,
  };
}

/**
 * The explanation, assembled from fixed templates.
 *
 * It states the rule that fired and the figures behind it. It never says what to
 * do about the stock: no markdown, no return, no recommendation. Those belong
 * to recommendation and action modules, and naming one here would make an
 * assessment look like advice.
 */
function buildReason(
  status: SlowDeadStatus,
  facts: SlowDeadFacts,
): string {
  const stock = formatQuantity(facts.currentStock);
  const history = formatQuantity(facts.observableHistoryDays);

  switch (status) {
    case 'INSUFFICIENT_DATA':
      return (
        `This product has been observable for only ${history} day(s), below the ` +
        `${P.minimumObservableDays} days needed to tell slow demand from a product ` +
        `that has simply not had time to sell. No conclusion is drawn.`
      );

    case 'DEAD':
      return (
        `No units have sold in the last ${P.analysisWindowDays} days, and ${stock} ` +
        `unit(s) are still held, after ${history} day(s) of observable history. ` +
        `This inventory is not moving.`
      );

    case 'SLOW':
      return (
        `Demand is infrequent: ${facts.activeSalesDays90d} sale day(s) out of ` +
        `${P.analysisWindowDays}, at or below the ${P.slowMaxActiveSalesDays}-day limit, ` +
        `with ${formatQuantity(facts.unitsSold90d)} unit(s) sold in total and ${stock} ` +
        `unit(s) still held.`
      );

    case 'NORMAL':
      return holdsNothing(facts)
        ? `No units have sold in the last ${P.analysisWindowDays} days, but nothing is ` +
          `currently held, so there is no slow or dead inventory to act on.`
        : `Demand is regular: ${facts.activeSalesDays90d} sale days out of ` +
          `${P.analysisWindowDays}, above the ${P.slowMaxActiveSalesDays}-day limit.`;
  }
}

/** True when the product has sold nothing and is holding nothing. */
function holdsNothing(facts: SlowDeadFacts): boolean {
  return !isPositive(facts.unitsSold90d) && toScaled(facts.currentStock) <= 0n;
}

/**
 * Assess whether a product's held inventory is slow or dead.
 *
 * @throws {DataError} when the ledger balance is negative. That is corrupt
 * input, and the Stock Risk Engine already reports it the same way. Returning
 * `NORMAL` for a corrupt balance would present an uninspected product as
 * checked-and-fine.
 */
export function assessSlowDead(
  facts: SlowDeadFacts,
  options: { confidence: ConfidenceLevel },
): SlowDeadResult {
  if (toScaled(facts.currentStock) < 0n) {
    throw new DataError(
      'Cannot assess slow or dead stock: the inventory ledger balance is negative.',
    );
  }

  const { status, basis, hasSufficientHistory, holdsInventory } = classifySlowDead(facts);

  const evidence: SlowDeadEvidence = {
    analysisWindowDays: P.analysisWindowDays,
    minimumObservableDays: P.minimumObservableDays,
    slowMaxActiveSalesDays: P.slowMaxActiveSalesDays,
    holdsInventory,
    hasSufficientHistory,
    classificationBasis: basis,
  };

  return {
    productId: facts.productId,
    status,
    priority: SLOW_DEAD_PRIORITY[status],
    currentStock: facts.currentStock,
    unitsSold90d: facts.unitsSold90d,
    activeSalesDays90d: facts.activeSalesDays90d,
    averageDailySales90d: facts.averageDailySales90d,
    analysisWindowDays: P.analysisWindowDays,
    confidence: options.confidence,
    reason: buildReason(status, facts),
    evidence,
  };
}

// Re-exported so callers get the policy and the vocabulary from the same module
// as the engine, mirroring `demand.ts`, `reorder.ts` and `overstock.ts`.
export { SLOW_DEAD_POLICY, SLOW_DEAD_PRIORITY } from './policies.js';
export { SLOW_DEAD_STATUSES } from './types.js';
export type { SlowDeadPriority } from './policies.js';
export type {
  SlowDeadEvidence,
  SlowDeadFacts,
  SlowDeadResult,
  SlowDeadStatus,
} from './types.js';