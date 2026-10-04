/**
 * Product persistence.
 *
 * Products are **catalog definitions only** — no stock quantity, available
 * quantity, reorder point, risk, demand or recommendation lives here. Those
 * belong to the future inventory and intelligence modules and must be derivable
 * from movements, not frozen on the product row.
 *
 * Every function takes `businessId` explicitly; there is no unscoped lookup.
 *
 * Money: `NUMERIC(12,2)` is read from `pg` as a string. It is converted to a
 * number here, which is lossless because the column's maximum (9,999,999,999.99)
 * is far inside JavaScript's safe-integer range.
 */

import { query } from '../db/pool.js';

export interface Product {
  id: string;
  businessId: string;
  categoryId: string | null;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Product plus the denormalised category name, which listings display. */
export interface ProductWithCategory extends Product {
  categoryName: string | null;
}

interface ProductRow {
  id: string;
  business_id: string;
  category_id: string | null;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  cost_price: string;
  selling_price: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  category_name?: string | null;
}

const SELECT = `
  SELECT p.id, p.business_id, p.category_id, p.sku, p.name, p.description,
         p.unit, p.cost_price, p.selling_price, p.is_active,
         p.created_at, p.updated_at,
         c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
`;

function mapRow(row: ProductRow): ProductWithCategory {
  return {
    id: row.id,
    businessId: row.business_id,
    categoryId: row.category_id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    unit: row.unit,
    costPrice: Number(row.cost_price),
    sellingPrice: Number(row.selling_price),
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    categoryName: row.category_name ?? null,
  };
}

export interface ListProductsFilters {
  /** Case-insensitive match against either name or SKU. */
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  limit: number;
  offset: number;
}

export interface ListProductsResult {
  items: ProductWithCategory[];
  total: number;
}

/**
 * Escape a user-supplied search term for use with LIKE.
 *
 * Without this, a `%` or `_` from the client would act as a wildcard, letting
 * someone scan the whole catalog with `%`.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * List products for one business, with optional filters and pagination.
 *
 * Two queries (count + page) rather than a window function, so the total is
 * still correct when the requested page is empty.
 *
 * Ordering is fixed server-side (`lower(name)`, then `id` for determinism).
 * There is deliberately no user-controllable `ORDER BY`: the value cannot be
 * parameterised, so allowing it would invite SQL injection.
 */
export async function listProducts(
  businessId: string,
  filters: ListProductsFilters,
): Promise<ListProductsResult> {
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

  const where = conditions.join(' AND ');

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM products p WHERE ${where}`,
    params,
  );

  const pageParams = [...params, filters.limit, filters.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  const pageResult = await query<ProductRow>(
    `${SELECT} WHERE ${where}
      ORDER BY lower(p.name) ASC, p.id ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return {
    items: pageResult.rows.map(mapRow),
    total: countResult.rows[0]?.count ?? 0,
  };
}

export async function findProductById(
  businessId: string,
  productId: string,
): Promise<ProductWithCategory | null> {
  const result = await query<ProductRow>(`${SELECT} WHERE p.business_id = $1 AND p.id = $2`, [
    businessId,
    productId,
  ]);

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** Does this business already have a product with this SKU? Case-insensitive. */
export async function skuExists(
  businessId: string,
  sku: string,
  excludeId?: string,
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM products
        WHERE business_id = $1
          AND upper(sku) = upper($2)
          AND ($3::uuid IS NULL OR id <> $3::uuid)
     ) AS exists`,
    [businessId, sku, excludeId ?? null],
  );
  return result.rows[0]?.exists ?? false;
}

export async function createProduct(input: {
  businessId: string;
  categoryId: string | null;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  costPrice: string;
  sellingPrice: string;
  isActive: boolean;
}): Promise<ProductWithCategory> {
  // A data-modifying CTE, because `RETURNING` alone cannot include the joined
  // category name — the row does not exist yet to join against. Selecting from
  // the CTE keeps this to a single round trip and returns the same shape as a read.
  const result = await query<ProductRow>(
    `WITH inserted AS (
       INSERT INTO products
         (business_id, category_id, sku, name, description, unit,
          cost_price, selling_price, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, business_id, category_id, sku, name, description, unit,
                 cost_price, selling_price, is_active, created_at, updated_at
     )
     SELECT i.id, i.business_id, i.category_id, i.sku, i.name, i.description,
            i.unit, i.cost_price, i.selling_price, i.is_active,
            i.created_at, i.updated_at, c.name AS category_name
       FROM inserted i
       LEFT JOIN categories c ON c.id = i.category_id`,
    [
      input.businessId,
      input.categoryId,
      input.sku,
      input.name,
      input.description,
      input.unit,
      input.costPrice,
      input.sellingPrice,
      input.isActive,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create product');
  return mapRow(row);
}

export async function updateProduct(input: {
  businessId: string;
  productId: string;
  /** `undefined` leaves the category alone; `null` clears it. */
  categoryId?: string | null;
  sku?: string;
  name?: string;
  /** `undefined` leaves the description alone; `null` clears it. */
  description?: string | null;
  unit?: string;
  costPrice?: string;
  sellingPrice?: string;
  isActive?: boolean;
}): Promise<ProductWithCategory | null> {
  // The two nullable columns carry an explicit "was this field supplied?" flag.
  // `COALESCE` alone cannot distinguish "leave it" from "clear it", which would
  // make it impossible to un-categorise a product or blank a description.
  //
  // As with `createProduct`, the joined category name comes from a
  // data-modifying CTE, since `RETURNING` cannot see the categories table.
  const result = await query<ProductRow>(
    `WITH updated AS (
       UPDATE products
          SET category_id    = CASE WHEN $3::boolean THEN $4::uuid ELSE category_id END,
              sku            = COALESCE($5, sku),
              name           = COALESCE($6, name),
              description    = CASE WHEN $7::boolean THEN $8::text ELSE description END,
              unit           = COALESCE($9, unit),
              cost_price     = COALESCE($10::numeric, cost_price),
              selling_price  = COALESCE($11::numeric, selling_price),
              is_active      = COALESCE($12::boolean, is_active),
              updated_at     = now()
        WHERE business_id = $1 AND id = $2
        RETURNING id, business_id, category_id, sku, name, description, unit,
                  cost_price, selling_price, is_active, created_at, updated_at
     )
     SELECT u.id, u.business_id, u.category_id, u.sku, u.name, u.description,
            u.unit, u.cost_price, u.selling_price, u.is_active,
            u.created_at, u.updated_at, c.name AS category_name
       FROM updated u
       LEFT JOIN categories c ON c.id = u.category_id`,
    [
      input.businessId,
      input.productId,
      input.categoryId !== undefined,
      input.categoryId ?? null,
      input.sku ?? null,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.unit ?? null,
      input.costPrice ?? null,
      input.sellingPrice ?? null,
      input.isActive ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
