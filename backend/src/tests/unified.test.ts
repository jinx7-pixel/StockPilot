/**
 * Unified Intelligence — unit tests.
 *
 * The orchestrator decides nothing, so the tests here are mostly about one
 * thing: proving it did decide nothing. They feed engine results in and assert
 * the summary is derived correctly, then the API tests compare the whole
 * unified response against the six direct endpoints field by field.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assembleUnifiedProduct,
  summarise,
  type UnifiedDemand,
  type UnifiedOverstock,
  type UnifiedProductIntelligence,
  type UnifiedReorder,
  type UnifiedSlowDead,
  type UnifiedStockRisk,
  type UnifiedSupplier,
} from '../intelligence/index.js';

/** The identity the snapshot states once, at the top. */
const PRODUCT = { id: 'p1', sku: 'SKU-1', name: 'Widget', category: null };

/** A healthy product: every engine has nothing to report. */
function healthy(): {
  stockRisk: UnifiedStockRisk;
  demand: UnifiedDemand;
  reorder: UnifiedReorder;
  overstock: UnifiedOverstock;
  slowDead: UnifiedSlowDead;
  supplier: UnifiedSupplier | null;
} {
  return {
    stockRisk: {
      productId: 'p1', risk: 'HEALTHY', priority: 0, confidence: 'HIGH',
      currentStock: '100.00', averageDailySales: '10.0000', unitsSold: '300.00',
      analysisWindowDays: 30, daysOfStock: '10.00', effectiveLeadTimeDays: '5.00',
      leadTimeSampleCount: 3, safetyStockDays: 2, safetyStock: '20.00',
      reorderPoint: '70.00', reason: 'ok',
      evidence: {} as UnifiedStockRisk['evidence'],
      explanation: { decision: 'HEALTHY', confidence: 'HIGH', evidence: [], limitations: [] },
    },
    demand: {
      productId: 'p1', confidence: 'HIGH',
      sku: 'SKU-1', name: 'Widget', category: null, isActive: true,
      unitsSold7d: '70.00', unitsSold30d: '300.00', unitsSold90d: '900.00',
      averageDailySales7d: '10.0000', averageDailySales30d: '10.0000', averageDailySales90d: '10.0000',
      activeSalesDays7d: 7, activeSalesDays30d: 30, activeSalesDays90d: 90,
      trend: 'STABLE', trendChangePercent: '0.00', variability: 'LOW_VARIABILITY',
      coefficientOfVariation: '0.13', reason: 'steady',
      evidence: {} as UnifiedDemand['evidence'],
      explanation: { decision: 'STABLE', confidence: 'HIGH', evidence: [], limitations: [] },
    },
    reorder: {
      productId: 'p1', currentStock: '100.00', onOrderQuantity: '0.00',
      sku: 'SKU-1', name: 'Widget', category: null, isActive: true,
 netAvailable: '100.00',
      safetyStock: '20.00', reorderPoint: '70.00', recommendedQuantity: '0.00',
      reorder: false, decision: 'NO_REORDER', effectiveLeadTimeDays: '5.00',
      safetyStockDays: 2, confidence: 'HIGH', reason: 'no need',
      evidence: {} as UnifiedReorder['evidence'],
      explanation: { decision: 'NO_REORDER', confidence: 'HIGH', evidence: [], limitations: [] },
    },
    overstock: {
      productId: 'p1', status: 'NORMAL', priority: 0, currentStock: '100.00',
      sku: 'SKU-1', name: 'Widget', category: null, isActive: true,
      averageDailySales30d: '10.0000', unitsSold30d: '300.00', activeSalesDays30d: 30,
      analysisWindowDays: 30, daysOfStock: '10.00', thresholdDays: 60,
      confidence: 'HIGH', reason: 'fine',
      evidence: {} as UnifiedOverstock['evidence'],
      explanation: { decision: 'NORMAL', confidence: 'HIGH', evidence: [], limitations: [] },
    },
    slowDead: {
      productId: 'p1', status: 'NORMAL', priority: 0, currentStock: '100.00',
      sku: 'SKU-1', name: 'Widget', category: null, isActive: true,
      unitsSold90d: '900.00', activeSalesDays90d: 90, averageDailySales90d: '10.0000',
      analysisWindowDays: 90, confidence: 'HIGH', reason: 'moving',
      evidence: {} as UnifiedSlowDead['evidence'],
      explanation: { decision: 'NORMAL', confidence: 'HIGH', evidence: [], limitations: [] },
    },
    supplier: {
      supplierId: 's1', supplierName: 'ABC', isActive: true,
      completedPOCount: 8, openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0,
      totalUnitsOrdered: '800.00', totalUnitsReceived: '800.00',
      medianLeadTimeDays: '5.00', p90LeadTimeDays: '6.00', leadTimeSampleCount: 8,
      leadTimeCV: '0.10', stability: 'STABLE', priority: 0, confidence: 'HIGH',
      reason: 'consistent', evidence: {} as UnifiedSupplier['evidence'],
      explanation: { decision: 'STABLE', confidence: 'HIGH', evidence: [], limitations: [] },
    },
  };
}

