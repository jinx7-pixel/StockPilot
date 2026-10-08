/**
 * Recommendations API client.
 *
 * A renderer. Nothing here decides a type, a priority, a confidence or a
 * quantity — those arrive from the server, and a browser that second-guessed
 * them would be showing something the backend never said.
 *
 * There is deliberately **no write call** in this file. Approving, ordering,
 * adjusting stock and dismissing all belong to Step 11.10, and this module has
 * no way to express any of them.
 */

import { request } from './request';
import type { EvidenceItem } from '../components/DecisionExplanationView';

export type { EvidenceItem };

export const RECOMMENDATION_TYPES = [
  'REPLENISH',
  'REVIEW_REPLENISHMENT',
  'REVIEW_OVERSTOCK',
  'REVIEW_SLOW_STOCK',
  'REVIEW_DEAD_STOCK',
  'REVIEW_SUPPLIER',
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM'] as const;

export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface Recommendation {
  id: string;
  productId: string;
  type: RecommendationType;
  priority: RecommendationPriority;
  confidence: ConfidenceLevel;
  title: string;
  reason: string;
  /** Present only when the Reorder Engine supplied a quantity. */
  recommendedQuantity?: string;
  evidence: EvidenceItem[];
  limitations: string[];
  sourceDecisions: string[];
}

export interface RecommendationProductItem {
  product: {
    id: string;
    sku: string;
    name: string;
    category: { id: string; name: string } | null;
  };
  recommendations: Recommendation[];
}

export interface RecommendationSummary {
  recommendationCount: number;
  highestPriority: RecommendationPriority | null;
}

export interface RecommendationsPage {
  items: RecommendationProductItem[];
  pagination: { page: number; limit: number; total: number };
  recommendationCount: number;
}

export interface RecommendationsQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  type?: RecommendationType | 'all';
  priority?: RecommendationPriority | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: RecommendationsQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  // `'all'` is the client-side "no filter" marker; it is omitted, never sent.
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.type && query.type !== 'all') params.set('type', query.type);
  if (query.priority && query.priority !== 'all') params.set('priority', query.priority);
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * Both generics are the **unwrapped** payload: the routes answer
 * `{ data: … }` and `request()` hands back what is inside it.
 */
export const recommendationsApi = {
  list: (query: RecommendationsQuery) =>
    request<RecommendationsPage>(`/api/recommendations${buildQueryString(query)}`),

  forProduct: (productId: string) =>
    request<{
      product: RecommendationProductItem['product'];
      recommendations: Recommendation[];
      summary: RecommendationSummary;
    }>(`/api/recommendations/products/${productId}`),
};