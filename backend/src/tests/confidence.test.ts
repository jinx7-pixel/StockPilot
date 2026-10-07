/**
 * Confidence & Evidence layer — unit tests.
 *
 * Pure functions, so no database and no clock. These cover the shared rules
 * (evidence assembly, conservative confidence combination, limitation
 * hygiene) and then each engine's explanation, including the rule that a
 * limitation is only ever emitted when something is genuinely weak.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildEvidence,
  buildLimitations,
  combineConfidence,
  EVIDENCE_SOURCES,
  evidence,
  type EvidenceItem,
} from '../intelligence/confidence.js';
import {
  assessDemand,
  assessOverstock,
  assessReorder,
  assessSlowDead,
  assessStockRisk,
  assessSupplier,
  DEMAND_POLICY,
  SUPPLIER_POLICY,
} from '../intelligence/index.js';

const WINDOW = '2026-10-05';

/** The Step 11.6 ladder, written out independently of the implementation. */
function expectedSupplierLadder(completed: number) {
  if (completed === 0) return 'INSUFFICIENT';
  if (completed <= 2) return 'LOW';
  if (completed <= 5) return 'MEDIUM';
  return 'HIGH';
}

function days(n: number, start = 0) {
  return Array.from({ length: n }, (_, i) => start + i);
}
function dayObjects(ages: number[], units: string[]) {
  return ages.map((age, i) => {
    const [y = 2026, m = 10, d = 5] = WINDOW.split('-').map(Number);
    return {
      date: new Date(Date.UTC(y, m - 1, d) - age * 86400000).toISOString().slice(0, 10),
      units: units[i % units.length] ?? '10.00',
    };
  });
}

// ---------------------------------------------------------------------------
// A. Evidence generation
// ---------------------------------------------------------------------------

describe('Confidence & Evidence — assembly', () => {
  it('orders evidence by source, in the documented order', () => {
    const result = buildEvidence([
      evidence('data_quality', 'd', 'x', 'i'),
      evidence('supplier', 's', 'x', 'i'),
      evidence('inventory', 'n', 'x', 'i'),
      evidence('demand', 'm', 'x', 'i'),
    ]);

    assert.deepEqual(result.map((e) => e.source), ['demand', 'inventory', 'supplier', 'data_quality']);
    assert.deepEqual([...EVIDENCE_SOURCES], ['demand', 'inventory', 'supplier', 'data_quality']);
  });

  it('drops metrics the engine could not measure', () => {
    const result = buildEvidence([
      evidence('demand', 'present', '5', 'i'),
      evidence('supplier', 'absent', null, 'i'),
      evidence('inventory', 'also absent', undefined, 'i'),
    ]);

    assert.deepEqual(result.map((e) => e.metric), ['present']);
  });

  it('keeps a zero, which is a measurement and not a missing value', () => {
    const result = buildEvidence([evidence('demand', 'units sold', '0', 'i')]);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.value, '0');
  });

  it('attaches a unit only when one is supplied', () => {
    const withUnit = evidence('demand', 'm', 5, 'i', 'units');
    const without = evidence('demand', 'm', 5, 'i');

    assert.equal(withUnit.unit, 'units');
    assert.equal('unit' in without, false);
  });

  it('de-duplicates limitations and drops blank ones, keeping order', () => {
    const result = buildLimitations([
      '  missing supplier history  ',
      '',
      'sparse sales activity',
      'missing supplier history',
      '   ',
    ]);

    assert.deepEqual(result, ['missing supplier history', 'sparse sales activity']);
  });
});

// ---------------------------------------------------------------------------
// B. Confidence
// ---------------------------------------------------------------------------

describe('Confidence & Evidence — conservative combination', () => {
  it('takes the weakest contributor rather than averaging', () => {
    assert.equal(combineConfidence('HIGH', 'LOW'), 'LOW');
    assert.equal(combineConfidence('LOW', 'HIGH'), 'LOW', 'order must not matter');
    assert.equal(combineConfidence('HIGH', 'MEDIUM', 'LOW'), 'LOW');
    assert.equal(combineConfidence('HIGH', 'HIGH', 'HIGH'), 'HIGH');
  });

  it('never lets a strong source rescue a weak one', () => {
    assert.equal(combineConfidence('HIGH', 'INSUFFICIENT'), 'INSUFFICIENT');
    assert.equal(combineConfidence('MEDIUM', 'INSUFFICIENT'), 'INSUFFICIENT');
  });

  it('treats no contributors as no confidence', () => {
    assert.equal(combineConfidence(), 'INSUFFICIENT');
  });

  it('keeps LOW above INSUFFICIENT, so a weak reading is not lost', () => {
    assert.equal(combineConfidence('LOW', 'INSUFFICIENT'), 'INSUFFICIENT');
    assert.equal(combineConfidence('LOW', 'LOW'), 'LOW');
  });
});

