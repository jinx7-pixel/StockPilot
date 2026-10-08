/**
 * Stock Risk API client.
 *
 * The client is a renderer, not a second engine: it formats what the server
 * decided and never reclassifies, re-prioritises or re-computes a figure. Decimal
 * strings arrive already exact and are displayed as-is, so nothing on screen can
 * silently disagree with the verdict the server produced.
 *
 * There is no write call in this file. A risk assessment is read-only — no
 * reorder action, no purchase order, no stock change.
 */

import type { DecisionExplanation } from '../components/DecisionExplanationView';
import { request, requestList } from './request';

export const RISK_LEVELS = [
  'OUT_OF_STOCK',
  'CRITICAL',
  'LOW',
  'HEALTHY',
  'OVERSTOCK',
  'INSUFFICIENT_DATA',
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** The evidence the verdict was drawn from, so a reader can audit it. */
export interface StockRiskEvidence {
  salesWindowDays: number;
  unitsSold: string;
  observableHistoryDays: string;
  activeSalesDays: string;
  leadTimeSamples: number;
  hasLeadTimeEvidence: boolean;
}

export interface StockRisk {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;

  risk: RiskLevel;
  priority: number;
  confidence: ConfidenceLevel;
  /** Deterministic explanation written by the server — rendered, never rewritten. */
  reason: string;

  currentStock: string;
  averageDailySales: string;
  unitsSold: string;
  analysisWindowDays: number;

  /** `null` when there is no demand evidence — unavailable, never zero. */
  daysOfStock: string | null;
  /** `null` when no completed purchase order backs a lead time. */
  effectiveLeadTimeDays: string | null;
  leadTimeSampleCount: number;
  safetyStockDays: number;
  safetyStock: string | null;
  /** A stock-risk metric only. Acting on it is a later milestone. */
  reorderPoint: string | null;

  evidence: StockRiskEvidence;

  /** Decision, confidence, evidence and limitations, as decided by the server. */
  explanation: DecisionExplanation;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface StockRiskQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  risk?: RiskLevel | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: StockRiskQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  // `'all'` is the client-side "no filter" marker; it is omitted, never sent.
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.risk && query.risk !== 'all') params.set('risk', query.risk);
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * Generics are the **unwrapped** payload: `request()` reads `{ data }` off the
 * wire and returns what is inside it, so declaring the envelope here would be a
 * double unwrap and every `.data` in a page would become `undefined`.
 *
 * Note `requestList` below: the route sends `meta` as a **sibling** of `data`,
 * not inside it, so a plain `request` would discard the pagination totals.
 * `requestList` folds the pair back into `{ items, meta }` so no page has to know
 * how the wire is shaped.
 */
/** The count summary the stock-risk route sends beside `data` and `meta`. */
interface StockRiskCounts {
  riskCounts?: Partial<Record<RiskLevel, number>>;
}

export const intelligenceApi = {
  list: async (query: StockRiskQuery) => {
    const { items, meta, counts } = await requestList<StockRisk, StockRiskCounts>(
      `/api/intelligence/stock-risk${buildQueryString(query)}`,
    );
    return { items, meta, riskCounts: counts?.riskCounts };
  },

  detail: (productId: string) => request<StockRisk>(`/api/intelligence/stock-risk/${productId}`),
};
