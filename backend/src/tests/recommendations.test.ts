/**
 * Recommendation rules — pure-function tests.
 *
 * No database and no HTTP: a snapshot goes in, a deterministic list of
 * recommendations comes out. Every case here is about one thing — that the
 * rules **do not invent intelligence**, that they never act, and that they
 * refuse to recommend anything when the evidence is thin.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRecommendations,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_TYPES,
  recommendationPriority,
  summariseRecommendations,
  type Recommendation,
} from '../intelligence/recommendations.js';
import type {
  ConfidenceLevel,
  UnifiedProductIntelligence,
} from '../intelligence/index.js';

const EXPLANATION = {
  decision: 'X',
  confidence: 'HIGH' as ConfidenceLevel,
  evidence: [
    { source: 'inventory' as const, metric: 'Current stock', value: '10.00', interpretation: 'stock' },
  ],
  limitations: ['A limitation that should survive.'],
};

/**
 * A snapshot with every engine in a named state, so a test can state only the
 * one thing it is about.
 */
function snapshot(overrides: Record<string, unknown> = {}): UnifiedProductIntelligence {
  const base = {
    product: { id: 'p1', sku: 'SKU-1', name: 'Widget', category: null },
    stockRisk: {
      risk: 'LOW', priority: 60, confidence: 'HIGH', currentStock: '10.00',
      averageDailySales: '1.0000', unitsSold: '30.00', analysisWindowDays: 30,
      daysOfStock: '10.00', effectiveLeadTimeDays: '5.00', leadTimeSampleCount: 3,
      safetyStockDays: 2, safetyStock: '2.00', reorderPoint: '7.00', reason: 'r',
      evidence: EXPLANATION, explanation: { ...EXPLANATION, decision: 'LOW' },
    },
    demand: {
      trend: 'STABLE', confidence: 'HIGH', unitsSold30d: '30.00', unitsSold90d: '90.00',
      activeSalesDays90d: 30, averageDailySales30d: '1.0000', explanation: { ...EXPLANATION, decision: 'STABLE' },
    },
    reorder: {
      currentStock: '10.00', onOrderQuantity: '0.00', netAvailable: '10.00',
      safetyStock: '2.00', reorderPoint: '7.00', recommendedQuantity: '0.00',
      reorder: false, decision: 'NO_REORDER', effectiveLeadTimeDays: '5.00',
      safetyStockDays: 2, confidence: 'HIGH',
      evidence: EXPLANATION, explanation: { ...EXPLANATION, decision: 'NO_REORDER' },
    },
    overstock: {
      status: 'NORMAL', priority: 0, currentStock: '10.00', averageDailySales30d: '1.0000',
      unitsSold30d: '30.00', activeSalesDays30d: 30, analysisWindowDays: 30,
      daysOfStock: '10.00', thresholdDays: 60, confidence: 'HIGH',
      evidence: EXPLANATION, explanation: { ...EXPLANATION, decision: 'NORMAL' },
    },
    slowDead: {
      status: 'NORMAL', priority: 0, currentStock: '10.00', unitsSold90d: '90.00',
      activeSalesDays90d: 30, averageDailySales90d: '1.0000', analysisWindowDays: 90,
      confidence: 'HIGH', evidence: EXPLANATION,
      explanation: { ...EXPLANATION, decision: 'NORMAL' },
    },
    supplier: {
      supplierId: 's1', supplierName: 'ABC', isActive: true, completedPOCount: 8,
      openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0,
      totalUnitsOrdered: '800.00', totalUnitsReceived: '800.00',
      medianLeadTimeDays: '5.00', p90LeadTimeDays: '6.00', leadTimeSampleCount: 8,
      leadTimeCV: '0.10', stability: 'STABLE', priority: 0, confidence: 'HIGH',
      reason: 'r',
      evidence: { stableMaxCoefficientOfVariation: '0.25' },
      explanation: { ...EXPLANATION, decision: 'STABLE' },
    },
    summary: { attentionRequired: false, highestPriority: 0, decisionCount: 0 },
  };

  return { ...base, ...overrides } as unknown as UnifiedProductIntelligence;
}

/** A REORDER state with a usable quantity. */
const REORDERING = {
  reorder: true,
  decision: 'REORDER',
  confidence: 'HIGH' as ConfidenceLevel,
  recommendedQuantity: '12.00',
  netAvailable: '3.00',
  reorderPoint: '15.00',
  evidence: EXPLANATION,
  explanation: { ...EXPLANATION, decision: 'REORDER' },
};

const byType = (list: readonly Recommendation[], type: string) =>
  list.find((r) => r.type === type);

// ---------------------------------------------------------------------------

