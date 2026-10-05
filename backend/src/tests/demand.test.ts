/**
 * Demand Intelligence Engine — unit tests.
 *
 * The engine is a pure function, so these need **no database** and no clock: the
 * window's last day is supplied as a fact, which is what makes every figure
 * below reproducible rather than dependent on the day the suite runs.
 *
 * Several cases assert an *exact* coefficient of variation rather than a range.
 * For a series of `k` equally-sized sale days inside an `n`-day window the
 * population coefficient of variation is exactly sqrt((n - k) / k), which gives
 * hand-checkable boundary values: 45 of 90 days is exactly 1.0, and 72 of 90 is
 * exactly 0.5. Those two tests are the proof that the integer square root and
 * the scale cancellation are both correct.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { daysBetween, InvalidCalendarDateError, toDayNumber, utcToday } from '../intelligence/calendar.js';
import { compareScaled, integerSqrt, square, subtract, toScaled } from '../intelligence/decimal.js';
import {
  assessDemand,
  assessDemandConfidence,
  DEMAND_POLICY,
  type DemandDay,
  type DemandFacts,
  type DemandResult,
} from '../intelligence/index.js';

const P = DEMAND_POLICY;

/** The last day of every window in these tests. Fixed, so nothing depends on today. */
const WINDOW_END = '2026-10-05';

const PRODUCT_ID = '00000000-0000-0000-0000-00000000d001';

const DAY_MS = 86_400_000;

/** `age` calendar days before the window end. Tests may use `Date`; the engine may not. */
function dateDaysBefore(end: string, days: number): string {
  const [year = 0, month = 1, day = 1] = end.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - days * DAY_MS).toISOString().slice(0, 10);
}

type Entry = readonly [age: number, units: string];

function facts(overrides: Partial<DemandFacts> = {}): DemandFacts {
  return {
    productId: PRODUCT_ID,
    windowEndDate: WINDOW_END,
    days: [],
    observableHistoryDays: '120',
    ...overrides,
  };
}

function toDays(entries: readonly Entry[]): DemandDay[] {
  return entries.map(([age, units]) => ({ date: dateDaysBefore(WINDOW_END, age), units }));
}

/** `count` consecutive days of `units`, counting back from `startAge`. */
function daily(count: number, units: string, startAge = 0): Entry[] {
  return Array.from({ length: count }, (_, index) => [startAge + index, units] as const);
}

/**
 * Every decimal field must be a well-formed decimal string or `null`, and every
 * count must be finite.
 *
 * `productId` and `reason` are strings too, so the decimal check is applied to
 * an explicit list of numeric fields rather than to every string in the result.
 */
const DECIMAL_FIELDS = [
  'unitsSold7d',
  'unitsSold30d',
  'unitsSold90d',
  'averageDailySales7d',
  'averageDailySales30d',
  'averageDailySales90d',
  'trendChangePercent',
  'coefficientOfVariation',
] as const;

const COUNT_FIELDS = ['activeSalesDays7d', 'activeSalesDays30d', 'activeSalesDays90d'] as const;

