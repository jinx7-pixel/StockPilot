/**
 * Supplier Intelligence Engine — unit tests.
 *
 * The engine is a pure function, so these need **no database** and no clock.
 *
 * The CV fixtures are chosen so the arithmetic can be checked on paper. Six
 * deliveries of 5, 6, 5, 7, 6, 5 days have a mean of 5.6667 and a standard
 * deviation of about 0.8165, giving a coefficient of variation of about 0.1441 —
 * comfortably STABLE. Six deliveries of 5, 20, 7, 25, 6, 22 have a mean of 14.167
 * and a standard deviation of about 8.61, giving roughly 0.607 — VARIABLE.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessSupplier,
  assessSupplierConfidence,
  classifySupplierStability,
  percentile90,
  SUPPLIER_POLICY,
  SUPPLIER_PRIORITY,
  supplierCoefficientOfVariation,
  type ConfidenceLevel,
  type SupplierFacts,
  type SupplierResult,
} from '../intelligence/index.js';
import { toScaled } from '../intelligence/decimal.js';

const P = SUPPLIER_POLICY;
const SUPPLIER_ID = '00000000-0000-0000-0000-0000000000c1';

/** A supplier with no orders at all. */
function facts(overrides: Partial<SupplierFacts> = {}): SupplierFacts {
  return {
    supplierId: SUPPLIER_ID,
    supplierName: 'ABC Supplies',
    isActive: true,
    completedPOCount: 6,
    openPOCount: 1,
    cancelledPOCount: 0,
    draftPOCount: 0,
    totalUnitsOrdered: '1200.00',
    totalUnitsReceived: '1200.00',
    leadTimeDays: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00'],
    ...overrides,
  };
}

function assess(overrides: Partial<SupplierFacts> = {}): SupplierResult {
  return assessSupplier(facts(overrides));
}

function assertWellFormed(result: SupplierResult): void {
  for (const key of ['totalUnitsOrdered', 'totalUnitsReceived'] as const) {
    assert.match(result[key], /^-?\d+(\.\d+)?$/, `${key} must be a decimal string`);
  }
  for (const key of ['medianLeadTimeDays', 'p90LeadTimeDays', 'leadTimeCV'] as const) {
    const value = result[key];
    if (value === null) continue;
    assert.match(value, /^-?\d+(\.\d+)?$/, `${key} must be a decimal string or null`);
  }
  for (const key of [
    'completedPOCount',
    'openPOCount',
    'cancelledPOCount',
    'draftPOCount',
    'leadTimeSampleCount',
    'priority',
  ] as const) {
    assert.ok(Number.isFinite(result[key]), `${key} must be finite`);
  }
}

// ---------------------------------------------------------------------------
// 1-6: evidence confidence
// ---------------------------------------------------------------------------

