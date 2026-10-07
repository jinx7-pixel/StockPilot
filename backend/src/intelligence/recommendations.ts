/**
 * Recommendation rules.
 *
 * A **pure** interpretation layer over the Unified Intelligence snapshot. It
 * decides nothing about the business: it reads decisions the six engines already
 * made and says what a person might want to look at as a result.
 *
 * ## What this module deliberately does not do
 *
 * It computes no rate, no days of cover, no lead time, no safety stock, no
 * reorder point and no quantity. Every number in a recommendation is copied from
 * the engine that produced it, and `recommendedQuantity` in particular is the
 * Reorder Engine's own figure, unmodified. If a rule here needed to recompute
 * something, that would be a signal the rule belongs in the owning engine, not
 * here.
 *
 * It also defines **no** confidence ladder and **no** numeric score. Priority is a
 * fixed table keyed on decisions that already exist, and confidence is passed
 * straight through from whichever engine produced the decision — so a
 * recommendation can never be more confident than its evidence.
 *
 * ## Insufficient evidence produces nothing
 *
 * There is no "maybe buy some" recommendation. A product whose engines said
 * `INSUFFICIENT_DATA` yields no recommendation at all, because "we cannot tell"
 * is not an instruction. That is why every rule below is keyed on an explicit
 * actionable decision rather than on a threshold of its own.
 */

import { compareScaled, isPositive, toScaled } from './decimal.js';
import type { EvidenceItem } from './confidence.js';
import type { ConfidenceLevel } from './types.js';
import type { UnifiedProductIntelligence, UnifiedSupplier } from './unified.js';

