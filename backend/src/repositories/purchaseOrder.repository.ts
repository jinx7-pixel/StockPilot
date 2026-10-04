/**
 * Purchase order persistence.
 *
 * A purchase order records **intent to buy**. It holds no stock: `total_amount`
 * and `line_total` are money, and `received_quantity` is how much has arrived —
 * never a cached balance. Stock changes only via the inventory ledger.
 *
 * **All money arithmetic is done by PostgreSQL** in exact `numeric`, and returned
 * as decimal strings. `remaining_quantity` is likewise computed in SQL so a
 * client never supplies it.
 *
 * `updated_at` is maintained by the `purchase_orders_set_updated_at` trigger.
 */

import type { Pool, PoolClient } from 'pg';

import { getPool, query } from '../db/pool.js';

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/**
 * Statuses a receipt may be applied to. A cancelled or fully-received order has
 * nothing left to receive, so both are refused before any work is done.
 */
export const RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  'ordered',
  'partially_received',
];

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  /** Exact decimal string, computed by the server. */
  totalAmount: string;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdBy: { id: string; name: string };
  itemCount: number;
  createdAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  /** Exact decimal strings. */
  quantity: string;
  receivedQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  items: PurchaseOrderItem[];
}

interface PurchaseOrderRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  total_amount: string;
  ordered_at: Date | null;
  expected_at: Date | null;
  received_at: Date | null;
  notes: string | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  item_count: string;
}

const ORDER_COLUMNS = `
  po.id, po.supplier_id, s.name AS supplier_name, po.status, po.total_amount,
  po.ordered_at, po.expected_at, po.received_at, po.notes,
  po.created_by, po.created_at,
  u.name AS created_by_name,
  (SELECT count(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS item_count
`;

function mapOrderRow(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    status: row.status,
    totalAmount: row.total_amount,
    orderedAt: row.ordered_at ? row.ordered_at.toISOString() : null,
    expectedAt: row.expected_at ? row.expected_at.toISOString() : null,
    receivedAt: row.received_at ? row.received_at.toISOString() : null,
    notes: row.notes,
    createdBy: { id: row.created_by, name: row.created_by_name },
    itemCount: Number(row.item_count),
    createdAt: row.created_at.toISOString(),
  };
}

/** Anything that can run a parameterised query: the pool, or a transaction client. */
type Querier = Pick<Pool, 'query'>;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface ResolvedOrderItem {
  position: number;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  isActive: boolean;
  quantity: string;
  unitCost: string;
  lineTotal: string;
  /** Exact decimal string: the order's grand total across all lines. */
  orderTotal: string;
}

/**
 * Validate and price every requested line in **one** query on the caller's
 * transaction connection.
 *
 * `line_total` is `quantity * unit_cost` and `order_total` is the sum of those,
 * both computed by PostgreSQL. Rows come back only for products that exist **and**
 * belong to this business, so a cross-tenant product yields no row and the caller
 * can report it as not found. `is_active` is returned rather than filtered, so an
 * inactive product is distinguishable from a foreign one.
 */
export async function resolveOrderItems(
  client: PoolClient,
  businessId: string,
  items: readonly { productId: string; quantity: string; unitCost: string }[],
): Promise<ResolvedOrderItem[]> {
  const result = await client.query<{
    position: string;
    product_id: string;
    product_name: string;
    sku: string;
    unit: string;
    is_active: boolean;
    quantity: string;
    unit_cost: string;
    line_total: string;
    order_total: string;
  }>(
    `WITH requested AS (
       SELECT product_id, quantity, unit_cost, position
         FROM unnest($2::uuid[], $3::numeric[], $4::numeric[], $5::int[]) WITH ORDINALITY
              AS t(product_id, quantity, unit_cost, position)
     )
     SELECT r.position,
            p.id             AS product_id,
            p.name           AS product_name,
            p.sku            AS sku,
            p.unit           AS unit,
            p.is_active,
            r.quantity,
            r.unit_cost,
            r.quantity * r.unit_cost AS line_total,
            (SELECT COALESCE(SUM(x.quantity * x.unit_cost), 0)
               FROM requested x
               JOIN products y
                 ON y.id = x.product_id AND y.business_id = $1) AS order_total
       FROM requested r
       JOIN products p
         ON p.id = r.product_id AND p.business_id = $1
     ORDER BY r.position`,
    [
      businessId,
      items.map((item) => item.productId),
      items.map((item) => item.quantity),
      items.map((item) => item.unitCost),
      items.map((_, index) => index + 1),
    ],
  );

  return result.rows.map((row) => ({
    position: Number(row.position),
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    unit: row.unit,
    isActive: row.is_active,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    lineTotal: row.line_total,
    orderTotal: row.order_total,
  }));
}

