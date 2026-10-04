/**
 * Sales — a completed business transaction.
 *
 * A sale is a *record* of money and customer information. It is **not** a stock
 * system: it owns no quantity of its own. Creating a sale appends `out`
 * movements to `inventory_movements`, which remains the only source of truth for
 * stock. There is deliberately no `current_stock` here or on `sale_items`.
 *
 * Referential actions:
 *
 *   business → sales       : ON DELETE CASCADE
 *   business → sale_items  : ON DELETE CASCADE
 *   sale     → sale_items  : ON DELETE CASCADE
 *   product  → sale_items  : ON DELETE NO ACTION
 *   user     → sales       : ON DELETE NO ACTION
 *
 * `NO ACTION` (not `RESTRICT`) is deliberate, for the same reason as
 * `inventory_movements`: `RESTRICT` is checked immediately and would break the
 * cascade from `businesses`. `NO ACTION` is checked at end of statement, so a
 * tenant delete completes while a *direct* delete of a product or user that is
 * referenced by history is still refused.
 *
 * Integrity guarantees added on top of the column definitions:
 *  - `sale_items.business_id` must equal the parent sale's `business_id`,
 *    enforced by a composite foreign key rather than by convention.
 *  - every quantity and monetary amount is constrained to a sane range.
 *
 * Conventions follow the earlier migrations: UUID keys defaulted in a follow-up
 * ALTER (so this file needs no runtime import from `node-pg-migrate`), and
 * `timestamptz` columns defaulting to `now()`.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Name of the PostgreSQL enum backing `sales.status`. */
export const SALE_STATUS = 'sale_status';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // NOTE: `createType` takes the values as an ARRAY. Passing `{ enum: [...] }`
  // type-checks but silently generates `CREATE TYPE … AS ("enum" undefined)`.
  //
  // `completed` is the only status for now. Sales are immutable in this
  // milestone (no PATCH/DELETE), so there is nothing else that could set one.
  // New statuses are added with a migration, e.g.
  // `ALTER TYPE sale_status ADD VALUE 'refunded'`.
  pgm.createType(SALE_STATUS, ['completed']);

  pgm.createTable('sales', {
    id: { type: 'uuid', primaryKey: true },
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    customer_name: { type: 'varchar(150)' },
    customer_phone: { type: 'varchar(30)' },
    /** Sum of the line totals, computed by the server in exact `numeric`. */
    total_amount: { type: 'numeric(14,2)', notNull: true },
    status: { type: SALE_STATUS, notNull: true, default: 'completed' },
    /** When the sale happened, which may differ from when it was recorded. */
    sold_at: { type: 'timestamptz', notNull: true },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'NO ACTION',
    },
    created_at: { type: 'timestamptz', notNull: true },
  });

  pgm.createTable('sale_items', {
    id: { type: 'uuid', primaryKey: true },
    sale_id: {
      type: 'uuid',
      notNull: true,
      references: 'sales',
      onDelete: 'CASCADE',
    },
    /**
     * Denormalised from the parent sale so every row is independently
     * tenant-scoped and indexable. A composite foreign key below guarantees it
     * matches the sale, rather than trusting the application to keep them equal.
     */
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products',
      onDelete: 'NO ACTION',
    },
    quantity: { type: 'numeric(12,2)', notNull: true },
    /** Snapshot of the product's selling price at the moment of the sale. */
    unit_price: { type: 'numeric(12,2)', notNull: true },
    /** `quantity * unit_price`, calculated in the database. */
    line_total: { type: 'numeric(14,2)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
  });

  pgm.sql(`
    ALTER TABLE sales
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN sold_at     SET DEFAULT now(),
      ALTER COLUMN created_at  SET DEFAULT now();
  `);
  pgm.sql(`
    ALTER TABLE sale_items
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now();
  `);

  // ---- Indexes -------------------------------------------------------------
  pgm.createIndex('sales', 'business_id', { name: 'sales_business_id_idx' });
  pgm.createIndex('sales', 'created_at', { name: 'sales_created_at_idx' });
  pgm.createIndex('sales', 'status', { name: 'sales_status_idx' });

  // The listing path: one tenant's sales, newest first.
  pgm.sql(`
    CREATE INDEX sales_business_id_sold_at_idx
      ON sales (business_id, sold_at DESC);
  `);

  pgm.createIndex('sale_items', 'sale_id', { name: 'sale_items_sale_id_idx' });
  pgm.createIndex('sale_items', 'business_id', { name: 'sale_items_business_id_idx' });
  pgm.createIndex('sale_items', 'product_id', { name: 'sale_items_product_id_idx' });

  // ---- Integrity -----------------------------------------------------------
  // Target for the composite foreign key below.
  pgm.sql(`
    ALTER TABLE sales ADD CONSTRAINT sales_id_business_id_key UNIQUE (id, business_id);
  `);

  // A sale item can never belong to a different business than its sale.
  pgm.sql(`
    ALTER TABLE sale_items
      ADD CONSTRAINT sale_items_sale_business_fkey
      FOREIGN KEY (sale_id, business_id)
      REFERENCES sales (id, business_id)
      ON DELETE CASCADE;
  `);

  pgm.addConstraint('sale_items', 'sale_items_quantity_positive', { check: 'quantity > 0' });
  pgm.addConstraint('sale_items', 'sale_items_unit_price_non_negative', {
    check: 'unit_price >= 0',
  });
  pgm.addConstraint('sale_items', 'sale_items_line_total_non_negative', {
    check: 'line_total >= 0',
  });
  pgm.addConstraint('sales', 'sales_total_amount_non_negative', { check: 'total_amount >= 0' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('sale_items');
  pgm.dropTable('sales');
  pgm.dropType(SALE_STATUS);
}