/** The six recommendation kinds. Exactly these, and no others. */
export const RECOMMENDATION_TYPES = [
  'REPLENISH',
  'REVIEW_REPLENISHMENT',
  'REVIEW_OVERSTOCK',
  'REVIEW_SLOW_STOCK',
  'REVIEW_DEAD_STOCK',
  'REVIEW_SUPPLIER',
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

/**
 * Urgency for a human, not a number we invented.
 *
 * Three levels, because a fourth would be a score pretending to be a
 * measurement. The mapping lives in {@link recommendationPriority} and is driven
 * by decisions the engines already produced.
 */
export const RECOMMENDATION_PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM'] as const;

export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export interface Recommendation {
  /** Deterministic: derived from the product and the kind. No persistence needed. */
  id: string;
  productId: string;
  type: RecommendationType;
  priority: RecommendationPriority;
  /** Copied from the source engine. Never higher than its evidence supports. */
  confidence: ConfidenceLevel;
  title: string;
  /** Deterministic, and quotes the figures the engine reported. */
  reason: string;
  /** Present only when a source engine supplied one. Never computed here. */
  recommendedQuantity?: string;
  evidence: EvidenceItem[];
  limitations: string[];
  /** Which engine decisions produced this recommendation. */
  sourceDecisions: string[];
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * Map an existing engine decision onto an urgency.
 *
 * Keyed on decisions, not on numbers. The four engines that expose an approved
 * priority agree with this table — dead stock is 80 and maps to HIGH, overstock
 * is 70 and maps to MEDIUM, slow is 50 and VARIABLE is 60, both MEDIUM — so the
 * existing scale is being reused, not replaced. A test pins that agreement.
 */
export function recommendationPriority(input: {
  stockRisk: string;
  reorderDecision: string;
}): RecommendationPriority {
  // A real replenishment need is more urgent when stock has actually run out.
  if (input.stockRisk === 'OUT_OF_STOCK') return 'URGENT';
  if (input.stockRisk === 'CRITICAL') return 'HIGH';
  // Covers the plain "REORDER -> HIGH" rule and every non-replenishment
  // decision that maps below.
  return 'HIGH';
}

/** Fixed urgencies for the non-replenishment kinds. */
const FIXED_PRIORITY: Record<
  'REVIEW_OVERSTOCK' | 'REVIEW_SLOW_STOCK' | 'REVIEW_DEAD_STOCK' | 'REVIEW_SUPPLIER',
  RecommendationPriority
> = {
  REVIEW_OVERSTOCK: 'MEDIUM',
  REVIEW_SLOW_STOCK: 'MEDIUM',
  // Dead stock outranks slow stock and overstock: nothing is moving at all.
  REVIEW_DEAD_STOCK: 'HIGH',
  REVIEW_SUPPLIER: 'MEDIUM',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function identifier(productId: string, type: RecommendationType): string {
  return `${productId}:${type}`;
}

function quantityIsUsable(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  try {
    return isPositive(value) && compareScaled(toScaled(value), 0n) > 0;
  } catch {
    return false;
  }
}

/** The source engine's evidence and limitations, copied verbatim. */
function explanationOf(
  block: { explanation?: { evidence?: EvidenceItem[]; limitations?: string[] } } | null,
): { evidence: EvidenceItem[]; limitations: string[] } {
  return {
    evidence: block?.explanation?.evidence ?? [],
    limitations: block?.explanation?.limitations ?? [],
  };
}

function describeSupplier(stability: string): string {
  return stability.replace(/_/g, ' ').toLowerCase();
}

/** Supplier Intelligence's only performance concern classification. */
function supplierHasConcern(supplier: UnifiedSupplier | null): boolean {
  // STABLE is fine and INSUFFICIENT_DATA is not evidence of anything, so only a
  // measured VARIABLE becomes a recommendation.
  return supplier !== null && supplier.stability === 'VARIABLE';
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * Turn one unified snapshot into the recommendations it supports.
 *
 * Returns an empty array for a healthy product. Order is deterministic:
 * replenishment first (it is the most time-sensitive), then the review kinds
 * in a fixed sequence, so two identical snapshots always produce an identical
 * list.
 */
export function buildRecommendations(
  snapshot: UnifiedProductIntelligence,
): Recommendation[] {
  const productId = snapshot.product.id;
  const recommendations: Recommendation[] = [];

  const { reorder, overstock, slowDead, stockRisk, supplier } = snapshot;

  const wantsReorder = reorder.decision === 'REORDER';
  const isOverstocked = overstock.status === 'OVERSTOCK';

  // --- Replenishment, and the conflict that must not become a purchase -------
  if (wantsReorder) {
    const replenishmentPriority = recommendationPriority({
      stockRisk: stockRisk.risk,
      reorderDecision: reorder.decision,
    });

    if (isOverstocked) {
      // Two engines disagree. Rather than picking a winner with a formula
      // nobody approved, this asks a person to look — see the module note on the
      // conflict rule.
      const { evidence, limitations } = explanationOf(reorder);
      recommendations.push({
        id: identifier(productId, 'REVIEW_REPLENISHMENT'),
        productId,
        type: 'REVIEW_REPLENISHMENT',
        priority: replenishmentPriority,
        confidence: reorder.confidence,
        title: 'Review this product before ordering',
        reason:
          'The Reorder Engine reports that available stock is below the reorder point and ' +
          'suggests ordering, while Overstock Detection reports the same product as carrying ' +
          `more stock than its demand justifies (${overstock.daysOfStock ?? 'unavailable'} days of ` +
          'cover against a 60-day threshold). These two readings disagree, so no order is ' +
          'proposed. Check whether the demand that drives the reorder point is still accurate ' +
          'before placing anything.',
        evidence,
        limitations,
        sourceDecisions: ['REORDER', 'OVERSTOCK'],
      });
    } else if (quantityIsUsable(reorder.recommendedQuantity)) {
      // The only kind that carries a quantity, and it is the Reorder Engine's.
      const { evidence, limitations } = explanationOf(reorder);
      recommendations.push({
        id: identifier(productId, 'REPLENISH'),
        productId,
        type: 'REPLENISH',
        priority: replenishmentPriority,
        confidence: reorder.confidence,
        title: 'Consider replenishing this product',
        reason:
          `Available stock of ${reorder.netAvailable} is below the reorder point of ` +
          `${reorder.reorderPoint}, which covers ${reorder.effectiveLeadTimeDays} days of supplier ` +
          `lead time plus ${reorder.safetyStockDays} days of safety stock. The Reorder Engine ` +
          `suggests ordering ${reorder.recommendedQuantity} units to bring available stock back ` +
          'up to that point.',
        recommendedQuantity: reorder.recommendedQuantity,
        evidence,
        limitations,
        sourceDecisions: ['REORDER'],
      });
    }
  }

  // --- Overstock ------------------------------------------------------------
  if (isOverstocked) {
    const { evidence, limitations } = explanationOf(overstock);
    recommendations.push({
      id: identifier(productId, 'REVIEW_OVERSTOCK'),
      productId,
      type: 'REVIEW_OVERSTOCK',
      priority: FIXED_PRIORITY.REVIEW_OVERSTOCK,
      confidence: overstock.confidence,
      title: 'Review excess stock',
      reason:
        `Current stock of ${overstock.currentStock} represents about ` +
        `${overstock.daysOfStock} days of cover at the recent average of ` +
        `${overstock.averageDailySales30d} units per day, at or above the ${overstock.thresholdDays}-day ` +
        'overstock threshold. What to do about it is a commercial decision, so nothing is ' +
        'proposed here.',
      evidence,
      limitations,
      sourceDecisions: ['OVERSTOCK'],
    });
  }

  // --- Slow and dead stock --------------------------------------------------
  if (slowDead.status === 'SLOW') {
    const { evidence, limitations } = explanationOf(slowDead);
    recommendations.push({
      id: identifier(productId, 'REVIEW_SLOW_STOCK'),
      productId,
      type: 'REVIEW_SLOW_STOCK',
      priority: FIXED_PRIORITY.REVIEW_SLOW_STOCK,
      confidence: slowDead.confidence,
      title: 'Review slow-moving stock',
      reason:
        `Demand is infrequent: ${slowDead.activeSalesDays90d} sale day(s) out of ` +
        `${slowDead.analysisWindowDays}, with ${slowDead.unitsSold90d} units sold in total and ` +
        `${slowDead.currentStock} units still held. Whether to change the range is a commercial ` +
        'decision, so no action is proposed.',
      evidence,
      limitations,
      sourceDecisions: ['SLOW'],
    });
  }

  if (slowDead.status === 'DEAD') {
    const { evidence, limitations } = explanationOf(slowDead);
    recommendations.push({
      id: identifier(productId, 'REVIEW_DEAD_STOCK'),
      productId,
      type: 'REVIEW_DEAD_STOCK',
      priority: FIXED_PRIORITY.REVIEW_DEAD_STOCK,
      confidence: slowDead.confidence,
      title: 'Review dead stock',
      reason:
        `No units sold in the last ${slowDead.analysisWindowDays} days while ` +
        `${slowDead.currentStock} units are still held. How to handle that is a commercial ` +
        'decision, so no action is proposed.',
      evidence,
      limitations,
      sourceDecisions: ['DEAD'],
    });
  }

  // --- Supplier -------------------------------------------------------------
  if (supplierHasConcern(supplier)) {
    const { evidence, limitations } = explanationOf(supplier);
    recommendations.push({
      id: identifier(productId, 'REVIEW_SUPPLIER'),
      productId,
      type: 'REVIEW_SUPPLIER',
      priority: FIXED_PRIORITY.REVIEW_SUPPLIER,
      confidence: supplier!.confidence,
      title: 'Review supplier delivery consistency',
      reason:
        `Across ${supplier!.completedPOCount} completed purchase orders this supplier's delivery ` +
        `times vary by ${supplier!.leadTimeCV} of the average — ${describeSupplier(supplier!.stability)} ` +
        `by the ${supplier!.evidence.stableMaxCoefficientOfVariation} limit the Supplier Engine uses. ` +
        'Delivery time alone does not establish fault, so nothing is concluded here.',
      evidence,
      limitations,
      sourceDecisions: ['SUPPLIER_VARIABLE'],
    });
  }

  return recommendations;
}

/**
 * A simple, deterministic roll-up for the product detail response.
 *
 * Two fields, both derived from the recommendations themselves. No health score:
 * a single number across several independent findings would hide which one is
 * the problem, which is the only reason anyone opened the screen.
 */
export function summariseRecommendations(recommendations: readonly Recommendation[]): {
  recommendationCount: number;
  highestPriority: RecommendationPriority | null;
} {
  if (recommendations.length === 0) {
    return { recommendationCount: 0, highestPriority: null };
  }

  return {
    recommendationCount: recommendations.length,
    highestPriority: recommendations.some((r) => r.priority === 'URGENT')
      ? 'URGENT'
      : recommendations.some((r) => r.priority === 'HIGH')
        ? 'HIGH'
        : 'MEDIUM',
  };
}