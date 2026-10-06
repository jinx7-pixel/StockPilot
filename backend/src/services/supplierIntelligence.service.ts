/**
 * Supplier Intelligence service.
 *
 * Gathers facts, hands them to the pure engine, and does nothing else. It holds
 * no formula: the median, the 90th percentile, the coefficient of variation, the
 * stability class and the confidence all come from `intelligence/`.
 *
 * This module measures history. It does not judge a supplier, rank them, or
 * suggest anything — no replacement, no selection, no score. A long lead time is
 * a fact with several possible causes, and only a person with context the system
 * does not hold can say which.
 *
 * Read-only. Nothing here writes to suppliers or purchase orders.
 */

import { NotFoundError } from '../errors.js';
import {
  assessSupplier,
  SUPPLIER_POLICY,
  type SupplierResult,
} from '../intelligence/index.js';
import {
  getSupplierFact,
  listSupplierFacts,
  listSupplierLeadTimes,
  type SupplierFactRow,
} from '../repositories/supplierIntelligence.repository.js';
import type { ListSuppliersQuery } from './supplierIntelligence.schemas.js';

export interface SupplierEntry extends SupplierResult {
  /** Only on the detail response. */
  leadTimeObservations?: SupplierLeadTimeObservation[];
}

export interface SupplierLeadTimeObservation {
  purchaseOrderId: string;
  orderedAt: string;
  receivedAt: string;
  leadTimeDays: string;
}

export interface SupplierPage {
  items: SupplierResult[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Counts per stability for the scoped catalog, so a filter can show a summary. */
  stabilityCounts: Record<string, number>;
}

function toFacts(row: SupplierFactRow) {
  return {
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    isActive: row.is_active,
    completedPOCount: row.completed_po_count,
    openPOCount: row.open_po_count,
    cancelledPOCount: row.cancelled_po_count,
    draftPOCount: row.draft_po_count,
    totalUnitsOrdered: row.total_units_ordered,
    totalUnitsReceived: row.total_units_received,
    leadTimeDays: row.lead_time_days ?? [],
  };
}

/**
 * Assess every supplier for a tenant, with the requested filters.
 *
 * `stability` and `confidence` are applied **after** classification rather than
 * in SQL: each is a function of the whole fact set, so filtering in the database
 * would mean reimplementing the engine's rules in a `WHERE` clause.
 */
export async function listSupplierIntelligence(
  businessId: string,
  query: ListSuppliersQuery,
): Promise<SupplierPage> {
  // One wide read, classify, then filter and paginate in memory. Bounded by the
  // policy's supplier guard so a runaway catalog cannot exhaust memory.
  const rows = await listSupplierFacts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: SUPPLIER_POLICY.maxSuppliers,
    offset: 0,
  });

  const details = rows.map((row) => ({ row, result: assessSupplier(toFacts(row)) }));

  const stabilityCounts: Record<string, number> = {};
  for (const { result } of details) {
    stabilityCounts[result.stability] = (stabilityCounts[result.stability] ?? 0) + 1;
  }

  const filtered = details.filter(
    ({ result }) =>
      (query.stability === undefined || result.stability === query.stability) &&
      (query.confidence === undefined || result.confidence === query.confidence),
  );

  const start = (query.page - 1) * query.limit;

  return {
    items: filtered.slice(start, start + query.limit).map(({ result }) => result),
    page: query.page,
    limit: query.limit,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / query.limit)),
    stabilityCounts,
  };
}

/**
 * Assess one supplier, with the individual orders behind its figures.
 *
 * The observations are the evidence a reader needs to check the median, the
 * 90th percentile and the spread by hand. Nothing sensitive is included: an
 * order id and two timestamps, nothing from the supplier's contact record.
 */
export async function getSupplierIntelligence(
  businessId: string,
  supplierId: string,
): Promise<SupplierEntry> {
  const row = await getSupplierFact(businessId, supplierId);
  if (!row) throw new NotFoundError('Supplier not found.');

  const observations = await listSupplierLeadTimes(businessId, supplierId);

  return {
    ...assessSupplier(toFacts(row)),
    leadTimeObservations: observations.map((observation) => ({
      purchaseOrderId: observation.purchase_order_id,
      orderedAt: observation.ordered_at.toISOString(),
      receivedAt: observation.received_at.toISOString(),
      leadTimeDays: observation.lead_time_days,
    })),
  };
}