function assertNoNonFiniteNumbers(result: DemandResult): void {
  for (const key of DECIMAL_FIELDS) {
    const value = result[key];
    if (value === null) continue;
    assert.match(value, /^-?\d+(\.\d+)?$/, `${key} must be a decimal string, got ${value}`);
  }
  for (const key of COUNT_FIELDS) {
    assert.ok(Number.isFinite(result[key]), `${key} must be finite, got ${result[key]}`);
  }
  assert.match(result.evidence.totalUnitsSold, /^-?\d+(\.\d+)?$/);
  assert.match(result.evidence.consistencyRatio, /^\d+(\.\d+)?$/);
  assert.match(result.evidence.activeSalesDays, /^\d+$/);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe('decimal and calendar primitives', () => {
  it('subtracts scaled values, including into the negative', () => {
    assert.equal(subtract(toScaled('12.50'), toScaled('12.50')), 0n);
    assert.equal(subtract(toScaled('15.00'), toScaled('2.50')), toScaled('12.50'));
    assert.ok(subtract(toScaled('1.00'), toScaled('3.00')) < 0n);
  });

  it('squares a scaled value, doubling the scale', () => {
    // 3 squared is 9, expressed at twice the working scale.
    assert.equal(square(toScaled('3')), 9_000_000_000_000n);
  });

  it('takes an integer square root exactly, with no floating point', () => {
    assert.equal(integerSqrt(0n), 0n);
    assert.equal(integerSqrt(1n), 1n);
    assert.equal(integerSqrt(2n), 1n, 'floor of the square root of 2');
    assert.equal(integerSqrt(99n), 9n);
    assert.equal(integerSqrt(10_000n), 100n);
    assert.equal(integerSqrt(1_000_000_000_000n), 1_000_000n);
  });

  it('rejects a negative square root rather than returning NaN', () => {
    assert.throws(() => integerSqrt(-1n), RangeError);
  });

  it('compares scaled values', () => {
    assert.equal(compareScaled(toScaled('1.00'), toScaled('2.00')), -1);
    assert.equal(compareScaled(toScaled('2.00'), toScaled('2.00')), 0);
    assert.equal(compareScaled(toScaled('3.00'), toScaled('2.00')), 1);
  });

  it('converts calendar dates to day numbers without a clock or time zone', () => {
    assert.equal(toDayNumber('1970-01-01'), 0);
    assert.equal(toDayNumber('1970-01-02'), 1);
    assert.equal(toDayNumber('2026-10-05') - toDayNumber('2026-10-04'), 1);
    assert.equal(toDayNumber('2024-03-01') - toDayNumber('2024-02-29'), 1, 'leap year');
  });

  it('measures whole days between calendar dates', () => {
    assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
    assert.equal(daysBetween('2026-01-31', '2026-01-01'), -30, 'negative when reversed');
  });

  it('rejects a date that is not a real calendar day', () => {
    for (const bad of ['2026-02-30', '2026-13-01', 'not-a-date', '2026-1-1', '']) {
      assert.throws(() => toDayNumber(bad), InvalidCalendarDateError, `should reject ${bad}`);
    }
  });

  it('reports the UTC calendar date of an instant, not a shifted one', () => {
    // 2026-10-05T13:40Z is 19:10 in Asia/Calcutta. The UTC date must not move,
    // and a local-date reading must not push it into the next or previous day.
    assert.equal(utcToday(new Date('2026-10-05T13:40:00.000Z')), '2026-10-05');
    assert.equal(utcToday(new Date('2026-10-05T23:59:59.999Z')), '2026-10-05');
    assert.equal(utcToday(new Date('2026-10-05T00:00:00.000Z')), '2026-10-05');
    assert.equal(utcToday(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01');
  });
});

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

describe('Demand Intelligence — velocity', () => {
  it('divides units by the calendar length of each window', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    assert.equal(result.unitsSold7d, '70.00');
    assert.equal(result.unitsSold30d, '300.00');
    assert.equal(result.unitsSold90d, '900.00');
    assert.equal(result.averageDailySales7d, '10.0000', '70 over 7 days');
    assert.equal(result.averageDailySales30d, '10.0000', '300 over 30 days');
    assert.equal(result.averageDailySales90d, '10.0000', '900 over 90 days');
  });

  it('counts one active sales day per calendar day that had a sale', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    assert.equal(result.activeSalesDays7d, 7);
    assert.equal(result.activeSalesDays30d, 30);
    assert.equal(result.activeSalesDays90d, 90);
  });

  it('reports zero velocity for a window with no sales, never NaN', () => {
    // Five sale days, all at least a week old.
    const result = assessDemand(facts({ days: toDays(daily(5, '10', 7)) }));

    assert.equal(result.unitsSold7d, '0.00');
    assert.equal(result.unitsSold30d, '50.00', 'the five days are 7 to 11 days old');
    assert.equal(result.averageDailySales7d, '0.0000');
    // 50 over 30 is 1.6666..., rendered by truncating at four places, which is
    // how every figure in this layer is rendered.
    assert.equal(result.averageDailySales30d, '1.6666', '50 over 30 days');
    assert.equal(result.averageDailySales90d, '0.5555', '50 over 90 days');
    assertNoNonFiniteNumbers(result);
  });

  it('handles a product with no sales at all', () => {
    const result = assessDemand(facts());

    assert.equal(result.unitsSold7d, '0.00');
    assert.equal(result.unitsSold90d, '0.00');
    assert.equal(result.averageDailySales90d, '0.0000');
    assert.equal(result.activeSalesDays90d, 0);
    assert.equal(result.trend, 'INSUFFICIENT_DATA');
    assert.equal(result.variability, 'INSUFFICIENT_DATA');
    assert.equal(result.coefficientOfVariation, null, 'no mean means no ratio');
    assert.equal(result.trendChangePercent, null);
    assert.equal(result.confidence, 'INSUFFICIENT');
    assert.equal(
      result.reason,
      'No sales were recorded in the 90-day window, so demand behavior cannot be assessed.',
    );
    assertNoNonFiniteNumbers(result);
  });

  it('handles a single sale', () => {
    const result = assessDemand(facts({ days: toDays([[3, '12.00']]) }));

    assert.equal(result.unitsSold7d, '12.00');
    assert.equal(result.activeSalesDays90d, 1);
    assert.equal(result.confidence, 'INSUFFICIENT', 'one day is not evidence');
    assert.equal(result.variability, 'INSUFFICIENT_DATA');
    assertNoNonFiniteNumbers(result);
  });

  it('keeps exact decimal precision on fractional quantities', () => {
    // 90 times 0.01 is 0.90, and 0.90 over 90 days is 0.01 exactly.
    const result = assessDemand(facts({ days: toDays(daily(90, '0.01')) }));

    assert.equal(result.unitsSold90d, '0.90');
    assert.equal(result.averageDailySales90d, '0.0100');
    assert.equal(result.activeSalesDays90d, 90, 'a 0.01-unit day is still an active day');
  });

  it('handles very large quantities without overflow or rounding drift', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '99999999.99')) }));

    assert.equal(result.unitsSold90d, '8999999999.10');
    assert.equal(result.averageDailySales90d, '99999999.9900');
  });

  it('ignores sales outside the 90-day window and any future-dated sale', () => {
    const result = assessDemand(
      facts({
        days: toDays([
          ...daily(30, '10'),
          // 90 days old is the first day outside the window; -1 is in the future.
          [90, '500.00'],
          [-1, '500.00'],
        ]),
      }),
    );

    assert.equal(result.unitsSold90d, '300.00', 'out-of-window days are excluded');
    assert.equal(result.activeSalesDays90d, 30);
  });
});

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

