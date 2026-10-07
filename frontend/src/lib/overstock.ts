/**
 * Overstock Detection API client.
 *
 * A renderer, not a second engine. It formats what the server decided and never
 * recomputes days of stock or reclassifies a status: doing that in the browser
 * would let the screen disagree with the assessment behind it.
 *
 * There is no write call in this file. Flagging excess stock is a read;
 * deciding what to do about it — markdown, return, discount — belongs to
 * recommendation and action modules that do not exist yet.
 */

import type { DecisionExplanation } from '../components/DecisionExplanationView';
import { request } from './request';

export const OVERSTOCK_STATUSES = ['OVERSTOCK', 'NORMAL', 'INSUFFICIENT_DATA'] as const;

export type OverstockStatus = (typeof OVERSTOCK_STATUSES)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface OverstockEvidence {
  analysisWindowDays: number;
  unitsSold90d: string;
  activeSalesDays90d: number;
  observableHistoryDays: string;
  minimumActiveSalesDays30d: number;
  minimumUnitsSold30d: string;
  thresholdDays: number;
  /** Which gates were not met. Empty when the product could be assessed. */
  unmetEvidenceGates: string[];
  hasSufficientEvidence: boolean;
}

export interface Overstock {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;

  status: OverstockStatus;
  priority: number;

  currentStock: string;
  averageDailySales30d: string;
  unitsSold30d: string;
  activeSalesDays30d: number;

  analysisWindowDays: number;
  /** `null` when there is no demand rate to divide by — not zero, not infinite. */
  daysOfStock: string | null;
  /** The coverage figure at or above which this product is OVERSTOCK. */
  thresholdDays: number;

  confidence: ConfidenceLevel;
  /** Deterministic explanation written by the server — rendered, never rewritten. */
  reason: string;

  evidence: OverstockEvidence;

  /** Decision, confidence, evidence and limitations, as decided by the server. */
  explanation: DecisionExplanation;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OverstockQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  status?: OverstockStatus | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: OverstockQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  // `'all'` is the client-side "no filter" marker; it is omitted, never sent.
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export const overstockApi = {
  list: (query: OverstockQuery) =>
    request<{
      data: Overstock[];
      meta: ListMeta;
      statusCounts: Partial<Record<OverstockStatus, number>>;
    }>(`/api/intelligence/overstock${buildQueryString(query)}`),

  detail: (productId: string) =>
    request<{ data: Overstock }>(`/api/intelligence/overstock/${productId}`),
};