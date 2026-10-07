/**
 * Action Center — executed actions, audit trail and idempotency.
 *
 * ## What this table is
 *
 * One row per **attempted** action, and it is simultaneously:
 *
 *   - the **audit record** required by the Action Center contract
 *     ("who did what, to which product, based on which recommendation, and when");
 *   - the **idempotency record**, because `idempotency_key` is unique per
 *     business.
 *
 * Keeping them in one table is deliberate. An idempotency record is only useful
 * if it also describes what was done, and an audit record is only trustworthy if
 * the system cannot create two of them for one user intent. One row gives both
 * guarantees at once, and the unique index gives race-safety that an application
 * level "check then insert" cannot.
 *
 * ## Why a FAILED row can exist without a purchase order
 *
 * The action path is one transaction: purchase order + line + COMPLETED audit
 * row commit together or not at all. A failure rolls all of that back and the
 * failure is then recorded separately, so a rejected attempt is still visible to
 * an auditor without any chance of a misleading `COMPLETED` row or a partial PO.
 * The check constraint below makes "COMPLETED without a purchase order"
 * unrepresentable at the database level.
 *
 * ## Idempotency
 *
 * `UNIQUE (business_id, idempotency_key)` is a **partial** index over rows where
 * the key is present, so requests that send no key — the ordinary case — are
 * unconstrained by each other. Two concurrent requests carrying the same key
 * race here: exactly one insert wins, and the loser re-reads the winner's row.
 * That is the correct behaviour for a double-clicked button.
 *
 * `request_fingerprint` is a SHA-256 of the normalised request. Replaying the
 * same key with a *different* payload is a conflict (409), not a silent success,
 * because returning the original result for a different order would be a lie.
 *
 * ## Traceability
 *
 * `source_recommendation_*` stores the minimum immutable context needed to answer
 * "why was this draft PO created?" months later — the recommendation kind, its
 * deterministic id, and a compact snapshot of the decision that justified it.
 * Today's intelligence result is deliberately **not** consulted at read time: by
 * then the reorder decision may have changed, and reconstructing yesterday's
 * justification from today's numbers would be wrong.
 *
 * Conventions follow `1791123785034_suppliers-purchase-orders.ts`: UUID keys
 * defaulted in a follow-up ALTER, `timestamptz` columns defaulting to `now()`,
 * a `set_updated_at()` trigger, and `NO ACTION` on history-bearing references so
 * a tenant cascade still works while a direct delete of a referenced row is
 * refused.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Name of the PostgreSQL enum backing `actions.action_type`. */
export const ACTION_TYPE = 'action_type';

