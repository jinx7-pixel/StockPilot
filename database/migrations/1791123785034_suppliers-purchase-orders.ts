/**
 * Suppliers and purchase orders.
 *
 * This is the **first real use of the `set_updated_at()` helper** created by the
 * foundation migration. `suppliers` and `purchase_orders` both carry an
 * `updated_at` column, so both get a `BEFORE UPDATE` trigger. Their
 * repositories therefore do *not* set `updated_at` in SQL — the trigger owns it.
 * (The older `products` / `categories` tables set it explicitly; attaching the
 * trigger to those is a separate cleanup, deliberately not done here.)
 *
 * ## The central business rule
 *
 * **Creating a purchase order does not touch inventory.** A PO records intent
 * to buy. Stock increases only when goods are physically received, and then only
 * as immutable `in` movements in `inventory_movements`. There is no stock
 * column anywhere in these tables.
 *
 * ## Referential actions
 *
 *   business → suppliers / purchase_orders / purchase_order_items : CASCADE
 *   supplier → purchase_orders                                    : NO ACTION
 *   product  → purchase_order_items                               : NO ACTION
 *   user     → purchase_orders                                    : NO ACTION
 *
 * `NO ACTION` (not `RESTRICT`) is deliberate, for the same reason as
 * `inventory_movements`: `RESTRICT` is checked immediately and would break the
 * cascade from `businesses`. `NO ACTION` is checked at end of statement, so a
 * tenant delete completes while a *direct* delete of a supplier, product or user
 * that is referenced by history is still refused. A supplier with purchase
 * orders can therefore never be hard-deleted, which is also why the API has no
 * supplier DELETE route — it offers deactivation instead.
 *
 * Conventions follow the earlier migrations: UUID keys defaulted in a follow-up
 * ALTER (so this file needs no runtime import from `node-pg-migrate`), and
 * `timestamptz` columns defaulting to `now()`.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Name of the PostgreSQL enum backing `purchase_orders.status`. */
