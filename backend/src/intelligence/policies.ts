/**
 * Stock Risk Engine — v1 policy.
 *
 * Every threshold, buffer and cut-off the engine uses lives here, in one place.
 * Nothing in the engine hard-codes a number: changing a policy value changes the
 * engine's behaviour, and there is exactly one file to edit to do it.
 *
 * These are deliberately conservative starting values for a general retail or
 * distribution business, not universal truth. They are meant to be tuned once
 * real purchasing behaviour is known.
 */

export const STOCK_RISK_POLICY = {
  // ---- Demand window ------------------------------------------------------

  /**
   * Historical sales-velocity window, in calendar days.
   *
   * `averageDailySales = unitsSold / analysisWindowDays`. This is a *historical*
   * rate, never a forecast.
   */
  analysisWindowDays: 30,

  // ---- Buffers and thresholds --------------------------------------------

  /**
   * Safety-stock buffer, in days of cover.
   *
   * `safetyStock = averageDailySales × safetyStockDays`.
   */
  safetyStockDays: 2,

  /**
   * Days of cover at or above which stock is classified `OVERSTOCK`.
   *
   * Only reachable once demand evidence is sufficient, so a large quantity of a
   * product nobody buys is `INSUFFICIENT_DATA`, not `OVERSTOCK`. Slow and dead
   * stock belong to the future dedicated engine, not here.
   */
  overstockDaysOfStock: 60,

  // ---- Evidence / confidence cut-offs ------------------------------------

  /**
   * Below this much observable history, confidence is `INSUFFICIENT`.
   *
   * Measured in *observable* history — days since the product's first ledger
   * entry — not calendar age. A product created 90 days ago whose first movement
   * landed yesterday has one day of evidence.
   */
  minimumObservableDays: 14,

  /**
   * `HIGH` confidence needs at least this much observable history **and** this
   * many distinct days with an actual sale. Age alone never earns confidence.
   */
  highConfidenceObservableDays: 60,
  highConfidenceActiveDays: 10,

  /** `MEDIUM` confidence needs at least this much observable history and activity. */
  mediumConfidenceObservableDays: 30,
  mediumConfidenceActiveDays: 4,

  /**
   * `HIGH` additionally requires supplier lead-time evidence: without knowing how
   * long a supplier actually takes, coverage cannot be called comfortable.
   */
  highConfidenceRequiresLeadTimeEvidence: true,
} as const;

export type StockRiskPolicy = typeof STOCK_RISK_POLICY;

/** Deterministic operational priority, for ordering a future action centre. */
export const RISK_PRIORITY = {
  OUT_OF_STOCK: 100,
  CRITICAL: 80,
  LOW: 60,
  OVERSTOCK: 40,
  INSUFFICIENT_DATA: 20,
  HEALTHY: 0,
} as const;

// ---------------------------------------------------------------------------
// Demand Intelligence
// ---------------------------------------------------------------------------

/**
 * Demand Intelligence — v1 policy.
 *
 * Every window, threshold and evidence cut-off lives here, on the same terms as
 * {@link STOCK_RISK_POLICY}: one file to edit, nothing hard-coded downstream.
 *
 * These thresholds describe **historical** behaviour only. Nothing here estimates
 * or predicts future demand — a forward-looking number is a different engine
 * with a different responsibility, and blending the two would make an assessment
 * look more certain than the evidence allows.
 */