describe('Demand Intelligence — trend', () => {
  it('classifies steady demand as STABLE', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    assert.equal(result.trend, 'STABLE');
    assert.equal(result.trendChangePercent, '0.00');
    assert.equal(result.reason, 'Recent demand is broadly consistent with the 30-day baseline.');
  });

  it('classifies rising demand as INCREASING with a signed percentage', () => {
    // 7 days at 20 gives 20/day; 23 days at 10 gives a 12.3333/day baseline.
    const result = assessDemand(
      facts({ days: toDays([...daily(7, '20'), ...daily(23, '10', 7)]) }),
    );

    assert.equal(result.averageDailySales7d, '20.0000');
    assert.equal(result.averageDailySales30d, '12.3333');
    assert.equal(result.trend, 'INCREASING');
    assert.equal(result.trendChangePercent, '62.16');
    assert.match(result.reason, /approximately 62\.1% above the 30-day baseline\./);
  });

  it('classifies falling demand as DECREASING', () => {
    const result = assessDemand(
      facts({ days: toDays([...daily(7, '10'), ...daily(23, '20', 7)]) }),
    );

    assert.equal(result.trend, 'DECREASING');
    assert.equal(result.trendChangePercent, '-43.39');
    assert.match(result.reason, /approximately 43\.3% below the 30-day baseline\./);
  });

  it('treats a complete stop of recent sales as DECREASING, not an error', () => {
    // Every sale is 7 to 29 days old, so the recent window is genuinely empty.
    const result = assessDemand(facts({ days: toDays(daily(23, '13.04', 7)) }));

    assert.equal(result.unitsSold7d, '0.00');
    assert.equal(result.averageDailySales7d, '0.0000');
    assert.equal(result.trend, 'DECREASING');
    assert.equal(result.trendChangePercent, '-100.00');
    assert.match(result.reason, /approximately 100% below the 30-day baseline\./);
  });

  it('reports a zero 30-day baseline as INSUFFICIENT_DATA rather than a percentage', () => {
    // All 60 sale days are 30 to 89 days old, so no sale falls in the baseline.
    const result = assessDemand(facts({ days: toDays(daily(60, '10', 30)) }));

    assert.equal(result.unitsSold7d, '0.00');
    assert.equal(result.unitsSold30d, '0.00');
    assert.equal(result.averageDailySales30d, '0.0000');
    assert.equal(result.trend, 'INSUFFICIENT_DATA');
    assert.equal(result.trendChangePercent, null, 'undefined, never Infinity');
    assert.equal(
      result.reason,
      'Not enough sales activity is available to reliably assess demand behavior.',
    );
    assertNoNonFiniteNumbers(result);
  });

  it('ignores a change too small to be a real trend', () => {
    // 7 days at 11 against a baseline of 10.2333: a 2.28% wobble.
    const result = assessDemand(
      facts({ days: toDays([...daily(7, '11'), ...daily(23, '10', 7)]) }),
    );

    assert.equal(result.trend, 'STABLE');
    assert.notEqual(result.trendChangePercent, '0.00', 'the change is real but tiny');
    assert.ok(
      Math.abs(Number(result.trendChangePercent)) < Number(P.trendChangeThresholdPercent),
      `expected under ${P.trendChangeThresholdPercent}%, got ${result.trendChangePercent}`,
    );
  });

  it('classifies a change exactly on the threshold as meaningful', () => {
    // 77 units over 7 days is 11/day; 300 units over 30 days is exactly 10/day.
    // The change is therefore exactly +10.00%, which meets the threshold.
    const result = assessDemand(
      facts({ days: toDays([...daily(7, '11'), [7, '223']]) }),
    );

    assert.equal(result.averageDailySales7d, '11.0000');
    assert.equal(result.averageDailySales30d, '10.0000');
    assert.equal(result.trendChangePercent, '10.00');
    assert.equal(result.trend, 'INCREASING');
    assert.equal(toScaled(P.trendChangeThresholdPercent), 10_000_000n);
  });

  it('reports insufficient activity rather than inventing a trend', () => {
    // Two sale days in the 30-day window is below minimumActiveDaysForTrend.
    const result = assessDemand(facts({ days: toDays([[1, '50'], [20, '50']]) }));

    assert.equal(result.trend, 'INSUFFICIENT_DATA');
    assert.equal(result.trendChangePercent, null);
    assert.equal(
      result.reason,
      'Not enough sales activity is available to reliably assess demand behavior.',
    );
  });

  it('reports insufficient evidence when the product is too new', () => {
    const result = assessDemand(
      facts({ days: toDays(daily(90, '10')), observableHistoryDays: '5' }),
    );

    assert.equal(result.trend, 'INSUFFICIENT_DATA');
    assert.equal(result.confidence, 'INSUFFICIENT');
  });
});

