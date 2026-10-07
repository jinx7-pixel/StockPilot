/**
 * Demand Intelligence API client.
 *
 * The client is a renderer, not a second engine: it formats what the server
 * decided and never reclassifies a trend, recomputes a coefficient of variation
 * or derives a confidence level. Decimal strings arrive already exact and are
 * displayed as-is.
 *
 * There is no write call in this file. A demand assessment describes history; it
 * cannot change a sale, and it never places an order.
 */

import type { DecisionExplanation } from '../components/DecisionExplanationView';
import { request } from './request';

export const DEMAND_TRENDS = [
  'INCREASING',
  'STABLE',
  'DECREASING',
  'INSUFFICIENT_DATA',
] as const;

export type DemandTrend = (typeof DEMAND_TRENDS)[number];

export const DEMAND_VARIABILITY = [
  'LOW_VARIABILITY',
  'MEDIUM_VARIABILITY',
  'HIGH_VARIABILITY',
  'INSUFFICIENT_DATA',
] as const;

export type DemandVariability = (typeof DEMAND_VARIABILITY)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface DemandEvidence {
  salesWindowDays: number;
  activeSalesDays: string;
  totalUnitsSold: string;
  demandObservationDays: number;
  consistencyRatio: string;
  hasSufficientEvidence: boolean;
}

export interface Demand {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;

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
  /** `null` when no meaningful comparison exists — not zero, not Infinity. */
  trendChangePercent: string | null;
  variability: DemandVariability;
  coefficientOfVariation: string | null;

  confidence: ConfidenceLevel;
  /** Deterministic explanation written by the server — rendered, never rewritten. */
  reason: string;

  evidence: DemandEvidence;

  /** Decision, confidence, evidence and limitations, as decided by the server. */
  explanation: DecisionExplanation;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DemandQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  trend?: DemandTrend | 'all';
  variability?: DemandVariability | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: DemandQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  // `'all'` is the client-side "no filter" marker; it is omitted, never sent.
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.trend && query.trend !== 'all') params.set('trend', query.trend);
  if (query.variability && query.variability !== 'all') {
    params.set('variability', query.variability);
  }
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export const demandApi = {
  list: (query: DemandQuery) =>
    request<{
      data: Demand[];
      meta: ListMeta;
      trendCounts: Partial<Record<DemandTrend, number>>;
    }>(`/api/intelligence/demand${buildQueryString(query)}`),

  detail: (productId: string) => request<{ data: Demand }>(`/api/intelligence/demand/${productId}`),
};