export const DEMAND_POLICY = {
  // ---- Windows ------------------------------------------------------------
  // Three nested calendar windows, all ending on the same last complete day.

  /** Most recent window. The "recent" half of the trend comparison. */
  recentDays: 7,
  /** Comparison baseline, and the window the Stock Risk Engine also uses. */
  baselineDays: 30,
  /** Widest window, and the series variability is measured over. */
  longDays: 90,

  // ---- Trend --------------------------------------------------------------

  /**
   * Smallest percentage change that counts as a real trend.
   *
   * Below this, day-to-day noise would be reported as a rising or falling
   * demand, which is worse than saying nothing: a user acting on a phantom trend
   * reorders stock that was never going to run out.
   */
  trendChangeThresholdPercent: '10.00',

  // ---- Variability --------------------------------------------------------

  /**
   * Coefficient of variation at or below which demand is `LOW_VARIABILITY`.
   *
   * A steady 10 units a day gives a CV near zero. A product that sells 50 units
   * in one day and nothing for a month gives a CV well above 1.
   */
  lowVariabilityMaxCoefficient: '0.50',

  /** Coefficient of variation at or above which demand is `HIGH_VARIABILITY`. */
  highVariabilityMinCoefficient: '1.00',

  // ---- Evidence gates -----------------------------------------------------

  /** Below this much observable history, nothing about demand is assessable. */
  minimumObservableDays: 14,

  /**
   * Fewer active sales days than this and demand is `INSUFFICIENT` throughout.
   *
   * Calendar age is not evidence. A product that sold on two days out of ninety
   * has ninety days of *calendar* and two days of *demand*, and the difference
   * is the whole point of this gate.
   */
  minimumActiveDaysForAssessment: 2,

  /** A trend needs more activity than the bare minimum to mean anything. */
  minimumActiveDaysForTrend: 3,

  /**
   * Variability needs more active days still: a coefficient of variation over
   * three data points is noise wearing a statistic's clothes.
   */
  minimumActiveDaysForVariability: 7,

  // ---- Confidence ---------------------------------------------------------

  /** `HIGH` confidence thresholds. All must be met. */
  highConfidence: {
    activeDays30: 10,
    activeDays90: 20,
    unitsSold30: '30.00',
    /**
     * Fraction of the 90-day window that must have had a sale.
     *
     * This is the gate that stops a long-but-empty history from reading as
     * strong evidence, whatever the calendar says.
     */
    minimumConsistencyRatio: '0.30',
  },

  /** `MEDIUM` confidence thresholds. All must be met. */
  mediumConfidence: {
    activeDays30: 4,
    activeDays90: 8,
    unitsSold30: '5.00',
  },
} as const;

export type DemandPolicy = typeof DEMAND_POLICY;

// ---------------------------------------------------------------------------
// Reorder Engine
// ---------------------------------------------------------------------------

/**
 * Reorder Engine — v1 policy.
 *
 * The decision rule itself is deliberately *not* a tunable threshold: "net
 * available stock is below the reorder point" is the definition of needing a
 * reorder, and a policy knob for it would let the definition drift. What lives
 * here is everything that is genuinely a judgement — how much evidence is
 * needed, and when a lead time is too strange to be reassuring.
 */
export const REORDER_POLICY = {
  /** Below this much observable history, nothing about replenishment is assessable. */
  minimumObservableDays: 14,

  /**
   * Distinct 30-day sales days required before a reorder point is calculated.
   *
   * Units alone are not enough evidence. Three units sold on one day is a single
   * observation of demand; sizing a reorder buffer from it would plan around a
   * coincidence. Matches the Demand Engine's own floor for "assessable at all".
   */
  minimumActiveDays30d: 2,

  leadTime: {
    /** Completed purchase orders needed before a lead time earns high confidence. */
    highConfidenceMinimumSamples: 3,
    /** …and before it earns medium confidence. */
    mediumConfidenceMinimumSamples: 2,

    /**
     * A median lead time at or beyond this is unusually long.
     *
     * It stays **usable** — an order genuinely takes this long, and hiding it
     * would understate the reorder point. It only prevents the lead time from
     * being the thing that makes confidence high on its own.
     */
    unusuallyLongDays: '30.00',

    /**
     * A max-minus-min spread beyond this means the supplier is inconsistent.
     *
     * Also usable, also confidence-capping. A median that keeps moving is a
     * planning input, not a fact to be comfortable with.
     */
    unusuallyVariableSpreadDays: '14.00',
  },

  /**
   * Guard so a runaway catalog cannot exhaust memory.
   *
   * Shared with the other engines; see the caveat in each list endpoint.
   */
  maxProducts: 10_000,
} as const;

export type ReorderPolicy = typeof REORDER_POLICY;
