/**
 * Action Center business rules.
 *
 * ## The one thing this module does
 *
 * Turns a recommendation the user has reviewed into exactly one kind of change: a
 * **draft** purchase order, plus the audit row that records why.
 *
 * Nothing else is executable. A supplier switch, a stock adjustment, a delete, a
 * bulk run — none has a code path here, so none can be requested, whatever a
 * client sends. The review-only recommendation kinds have no branch at all.
 *
 * ## One transaction, all or nothing
 *
 * ```
 *   BEGIN
 *     product revalidated
 *     purchase order header inserted
 *     purchase order line inserted
 *     COMPLETED audit row inserted
 *   COMMIT
 * ```
 *
 * The audit row is inside the transaction on purpose. If it cannot be written the
 * order must not exist either, because an order nobody can explain is worse than
 * no order. The reverse failure — a rejected attempt leaving a purchase order
 * behind — is prevented by the same transaction.
 *
 * ## Revalidation is the whole safety story
 *
 * A recommendation is a snapshot of a moment. Between reading it and pressing the
 * button, stock may have been received, sold or reordered. So the recommendation
 * is **recomputed from the current intelligence result at execution time** and the
 * action is refused unless a live `REPLENISH` still stands for that product.
 *
 * This costs one intelligence evaluation and buys certainty that the action is
 * still warranted. The suggested quantity recorded in the audit is that live
 * figure, not a value supplied by the caller.
 *
 * ## Idempotency
 *
 * A double-clicked button must not raise two purchase orders. When the caller
 * sends `Idempotency-Key`:
 *
 *   - same key, same payload    -> the stored result is replayed verbatim;
 *   - same key, different payload -> `409`, because returning the old order for a
 *     new request would be a lie about what was ordered;
 *   - two simultaneous requests  -> the unique index lets exactly one insert win,
 *     and the loser replays the winner.
 *
 * Without a key, every request is independent — the ordinary case, unconstrained.
 */

import { createHash } from 'node:crypto';

import { getPool, withTransaction } from '../db/pool.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { buildRecommendations, type Recommendation } from '../intelligence/recommendations.js';
import {
  findActionById,
  findActionByIdempotencyKey,
  findActionProduct,
  insertAction,
  listActions,
  type Action,
} from '../repositories/action.repository.js';
import { findPurchaseOrderById } from '../repositories/purchaseOrder.repository.js';
import { getUnifiedIntelligence } from './unified.service.js';
import { createPurchaseOrderIn } from './purchaseOrder.service.js';
import {
  EXECUTABLE_ACTION_TYPE,
  type CreateActionInput,
  type ListActionsQuery,
} from './actions.schemas.js';

/** Maximum accepted `Idempotency-Key` length, matching the column width. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Field separator for the request fingerprint.
 *
 * NUL rather than a space or comma: it cannot occur in a UUID, a decimal string
 * or an identifier, so no two different requests can ever be spelled the same way
 * by accident. Written as an escape so the source file stays free of control
 * characters.
 */
const FINGERPRINT_SEPARATOR = '\u0000';

