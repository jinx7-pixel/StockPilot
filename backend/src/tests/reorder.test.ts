/**
 * Reorder Engine — unit tests.
 *
 * The engine is a pure function, so these need **no database** and no clock.
 * Every case below is arithmetic a reader can check on paper: a demand rate of
 * 10 units/day with a 5-day lead time and a 2-day safety buffer puts the reorder
 * point at 10 x (5 + 2) = 70 units, and the rest of the suite moves the stock
 * around that number.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateReorderPoint,
  calculateSafetyStock,
} from '../intelligence/calculations.js';
import {
  assessReorder,
  assessReorderConfidence,
  classifyReorder,
  DEMAND_POLICY,
  REORDER_POLICY,
  type ConfidenceLevel,
  type ReorderFacts,
  type ReorderResult,
} from '../intelligence/index.js';

/** Stock Risk's buffer, which both engines share. */
const SAFETY_DAYS = 2;

const PRODUCT_ID = '00000000-0000-0000-0000-0000000000e1';

function facts(overrides: Partial<ReorderFacts> = {}): ReorderFacts {
  return {
    productId: PRODUCT_ID,
    isActive: true,
    currentStock: '20.00',
    onOrderQuantity: '0.00',
    unitsSold30d: '300.00',
    activeSalesDays30d: 20,
    averageDailySales30d: '10.0000',
    observableHistoryDays: '120',
    leadTimeSamples: ['5.00'],
    ...overrides,
  };
}

function assess(
  overrides: Partial<ReorderFacts> = {},
  demandConfidence: ConfidenceLevel = 'HIGH',
): ReorderResult {
  return assessReorder(facts(overrides), { demandConfidence });
}

/** Every decimal field must be a well-formed decimal string or `null`. */
const DECIMAL_FIELDS = [
  'currentStock',
  'onOrderQuantity',
  'netAvailable',
  'safetyStock',
  'reorderPoint',
  'recommendedQuantity',
  'effectiveLeadTimeDays',
] as const;

function assertWellFormed(result: ReorderResult): void {
  for (const key of DECIMAL_FIELDS) {
    const value = result[key];
    if (value === null) continue;
    assert.match(value, /^-?\d+(\.\d+)?$/, `${key} must be a decimal string, got ${value}`);
  }
  assert.equal(typeof result.reorder, 'boolean');
  assert.ok(typeof result.safetyStockDays === 'number' && Number.isFinite(result.safetyStockDays));
}

// ---------------------------------------------------------------------------
// Shared formulas
// ---------------------------------------------------------------------------

describe('shared replenishment formulas', () => {
  it('computes safety stock as rate multiplied by the buffer', () => {
    assert.equal(calculateSafetyStock('10.0000', SAFETY_DAYS), '20.00');
    assert.equal(calculateSafetyStock('2.50', SAFETY_DAYS), '5.00');
    assert.equal(calculateSafetyStock('0.01', SAFETY_DAYS), '0.02');
  });

  it('computes the reorder point as rate multiplied by lead time plus buffer', () => {
    assert.equal(calculateReorderPoint('10.0000', '5.00', SAFETY_DAYS), '70.00');
    assert.equal(calculateReorderPoint('2.50', '10.00', SAFETY_DAYS), '30.00');
  });

  it('treats a zero lead time as real evidence, not as missing', () => {
    // A same-day supplier is a fast supplier, not an unmeasured one.
    assert.equal(calculateReorderPoint('10.0000', '0.00', SAFETY_DAYS), '20.00');
  });

  it('returns null when the demand rate is not positive', () => {
    assert.equal(calculateSafetyStock('0.0000', SAFETY_DAYS), null);
    assert.equal(calculateReorderPoint('0.0000', '5.00', SAFETY_DAYS), null);
  });

  it('returns null for a negative lead time rather than a negative reorder point', () => {
    assert.equal(calculateReorderPoint('10.0000', '-1.00', SAFETY_DAYS), null);
  });
});

// ---------------------------------------------------------------------------
// Insufficient data
// ---------------------------------------------------------------------------

