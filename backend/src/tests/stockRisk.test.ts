/**
 * Stock Risk Engine — unit tests.
 *
 * The engine is a pure function, so these need **no database**: the same facts
 * always produce the same result, which is what makes every threshold and every
 * ordering decision verifiable in isolation.
 *
 * The `facts()` helper builds a realistic baseline; each test overrides only
 * what it is actually testing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessConfidence,
  assessStockRisk,
  DataError,
  RISK_PRIORITY,
  STOCK_RISK_POLICY,
  type StockRiskFacts,
} from '../intelligence/index.js';
import { divide, fromScaled, median, multiply, toScaled } from '../intelligence/decimal.js';

const P = STOCK_RISK_POLICY;

/**
 * A comfortable baseline: 60 days of cover, 10 active sale days, a 5-day lead
 * time. Tests override the one or two fields they care about.
 */
function facts(overrides: Partial<StockRiskFacts> = {}): StockRiskFacts {
  return {
    productId: '00000000-0000-0000-0000-000000000001',
    isActive: true,
    currentStock: '100.00',
    unitsSold: '300.00',
    averageDailySales: '10.0000',
    observableHistoryDays: '60',
    activeSalesDays: '10',
    leadTimeSamples: ['5.00'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('decimal arithmetic', () => {
  it('divides two scaled values without losing scale', () => {
    // 18 / 6 must be 3.00, not 0.000003. Composing scaled values without
    // dividing the extra scale out is the classic mistake here.
    assert.equal(fromScaled(divide(toScaled('18.00'), toScaled('6.0000')), 2), '3.00');
  });

  it('multiplies two scaled values without gaining scale', () => {
    // 6 × 2 must be 12.00, not 12000000.00.
    assert.equal(fromScaled(multiply(toScaled('6.0000'), toScaled('2')), 2), '12.00');
  });

  it('divides non-terminating results without floating point', () => {
    // 1 / 3 rounds half away from zero at the working scale.
    assert.equal(fromScaled(divide(toScaled('1'), toScaled('3')), 4), '0.3333');
  });

  it('rejects a value that is not a finite decimal', () => {
    assert.throws(() => toScaled('1e400'), /Not a finite decimal/);
    assert.throws(() => toScaled(''), /Not a finite decimal/);
  });
});

describe('Stock Risk Engine — risk levels', () => {
  it('classifies a healthy product', () => {
    // 100 units at 10/day = 10 days of cover, above lead 5 + safety 2 = 7.
    const result = assessStockRisk(facts());

    assert.equal(result.risk, 'HEALTHY');
    assert.equal(result.priority, RISK_PRIORITY.HEALTHY);
    assert.equal(result.daysOfStock, '10.00');
  });

  it('classifies a critical product when cover is shorter than lead time', () => {
    // 18 units at 6/day = 3 days, against a 5-day lead time.
    const result = assessStockRisk(
      facts({ currentStock: '18.00', averageDailySales: '6.0000' }),
    );

    assert.equal(result.risk, 'CRITICAL');
    assert.equal(result.priority, RISK_PRIORITY.CRITICAL);
    assert.equal(result.daysOfStock, '3.00');
  });

  it('classifies a low-risk product between lead time and the safety threshold', () => {
    // 36 units at 6/day = 6 days: above the 5-day lead time, below 7.
    const result = assessStockRisk(
      facts({ currentStock: '36.00', averageDailySales: '6.0000' }),
    );

    assert.equal(result.risk, 'LOW');
    assert.equal(result.priority, RISK_PRIORITY.LOW);
  });

  it('classifies an overstocked product', () => {
    const result = assessStockRisk(
      facts({ currentStock: '6000.00', averageDailySales: '6.0000' }),
    );

    assert.equal(result.risk, 'OVERSTOCK');
    assert.equal(result.priority, RISK_PRIORITY.OVERSTOCK);
  });

  it('classifies a product with no stock as out of stock, whatever the evidence', () => {
    // No sales, no lead time — stock is still the most urgent fact.
    const result = assessStockRisk(
      facts({ currentStock: '0.00', unitsSold: '0.00', averageDailySales: '0.0000', leadTimeSamples: [] }),
    );

    assert.equal(result.risk, 'OUT_OF_STOCK');
    assert.equal(result.priority, RISK_PRIORITY.OUT_OF_STOCK);
    assert.equal(result.reason, 'Current stock is zero.');
  });

  it('classifies a product without demand evidence as insufficient data, not healthy', () => {
    const result = assessStockRisk(
      facts({ currentStock: '500.00', unitsSold: '0.00', averageDailySales: '0.0000' }),
    );

    assert.equal(result.risk, 'INSUFFICIENT_DATA');
    assert.equal(result.daysOfStock, null, 'no days of cover without demand');
    assert.equal(result.safetyStock, null, 'no safety stock without demand');
    assert.equal(result.reorderPoint, null);
  });

  it('does not call a product overstocked without demand evidence', () => {
    const result = assessStockRisk(
      facts({ currentStock: '99999.00', unitsSold: '0.00', averageDailySales: '0.0000' }),
    );

    assert.equal(result.risk, 'INSUFFICIENT_DATA');
    assert.notEqual(result.risk, 'OVERSTOCK');
  });

  it('never returns a contradictory state', () => {
    // 3 days of cover with a 5-day lead time can never be HEALTHY.
    const result = assessStockRisk(
      facts({ currentStock: '18.00', averageDailySales: '6.0000' }),
    );

    assert.notEqual(result.risk, 'HEALTHY');
    assert.ok(
      (result.risk === 'CRITICAL' && Number(result.daysOfStock) < 5) ||
        (result.risk === 'LOW' && Number(result.daysOfStock) >= 5),
      `${result.risk} is consistent with ${result.daysOfStock} days of cover`,
    );
  });
});

describe('Stock Risk Engine — demand metrics', () => {
  it('computes days of stock from current stock and velocity', () => {
    // The example from the specification: 18 units, 6 a day -> 3 days.
    const result = assessStockRisk(
      facts({ currentStock: '18.00', averageDailySales: '6.0000' }),
    );

    assert.equal(result.daysOfStock, '3.00');
  });

  it('returns null days of stock when there is no velocity', () => {
    const result = assessStockRisk(facts({ averageDailySales: '0.0000' }));

    assert.equal(result.daysOfStock, null);
  });

  it('never returns NaN, Infinity or invalid values', () => {
    for (const input of [
      facts(),
      facts({ averageDailySales: '0.0000' }),
      facts({ currentStock: '0.00' }),
      facts({ leadTimeSamples: [] }),
    ]) {
      const serialised = JSON.stringify(assessStockRisk(input));
      assert.ok(!/NaN|Infinity/.test(serialised), serialised);
    }
  });
});

describe('Stock Risk Engine — safety stock and reorder point', () => {
  it('computes safety stock as velocity × safety days', () => {
    const result = assessStockRisk(facts({ averageDailySales: '6.0000' }));

    assert.equal(result.safetyStockDays, P.safetyStockDays);
    assert.equal(result.safetyStock, '12.00', '6 × 2');
  });

  it('computes the reorder point as velocity × (lead time + safety days)', () => {
    // The specification's example: 6/day, 5-day lead, 2-day safety -> 42.
    const result = assessStockRisk(facts({ averageDailySales: '6.0000' }));

    assert.equal(result.effectiveLeadTimeDays, '5.00');
    assert.equal(result.reorderPoint, '42.00');
  });

  it('withholds the reorder point when lead time is unknown', () => {
    const result = assessStockRisk(facts({ leadTimeSamples: [] }));

    assert.equal(result.effectiveLeadTimeDays, null);
    assert.equal(result.reorderPoint, null, 'never invent a default lead time');
    assert.equal(result.risk, 'INSUFFICIENT_DATA');
  });

  it('withholds safety stock when demand is unknown', () => {
    const result = assessStockRisk(facts({ unitsSold: '0.00', averageDailySales: '0.0000' }));

    assert.equal(result.safetyStock, null);
  });
});

describe('Stock Risk Engine — supplier lead time', () => {
  it('uses the median, so one abnormal delay cannot skew the figure', () => {
    const result = assessStockRisk(
      facts({ leadTimeSamples: ['4.00', '5.00', '6.00', '5.00'] }),
    );

    assert.equal(result.effectiveLeadTimeDays, '5.00', 'median of 4, 5, 5, 6');
    assert.equal(result.leadTimeSampleCount, 4);
  });

  it('averages the two middle values for an even sample count', () => {
    assert.equal(median(['4.00', '6.00']), '5.00');
  });

  it('returns a single sample unchanged', () => {
    assert.equal(median(['5.00']), '5.00');
  });

  it('renders a single sample rather than passing the raw value through', () => {
    // The driver parses a `numeric[]` into numbers, so an odd-length median must
    // still be rendered or the JSON type of effectiveLeadTimeDays would depend on
    // how many orders happened to qualify.
    assert.equal(median(['5.00'] as string[]), '5.00');
    assert.equal(median(['5'] as unknown as string[]), '5.00');
    assert.equal(median(['7.5'] as unknown as string[]), '7.50');
  });

  it('returns null when there is no evidence at all', () => {
    assert.equal(median([]), null);
    assert.equal(assessStockRisk(facts({ leadTimeSamples: [] })).effectiveLeadTimeDays, null);
  });

  it('ignores an extreme outlier where the median resists it', () => {
    // A mean would report 11.5 here; the median reports 5.
    const result = assessStockRisk(
      facts({ leadTimeSamples: ['5.00', '5.00', '5.00', '31.00'] }),
    );

    assert.equal(result.effectiveLeadTimeDays, '5.00');
  });
});

describe('Stock Risk Engine — confidence', () => {
  it('is HIGH with long history, real activity and lead-time evidence', () => {
    assert.equal(assessConfidence(facts()), 'HIGH');
  });

  it('is MEDIUM with moderate history and activity', () => {
    const result = assessConfidence(
      facts({ observableHistoryDays: '35', activeSalesDays: '5' }),
    );

    assert.equal(result, 'MEDIUM');
  });

  it('is LOW with thin history even when the product is old', () => {
    // A product observable for 90 days but with a single sale day is not HIGH.
    const result = assessConfidence(
      facts({ observableHistoryDays: '90', activeSalesDays: '1' }),
    );

    assert.equal(result, 'LOW');
  });

  it('is INSUFFICIENT with less than the minimum observable history', () => {
    assert.equal(
      assessConfidence(facts({ observableHistoryDays: '5', activeSalesDays: '5' })),
      'INSUFFICIENT',
    );
  });

  it('is INSUFFICIENT with no sales at all', () => {
    assert.equal(
      assessConfidence(facts({ unitsSold: '0.00', activeSalesDays: '0' })),
      'INSUFFICIENT',
    );
  });

  it('is not HIGH without lead-time evidence', () => {
    const result = assessConfidence(
      facts({ observableHistoryDays: '90', activeSalesDays: '20', leadTimeSamples: [] }),
    );

    assert.notEqual(result, 'HIGH');
    assert.equal(result, 'MEDIUM');
  });

  it('reports risk and confidence independently', () => {
    // Serious risk, weak evidence: a valid and meaningful combination.
    const result = assessStockRisk(
      facts({
        currentStock: '18.00',
        averageDailySales: '6.0000',
        observableHistoryDays: '20',
        activeSalesDays: '2',
        leadTimeSamples: ['5.00'],
      }),
    );

    assert.equal(result.risk, 'CRITICAL');
    assert.equal(result.confidence, 'LOW');
  });
});

describe('Stock Risk Engine — edge cases', () => {
  it('rejects negative stock as corrupt data rather than clamping it', () => {
    assert.throws(
      () => assessStockRisk(facts({ currentStock: '-5.00' })),
      DataError,
      'negative stock cannot arise under the inventory rules',
    );
  });

  it('does not require a lead time to call something out of stock', () => {
    const result = assessStockRisk(
      facts({ currentStock: '0.00', leadTimeSamples: [], unitsSold: '0.00', averageDailySales: '0.0000' }),
    );

    assert.equal(result.risk, 'OUT_OF_STOCK');
  });

  it('refuses to invent coverage when there is no demand signal', () => {
    const result = assessStockRisk(facts({ currentStock: '100.00', unitsSold: '0.00', averageDailySales: '0.0000' }));

    assert.equal(result.risk, 'INSUFFICIENT_DATA');
    assert.match(result.reason, /No sales/i);
  });

  it('explains missing supplier evidence explicitly', () => {
    const result = assessStockRisk(facts({ leadTimeSamples: [] }));

    assert.match(result.reason, /lead-time evidence is unavailable/i);
  });

  it('rejects a corrupt decimal instead of silently treating it as zero', () => {
    assert.throws(() => toScaled('not-a-number'), /Not a finite decimal/);
    assert.throws(() => toScaled(Number.NaN), /Not a finite decimal/);
    assert.throws(() => toScaled(Number.POSITIVE_INFINITY), /Not a finite decimal/);
  });
});

describe('Stock Risk Engine — evidence', () => {
  it('reports the evidence behind the verdict', () => {
    const result = assessStockRisk(
      facts({ currentStock: '18.00', averageDailySales: '6.0000' }),
    );

    assert.equal(result.analysisWindowDays, P.analysisWindowDays);
    assert.deepEqual(result.evidence, {
      salesWindowDays: P.analysisWindowDays,
      unitsSold: '300.00',
      observableHistoryDays: '60',
      activeSalesDays: '10',
      leadTimeSamples: 1,
      hasLeadTimeEvidence: true,
    });
  });

  it('is deterministic: identical facts produce an identical result', () => {
    const input = facts({ currentStock: '18.00', averageDailySales: '6.0000' });

    assert.deepEqual(assessStockRisk(input), assessStockRisk(input));
  });
});
