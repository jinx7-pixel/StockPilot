/**
 * Test database lifecycle.
 *
 * Creates the test database if it is missing, brings the schema up to date with
 * the committed migrations, and truncates between tests. Every table is wiped —
 * including `businesses`, which cascades to users and sessions — so tests start
 * from a known-empty state.
 */

import { Client } from 'pg';
import { runner } from 'node-pg-migrate';

import { env } from '../../config/env.js';
import { buildClientConfig } from '../../db/config.js';
import { buildRunnerConfig } from '../../db/migrateConfig.js';
import { closePool, getPool } from '../../db/pool.js';

let migrated = false;

/**
 * Create the test database if absent.
 *
 * Connects to the maintenance database because `CREATE DATABASE` cannot run
 * inside the database being created.
 */
async function ensureDatabaseExists(): Promise<void> {
  const admin = new Client({
    ...buildClientConfig(),
    database: 'postgres',
  });

  try {
    await admin.connect();

    const result = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      env.database.testDatabase,
    ]);

    if (result.rowCount === 0) {
      // Identifier cannot be parameterised; the value comes from our own env
      // config and is quoted defensively.
      await admin.query(`CREATE DATABASE "${env.database.testDatabase.replace(/"/g, '""')}"`);
      console.log(`[test-db] created database "${env.database.testDatabase}"`);
    }
  } finally {
    await admin.end();
  }
}

/** Apply any pending migrations to the test database. Idempotent. */
async function ensureSchema(): Promise<void> {
  if (migrated) return;

  // Reuses the exact runner configuration the CLI uses.
  await runner(buildRunnerConfig('up'));

  migrated = true;
}

/** Prepare the database once per process. Safe to call from every test file. */
export async function prepareTestDatabase(): Promise<void> {
  await ensureDatabaseExists();
  await ensureSchema();
}

/**
 * Empty every business table.
 *
 * `RESTART IDENTITY CASCADE` resets sequences too, so tests that assert on
 * generated values stay independent of execution order.
 */
export async function resetTestDatabase(): Promise<void> {
  await ensureSchema();

  await getPool().query(`
    TRUNCATE TABLE auth_sessions, users, businesses
    RESTART IDENTITY CASCADE
  `);
}

export async function closeTestDatabase(): Promise<void> {
  await closePool();
}