// ---------------------------------------------------------------------------
// Variability
// ---------------------------------------------------------------------------

describe('Demand Intelligence — variability', () => {
  it('reports zero variation for perfectly constant daily demand', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    // Every day identical means the sum of squares times n equals the sum
    // squared, so the variance is exactly zero.
    assert.equal(result.coefficientOfVariation, '0.0000');
    assert.equal(result.variability, 'LOW_VARIABILITY');
  });

  it('is exactly 0.5 on the low-variability boundary, and classifies LOW', () => {
    // 72 equally-sized days: the coefficient is exactly 0.5.
    const result = assessDemand(facts({ days: toDays(daily(72, '10')) }));

    assert.equal(result.coefficientOfVariation, '0.5000');
    assert.equal(result.variability, 'LOW_VARIABILITY');
    assert.equal(P.lowVariabilityMaxCoefficient, '0.50');
  });

  it('is exactly 1.0 on the high-variability boundary, and classifies HIGH', () => {
    // 45 equally-sized days: the coefficient is exactly 1.
    const result = assessDemand(facts({ days: toDays(daily(45, '10')) }));

    assert.equal(result.coefficientOfVariation, '1.0000');
    assert.equal(result.variability, 'HIGH_VARIABILITY');
    assert.equal(P.highVariabilityMinCoefficient, '1.00');
  });

  it('classifies an intermediate spread as MEDIUM_VARIABILITY', () => {
    // 64 equally-sized days: the coefficient is about 0.637, between the bounds.
    const result = assessDemand(facts({ days: toDays(daily(64, '10')) }));

    assert.equal(result.coefficientOfVariation, '0.6373');
    assert.equal(result.variability, 'MEDIUM_VARIABILITY');
  });

  it('classifies a well-spread series as HIGH_VARIABILITY', () => {
    // 36 equally-sized days: the coefficient is about 1.225, above the bound.
    const result = assessDemand(facts({ days: toDays(daily(36, '10')) }));

    assert.equal(result.variability, 'HIGH_VARIABILITY');
  });

  it('reports a lumpy, intermittent series as highly variable', () => {
    // Seven large sale days and nothing in between.
    const result = assessDemand(
      facts({
        days: toDays(
          daily(7, '100', 0).map(([age]) => [age * 10, '100'] as const),
        ),
      }),
    );

    assert.equal(result.activeSalesDays90d, 7);
    assert.ok(Number(result.coefficientOfVariation) > 1, 'a lumpy series exceeds 1');
    assert.equal(result.variability, 'HIGH_VARIABILITY');
  });

  it('computes the statistic but withholds the verdict when there are too few observations', () => {
    // Three equal sale days in a 90-day window is a real coefficient of about
    // 5.39, but three points is not a distribution.
    const result = assessDemand(facts({ days: toDays([[0, '100'], [5, '100'], [10, '100']]) }));

    assert.equal(result.coefficientOfVariation, '5.3851');
    assert.equal(result.variability, 'INSUFFICIENT_DATA');
  });

  it('leaves the coefficient null when there is no mean to divide by', () => {
    const result = assessDemand(facts());

    assert.equal(result.coefficientOfVariation, null);
    assert.equal(result.variability, 'INSUFFICIENT_DATA');
    assertNoNonFiniteNumbers(result);
  });

  it('never produces NaN or Infinity for a sparse, extreme series', () => {
    const result = assessDemand(facts({ days: toDays([[0, '0.01'], [89, '99999.99']]) }));

    assertNoNonFiniteNumbers(result);
    assert.equal(result.variability, 'INSUFFICIENT_DATA');
  });
});

