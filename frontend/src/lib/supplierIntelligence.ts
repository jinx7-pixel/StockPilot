/**
 * Supplier Intelligence API client.
 *
 * A renderer, not a second engine. It formats what the server decided and never
 * recomputes a median, a percentile or a stability class: doing that in the
 * browser would let the screen disagree with the assessment behind it.
 *
 * There is no write call in this file, and deliberately no concept of a
 * supplier score. Supplier performance is measured here; judging, ranking,
 * rewarding, replacing or penalising a supplier belongs to later modules that do
 * not exist yet.
 */

import type { DecisionExplanation } from '../components/DecisionExplanationView';
import { request, requestList } from './request';

export const SUPPLIER_STABILITIES = ['STABLE', 'VARIABLE', 'INSUFFICIENT_DATA'] as const;

export type SupplierStability = (typeof SUPPLIER_STABILITIES)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface SupplierEvidence {
  completedPOCount: number;
  leadTimeSampleCount: number;
  minimumSamplesForVariability: number;
  stableMaxCoefficientOfVariation: string;
  minLeadTimeDays: string | null;
  maxLeadTimeDays: string | null;
  /**
   * Always false: the schema records no promised delivery date, so on-time
   * delivery cannot be measured and is never estimated.
   */
  hasPromisedDeliveryDate: boolean;
}

export interface SupplierLeadTimeObservation {
  purchaseOrderId: string;
  orderedAt: string;
  receivedAt: string;
  leadTimeDays: string;
}

export interface Supplier {
  supplierId: string;
  supplierName: string;
  isActive: boolean;

  completedPOCount: number;
  openPOCount: number;
  cancelledPOCount: number;
  draftPOCount: number;

  totalUnitsOrdered: string;
  totalUnitsReceived: string;

  medianLeadTimeDays: string | null;
  p90LeadTimeDays: string | null;
  leadTimeSampleCount: number;
  leadTimeCV: string | null;

  stability: SupplierStability;
  priority: number;

  confidence: ConfidenceLevel;
  /** Deterministic explanation written by the server — rendered, never rewritten. */
  reason: string;

  evidence: SupplierEvidence;

  /** Only on the detail response. */
  leadTimeObservations?: SupplierLeadTimeObservation[];

  /** Decision, confidence, evidence and limitations, as decided by the server. */
  explanation: DecisionExplanation;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SupplierQuery {
  search?: string;
  isActive?: 'all' | 'true' | 'false';
  stability?: SupplierStability | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: SupplierQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  // `'all'` is the client-side "no filter" marker; it is omitted, never sent.
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.stability && query.stability !== 'all') params.set('stability', query.stability);
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/** The count summary the supplier route sends beside `data` and `meta`. */
interface SupplierCounts {
  stabilityCounts?: Partial<Record<SupplierStability, number>>;
}

export const supplierIntelligenceApi = {
  list: async (query: SupplierQuery) => {
    const { items, meta, counts } = await requestList<Supplier, SupplierCounts>(
      `/api/intelligence/suppliers${buildQueryString(query)}`,
    );
    return { items, meta, stabilityCounts: counts?.stabilityCounts };
  },

  detail: (supplierId: string) => request<Supplier>(`/api/intelligence/suppliers/${supplierId}`),
};