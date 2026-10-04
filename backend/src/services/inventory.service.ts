/**
 * Inventory business rules.
 *
 * ## Concurrency strategy
 *
 * Two users issuing `out` at the same time must not both succeed when their
 * combined quantity exceeds the balance. A plain "read balance, then insert"
 * is a time-of-check / time-of-use race: both transactions can read the same
 * balance and both commit.
 *
 * The fix is a **transaction-scoped advisory lock keyed on
 * `(business_id, product_id)`**, taken as the *first* statement of the
 * transaction:
 *
 * 1. `BEGIN`
 * 2. `pg_advisory_xact_lock(hashtextextended(business_id || ':' || product_id, 0))`
 * 3. verify the product belongs to the business
 * 4. read `current_stock` **and** `projected_stock` in one statement
 * 5. reject with `409` if `projected_stock < 0`
 * 6. insert the immutable movement
 * 7. `COMMIT`
 *
 * Why this is sufficient, and why `SERIALIZABLE` is not needed:
 *
 *  - The lock gives **mutual exclusion per product**. Two movements for the
 *    same product are serialised; movements for *different* products never block
 *    each other, so throughput is not globally serialised.
 *  - `pg_advisory_xact_lock` is released automatically at commit **or** rollback,
 *    so an aborted transaction cannot leak a lock.
 *  - Under the default `READ COMMITTED` isolation, each *statement* takes a fresh
 *    snapshot. The lock (step 2) is a separate statement from the balance read
 *    (step 4), so the read necessarily observes every movement the previous lock
 *    holder committed. That ordering is what makes the check sound.
 *  - A hash collision between two different products would merely over-serialise
 *    them for the length of one transaction. It can never permit a double-spend.
 *
 * All quantity arithmetic — the sum, the signed delta and the negative check —
 * is performed by PostgreSQL in exact `numeric`. JavaScript never adds stock
 * quantities together.
 */

import type { PoolClient } from 'pg';

import { withTransaction } from '../db/pool.js';
import { ConflictError, NotFoundError } from '../errors.js';
import {
  acquireProductStockLock,
  getCurrentStock,
  getCurrentStockForProducts,
  getInventorySummary,
  getProductInventoryStats,
  insertMovement,
  listInventory,
  listMovements,
  readBalanceWithProjection,
  type InventoryItem,
  type InventorySummary,
  type Movement,
  type MovementType,
} from '../repositories/inventory.repository.js';
import { findProductById, type ProductWithCategory } from '../repositories/product.repository.js';
import type {
  CreateMovementInput,
  ListInventoryQuery,
  ListMovementsQuery,
} from './inventory.schemas.js';

export interface InventoryPage extends InventoryItem {
  category: { id: string; name: string } | null;
}

export interface ProductInventory {
  product: ProductWithCategory;
  currentStock: number;
  movementCount: number;
  lastMovementAt: string | null;
  /** Net change per movement type, useful for a detail summary. */
  totals: { in: number; out: number; adjustment: number };
}

