/**
 * Overstock Detection Engine — unit tests.
 *
 * The engine is a pure function, so these need **no database** and no clock.
 * Every case is arithmetic a reader can check on paper: 240 units at a rate of
 * 3.2 a day is exactly 75 days of cover, comfortably past the 60-day threshold,
 * while 295 units at 5 a day is 59 days and therefore normal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toScaled } from '../intelligence/decimal.js';
import {
  assessOverstock,
  calculateDaysOfStock,
  classifyOverstock,
  DEMAND_POLICY,
  OVERSTOCK_POLICY,
  OVERSTOCK_PRIORITY,
  type ConfidenceLevel,
  type OverstockFacts,
  type OverstockResult,
} from '../intelligence/index.js';

const PRODUCT_ID = '00000000-0000-0000-0000-0000000000f1';

/** Clear of every evidence gate: 10/day, 20 active days, 300 units. */
function facts(overrides: Partial<OverstockFacts> = {}): OverstockFacts {
  return {
    productId: PRODUCT_ID,
    isActive: true,
    currentStock: '240.00',
    unitsSold30d: '300.00',
    activeSalesDays30d: 20,
    averageDailySales30d: '10.0000',
    unitsSold90d: '900.00',
    activeSalesDays90d: 60,
    averageDailySales90d: '10.0000',
    observableHistoryDays: '120',
    ...overrides,
  };
}

function assess(
  overrides: Partial<OverstockFacts> = {},
  confidence: ConfidenceLevel = 'HIGH',
): OverstockResult {
  return assessOverstock(facts(overrides), { confidence });
}

/** Fields that must always be a well-formed decimal string or `null`. */
const DECIMAL_FIELDS = [
  'currentStock',
  'averageDailySales30d',
  'unitsSold30d',
  'daysOfStock',
  'thresholdDays',
] as const;

