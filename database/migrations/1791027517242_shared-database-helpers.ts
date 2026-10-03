/**
 * Shared database helpers.
 *
 * Infrastructure only — this migration creates no business tables. It provides
 * the generic `set_updated_at()` trigger helper that mutable StockPilot tables
 * will reuse, establishing the migration format for everything that follows.
 *
 * Note: `gen_random_uuid()` is built into PostgreSQL 13+ core, so no extension
 * is required for UUID primary keys.
 */

import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Trigger function that stamps `updated_at` to `now()`.
 *
 * Attached per-table with:
 *   CREATE TRIGGER products_set_updated_at
 *     BEFORE UPDATE ON products
 *     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 */
const CREATE_SET_UPDATED_AT = `
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(CREATE_SET_UPDATED_AT);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // IF EXISTS keeps a rollback safe even if the function is already gone.
  pgm.sql('DROP FUNCTION IF EXISTS set_updated_at();');
}