describe('Supplier — evidence confidence', () => {
  it('1. zero completed POs -> INSUFFICIENT confidence and INSUFFICIENT_DATA stability', () => {
    const result = assess({
      completedPOCount: 0,
      openPOCount: 2,
      leadTimeDays: [],
    });

    assert.equal(result.confidence, 'INSUFFICIENT');
    assert.equal(result.stability, 'INSUFFICIENT_DATA');
    assert.equal(result.priority, SUPPLIER_PRIORITY.INSUFFICIENT_DATA);
    assert.equal(result.medianLeadTimeDays, null);
    assert.equal(result.p90LeadTimeDays, null);
    assert.equal(result.leadTimeCV, null);
    assert.equal(result.leadTimeSampleCount, 0);
  });

  it('2. one completed PO -> LOW confidence, INSUFFICIENT_DATA stability', () => {
    const result = assess({ completedPOCount: 1, leadTimeDays: ['5.00'] });

    assert.equal(result.confidence, 'LOW');
    assert.equal(result.stability, 'INSUFFICIENT_DATA');
    assert.equal(result.leadTimeCV, null, 'one delivery is not a distribution');
    assert.equal(result.medianLeadTimeDays, '5.00');
  });

  it('3. two completed POs -> LOW confidence, INSUFFICIENT_DATA stability', () => {
    const result = assess({ completedPOCount: 2, leadTimeDays: ['5.00', '9.00'] });

    assert.equal(result.confidence, 'LOW');
    assert.equal(result.stability, 'INSUFFICIENT_DATA');
    assert.equal(result.leadTimeCV, null);
  });

  it('4. exactly 3 completed POs -> variability reported, MEDIUM confidence', () => {
    const result = assess({ completedPOCount: 3, leadTimeDays: ['5.00', '5.00', '5.00'] });

    assert.equal(result.confidence, 'MEDIUM');
    assert.notEqual(result.stability, 'INSUFFICIENT_DATA');
    assert.equal(result.leadTimeCV, '0.00');
    assert.equal(result.stability, 'STABLE');
  });

  it('5. exactly 5 completed POs -> MEDIUM confidence', () => {
    assert.equal(assess({ completedPOCount: 5 }).confidence, 'MEDIUM');
  });

  it('6. exactly 6 completed POs -> HIGH confidence', () => {
    assert.equal(assess({ completedPOCount: 6 }).confidence, 'HIGH');
  });

  it('follows the ladder at every boundary', () => {
    const expected: Array<[number, ConfidenceLevel]> = [
      [0, 'INSUFFICIENT'],
      [1, 'LOW'],
      [2, 'LOW'],
      [3, 'MEDIUM'],
      [5, 'MEDIUM'],
      [6, 'HIGH'],
      [50, 'HIGH'],
    ];

    for (const [count, confidence] of expected) {
      assert.equal(assessSupplierConfidence(count), confidence, `${count} completed POs`);
    }
  });

  it('keeps supplier confidence separate from stability', () => {
    // One delivery: confidently nothing, and no verdict on consistency.
    const thin = assess({ completedPOCount: 1, leadTimeDays: ['5.00'] });
    assert.equal(thin.stability, 'INSUFFICIENT_DATA');
    assert.equal(thin.confidence, 'LOW');

    // Six deliveries that swing wildly: a clear verdict, strong evidence.
    const erratic = assess({ completedPOCount: 6, leadTimeDays: ['1.00', '2.00', '30.00', '31.00', '32.00', '33.00'] });
    assert.equal(erratic.stability, 'VARIABLE');
    assert.equal(erratic.confidence, 'HIGH');
  });

  it('never reuses the Demand Intelligence ladder', () => {
    // Demand confidence is a separate concept entirely; this asserts the
    // supplier ladder answers only to completed orders.
    assert.equal(assessSupplierConfidence(0), 'INSUFFICIENT');
    assert.equal(assessSupplierConfidence(6), 'HIGH');
  });
});

// ---------------------------------------------------------------------------
// 7-12: variability and percentiles
// ---------------------------------------------------------------------------

