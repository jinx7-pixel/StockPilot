/**
 * Public surface of the intelligence layer.
 *
 * Import from here so callers depend on the engine's contract rather than its
 * internal file layout. Today this is the deterministic Stock Risk Engine; future
 * engines (forecasting, overstock, supplier risk) will sit alongside it without
 * changing anything that already imports from here.
 */

export {
  assessConfidence,
  assessStockRisk,
  classifyRisk,
  DataError,
  RISK_LEVELS,
  RISK_PRIORITY,
  STOCK_RISK_POLICY,
  CONFIDENCE_LEVELS,
} from './stockRisk.js';

export type {
  ConfidenceLevel,
  RiskLevel,
  StockRiskEvidence,
  StockRiskFacts,
  StockRiskResult,
} from './types.js';

// ---- Demand Intelligence ---------------------------------------------------

export {
  assessDemand,
  assessDemandConfidence,
  assessDemandConfidenceFromTotals,
  averageDailyRate,
  classifyTrend,
  classifyVariability,
  coefficientOfVariation,
  DEMAND_POLICY,
  DEMAND_TRENDS,
  DEMAND_VARIABILITY,
} from './demand.js';

export type {
  DemandDay,
  DemandEvidence,
  DemandFacts,
  DemandResult,
  DemandTrend,
  DemandVariability,
} from './types.js';

export type { DemandConfidenceTotals } from './demand.js';

// ---- Reorder Engine --------------------------------------------------------

export {
  assessReorder,
  assessReorderConfidence,
  classifyReorder,
  REORDER_DECISIONS,
  REORDER_POLICY,
} from './reorder.js';

export type {
  ReorderDecision,
  ReorderEvidence,
  ReorderFacts,
  ReorderResult,
} from './types.js';

// ---- Overstock Detection ---------------------------------------------------

export {
  assessOverstock,
  calculateDaysOfStock,
  classifyOverstock,
  OVERSTOCK_POLICY,
  OVERSTOCK_PRIORITY,
  OVERSTOCK_STATUSES,
} from './overstock.js';

export type { OverstockPriority } from './policies.js';

export type {
  OverstockEvidence,
  OverstockFacts,
  OverstockResult,
  OverstockStatus,
} from './types.js';

export {
  addDays,
  calculateReorderPoint,
  calculateSafetyStock,
} from './calculations.js';

// ---- Slow / Dead Stock Detection -------------------------------------------

export {
  assessSlowDead,
  classifySlowDead,
  SLOW_DEAD_POLICY,
  SLOW_DEAD_PRIORITY,
  SLOW_DEAD_STATUSES,
} from './slowDead.js';

export type { SlowDeadPriority } from './policies.js';

export type {
  SlowDeadEvidence,
  SlowDeadFacts,
  SlowDeadResult,
  SlowDeadStatus,
} from './types.js';

// ---- Supplier Intelligence -------------------------------------------------

export {
  assessSupplier,
  assessSupplierConfidence,
  classifySupplierStability,
  percentile90,
  supplierCoefficientOfVariation,
  SUPPLIER_POLICY,
  SUPPLIER_PRIORITY,
  SUPPLIER_STABILITIES,
} from './supplier.js';

export type { SupplierPriority } from './policies.js';

export type {
  SupplierEvidence,
  SupplierFacts,
  SupplierLeadTimeObservation,
  SupplierResult,
  SupplierStability,
} from './types.js';
