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

// The normalised explanation envelope every engine attaches to its result.
// Imported here rather than re-declared so the six result types cannot drift
// apart, and so `confidence.ts` owns the contract it defines.
import type { DecisionExplanation } from './confidence.js';

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

  /** Normalised decision, confidence, evidence and limitations. Additive. */
  explanation: DecisionExplanation;
}

// ---------------------------------------------------------------------------
// Demand Intelligence
// ---------------------------------------------------------------------------

/** Direction of historical demand, relative to the 30-day baseline. */
export const DEMAND_TRENDS = [
  'INCREASING',
  'STABLE',
  'DECREASING',
  'INSUFFICIENT_DATA',
] as const;

export type DemandTrend = (typeof DEMAND_TRENDS)[number];

/** How uneven the daily demand series is. */
export const DEMAND_VARIABILITY = [
  'LOW_VARIABILITY',
  'MEDIUM_VARIABILITY',
  'HIGH_VARIABILITY',
  'INSUFFICIENT_DATA',
] as const;

export type DemandVariability = (typeof DEMAND_VARIABILITY)[number];

/** One calendar day on which at least one unit was sold. */
export interface DemandDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Exact decimal string; units may carry two decimal places. */
  units: string;
}

/**
 * Everything the demand engine needs about one product.
 *
 * Days with no sales are **omitted** rather than sent as zeros: the engine needs
 * the window *length* to compute a correct mean and variance, and that comes
 * from the policy, not from the number of rows. See `assessDemand` for why the
 * omission is mathematically exact.
 */
export interface DemandFacts {
  productId: string;

  /**
   * The last calendar day in the analysis window, `YYYY-MM-DD` (UTC).
   *
   * Supplied as a fact rather than read from a clock, which is what keeps the
   * engine pure and its tests deterministic.
   */
  windowEndDate: string;

  /** Days with at least one unit sold, ascending by date. */
  days: readonly DemandDay[];

  /** Days since the product's first ledger movement — its observable history. */
  observableHistoryDays: string;
}

export interface DemandEvidence {
  /** Length of the widest window the assessment draws on. */
  salesWindowDays: number;
  /** Distinct days with a sale inside the 30-day baseline window. */
  activeSalesDays: string;
  /** Units sold across the whole 90-day window. */
  totalUnitsSold: string;
  /**
   * Days actually supplied as demand observations. Always less than
   * `salesWindowDays` unless the product sold every single day.
   */
  demandObservationDays: number;
  /** `activeDays90 / salesWindowDays`; how densely the window was covered. */
  consistencyRatio: string;
  /** True when there is enough evidence to classify trend and variability. */
  hasSufficientEvidence: boolean;
}

export interface DemandResult {
  productId: string;

  unitsSold7d: string;
  unitsSold30d: string;
  unitsSold90d: string;

  averageDailySales7d: string;
  averageDailySales30d: string;
  averageDailySales90d: string;

  activeSalesDays7d: number;
  activeSalesDays30d: number;
  activeSalesDays90d: number;

  trend: DemandTrend;
  /** Signed change of the 7-day rate against the 30-day rate, or `null`. */
  trendChangePercent: string | null;

  variability: DemandVariability;
  /** Standard deviation ÷ mean of the daily series, or `null`. */
  coefficientOfVariation: string | null;

  confidence: ConfidenceLevel;
  /** Deterministic, human-readable explanation. Never generated. */
  reason: string;
  evidence: DemandEvidence;

  /** Normalised decision, confidence, evidence and limitations. Additive. */
  explanation: DecisionExplanation;
}

// ---------------------------------------------------------------------------
// Reorder Engine
// ---------------------------------------------------------------------------

/**
 * The operational decision. Deliberately four states and no more: anything that
 * cannot be decided is `INSUFFICIENT_DATA` rather than a guess, and a corrupt
 * ledger is `DATA_ERROR` rather than a reorder.
 */
export const REORDER_DECISIONS = [
  'REORDER',
  'NO_REORDER',
  'INSUFFICIENT_DATA',
  'DATA_ERROR',
] as const;

export type ReorderDecision = (typeof REORDER_DECISIONS)[number];

