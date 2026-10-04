/**
 * Server-side session store backing the HTTP-only session cookie.
 *
 * The cookie holds a high-entropy opaque token; only its SHA-256 hash is stored
 * here, so a database leak does not yield usable session credentials. Storing
 * sessions server-side (rather than using a stateless JWT) is what makes logout
 * actually revoke access, and leaves room for refresh tokens and "sign out
 * everywhere" later without a redesign.
 *
 * Sessions cascade-delete with their user, and users cascade-delete with their
 * business — so deleting a business removes all of its credentials in one go.
 *
 * Note: as with the auth-foundation migration, this file imports only *types*
 * from `node-pg-migrate`, because jiti loads it from outside the `backend`
 * package. SQL expressions go through `pgm.sql`.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('auth_sessions', {
    id: { type: 'uuid', primaryKey: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    /** SHA-256 hex digest of the session token. Never the token itself. */
    token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true },
    last_used_at: { type: 'timestamptz', notNull: true },
  });

  pgm.sql(`
    ALTER TABLE auth_sessions
      ALTER COLUMN id           SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at   SET DEFAULT now(),
      ALTER COLUMN last_used_at SET DEFAULT now();
  `);

  // Lookup key for every authenticated request.
  pgm.createIndex('auth_sessions', 'token_hash', {
    name: 'auth_sessions_token_hash_key',
    unique: true,
  });

  // Supports "list my sessions" and "revoke all my sessions".
  pgm.createIndex('auth_sessions', 'user_id', { name: 'auth_sessions_user_id_idx' });

  // Supports periodic pruning of expired rows.
  pgm.createIndex('auth_sessions', 'expires_at', { name: 'auth_sessions_expires_at_idx' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('auth_sessions');
}
