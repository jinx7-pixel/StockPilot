import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN email_verified_at timestamptz,
      ADD COLUMN mfa_secret text,
      ADD COLUMN mfa_pending_secret text,
      ADD COLUMN mfa_pending_session uuid,
      ADD COLUMN mfa_pending_until timestamptz,
      ADD COLUMN mfa_last_step bigint,
      ADD COLUMN mfa_recovery_hashes text[];

    CREATE TABLE auth_email_tokens (
      token_hash text PRIMARY KEY,
      purpose text NOT NULL CHECK (purpose IN ('register', 'verify', 'reset')),
      email text NOT NULL,
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      CHECK ((purpose = 'register') = (user_id IS NULL))
    );
    CREATE INDEX auth_email_tokens_expiry_idx ON auth_email_tokens (expires_at);
    CREATE INDEX auth_email_tokens_user_idx ON auth_email_tokens (user_id);

    CREATE TABLE auth_attempts (
      key text PRIMARY KEY,
      attempts integer NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX auth_attempts_expiry_idx ON auth_attempts (expires_at);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('auth_attempts');
  pgm.dropTable('auth_email_tokens');
  pgm.dropColumns('users', ['email_verified_at', 'mfa_secret', 'mfa_pending_secret', 'mfa_pending_session', 'mfa_pending_until',
    'mfa_last_step', 'mfa_recovery_hashes']);
}