/**
 * Everything the reorder engine needs about one product.
 *
 * Figures from the ledger and from completed purchase orders arrive as exact
 * decimal strings. The demand rate is supplied rather than recomputed here: the
 * Demand Intelligence Engine already owns that calculation, and redoing it would
 * be exactly the duplication this architecture avoids.
 */
export interface ReorderFacts {
  productId: string;
  isActive: boolean;

  /** Sum of the inventory ledger, exactly as the Stock Risk Engine reads it. */
  currentStock: string;

  /**
   * Ordered but not yet received, across purchase orders in `ordered` or
   * `partially_received` state. Draft, received and cancelled orders contribute
   * nothing: a draft is not a commitment and a received order is already in the
   * ledger.
   */
  onOrderQuantity: string;

  /** Units sold inside the 30-day baseline window. */
  unitsSold30d: string;

  /**
   * Distinct days with a sale inside the 30-day baseline window.
   *
   * Distinct from `unitsSold30d`: three units sold on a single day is one
   * observation of demand, not three, and planning a reorder on it would be
   * building a buffer around a coincidence.
   */
  activeSalesDays30d: number;

  /** Demand rate over the 30-day baseline, from the Demand Intelligence Engine. */
  averageDailySales30d: string;

  /** Days since the product's first ledger movement. */
  observableHistoryDays: string;

  /**
   * Lead times in days, from **fully received** purchase orders carrying both
   * timestamps. Empty when there is no such evidence.
   */
  leadTimeSamples: readonly string[];
}

export interface ReorderEvidence {
  /** Current stock plus everything already on order. */
  netAvailable: string;
  /** Units already on order, reported separately so the arithmetic is visible. */
  onOrderQuantity: string;
  /** Completed purchase orders behind the median lead time. */
  leadTimeSamples: number;
  /** Max minus min lead time, or `null` with fewer than two samples. */
  leadTimeSpreadDays: string | null;
  /** Whether the median lead time is usable at all. */
  hasLeadTimeEvidence: boolean;
  /** Whether the median is long enough, or spread wide enough, to cap confidence. */
  leadTimeUnreliable: boolean;
  /** Units sold in the 30-day baseline window. */
  unitsSold30d: string;
  /** Distinct days with a sale in the 30-day baseline window. */
  activeSalesDays30d: number;
  /** Days of lead-time cover plus the safety buffer. */
  safetyStockDays: number;
}

export interface ReorderResult {
  productId: string;

  currentStock: string;
  onOrderQuantity: string;
  netAvailable: string;

  /** `null` when there is no demand evidence to size a buffer from. */
  safetyStock: string | null;
  /** `null` when demand or lead-time evidence is missing. */
  reorderPoint: string | null;
  /**
   * `max(0, reorderPoint - netAvailable)`, or `null` when the reorder point
   * cannot be computed.
   */
  recommendedQuantity: string | null;

  /** Whether the recommendation is actionable. Never `true` without a quantity. */
  reorder: boolean;
  decision: ReorderDecision;

  /** Median of the completed-order lead times, or `null`. */
  effectiveLeadTimeDays: string | null;
  safetyStockDays: number;

  confidence: ConfidenceLevel;
  /** Deterministic, human-readable explanation. Never generated. */
  reason: string;
  evidence: ReorderEvidence;

  /** Normalised decision, confidence, evidence and limitations. Additive. */
  explanation: DecisionExplanation;
}

// ---------------------------------------------------------------------------
// Overstock Detection
// ---------------------------------------------------------------------------

/**
 * Exactly three states, and no others.
 *
 * `NORMAL` deliberately does not mean "fine" — it means "below the overstock
 * threshold with enough evidence to say so". A product that cannot be judged
 * says so rather than defaulting to normal.
 */
export const OVERSTOCK_STATUSES = ['OVERSTOCK', 'NORMAL', 'INSUFFICIENT_DATA'] as const;

export type OverstockStatus = (typeof OVERSTOCK_STATUSES)[number];

/**
 * Everything the overstock engine needs about one product.
 *
 * The demand rate arrives from the Demand Intelligence Engine rather than being
 * recomputed, and current stock arrives from the ledger. Neither figure is
 * derived inside the engine.
 */
export interface OverstockFacts {
  productId: string;
  isActive: boolean;