describe('Unified Intelligence — summary', () => {
  it('a healthy product needs no attention', () => {
    const summary = summarise(healthy());

    assert.deepEqual(summary, { attentionRequired: false, highestPriority: 0, decisionCount: 0 });
  });

  it('counts each actionable decision once', () => {
    const base = healthy();
    const summary = summarise({
      ...base,
      stockRisk: { ...base.stockRisk, risk: 'CRITICAL', priority: 80 },
      overstock: { ...base.overstock, status: 'OVERSTOCK', priority: 70 },
      slowDead: { ...base.slowDead, status: 'DEAD', priority: 80 },
    });

    assert.equal(summary.decisionCount, 3);
    assert.equal(summary.attentionRequired, true);
    assert.equal(summary.highestPriority, 80);
  });

  it('takes the highest priority already produced by an engine', () => {
    const base = healthy();
    const summary = summarise({
      ...base,
      stockRisk: { ...base.stockRisk, risk: 'LOW', priority: 60 },
      overstock: { ...base.overstock, status: 'OVERSTOCK', priority: 70 },
    });

    assert.equal(summary.highestPriority, 70, 'not the sum, and not a new scale');
  });

  it('does not treat INSUFFICIENT_DATA as actionable', () => {
    const base = healthy();
    const summary = summarise({
      ...base,
      overstock: { ...base.overstock, status: 'INSUFFICIENT_DATA', priority: 20 },
      slowDead: { ...base.slowDead, status: 'INSUFFICIENT_DATA', priority: 20 },
      reorder: { ...base.reorder, decision: 'INSUFFICIENT_DATA', confidence: 'INSUFFICIENT' },
      demand: { ...base.demand, trend: 'INSUFFICIENT_DATA', confidence: 'INSUFFICIENT' },
      supplier: {
        ...base.supplier!, stability: 'INSUFFICIENT_DATA', priority: 20, confidence: 'INSUFFICIENT',
      },
    });

    assert.equal(summary.decisionCount, 0, 'cannot judge is not in trouble');
    assert.equal(summary.attentionRequired, false);
    assert.equal(summary.highestPriority, 20, 'the priority is still reported honestly');
  });

  it('counts REORDER and DATA_ERROR as actionable', () => {
    const base = healthy();
    assert.equal(
      summarise({ ...base, reorder: { ...base.reorder, decision: 'REORDER', reorder: true } }).decisionCount,
      1,
    );
    assert.equal(
      summarise({ ...base, reorder: { ...base.reorder, decision: 'DATA_ERROR' } }).decisionCount,
      1,
    );
  });

  it('counts a rising or falling demand trend as actionable', () => {
    const base = healthy();
    for (const trend of ['INCREASING', 'DECREASING'] as const) {
      assert.equal(summarise({ ...base, demand: { ...base.demand, trend } }).decisionCount, 1, trend);
    }
    assert.equal(summarise({ ...base, demand: { ...base.demand, trend: 'STABLE' } }).decisionCount, 0);
  });

  it('handles a product with no supplier without failing', () => {
    const summary = summarise({ ...healthy(), supplier: null });

    assert.equal(summary.decisionCount, 0);
    assert.equal(summary.attentionRequired, false);
  });

  it('exposes no overall score of any kind', () => {
    const summary = summarise(healthy());

    assert.deepEqual(Object.keys(summary).sort(), [
      'attentionRequired',
      'decisionCount',
      'highestPriority',
    ]);
    assert.equal(typeof summary.attentionRequired, 'boolean');
    assert.equal(typeof summary.decisionCount, 'number');
    assert.equal(typeof summary.highestPriority, 'number');
    // No 0-100 score: the priority is copied from an engine's own scale and is
    // never rescaled or summed into a single grade.
    assert.ok(summary.highestPriority <= 100, 'an existing engine priority, not a new scale');
  });
});

describe('Unified Intelligence — assembly', () => {
  it('passes every engine result through untouched', () => {
    const base = healthy();
    const assembled: UnifiedProductIntelligence = assembleUnifiedProduct({ product: PRODUCT, ...base });

    assert.equal(assembled.stockRisk, base.stockRisk, 'same object, not a copy');
    assert.equal(assembled.demand, base.demand);
    assert.equal(assembled.reorder, base.reorder);
    assert.equal(assembled.overstock, base.overstock);
    assert.equal(assembled.slowDead, base.slowDead);
    assert.equal(assembled.supplier, base.supplier);
  });

  it('preserves the 11.7 explanation on every module', () => {
    const assembled = assembleUnifiedProduct({ product: PRODUCT, ...healthy() });

    for (const block of [
      assembled.stockRisk,
      assembled.demand,
      assembled.reorder,
      assembled.overstock,
      assembled.slowDead,
    ] as Array<{ explanation: { decision: string; confidence: string; evidence: unknown[]; limitations: string[] } }>) {
      assert.ok(block.explanation, 'the envelope must survive');
      assert.equal(typeof block.explanation.decision, 'string');
      assert.equal(typeof block.explanation.confidence, 'string');
      assert.ok(Array.isArray(block.explanation.evidence));
      assert.ok(Array.isArray(block.explanation.limitations));
    }
    assert.ok(assembled.supplier?.explanation);
  });

  it('reports the product identity once, at the top', () => {
    const assembled = assembleUnifiedProduct({ product: PRODUCT, ...healthy() });

    assert.deepEqual(assembled.product, {
      id: 'p1', sku: 'SKU-1', name: 'Widget', category: null,
    });
  });

  it('is deterministic', () => {
    assert.deepEqual(
      assembleUnifiedProduct({ product: PRODUCT, ...healthy() }),
      assembleUnifiedProduct({ product: PRODUCT, ...healthy() }),
    );
  });

  it('reports supplier: null when a product has never been ordered', () => {
    const assembled = assembleUnifiedProduct({ product: PRODUCT, ...healthy(), supplier: null });

    assert.equal(assembled.supplier, null);
    // Every other module still answers.
    assert.ok(assembled.stockRisk);
    assert.ok(assembled.demand);
    assert.ok(assembled.reorder);
    assert.ok(assembled.overstock);
    assert.ok(assembled.slowDead);
    assert.ok(assembled.summary);
  });
});