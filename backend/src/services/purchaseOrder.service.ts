/**
 * Purchase order business rules.
 *
 * ## Creating an order never touches inventory
 *
 * A purchase order records intent to buy. Stock increases only when goods are
 * received, and then only as immutable `in` movements in `inventory_movements`.
 * `createPurchaseOrder` writes a header and its lines and nothing else.
 *
 * ## The lifecycle
 *
 * ```
 *   draft â”€â”€orderâ”€â”€> ordered â”€â”€receive(all)â”€â”€â”€â”€> received
 *     â”‚                 â”‚                          (terminal)
 *     â”‚                 â””â”€â”€receive(some)â”€â”€> partially_received â”€â”€receive(rest)â”€â”€> received
 *     â””â”€â”€cancelâ”€â”€> cancelled   (terminal)
 *   ordered â”€â”€cancelâ”€â”€> cancelled   (terminal)
 * ```
 *
 * `cancelled` and `received` are terminal. A receipt is refused on both.
 *
 * ## Receiving is one transaction
 *
 * Within a single transaction:
 *  1. load the order for this business and reject a terminal state;
 *  2. take the **purchase order's** advisory lock â€” the resource two concurrent
 *     receipts would contend for;
 *  3. re-read the lines inside the transaction, after the lock;
 *  4. check every requested product belongs to the order;
 *  5. take each product's advisory lock, in ascending id order;
 *  6. verify `received + requested <= ordered` per line, and reject if not;
 *  7. update `received_quantity` and append one `in` movement per line through
 *     the inventory service;
 *  8. recompute the status, and set `received_at` when fully received.
 *
 * Any failure rolls all of it back, so there is never a partial receipt, a
 * partial stock increase, or an inconsistent status.
 *
 * ## Why two kinds of lock
 *
 * The **per-product** locks are the existing inventory mechanism â€” the same
 * advisory lock `appendMovement` takes â€” so a receipt serialises correctly
 * against a concurrent sale of the same product. The **per-purchase-order** lock
 * is what stops two receipts of the *same order* from both reading the same
 * `received_quantity` and over-receiving. Neither is global: two receipts of
 * different orders, or of different products, never block each other.
 *
 * Locks are taken in a deterministic order (purchase order, then products by
 * ascending id) so two receipts sharing products cannot deadlock.
 */

import type { PoolClient } from 'pg';

import { withTransaction } from '../db/pool.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { acquireAdvisoryLock, acquireProductStockLock } from '../repositories/inventory.repository.js';
import {
  findOrderHeader,
  findPurchaseOrderById,
  incrementReceivedQuantity,
  insertPurchaseOrder,
  insertPurchaseOrderItem,
  listPurchaseOrders,
  readOrderItemsForReceipt,
  resolveOrderItems,
  updateDraftOrder,
  updateOrderStatus,
  RECEIVABLE_STATUSES,
  type PurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
} from '../repositories/purchaseOrder.repository.js';
import { appendMovement } from './inventory.service.js';
import { assertSupplierUsable } from './supplier.service.js';
import type {
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  ReceivePurchaseOrderInput,
  UpdatePurchaseOrderInput,
} from './purchaseOrder.schemas.js';

/** The reference written onto every movement created by a receipt. */
const MOVEMENT_REFERENCE_TYPE = 'purchase_order';

/** Advisory-lock key for a purchase order, namespaced so it cannot collide. */
const purchaseOrderLockKey = (purchaseOrderId: string): string =>
  `purchase_order:${purchaseOrderId}`;

