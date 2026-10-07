/**
 * Recommendations service — orchestration only.
 *
 * Reads the Unified Intelligence snapshot and applies the pure rules. It fetches
 * no facts of its own, runs no SQL and recomputes no intelligence: every figure
 * in a recommendation came from the engine that produced it upstream.
 *
 * ## Query budget
 *
 * One call into the unified service per request, which is itself five queries
 * regardless of page size. There is no per-product query here, so there is no
 * N+1, and no repository was opened at all.
 *
 * ## Pagination is over products, not recommendations
 *
 * A product can yield zero or several recommendations, so paginating over
 * recommendations would make the total depend on the product window underneath
 * it. The list therefore pages over products — the same unit the unified
 * intelligence list pages over — and each product carries the recommendations
 * matching the filters. That keeps one page's total meaningful and keeps the
 * list and the product-detail response structurally identical.
 */

import { NotFoundError } from '../errors.js';
import {
  buildRecommendations,
  summariseRecommendations,
  type Recommendation,
} from '../intelligence/recommendations.js';
import {
  getUnifiedIntelligence,
  listUnifiedIntelligence,
} from '../services/unified.service.js';
import type { ListRecommendationsQuery } from './recommendations.schemas.js';

export interface RecommendationProductItem {
  product: { id: string; sku: string; name: string; category: { id: string; name: string } | null };
  recommendations: Recommendation[];
}

export interface RecommendationsPage {
  items: RecommendationProductItem[];
  pagination: { page: number; limit: number; total: number };
  /** Recommendations across the returned page, for a quick overview. */
  recommendationCount: number;
}

/** Keep only the recommendations matching the requested kinds. */
function filterRecommendations(
  recommendations: readonly Recommendation[],
  query: ListRecommendationsQuery,
): Recommendation[] {
  return recommendations.filter(
    (recommendation) =>
      (query.type === undefined || recommendation.type === query.type) &&
      (query.priority === undefined || recommendation.priority === query.priority) &&
      (query.confidence === undefined || recommendation.confidence === query.confidence),
  );
}

/**
 * One page of products with their recommendations.
 *
 * Products whose recommendations all fall outside the filters are omitted, so a
 * `type=REVIEW_SUPPLIER` page contains only products that have one.
 */
export async function listRecommendations(
  businessId: string,
  query: ListRecommendationsQuery,
): Promise<RecommendationsPage> {
  const page = await listUnifiedIntelligence(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    page: query.page,
    limit: query.limit,
  });

  const items: RecommendationProductItem[] = [];
  let recommendationCount = 0;

  for (const snapshot of page.items) {
    const recommendations = filterRecommendations(buildRecommendations(snapshot), query);
    if (recommendations.length === 0) continue;

    recommendationCount += recommendations.length;
    items.push({
      product: {
        id: snapshot.product.id,
        sku: snapshot.product.sku,
        name: snapshot.product.name,
        category: snapshot.product.category,
      },
      recommendations,
    });
  }

  return {
    items,
    pagination: { page: page.pagination.page, limit: page.pagination.limit, total: page.pagination.total },
    recommendationCount,
  };
}

/**
 * One product with its recommendations.
 *
 * Reuses the unified detail snapshot directly, so a recommendation can never
 * describe a product state different from the one the intelligence screens show.
 */
export async function getProductRecommendations(
  businessId: string,
  productId: string,
): Promise<{
  product: { id: string; sku: string; name: string; category: { id: string; name: string } | null };
  recommendations: Recommendation[];
  summary: { recommendationCount: number; highestPriority: 'URGENT' | 'HIGH' | 'MEDIUM' | null };
}> {
  const snapshot = await getUnifiedIntelligence(businessId, productId);
  if (!snapshot) throw new NotFoundError('Product not found.');

  const recommendations = buildRecommendations(snapshot);

  return {
    product: {
      id: snapshot.product.id,
      sku: snapshot.product.sku,
      name: snapshot.product.name,
      category: snapshot.product.category,
    },
    recommendations,
    summary: summariseRecommendations(recommendations),
  };
}