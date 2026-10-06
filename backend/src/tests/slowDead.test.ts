/**
 * Slow / Dead Stock Detection Engine — unit tests.
 *
 * The engine is a pure function, so these need **no database** and no clock.
 * The cases below follow the classification order exactly, because the order is
 * the contract: history, then inventory held, then no sales, then slow days.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessSlowDead,
  classifySlowDead,
  DEMAND_POLICY,
  SLOW_DEAD_POLICY,
  SLOW_DEAD_PRIORITY,
  type ConfidenceLevel,
  type SlowDeadFacts,
  type SlowDeadResult,
} from '../intelligence/index.js';
import { DataError } from '../intelligence/types.js';

const P = SLOW_DEAD_POLICY;
const PRODUCT_ID = '00000000-0000-0000-0000-0000000000b1';

/** Clear of every gate: 120 days of history, stock held, healthy demand. */
function facts(overrides: Partial<SlowDeadFacts> = {}): SlowDeadFacts {
  return {
    productId: PRODUCT_ID,
    isActive: true,
    currentStock: '100.00',
    unitsSold90d: '450.00',
    activeSalesDays90d: 45,
    averageDailySales90d: '5.0000',
    observableHistoryDays: '120',
    ...overrides,
  };
}

function assess(
  overrides: Partial<SlowDeadFacts> = {},
  confidence: ConfidenceLevel = 'HIGH',
): SlowDeadResult {
  return assessSlowDead(facts(overrides), { confidence });
}