export const PURCHASE_ORDER_STATUS = 'purchase_order_status';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // NOTE: `createType` takes the values as an ARRAY. Passing `{ enum: [...] }`
  // type-checks but silently generates `CREATE TYPE … AS ("enum" undefined)`.
  pgm.createType(PURCHASE_ORDER_STATUS, [
    'draft',
    'ordered',
    'partially_received',
    'received',
    'cancelled',
  ]);

  // -------------------------------------------------------------------------
  // suppliers
  // -------------------------------------------------------------------------
  pgm.createTable('suppliers', {
    id: { type: 'uuid', primaryKey: true },
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(150)', notNull: true },
    contact_name: { type: 'varchar(100)' },
    phone: { type: 'varchar(30)' },
    email: { type: 'varchar(255)' },
    address: { type: 'varchar(255)' },
    notes: { type: 'text' },
    // Suppliers are deactivated, never deleted, so historical purchase orders
    // keep a valid supplier reference.
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  pgm.sql(`
    ALTER TABLE suppliers
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now(),
      ALTER COLUMN updated_at  SET DEFAULT now();
  `);

  pgm.createIndex('suppliers', 'business_id', { name: 'suppliers_business_id_idx' });
  pgm.createIndex('suppliers', 'created_at', { name: 'suppliers_created_at_idx' });

  // Supplier names are stored as typed (trimmed) but compared case-insensitively,
  // matching the convention already used for `categories.name` and `products.sku`.
  // An expression index, hence `pgm.sql` rather than the column-list form.
  pgm.sql(`
    CREATE UNIQUE INDEX suppliers_business_id_name_key
      ON suppliers (business_id, lower(name));
  `);

  // The common "active suppliers, A–Z" lookup.
  pgm.sql(`
    CREATE INDEX suppliers_business_id_active_name_idx
      ON suppliers (business_id, is_active, lower(name));
  `);

  // -------------------------------------------------------------------------
  // purchase_orders
  // -------------------------------------------------------------------------
  pgm.createTable('purchase_orders', {
    id: { type: 'uuid', primaryKey: true },
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    supplier_id: {
      type: 'uuid',
      notNull: true,
      references: 'suppliers',
      onDelete: 'NO ACTION',
    },
    status: { type: PURCHASE_ORDER_STATUS, notNull: true, default: 'draft' },
    /** Computed by the server from the line totals; never accepted from a client. */
    total_amount: { type: 'numeric(14,2)', notNull: true },
    ordered_at: { type: 'timestamptz' },
    expected_at: { type: 'timestamptz' },
    received_at: { type: 'timestamptz' },
    notes: { type: 'text' },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'NO ACTION',
    },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  pgm.sql(`
    ALTER TABLE purchase_orders
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now(),
      ALTER COLUMN updated_at  SET DEFAULT now();
  `);

  pgm.createIndex('purchase_orders', 'business_id', { name: 'purchase_orders_business_id_idx' });
  pgm.createIndex('purchase_orders', 'supplier_id', { name: 'purchase_orders_supplier_id_idx' });
  pgm.createIndex('purchase_orders', 'status', { name: 'purchase_orders_status_idx' });
  pgm.createIndex('purchase_orders', 'created_at', { name: 'purchase_orders_created_at_idx' });

  // The listing paths: one tenant's orders, newest first, and filtered by status.
  pgm.sql(`
    CREATE INDEX purchase_orders_business_id_created_at_idx
      ON purchase_orders (business_id, created_at DESC);
  `);
  pgm.sql(`
    CREATE INDEX purchase_orders_business_id_status_idx
      ON purchase_orders (business_id, status, created_at DESC);
  `);

  // -------------------------------------------------------------------------
  // purchase_order_items
  // -------------------------------------------------------------------------
  pgm.createTable('purchase_order_items', {
    id: { type: 'uuid', primaryKey: true },
    purchase_order_id: {
      type: 'uuid',
      notNull: true,
      references: 'purchase_orders',
      onDelete: 'CASCADE',
    },
    /**
     * Denormalised from the parent order so every line is independently
     * tenant-scoped and indexable. A composite foreign key below guarantees it
     * matches the order, rather than trusting the application to keep them equal.
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
    /** How much was ordered. */
    quantity: { type: 'numeric(12,2)', notNull: true },
    /**
     * How much has arrived so far. Server-owned: a receive request supplies the
     * *increment*, never this value.
     */
    received_quantity: { type: 'numeric(12,2)', notNull: true, default: 0 },
    unit_cost: { type: 'numeric(12,2)', notNull: true },
    line_total: { type: 'numeric(14,2)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
  });

  pgm.sql(`
    ALTER TABLE purchase_order_items
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now();
  `);

  pgm.createIndex('purchase_order_items', 'purchase_order_id', {
    name: 'purchase_order_items_purchase_order_id_idx',
  });
  pgm.createIndex('purchase_order_items', 'business_id', {
    name: 'purchase_order_items_business_id_idx',
  });
  pgm.createIndex('purchase_order_items', 'product_id', {
    name: 'purchase_order_items_product_id_idx',
  });

  // -------------------------------------------------------------------------
  // Integrity
  // -------------------------------------------------------------------------
  pgm.addConstraint('purchase_order_items', 'purchase_order_items_quantity_positive', {
    check: 'quantity > 0',
  });
  pgm.addConstraint('purchase_order_items', 'purchase_order_items_unit_cost_non_negative', {
    check: 'unit_cost >= 0',
  });
  pgm.addConstraint('purchase_order_items', 'purchase_order_items_line_total_non_negative', {
    check: 'line_total >= 0',
  });
  pgm.addConstraint('purchase_order_items', 'purchase_order_items_received_non_negative', {
    check: 'received_quantity >= 0',
  });
  // You can never have received more than you ordered — the invariant that makes
  // a stock increase from a receipt trustworthy.
  pgm.addConstraint('purchase_order_items', 'purchase_order_items_received_within_ordered', {
    check: 'received_quantity <= quantity',
  });
  pgm.addConstraint('purchase_orders', 'purchase_orders_total_amount_non_negative', {
    check: 'total_amount >= 0',
  });

  // A line can never belong to a different business than its order.
  pgm.sql(`
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_id_business_id_key UNIQUE (id, business_id);
  `);

  pgm.sql(`
    ALTER TABLE purchase_order_items
      ADD CONSTRAINT purchase_order_items_order_business_fkey
      FOREIGN KEY (purchase_order_id, business_id)
      REFERENCES purchase_orders (id, business_id)
      ON DELETE CASCADE;
  `);

  // -------------------------------------------------------------------------
  // updated_at triggers
  // -------------------------------------------------------------------------
  // `set_updated_at()` already exists from the foundation migration. These
  // repositories rely on this trigger rather than setting `updated_at` in SQL.
  pgm.sql(`
    CREATE TRIGGER suppliers_set_updated_at
      BEFORE UPDATE ON suppliers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TRIGGER purchase_orders_set_updated_at
      BEFORE UPDATE ON purchase_orders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // The triggers go with their tables.
  pgm.dropTable('purchase_order_items');
  pgm.dropTable('purchase_orders');
  pgm.dropTable('suppliers');
  pgm.dropType(PURCHASE_ORDER_STATUS);
}
