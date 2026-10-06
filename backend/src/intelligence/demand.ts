/**
 * Demand Intelligence Engine.
 *
 * A **pure function** from structured facts to a `DemandResult`. No SQL, no HTTP,
 * no clock, no randomness — the same facts always produce the same result.
 *
 * The question it answers:
 *
 * > What is the historical demand behavior of this product?
 *
 * It answers by describing what already happened, and nothing more. There is no
 * projection, no extrapolation and no expected future value anywhere in this
 * file: `averageDailySales7d` is a *rate observed in the past*, and the reason
 * text is assembled from fixed templates rather than generated.
 *
 * ## Why zero days are never supplied
 *
 * {@link DemandFacts.days} carries only days that had a sale. Every statistic
 * here is still exact, because a day with no demand contributes `0` to the sum
 * and `0²` to the sum of squares while still counting towards the window
 * length — and the window length comes from {@link DEMAND_POLICY}, not from the
 * row count. So the population mean and variance over the full 90-day window can
 * be computed from the days that have sales, provided the divisor stays 90.
 *
 * ## Exactness
 *
 * Mean, variance and the trend ratio are computed in exact scaled `bigint`
 * arithmetic. The one genuinely irrational step — the square root in the
 * coefficient of variation — is taken with an integer Newton iteration rather
 * than `Math.sqrt`, so the result does not depend on the platform's float unit
 * in the last place.
 */

import { toDayNumber } from './calendar.js';
import {
  compare,
  compareScaled,
  divide,
  fromScaled,
  integerSqrt,
  multiply,
  square,
  subtract,
  toScaled,
} from './decimal.js';
import { DEMAND_POLICY } from './policies.js';
import {
  type ConfidenceLevel,
  type DemandDay,
  type DemandEvidence,
  type DemandFacts,
  type DemandResult,
  type DemandTrend,
  type DemandVariability,
} from './types.js';

const P = DEMAND_POLICY;

/** Ten to the twelfth, used to lift a squared ratio into the working scale. */
const SQUARED_SCALE = 10n ** 12n;

/** Day totals already bucketed into the three nested windows. */
interface WindowTotals {
  units: bigint;
  activeDays: number;
}

/** The three windows, plus the daily series used for variability. */
interface BucketedDemand {
  recent: WindowTotals;
  baseline: WindowTotals;
  long: WindowTotals;
  /** Daily totals for every day inside the long window, including gaps. */
  series: bigint[];
}

/**
 * Sort sales days into the 7-, 30- and 90-day windows.
 *
 * A day is `n` days old when it is `n` days before the window's last day, so the
 * 7-day window is ages 0-6 inclusive. Days outside the long window — and
 * future-dated rows, which a corrected timestamp can produce — are dropped
 * rather than folded in, because counting them would understate every rate.
 */
function bucketByWindow(facts: DemandFacts): BucketedDemand {
  const windowEnd = toDayNumber(facts.windowEndDate);

  const recent: WindowTotals = { units: 0n, activeDays: 0 };
  const baseline: WindowTotals = { units: 0n, activeDays: 0 };
  const long: WindowTotals = { units: 0n, activeDays: 0 };
  const series: bigint[] = [];

  for (const day of facts.days as readonly DemandDay[]) {
    const age = windowEnd - toDayNumber(day.date);
    if (age < 0 || age >= P.longDays) continue;

    const units = toScaled(day.units);
    // A non-positive day is not an active sales day and moves no statistic.
    if (units <= 0n) continue;

    long.units += units;
    long.activeDays += 1;
    series.push(units);

    if (age < P.baselineDays) {
      baseline.units += units;
      baseline.activeDays += 1;
    }
    if (age < P.recentDays) {
      recent.units += units;
      recent.activeDays += 1;
    }
  }

  return { recent, baseline, long, series };
}

/** Units ÷ window length. A zero-demand window yields zero, never `NaN`. */
function dailyRate(units: bigint, windowDays: number): bigint {
  return divide(units, toScaled(windowDays));
}