export async function insertPurchaseOrder(
  client: PoolClient,
  input: {
    businessId: string;
    supplierId: string;
    /** Exact decimal string from `resolveOrderItems`. */
    totalAmount: string;
    expectedAt: Date | null;
    notes: string | null;
    createdBy: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO purchase_orders
       (business_id, supplier_id, total_amount, expected_at, notes, created_by)
     VALUES ($1, $2, $3::numeric, $4, $5, $6)
     RETURNING id`,
    [
      input.businessId,
      input.supplierId,
      input.totalAmount,
      input.expectedAt,
      input.notes,
      input.createdBy,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create purchase order');
  return row.id;
}

export async function insertPurchaseOrderItem(
  client: PoolClient,
  input: {
    purchaseOrderId: string;
    businessId: string;
    productId: string;
    quantity: string;
    unitCost: string;
    lineTotal: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO purchase_order_items
       (purchase_order_id, business_id, product_id, quantity, unit_cost, line_total)
     VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric)`,
    [
      input.purchaseOrderId,
      input.businessId,
      input.productId,
      input.quantity,
      input.unitCost,
      input.lineTotal,
    ],
  );
}

/** Replace all lines of a draft order. Used only while editing a draft. */
export async function replaceOrderItems(
  client: PoolClient,
  purchaseOrderId: string,
  businessId: string,
  items: readonly {
    productId: string;
    quantity: string;
    unitCost: string;
    lineTotal: string;
  }[],
): Promise<void> {
  await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [
    purchaseOrderId,
  ]);

  for (const item of items) {
    await insertPurchaseOrderItem(client, {
      purchaseOrderId,
      businessId,
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      lineTotal: item.lineTotal,
    });
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function updateOrderStatus(
  client: PoolClient,
  input: {
    purchaseOrderId: string;
    businessId: string;
    status: PurchaseOrderStatus;
    orderedAt?: Date | null;
    receivedAt?: Date | null;
  },
): Promise<PurchaseOrderStatus | null> {
  const result = await client.query<{ status: PurchaseOrderStatus }>(
    `UPDATE purchase_orders
        SET status      = $3,
            ordered_at  = CASE WHEN $4::boolean THEN $5::timestamptz ELSE ordered_at END,
            received_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE received_at END
      WHERE business_id = $1 AND id = $2
      RETURNING status`,
    [
      input.businessId,
      input.purchaseOrderId,
      input.status,
      input.orderedAt !== undefined,
      input.orderedAt ?? null,
      input.receivedAt !== undefined,
      input.receivedAt ?? null,
    ],
  );

  return result.rows[0]?.status ?? null;
}

/** Update a draft order's editable fields. `total_amount` is server-computed. */
export async function updateDraftOrder(
  client: PoolClient,
  input: {
    businessId: string;
    purchaseOrderId: string;
    expectedAt: Date | null;
    notes: string | null;
    totalAmount: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE purchase_orders
        SET expected_at  = $3,
            notes        = $4,
            total_amount = $5::numeric
      WHERE business_id = $1 AND id = $2`,
    [input.businessId, input.purchaseOrderId, input.expectedAt, input.notes, input.totalAmount],
  );
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

export interface OrderItemForReceipt {
  itemId: string;
  productId: string;
  productName: string;
  unit: string;
  /** Exact decimal string. */
  quantity: string;
  receivedQuantity: string;
}

/**
 * Re-read a purchase order's lines **inside the caller's transaction**, after the
 * purchase-order lock has been taken.
 *
 * This is the read that decides whether a receipt would over-receive, so it must
 * observe everything a previous holder of the lock committed.
 */
export async function readOrderItemsForReceipt(
  client: PoolClient,
  purchaseOrderId: string,
  businessId: string,
): Promise<OrderItemForReceipt[]> {
  const result = await client.query<{
    id: string;
    product_id: string;
    product_name: string;
    unit: string;
    quantity: string;
    received_quantity: string;
  }>(
    `SELECT poi.id, poi.product_id, p.name AS product_name, p.unit,
            poi.quantity, poi.received_quantity
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1 AND poi.business_id = $2
      ORDER BY p.id`,
    [purchaseOrderId, businessId],
  );

  return result.rows.map((row) => ({
    itemId: row.id,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity: row.quantity,
    receivedQuantity: row.received_quantity,
  }));
}

/** Add to a line's received quantity. `updated_quantity` is pre-computed. */
export async function incrementReceivedQuantity(
  client: PoolClient,
  itemId: string,
  updatedQuantity: string,
): Promise<void> {
  await client.query(
    'UPDATE purchase_order_items SET received_quantity = $2::numeric WHERE id = $1',
    [itemId, updatedQuantity],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface ListPurchaseOrdersFilters {
  search?: string;
  supplierId?: string;
  status?: PurchaseOrderStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export async function listPurchaseOrders(
  businessId: string,
  filters: ListPurchaseOrdersFilters,
): Promise<{ items: PurchaseOrder[]; total: number }> {
  const conditions: string[] = ['po.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filters.search !== undefined) {
    params.push(`%${escapeLikePattern(filters.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(s.name ILIKE ${placeholder} ESCAPE '\\' OR po.notes ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filters.supplierId !== undefined) {
    params.push(filters.supplierId);
    conditions.push(`po.supplier_id = $${params.length}`);
  }

  if (filters.status !== undefined) {
    params.push(filters.status);
    conditions.push(`po.status = $${params.length}`);
  }

  if (filters.from !== undefined) {
    params.push(filters.from);
    conditions.push(`po.created_at >= $${params.length}`);
  }

  if (filters.to !== undefined) {
    params.push(filters.to);
    conditions.push(`po.created_at <= $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where}`,
    params,
  );

  const pageParams = [...params, filters.limit, filters.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  // Ordering is fixed server-side; there is no user-controllable ORDER BY.
  const result = await query<PurchaseOrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM purchase_orders po
       JOIN suppliers s  ON s.id = po.supplier_id
       JOIN users u      ON u.id = po.created_by
      WHERE ${where}
      ORDER BY po.created_at DESC, po.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return {
    items: result.rows.map(mapOrderRow),
    total: countResult.rows[0]?.count ?? 0,
  };
}

/**
 * One purchase order with its lines.
 *
 * `remaining_quantity` is computed as `quantity - received_quantity` in SQL, so
 * a client can never supply it.
 */
export async function findPurchaseOrderById(
  businessId: string,
  purchaseOrderId: string,
  querier: Querier = getPool(),
): Promise<PurchaseOrderDetail | null> {
  const result = await querier.query<PurchaseOrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN users u     ON u.id = po.created_by
      WHERE po.business_id = $1 AND po.id = $2`,
    [businessId, purchaseOrderId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const items = await querier.query<{
    id: string;
    product_id: string;
    sku: string;
    product_name: string;
    unit: string;
    quantity: string;
    received_quantity: string;
    remaining_quantity: string;
    unit_cost: string;
    line_total: string;
  }>(
    `SELECT poi.id, poi.product_id, p.sku, p.name AS product_name, p.unit,
            poi.quantity, poi.received_quantity,
            poi.quantity - poi.received_quantity AS remaining_quantity,
            poi.unit_cost, poi.line_total
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1 AND poi.business_id = $2
      ORDER BY p.name ASC, poi.id ASC`,
    [purchaseOrderId, businessId],
  );

  return {
    ...mapOrderRow(row),
    items: items.rows.map((item) => ({
      id: item.id,
      productId: item.product_id,
      sku: item.sku,
      productName: item.product_name,
      unit: item.unit,
      quantity: item.quantity,
      receivedQuantity: item.received_quantity,
      remainingQuantity: item.remaining_quantity,
      unitCost: item.unit_cost,
      lineTotal: item.line_total,
    })),
  };
}

/** Minimal order header, for existence and status checks inside a transaction. */
export async function findOrderHeader(
  client: PoolClient,
  businessId: string,
  purchaseOrderId: string,
): Promise<{ id: string; status: PurchaseOrderStatus; supplierId: string } | null> {
  const result = await client.query<{
    id: string;
    status: PurchaseOrderStatus;
    supplier_id: string;
  }>(
    `SELECT id, status, supplier_id
       FROM purchase_orders
      WHERE business_id = $1 AND id = $2`,
    [businessId, purchaseOrderId],
  );

  const row = result.rows[0];
  return row ? { id: row.id, status: row.status, supplierId: row.supplier_id } : null;
}