  /** Sum of the inventory ledger — the same balance every other engine reads. */
  currentStock: string;

  /** Units sold inside the 30-day baseline window. */
  unitsSold30d: string;
  /** Distinct days with a sale inside the 30-day baseline window. */
  activeSalesDays30d: number;
  /** Demand rate over the 30-day baseline, from the Demand Intelligence Engine. */
  averageDailySales30d: string;

  /** Wider-window context. Reported, never used to classify. */
  unitsSold90d: string;
  activeSalesDays90d: number;
  averageDailySales90d: string;

  /** Days since the product's first ledger movement. */
  observableHistoryDays: string;
}

export interface OverstockEvidence {
  analysisWindowDays: number;
  /** Units sold across the wider window, for context on the 30-day figure. */
  unitsSold90d: string;
  activeSalesDays90d: number;
  observableHistoryDays: string;

  /** The minimum each gate requires, so a reader can check the verdict by hand. */
  minimumActiveSalesDays30d: number;
  minimumUnitsSold30d: string;
  thresholdDays: number;

  /** Which gates were not met. Empty when the product could be assessed. */
  unmetEvidenceGates: string[];
  hasSufficientEvidence: boolean;
}

export interface OverstockResult {
  productId: string;

  status: OverstockStatus;
  /** Operational priority for this status; separate from the Stock Risk table. */
  priority: number;

  currentStock: string;
  averageDailySales30d: string;
  unitsSold30d: string;
  activeSalesDays30d: number;

  /** Calendar length of the window the classification is based on. */
  analysisWindowDays: number;

  /**
   * Days of cover at the 30-day rate, or `null` when the rate is not positive.
   * Never `NaN` and never infinite: a null is the honest answer when there is
   * no rate to divide by.
   */
  daysOfStock: string | null;

  /** The coverage figure at or above which this product is OVERSTOCK. */
  thresholdDays: number;

  confidence: ConfidenceLevel;
  /** Deterministic, human-readable explanation. Never generated. */
  reason: string;
  evidence: OverstockEvidence;

  /** Normalised decision, confidence, evidence and limitations. Additive. */
  explanation: DecisionExplanation;
}

// ---------------------------------------------------------------------------
// Slow / Dead Stock Detection
// ---------------------------------------------------------------------------

/**
 * Exactly four states, and no more.
 *
 * `NORMAL` means "this product is not a slow- or dead-stock problem", which is
 * deliberately inclusive: a product with no inventory at all is normal here,
 * because the module exists to find problematic inventory *currently held*.
 */
export const SLOW_DEAD_STATUSES = ['DEAD', 'SLOW', 'NORMAL', 'INSUFFICIENT_DATA'] as const;

export type SlowDeadStatus = (typeof SLOW_DEAD_STATUSES)[number];

/**
 * Everything the slow/dead engine needs about one product.
 *
 * The 90-day demand figures come from the Demand Intelligence Engine's query and
 * rate, and stock comes from the ledger. Neither is derived inside the engine.
 */
export interface SlowDeadFacts {
  productId: string;
  isActive: boolean;

  /** Sum of the inventory ledger — the same balance every other engine reads. */
  currentStock: string;

  /** Units sold across the whole analysis window. */
  unitsSold90d: string;
  /** Distinct days with a sale across the analysis window. */
  activeSalesDays90d: number;
  /** Demand rate across the analysis window, from the Demand Intelligence Engine. */
  averageDailySales90d: string;

  /** Days since the product's first ledger movement. */
  observableHistoryDays: string;
}

export interface SlowDeadEvidence {
  /** Length of the demand window the classification is based on. */
  analysisWindowDays: number;
  /** Observable history required before any verdict is given. */
  minimumObservableDays: number;
  /** Active sales days at or below which the product is SLOW. */
  slowMaxActiveSalesDays: number;

  /** Whether the product has held stock, which every actionable status requires. */
  holdsInventory: boolean;
  /** True when the product has had long enough to have sold at all. */
  hasSufficientHistory: boolean;
  /**
   * The ordered rule that decided the status, for example
   * `no sales in the analysis window`. Makes the verdict auditable.
   */
  classificationBasis: string;
}