function assertWellFormed(result: SlowDeadResult): void {
  for (const value of [result.currentStock, result.unitsSold90d, result.averageDailySales90d]) {
    assert.match(value, /^-?\d+(\.\d+)?$/, `must be a decimal string, got ${value}`);
  }
  for (const value of [result.activeSalesDays90d, result.analysisWindowDays, result.priority]) {
    assert.ok(Number.isFinite(value), `must be finite, got ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// 1-2: dead stock and the history gate
// ---------------------------------------------------------------------------

describe('Slow/Dead — DEAD and the observable-history gate', () => {
  it('1. no sales, enough history, stock held -> DEAD', () => {
    const result = assess({ unitsSold90d: '0.00', activeSalesDays90d: 0, currentStock: '100.00' });

    assert.equal(result.status, 'DEAD');
    assert.equal(result.priority, 80);
    assert.equal(result.unitsSold90d, '0.00');
    assert.equal(result.activeSalesDays90d, 0);
    assert.equal(result.analysisWindowDays, 90);
    assert.equal(result.evidence.holdsInventory, true);
    assert.equal(result.evidence.hasSufficientHistory, true);
    assert.match(result.reason, /No units have sold in the last 90 days/);
  });

  it('2. no sales, insufficient history -> INSUFFICIENT_DATA, never DEAD', () => {
    const result = assess({
      unitsSold90d: '0.00',
      activeSalesDays90d: 0,
      currentStock: '100.00',
      observableHistoryDays: '29',
    });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.equal(result.priority, 20);
    assert.equal(result.evidence.hasSufficientHistory, false);
    assert.match(result.reason, /observable for only 29 day\(s\)/);
  });

  it('accepts exactly 30 days of observable history', () => {
    const result = assess({
      unitsSold90d: '0.00',
      activeSalesDays90d: 0,
      observableHistoryDays: '30',
    });

    assert.equal(result.evidence.hasSufficientHistory, true);
    assert.equal(result.status, 'DEAD');
  });

  it('rejects a product with no observable history at all', () => {
    const result = assess({ observableHistoryDays: '0', unitsSold90d: '0.00' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
  });
});

// ---------------------------------------------------------------------------
// 3: no inventory held
// ---------------------------------------------------------------------------

describe('Slow/Dead — a product with nothing held', () => {
  it('3. currentStock = 0 with no sales -> NORMAL, never DEAD', () => {
    const result = assess({ currentStock: '0.00', unitsSold90d: '0.00', activeSalesDays90d: 0 });

    assert.equal(result.status, 'NORMAL');
    assert.equal(result.priority, 0);
    assert.equal(result.evidence.holdsInventory, false);
    assert.match(result.reason, /nothing is currently held/);
  });

  it('currentStock = 0 with slow sales is still NORMAL', () => {
    const result = assess({ currentStock: '0.00', unitsSold90d: '10.00', activeSalesDays90d: 3 });

    assert.equal(result.status, 'NORMAL', 'there is no inventory to be a problem with');
  });

  it('17. zero-stock products never become DEAD or SLOW, whatever the demand', () => {
    const statuses = [
      assess({ currentStock: '0.00', unitsSold90d: '0.00', activeSalesDays90d: 0 }).status,
      assess({ currentStock: '0.00', unitsSold90d: '10.00', activeSalesDays90d: 1 }).status,
      assess({ currentStock: '0.00', unitsSold90d: '100.00', activeSalesDays90d: 45 }).status,
    ];

    for (const status of statuses) assert.equal(status, 'NORMAL');
  });
});

// ---------------------------------------------------------------------------
// 4-8: slow stock
// ---------------------------------------------------------------------------

describe('Slow/Dead — SLOW', () => {
  it('4. sales on exactly 10 active days -> SLOW', () => {
    const result = assess({ unitsSold90d: '50.00', activeSalesDays90d: 10 });

    assert.equal(result.status, 'SLOW');
    assert.equal(result.priority, 50);
    assert.match(result.reason, /10 sale day\(s\) out of 90/);
  });

  it('5. sales on exactly 11 active days -> NORMAL', () => {
    const result = assess({ unitsSold90d: '55.00', activeSalesDays90d: 11 });

    assert.equal(result.status, 'NORMAL');
    assert.equal(result.priority, 0);
    assert.match(result.reason, /above the 10-day limit/);
  });

  it('7. a single active sales day -> SLOW', () => {
    const result = assess({ unitsSold90d: '12.00', activeSalesDays90d: 1 });

    assert.equal(result.status, 'SLOW');
    assert.equal(result.priority, 50);
    assert.equal(result.averageDailySales90d, '5.0000');
    assert.match(result.evidence.classificationBasis, /sales on 1 active day/);
  });

  it('8. several sale days, all at or below the limit -> SLOW', () => {
    for (const days of [2, 5, 9, 10]) {
      const result = assess({ unitsSold90d: '30.00', activeSalesDays90d: days });
      assert.equal(result.status, 'SLOW', `${days} active days should be SLOW`);
      assert.equal(result.priority, 50);
    }
  });

  it('6. healthy, regular demand -> NORMAL', () => {
    const result = assess({ unitsSold90d: '450.00', activeSalesDays90d: 45 });

    assert.equal(result.status, 'NORMAL');
    assert.equal(result.priority, 0);
  });

  it('16. classifies the 10/11-day boundary in both directions', () => {
    assert.equal(assess({ activeSalesDays90d: 9 }).status, 'SLOW');
    assert.equal(assess({ activeSalesDays90d: 10 }).status, 'SLOW');
    assert.equal(assess({ activeSalesDays90d: 11 }).status, 'NORMAL');
    assert.equal(assess({ activeSalesDays90d: 12 }).status, 'NORMAL');
  });

  it('measures frequency only — units and stock do not change the verdict', () => {
    // A huge sale on one day is still one day of demand.
    const oneBigDay = assess({ unitsSold90d: '99999.00', activeSalesDays90d: 1 });
    const tenSmallDays = assess({ unitsSold90d: '10.00', activeSalesDays90d: 10 });

    assert.equal(oneBigDay.status, 'SLOW');
    assert.equal(tenSmallDays.status, 'SLOW');
    assert.equal(oneBigDay.priority, tenSmallDays.priority);
  });
});

// ---------------------------------------------------------------------------
// 9: corrupt inventory
// ---------------------------------------------------------------------------

describe('Slow/Dead — corrupt inventory', () => {
  it('9. a negative balance raises DataError rather than a misleading status', () => {
    assert.throws(
      () => assess({ currentStock: '-15.00' }),
      DataError,
      'corrupt inventory is reported, never classified',
    );
  });

  it('never turns corrupt data into SLOW or DEAD', () => {
    for (const overrides of [
      { currentStock: '-1.00', unitsSold90d: '0.00' },
      { currentStock: '-1.00', unitsSold90d: '5.00', activeSalesDays90d: 2 },
    ]) {
      assert.throws(() => assess(overrides), DataError);
    }
  });

  it('zero is not corruption and is classified normally', () => {
    assert.doesNotThrow(() => assess({ currentStock: '0.00' }));
  });
});

// ---------------------------------------------------------------------------
// 10-15: confidence, priority, window, determinism, safety
// ---------------------------------------------------------------------------

describe('Slow/Dead — confidence, priority, window and determinism', () => {
  it('10. reuses the Demand Intelligence confidence', () => {
    for (const confidence of ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as ConfidenceLevel[]) {
      assert.equal(assess({}, confidence).confidence, confidence);
    }
  });

  it('reports confidence independently of the classification', () => {
    // A product can be confidently dead while having, by definition, no demand
    // evidence at all. The two axes answer different questions.
    const dead = assess({ unitsSold90d: '0.00', activeSalesDays90d: 0 }, 'INSUFFICIENT');
    const slow = assess({ activeSalesDays90d: 3 }, 'LOW');

    assert.equal(dead.status, 'DEAD');
    assert.equal(dead.confidence, 'INSUFFICIENT');
    assert.equal(slow.status, 'SLOW');
    assert.equal(slow.confidence, 'LOW');
  });

  it('11. priority values are correct and independent of every other scale', () => {
    assert.equal(assess({ unitsSold90d: '0.00', activeSalesDays90d: 0 }).priority, 80);
    assert.equal(assess({ activeSalesDays90d: 5 }).priority, 50);
    assert.equal(assess({ activeSalesDays90d: 45 }).priority, 0);
    assert.equal(assess({ observableHistoryDays: '5' }).priority, 20);

    assert.deepEqual(SLOW_DEAD_PRIORITY, { DEAD: 80, SLOW: 50, INSUFFICIENT_DATA: 20, NORMAL: 0 });
  });

  it('12. the analysis window is 90 days, borrowed from the Demand Engine', () => {
    assert.equal(assess({}).analysisWindowDays, 90);
    assert.equal(P.analysisWindowDays, DEMAND_POLICY.longDays);
    assert.equal(assess({}).evidence.analysisWindowDays, 90);
  });

  it('13-14. reason and evidence are deterministic', () => {
    const first = assess({ activeSalesDays90d: 4 });
    const second = assess({ activeSalesDays90d: 4 });

    assert.equal(first.reason, second.reason);
    assert.deepEqual(first.evidence, second.evidence);
    assert.deepEqual(first, second);
  });

  it('15. no NaN or Infinity in any case', () => {
    const cases: Partial<SlowDeadFacts>[] = [
      {},
      { unitsSold90d: '0.00', activeSalesDays90d: 0 },
      { currentStock: '0.00', unitsSold90d: '0.00' },
      { observableHistoryDays: '0' },
      { unitsSold90d: '0.0001', activeSalesDays90d: 90 },
      { unitsSold90d: '99999999.99', activeSalesDays90d: 90 },
    ];

    for (const overrides of cases) assertWellFormed(assess(overrides));
  });

  it('handles very large and very small quantities without drift', () => {
    assertWellFormed(assess({ unitsSold90d: '99999999.99', currentStock: '99999999.99' }));
    assertWellFormed(assess({ unitsSold90d: '0.01', activeSalesDays90d: 1 }));
  });

  it('has exactly four public statuses and no more', () => {
    const statuses = new Set([
      assess({ unitsSold90d: '0.00', activeSalesDays90d: 0 }).status,
      assess({ activeSalesDays90d: 5 }).status,
      assess({ activeSalesDays90d: 45 }).status,
      assess({ observableHistoryDays: '5' }).status,
    ]);

    assert.deepEqual([...statuses].sort(), ['DEAD', 'INSUFFICIENT_DATA', 'NORMAL', 'SLOW']);
  });

  it('exposes the thresholds it relies on', () => {
    assert.equal(P.minimumObservableDays, 30);
    assert.equal(P.slowMaxActiveSalesDays, 10);
  });
});

// ---------------------------------------------------------------------------
// Purity and auditability
// ---------------------------------------------------------------------------

describe('Slow/Dead — purity and auditability', () => {
  it('states which rule decided the verdict', () => {
    assert.match(assess({}).evidence.classificationBasis, /sales on 45 active days, above 10/);
    assert.match(assess({ activeSalesDays90d: 3 }).evidence.classificationBasis, /at or below 10/);
    assert.match(
      assess({ unitsSold90d: '0.00' }).evidence.classificationBasis,
      /no sales in the 90-day window/,
    );
    assert.match(
      assess({ observableHistoryDays: '5' }).evidence.classificationBasis,
      /observable history below 30 days/,
    );
    assert.match(
      assess({ currentStock: '0.00' }).evidence.classificationBasis,
      /no inventory currently held/,
    );
  });

  it('classifies from facts alone, in the documented order', () => {
    const order = classifySlowDead(facts({ unitsSold90d: '0.00', activeSalesDays90d: 0 }));

    assert.equal(order.status, 'DEAD');
    assert.equal(order.holdsInventory, true);
    assert.equal(order.hasSufficientHistory, true);
  });

  it('history outranks inventory: too little history is INSUFFICIENT even with stock', () => {
    const result = assess({
      observableHistoryDays: '10',
      currentStock: '5000.00',
      unitsSold90d: '0.00',
    });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
  });

  it('inventory outranks demand: no stock is NORMAL even with no sales', () => {
    const result = assess({ currentStock: '0.00', unitsSold90d: '0.00' });

    assert.equal(result.status, 'NORMAL');
  });

  it('carries the product through and reports inactivity without hiding it', () => {
    const result = assess({ isActive: false, activeSalesDays90d: 2 });

    assert.equal(result.productId, PRODUCT_ID);
    assert.equal(result.status, 'SLOW');
  });

  it('does not name an action, a remedy or a recommendation', () => {
    const texts = [
      assess({ unitsSold90d: '0.00' }).reason.toLowerCase(),
      assess({ activeSalesDays90d: 3 }).reason.toLowerCase(),
      assess({}).reason.toLowerCase(),
      assess({ observableHistoryDays: '5' }).reason.toLowerCase(),
    ];

    for (const text of texts) {
      for (const banned of ['markdown', 'discount', 'return to supplier', 'should ', 'recommend']) {
        assert.ok(!text.includes(banned), `reason should not mention "${banned}": ${text}`);
      }
    }
  });

  it('rejects a corrupt decimal rather than treating it as zero', () => {
    assert.throws(() => assess({ currentStock: 'not-a-number' }), /decimal|InvalidDecimal/i);
  });
});