// ---------------------------------------------------------------------------
// Confidence and evidence
// ---------------------------------------------------------------------------

describe('Demand Intelligence — confidence and evidence', () => {
  it('is HIGH for dense, well-established demand', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.evidence.hasSufficientEvidence, true);
    assert.equal(result.evidence.salesWindowDays, 90);
    assert.equal(result.evidence.activeSalesDays, '30');
    assert.equal(result.evidence.totalUnitsSold, '900.00');
    assert.equal(result.evidence.demandObservationDays, 90);
    assert.equal(result.evidence.consistencyRatio, '1.0000');
  });

  it('does not award HIGH confidence for calendar length alone', () => {
    // Ninety days of history, sales on only two of them.
    const result = assessDemand(facts({ days: toDays([[2, '40'], [60, '40']]) }));

    assert.equal(result.evidence.salesWindowDays, 90, 'the window really is 90 days');
    assert.equal(result.evidence.demandObservationDays, 2, 'but there are two observations');
    assert.equal(result.evidence.consistencyRatio, '0.0222');
    assert.equal(result.confidence, 'LOW', 'calendar age is not demand evidence');
    assert.equal(result.variability, 'INSUFFICIENT_DATA');
  });

  it('is MEDIUM for moderate, consistent activity', () => {
    const result = assessDemand(
      facts({ days: toDays([...daily(12, '5'), ...daily(8, '5', 40)]) }),
    );

    assert.equal(result.activeSalesDays30d, 12);
    assert.equal(result.activeSalesDays90d, 20);
    assert.equal(result.confidence, 'MEDIUM');
  });

  it('is INSUFFICIENT when the observable history is too short', () => {
    const result = assessDemand(
      facts({ days: toDays(daily(90, '10')), observableHistoryDays: '13' }),
    );

    assert.equal(result.confidence, 'INSUFFICIENT');
    assert.equal(result.evidence.hasSufficientEvidence, false);
  });

  it('never reports more active days than the window can hold', () => {
    const result = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    assert.ok(result.activeSalesDays7d <= P.recentDays);
    assert.ok(result.activeSalesDays30d <= P.baselineDays);
    assert.ok(result.activeSalesDays90d <= P.longDays);
  });

  it('keeps the confidence ladder independent of what the trend says', () => {
    const steady = assessDemand(facts({ days: toDays(daily(90, '10')) }));
    const falling = assessDemand(
      facts({ days: toDays([...daily(7, '1'), ...daily(83, '11', 7)]) }),
    );

    assert.equal(steady.trend, 'STABLE');
    assert.equal(steady.confidence, 'HIGH');
    assert.equal(falling.trend, 'DECREASING', 'a falling trend does not lower confidence');
  });

  it('reports the trend and variability axes independently', () => {
    const result = assessDemand(facts({ days: toDays(daily(45, '10')) }));

    assert.equal(result.variability, 'HIGH_VARIABILITY');
    assert.equal(result.trend, 'STABLE');
    assert.equal(result.confidence, 'HIGH');
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('Demand Intelligence — purity and determinism', () => {
  it('produces an identical result for identical facts', () => {
    const first = assessDemand(facts({ days: toDays(daily(90, '10')) }));
    const second = assessDemand(facts({ days: toDays(daily(90, '10')) }));

    assert.deepEqual(first, second);
  });

  it('does not depend on the order the days arrive in', () => {
    const ordered = toDays(daily(90, '10'));
    const reversed = [...ordered].reverse();

    assert.deepEqual(
      assessDemand(facts({ days: ordered })),
      assessDemand(facts({ days: reversed })),
    );
  });

  it('ignores a zero-unit day rather than counting it as activity', () => {
    const result = assessDemand(
      facts({ days: toDays([[0, '0.00'], [1, '10.00'], [2, '10.00']]) }),
    );

    assert.equal(result.activeSalesDays7d, 2);
    assert.equal(result.unitsSold7d, '20.00');
  });

  it('exposes the confidence ladder as a separately testable function', () => {
    const totals = {
      recent: { units: toScaled('70'), activeDays: 7 },
      baseline: { units: toScaled('300'), activeDays: 30 },
      long: { units: toScaled('900'), activeDays: 90 },
      series: [] as bigint[],
    };

    assert.equal(
      assessDemandConfidence(facts({ days: toDays(daily(90, '10')) }), totals, toScaled('1')),
      'HIGH',
    );
    assert.equal(
      assessDemandConfidence(facts({ observableHistoryDays: '3' }), totals, toScaled('1')),
      'INSUFFICIENT',
      'history gates the ladder before the numbers do',
    );
  });
});
