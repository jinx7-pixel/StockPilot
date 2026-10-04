/**
 * Products and categories: the catalog definitions a business sells.
 *
 * Scope is deliberately limited to the catalog. There is **no stock quantity,
 * available quantity, reorder point, stock risk, demand or recommendation** on
 * either table — those belong to the future inventory and intelligence modules,
 * and storing them here would make them impossible to recompute.
 *
 * Tenancy: both tables are scoped by `business_id`, and the repositories require
 * it explicitly for every read and write.
 *
 * Deletion behaviour:
 *  - Deleting a **business** cascades to its categories and products, matching
 *    the existing `users` / `auth_sessions` behaviour.
 *  - Deleting a **category** is RESTRICTed while products still reference it, so
 *    products can never be silently orphaned. Reassign or remove them first.
 *  - `products.category_id` is ON DELETE SET NULL, so a product survives its
 *    category disappearing. A product may legitimately have no category.
 *
 * Conventions follow the auth migrations: UUID keys defaulted in a follow-up
 * ALTER (so this file needs no runtime import from `node-pg-migrate`), and
 * `timestamptz` columns defaulting to `now()`.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('categories', {
    id: { type: 'uuid', primaryKey: true },
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(100)', notNull: true },
    description: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  pgm.createTable('products', {
    id: { type: 'uuid', primaryKey: true },
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    // Nullable: a product may exist without a category. SET NULL rather than
    // RESTRICT, so a product outlives a category removal.
    category_id: {
      type: 'uuid',
      references: 'categories',
      onDelete: 'SET NULL',
    },
    sku: { type: 'varchar(100)', notNull: true },
    name: { type: 'varchar(200)', notNull: true },
    description: { type: 'text' },
    unit: { type: 'varchar(30)', notNull: true, default: 'piece' },
    cost_price: { type: 'numeric(12,2)', notNull: true },
    selling_price: { type: 'numeric(12,2)', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  // `gen_random_uuid()` is built into PostgreSQL 13+ core.
  pgm.sql(`
    ALTER TABLE categories
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now(),
      ALTER COLUMN updated_at  SET DEFAULT now();
  `);
  pgm.sql(`
    ALTER TABLE products
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now(),
      ALTER COLUMN updated_at  SET DEFAULT now();
  `);

  // ---- Indexes -------------------------------------------------------------
  // Every tenant-scoped query filters on business_id.
  pgm.createIndex('categories', 'business_id', { name: 'categories_business_id_idx' });
  pgm.createIndex('products', 'business_id', { name: 'products_business_id_idx' });
  pgm.createIndex('products', 'category_id', { name: 'products_category_id_idx' });

  // Case-insensitive uniqueness *within a business*, without mangling the
  // stored display name. Expression indexes, hence `pgm.sql` rather than the
  // column-list form of `createIndex`, which would quote them as identifiers.
  pgm.sql(`
    CREATE UNIQUE INDEX categories_business_id_name_key
      ON categories (business_id, lower(name));
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX products_business_id_sku_key
      ON products (business_id, upper(sku));
  `);

  // Composite index for the default listing, which is ordered by name.
  pgm.sql(`
    CREATE INDEX products_business_id_name_idx
      ON products (business_id, lower(name));
  `);

  // ---- Value constraints ---------------------------------------------------
  pgm.addConstraint('products', 'products_cost_price_non_negative', {
    check: 'cost_price >= 0',
  });
  pgm.addConstraint('products', 'products_selling_price_non_negative', {
    check: 'selling_price >= 0',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('products');
  pgm.dropTable('categories');
}