export interface SlowDeadResult {
  productId: string;

  status: SlowDeadStatus;
  /** Operational priority for this status; separate from every other scale. */
  priority: number;

  currentStock: string;
  unitsSold90d: string;
  activeSalesDays90d: number;
  averageDailySales90d: string;

  /** Calendar length of the demand window the classification is based on. */
  analysisWindowDays: number;

  confidence: ConfidenceLevel;
  /** Deterministic, human-readable explanation. Never generated. */
  reason: string;
  evidence: SlowDeadEvidence;

  /** Normalised decision, confidence, evidence and limitations. Additive. */
  explanation: DecisionExplanation;
}

// ---------------------------------------------------------------------------
// Supplier Intelligence
// ---------------------------------------------------------------------------

/**
 * How consistent a supplier's actual delivery times have been.
 *
 * `INSUFFICIENT_DATA` is not a third verdict on the supplier — it is an absence
 * of enough observations to have one.
 */
export const SUPPLIER_STABILITIES = ['STABLE', 'VARIABLE', 'INSUFFICIENT_DATA'] as const;

export type SupplierStability = (typeof SUPPLIER_STABILITIES)[number];

/** One completed purchase order's measured delivery time. */
export interface SupplierLeadTimeObservation {
  purchaseOrderId: string;
  /** UTC ISO-8601 instant the order was placed. */
  orderedAt: string;
  /** UTC ISO-8601 instant the order was received. */
  receivedAt: string;
  /** Measured elapsed days, exact decimal string. */
  leadTimeDays: string;
}

/**
 * Everything the supplier engine needs.
 *
 * Lead-time observations arrive already filtered to received orders carrying
 * both timestamps; the engine never sees a draft, an in-flight order, a
 * cancellation or a timestamp gap, and so cannot accidentally treat one as
 * delivery evidence.
 */
export interface SupplierFacts {
  supplierId: string;
  supplierName: string;
  isActive: boolean;

  /** Purchase orders in `received` state. */
  completedPOCount: number;
  /** Purchase orders in `ordered` or `partially_received` state. */
  openPOCount: number;
  /** Purchase orders in `cancelled` state. */
  cancelledPOCount: number;

  /** Purchase orders in `draft` state: never counted as any of the above. */
  draftPOCount: number;

  totalUnitsOrdered: string;
  totalUnitsReceived: string;

  /** Measured elapsed days for each completed order, ascending. */
  leadTimeDays: readonly string[];
}

export interface SupplierEvidence {
  /** Observations behind every figure above. */
  completedPOCount: number;
  leadTimeSampleCount: number;

  /** Minimum observations required before variability is reported. */
  minimumSamplesForVariability: number;
  /** Coefficient of variation at or below which lead time is STABLE. */
  stableMaxCoefficientOfVariation: string;

  /** Shortest and longest observed delivery, in days. */
  minLeadTimeDays: string | null;
  maxLeadTimeDays: string | null;

  /**
   * Stated explicitly so the absence is never mistaken for a clean record.
   * The schema records no promised delivery date, so on-time delivery cannot be
   * computed and is not estimated.
   */
  hasPromisedDeliveryDate: false;
}

export interface SupplierResult {
  supplierId: string;
  supplierName: string;
  isActive: boolean;

  completedPOCount: number;
  openPOCount: number;
  cancelledPOCount: number;
  draftPOCount: number;

  totalUnitsOrdered: string;
  totalUnitsReceived: string;

  /** `null` with no completed order to measure. */
  medianLeadTimeDays: string | null;
  /** `null` with no completed order to measure. */
  p90LeadTimeDays: string | null;
  leadTimeSampleCount: number;
  /** Standard deviation over mean, or `null` when variability is not reported. */
  leadTimeCV: string | null;

  stability: SupplierStability;
  /** Operational priority for this stability; separate from every other scale. */
  priority: number;

  /** Confidence in the supplier-performance evidence. Never the demand ladder. */
  confidence: ConfidenceLevel;
  /** Deterministic, human-readable explanation. Never generated. */
  reason: string;
  evidence: SupplierEvidence;

  /** Normalised decision, confidence, evidence and limitations. Additive. */
  explanation: DecisionExplanation;
}