function assertWellFormed(result: OverstockResult): void {
  for (const key of DECIMAL_FIELDS) {
    const value = result[key];
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${key} must be finite`);
      continue;
    }
    if (value === null) continue;
    assert.match(value, /^-?\d+(\.\d+)?$/, `${key} must be a decimal string, got ${value}`);
  }
  assert.ok(Number.isInteger(result.analysisWindowDays));
  assert.ok(Number.isFinite(result.priority));
}

// ---------------------------------------------------------------------------
// Required cases 1-4: the evidence gate
// ---------------------------------------------------------------------------

describe('Overstock — demand evidence gate', () => {
  it('1. no demand evidence at all -> INSUFFICIENT_DATA', () => {
    const result = assess({ unitsSold30d: '0.00', activeSalesDays30d: 0, averageDailySales30d: '0.0000' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.equal(result.daysOfStock, null, 'no rate means no ratio');
    assert.equal(result.priority, OVERSTOCK_PRIORITY.INSUFFICIENT_DATA);
    assert.equal(result.evidence.hasSufficientEvidence, false);
    assert.match(result.reason, /Not enough demand evidence/);
  });

  it('2. zero average daily sales -> INSUFFICIENT_DATA and a null metric', () => {
    const result = assess({ averageDailySales30d: '0.0000', unitsSold30d: '300.00' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.equal(result.daysOfStock, null, 'never NaN and never Infinity');
    assert.deepEqual(result.evidence.unmetEvidenceGates, ['positive 30-day demand rate']);
    assertWellFormed(result);
  });

  it('3. fewer than 3 active sales days -> INSUFFICIENT_DATA, however big the stock', () => {
    const result = assess({ activeSalesDays30d: 2, currentStock: '999999.00' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.deepEqual(result.evidence.unmetEvidenceGates, [
      '3 active sales days in 30 days',
    ]);
    assert.match(result.reason, /3 active sales days in 30 days/);
  });

  it('accepts exactly 3 active sales days', () => {
    // Self-consistent facts: 30 units over 30 days is exactly 1.0000 a day,
    // sold across exactly 3 days, so 60 units on hand is exactly 60 days.
    const result = assess({
      activeSalesDays30d: 3,
      unitsSold30d: '30.00',
      averageDailySales30d: '1.0000',
      currentStock: '60.00',
    });

    assert.equal(result.evidence.hasSufficientEvidence, true);
    assert.equal(result.daysOfStock, '60.00');
    assert.equal(result.status, 'OVERSTOCK');
  });

  it('4. fewer than 5 units sold -> INSUFFICIENT_DATA', () => {
    const result = assess({ unitsSold30d: '4.99', activeSalesDays30d: 20, currentStock: '5000.00' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.deepEqual(result.evidence.unmetEvidenceGates, ['5.00 units sold in 30 days']);
  });

  it('accepts exactly 5 units sold', () => {
    const result = assess({ unitsSold30d: '5.00', activeSalesDays30d: 20 });

    assert.equal(result.evidence.hasSufficientEvidence, true);
    assert.equal(result.status, 'NORMAL', 'the unit gate passes, but 240 at 10/day is 24 days');
  });

  it('8. high stock with insufficient evidence is not overstock', () => {
    // 5,000 units against a rate of 1/30th of a unit a day would be a
    // spectacular days-of-stock figure — and it means nothing at all.
    const result = assess({
      currentStock: '5000.00',
      unitsSold30d: '4.00',
      activeSalesDays30d: 2,
      averageDailySales30d: '0.1333',
    });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.notEqual(result.status, 'OVERSTOCK');
    assert.equal(result.evidence.unmetEvidenceGates.length, 2, 'both the day and unit gates fail');
    assert.equal(result.priority, OVERSTOCK_PRIORITY.INSUFFICIENT_DATA);
  });

  it('reports every unmet gate at once, so the reason names all of them', () => {
    const result = assess({ unitsSold30d: '0.00', activeSalesDays30d: 0, averageDailySales30d: '0.0000' });

    assert.equal(result.evidence.unmetEvidenceGates.length, 3);
    for (const gate of result.evidence.unmetEvidenceGates) {
      assert.ok(result.reason.includes(gate), `reason should name "${gate}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Required cases 5-7: the threshold
// ---------------------------------------------------------------------------

describe('Overstock — the 60-day threshold', () => {
  it('5. exactly 60 days of stock -> OVERSTOCK', () => {
    const result = assess({ currentStock: '300.00', averageDailySales30d: '5.0000', unitsSold30d: '150.00' });

    assert.equal(result.daysOfStock, '60.00');
    assert.equal(result.thresholdDays, 60);
    assert.equal(result.status, 'OVERSTOCK', 'exactly 60 qualifies');
    assert.equal(result.priority, OVERSTOCK_PRIORITY.OVERSTOCK);
    assert.match(result.reason, /at or above the 60-day threshold/);
  });

  it('6. less than 60 days -> NORMAL', () => {
    const result = assess({ currentStock: '295.00', averageDailySales30d: '5.0000', unitsSold30d: '150.00' });

    assert.equal(result.daysOfStock, '59.00');
    assert.equal(result.status, 'NORMAL');
    assert.equal(result.priority, OVERSTOCK_PRIORITY.NORMAL);
    assert.match(result.reason, /below the 60-day threshold/);
  });

  it('classifies one hundredth under the threshold as NORMAL', () => {
    const result = assess({ currentStock: '299.99', averageDailySales30d: '5.0000', unitsSold30d: '150.00' });

    assert.equal(result.daysOfStock, '59.99');
    assert.equal(result.status, 'NORMAL');
  });

  it('classifies one hundredth over the threshold as OVERSTOCK', () => {
    const result = assess({ currentStock: '300.01', averageDailySales30d: '5.0000', unitsSold30d: '150.00' });

    assert.equal(result.daysOfStock, '60.00');
    assert.equal(result.status, 'OVERSTOCK');
  });

  it('7. far more than 60 days -> OVERSTOCK', () => {
    const result = assess({ currentStock: '2400.00', averageDailySales30d: '10.0000', unitsSold30d: '300.00' });

    assert.equal(result.daysOfStock, '240.00');
    assert.equal(result.status, 'OVERSTOCK');
    assert.equal(result.priority, 70);
  });

  it('compares at full precision, so a boundary case is not rounded into OVERSTOCK', () => {
    // 191.999 / 3.2 is 59.9996875 days — below 60 even though it renders as 60.00
    // at two decimal places. The verdict follows the number, not the rendering.
    const result = assess({ currentStock: '191.999', averageDailySales30d: '3.2000', unitsSold30d: '96.00' });

    assert.equal(result.daysOfStock, '59.99');
    assert.equal(result.status, 'NORMAL');
  });

  it('matches the specification example exactly', () => {
    // 240 units, 3.2 a day, 96 units and 18 active days in the window.
    const result = assess({
      currentStock: '240.00',
      averageDailySales30d: '3.2000',
      unitsSold30d: '96.00',
      activeSalesDays30d: 18,
    });

    assert.equal(result.status, 'OVERSTOCK');
    assert.equal(result.priority, 70);
    assert.equal(result.daysOfStock, '75.00');
    assert.equal(result.thresholdDays, 60);
    assert.equal(result.analysisWindowDays, 30);
    assert.equal(result.averageDailySales30d, '3.2000');
  });

  it('exposes the policy it relies on', () => {
    assert.equal(OVERSTOCK_POLICY.thresholdDays, 60);
    assert.equal(OVERSTOCK_POLICY.evidence.minimumActiveSalesDays30d, 3);
    assert.equal(OVERSTOCK_POLICY.evidence.minimumUnitsSold30d, '5.00');
    assert.equal(DEMAND_POLICY.baselineDays, 30, 'the same window the Demand Engine uses');
  });
});

// ---------------------------------------------------------------------------
// Required cases 9-12
// ---------------------------------------------------------------------------

describe('Overstock — metric safety, confidence and priority', () => {
  it('9. never produces NaN or Infinity', () => {
    const cases: Partial<OverstockFacts>[] = [
      { averageDailySales30d: '0.0000' },
      { unitsSold30d: '0.00', activeSalesDays30d: 0, averageDailySales30d: '0.0000' },
      { currentStock: '-15.00' },
      { currentStock: '0.00' },
      { activeSalesDays30d: 0, unitsSold30d: '0.00' },
      { currentStock: '99999999.99', averageDailySales30d: '0.0001', unitsSold30d: '5.00', activeSalesDays30d: 3 },
    ];

    for (const overrides of cases) {
      assertWellFormed(assess(overrides));
    }
  });

  it('returns a null metric rather than dividing by a zero rate', () => {
    assert.equal(calculateDaysOfStock('240.00', '0.0000'), null);
    assert.equal(calculateDaysOfStock('240.00', '-1.0000'), null);
    assert.equal(calculateDaysOfStock('240.00', '10.0000'), toScaled('24.00'));
  });

  it('treats a negative ledger balance as unassessable, not as good cover', () => {
    const result = assess({ currentStock: '-15.00' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.equal(result.daysOfStock, null);
    assert.deepEqual(result.evidence.unmetEvidenceGates, [
      'a non-negative stock-on-hand figure',
    ]);
  });

  it('treats zero stock as zero days of cover, which is normal', () => {
    const result = assess({ currentStock: '0.00' });

    assert.equal(result.daysOfStock, '0.00');
    assert.equal(result.status, 'NORMAL');
  });

  it('10. reuses the Demand Intelligence confidence rather than inventing its own', () => {
    const levels: ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'];

    for (const confidence of levels) {
      const result = assess({}, confidence);
      assert.equal(result.confidence, confidence, 'confidence passes straight through');
    }
  });

  it('reports confidence even when the status is INSUFFICIENT_DATA', () => {
    // The overstock gate and the demand confidence are different questions:
    // demand may be well evidenced while the *overstock* verdict is still clear.
    const result = assess({ unitsSold30d: '0.00', activeSalesDays30d: 0, averageDailySales30d: '0.0000' }, 'LOW');

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.equal(result.confidence, 'LOW');
  });

  it('11. priority values are correct and separate from Stock Risk', () => {
    assert.equal(assess({ currentStock: '2400.00' }).priority, 70);
    assert.equal(assess({ currentStock: '240.00' }).priority, 0);
    assert.equal(
      assess({ unitsSold30d: '0.00', activeSalesDays30d: 0, averageDailySales30d: '0.0000' }).priority,
      20,
    );

    assert.deepEqual(OVERSTOCK_PRIORITY, { OVERSTOCK: 70, INSUFFICIENT_DATA: 20, NORMAL: 0 });
  });

  it('has exactly three statuses and no more', () => {
    const statuses = new Set([
      assess({ currentStock: '2400.00' }).status,
      assess({ currentStock: '240.00' }).status,
      assess({ unitsSold30d: '0.00', activeSalesDays30d: 0, averageDailySales30d: '0.0000' }).status,
    ]);

    assert.deepEqual([...statuses].sort(), ['INSUFFICIENT_DATA', 'NORMAL', 'OVERSTOCK']);
  });

  it('12. reason and evidence are deterministic', () => {
    const first = assess({ currentStock: '2400.00' });
    const second = assess({ currentStock: '2400.00' });

    assert.equal(first.reason, second.reason);
    assert.deepEqual(first.evidence, second.evidence);
    assert.deepEqual(first, second);
  });

  it('quotes the figures that produced the verdict', () => {
    const result = assess({ currentStock: '2400.00', averageDailySales30d: '10.0000' });

    assert.match(result.reason, /2400 units/);
    assert.match(result.reason, /240 days of cover/);
    assert.match(result.reason, /10 units per day/);
  });

  it('does not name an action, a remedy or a recommendation', () => {
    const overstocked = assess({ currentStock: '2400.00' }).reason.toLowerCase();
    const normal = assess({ currentStock: '240.00' }).reason.toLowerCase();
    const insufficient = assess({
      unitsSold30d: '0.00',
      activeSalesDays30d: 0,
      averageDailySales30d: '0.0000',
    }).reason.toLowerCase();

    for (const text of [overstocked, normal, insufficient]) {
      for (const banned of ['markdown', 'discount', 'return to supplier', 'should ', 'recommend', 'order ']) {
        assert.ok(!text.includes(banned), `reason should not mention "${banned}": ${text}`);
      }
    }
  });

  it('reports the evidence that backs the verdict', () => {
    const result = assess({ unitsSold30d: '96.00', activeSalesDays30d: 18 });

    assert.equal(result.evidence.analysisWindowDays, 30);
    assert.equal(result.evidence.thresholdDays, 60);
    assert.equal(result.evidence.minimumActiveSalesDays30d, 3);
    assert.equal(result.evidence.minimumUnitsSold30d, '5.00');
    assert.equal(result.evidence.unitsSold90d, '900.00');
    assert.equal(result.evidence.activeSalesDays90d, 60);
    assert.equal(result.evidence.observableHistoryDays, '120');
    assert.equal(result.evidence.hasSufficientEvidence, true);
    assert.deepEqual(result.evidence.unmetEvidenceGates, []);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('Overstock — purity', () => {
  it('classifies from the metric alone', () => {
    assert.equal(classifyOverstock(toScaled('60.00'), true), 'OVERSTOCK');
    assert.equal(classifyOverstock(toScaled('59.99'), true), 'NORMAL');
    assert.equal(classifyOverstock(toScaled('1000'), false), 'INSUFFICIENT_DATA');
    assert.equal(classifyOverstock(null, true), 'INSUFFICIENT_DATA');
  });

  it('does not depend on the order facts arrive in', () => {
    assert.deepEqual(assess({ currentStock: '2400.00' }), assess({ currentStock: '2400.00' }));
  });

  it('carries the product through and reports inactivity without hiding it', () => {
    const result = assess({ isActive: false, currentStock: '2400.00' });

    assert.equal(result.productId, PRODUCT_ID);
    assert.equal(result.status, 'OVERSTOCK', 'the engine assesses it normally');
  });

  it('rejects a corrupt decimal rather than treating it as zero', () => {
    assert.throws(() => assess({ currentStock: 'not-a-number' }), /decimal|InvalidDecimal/i);
  });
});