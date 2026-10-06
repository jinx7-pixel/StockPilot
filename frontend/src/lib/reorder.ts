/**
 * Reorder Engine API client.
 *
 * A renderer, not a second engine. It formats what the server decided and never
 * recomputes a reorder point, a net-available figure or a quantity: doing that
 * in the browser would let the screen disagree with the assessment it is showing.
 *
 * There is no write call in this file. This module *recommends*; ordering is a
 * separate act, taken in a separate place, and this client has no way to do it.
 */

import { request } from './request';

export const REORDER_DECISIONS = [
  'REORDER',
  'NO_REORDER',
  'INSUFFICIENT_DATA',
  'DATA_ERROR',
] as const;

export type ReorderDecision = (typeof REORDER_DECISIONS)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ReorderEvidence {
  netAvailable: string;
  onOrderQuantity: string;
  leadTimeSamples: number;
  leadTimeSpreadDays: string | null;
  hasLeadTimeEvidence: boolean;
  leadTimeUnreliable: boolean;
  unitsSold30d: string;
  activeSalesDays30d: number;
  safetyStockDays: number;
}

export interface Reorder {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;

  currentStock: string;
  onOrderQuantity: string;
  netAvailable: string;

  safetyStock: string | null;
  reorderPoint: string | null;
  recommendedQuantity: string | null;

  /** Whether the recommendation is actionable. Never true without a quantity. */
  reorder: boolean;
  decision: ReorderDecision;

  effectiveLeadTimeDays: string | null;
  safetyStockDays: number;

  confidence: ConfidenceLevel;
  /** Deterministic explanation written by the server — rendered, never rewritten. */
  reason: string;

  evidence: ReorderEvidence;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReorderQuery {
  search?: string;
  categoryId?: string;
  /** Defaults to active only; an inactive product is not an operational candidate. */
  isActive?: 'active' | 'inactive' | 'all';
  decision?: ReorderDecision | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: ReorderQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  // The server defaults to active, so only send it when the user asks otherwise.
  if (query.isActive && query.isActive !== 'active') params.set('isActive', query.isActive);
  if (query.decision && query.decision !== 'all') params.set('decision', query.decision);
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export const reorderApi = {
  list: (query: ReorderQuery) =>
    request<{
      data: Reorder[];
      meta: ListMeta;
      decisionCounts: Partial<Record<ReorderDecision, number>>;
    }>(`/api/intelligence/reorder${buildQueryString(query)}`),

  detail: (productId: string) =>
    request<{ data: Reorder }>(`/api/intelligence/reorder/${productId}`),
};
