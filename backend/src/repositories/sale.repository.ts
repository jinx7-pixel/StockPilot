/**
 * Sales persistence.
 *
 * Sales own **no stock**. They are a record of a completed transaction, and
 * stock moves only because `services/sales.service.ts` appends `out` movements
 * to the existing inventory ledger inside the same transaction.
 *
 * **All money arithmetic happens in PostgreSQL.** `line_total` is
 * `quantity * unit_price` and `total_amount` is the sum of the line totals, both
 * computed by SQL and returned as exact decimal *strings*. Nothing is
 * multiplied or added in JavaScript.
 */

import type { Pool, PoolClient } from 'pg';

import { getPool, query } from '../db/pool.js';

export const SALE_STATUSES = ['completed'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export interface Sale {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  /** Exact decimal string, as PostgreSQL computed it. */
  totalAmount: string;
  status: SaleStatus;
  soldAt: string;
  createdBy: { id: string; name: string };
  itemCount: number;
}

export interface SaleItem {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  /** Exact decimal string. */
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface SaleDetail extends Sale {
  items: SaleItem[];
}

interface SaleRow {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_amount: string;
  status: SaleStatus;
  sold_at: Date;
  created_by: string;
  created_by_name: string;
  item_count: string;
}

const SALE_COLUMNS = `
  s.id, s.customer_name, s.customer_phone, s.total_amount, s.status, s.sold_at,
  s.created_by, u.name AS created_by_name,
  (SELECT count(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
`;

function mapSaleRow(row: SaleRow): Sale {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    // Kept as a string: the value is a computed NUMERIC, and passing it back
    // into SQL must be exact. The frontend formats it for display.
    totalAmount: row.total_amount,
    status: row.status,
    soldAt: row.sold_at.toISOString(),
    createdBy: { id: row.created_by, name: row.created_by_name },
    itemCount: Number(row.item_count),
  };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ResolvedSaleItem {
  /** 1-based position in the submitted `items` array. */
  position: number;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  isActive: boolean;
  /** Exact decimal string: this line's requested quantity. */
  quantity: string;
  /** Exact decimal string from `numeric(12,2)`. */
  unitPrice: string;
  /** Exact decimal string: this line's `quantity * unit_price`. */
  lineTotal: string;
  /**
   * Exact decimal string: the summed quantity of every line for this product.
   * A duplicated product is checked and moved once, for the total.
   */
  productQuantity: string;
  /** Exact decimal string: the sale's grand total across all lines. */
  saleTotal: string;
}

/**
 * Resolve every submitted line against one business — snapshotting the selling
 * price and computing every line total and the sale total — in **one** query on
 * the caller's transaction connection.
 *
 * All of the money arithmetic is done by PostgreSQL in `numeric` and returned as
 * strings. Nothing is multiplied or summed in JavaScript.
 *
 * Lines are returned in submission order, with `productQuantity` carrying the
 * per-product total so a product listed twice is still checked and moved only
 * once.
 *
 * Rows are produced only for products that exist **and** belong to this
 * business, so a cross-tenant product simply yields no row and the caller can
 * report it as not found. `is_active` is returned rather than filtered, so an
 * inactive product is distinguishable from a foreign one.
 */
export async function resolveSaleItems(
  client: PoolClient,
  businessId: string,
  items: readonly { productId: string; quantity: string }[],
): Promise<ResolvedSaleItem[]> {
  const productIds = items.map((item) => item.productId);
  const quantities = items.map((item) => item.quantity);

  const result = await client.query<{
    position: string;
    product_id: string;
    product_name: string;
    sku: string;
    unit: string;
    is_active: boolean;
    quantity: string;
    unit_price: string;
    line_total: string;
    product_quantity: string;
    sale_total: string;
  }>(
    `WITH requested AS (
       SELECT product_id, quantity, position
         FROM unnest($2::uuid[], $3::numeric[], $4::int[]) WITH ORDINALITY
              AS t(product_id, quantity, position)
     ),
     aggregated AS (
       SELECT product_id, SUM(quantity) AS product_quantity
         FROM requested
        GROUP BY product_id
     )
     SELECT r.position,
            p.id            AS product_id,
            p.name          AS product_name,
            p.sku           AS sku,
            p.unit          AS unit,
            p.is_active,
            p.selling_price AS unit_price,
            r.quantity                       AS quantity,
            r.quantity * p.selling_price    AS line_total,
            a.product_quantity,
            (SELECT COALESCE(SUM(x.quantity * y.selling_price), 0)
               FROM requested x
               JOIN products y
                 ON y.id = x.product_id AND y.business_id = $1) AS sale_total
       FROM requested r
       JOIN aggregated a  ON a.product_id = r.product_id
       JOIN products p
         ON p.id = r.product_id AND p.business_id = $1
     ORDER BY r.position`,
    [businessId, productIds, quantities, items.map((_, index) => index + 1)],
  );

  return result.rows.map((row) => ({
    position: Number(row.position),
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    unit: row.unit,
    isActive: row.is_active,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    productQuantity: row.product_quantity,
    saleTotal: row.sale_total,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Insert the sale header. Total comes from the pricing query, not from JS. */
export async function insertSale(
  client: PoolClient,
  input: {
    businessId: string;
    customerName: string | null;
    customerPhone: string | null;
    /** Exact decimal string from `resolveSaleLines`. */
    totalAmount: string;
    soldAt: Date;
    createdBy: string;
  },
): Promise<{ id: string; totalAmount: string; soldAt: Date }> {
  const result = await client.query<{ id: string; total_amount: string; sold_at: Date }>(
    `INSERT INTO sales
       (business_id, customer_name, customer_phone, total_amount, sold_at, created_by)
     VALUES ($1, $2, $3, $4::numeric, $5, $6)
     RETURNING id, total_amount, sold_at`,
    [
      input.businessId,
      input.customerName,
      input.customerPhone,
      input.totalAmount,
      input.soldAt,
      input.createdBy,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create sale');
  return { id: row.id, totalAmount: row.total_amount, soldAt: row.sold_at };
}

/** Insert one sale line. `unit_price` and `line_total` are pre-computed strings. */
export async function insertSaleItem(
  client: PoolClient,
  input: {
    saleId: string;
    businessId: string;
    productId: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sale_items
       (sale_id, business_id, product_id, quantity, unit_price, line_total)
     VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric)`,
    [
      input.saleId,
      input.businessId,
      input.productId,
      input.quantity,
      input.unitPrice,
      input.lineTotal,
    ],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListSalesFilters {
  search?: string;
  status?: SaleStatus;
  /** Inclusive lower bound on `sold_at`. */
  from?: Date;
  /** Inclusive upper bound on `sold_at`. */
  to?: Date;
  limit: number;
  offset: number;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * List sales for one business.
 *
 * Ordering is fixed server-side (`sold_at DESC`, then `id` for determinism).
 * There is deliberately no user-controllable `ORDER BY`: the value cannot be
 * parameterised, so accepting one would invite SQL injection.
 */
export async function listSales(
  businessId: string,
  filters: ListSalesFilters,
): Promise<{ items: Sale[]; total: number }> {
  const conditions: string[] = ['s.business_id = $1'];
  const params: unknown[] = [businessId];

  if (filters.search !== undefined) {
    params.push(`%${escapeLikePattern(filters.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(s.customer_name ILIKE ${placeholder} ESCAPE '\\' ` +
        `OR s.customer_phone ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filters.status !== undefined) {
    params.push(filters.status);
    conditions.push(`s.status = $${params.length}`);
  }

  if (filters.from !== undefined) {
    params.push(filters.from);
    conditions.push(`s.sold_at >= $${params.length}`);
  }

  if (filters.to !== undefined) {
    params.push(filters.to);
    conditions.push(`s.sold_at <= $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM sales s WHERE ${where}`,
    params,
  );

  const pageParams = [...params, filters.limit, filters.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const result = await query<SaleRow>(
    `SELECT ${SALE_COLUMNS}
       FROM sales s
       JOIN users u ON u.id = s.created_by
      WHERE ${where}
      ORDER BY s.sold_at DESC, s.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return {
    items: result.rows.map(mapSaleRow),
    total: countResult.rows[0]?.count ?? 0,
  };
}

/**
 * Anything that can run a parameterised query: the shared pool, or a client
 * inside a caller's transaction. `Pool` and `PoolClient` share the same
 * `query` signature, so either satisfies this.
 */
type Querier = Pick<Pool, 'query'>;

/**
 * One sale with its lines. A sale in another business is simply not found.
 *
 * Pass the transaction's own client when reading a row this transaction just
 * wrote: the pool cannot see uncommitted data.
 */
export async function findSaleById(
  businessId: string,
  saleId: string,
  querier: Querier = getPool(),
): Promise<SaleDetail | null> {
  const result = await querier.query<SaleRow>(
    `SELECT ${SALE_COLUMNS}
       FROM sales s
       JOIN users u ON u.id = s.created_by
      WHERE s.business_id = $1 AND s.id = $2`,
    [businessId, saleId],
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
    unit_price: string;
    line_total: string;
  }>(
    `SELECT si.id, si.product_id, p.sku, p.name AS product_name, p.unit,
            si.quantity, si.unit_price, si.line_total
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1 AND si.business_id = $2
      ORDER BY p.name ASC, si.id ASC`,
    [saleId, businessId],
  );

  return {
    ...mapSaleRow(row),
    items: items.rows.map((item) => ({
      id: item.id,
      productId: item.product_id,
      sku: item.sku,
      productName: item.product_name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    })),
  };
}