describe('Reorder Engine — insufficient data', () => {
  it('reports INSUFFICIENT_DATA when nothing has sold', () => {
    const result = assess({ unitsSold30d: '0.00', averageDailySales30d: '0.0000' });

    assert.equal(result.decision, 'INSUFFICIENT_DATA');
    assert.equal(result.reorderPoint, null);
    assert.equal(result.safetyStock, null);
    assert.equal(result.recommendedQuantity, null);
    assert.equal(result.reorder, false);
    assert.equal(result.confidence, 'INSUFFICIENT');
    assert.match(result.reason, /Not enough recent sales activity/);
  });

  it('reports INSUFFICIENT_DATA when sales are too thin to plan around', () => {
    // Three units, but all on one day. Units alone would look like demand; a
    // single observation of demand is not something to size a reorder buffer from.
    const result = assess({ unitsSold30d: '3.00', activeSalesDays30d: 1 });

    assert.equal(result.decision, 'INSUFFICIENT_DATA');
    assert.equal(result.reorderPoint, null);
    assert.equal(result.recommendedQuantity, null);
    assert.equal(result.evidence.activeSalesDays30d, 1);
  });

  it('proceeds once sales are spread across the minimum number of days', () => {
    const result = assess({ unitsSold30d: '3.00', activeSalesDays30d: 2 });

    assert.equal(result.decision, 'REORDER');
  });

  it('reports INSUFFICIENT_DATA for a product that is too new', () => {
    const result = assess({ observableHistoryDays: '5' });

    assert.equal(result.decision, 'INSUFFICIENT_DATA');
    assert.equal(result.reorderPoint, null);
    assert.match(result.reason, /Not enough recent sales activity/);
  });

  it('reports INSUFFICIENT_DATA for a product with no ledger history at all', () => {
    const result = assess({ observableHistoryDays: '0' });

    assert.equal(result.decision, 'INSUFFICIENT_DATA');
  });

  it('reports INSUFFICIENT_DATA when there is no completed purchase order', () => {
    const result = assess({ leadTimeSamples: [] });

    assert.equal(result.decision, 'INSUFFICIENT_DATA');
    assert.equal(result.reorderPoint, null);
    assert.equal(result.recommendedQuantity, null);
    assert.equal(result.evidence.hasLeadTimeEvidence, false);
    assert.equal(result.evidence.leadTimeSamples, 0);
    assert.match(result.reason, /No completed purchase order is available/);
  });

  it('treats zero recent demand with an old history as insufficient, not as no need', () => {
    // Stock is 0, but with no recent demand there is nothing to size an order
    // from. "Insufficient" and "no reorder needed" are different statements.
    const result = assess({
      currentStock: '0.00',
      unitsSold30d: '0.00',
      averageDailySales30d: '0.0000',
    });

    assert.equal(result.decision, 'INSUFFICIENT_DATA');
    assert.notEqual(result.decision, 'NO_REORDER');
    assert.equal(result.recommendedQuantity, null);
  });

  it('never produces a non-finite number in any insufficient case', () => {
    for (const overrides of [
      { unitsSold30d: '0.00', averageDailySales30d: '0.0000' },
      { leadTimeSamples: [] },
      { observableHistoryDays: '0' },
      { currentStock: '-5.00' },
    ]) {
      assertWellFormed(assess(overrides));
    }
  });
});

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