describe('Recommendations — REPLENISH', () => {
  it('1. REORDER becomes REPLENISH, reusing the engine quantity verbatim', () => {
    const list = buildRecommendations(snapshot({ reorder: REORDERING }));
    const replenish = byType(list, 'REPLENISH');

    assert.ok(replenish, 'a replenishment recommendation is produced');
    assert.equal(replenish.recommendedQuantity, '12.00',
      'the Reorder Engine quantity is reused, not recomputed');
    assert.equal(replenish.productId, 'p1');
    assert.equal(replenish.confidence, 'HIGH');
    assert.deepEqual(replenish.sourceDecisions, ['REORDER']);
    assert.match(replenish.reason, /12\.00/);
  });

  it('gives no quantity when the engine did not produce one', () => {
    const list = buildRecommendations(
      snapshot({ reorder: { ...REORDERING, recommendedQuantity: null } }),
    );
    const replenish = byType(list, 'REPLENISH');

    assert.equal(replenish, undefined,
      'no usable quantity means no purchase recommendation at all');
  });

  it('rejects a zero or negative quantity', () => {
    for (const quantity of ['0.00', '-3.00']) {
      const list = buildRecommendations(
        snapshot({ reorder: { ...REORDERING, recommendedQuantity: quantity } }),
      );
      assert.equal(byType(list, 'REPLENISH'), undefined, `${quantity} is not actionable`);
    }
  });
});

describe('Recommendations — the replenishment conflict', () => {
  it('2. REORDER + OVERSTOCK becomes REVIEW_REPLENISHMENT, never REPLENISH', () => {
    const list = buildRecommendations(
      snapshot({
        reorder: REORDERING,
        overstock: { status: 'OVERSTOCK', priority: 70, daysOfStock: '120.00', thresholdDays: 60,
          currentStock: '400.00', averageDailySales30d: '3.3333', confidence: 'HIGH',
          evidence: EXPLANATION, explanation: { ...EXPLANATION, decision: 'OVERSTOCK' } },
      }),
    );

    assert.equal(byType(list, 'REPLENISH'), undefined,
      'must never confidently recommend buying more');
    const review = byType(list, 'REVIEW_REPLENISHMENT');
    assert.ok(review, 'the conflict becomes a review');
    assert.equal(review.recommendedQuantity, undefined,
      'a review carries no quantity to order');
    assert.deepEqual(review.sourceDecisions, ['REORDER', 'OVERSTOCK']);
    assert.match(review.reason, /disagree/);
    assert.match(review.reason, /no order is proposed/i);
  });

  it('still surfaces the overstock finding alongside the conflict', () => {
    const list = buildRecommendations(
      snapshot({
        reorder: REORDERING,
        overstock: { status: 'OVERSTOCK', priority: 70, daysOfStock: '120.00', thresholdDays: 60,
          currentStock: '400.00', averageDailySales30d: '3.3333', confidence: 'HIGH',
          evidence: EXPLANATION, explanation: { ...EXPLANATION, decision: 'OVERSTOCK' } },
      }),
    );

    assert.ok(byType(list, 'REVIEW_OVERSTOCK'),
      'overstock is reported in its own right, per its own rule');
  });
});

