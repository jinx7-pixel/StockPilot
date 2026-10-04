/**
 * Category persistence.
 *
 * Every function takes `businessId` explicitly. There is deliberately no
 * category-by-id lookup without a tenant, so a forgotten scope is a compile
 * error rather than a cross-tenant read.
 */

import { query } from '../db/pool.js';

export interface Category {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CategoryRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `
  SELECT id, business_id, name, description, created_at, updated_at
    FROM categories
`;

function mapRow(row: CategoryRow): Category {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    description: row.description,
    // ISO strings keep the API response stable regardless of server locale.
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCategories(businessId: string): Promise<Category[]> {
  const result = await query<CategoryRow>(
    `${SELECT} WHERE business_id = $1 ORDER BY lower(name) ASC, id ASC`,
    [businessId],
  );
  return result.rows.map(mapRow);
}

export async function findCategoryById(
  businessId: string,
  categoryId: string,
): Promise<Category | null> {
  const result = await query<CategoryRow>(`${SELECT} WHERE business_id = $1 AND id = $2`, [
    businessId,
    categoryId,
  ]);

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Does this business already have a category with this name?
 *
 * Case-insensitive, matching the unique expression index, so "Tools" and
 * "tools" are the same category.
 */
export async function categoryNameExists(
  businessId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM categories
        WHERE business_id = $1
          AND lower(name) = lower($2)
          AND ($3::uuid IS NULL OR id <> $3::uuid)
     ) AS exists`,
    [businessId, name, excludeId ?? null],
  );
  return result.rows[0]?.exists ?? false;
}

export async function createCategory(input: {
  businessId: string;
  name: string;
  description: string | null;
}): Promise<Category> {
  const result = await query<CategoryRow>(
    `INSERT INTO categories (business_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING id, business_id, name, description, created_at, updated_at`,
    [input.businessId, input.name, input.description],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create category');
  return mapRow(row);
}

export async function updateCategory(input: {
  businessId: string;
  categoryId: string;
  name?: string;
  /** `undefined` leaves the description alone; `null` clears it. */
  description?: string | null;
}): Promise<Category | null> {
  // `updated_at` is set explicitly rather than by trigger, matching the
  // existing tables, which have no UPDATE trigger attached.
  //
  // Nullable columns use an explicit "was this field supplied?" flag: plain
  // `COALESCE(description, ...)` cannot distinguish "leave it" from "clear it".
  const result = await query<CategoryRow>(
    `UPDATE categories
        SET name         = COALESCE($3, name),
            description  = CASE WHEN $4::boolean THEN $5::text ELSE description END,
            updated_at   = now()
      WHERE business_id = $1 AND id = $2
      RETURNING id, business_id, name, description, created_at, updated_at`,
    [
      input.businessId,
      input.categoryId,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** How many products still reference this category. Used to explain a blocked delete. */
export async function countProductsInCategory(categoryId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM products WHERE category_id = $1`,
    [categoryId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Delete a category. The FK is RESTRICT, so this fails while products reference it. */
export async function deleteCategory(businessId: string, categoryId: string): Promise<boolean> {
  const result = await query(`DELETE FROM categories WHERE business_id = $1 AND id = $2`, [
    businessId,
    categoryId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
