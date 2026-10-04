/**
 * Inventory movements — the append-only stock ledger.
 *
 * This ledger is the **single source of truth for stock**. There is
 * deliberately no `current_stock` / `stock_quantity` column anywhere: a cached
 * quantity would be a second source of truth that could silently drift from the
 * movements, and "how much stock do I have?" must never be answerable two ways.
 *
 * Balance rule (evaluated in SQL, never in JavaScript):
 *
 *   stock = SUM(in.quantity) - SUM(out.quantity) + SUM(adjustment.quantity)
 *
 * An adjustment carries its own sign, so it needs no special case in the sum.
 *
 * Referential actions — a deliberate choice worth spelling out:
 *
 *   business → movements : ON DELETE CASCADE
 *   product  → movements : ON DELETE NO ACTION
 *   user     → movements : ON DELETE NO ACTION
 *
 * `NO ACTION` (the default) rather than `RESTRICT` is essential here. Both stop
 * a row from being deleted while movements reference it, so a movement's history
 * survives. But `RESTRICT` is checked *immediately*, which would also block
 * `DELETE FROM businesses` — the cascade from `businesses` to `products` fires
 * that check before the cascade to `inventory_movements` has run, and deleting a
 * tenant would start failing. `NO ACTION` is checked at end of statement, so the
 * whole cascade completes and only a *direct* delete of a referenced product or
 * user is refused.
 *
 * Conventions follow the earlier migrations: UUID keys defaulted in a follow-up
 * ALTER (so this file needs no runtime import from `node-pg-migrate`), and
 * `timestamptz` columns defaulting to `now()`.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Name of the PostgreSQL enum backing `inventory_movements.movement_type`. */
export const MOVEMENT_TYPE = 'inventory_movement_type';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // NOTE: `createType` takes the values as an ARRAY. Passing `{ enum: [...] }`
  // type-checks but silently generates `CREATE TYPE … AS ("enum" undefined)`.
  // `in` / `out` are reserved words, but they are quoted string labels here, so
  // they are safe.
  pgm.createType(MOVEMENT_TYPE, ['in', 'out', 'adjustment']);

  pgm.createTable('inventory_movements', {
    id: { type: 'uuid', primaryKey: true },
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
      // NO ACTION — see the file header. Blocks a hard delete of a product that
      // has history, without breaking the business cascade.
      onDelete: 'NO ACTION',
    },
    movement_type: { type: MOVEMENT_TYPE, notNull: true },
    /**
     * Always positive for `in` and `out`; may be either sign for `adjustment`.
     * Enforced by the check constraint below.
     */
    quantity: { type: 'numeric(12,2)', notNull: true },
    reason: { type: 'varchar(255)' },
    /**
     * Free-form pointer to whatever caused this movement — a purchase order,
     * a sales order, a stock count. Values arrive from the future modules, so
     * this is deliberately unvalidated beyond a length limit.
     */
    reference_type: { type: 'varchar(50)' },
    reference_id: { type: 'uuid' },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      // NO ACTION — a user who has recorded movements cannot be deleted, so the
      // audit trail keeps a real actor. The business cascade still works.
      onDelete: 'NO ACTION',
    },
    created_at: { type: 'timestamptz', notNull: true },
  });

  pgm.sql(`
    ALTER TABLE inventory_movements
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now();
  `);

  // ---- Indexes -------------------------------------------------------------
  pgm.createIndex('inventory_movements', 'business_id', {
    name: 'inventory_movements_business_id_idx',
  });
  pgm.createIndex('inventory_movements', 'product_id', {
    name: 'inventory_movements_product_id_idx',
  });
  pgm.createIndex('inventory_movements', 'created_at', {
    name: 'inventory_movements_created_at_idx',
  });

  // The hot path: "this product's ledger, newest first", always scoped to a
  // tenant. Serves both the balance calculation and the paginated history.
  pgm.sql(`
    CREATE INDEX inventory_movements_business_product_created_idx
      ON inventory_movements (business_id, product_id, created_at DESC);
  `);

  // Tenant-wide, time-ordered: the summary endpoint and recent-activity views.
  pgm.sql(`
    CREATE INDEX inventory_movements_business_created_idx
      ON inventory_movements (business_id, created_at DESC);
  `);

  // ---- Quantity rules ------------------------------------------------------
  // One constraint covering all three types, so an invalid row can never be
  // inserted even by direct SQL:
  //   in         → quantity > 0
  //   out        → quantity > 0
  //   adjustment → quantity <> 0   (either sign; it carries its own direction)
  pgm.addConstraint('inventory_movements', 'inventory_movements_quantity_valid', {
    check: `(
      (movement_type = 'in'         AND quantity > 0) OR
      (movement_type = 'out'        AND quantity > 0) OR
      (movement_type = 'adjustment' AND quantity <> 0)
    )`,
  });

  // ---- Immutability --------------------------------------------------------
  // A movement is never modified, so UPDATE is forbidden unconditionally. This
  // is safe to enforce at the storage layer: a cascading business delete only
  // performs DELETE, never UPDATE.
  //
  // DELETE is *not* blocked by a trigger, because business deletion cascades to
  // this table and a blanket trigger would make that impossible. Append-only is
  // therefore enforced by (a) this UPDATE trigger, (b) the absence of any PATCH
  // or DELETE movement endpoint, and (c) the NO ACTION foreign keys above, which
  // stop a product or user being deleted out from under a movement.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_inventory_movement_update()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION
        'inventory_movements is append-only: movements cannot be updated'
        USING ERRCODE = 'restrict_violation';
    END;
    $$;
  `);

  pgm.sql(`
    CREATE TRIGGER inventory_movements_no_update
      BEFORE UPDATE ON inventory_movements
      FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_update();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('inventory_movements');
  pgm.dropType(MOVEMENT_TYPE);
  // The trigger goes with the table; the function must be dropped explicitly.
  pgm.sql('DROP FUNCTION IF EXISTS prevent_inventory_movement_update();');
}