// ---------------------------------------------------------------------------
// Per-engine envelopes
// ---------------------------------------------------------------------------

describe('Confidence & Evidence — per engine', () => {
  const sourcesOf = (items: EvidenceItem[]) => [...new Set(items.map((i) => i.source))];

  it('Stock Risk: demand, inventory and supplier evidence, mirroring confidence', () => {
    const result = assessStockRisk({
      productId: 'p1', currentStock: '20.00', unitsSold: '300.00', averageDailySales: '10.0000',
      observableHistoryDays: '120', activeSalesDays: '20', leadTimeSamples: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00'],
      isActive: true,
    });

    assert.equal(result.explanation.decision, result.risk);
    assert.equal(result.explanation.confidence, result.confidence);
    assert.deepEqual(sourcesOf(result.explanation.evidence).sort(), ['data_quality', 'demand', 'inventory', 'supplier']);

    const cv = result.explanation.evidence.find((e) => e.metric === 'Current stock');
    assert.equal(cv?.source, 'inventory');
    assert.equal(cv?.value, '20.00');
    assert.equal(cv?.unit, 'units');
    assert.ok((cv?.interpretation ?? '').length > 0);
    assert.deepEqual(result.explanation.limitations, [], 'plenty of evidence, so no limitations');
  });

  it('Stock Risk: names the missing lead time rather than hiding it', () => {
    const result = assessStockRisk({
      productId: 'p1', currentStock: '20.00', unitsSold: '300.00', averageDailySales: '10.0000',
      observableHistoryDays: '120', activeSalesDays: '20', leadTimeSamples: [], isActive: true,
    });

    assert.ok(result.explanation.limitations.some((l) => l.includes('No completed purchase order')));
    assert.equal(result.explanation.evidence.some((e) => e.metric === 'Median lead time'), false,
      'a lead time that was never measured must not appear as evidence');
  });

  it('Demand: reports trend and variability as evidence', () => {
    const result = assessDemand({
      productId: 'p2', windowEndDate: WINDOW, days: dayObjects(days(45), ['10.00']),
      observableHistoryDays: '120',
    });

    assert.equal(result.explanation.decision, result.trend);
    assert.equal(result.explanation.confidence, result.confidence);
    assert.ok(sourcesOf(result.explanation.evidence).includes('demand'));
    assert.ok(sourcesOf(result.explanation.evidence).includes('data_quality'));
  });

  it('Demand: explains sparse sales without inventing a trend', () => {
    const result = assessDemand({
      productId: 'p2', windowEndDate: WINDOW, days: dayObjects([1], ['4.00']),
      observableHistoryDays: '120',
    });

    assert.equal(result.trend, 'INSUFFICIENT_DATA');
    assert.ok(result.explanation.limitations.some((l) => l.includes('sparse') || l.includes('Not enough')),
      'a sparse series must be called out');
  });

  it('Reorder: surfaces both the supplier-side and decision confidence', () => {
    const result = assessReorder(
      {
        productId: 'p3', isActive: true, currentStock: '20.00', onOrderQuantity: '0.00',
        unitsSold30d: '300.00', activeSalesDays30d: 20, averageDailySales30d: '10.0000',
        observableHistoryDays: '120', leadTimeSamples: ['5.00'],
      },
      { demandConfidence: 'LOW' },
    );

    const supplierSide = result.explanation.evidence.find((e) => e.metric === 'Supplier-side confidence');
    assert.equal(supplierSide?.value, 'LOW', 'one completed order cannot support more than LOW');
    assert.equal(result.explanation.decision, 'REORDER');
    assert.ok(result.explanation.limitations.some((l) => l.includes('completed order')));
  });

  it('Reorder: a strong demand reading does not hide thin supplier evidence', () => {
    const result = assessReorder(
      {
        productId: 'p3', isActive: true, currentStock: '20.00', onOrderQuantity: '0.00',
        unitsSold30d: '30000.00', activeSalesDays30d: 30, averageDailySales30d: '1000.0000',
        observableHistoryDays: '200', leadTimeSamples: ['5.00'],
      },
      { demandConfidence: 'LOW' },
    );

    assert.equal(result.explanation.confidence, 'LOW');
    assert.ok(result.explanation.evidence.some((e) => e.metric === 'Average daily sales (30-day)'));
  });

  it('reorder supplier-side confidence follows the locked supplier ladder', () => {
    // 0 INSUFFICIENT, 1-2 LOW, 3-5 MEDIUM, 6+ HIGH — the Supplier Engine's own
    // ladder. This previously capped every 3+ order count at MEDIUM.
    const expectedFor = (completed: number) => {
      const ladder = SUPPLIER_POLICY.confidence;
      if (completed < ladder.insufficientBelowCompletedOrders) return 'INSUFFICIENT';
      if (completed < ladder.lowBelowCompletedOrders) return 'LOW';
      if (completed < ladder.mediumBelowCompletedOrders) return 'MEDIUM';
      return 'HIGH';
    };

    for (const completed of [0, 1, 2, 3, 4, 5, 6, 7, 12]) {
      const result = assessReorder(
        {
          productId: 'p3', isActive: true, currentStock: '20.00', onOrderQuantity: '0.00',
          unitsSold30d: '300.00', activeSalesDays30d: 20, averageDailySales30d: '10.0000',
          observableHistoryDays: '120',
          leadTimeSamples: days(completed).map(() => '5.00'),
        },
        { demandConfidence: 'HIGH' },
      );

      const supplierSide = result.explanation.evidence.find(
        (e) => e.metric === 'Supplier-side confidence',
      );
      assert.equal(
        supplierSide?.value,
        expectedFor(completed),
        `${completed} completed order(s) should map to ${expectedFor(completed)}`,
      );
    }
  });

  it('reorder supplier-side confidence agrees with the Supplier Engine ladder', () => {
    // Same input, both ladders: the envelope's supplier-side reading must equal
    // what the Supplier Engine itself would say for that completed-order count.
    for (const completed of [0, 1, 2, 3, 5, 6, 9]) {
      assert.equal(
        expectedSupplierLadder(completed),
        assessSupplier({
          supplierId: 'p6', supplierName: 'X', isActive: true, completedPOCount: completed,
          openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0,
          totalUnitsOrdered: '1.00', totalUnitsReceived: '1.00',
          leadTimeDays: days(completed).map(() => '5.00'),
        }).confidence,
        `${completed} completed order(s)`,
      );
    }
  });

  it('Overstock: names each unmet evidence gate', () => {
    const result = assessOverstock(
      {
        productId: 'p4', isActive: true, currentStock: '5000.00', unitsSold30d: '4.00',
        activeSalesDays30d: 2, averageDailySales30d: '0.1333', unitsSold90d: '8.00',
        activeSalesDays90d: 4, averageDailySales90d: '0.0888', observableHistoryDays: '120',
      },
      { confidence: 'LOW' },
    );

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    const gates = result.explanation.limitations.filter((l) => l.includes('evidence gate'));
    assert.equal(gates.length, result.evidence.unmetEvidenceGates.length);
    assert.ok(gates.length >= 2, 'both the day and unit gates should be named');
  });

  it('Overstock: a clean verdict reports no limitations', () => {
    const result = assessOverstock(
      {
        productId: 'p4', isActive: true, currentStock: '2400.00', unitsSold30d: '300.00',
        activeSalesDays30d: 30, averageDailySales30d: '10.0000', unitsSold90d: '900.00',
        activeSalesDays90d: 90, averageDailySales90d: '10.0000', observableHistoryDays: '120',
      },
      { confidence: 'HIGH' },
    );

    assert.equal(result.status, 'OVERSTOCK');
    assert.deepEqual(result.explanation.limitations, []);
  });

  it('Slow/Dead: explains insufficient observable history', () => {
    const result = assessSlowDead({
      productId: 'p5', isActive: true, currentStock: '100.00', unitsSold90d: '0.00',
      activeSalesDays90d: 0, averageDailySales90d: '0.0000', observableHistoryDays: '10',
    }, { confidence: 'INSUFFICIENT' });

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.ok(result.explanation.limitations.some((l) => l.includes('observable history')));
  });

  it('Slow/Dead: dead stock is called out as lacking a demand history', () => {
    const result = assessSlowDead({
      productId: 'p5', isActive: true, currentStock: '100.00', unitsSold90d: '0.00',
      activeSalesDays90d: 0, averageDailySales90d: '0.0000', observableHistoryDays: '200',
    }, { confidence: 'INSUFFICIENT' });

    assert.equal(result.status, 'DEAD');
    assert.ok(result.explanation.limitations.some((l) => l.includes('No sales at all')));
  });

  it('Supplier: always states that on-time delivery cannot be measured', () => {
    const result = assessSupplier({
      supplierId: 'p6', supplierName: 'ABC', isActive: true, completedPOCount: 8,
      openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0,
      totalUnitsOrdered: '1200.00', totalUnitsReceived: '1200.00',
      leadTimeDays: ['5.00', '6.00', '5.00', '7.00', '6.00', '5.00', '5.00', '6.00'],
    });

    assert.equal(result.explanation.decision, 'STABLE');
    assert.equal(result.explanation.confidence, 'HIGH');
    assert.ok(result.explanation.limitations.some((l) => l.includes('promised delivery date')));
    assert.equal(result.explanation.limitations.some((l) => l.includes('Cancelled')), false,
      'no cancellations, so no cancellation limitation');
  });

  it('Supplier: names limited observations and does not blame cancellations', () => {
    const result = assessSupplier({
      supplierId: 'p6', supplierName: 'ABC', isActive: true, completedPOCount: 2,
      openPOCount: 1, cancelledPOCount: 3, draftPOCount: 0,
      totalUnitsOrdered: '0.00', totalUnitsReceived: '0.00',
      leadTimeDays: ['5.00', '9.00'],
    });

    assert.equal(result.confidence, 'LOW');
    assert.equal(result.stability, 'INSUFFICIENT_DATA');
    assert.ok(result.explanation.limitations.some((l) => l.includes('completed order')));
    assert.ok(result.explanation.limitations.some((l) => l.includes('not evidence about this supplier')));
  });

  it('every engine exposes the same four envelope fields', () => {
    const results = [
      assessStockRisk({ productId: 'a', currentStock: '10.00', unitsSold: '30.00', averageDailySales: '1.0000', observableHistoryDays: '120', activeSalesDays: '10', leadTimeSamples: ['5.00', '5.00', '5.00'], isActive: true }),
      assessDemand({ productId: 'b', windowEndDate: WINDOW, days: dayObjects(days(20), ['5.00']), observableHistoryDays: '120' }),
      assessReorder({ productId: 'c', isActive: true, currentStock: '10.00', onOrderQuantity: '0.00', unitsSold30d: '30.00', activeSalesDays30d: 10, averageDailySales30d: '1.0000', observableHistoryDays: '120', leadTimeSamples: ['5.00', '5.00', '5.00'] }, { demandConfidence: 'MEDIUM' }),
      assessOverstock({ productId: 'd', isActive: true, currentStock: '100.00', unitsSold30d: '30.00', activeSalesDays30d: 10, averageDailySales30d: '1.0000', unitsSold90d: '90.00', activeSalesDays90d: 30, averageDailySales90d: '1.0000', observableHistoryDays: '120' }, { confidence: 'MEDIUM' }),
      assessSlowDead({ productId: 'e', isActive: true, currentStock: '10.00', unitsSold90d: '30.00', activeSalesDays90d: 20, averageDailySales90d: '0.3333', observableHistoryDays: '120' }, { confidence: 'MEDIUM' }),
      assessSupplier({ supplierId: 'f', supplierName: 'S', isActive: true, completedPOCount: 6, openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0, totalUnitsOrdered: '1.00', totalUnitsReceived: '1.00', leadTimeDays: ['5.00', '5.00', '5.00', '5.00', '5.00', '5.00'] }),
    ];

    for (const result of results) {
      const explanation = result.explanation;
      assert.equal(typeof explanation.decision, 'string');
      assert.ok(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'].includes(explanation.confidence));
      assert.ok(Array.isArray(explanation.evidence));
      assert.ok(Array.isArray(explanation.limitations));
      assert.ok(explanation.evidence.length > 0, 'every decision must show its evidence');
      assert.equal(explanation.confidence, result.confidence);
      const named = 'risk' in result ? result.risk
        : 'trend' in result ? result.trend
        : 'decision' in result ? result.decision
        : 'status' in result ? result.status
        : result.stability;
      assert.equal(explanation.decision, named);
    }
  });

  it('exposes no numeric confidence score anywhere', () => {
    const result = assessSupplier({
      supplierId: 'p6', supplierName: 'ABC', isActive: true, completedPOCount: 8,
      openPOCount: 0, cancelledPOCount: 0, draftPOCount: 0,
      totalUnitsOrdered: '1.00', totalUnitsReceived: '1.00',
      leadTimeDays: ['5.00', '5.00', '5.00', '5.00', '5.00', '5.00'],
    });

    assert.equal(typeof result.explanation.confidence, 'string');
    assert.equal(typeof result.confidence, 'string');
    assert.equal(
      Object.values(result.explanation).some((v) => typeof v === 'number'),
      false,
      'the envelope must not carry a 0-100 style score',
    );
  });

  it('keeps the policy thresholds the explanations reason about', () => {
    assert.equal(DEMAND_POLICY.baselineDays, 30);
    assert.equal(DEMAND_POLICY.longDays, 90);
    assert.equal(SUPPLIER_POLICY.minimumSamplesForVariability, 3);
    assert.equal(SUPPLIER_POLICY.stableMaxCoefficientOfVariation, '0.25');
  });
});