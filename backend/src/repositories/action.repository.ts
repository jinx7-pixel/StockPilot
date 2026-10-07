/**
 * Action persistence.
 *
 * Every function takes `businessId` explicitly; there is no unscoped lookup, so a
 * forgotten tenant scope is a compile error rather than a data leak.
 *
 * ## Concurrency and the idempotency race
 *
 * `insertAction` can fail with a unique violation on
 * `actions_business_id_idempotency_key_key` when two requests carrying the same
 * key arrive together. That is not an error to swallow — it is the mechanism
 * working. `insertAction` reports the violation via its return value rather than
 * throwing, so the caller can re-read the winning row and replay its result
 * instead of creating a second purchase order.
 *
 * Every read and write is client-scoped so the whole action runs inside one
 * transaction together with the purchase order it records.
 */

import type { PoolClient } from 'pg';

import type { ActionStatus, ActionType } from '../services/actions.schemas.js';

/** PostgreSQL error code for a unique_violation. */
const UNIQUE_VIOLATION = '23505';

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
  requestFingerprint: string | null;
  sourceRecommendationType: string;
  sourceRecommendationId: string;
  sourceRecommendationContext: Record<string, unknown>;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ActionRow {
  id: string;
  business_id: string;
  user_id: string;
  action_type: ActionType;
  status: ActionStatus;
  product_id: string;
  supplier_id: string;
  quantity: string;
  recommended_quantity: string;
  purchase_order_id: string | null;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  source_recommendation_type: string;
  source_recommendation_id: string;
  source_recommendation_context: Record<string, unknown>;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/** Column list, written once so `SELECT` and `RETURNING` can never drift apart. */
const COLUMNS = `
  id, business_id, user_id, action_type, status, product_id, supplier_id,
  quantity, recommended_quantity, purchase_order_id, idempotency_key,
  request_fingerprint, source_recommendation_type, source_recommendation_id,
  source_recommendation_context, failure_reason, created_at, updated_at, completed_at`;

const SELECT = `SELECT ${COLUMNS} FROM actions`;

function mapRow(row: ActionRow): Action {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    actionType: row.action_type,
    status: row.status,
    productId: row.product_id,
    supplierId: row.supplier_id,
    quantity: row.quantity,
    recommendedQuantity: row.recommended_quantity,
    purchaseOrderId: row.purchase_order_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    sourceRecommendationType: row.source_recommendation_type,
    sourceRecommendationId: row.source_recommendation_id,
    sourceRecommendationContext: row.source_recommendation_context,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export interface InsertActionInput {
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
  requestFingerprint: string | null;
  sourceRecommendationType: string;
  sourceRecommendationId: string;
  sourceRecommendationContext: Record<string, unknown>;
  failureReason: string | null;
}

export type InsertActionResult =
  | { outcome: 'inserted'; action: Action }
  /** The key was already used; `action` is the row that won the race. */
  | { outcome: 'duplicate'; action: Action };

/**
 * Insert one audit row.
 *
 * Returns `duplicate` rather than throwing on the idempotency unique violation,
 * because for the caller that is not a failure — it means "this exact action
 * already happened", and the stored result should be replayed. Any *other* unique
 * violation is still a real error and propagates.
 *
 * ## Why the insert runs inside a savepoint
 *
 * In PostgreSQL an error inside a transaction poisons it: every later command on
 * that connection fails with `25P02` until the transaction ends. Two simultaneous
 * requests with the same idempotency key therefore deadlock *logically* — the loser
 * detects the unique violation and then cannot read the winner's row, because the
 * transaction it needs to read it in is already aborted.
 *
 * Rolling back to a savepoint discards only the failed statement, leaving the
 * transaction usable. That is what makes reading the winner's row possible, and
 * therefore what makes concurrent replay work at all.
 */
export async function insertAction(
  client: PoolClient,
  input: InsertActionInput,
): Promise<InsertActionResult> {
  // Statement-local rollback point, so a duplicate key can be caught without
  // aborting the caller's transaction.
  await client.query('SAVEPOINT action_insert');

  try {
    const result = await client.query<ActionRow>(
      `INSERT INTO actions (
         business_id, user_id, action_type, status, product_id, supplier_id,
         quantity, recommended_quantity, purchase_order_id,
         idempotency_key, request_fingerprint,
         source_recommendation_type, source_recommendation_id, source_recommendation_context,
         failure_reason, completed_at
       ) VALUES (
         $1, $2, $3, $4::action_status, $5, $6,
         $7::numeric, $8::numeric, $9,
         $10, $11,
         $12, $13, $14::jsonb,
         $15, CASE WHEN $4::action_status = 'COMPLETED' THEN now() ELSE NULL END
       )
       RETURNING ${COLUMNS}`,
      [
        input.businessId,
        input.userId,
        input.actionType,
        input.status,
        input.productId,
        input.supplierId,
        input.quantity,
        input.recommendedQuantity,
        input.purchaseOrderId,
        input.idempotencyKey,
        input.requestFingerprint,
        input.sourceRecommendationType,
        input.sourceRecommendationId,
        JSON.stringify(input.sourceRecommendationContext),
        input.failureReason,
      ],
    );

    await client.query('RELEASE SAVEPOINT action_insert');

    const row = result.rows[0];
    if (!row) throw new Error('Insert of an action row returned no row');
    return { outcome: 'inserted', action: mapRow(row) };
  } catch (error) {
    // Undo just the failed statement, so the transaction can carry on.
    await client.query('ROLLBACK TO SAVEPOINT action_insert');
    await client.query('RELEASE SAVEPOINT action_insert');

    if (!isUniqueViolation(error) || input.idempotencyKey === null) throw error;

    const existing = await findActionByIdempotencyKey(client, input.businessId, input.idempotencyKey);
    if (!existing) {
      // A unique violation on some other constraint; surface it rather than guess.
      throw error;
    }
    return { outcome: 'duplicate', action: existing };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/** Look up a previously completed action by its replay key. */
export async function findActionByIdempotencyKey(
  client: PoolClient,
  businessId: string,
  idempotencyKey: string,
): Promise<Action | null> {
  const result = await client.query<ActionRow>(
    `${SELECT} WHERE business_id = $1 AND idempotency_key = $2`,
    [businessId, idempotencyKey],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Look up one action by id, scoped to its business.
 *
 * There is deliberately no unscoped `findActionById`. An action belongs to a
 * business, and a lookup that omitted `business_id` would make a cross-tenant read
 * a single forgotten argument away.
 *
 * An action belonging to another business returns `null`, exactly as an id that
 * does not exist does. The caller cannot tell the two apart, so the id space is
 * not probeable.
 */
export async function findActionById(
  client: PoolClient,
  businessId: string,
  actionId: string,
): Promise<Action | null> {
  const result = await client.query<ActionRow>(`${SELECT} WHERE business_id = $1 AND id = $2`, [
    businessId,
    actionId,
  ]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export interface ListActionsOptions {
  actionType?: ActionType;
  status?: ActionStatus;
  productId?: string;
  limit: number;
  offset: number;
}

export interface ActionPage {
  items: Action[];
  total: number;
}

/** One tenant's action history, newest first, with optional filters. */
export async function listActions(
  client: PoolClient,
  businessId: string,
  options: ListActionsOptions,
): Promise<ActionPage> {
  const conditions = ['business_id = $1'];
  const params: unknown[] = [businessId];

  if (options.actionType !== undefined) {
    params.push(options.actionType);
    conditions.push(`action_type = $${params.length}`);
  }
  if (options.status !== undefined) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }
  if (options.productId !== undefined) {
    params.push(options.productId);
    conditions.push(`product_id = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countResult = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM actions WHERE ${where}`,
    params,
  );

  const rowsResult = await client.query<ActionRow>(
    `${SELECT} WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, options.limit, options.offset],
  );

  return {
    items: rowsResult.rows.map(mapRow),
    total: Number(countResult.rows[0]?.count ?? '0'),
  };
}

export interface ActionProductRef {
  id: string;
  sku: string;
  name: string;
  isActive: boolean;
  /** The product's own cost, used as the draft order's unit cost. */
  costPrice: string;
}

export interface ActionSupplierRef {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Read the product the action targets.
 *
 * Returns `null` when the product does not exist **or** belongs to another
 * business — the two are reported identically so the endpoint cannot be used to
 * probe for another tenant's product ids.
 */
export async function findActionProduct(
  client: PoolClient,
  businessId: string,
  productId: string,
): Promise<ActionProductRef | null> {
  const result = await client.query<{
    id: string;
    sku: string;
    name: string;
    is_active: boolean;
    cost_price: string | null;
  }>(
    `SELECT id, sku, name, is_active, cost_price
       FROM products WHERE business_id = $1 AND id = $2`,
    [businessId, productId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    isActive: row.is_active,
    costPrice: row.cost_price ?? '0.00',
  };
}