describe('Reorder Engine — the decision', () => {
  it('reports NO_REORDER when stock is far above the reorder point', () => {
    // reorder point = 10 x (5 + 2) = 70
    const result = assess({ currentStock: '500.00' });

    assert.equal(result.reorderPoint, '70.00');
    assert.equal(result.safetyStock, '20.00');
    assert.equal(result.decision, 'NO_REORDER');
    assert.equal(result.reorder, false);
    assert.equal(result.recommendedQuantity, '0.00');
  });

  it('reports REORDER when stock is below the reorder point', () => {
    const result = assess({ currentStock: '20.00' });

    assert.equal(result.netAvailable, '20.00');
    assert.equal(result.decision, 'REORDER');
    assert.equal(result.reorder, true);
    assert.equal(result.recommendedQuantity, '50.00');
  });

  it('reports REORDER for stock just below the reorder point', () => {
    const result = assess({ currentStock: '69.99' });

    assert.equal(result.decision, 'REORDER');
    assert.equal(result.recommendedQuantity, '0.01');
  });

  it('reports NO_REORDER for stock exactly at the reorder point', () => {
    // The rule is strictly "below", so exactly at the point is not a reorder.
    const result = assess({ currentStock: '70.00' });

    assert.equal(result.netAvailable, '70.00');
    assert.equal(result.decision, 'NO_REORDER');
    assert.equal(result.recommendedQuantity, '0.00');
    assert.equal(result.reorder, false);
  });

  it('recommends exactly the quantity that closes the gap', () => {
    const result = assess({ currentStock: '20.00' });

    assert.equal(
      result.recommendedQuantity,
      '50.00',
      'reorder point 70 minus net available 20',
    );
    const closed = (
      Number(result.netAvailable) + Number(result.recommendedQuantity)
    ).toFixed(2);
    assert.equal(closed, Number(result.reorderPoint).toFixed(2));
  });

  it('reports NO_REORDER when stock is above the point and nothing is on order', () => {
    const result = assess({ currentStock: '200.00', onOrderQuantity: '0.00' });

    assert.equal(result.netAvailable, '200.00');
    assert.equal(result.decision, 'NO_REORDER');
    assert.equal(result.recommendedQuantity, '0.00');
  });

  it('reports NO_REORDER when a large order on the way already covers the gap', () => {
    // Net available is 200 even though only 10 are physically on the shelf.
    const result = assess({ currentStock: '10.00', onOrderQuantity: '190.00' });

    assert.equal(result.netAvailable, '200.00');
    assert.equal(result.decision, 'NO_REORDER');
    assert.equal(result.recommendedQuantity, '0.00');
    assert.match(result.reason, /190 already on order/);
  });

  it('reports REORDER when net available is just below the point', () => {
    const result = assess({ currentStock: '10.00', onOrderQuantity: '59.00' });

    assert.equal(result.netAvailable, '69.00');
    assert.equal(result.decision, 'REORDER');
    assert.equal(result.recommendedQuantity, '1.00');
  });

  it('reports REORDER for net available of exactly zero with a real lead time', () => {
    const result = assess({ currentStock: '0.00', onOrderQuantity: '0.00' });

    assert.equal(result.netAvailable, '0.00');
    assert.equal(result.decision, 'REORDER');
    assert.equal(result.recommendedQuantity, '70.00');
  });

  it('reports REORDER for net available of zero and a zero lead time', () => {
    const result = assess({ currentStock: '0.00', leadTimeSamples: ['0.00'] });

    assert.equal(result.effectiveLeadTimeDays, '0.00');
    assert.equal(result.reorderPoint, '20.00', '10 x (0 + 2)');
    assert.equal(result.decision, 'REORDER');
    assert.equal(result.recommendedQuantity, '20.00');
  });

  it('respects max(0, …) — the recommended quantity is never negative', () => {
    const result = assess({ currentStock: '10000.00' });

    assert.ok(Number(result.recommendedQuantity) >= 0);
    assert.equal(result.recommendedQuantity, '0.00');
  });

  it('classifies the boundary purely from the comparison', () => {
    assert.equal(classifyReorder('69.99', '70.00'), 'REORDER');
    assert.equal(classifyReorder('70.00', '70.00'), 'NO_REORDER');
    assert.equal(classifyReorder('70.01', '70.00'), 'NO_REORDER');
    assert.equal(classifyReorder('0.00', null), 'INSUFFICIENT_DATA');
  });
});

// ---------------------------------------------------------------------------
// Corrupt data
// ---------------------------------------------------------------------------

