/**
 * Stock Risk Engine — types.
 *
 * The engine is a pure function from structured facts to a result. It never
 * touches a database, a request or a response, which is what lets it be tested
 * exhaustively without a database and lets a future forecasting layer supply
 * alternative demand inputs without rewriting any logic here.
 */

/** Deterministic operational risk states. */
export const RISK_LEVELS = [
  'OUT_OF_STOCK',
  'CRITICAL',
  'LOW',
  'HEALTHY',
  'OVERSTOCK',
  'INSUFFICIENT_DATA',
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Confidence in the *evidence*, not the risk.
 *
 * A product may legitimately be `CRITICAL` with `LOW` confidence: the available
 * evidence points to serious risk, but the evidence base is thin. The two
 * axes are reported separately and never collapsed into one score.
 */
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Raised when the input facts are self-contradictory, e.g. negative stock. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

/**
 * Everything the engine needs to assess one product.
 *
 * Numeric fields are decimal strings so no value passes through a float. The
 * fact-gathering layer rounds them in SQL before they get here.
 */
export interface StockRiskFacts {
  productId: string;
  isActive: boolean;

  /** From the inventory ledger, via the shared balance expression. */
  currentStock: string;

  /** Units sold inside the analysis window. */
  unitsSold: string;
  /** `unitsSold / analysisWindowDays`. */
  averageDailySales: string;
  /**
   * Days of *observable* history — since the product's first ledger entry, not
   * since the product record was created.
   */
  observableHistoryDays: string;
  /** Distinct days inside the window that had at least one sale. */
  activeSalesDays: string;

  /**
   * Lead time in days for each qualifying completed purchase order that
   * contained this product. Draft, ordered-but-incomplete, cancelled, and
   * timestamp-incomplete orders are excluded upstream.
   */
  leadTimeSamples: readonly string[];
}

export interface StockRiskEvidence {
  /** Calendar days the demand window covers. */
  salesWindowDays: number;
  unitsSold: string;
  /** Observable history, in days. */
  observableHistoryDays: string;
  /** Distinct days with a sale inside the window. */
  activeSalesDays: string;
  /** How many completed purchase orders backed the lead-time figure. */
  leadTimeSamples: number;
  hasLeadTimeEvidence: boolean;
}

export interface StockRiskResult {
  productId: string;
  risk: RiskLevel;
  /** Deterministic ordering weight for a future action centre. */
  priority: number;

  currentStock: string;
  averageDailySales: string;
  unitsSold: string;
  analysisWindowDays: number;

  /** `currentStock / averageDailySales`, or `null` without demand evidence. */
  daysOfStock: string | null;

  /** Median supplier lead time, or `null` when there is no evidence. */
  effectiveLeadTimeDays: string | null;
  leadTimeSampleCount: number;

  safetyStockDays: number;
  /** `averageDailySales × safetyStockDays`, or `null` without demand evidence. */
  safetyStock: string | null;

  /**
   * `averageDailySales × (effectiveLeadTimeDays + safetyStockDays)`, or `null`
   * when either input is unknown.
   *
   * A stock-risk metric only. This engine never creates a purchase order or an
   * inventory movement.
   */
  reorderPoint: string | null;

  confidence: ConfidenceLevel;
  /** Deterministic, human-readable explanation. Never generated. */
  reason: string;
  evidence: StockRiskEvidence;
}