/**
 * The demand rate for one window, as a rendered decimal string.
 *
 * The shared seam between the Demand Engine and the Reorder Engine: both size
 * their buffers from the same rate, and both therefore get it from this one
 * function. The Reorder Engine reads its units from a 30-day aggregate and never
 * needs the daily series.
 */
export function averageDailyRate(units: string, windowDays: number): string {
  return fromScaled(dailyRate(toScaled(units), windowDays), 4);
}

/**
 * Coefficient of variation of the daily series: standard deviation ÷ mean.
 *
 * Uses the population variance over the full window, because the 90 days are a
 * complete enumeration of the period rather than a sample drawn from a larger
 * population.
 *
 * With `S = Σxᵢ` and `Q = Σxᵢ²` the mean cancels out of the ratio, leaving
 *
 *   CV² = (Q/n − (S/n)²) / (S/n)² = (Q·n − S²) / S²
 *
 * which is exact in integers — no rounding happens before the root. Cauchy-
 * Schwarz guarantees `Q·n ≥ S²` for non-negative inputs, so the difference is
 * clamped at zero rather than trusted blindly.
 */
export function coefficientOfVariation(series: readonly bigint[], windowDays: number): bigint | null {
  const count = BigInt(windowDays);
  let sum = 0n;
  let sumOfSquares = 0n;

  for (const value of series) {
    sum += value;
    sumOfSquares += square(value);
  }

  // No demand at all means no mean, so the ratio is undefined rather than zero.
  if (sum <= 0n) return null;

  const varianceNumerator = sumOfSquares * count - sum * sum;
  if (varianceNumerator <= 0n) return 0n;

  return integerSqrt((varianceNumerator * SQUARED_SCALE) / (sum * sum));
}

/** Enough history and activity to describe demand at all. */
function hasSufficientEvidence(
  facts: DemandFacts,
  totals: BucketedDemand,
): boolean {
  return (
    compare(facts.observableHistoryDays, P.minimumObservableDays) >= 0 &&
    totals.long.activeDays >= P.minimumActiveDaysForAssessment
  );
}

/**
 * Signed change of the 7-day rate against the 30-day rate, in percent.
 *
 * `null` when the baseline is zero, because a percentage change from zero has no
 * meaning — the ratio is undefined, not infinite.
 */
function computeTrendChangePercent(
  recentRate: bigint,
  baselineRate: bigint,
): string | null {
  if (baselineRate <= 0n) return null;

  const ratio = divide(subtract(recentRate, baselineRate), baselineRate);
  return fromScaled(multiply(ratio, toScaled(100)), 2);
}

/**
 * Classify the 7-day rate against the 30-day baseline.
 *
 * The threshold is deliberately wide: a few units of day-to-day noise must not
 * be reported as a trend, because a user who believes demand is falling will
 * reorder stock that was never short.
 */
export function classifyTrend(
  facts: DemandFacts,
  totals: BucketedDemand,
  recentRate: bigint,
  baselineRate: bigint,
): { trend: DemandTrend; changePercent: string | null } {
  const enoughActivity =
    hasSufficientEvidence(facts, totals) &&
    totals.baseline.activeDays >= P.minimumActiveDaysForTrend;

  if (!enoughActivity) return { trend: 'INSUFFICIENT_DATA', changePercent: null };

  const changePercent = computeTrendChangePercent(recentRate, baselineRate);
  if (changePercent === null) return { trend: 'INSUFFICIENT_DATA', changePercent: null };

  const change = toScaled(changePercent);
  const threshold = toScaled(P.trendChangeThresholdPercent);

  if (change >= threshold) return { trend: 'INCREASING', changePercent };
  if (change <= -threshold) return { trend: 'DECREASING', changePercent };
  return { trend: 'STABLE', changePercent };
}

/**
 * Classify the daily series by coefficient of variation.
 *
 * Three active days are not enough to say whether demand is steady or erratic;
 * the observation count is checked before the statistic is read at all.
 */