describe('Recommendations — the review kinds', () => {
  it('3. OVERSTOCK becomes REVIEW_OVERSTOCK', () => {
    const list = buildRecommendations(
      snapshot({ overstock: { status: 'OVERSTOCK', priority: 70, daysOfStock: '90.00',
        thresholdDays: 60, currentStock: '300.00', averageDailySales30d: '3.3333',
        confidence: 'MEDIUM', evidence: EXPLANATION,
        explanation: { ...EXPLANATION, decision: 'OVERSTOCK', confidence: 'MEDIUM' } } }),
    );

    const review = byType(list, 'REVIEW_OVERSTOCK');
    assert.ok(review);
    assert.equal(review.priority, 'MEDIUM');
    assert.equal(review.confidence, 'MEDIUM', 'confidence comes from the overstock engine');
    assert.deepEqual(review.sourceDecisions, ['OVERSTOCK']);
  });

  it('4. SLOW becomes REVIEW_SLOW_STOCK', () => {
    const list = buildRecommendations(
      snapshot({ slowDead: { status: 'SLOW', priority: 50, currentStock: '80.00',
        unitsSold90d: '12.00', activeSalesDays90d: 8, averageDailySales90d: '0.1333',
        analysisWindowDays: 90, confidence: 'LOW', evidence: EXPLANATION,
        explanation: { ...EXPLANATION, decision: 'SLOW', confidence: 'LOW' } } }),
    );

    const review = byType(list, 'REVIEW_SLOW_STOCK');
    assert.ok(review);
    assert.equal(review.priority, 'MEDIUM');
    assert.equal(review.confidence, 'LOW');
    assert.match(review.reason, /commercial decision/);
  });

  it('5. DEAD becomes REVIEW_DEAD_STOCK, at higher priority than slow', () => {
    const list = buildRecommendations(
      snapshot({ slowDead: { status: 'DEAD', priority: 80, currentStock: '120.00',
        unitsSold90d: '0.00', activeSalesDays90d: 0, averageDailySales90d: '0.0000',
        analysisWindowDays: 90, confidence: 'HIGH', evidence: EXPLANATION,
        explanation: { ...EXPLANATION, decision: 'DEAD' } } }),
    );

    const review = byType(list, 'REVIEW_DEAD_STOCK');
    assert.ok(review);
    assert.equal(review.priority, 'HIGH');
    assert.deepEqual(review.sourceDecisions, ['DEAD']);
  });

  it('6. a supplier concern becomes REVIEW_SUPPLIER', () => {
    const list = buildRecommendations(
      snapshot({ supplier: { supplierId: 's1', supplierName: 'ABC', isActive: true,
        completedPOCount: 6, openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0,
        totalUnitsOrdered: '600.00', totalUnitsReceived: '600.00',
        medianLeadTimeDays: '13.50', p90LeadTimeDays: '25.00', leadTimeSampleCount: 6,
        leadTimeCV: '0.58', stability: 'VARIABLE', priority: 60, confidence: 'HIGH',
        reason: 'r', evidence: { stableMaxCoefficientOfVariation: '0.25' },
        explanation: { ...EXPLANATION, decision: 'VARIABLE' } } }),
    );

    const review = byType(list, 'REVIEW_SUPPLIER');
    assert.ok(review);
    assert.equal(review.priority, 'MEDIUM');
    assert.deepEqual(review.sourceDecisions, ['SUPPLIER_VARIABLE']);
    assert.match(review.reason, /does not establish fault/);
  });

  it('does not review a stable supplier', () => {
    const list = buildRecommendations(snapshot());
    assert.equal(byType(list, 'REVIEW_SUPPLIER'), undefined);
  });
});

describe('Recommendations — insufficient evidence', () => {
  it('7. a product whose engines could not judge gets no recommendation', () => {
    const list = buildRecommendations(
      snapshot({
        stockRisk: { risk: 'INSUFFICIENT_DATA', priority: 20, confidence: 'INSUFFICIENT' },
        reorder: { decision: 'INSUFFICIENT_DATA', reorder: false, recommendedQuantity: null,
          confidence: 'INSUFFICIENT' },
        overstock: { status: 'INSUFFICIENT_DATA', priority: 20, confidence: 'INSUFFICIENT' },
        slowDead: { status: 'INSUFFICIENT_DATA', priority: 20, confidence: 'INSUFFICIENT' },
        supplier: { stability: 'INSUFFICIENT_DATA', priority: 20, confidence: 'INSUFFICIENT',
          completedPOCount: 0, medianLeadTimeDays: null, leadTimeCV: null },
      }),
    );

    assert.deepEqual(list, [], 'low stock plus no history is not an instruction to buy');
  });

  it('13. a healthy product gets no recommendations', () => {
    assert.deepEqual(buildRecommendations(snapshot()), []);
  });

  it('an unmeasurable supplier does not become a supplier review', () => {
    const list = buildRecommendations(
      snapshot({ supplier: { stability: 'INSUFFICIENT_DATA', priority: 20,
        confidence: 'INSUFFICIENT', completedPOCount: 1, leadTimeCV: null,
        medianLeadTimeDays: null, evidence: {}, explanation: EXPLANATION } }),
    );
    assert.equal(byType(list, 'REVIEW_SUPPLIER'), undefined);
  });
});