/** Name of the PostgreSQL enum backing `actions.status`. */
export const ACTION_STATUS = 'action_status';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // NOTE: `createType` takes the values as an ARRAY. Passing `{ enum: [...] }`
  // type-checks but silently generates `CREATE TYPE … AS ("enum" undefined)`.
  //
  // Both enums are deliberately tiny. `CREATE_DRAFT_PURCHASE_ORDER` is the only
  // executable action; every other recommendation kind stays review-only and has
  // no row in this enum, so adding one is a deliberate schema change rather than
  // something a request body can turn on.
  pgm.createType(ACTION_TYPE, ['CREATE_DRAFT_PURCHASE_ORDER']);
  pgm.createType(ACTION_STATUS, ['COMPLETED', 'FAILED']);

  pgm.createTable('actions', {
    id: { type: 'uuid', primaryKey: true },
    /** Every action is tenant-scoped; a cascade delete of the business removes it. */
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    /** The human who approved it. Never taken from a request body. */
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'NO ACTION',
    },
    action_type: { type: ACTION_TYPE, notNull: true },
    status: { type: ACTION_STATUS, notNull: true },

    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products',
      onDelete: 'NO ACTION',
    },
    supplier_id: {
      type: 'uuid',
      notNull: true,
      references: 'suppliers',
      onDelete: 'NO ACTION',
    },

    /** The quantity the user actually confirmed, after their edit. */
    quantity: { type: 'numeric(12,2)', notNull: true },
    /**
     * What the Reorder Engine suggested at the moment of execution, kept beside
     * the confirmed quantity so the audit shows whether the user overrode it.
     * Never recomputed; copied from the recommendation that authorised the action.
     */
    recommended_quantity: { type: 'numeric(12,2)', notNull: true },

    /**
     * The draft order this action created. `null` for a `FAILED` action, which is
     * what the check constraint below enforces in the other direction too.
     */
    purchase_order_id: {
      type: 'uuid',
      references: 'purchase_orders',
      onDelete: 'NO ACTION',
    },

    /**
     * Client-supplied replay guard. `null` when the caller sent no
     * `Idempotency-Key`, which is the normal case.
     */
    idempotency_key: { type: 'varchar(255)' },
    /** SHA-256 of the normalised request, so a key replayed with new data is a 409. */
    request_fingerprint: { type: 'char(64)' },

    /** Immutable traceability back to the recommendation that caused this. */
    source_recommendation_type: { type: 'varchar(50)', notNull: true },
    source_recommendation_id: { type: 'varchar(100)', notNull: true },
    /**
     * The minimum decision context needed to explain the action later: kind,
     * priority, confidence, source engine decisions and the engine's own reason.
     * Deliberately compact — not a copy of the whole intelligence snapshot.
     */
    source_recommendation_context: { type: 'jsonb', notNull: true },

    /** Present only on a `FAILED` action. */
    failure_reason: { type: 'text' },

    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
    completed_at: { type: 'timestamptz' },
  });

  pgm.sql(`
    ALTER TABLE actions
      ALTER COLUMN id          SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at  SET DEFAULT now(),
      ALTER COLUMN updated_at  SET DEFAULT now();
  `);

  // -------------------------------------------------------------------------
  // Indexes
  // -------------------------------------------------------------------------

  pgm.createIndex('actions', 'business_id', { name: 'actions_business_id_idx' });
  pgm.createIndex('actions', 'user_id', { name: 'actions_user_id_idx' });
  pgm.createIndex('actions', 'product_id', { name: 'actions_product_id_idx' });
  pgm.createIndex('actions', 'supplier_id', { name: 'actions_supplier_id_idx' });
  pgm.createIndex('actions', 'created_at', { name: 'actions_created_at_idx' });

  // The listing paths: one tenant's history, newest first, and the same filtered
  // by kind or status.
  pgm.sql(`
    CREATE INDEX actions_business_id_created_at_idx
      ON actions (business_id, created_at DESC);
  `);
  pgm.sql(`
    CREATE INDEX actions_business_id_type_created_at_idx
      ON actions (business_id, action_type, created_at DESC);
  `);
  pgm.sql(`
    CREATE INDEX actions_business_id_status_created_at_idx
      ON actions (business_id, status, created_at DESC);
  `);

  /**
   * Idempotency. Partial, because a NULL key must not collide with any other
   * NULL key — ordinary requests carry no key and are unconstrained by each other.
   * This index is what makes two simultaneous identical requests safe: one insert
   * wins, the other reads the winner's row instead of creating a second PO.
   */
  pgm.sql(`
    CREATE UNIQUE INDEX actions_business_id_idempotency_key_key
      ON actions (business_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  // -------------------------------------------------------------------------
  // Integrity
  // -------------------------------------------------------------------------

  pgm.addConstraint('actions', 'actions_quantity_positive', { check: 'quantity > 0' });

  // A COMPLETED action always quotes the engine's suggestion and it is always
  // positive. A FAILED action is exempt: it may have been refused precisely
  // because there was no live recommendation to take a quantity from, and
  // recording a fabricated zero would be worse than recording nothing.
  pgm.sql(`
    ALTER TABLE actions
      ADD CONSTRAINT actions_recommended_quantity_positive
      CHECK (status = 'FAILED' OR recommended_quantity > 0);
  `);

  // The audit invariant, enforced by the database rather than by convention:
  // an action is COMPLETED if and only if it actually produced a purchase order.
  // A "COMPLETED" row with no order would be exactly the misleading audit the
  // contract forbids, and this makes it unrepresentable.
  pgm.sql(`
    ALTER TABLE actions
      ADD CONSTRAINT actions_completed_has_purchase_order
      CHECK ((status = 'COMPLETED') = (purchase_order_id IS NOT NULL));
  `);

  // A failure reason on a successful action would be nonsense.
  pgm.sql(`
    ALTER TABLE actions
      ADD CONSTRAINT actions_failure_reason_only_when_failed
      CHECK (failure_reason IS NULL OR status = 'FAILED');
  `);

  // A replay guard only means something with a fingerprint to compare against.
  pgm.sql(`
    ALTER TABLE actions
      ADD CONSTRAINT actions_idempotency_key_has_fingerprint
      CHECK (
        (idempotency_key IS NULL) = (request_fingerprint IS NULL)
      );
  `);

  // An action can never belong to a different business than its purchase order.
  // The `(id, business_id)` unique key on `purchase_orders` this needs was
  // already added by the suppliers/purchase-orders migration; it is referenced
  // here rather than re-created.
  pgm.sql(`
    ALTER TABLE actions
      ADD CONSTRAINT actions_purchase_order_business_fkey
      FOREIGN KEY (purchase_order_id, business_id)
      REFERENCES purchase_orders (id, business_id)
      ON DELETE NO ACTION;
  `);

  pgm.sql(`
    CREATE TRIGGER actions_set_updated_at
      BEFORE UPDATE ON actions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // The trigger goes with its table.
  pgm.dropTable('actions');
  pgm.dropType(ACTION_STATUS);
  pgm.dropType(ACTION_TYPE);
}