export interface PurchaseOrderPage {
  items: PurchaseOrder[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listBusinessPurchaseOrders(
  businessId: string,
  query: ListPurchaseOrdersQuery,
): Promise<PurchaseOrderPage> {
  const { items, total } = await listPurchaseOrders(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
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
}

/** An order in another business is simply not found. */
export async function getPurchaseOrder(
  businessId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderDetail> {
  const order = await findPurchaseOrderById(businessId, purchaseOrderId);
  if (!order) throw new NotFoundError('Purchase order not found.');
  return order;
}

// ---------------------------------------------------------------------------
// Creation â€” deliberately inventory-free
// ---------------------------------------------------------------------------

/**
 * Create a purchase order inside a caller-supplied transaction.
 *
 * ## Why this is split out
 *
 * The Action Center must write a purchase order **and** its audit row atomically:
 * if the audit insert fails, there must be no purchase order either. Nesting the
 * existing `createPurchaseOrder` would open a second transaction and a second
 * connection, which commits the order independently and defeats the guarantee.
 *
 * So the body lives here and is transaction-agnostic, and `createPurchaseOrder`
 * wraps it in `withTransaction` exactly as before. The Action Center calls this
 * variant with its own client.
 *
 * There is still only **one** implementation of order creation: the Action Center
 * reuses this function rather than writing a second one, so the validation rules
 * below apply identically no matter which door an order arrives through.
 *
 * Note the supplier check moved from before `BEGIN` to inside the transaction. It
 * is a read, so the result is identical, and now it is evaluated against the same
 * snapshot as the inserts it is protecting.
 */
export async function createPurchaseOrderIn(
  client: PoolClient,
  businessId: string,
  userId: string,
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderDetail> {
  // The supplier must exist in this business and be active.
  await assertSupplierUsable(businessId, input.supplierId, client);

  // One query validates every product's ownership and activity, and computes
  // each line total and the order total in exact `numeric`.
  const lines = await resolveOrderItems(client, businessId, input.items);

  // A line produced no row: the product does not exist, or it belongs to
  // another business. Both are reported identically.
  if (lines.length !== input.items.length) {
    throw new NotFoundError(
      'One or more products were not found in your business.',
      'PRODUCT_NOT_FOUND',
    );
  }

  const inactive = lines.find((line) => !line.isActive);
  if (inactive) {
    throw new ValidationError(
      `Cannot order "${inactive.productName}" because the product is inactive.`,
      'PRODUCT_INACTIVE',
    );
  }

  const orderId = await insertPurchaseOrder(client, {
    businessId,
    supplierId: input.supplierId,
    totalAmount: lines[0]!.orderTotal,
    expectedAt: input.expectedAt ?? null,
    notes: input.notes ?? null,
    createdBy: userId,
  });

  for (const line of lines) {
    await insertPurchaseOrderItem(client, {
      purchaseOrderId: orderId,
      businessId,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      lineTotal: line.lineTotal,
    });
  }

  // No inventory movement here. Receiving is what moves stock.
  const created = await findPurchaseOrderById(businessId, orderId, client);
  if (!created) throw new Error('Purchase order disappeared inside its own transaction');
  return created;
}

/**
 * Create a purchase order in its own transaction.
 *
 * The public entry point used by `POST /api/purchase-orders`.
 */
export async function createPurchaseOrder(
  businessId: string,
  userId: string,
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderDetail> {
  return withTransaction((client) => createPurchaseOrderIn(client, businessId, userId, input));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Place a draft order: `draft -> ordered`, stamping `ordered_at`.
 *
 * Touches no inventory.
 */
export async function placePurchaseOrder(
  businessId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderDetail> {
  return withTransaction(async (client) => {
    const order = await findOrderHeader(client, businessId, purchaseOrderId);
    if (!order) throw new NotFoundError('Purchase order not found.');

    if (order.status !== 'draft') {
      throw new ConflictError(
        `Only a draft purchase order can be placed. This one is ${order.status.replace(/_/g, ' ')}.`,
        'INVALID_TRANSITION',
      );
    }

    await updateOrderStatus(client, {
      businessId,
      purchaseOrderId,
      status: 'ordered',
      orderedAt: new Date(),
    });

    const updated = await findPurchaseOrderById(businessId, purchaseOrderId, client);
    if (!updated) throw new NotFoundError('Purchase order not found.');
    return updated;
  });
}

/**
 * Edit a draft order, or cancel a draft or placed one.
 *
 * `cancelled` and `received` are terminal; an order that has been placed can no
 * longer have its `expected_at` or notes changed, because the supplier already
 * has it. Changing the *lines* of a placed order is a real business operation
 * (a variation) and is not offered here; cancel and re-raise instead.
 */
export async function updatePurchaseOrder(
  businessId: string,
  purchaseOrderId: string,
  input: UpdatePurchaseOrderInput,
): Promise<PurchaseOrderDetail> {
  return withTransaction(async (client) => {
    const order = await findOrderHeader(client, businessId, purchaseOrderId);
    if (!order) throw new NotFoundError('Purchase order not found.');

    if (order.status === 'received' || order.status === 'cancelled') {
      throw new ConflictError(
        `A ${order.status.replace(/_/g, ' ')} purchase order cannot be changed.`,
        'INVALID_TRANSITION',
      );
    }

    if (input.status === 'cancelled') {
      await updateOrderStatus(client, {
        businessId,
        purchaseOrderId,
        status: 'cancelled',
      });
    } else if (order.status !== 'draft') {
      throw new ConflictError(
        'A placed purchase order can no longer be edited. Cancel it and raise a new one.',
        'INVALID_TRANSITION',
      );
    }

    // `total_amount` is unchanged: the lines were not touched, so the sum
    // computed at creation still holds.
    if (input.expectedAt !== undefined || input.notes !== undefined) {
      const detail = await findPurchaseOrderById(businessId, purchaseOrderId, client);
      if (!detail) throw new NotFoundError('Purchase order not found.');

      await updateDraftOrder(client, {
        businessId,
        purchaseOrderId,
        // The detail view exposes ISO strings; the repository takes a Date.
        expectedAt:
          input.expectedAt !== undefined
            ? input.expectedAt
            : (detail.expectedAt ? new Date(detail.expectedAt) : null),
        notes: input.notes !== undefined ? input.notes : detail.notes,
        totalAmount: detail.totalAmount,
      });
    }

    const updated = await findPurchaseOrderById(businessId, purchaseOrderId, client);
    if (!updated) throw new NotFoundError('Purchase order not found.');
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

/**
 * Receive goods against an order.
 *
 * Each `quantity` is a **newly received increment**, not a new total. A line can
 * never end up with more received than ordered: the arithmetic is done in exact
 * `numeric` by PostgreSQL.
 */
export async function receivePurchaseOrder(
  businessId: string,
  userId: string,
  purchaseOrderId: string,
  input: ReceivePurchaseOrderInput,
): Promise<PurchaseOrderDetail> {
  return withTransaction(async (client) => {
    // 1. Load the order for this business, before taking any lock.
    const order = await findOrderHeader(client, businessId, purchaseOrderId);
    if (!order) throw new NotFoundError('Purchase order not found.');

    if (!RECEIVABLE_STATUSES.includes(order.status)) {
      throw new ConflictError(
        order.status === 'cancelled'
          ? 'A cancelled purchase order cannot receive goods.'
          : 'This purchase order is already fully received.',
        'NOT_RECEIVABLE',
      );
    }

    // 2. Serialise receipts of *this* order. Two concurrent receipts would
    //    otherwise both read the same `received_quantity` and over-receive.
    await acquireAdvisoryLock(client, purchaseOrderLockKey(purchaseOrderId));

    // 3. Re-read the state now the lock is held.
    const current = await findOrderHeader(client, businessId, purchaseOrderId);
    if (!current) throw new NotFoundError('Purchase order not found.');
    if (!RECEIVABLE_STATUSES.includes(current.status)) {
      throw new ConflictError(
        'This purchase order can no longer receive goods.',
        'NOT_RECEIVABLE',
      );
    }

    const lines = await readOrderItemsForReceipt(client, purchaseOrderId, businessId);

    // 4. Every requested product must be on this order.
    const requested = new Map<string, { quantity: string }>();
    for (const item of input.items) {
      if (!lines.some((line) => line.productId === item.productId)) {
        throw new NotFoundError(
          'A requested product is not part of this purchase order.',
          'PRODUCT_NOT_ON_ORDER',
        );
      }
      const existing = requested.get(item.productId);
      // Aggregate repeats so the over-receive check sees the real total.
      requested.set(item.productId, {
        quantity: existing ? await addDecimals(client, existing.quantity, item.quantity) : item.quantity,
      });
    }

    // 5. Lock each product, in ascending id order, using the same mechanism the
    //    inventory service uses. Re-entrant, so `appendMovement` costs nothing.
    const productIds = [...requested.keys()].sort();
    for (const productId of productIds) {
      await acquireProductStockLock(client, businessId, productId);
    }

    // 6. Verify no line would exceed its ordered quantity. Computed in exact
    //    numeric, so a decimal like 0.1 cannot drift past the limit.
    const updatedReceived = new Map<string, string>();
    for (const productId of productIds) {
      const line = lines.find((candidate) => candidate.productId === productId)!;
      const increment = requested.get(productId)!.quantity;
      const projected = await addDecimals(client, line.receivedQuantity, increment);

      if (compareDecimals(projected, line.quantity) > 0) {
        const remaining = await subtractDecimals(client, line.quantity, line.receivedQuantity);
        throw new ConflictError(
          `Receiving ${increment} ${line.unit} of ${line.productName} would exceed the ` +
            `ordered quantity. Only ${remaining} ${line.unit} remain outstanding.`,
          'OVER_RECEIVE',
        );
      }

      updatedReceived.set(productId, projected);
    }

    // 7. Update the received quantities, then append the immutable `in` movements.
    for (const productId of productIds) {
      const line = lines.find((candidate) => candidate.productId === productId)!;
      const increment = requested.get(productId)!.quantity;

      await incrementReceivedQuantity(client, line.itemId, updatedReceived.get(productId)!);

      await appendMovement(client, {
        businessId,
        productId,
        productName: line.productName,
        productUnit: line.unit,
        movementType: 'in',
        quantity: increment,
        reason: 'Goods received',
        referenceType: MOVEMENT_REFERENCE_TYPE,
        referenceId: purchaseOrderId,
        createdBy: userId,
      });
    }

    // 8. Recompute the status from the lines as they now stand.
    const fullyReceived = lines.every(
      (line) => compareDecimals(updatedReceived.get(line.productId) ?? line.receivedQuantity, line.quantity) === 0,
    );
    const anyReceived = lines.some(
      (line) => compareDecimals(updatedReceived.get(line.productId) ?? line.receivedQuantity, line.receivedQuantity) > 0,
    );

    const nextStatus: PurchaseOrderStatus = fullyReceived
      ? 'received'
      : anyReceived
        ? 'partially_received'
        : 'ordered';

    if (fullyReceived) {
      await updateOrderStatus(client, {
        businessId,
        purchaseOrderId,
        status: 'received',
        receivedAt: new Date(),
      });
    } else {
      await updateOrderStatus(client, { businessId, purchaseOrderId, status: nextStatus });
    }

    const updated = await findPurchaseOrderById(businessId, purchaseOrderId, client);
    if (!updated) throw new NotFoundError('Purchase order not found.');
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Exact decimal helpers
// ---------------------------------------------------------------------------
//
// All quantity arithmetic is delegated to PostgreSQL rather than done in
// JavaScript. These run a handful of times per receipt at most.

async function addDecimals(
  client: PoolClient,
  a: string,
  b: string,
): Promise<string> {
  const result = await client.query<{ value: string }>(
    'SELECT ($1::numeric + $2::numeric) AS value',
    [a, b],
  );
  return result.rows[0]?.value ?? a;
}

async function subtractDecimals(
  client: PoolClient,
  a: string,
  b: string,
): Promise<string> {
  const result = await client.query<{ value: string }>(
    'SELECT ($1::numeric - $2::numeric) AS value',
    [a, b],
  );
  return result.rows[0]?.value ?? a;
}

/**
 * Compare two exact decimal strings without float arithmetic.
 *
 * Used only to decide `fullyReceived` / `anyReceived`, where the operands are
 * values PostgreSQL itself just produced. The hard limits are enforced in exact
 * `numeric` above; this is a final, unambiguous sign check.
 */
function compareDecimals(a: string, b: string): number {
  const left = BigInt(decimalToScaled(a));
  const right = BigInt(decimalToScaled(b));
  return left === right ? 0 : left > right ? 1 : -1;
}

/** Convert a two-decimal string like "-12.30" into a scaled BigInt of cents. */
function decimalToScaled(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`;
  return negative ? `-${scaled}` : scaled;
}