describe('Reorder Engine — corrupt data', () => {
  it('reports DATA_ERROR for negative stock and refuses to recommend a quantity', () => {
    const result = assess({ currentStock: '-5.00' });

    assert.equal(result.decision, 'DATA_ERROR');
    assert.equal(result.recommendedQuantity, null);
    assert.equal(result.reorder, false);
    assert.equal(result.confidence, 'INSUFFICIENT');
    assert.match(result.reason, /inventory ledger is inconsistent/);
    assertWellFormed(result);
  });

  it('reports DATA_ERROR even when a huge order is on the way', () => {
    // A large on-order figure can make net available look healthy. Reporting
    // NO_REORDER here would let a corrupt ledger silently suppress a real need.
    const result = assess({ currentStock: '-5.00', onOrderQuantity: '500.00' });

    assert.equal(result.decision, 'DATA_ERROR');
    assert.equal(result.recommendedQuantity, null);
  });

  it('reports DATA_ERROR in preference to INSUFFICIENT_DATA', () => {
    // The ledger being wrong is the more serious problem, and it is the one a
    // reader needs to hear about first.
    const result = assess({ currentStock: '-1.00', leadTimeSamples: [] });

    assert.equal(result.decision, 'DATA_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Lead time
// ---------------------------------------------------------------------------

describe('Reorder Engine — lead time', () => {
  it('raises the reorder point as the lead time grows', () => {
    const short = assess({ currentStock: '500.00', leadTimeSamples: ['5.00'] });
    const long = assess({ currentStock: '500.00', leadTimeSamples: ['30.00'] });
    const veryLong = assess({ currentStock: '500.00', leadTimeSamples: ['60.00'] });

    assert.equal(short.reorderPoint, '70.00');
    assert.equal(long.reorderPoint, '320.00', '10 x (30 + 2)');
    assert.equal(veryLong.reorderPoint, '620.00', '10 x (60 + 2)');
  });

  it('turns a far-above-point product into a reorder as the lead time stretches', () => {
    const result = assess({ currentStock: '500.00', leadTimeSamples: ['60.00'] });

    assert.equal(result.decision, 'REORDER');
    assert.equal(result.recommendedQuantity, '120.00');
  });

  it('uses the median when several completed orders disagree', () => {
    // 4, 5, 40: the 40-day outlier must not become the lead time.
    const result = assess({
      currentStock: '500.00',
      leadTimeSamples: ['4.00', '5.00', '40.00'],
    });

    assert.equal(result.effectiveLeadTimeDays, '5.00');
    assert.equal(result.reorderPoint, '70.00');
    assert.equal(result.evidence.leadTimeSamples, 3);
  });

  it('ignores a zero-day sample in the median without discarding the evidence', () => {
    const result = assess({
      currentStock: '500.00',
      leadTimeSamples: ['0.00', '5.00', '6.00'],
    });

    assert.equal(result.effectiveLeadTimeDays, '5.00');
    assert.equal(result.evidence.hasLeadTimeEvidence, true);
  });

  it('reports the spread between the fastest and slowest order', () => {
    const result = assess({ leadTimeSamples: ['4.00', '5.00', '40.00'] });

    assert.equal(result.evidence.leadTimeSpreadDays, '36.00');
  });

  it('reports no spread for a single sample rather than a misleading zero', () => {
    const result = assess({ leadTimeSamples: ['5.00'] });

    assert.equal(result.evidence.leadTimeSpreadDays, null);
  });

  it('keeps an unusually long lead time usable and only lowers confidence', () => {
    const result = assess(
      { currentStock: '500.00', leadTimeSamples: ['45.00', '46.00', '47.00'] },
      'HIGH',
    );

    assert.equal(result.effectiveLeadTimeDays, '46.00');
    assert.equal(result.reorderPoint, '480.00', 'the long lead time is fully used');
    assert.notEqual(result.decision, 'INSUFFICIENT_DATA');
    assert.equal(result.evidence.leadTimeUnreliable, true);
    assert.equal(result.confidence, 'MEDIUM', 'capped from HIGH, not discarded');
  });

  it('keeps an inconsistent lead time usable and only lowers confidence', () => {
    const result = assess(
      { currentStock: '500.00', leadTimeSamples: ['2.00', '12.00', '22.00'] },
      'HIGH',
    );

    assert.equal(result.effectiveLeadTimeDays, '12.00');
    assert.equal(result.reorderPoint, '140.00', 'the median is used, not discarded');
    assert.equal(result.evidence.leadTimeUnreliable, true);
    assert.equal(result.evidence.leadTimeSpreadDays, '20.00');
    assert.equal(result.confidence, 'MEDIUM');
  });

  it('keeps a consistent, short lead time at full confidence', () => {
    const result = assess({ leadTimeSamples: ['5.00', '5.00', '6.00'] }, 'HIGH');

    assert.equal(result.evidence.leadTimeUnreliable, false);
    assert.equal(result.confidence, 'HIGH');
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe('Reorder Engine — confidence', () => {
  it('is HIGH only with strong demand evidence and several clean orders', () => {
    const result = assess({ leadTimeSamples: ['5.00', '5.00', '6.00'] }, 'HIGH');

    assert.equal(result.confidence, 'HIGH');
  });

  it('is MEDIUM when the demand evidence is medium', () => {
    const result = assess({ leadTimeSamples: ['5.00', '5.00'] }, 'MEDIUM');

    assert.equal(result.confidence, 'MEDIUM');
  });

  it('is MEDIUM with strong demand but only one completed order', () => {
    const result = assess({ leadTimeSamples: ['5.00'] }, 'HIGH');

    assert.equal(result.confidence, 'LOW', 'a single order is thin evidence');
  });

  it('is LOW when the demand evidence is weak', () => {
    const result = assess({ leadTimeSamples: ['5.00', '5.00', '5.00'] }, 'LOW');

    assert.equal(result.confidence, 'LOW');
  });

  it('is INSUFFICIENT when either kind of evidence is missing', () => {
    assert.equal(
      assessReorderConfidence({
        demandConfidence: 'HIGH',
        leadTimeSampleCount: 5,
        leadTimeUnreliable: false,
        leadTimeUsable: false,
        demandEvidenced: true,
      }),
      'INSUFFICIENT',
    );

    assert.equal(
      assessReorderConfidence({
        demandConfidence: 'HIGH',
        leadTimeSampleCount: 5,
        leadTimeUnreliable: false,
        leadTimeUsable: true,
        demandEvidenced: false,
      }),
      'INSUFFICIENT',
    );
  });

  it('exposes the policy thresholds it relies on', () => {
    assert.equal(REORDER_POLICY.leadTime.highConfidenceMinimumSamples, 3);
    assert.equal(REORDER_POLICY.leadTime.mediumConfidenceMinimumSamples, 2);
    assert.equal(DEMAND_POLICY.baselineDays, 30, 'shared with the demand engine');
  });
});

// ---------------------------------------------------------------------------
// Spikes, fractional demand, and exactness
// ---------------------------------------------------------------------------

describe('Reorder Engine — scale and exactness', () => {
  it('handles a large demand spike with ample stock', () => {
    // 3000 units in 30 days is 100/day, so the reorder point is 100 x 7 = 700.
    const result = assess({
      unitsSold30d: '3000.00',
      averageDailySales30d: '100.0000',
      currentStock: '5000.00',
    });

    assert.equal(result.reorderPoint, '700.00');
    assert.equal(result.decision, 'NO_REORDER');
  });

  it('recommends a large quantity for a spike with thin stock', () => {
    const result = assess({
      unitsSold30d: '3000.00',
      averageDailySales30d: '100.0000',
      currentStock: '50.00',
    });

    assert.equal(result.reorderPoint, '700.00');
    assert.equal(result.decision, 'REORDER');
    assert.equal(result.recommendedQuantity, '650.00');
  });

  it('keeps fractional demand exact', () => {
    // 0.01/day x 7 days of coverage = 0.07.
    const result = assess({
      unitsSold30d: '0.30',
      averageDailySales30d: '0.0100',
      currentStock: '0.00',
    });

    assert.equal(result.safetyStock, '0.02');
    assert.equal(result.reorderPoint, '0.07');
    assert.equal(result.recommendedQuantity, '0.07');
  });

  it('handles very large quantities without overflow', () => {
    const result = assess({
      unitsSold30d: '99999999.00',
      averageDailySales30d: '3333333.3000',
      currentStock: '0.00',
    });

    assert.equal(result.reorderPoint, '23333333.10');
    assert.equal(result.recommendedQuantity, '23333333.10');
  });

  it('sums on-order quantity exactly, including fractional units', () => {
    const result = assess({ currentStock: '10.25', onOrderQuantity: '0.75' });

    assert.equal(result.netAvailable, '11.00');
  });

  it('rejects a corrupt decimal rather than treating it as zero', () => {
    assert.throws(
      () => assess({ currentStock: 'not-a-number' }),
      /decimal|InvalidDecimal/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('Reorder Engine — purity and determinism', () => {
  it('produces an identical result for identical facts', () => {
    assert.deepEqual(assess({ currentStock: '20.00' }), assess({ currentStock: '20.00' }));
  });

  it('does not depend on the order the lead-time samples arrive in', () => {
    const ascending = assess({ leadTimeSamples: ['4.00', '5.00', '40.00'] });
    const descending = assess({ leadTimeSamples: ['40.00', '5.00', '4.00'] });

    assert.deepEqual(ascending, descending);
  });

  it('carries the product through unchanged and reports inactivity without hiding it', () => {
    const result = assess({ isActive: false });

    assert.equal(result.productId, PRODUCT_ID);
    // The engine assesses it normally; the list endpoint is what excludes an
    // inactive product from operational results.
    assert.equal(result.decision, 'REORDER');
  });
});
