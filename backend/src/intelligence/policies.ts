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