export interface ActionPage {
  items: Action[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ActionResult {
  action: Action;
  purchaseOrder: unknown | null;
}

/**
 * SHA-256 over the normalised request.
 *
 * Field order is fixed by construction rather than by JSON iteration order, so the
 * same request always fingerprints identically regardless of how the client
 * ordered its keys.
 */
function fingerprint(input: CreateActionInput): string {
  const normalised = [
    input.productId,
    input.supplierId,
    input.quantity,
    input.sourceRecommendationId ?? '',
  ].join(FINGERPRINT_SEPARATOR);

  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Validate a client-supplied replay key.
 *
 * A blank key is treated as absent, because that is what a client sending an empty
 * header means. An over-long key is rejected rather than silently ignored: honouring
 * a truncated key would make two different requests share one identity.
 */
export function normaliseIdempotencyKey(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const key = raw.trim();
  if (key === '') return null;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ConflictError(
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      'IDEMPOTENCY_KEY_TOO_LONG',
    );
  }
  return key;
}

/** The compact traceability stored on a row, built from a live recommendation. */
function traceabilityContext(recommendation: Recommendation): Record<string, unknown> {
  // Deliberately not the whole intelligence snapshot: this is the minimum an
  // auditor needs to explain the order, and it is read back verbatim rather than
  // re-derived, because by then the reorder decision may have changed.
  return {
    type: recommendation.type,
    priority: recommendation.priority,
    confidence: recommendation.confidence,
    recommendedQuantity: recommendation.recommendedQuantity ?? null,
    sourceDecisions: recommendation.sourceDecisions,
    reason: recommendation.reason,
  };
}

/**
 * Record the rejected attempt, then let the caller surface the real error.
 *
 * Deliberately swallows its own failures. This write happens *after* the main
 * transaction has already rolled back, and it exists for auditability only — it
 * must never mask the original failure or turn a clean 409 into a 500.
 */
async function recordFailedAction(input: {
  businessId: string;
  userId: string;
  productId: string;
  supplierId: string;
  quantity: string;
  recommendedQuantity: string;
  sourceRecommendation: Recommendation | null;
  failureReason: string;
}): Promise<void> {
  // Inside a transaction for uniformity: `insertAction` guards its insert with a
  // savepoint, which PostgreSQL only permits within a transaction block.
  await withTransaction((client) =>
    insertAction(client, {
      businessId: input.businessId,
      userId: input.userId,
      actionType: EXECUTABLE_ACTION_TYPE,
      status: 'FAILED',
      productId: input.productId,
      supplierId: input.supplierId,
      quantity: input.quantity,
      recommendedQuantity: input.recommendedQuantity,
      purchaseOrderId: null,
      // A failed action must not consume the replay key: the caller may correct the
      // request and retry with the same key.
      idempotencyKey: null,
      requestFingerprint: null,
      sourceRecommendationType: input.sourceRecommendation?.type ?? 'REPLENISH',
      sourceRecommendationId:
        input.sourceRecommendation?.id ?? `${input.productId}:REPLENISH`,
      sourceRecommendationContext: input.sourceRecommendation
        ? traceabilityContext(input.sourceRecommendation)
        : { type: 'REPLENISH', reason: 'No live recommendation at execution time.' },
      failureReason: input.failureReason,
    }),
  );
}

/**
 * Raised inside the transaction when this request lost the idempotency race.
 *
 * It exists to force a **whole-transaction rollback**. The purchase order has
 * already been inserted by that point, so rolling back only the audit row would
 * leave an order nobody asked for and nobody can explain. Throwing discards both
 * — the order and the line — and the caller then replays the winner's stored
 * result from outside.
 */
class IdempotentReplay extends Error {
  constructor() {
    super('Idempotency key already used; replaying the stored result.');
    this.name = 'IdempotentReplay';
  }
}

/** Rebuild the response body for an already-completed action. */
async function replayCompletedAction(action: Action): Promise<ActionResult> {
  if (!action.purchaseOrderId) {
    // Unreachable: the schema forbids COMPLETED without a purchase order.
    throw new Error(`Action ${action.id} is COMPLETED but has no purchase order`);
  }
  const purchaseOrder = await findPurchaseOrderById(action.businessId, action.purchaseOrderId);
  if (!purchaseOrder) {
    throw new NotFoundError(
      'The purchase order recorded for this action no longer exists.',
      'PURCHASE_ORDER_NOT_FOUND',
    );
  }
  return { action, purchaseOrder };
}

/** Reason text for the stale case, kept in one place so audit and response agree. */
const STALE_REASON =
  'No live REPLENISH recommendation for this product at execution time; the reviewed recommendation is stale.';

/**
 * Execute a reviewed recommendation.
 *
 * Creates a draft purchase order and its audit row in a single transaction.
 */
export async function createAction(
  businessId: string,
  userId: string,
  input: CreateActionInput,
  idempotencyKeyHeader?: string,
): Promise<{ result: ActionResult; replayed: boolean }> {
  const idempotencyKey = normaliseIdempotencyKey(idempotencyKeyHeader);
  const requestFingerprint = fingerprint(input);

  // A replay short-circuits before any validation or revalidation: the recorded
  // outcome is the answer, and re-deriving it could disagree with what happened.
  if (idempotencyKey !== null) {
    const client = await getPool().connect();
    try {
      const existing = await findActionByIdempotencyKey(client, businessId, idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new ConflictError(
            'This Idempotency-Key was already used with different request data.',
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        return { result: await replayCompletedAction(existing), replayed: true };
      }
    } finally {
      client.release();
    }
  }

  // ---- Revalidation -------------------------------------------------------
  // The recommendation the user reviewed is a snapshot. Recompute it now and
  // proceed only if a live REPLENISH still stands for this product.
  const snapshot = await getUnifiedIntelligence(businessId, input.productId);
  const liveRecommendation =
    snapshot
      ? (buildRecommendations(snapshot).find(
          (recommendation) => recommendation.type === 'REPLENISH',
        ) ?? null)
      : null;

  const failAudit = (failureReason: string): Promise<void> =>
    recordFailedAction({
      businessId,
      userId,
      productId: input.productId,
      supplierId: input.supplierId,
      quantity: input.quantity,
      // A FAILED row may carry no engine quantity; the schema allows zero there.
      recommendedQuantity: liveRecommendation?.recommendedQuantity ?? '0.00',
      sourceRecommendation: liveRecommendation,
      failureReason,
    });

  if (!liveRecommendation) {
    try {
      await failAudit(STALE_REASON);
    } catch {
      // Best-effort; the caller is already being refused.
    }
    throw new ConflictError(
      'This recommendation is no longer current. Refresh and review it before acting.',
      'RECOMMENDATION_STALE',
    );
  }

  const suggestedQuantity = liveRecommendation.recommendedQuantity;
  if (suggestedQuantity === undefined) {
    // `quantityIsUsable` already guarantees this, but the audit column is NOT NULL
    // and a silent zero here would be a fabricated number.
    throw new ConflictError(
      'The live recommendation does not carry a usable quantity.',
      'RECOMMENDATION_STALE',
    );
  }

  try {
    const order = await withTransaction(async (client) => {
      // Resolve the product inside the transaction. A product owned by another
      // tenant yields the same 404 as one that does not exist.
      const product = await findActionProduct(client, businessId, input.productId);
      if (!product) {
        throw new NotFoundError('Product not found.', 'PRODUCT_NOT_FOUND');
      }
      if (!product.isActive) {
        throw new ConflictError(
          `Cannot order "${product.name}" because the product is inactive.`,
          'PRODUCT_INACTIVE',
        );
      }

      // Reuse the purchase-order service so validation, pricing and totals are
      // computed by exactly the same code that serves POST /api/purchase-orders.
      const created = await createPurchaseOrderIn(client, businessId, userId, {
        supplierId: input.supplierId,
        items: [{ productId: product.id, quantity: input.quantity, unitCost: product.costPrice }],
      });

      const inserted = await insertAction(client, {
        businessId,
        userId,
        actionType: EXECUTABLE_ACTION_TYPE,
        status: 'COMPLETED',
        productId: product.id,
        supplierId: input.supplierId,
        quantity: input.quantity,
        recommendedQuantity: suggestedQuantity,
        purchaseOrderId: created.id,
        idempotencyKey,
        // The fingerprint exists only to detect a key replayed with different
        // data. With no key there is nothing to compare, so neither is stored.
        requestFingerprint: idempotencyKey === null ? null : requestFingerprint,
        sourceRecommendationType: liveRecommendation.type,
        sourceRecommendationId: liveRecommendation.id,
        sourceRecommendationContext: traceabilityContext(liveRecommendation),
        failureReason: null,
      });

      if (inserted.outcome === 'duplicate') {
        // Another request already did this exact work. Undo the order we just
        // created — its audit row belongs to the winner, not to us.
        throw new IdempotentReplay();
      }

      return { action: inserted.action, purchaseOrder: created };
    });

    return { result: { action: order.action, purchaseOrder: order.purchaseOrder }, replayed: false };
  } catch (error) {
    if (error instanceof IdempotentReplay) {
      // The transaction is already rolled back, so nothing of ours persists. The
      // winner's row is visible now (our failed insert waited on its unique index,
      // which only resolves once the winner commits), so it can be replayed safely.
      if (idempotencyKey === null) throw error;
      const client = await getPool().connect();
      try {
        const winner = await findActionByIdempotencyKey(client, businessId, idempotencyKey);
        if (!winner) throw error;
        if (winner.requestFingerprint !== requestFingerprint) {
          throw new ConflictError(
            'This Idempotency-Key was already used with different request data.',
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        return { result: await replayCompletedAction(winner), replayed: true };
      } finally {
        client.release();
      }
    }

    // A supplier the user may not use, or one that has since been deactivated, is
    // recorded as a rejected attempt and surfaced as-is. An order is never
    // partially written: the transaction already rolled back.
    try {
      await failAudit(error instanceof Error ? error.message : String(error));
    } catch {
      // Best-effort; the original error is what the caller needs to see.
    }
    throw error;
  }
}

/**
 * One tenant's action history, newest first.
 *
 * Every call passes the business id from the session, so a caller cannot read
 * another tenant's audit trail.
 */
export async function listBusinessActions(
  businessId: string,
  query: ListActionsQuery,
): Promise<ActionPage> {
  const client = await getPool().connect();
  try {
    const { items, total } = await listActions(client, businessId, {
      ...(query.actionType !== undefined ? { actionType: query.actionType } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  } finally {
    client.release();
  }
}

/**
 * One action, with the purchase order it produced.
 *
 * ## Shape
 *
 * Mirrors the `POST /api/actions` response exactly — `{ action, purchaseOrder }` —
 * so a client that has just created an action can fetch it again later and get the
 * same document. `purchaseOrder` is `null` for a `FAILED` action, which is the
 * honest answer: no order was created.
 *
 * ## Tenancy
 *
 * The lookup is scoped to `businessId`, which the caller takes from the session.
 * An action belonging to another business is reported as `NotFoundError`, exactly
 * as an id that does not exist is, so the endpoint cannot be used to discover
 * which action ids are real.
 *
 * Read-only. It performs no writes, and there is no companion update or delete.
 */
export async function getBusinessAction(
  businessId: string,
  actionId: string,
): Promise<ActionResult> {
  const client = await getPool().connect();
  try {
    const action = await findActionById(client, businessId, actionId);
    if (!action) throw new NotFoundError('Action not found.');

    if (!action.purchaseOrderId) {
      // A FAILED action never produced an order.
      return { action, purchaseOrder: null };
    }

    const purchaseOrder = await findPurchaseOrderById(businessId, action.purchaseOrderId);
    if (!purchaseOrder) {
      // The order was removed after the action was recorded. Report the action
      // without it rather than inventing a 404: the action itself still exists and
      // is still the caller's.
      return { action, purchaseOrder: null };
    }

    return { action, purchaseOrder };
  } finally {
    client.release();
  }
}