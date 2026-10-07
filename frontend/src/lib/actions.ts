/**
 * Action Center API client.
 *
 * ## What this client can do
 *
 * Exactly two things: read a user's action history, and execute one reviewed
 * recommendation as a draft purchase order. There is no update or delete call
 * here, and that is not an oversight — an executed action is immutable.
 *
 * Nothing in this file knows about intelligence, demand, reorder points or
 * safety stock. The server decides whether an action is still warranted; the
 * client only sends what the user chose.
 *
 * ## Idempotency keys
 *
 * `executeAction` generates a key per call and keeps it stable across retries of
 * *that* call. A double-clicked button therefore sends the same key twice and the
 * server replays the first result instead of raising a second order. A genuinely
 * new action gets a new key.
 */

import { request, ApiError } from './request';

/** The one executable action kind. */
export type ActionType = 'CREATE_DRAFT_PURCHASE_ORDER';

/** Mirrors the server's `action_status` enum. */
export type ActionStatus = 'COMPLETED' | 'FAILED';

/** The minimum traceability the server stores about the decision that caused this. */
export interface ActionContext {
  type: string;
  priority?: string;
  confidence?: string;
  recommendedQuantity?: string | null;
  sourceDecisions?: string[];
  reason?: string;
}

export interface Action {
  id: string;
  businessId: string;
  userId: string;
  actionType: ActionType;
  status: ActionStatus;
  productId: string;
  supplierId: string;
  quantity: string;
  recommendedQuantity: string;
  purchaseOrderId: string | null;
  idempotencyKey: string | null;
  sourceRecommendationType: string;
  sourceRecommendationId: string;
  sourceRecommendationContext: ActionContext;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** The purchase-order summary returned alongside a freshly created action. */
export interface ActionPurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  totalAmount: string;
  orderedAt: string | null;
  expectedAt: string | null;
  itemCount: number;
  createdAt: string;
  items?: Array<{
    id: string;
    productId: string;
    sku: string;
    productName: string;
    quantity: string;
    unitCost: string;
    lineTotal: string;
  }>;
}

export interface ActionPage {
  items: Action[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ExecuteActionInput {
  productId: string;
  supplierId: string;
  quantity: string;
  sourceRecommendationId?: string;
}

export interface ExecuteActionResult {
  action: Action;
  purchaseOrder: ActionPurchaseOrder | null;
}

export interface ListActionsQuery {
  page?: number;
  limit?: number;
  actionType?: ActionType;
  status?: ActionStatus;
  productId?: string;
}

/** Cryptographically random key, used to make a retried submission safe. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toQueryString(query: ListActionsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised.length > 0 ? `?${serialised}` : '';
}

export const actionsApi = {
  /** This business's action history, newest first. */
  list: (query: ListActionsQuery = {}) =>
    request<ActionPage>(`/api/actions${toQueryString(query)}`),

  /**
   * Execute one reviewed recommendation as a draft purchase order.
   *
   * `idempotencyKey` is passed rather than generated here so that a caller
   * retrying the *same* confirmation reuses it. Omitting it generates a fresh
   * key, which is right for a new action and wrong for a retry.
   */
  execute: (input: ExecuteActionInput, idempotencyKey = newIdempotencyKey()) =>
    request<ExecuteActionResult>('/api/actions', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  /** True when the failure means "revisit the recommendation", not "retry". */
  isStale: (error: unknown): boolean =>
    error instanceof ApiError && error.code === 'RECOMMENDATION_STALE',
};