/**
 * Unified Intelligence API client.
 *
 * A renderer, not an engine. Everything here displays values the server sent:
 * no verdict is re-derived, no confidence recomputed, no priority re-ranked, and
 * **no summary is calculated**. The summary in particular is the one place a
 * browser could be tempted to "helpfully" count issues differently, and that is
 * exactly the quiet disagreement this architecture exists to prevent.
 *
 * There is no write call. Creating a purchase order, adjusting stock and any
 * other action belong to later modules.
 */

import { request } from './request';
import type { EvidenceItem } from '../components/DecisionExplanationView';

export type { EvidenceItem };

export interface UnifiedSummary {
  attentionRequired: boolean;
  highestPriority: number;
  decisionCount: number;
}

export interface UnifiedProductIntelligence {
  product: {
    id: string;
    sku: string;
    name: string;
    category: { id: string; name: string } | null;
  };
  stockRisk: Record<string, unknown> & {
    risk: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    explanation: { decision: string; confidence: string; evidence: EvidenceItem[]; limitations: string[] };
  };
  demand: Record<string, unknown> & {
    trend: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    explanation: { decision: string; confidence: string; evidence: EvidenceItem[]; limitations: string[] };
  };
  reorder: Record<string, unknown> & {
    decision: string;
    reorder: boolean;
    recommendedQuantity: string | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    explanation: { decision: string; confidence: string; evidence: EvidenceItem[]; limitations: string[] };
  };
  overstock: Record<string, unknown> & {
    status: string;
    priority: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    explanation: { decision: string; confidence: string; evidence: EvidenceItem[]; limitations: string[] };
  };
  slowDead: Record<string, unknown> & {
    status: string;
    priority: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    explanation: { decision: string; confidence: string; evidence: EvidenceItem[]; limitations: string[] };
  };
  supplier: (Record<string, unknown> & {
    supplierName: string;
    stability: string;
    priority: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    explanation: { decision: string; confidence: string; evidence: EvidenceItem[]; limitations: string[] };
  }) | null;
  summary: UnifiedSummary;
}

export interface UnifiedPagination {
  page: number;
  limit: number;
  total: number;
}

export interface UnifiedQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  page?: number;
  limit?: number;
}

function buildQueryString(query: UnifiedQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * Both generics are the **unwrapped** payload.
 *
 * The route answers `{ data: { items, pagination } }`, so `request()` returns
 * `{ items, pagination }` directly — which is why this client already read that
 * way and why the same convention applies to `detail`.
 */
export const unifiedApi = {
  list: (query: UnifiedQuery) =>
    request<{ items: UnifiedProductIntelligence[]; pagination: UnifiedPagination }>(
      `/api/intelligence/products${buildQueryString(query)}`,
    ),

  detail: (productId: string) =>
    request<UnifiedProductIntelligence>(`/api/intelligence/products/${productId}`),
};