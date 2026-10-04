/**
 * Shared node-pg-migrate runner configuration.
 *
 * Used by both the migration CLI (`db/migrate.ts`) and the test bootstrap
 * (`tests/helpers/testDatabase.ts`), so the two can never disagree about where
 * migrations live, which schema they target, or which files to ignore.
 *
 * Tooling only — excluded from the production build alongside `migrate.ts`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RunnerOption } from 'node-pg-migrate';

import { env } from '../config/env.js';
import { buildClientConfig } from './config.js';

export type MigrationDirection = RunnerOption['direction'];

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** `backend/` — the package root, and the cwd for npm scripts. */
const BACKEND_ROOT = path.resolve(MODULE_DIR, '..', '..');

/**
 * Absolute path to the migrations directory.
 *
 * Resolved from this module rather than from `process.cwd()`, so the migration
 * commands behave identically no matter where they are invoked from. An
 * absolute `MIGRATIONS_DIR` is used verbatim; a relative one resolves from the
 * backend package root.
 */
export const MIGRATIONS_DIR = path.isAbsolute(env.migrations.dir)
  ? env.migrations.dir
  : path.resolve(BACKEND_ROOT, env.migrations.dir);

/**
 * Files node-pg-migrate must not load as migrations.
 *
 * The library filters only by this pattern, so a stray config, JSON or Markdown
 * file in the migrations directory would otherwise be executed as a migration.
 * node-pg-migrate wraps it as `^<pattern>$` itself, so this must stay a single
 * expression with no top-level alternation and no anchors of its own.
 */
export const MIGRATION_IGNORE_PATTERN = '.*\\.(config\\.[cm]?[jt]s|json|md|txt)$';

/** Build the runner options shared by every migration command. */
export function buildRunnerConfig(
  direction: MigrationDirection,
  overrides: Partial<RunnerOption> = {},
): RunnerOption {
  return {
    // Connection settings come from the same factory the application pool uses.
    databaseUrl: buildClientConfig(),
    dir: MIGRATIONS_DIR,
    direction,
    migrationsTable: env.migrations.table,
    migrationsSchema: env.migrations.schema,
    schema: env.migrations.schema,
    // Append-only: refuse to run when an out-of-order migration was added
    // alongside already-applied ones.
    checkOrder: true,
    // All pending migrations commit together or not at all.
    singleTransaction: true,
    // Serialise concurrent runners (e.g. two deploys) instead of failing.
    advisoryLockMode: 'wait',
    ignorePattern: MIGRATION_IGNORE_PATTERN,
    verbose: false,
    ...overrides,
  };
}
