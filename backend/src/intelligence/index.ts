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