describe('Supplier — variability and percentiles', () => {
  it('7. a coefficient of variation of exactly 0.25 is STABLE', () => {
    // Asserted on the classifier, where the comparison happens at full
    // precision rather than through a figure rendered at two decimals.
    assert.equal(P.stableMaxCoefficientOfVariation, '0.25');
    assert.equal(classifySupplierStability(toScaled('0.25')), 'STABLE', 'the limit itself');
    assert.equal(classifySupplierStability(toScaled('0.2499')), 'STABLE', 'just under');
    // One unit in the last place of the working scale. Anything finer is
    // truncated away before the comparison, so it would not be a real test.
    assert.equal(classifySupplierStability(toScaled('0.250001')), 'VARIABLE', 'a hair over');
  });

  it('8. a coefficient above 0.25 is VARIABLE', () => {
    assert.equal(classifySupplierStability(supplierCoefficientOfVariation(['1.00', '2.00', '6.00'])), 'VARIABLE');
  });

  it('classifies narrow and wide spreads through the full engine', () => {
    const narrow = assess({ leadTimeDays: ['4.00', '4.00', '4.01'] });
    assert.equal(narrow.stability, 'STABLE');

    const wide = assess({ leadTimeDays: ['4.00', '4.00', '7.01'] });
    assert.equal(wide.stability, 'VARIABLE');
  });

  it('9. consistent lead times -> STABLE', () => {
    const result = assess({ leadTimeDays: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00'] });

    assert.equal(result.stability, 'STABLE');
    assert.equal(result.leadTimeCV, '0.13');
    assert.equal(result.priority, SUPPLIER_PRIORITY.STABLE);
    assert.equal(result.confidence, 'HIGH');
  });

  it('10. highly variable lead times -> VARIABLE', () => {
    const result = assess({ leadTimeDays: ['5.00', '20.00', '7.00', '25.00', '6.00', '22.00'] });

    assert.equal(result.stability, 'VARIABLE');
    assert.equal(result.leadTimeCV, '0.58');
    assert.equal(result.priority, SUPPLIER_PRIORITY.VARIABLE);
    assert.equal(result.confidence, 'HIGH');
  });

  it('11. computes the median of the observed lead times', () => {
    assert.equal(assess({ leadTimeDays: ['5.00', '20.00', '7.00'] }).medianLeadTimeDays, '7.00');
    assert.equal(assess({ leadTimeDays: ['4.00', '6.00'] }).medianLeadTimeDays, '5.00');
  });

  it('12. computes the 90th percentile by nearest rank, an observed value', () => {
    // Nearest rank: ceil(0.9 x n). For 6 values that is the 6th, the maximum.
    assert.equal(assess({ leadTimeDays: ['5.00', '20.00', '7.00', '25.00', '6.00', '22.00'] }).p90LeadTimeDays, '25.00');
    // For 10 values, ceil(9) = the 9th.
    const ten = ['1.00', '2.00', '3.00', '4.00', '5.00', '6.00', '7.00', '8.00', '9.00', '10.00'];
    assert.equal(assess({ leadTimeDays: ten }).p90LeadTimeDays, '9.00');
    // For 3 values, ceil(2.7) = the 3rd.
    assert.equal(percentile90(['4.00', '1.00', '7.00']), '7.00');
  });

  it('returns the 90th percentile of a single observation as that observation', () => {
    assert.equal(percentile90(['12.50']), '12.50');
    assert.equal(percentile90([]), null);
  });

  it('treats identical observations as zero variability, not as missing', () => {
    // Every delivery took the same time: the most consistent record there is.
    const sameTime = assess({ leadTimeDays: ['0.00', '0.00', '0.00'] });
    assert.equal(sameTime.leadTimeCV, '0.00');
    assert.equal(sameTime.stability, 'STABLE');

    const identical = assess({ leadTimeDays: ['5.00', '5.00', '5.00', '5.00'] });
    assert.equal(identical.leadTimeCV, '0.00');
  });

  it('reports no variability below the minimum sample count', () => {
    for (const samples of [['1.00'], ['1.00', '9.00']]) {
      const result = assess({ leadTimeDays: samples });
      assert.equal(result.leadTimeCV, null);
      assert.equal(result.stability, 'INSUFFICIENT_DATA');
    }
  });

  it('exposes the observed range in the evidence', () => {
    const result = assess({ leadTimeDays: ['5.00', '6.00', '5.00', '7.00'] });
    assert.equal(result.evidence.minLeadTimeDays, '5.00');
    assert.equal(result.evidence.maxLeadTimeDays, '7.00');
    assert.equal(result.evidence.leadTimeSampleCount, 4);
  });
});

// ---------------------------------------------------------------------------
// 13-14: exclusion happens before the engine
// ---------------------------------------------------------------------------

describe('Supplier — exclusions', () => {
  it('13. cancelled and incomplete observations never reach the engine', () => {
    // The repository filters to `received` with both timestamps, so the engine
    // only ever sees deliveries. This asserts the engine treats what it is given
    // as the complete record.
    const result = assess({
      completedPOCount: 6,
      cancelledPOCount: 4,
      openPOCount: 2,
      leadTimeDays: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00'],
    });

    assert.equal(result.leadTimeSampleCount, 6);
    assert.equal(result.cancelledPOCount, 4);
    assert.equal(result.openPOCount, 2);
    assert.match(result.reason, /4 purchase orders were cancelled, which says nothing/);
  });

  it('14. a supplier with orders but no usable timestamps has no lead times', () => {
    const result = assess({ completedPOCount: 2, leadTimeDays: [] });

    assert.equal(result.completedPOCount, 2);
    assert.equal(result.leadTimeSampleCount, 0);
    assert.equal(result.medianLeadTimeDays, null);
    assert.equal(result.confidence, 'LOW', 'two completed orders still count as evidence');
    assert.equal(result.stability, 'INSUFFICIENT_DATA');
  });

  it('18. a supplier with open POs but no completed history', () => {
    const result = assess({
      completedPOCount: 0,
      openPOCount: 3,
      cancelledPOCount: 0,
      leadTimeDays: [],
    });

    assert.equal(result.stability, 'INSUFFICIENT_DATA');
    assert.equal(result.confidence, 'INSUFFICIENT');
    assert.equal(result.openPOCount, 3);
    assert.match(result.reason, /No completed purchase orders/);
    assert.match(result.reason, /3 purchase orders are still open/);
  });

  it('19. counts completed, open, cancelled and draft independently', () => {
    const result = assess({
      completedPOCount: 6,
      openPOCount: 2,
      cancelledPOCount: 3,
      draftPOCount: 5,
    });

    assert.equal(result.completedPOCount, 6);
    assert.equal(result.openPOCount, 2);
    assert.equal(result.cancelledPOCount, 3);
    assert.equal(result.draftPOCount, 5, 'a draft is counted as a draft and nothing else');
  });

  it('20. handles zero ordered and received units safely', () => {
    const result = assess({
      totalUnitsOrdered: '0.00',
      totalUnitsReceived: '0.00',
      leadTimeDays: [],
    });

    assert.equal(result.totalUnitsOrdered, '0.00');
    assert.equal(result.totalUnitsReceived, '0.00');
    assertWellFormed(result);
  });
});

// ---------------------------------------------------------------------------
// 15-16: safety and determinism
// ---------------------------------------------------------------------------

describe('Supplier — safety and determinism', () => {
  it('15. never produces NaN or Infinity', () => {
    const cases: Partial<SupplierFacts>[] = [
      {},
      { leadTimeDays: [] },
      { completedPOCount: 0, leadTimeDays: [] },
      { leadTimeDays: ['0.00', '0.00', '0.00'] },
      { leadTimeDays: ['0.00', '999999.99', '1.00'] },
      { totalUnitsOrdered: '0.00', totalUnitsReceived: '0.00', leadTimeDays: [] },
      { leadTimeDays: ['99999999.99', '0.00', '12345.67'] },
    ];

    for (const overrides of cases) assertWellFormed(assess(overrides));
  });

  it('16. reason and evidence are deterministic', () => {
    const first = assess();
    const second = assess();

    assert.equal(first.reason, second.reason);
    assert.deepEqual(first.evidence, second.evidence);
    assert.deepEqual(first, second);
  });

  it('states that on-time delivery cannot be measured', () => {
    const result = assess();

    assert.equal(
      result.evidence.hasPromisedDeliveryDate,
      false,
      'the absence must be explicit, not an omission',
    );
  });

  it('never calls a supplier good or bad, and never blames one for a cancellation', () => {
    const texts = [
      assess().reason.toLowerCase(),
      assess({ leadTimeDays: ['5.00', '20.00', '7.00', '25.00', '6.00', '22.00'] }).reason.toLowerCase(),
      assess({ completedPOCount: 0, leadTimeDays: [] }).reason.toLowerCase(),
      assess({ cancelledPOCount: 9 }).reason.toLowerCase(),
    ];

    for (const text of texts) {
      for (const banned of [
        'bad supplier',
        'good supplier',
        'poor supplier',
        'late',
        'on-time',
        'sla',
        'replace',
        'fault',
        'recommend',
        'should ',
      ]) {
        assert.ok(!text.includes(banned), `reason should not mention "${banned}": ${text}`);
      }
    }
  });

  it('quotes the figures that produced the verdict', () => {
    const result = assess({ leadTimeDays: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00'] });

    assert.match(result.reason, /6 completed purchase orders/);
    assert.match(result.reason, /median delivery time of 5\.5 days/);
    assert.match(result.reason, /90th-percentile delivery time of 7 days/);
  });

  it('handles very large and very small lead times without drift', () => {
    assertWellFormed(assess({ leadTimeDays: ['0.01', '999999.99', '1.00'] }));
  });

  it('rejects a corrupt decimal rather than treating it as zero', () => {
    assert.throws(() => assess({ leadTimeDays: ['not-a-number'] }), /decimal|InvalidDecimal/i);
  });

  it('carries the supplier through and reports inactivity without hiding it', () => {
    const result = assess({ isActive: false });

    assert.equal(result.supplierId, SUPPLIER_ID);
    assert.equal(result.supplierName, 'ABC Supplies');
    assert.equal(result.isActive, false);
  });

  it('does not depend on the order the lead times arrive in', () => {
    assert.deepEqual(
      assess({ leadTimeDays: ['5.00', '20.00', '7.00', '25.00', '6.00', '22.00'] }),
      assess({ leadTimeDays: ['22.00', '5.00', '25.00', '7.00', '20.00', '6.00'] }),
    );
  });

  it('has exactly three stability values and no more', () => {
    const values = new Set([
      assess({ leadTimeDays: [] }).stability,
      assess({ leadTimeDays: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00'] }).stability,
      assess({ leadTimeDays: ['5.00', '20.00', '7.00', '25.00', '6.00', '22.00'] }).stability,
    ]);

    assert.deepEqual([...values].sort(), ['INSUFFICIENT_DATA', 'STABLE', 'VARIABLE']);
  });

  it('exposes the thresholds it relies on', () => {
    assert.equal(P.minimumSamplesForVariability, 3);
    assert.equal(P.stableMaxCoefficientOfVariation, '0.25');
  });
});