export function classifyVariability(
  facts: DemandFacts,
  totals: BucketedDemand,
  coefficient: bigint | null,
): DemandVariability {
  const enoughObservations =
    hasSufficientEvidence(facts, totals) &&
    totals.long.activeDays >= P.minimumActiveDaysForVariability;

  if (coefficient === null || !enoughObservations) return 'INSUFFICIENT_DATA';

  if (compareScaled(coefficient, toScaled(P.lowVariabilityMaxCoefficient)) <= 0) {
    return 'LOW_VARIABILITY';
  }
  if (compareScaled(coefficient, toScaled(P.highVariabilityMinCoefficient)) >= 0) {
    return 'HIGH_VARIABILITY';
  }
  return 'MEDIUM_VARIABILITY';
}

/**
 * Confidence in the *demand evidence*, independent of what it says.
 *
 * Calendar age buys nothing on its own. A product with ninety days of history
 * and two sale days is `LOW` at best, and one sale day is `INSUFFICIENT` — the
 * consistency ratio is what stops length from being mistaken for evidence.
 */
export function assessDemandConfidence(
  facts: DemandFacts,
  totals: BucketedDemand,
  consistencyRatio: bigint,
): ConfidenceLevel {
  if (!hasSufficientEvidence(facts, totals)) return 'INSUFFICIENT';

  const units30 = totals.baseline.units;

  if (
    totals.baseline.activeDays >= P.highConfidence.activeDays30 &&
    totals.long.activeDays >= P.highConfidence.activeDays90 &&
    units30 >= toScaled(P.highConfidence.unitsSold30) &&
    consistencyRatio >= toScaled(P.highConfidence.minimumConsistencyRatio)
  ) {
    return 'HIGH';
  }

  if (
    totals.baseline.activeDays >= P.mediumConfidence.activeDays30 &&
    totals.long.activeDays >= P.mediumConfidence.activeDays90 &&
    units30 >= toScaled(P.mediumConfidence.unitsSold30)
  ) {
    return 'MEDIUM';
  }

  return 'LOW';
}

/** The window aggregates the confidence ladder reads, in a form a caller can build. */
export interface DemandConfidenceTotals {
  /** Days since the product's first ledger movement. */
  observableHistoryDays: string;
  /** Distinct days with a sale inside the 30-day baseline window. */
  activeDays30: number;
  /** Distinct days with a sale inside the whole window. */
  activeDays90: number;
  /** Units sold inside the 30-day baseline window. */
  unitsSold30: string;
  /** Length of the widest window; the consistency ratio's denominator. */
  longWindowDays: number;
}

/**
 * The demand confidence ladder, for a caller that already holds window totals
 * rather than a daily series.
 *
 * The Reorder Engine needs a rate and a confidence but no trend and no
 * coefficient of variation, and its projection deliberately carries aggregates
 * instead of ninety rows per product. This is the same ladder
 * {@link assessDemandConfidence} runs — it builds the same internal totals and
 * calls it — so there is exactly one definition of what counts as well-evidenced
 * demand in this codebase.
 */
export function assessDemandConfidenceFromTotals(
  totals: DemandConfidenceTotals,
): ConfidenceLevel {
  const units30 = toScaled(totals.unitsSold30);

  return assessDemandConfidence(
    {
      productId: '',
      windowEndDate: '',
      days: [],
      observableHistoryDays: totals.observableHistoryDays,
    },
    {
      recent: { units: 0n, activeDays: totals.activeDays30 },
      baseline: { units: units30, activeDays: totals.activeDays30 },
      long: { units: units30, activeDays: totals.activeDays90 },
      series: [],
    },
    divide(toScaled(totals.activeDays90), toScaled(totals.longWindowDays)),
  );
}

/** Render a percentage for a sentence: `40.00` reads as `40`, `33.33` as `33.3`. */
function formatPercent(changePercent: string): string {
  const magnitude = changePercent.startsWith('-')
    ? changePercent.slice(1)
    : changePercent;
  const oneDecimal = fromScaled(toScaled(magnitude), 1);
  return oneDecimal.endsWith('.0') ? oneDecimal.slice(0, -2) : oneDecimal;
}

