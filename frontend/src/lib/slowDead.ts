/**
 * Slow / Dead Stock API client.
 *
 * A renderer, not a second engine. It formats what the server decided and never
 * reclassifies a status or recomputes a rate: doing that in the browser would
 * let the screen disagree with the assessment behind it.
 *
 * There is no write call in this file. Flagging stock that is not moving is a
 * read; deciding what to do about it — markdown, return, adjustment — belongs to
 * recommendation and action modules that do not exist yet.
 */

import type { DecisionExplanation } from '../components/DecisionExplanationView';
import { request } from './request';

export const SLOW_DEAD_STATUSES = ['DEAD', 'SLOW', 'NORMAL', 'INSUFFICIENT_DATA'] as const;

export type SlowDeadStatus = (typeof SLOW_DEAD_STATUSES)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface SlowDeadEvidence {
  analysisWindowDays: number;
  minimumObservableDays: number;
  slowMaxActiveSalesDays: number;
  holdsInventory: boolean;
  hasSufficientHistory: boolean;
  /** The ordered rule that decided the status, for auditing the verdict. */
  classificationBasis: string;
}

export interface SlowDead {
  productId: string;
  sku: string;
  name: string;
  category: { id: string; name: string } | null;
  isActive: boolean;

  status: SlowDeadStatus;
  priority: number;

  currentStock: string;
  unitsSold90d: string;
  activeSalesDays90d: number;
  averageDailySales90d: string;

  /** Calendar length of the demand window the classification is based on. */
  analysisWindowDays: number;

  confidence: ConfidenceLevel;
  /** Deterministic explanation written by the server — rendered, never rewritten. */
  reason: string;

  evidence: SlowDeadEvidence;

  /** Decision, confidence, evidence and limitations, as decided by the server. */
  explanation: DecisionExplanation;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SlowDeadQuery {
  search?: string;
  categoryId?: string;
  isActive?: 'all' | 'true' | 'false';
  status?: SlowDeadStatus | 'all';
  confidence?: ConfidenceLevel | 'all';
  page?: number;
  limit?: number;
}

function buildQueryString(query: SlowDeadQuery): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  // `'all'` is the client-side "no filter" marker; it is omitted, never sent.
  if (query.isActive && query.isActive !== 'all') params.set('isActive', query.isActive);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.confidence && query.confidence !== 'all') params.set('confidence', query.confidence);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export const slowDeadApi = {
  list: (query: SlowDeadQuery) =>
    request<{
      data: SlowDead[];
      meta: ListMeta;
      statusCounts: Partial<Record<SlowDeadStatus, number>>;
    }>(`/api/intelligence/slow-dead${buildQueryString(query)}`),

  detail: (productId: string) =>
    request<{ data: SlowDead }>(`/api/intelligence/slow-dead/${productId}`),
};