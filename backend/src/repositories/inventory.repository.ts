/**
 * Inventory persistence — the stock ledger.
 *
 * The ledger is the single source of truth for stock: there is no cached
 * quantity column anywhere, and every balance is summed from movements.
 *
 * **All quantity arithmetic happens in PostgreSQL.** `numeric` sums, signed
 * deltas and the non-negative check are evaluated by the database, so no
 * floating-point rounding is involved. JavaScript only ever *converts* the
 * returned decimal string for display, and `NUMERIC(12,2)`'s range sits far
 * inside the safe-integer limit.
 *
 * Concurrency: `recordMovement` takes a transaction-scoped advisory lock keyed
 * on `(business_id, product_id)` before reading the balance, which serialises
 * concurrent movements for one product while leaving other products free to
 * proceed in parallel. See `services/inventory.service.ts` for the full
 * reasoning.
 */

import type { PoolClient } from 'pg';

import { query } from '../db/pool.js';

export const MOVEMENT_TYPES = ['in', 'out', 'adjustment'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Stock-status filter values. `no_movements` is distinct from a zero balance. */
export const STOCK_STATUSES = ['in_stock', 'out_of_stock', 'no_movements'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * The signed contribution of a movement to the balance.
 *
 * `adjustment` deliberately needs no branch: it carries its own sign, so a
 * positive adjustment adds and a negative one subtracts.
 *
 * **Exported so analytics reuses this exact expression.** Stock has one
 * definition in this codebase; a second, subtly different one would eventually
 * make a dashboard disagree with the ledger.
 */
export const BALANCE_EXPRESSION = `CASE im.movement_type WHEN 'out' THEN -im.quantity ELSE im.quantity END`;

/** Same expression for aggregate queries that do not use the `im` alias. */
export const BALANCE_EXPRESSION_PLAIN = `CASE movement_type WHEN 'out' THEN -quantity ELSE quantity END`;

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/**
 * Serialise movement writes for one `(business, product)` pair.
 *
 * `pg_advisory_xact_lock` is scoped to the transaction, so it releases
 * automatically on commit or rollback — no leak path if a transaction dies.
 *
 * The key is a 64-bit hash of the composite id, which gives a wide key space
 * (a collision would merely over-serialise two unrelated products for the
 * duration of one transaction — never a correctness problem).
 */
export async function acquireProductStockLock(
  client: PoolClient,
  businessId: string,
  productId: string,
): Promise<void> {
  await acquireAdvisoryLock(client, `${businessId}:${productId}`);
}

/**
 * The single advisory-lock primitive used across the codebase.
 *
 * `pg_advisory_xact_lock` is transaction-scoped and re-entrant within a session,
 * so it releases automatically on commit *or* rollback, and taking it twice on the
 * same key costs nothing.
 *
 * Callers lock a **specific resource** by its key, never a global lock. Products
 * are locked per `(business_id, product_id)`; purchase orders lock their own id
 * and then each product they touch, in ascending order, so two overlapping
 * receipts serialise on the products they share without deadlocking and without
 * blocking unrelated work.
 */
export async function acquireAdvisoryLock(client: PoolClient, key: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [key],
  );
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * Stock for one product.
 *
 * Inside a movement transaction use {@link readBalanceWithProjection} instead —
 * it needs the caller's client so it can be read under the advisory lock.
 */
export async function getCurrentStock(
  businessId: string,
  productId: string,
): Promise<number> {
  const result = await query<{ stock: string }>(
    `SELECT COALESCE(SUM(${BALANCE_EXPRESSION_PLAIN}), 0) AS stock
       FROM inventory_movements
      WHERE business_id = $1 AND product_id = $2`,
    [businessId, productId],
  );

  return Number(result.rows[0]?.stock ?? 0);
}

/**
 * Balances for many products in **one** query.
 *
 * Callers listing products must use this rather than awaiting
 * `getCurrentStock` per row, which would be an N+1.
 */
export async function getCurrentStockForProducts(
  businessId: string,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();

  if (productIds.length === 0) return balances;

  const result = await query<{ product_id: string; stock: string }>(
    `SELECT product_id,
            COALESCE(SUM(${BALANCE_EXPRESSION_PLAIN}), 0) AS stock
       FROM inventory_movements
      WHERE business_id = $1 AND product_id = ANY($2::uuid[])
      GROUP BY product_id`,
    [businessId, productIds],
  );

  for (const row of result.rows) {
    balances.set(row.product_id, Number(row.stock));
  }

  return balances;
}

/**
 * Read the balance and the balance *after* the proposed movement, in one
 * statement, so the arithmetic happens in exact `numeric` rather than in
 * JavaScript.
 *
 * Returning `projected_stock` lets the caller reject a negative outcome without
 * doing any float math of its own.
 */
export async function readBalanceWithProjection(
  client: PoolClient,
  input: {
    businessId: string;
    productId: string;
    movementType: MovementType;
    quantity: string;
  },
): Promise<{ current: number; projected: number; movementCount: number }> {
  const result = await client.query<{
    current_stock: string;
    projected_stock: string;
    movement_count: string;
  }>(
    `SELECT
       COALESCE(SUM(${BALANCE_EXPRESSION_PLAIN}), 0) AS current_stock,
       COALESCE(SUM(${BALANCE_EXPRESSION_PLAIN}), 0)
         + CASE WHEN $3 = 'out' THEN -$4::numeric ELSE $4::numeric END AS projected_stock,
       COUNT(*) AS movement_count
     FROM inventory_movements
     WHERE business_id = $1 AND product_id = $2`,
    [input.businessId, input.productId, input.movementType, input.quantity],
  );

  const row = result.rows[0];

  return {
    current: Number(row?.current_stock ?? 0),
    projected: Number(row?.projected_stock ?? 0),
    movementCount: Number(row?.movement_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Product listing with balances
// ---------------------------------------------------------------------------

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  isActive: boolean;
  /** Derived from the ledger. Never stored. */
  currentStock: number;
}

interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string;
  is_active: boolean;
  stock: string;
  movement_count: string;
}

function mapInventoryRow(row: InventoryRow): InventoryItem {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    unit: row.unit,
    isActive: row.is_active,
    currentStock: Number(row.stock),
  };
}

export interface ListInventoryFilters {
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  stockStatus?: StockStatus;
  limit: number;
  offset: number;
}

/**
 * Escape a user-supplied search term for `LIKE`.
 *
 * Without this a `%` or `_` from the client would act as a wildcard and let
 * someone scan the whole catalog with `%`.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Products with their current stock, paginated.
 *
 * The balance is computed by a `LATERAL` sub-select scoped to the page, so it
 * is one round trip and only touches the movements of the products actually
 * returned. A `LEFT JOIN` against a tenant-wide aggregate would be a single
 * scan but would read every movement the business has ever recorded.
 */
export async function listInventory(
  businessId: string,
  filters: ListInventoryFilters,
): Promise<{ items: InventoryItem[]; total: number }> {
  const conditions: string[] = ['p.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filters.search !== undefined) {
    params.push(`%${escapeLikePattern(filters.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(p.name ILIKE ${placeholder} ESCAPE '\\' OR p.sku ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filters.categoryId !== undefined) {
    params.push(filters.categoryId);
    conditions.push(`p.category_id = $${params.length}`);
  }

  if (filters.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`p.is_active = $${params.length}`);
  }

  // The stock filter is applied *outside* the sub-select, because it depends on
  // the aggregated balance rather than on any product column.
  const stockCondition = buildStockCondition(filters.stockStatus);

  const pageParams = [...params, filters.limit, filters.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<InventoryRow>(
    `SELECT * FROM (
       SELECT p.id, p.sku, p.name, p.category_id, p.unit, p.is_active,
              c.name AS category_name,
              mv.stock, mv.movement_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(${BALANCE_EXPRESSION}), 0) AS stock,
                  COUNT(*) AS movement_count
             FROM inventory_movements im
            WHERE im.business_id = p.business_id AND im.product_id = p.id
         ) mv ON true
        WHERE ${conditions.join(' AND ')}
     ) t
     ${stockCondition}
     ORDER BY lower(t.name) ASC, t.id ASC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM (
         SELECT p.id, mv.stock, mv.movement_count
           FROM products p
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(${BALANCE_EXPRESSION}), 0) AS stock,
                    COUNT(*) AS movement_count
               FROM inventory_movements im
              WHERE im.business_id = p.business_id AND im.product_id = p.id
           ) mv ON true
          WHERE ${conditions.join(' AND ')}
       ) t
       ${stockCondition}`,
    params,
  );

  return {
    items: result.rows.map(mapInventoryRow),
    total: countResult.rows[0]?.count ?? 0,
  };
}

function buildStockCondition(status: StockStatus | undefined): string {
  switch (status) {
    case undefined:
      return '';
    case 'in_stock':
      return 'WHERE t.stock > 0';
    case 'out_of_stock':
      return 'WHERE t.stock <= 0';
    case 'no_movements':
      // Deliberately distinct from a zero balance: the product has no ledger
      // entries at all, as opposed to entries that net to zero.
      return 'WHERE t.movement_count = 0';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Movement history
// ---------------------------------------------------------------------------

export interface Movement {
  id: string;
  movementType: MovementType;
  /** Always positive for `in`/`out`; may be either sign for `adjustment`. */
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

interface MovementRow {
  id: string;
  movement_type: MovementType;
  quantity: string;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.movement_type, m.quantity, m.reason,
         m.reference_type, m.reference_id,
         m.created_by, u.name AS created_by_name, m.created_at
    FROM inventory_movements m
    JOIN users u ON u.id = m.created_by
`;

function mapMovementRow(row: MovementRow): Movement {
  return {
    id: row.id,
    movementType: row.movement_type,
    quantity: Number(row.quantity),
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    createdBy: { id: row.created_by, name: row.created_by_name },
    createdAt: row.created_at.toISOString(),
  };
}

export async function listMovements(
  businessId: string,
  productId: string,
  page: { limit: number; offset: number },
  movementType?: MovementType,
): Promise<{ items: Movement[]; total: number }> {
  const typeCondition = movementType ? 'AND m.movement_type = $3' : '';
  const params: unknown[] = [businessId, productId, ...(movementType ? [movementType] : [])];

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM inventory_movements m
      WHERE m.business_id = $1 AND m.product_id = $2 ${typeCondition}`,
    params,
  );

  const pageParams = [...params, page.limit, page.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<MovementRow>(
    `${MOVEMENT_SELECT}
      WHERE m.business_id = $1 AND m.product_id = $2 ${typeCondition}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return {
    items: result.rows.map(mapMovementRow),
    total: countResult.rows[0]?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Insert one immutable movement.
 *
 * Must be called on the caller's transaction, after the advisory lock has been
 * taken and the projected balance verified.
 */
export async function insertMovement(
  client: PoolClient,
  input: {
    businessId: string;
    productId: string;
    movementType: MovementType;
    /** Normalised to two decimals by the validation layer. */
    quantity: string;
    reason: string | null;
    referenceType: string | null;
    referenceId: string | null;
    createdBy: string;
  },
): Promise<Movement> {
  const result = await client.query<MovementRow>(
    `WITH inserted AS (
       INSERT INTO inventory_movements
         (business_id, product_id, movement_type, quantity,
          reason, reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, movement_type, quantity, reason, reference_type,
                 reference_id, created_by, created_at
     )
     SELECT i.id, i.movement_type, i.quantity, i.reason,
            i.reference_type, i.reference_id, i.created_by,
            u.name AS created_by_name, i.created_at
       FROM inserted i
       JOIN users u ON u.id = i.created_by`,
    [
      input.businessId,
      input.productId,
      input.movementType,
      input.quantity,
      input.reason,
      input.referenceType,
      input.referenceId,
      input.createdBy,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to record inventory movement');
  return mapMovementRow(row);
}

// ---------------------------------------------------------------------------
// Per-product statistics
// ---------------------------------------------------------------------------

export interface ProductInventoryStats {
  currentStock: number;
  movementCount: number;
  lastMovementAt: string | null;
  /** Absolute totals per type, for the detail summary. */
  totals: { in: number; out: number; adjustment: number };
}

/**
 * Balance, per-type totals, entry count and last entry for one product, in a
 * single statement. `FILTER` keeps each type's absolute total independent of the
 * sign convention used for the balance.
 */
export async function getProductInventoryStats(
  businessId: string,
  productId: string,
): Promise<ProductInventoryStats> {
  const result = await query<{
    current_stock: string;
    total_in: string;
    total_out: string;
    total_adjustment: string;
    movement_count: string;
    last_movement_at: Date | null;
  }>(
    `SELECT
       COALESCE(SUM(${BALANCE_EXPRESSION_PLAIN}), 0) AS current_stock,
       COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'in'), 0)         AS total_in,
       COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'out'), 0)        AS total_out,
       COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'adjustment'), 0) AS total_adjustment,
       COUNT(*) AS movement_count,
       MAX(created_at) AS last_movement_at
     FROM inventory_movements
     WHERE business_id = $1 AND product_id = $2`,
    [businessId, productId],
  );

  const row = result.rows[0];

  return {
    currentStock: Number(row?.current_stock ?? 0),
    movementCount: Number(row?.movement_count ?? 0),
    lastMovementAt: row?.last_movement_at ? row.last_movement_at.toISOString() : null,
    totals: {
      in: Number(row?.total_in ?? 0),
      out: Number(row?.total_out ?? 0),
      adjustment: Number(row?.total_adjustment ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface InventorySummary {
  productCount: number;
  /** Products with at least one ledger entry. */
  productsWithMovements: number;
  outOfStockCount: number;
  totalMovementCount: number;
  lastMovementAt: string | null;
}

export async function getInventorySummary(businessId: string): Promise<InventorySummary> {
  const result = await query<{
    product_count: string;
    products_with_movements: string;
    out_of_stock_count: string;
    movement_count: string;
    last_movement_at: Date | null;
  }>(
    `SELECT
       (SELECT count(*) FROM products WHERE business_id = $1 AND is_active) AS product_count,
       (SELECT count(DISTINCT product_id) FROM inventory_movements WHERE business_id = $1) AS products_with_movements,
       (SELECT count(*) FROM products p
          WHERE p.business_id = $1 AND p.is_active
            AND COALESCE((SELECT SUM(${BALANCE_EXPRESSION})
                            FROM inventory_movements im
                           WHERE im.business_id = p.business_id AND im.product_id = p.id), 0) <= 0) AS out_of_stock_count,
       (SELECT count(*) FROM inventory_movements WHERE business_id = $1) AS movement_count,
       (SELECT max(created_at) FROM inventory_movements WHERE business_id = $1) AS last_movement_at`,
    [businessId],
  );

  const row = result.rows[0];

  return {
    productCount: Number(row?.product_count ?? 0),
    productsWithMovements: Number(row?.products_with_movements ?? 0),
    outOfStockCount: Number(row?.out_of_stock_count ?? 0),
    totalMovementCount: Number(row?.movement_count ?? 0),
    lastMovementAt: row?.last_movement_at ? row.last_movement_at.toISOString() : null,
  };
}