/**
 * The explanation, assembled from fixed templates.
 *
 * It describes the history and stops there — no "likely to continue", no
 * "expect", no implication about what should be ordered.
 */
function buildReason(
  trend: DemandTrend,
  changePercent: string | null,
  totals: BucketedDemand,
): string {
  if (trend === 'INSUFFICIENT_DATA') {
    if (totals.long.activeDays === 0) {
      return 'No sales were recorded in the 90-day window, so demand behavior cannot be assessed.';
    }
    // Every other insufficient case is thin activity: a baseline with any active
    // day at all has a positive rate, so a zero baseline is already covered by
    // the active-day gate above and needs no separate branch.
    return 'Not enough sales activity is available to reliably assess demand behavior.';
  }

  if (trend === 'STABLE') {
    return 'Recent demand is broadly consistent with the 30-day baseline.';
  }

  const magnitude = changePercent === null ? '0' : formatPercent(changePercent);
  const direction = trend === 'INCREASING' ? 'above' : 'below';
  return `Recent demand is approximately ${magnitude}% ${direction} the 30-day baseline.`;
}

/**
 * Assess the historical demand behaviour of one product.
 *
 * @throws {InvalidCalendarDateError} when a supplied date is not a real
 * calendar date. That is corrupt input, not a demand signal, so it is reported
 * rather than silently dropped.
 */
export function assessDemand(facts: DemandFacts): DemandResult {
  const totals = bucketByWindow(facts);

  const recentRate = dailyRate(totals.recent.units, P.recentDays);
  const baselineRate = dailyRate(totals.baseline.units, P.baselineDays);
  const longRate = dailyRate(totals.long.units, P.longDays);

  // Gap days are absent from `series`, but the population is the full window:
  // the omitted days contribute zero to both the sum and the sum of squares.
  const coefficient = coefficientOfVariation(totals.series, P.longDays);

  const consistencyRatio = divide(
    toScaled(totals.long.activeDays),
    toScaled(P.longDays),
  );

  const { trend, changePercent } = classifyTrend(
    facts,
    totals,
    recentRate,
    baselineRate,
  );
  const variability = classifyVariability(facts, totals, coefficient);
  const confidence = assessDemandConfidence(facts, totals, consistencyRatio);

  const evidence: DemandEvidence = {
    salesWindowDays: P.longDays,
    activeSalesDays: String(totals.baseline.activeDays),
    totalUnitsSold: fromScaled(totals.long.units, 2),
    demandObservationDays: totals.long.activeDays,
    consistencyRatio: fromScaled(consistencyRatio, 4),
    hasSufficientEvidence: hasSufficientEvidence(facts, totals),
  };

  return {
    productId: facts.productId,
    unitsSold7d: fromScaled(totals.recent.units, 2),
    unitsSold30d: fromScaled(totals.baseline.units, 2),
    unitsSold90d: fromScaled(totals.long.units, 2),
    averageDailySales7d: fromScaled(recentRate, 4),
    averageDailySales30d: fromScaled(baselineRate, 4),
    averageDailySales90d: fromScaled(longRate, 4),
    activeSalesDays7d: totals.recent.activeDays,
    activeSalesDays30d: totals.baseline.activeDays,
    activeSalesDays90d: totals.long.activeDays,
    trend,
    trendChangePercent: changePercent,
    variability,
    coefficientOfVariation: coefficient === null ? null : fromScaled(coefficient, 4),
    confidence,
    reason: buildReason(trend, changePercent, totals),
    evidence,
  };
}

export { DEMAND_POLICY } from './policies.js';
export { DEMAND_TRENDS, DEMAND_VARIABILITY } from './types.js';
export type {
  ConfidenceLevel,
  DemandDay,
  DemandEvidence,
  DemandFacts,
  DemandResult,
  DemandTrend,
  DemandVariability,
} from './types.js';