export async function listBusinessInventory(
  businessId: string,
  query: ListInventoryQuery,
): Promise<{ items: InventoryPage[]; page: number; limit: number; total: number; totalPages: number }> {
  const { items, total } = await listInventory(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.stockStatus !== undefined ? { stockStatus: query.stockStatus } : {}),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  // The listing already carries each product's stock, so no second query and no
  // N+1 — the LATERAL sub-select in the repository did the work in one round trip.
  return {
    items: items.map((item) => ({
      ...item,
      category:
        item.categoryId && item.categoryName
          ? { id: item.categoryId, name: item.categoryName }
          : null,
    })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * Stock and movement totals for one product.
 *
 * A product in another business is reported as not found, never forbidden.
 */
export async function getProductInventory(
  businessId: string,
  productId: string,
): Promise<ProductInventory> {
  // A product in another business is reported as not found, never forbidden.
  const product = await findProductById(businessId, productId);
  if (!product) throw new NotFoundError('Product not found.');

  // One statement supplies the balance, the per-type totals and the last entry.
  const stats = await getProductInventoryStats(businessId, productId);

  return {
    product,
    currentStock: stats.currentStock,
    movementCount: stats.movementCount,
    lastMovementAt: stats.lastMovementAt,
    totals: stats.totals,
  };
}

export async function listProductMovements(
  businessId: string,
  productId: string,
  query: ListMovementsQuery,
): Promise<{ items: Movement[]; page: number; limit: number; total: number; totalPages: number }> {
  // Confirms the product exists in this tenant, so a foreign product 404s here
  // rather than returning an empty ledger that implies "no history".
  const product = await findProductById(businessId, productId);
  if (!product) throw new NotFoundError('Product not found.');

  const { items, total } = await listMovements(
    businessId,
    productId,
    { limit: query.limit, offset: (query.page - 1) * query.limit },
    query.movementType,
  );

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getBusinessInventorySummary(
  businessId: string,
): Promise<InventorySummary> {
  return getInventorySummary(businessId);
}

/**
 * Append one immutable movement to a **caller-supplied** transaction.
 *
 * This is the single place a movement is ever written, and it is deliberately
 * exported so that another module writing to the ledger — currently Sales, which
 * creates one `out` movement per sale line — uses the *same* lock, the same
 * balance read and the same non-negative check as the direct API. There is one
 * stock system, not two.
 *
 * Contract for the caller:
 *  - pass a `client` whose transaction already resolved the product, and
 *  - ideally take the product's locks in a deterministic order beforehand (see
 *    `acquireProductStockLock`, which is re-entrant within a session).
 *
 * Re-acquiring the lock here is harmless: `pg_advisory_xact_lock` is re-entrant
 * for the same session and is released automatically on commit or rollback.
 */
export async function appendMovement(
  client: PoolClient,
  input: {
    businessId: string;
    productId: string;
    /** Used only to build a helpful error message. */
    productName: string;
    productUnit: string;
    movementType: MovementType;
    /** Normalised to two decimals by the validation layer. */
    quantity: string;
    reason: string | null;
    referenceType: string | null;
    referenceId: string | null;
    createdBy: string;
  },
): Promise<{ movement: Movement; currentStock: number }> {
  // 1. Serialise movement writes for this product.
  await acquireProductStockLock(client, input.businessId, input.productId);

  // 2. Balance and projected balance, computed in exact numeric by PostgreSQL.
  const { projected, current } = await readBalanceWithProjection(client, {
    businessId: input.businessId,
    productId: input.productId,
    movementType: input.movementType,
    quantity: input.quantity,
  });

  // 3. Stock may never go negative, for any movement type.
  if (projected < 0) {
    throw new ConflictError(
      `This would leave ${input.productName} with ${formatQuantity(projected)} ` +
        `${input.productUnit}. Only ${formatQuantity(current)} ${input.productUnit} available.`,
      'INSUFFICIENT_STOCK',
    );
  }

  // 4. Append the immutable movement.
  const movement = await insertMovement(client, {
    businessId: input.businessId,
    productId: input.productId,
    movementType: input.movementType,
    quantity: input.quantity,
    reason: input.reason,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    createdBy: input.createdBy,
  });

  return { movement, currentStock: projected };
}

/**
 * Record one immutable movement.
 *
 * Atomic: any failure rolls the whole thing back, so a rejected `out` never
 * leaves a partial ledger entry. See the file header for the locking strategy.
 */
export async function recordMovement(
  businessId: string,
  userId: string,
  input: CreateMovementInput,
): Promise<{ movement: Movement; currentStock: number }> {
  return withTransaction(async (client) => {
    // The product must exist in *this* business. A foreign product 404s, so
    // nothing about another tenant is confirmed. Resolved before appending
    // because `appendMovement` needs its name and unit for the error message.
    const product = await findProductById(businessId, input.productId);
    if (!product) throw new NotFoundError('Product not found.');

    return appendMovement(client, {
      businessId,
      productId: input.productId,
      productName: product.name,
      productUnit: product.unit,
      movementType: input.movementType as MovementType,
      quantity: input.quantity,
      reason: input.reason ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      createdBy: userId,
    });
  });
}

/** Format a quantity for an error message, trimming a meaningless `.00`. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export { getCurrentStock, getCurrentStockForProducts };