describe('Recommendations — multiple, evidence and determinism', () => {
  it('8. produces multiple non-conflicting recommendations for one product', () => {
    const list = buildRecommendations(
      snapshot({
        reorder: REORDERING,
        supplier: { stability: 'VARIABLE', priority: 60, confidence: 'HIGH',
          completedPOCount: 6, leadTimeCV: '0.58', medianLeadTimeDays: '13.50',
          evidence: { stableMaxCoefficientOfVariation: '0.25' },
          explanation: { ...EXPLANATION, decision: 'VARIABLE' } },
      }),
    );

    assert.equal(list.length, 2);
    assert.ok(byType(list, 'REPLENISH'));
    assert.ok(byType(list, 'REVIEW_SUPPLIER'));
  });

  it('11. carries the source engine evidence and limitations through unchanged', () => {
    const list = buildRecommendations(snapshot({ reorder: REORDERING }));

    for (const recommendation of list) {
      assert.deepEqual(recommendation.evidence, EXPLANATION.evidence);
      assert.deepEqual(recommendation.limitations, EXPLANATION.limitations);
      assert.ok(recommendation.evidence.length > 0, 'every recommendation is explainable');
    }
  });

  it('10. confidence always comes from the engine that produced the decision', () => {
    const low = buildRecommendations(
      snapshot({ reorder: { ...REORDERING, confidence: 'LOW',
        explanation: { ...EXPLANATION, decision: 'REORDER', confidence: 'LOW' } } }),
    );
    assert.equal(byType(low, 'REPLENISH')?.confidence, 'LOW');

    const insufficient = buildRecommendations(
      snapshot({ reorder: { ...REORDERING, confidence: 'INSUFFICIENT',
        explanation: { ...EXPLANATION, decision: 'REORDER', confidence: 'INSUFFICIENT' } } }),
    );
    assert.equal(byType(insufficient, 'REPLENISH')?.confidence, 'INSUFFICIENT',
      'weak evidence must not be dressed up');
  });

  it('is deterministic, including the identifier', () => {
    const a = buildRecommendations(snapshot({ reorder: REORDERING }));
    const b = buildRecommendations(snapshot({ reorder: REORDERING }));

    assert.deepEqual(a, b);
    assert.equal(a[0]?.id, 'p1:REPLENISH', 'ids are derived, never generated');
  });

  it('12. priority is deterministic and reuses the engine scales', () => {
    assert.equal(recommendationPriority({ stockRisk: 'OUT_OF_STOCK', reorderDecision: 'REORDER' }), 'URGENT');
    assert.equal(recommendationPriority({ stockRisk: 'CRITICAL', reorderDecision: 'REORDER' }), 'HIGH');
    assert.equal(recommendationPriority({ stockRisk: 'LOW', reorderDecision: 'REORDER' }), 'HIGH');
    assert.equal(recommendationPriority({ stockRisk: 'HEALTHY', reorderDecision: 'REORDER' }), 'HIGH');

    // The fixed urgencies agree with the engine priorities that already exist:
    // dead stock is 80 (HIGH), overstock 70, slow 50, supplier VARIABLE 60 (MEDIUM).
    const dead = buildRecommendations(
      snapshot({ slowDead: { status: 'DEAD', priority: 80, confidence: 'HIGH',
        currentStock: '1.00', unitsSold90d: '0.00', activeSalesDays90d: 0,
        averageDailySales90d: '0.0000', analysisWindowDays: 90, evidence: EXPLANATION,
        explanation: { ...EXPLANATION, decision: 'DEAD' } } }),
    );
    assert.equal(byType(dead, 'REVIEW_DEAD_STOCK')?.priority, 'HIGH');
  });

  it('uses exactly the six agreed kinds and three urgencies', () => {
    assert.deepEqual([...RECOMMENDATION_TYPES], [
      'REPLENISH', 'REVIEW_REPLENISHMENT', 'REVIEW_OVERSTOCK',
      'REVIEW_SLOW_STOCK', 'REVIEW_DEAD_STOCK', 'REVIEW_SUPPLIER',
    ]);
    assert.deepEqual([...RECOMMENDATION_PRIORITIES], ['URGENT', 'HIGH', 'MEDIUM']);
  });
});

describe('Recommendations — summary', () => {
  it('reports the count and the highest urgency', () => {
    const list = buildRecommendations(
      snapshot({
        reorder: REORDERING,
        stockRisk: { risk: 'OUT_OF_STOCK', priority: 100, confidence: 'HIGH',
          evidence: EXPLANATION, explanation: { ...EXPLANATION, decision: 'OUT_OF_STOCK' } },
        supplier: { stability: 'VARIABLE', priority: 60, confidence: 'HIGH',
          completedPOCount: 6, leadTimeCV: '0.58', medianLeadTimeDays: '13.50',
          evidence: { stableMaxCoefficientOfVariation: '0.25' },
          explanation: { ...EXPLANATION, decision: 'VARIABLE' } },
      }),
    );

    const summary = summariseRecommendations(list);
    assert.equal(summary.recommendationCount, 2);
    assert.equal(summary.highestPriority, 'URGENT');
  });

  it('reports nothing for a product with no recommendations', () => {
    assert.deepEqual(summariseRecommendations([]), {
      recommendationCount: 0,
      highestPriority: null,
    });
  });

  it('never produces a health score', () => {
    const summary = summariseRecommendations(buildRecommendations(snapshot()));
    assert.deepEqual(Object.keys(summary).sort(), ['highestPriority', 'recommendationCount']);
  });
});