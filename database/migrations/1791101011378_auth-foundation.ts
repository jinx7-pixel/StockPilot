/**
 * Authentication and multi-tenant foundation: `businesses` and `users`.
 *
 * Creates no other business tables — products, inventory, sales, suppliers,
 * purchase orders, recommendations and audit logs all come in later modules.
 *
 * Tenancy model: a user belongs to exactly one business (`business_id` is
 * `NOT NULL` and there is no membership join table). Every authenticated
 * request is scoped by `business_id`, which is read from the session and never
 * from the request body.
 *
 * Email uniqueness is deliberately PER BUSINESS, not global: two unrelated
 * businesses may independently register the same address. See
 * `services/auth.service.ts` for how login resolves that case safely.
 *
 * Note: this file imports only *types* from `node-pg-migrate`. Migrations are
 * loaded at runtime by jiti from outside the `backend` package, where a value
 * import could not be resolved. Anything needing a SQL expression (defaults,
 * generated columns) is therefore issued through `pgm.sql`.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Name of the PostgreSQL enum type backing `users.role`. */
export const USER_ROLE_TYPE = 'user_role';

export async function up(pgm: MigrationBuilder): Promise<void> {
  // A real enum gives database-level validation. To add a role later, issue
  // `ALTER TYPE user_role ADD VALUE '...'` in a NEW migration — never edit this one.
  //
  // NOTE: `createType` takes the enum values as an ARRAY. Passing
  // `{ enum: [...] }` type-checks but silently generates
  // `CREATE TYPE ... AS ("enum" undefined)`.
  pgm.createType(USER_ROLE_TYPE, ['owner', 'staff']);

  pgm.createTable('businesses', {
    id: { type: 'uuid', primaryKey: true },
    name: { type: 'varchar(150)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true },
    // Deleting a business removes its users, which in turn removes their
    // sessions (see the auth-sessions migration).
    business_id: {
      type: 'uuid',
      notNull: true,
      references: 'businesses',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(100)', notNull: true },
    email: { type: 'varchar(255)', notNull: true },
    password_hash: { type: 'text', notNull: true },
    // Defaults to the least-privileged role; registration sets 'owner' explicitly.
    role: { type: USER_ROLE_TYPE, notNull: true, default: 'staff' },
    created_at: { type: 'timestamptz', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true },
  });

  // `gen_random_uuid()` is built into PostgreSQL 13+ core, so no extension is
  // required.
  pgm.sql(`
    ALTER TABLE businesses
      ALTER COLUMN id        SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at SET DEFAULT now(),
      ALTER COLUMN updated_at SET DEFAULT now();
  `);
  pgm.sql(`
    ALTER TABLE users
      ALTER COLUMN id         SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at SET DEFAULT now(),
      ALTER COLUMN updated_at SET DEFAULT now();
  `);

  // Every tenant-scoped query filters on business_id, so it must be indexed.
  pgm.createIndex('users', 'business_id', { name: 'users_business_id_idx' });

  // Email is unique per business, not globally.
  pgm.createIndex('users', ['business_id', 'email'], {
    name: 'users_business_id_email_key',
    unique: true,
  });

  // Enforce the normalisation invariant in the database, not only in code, so a
  // future writer cannot store a mixed-case address that silently breaks both
  // the unique index and the login lookup.
  pgm.addConstraint('users', 'users_email_lowercase_check', {
    check: 'email = lower(email)',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('users');
  pgm.dropTable('businesses');
  pgm.dropType(USER_ROLE_TYPE);
}
