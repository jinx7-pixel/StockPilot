#!/usr/bin/env node
/**
 * StockPilot migration CLI.
 *
 * A thin, typed wrapper around `node-pg-migrate` that reuses the same
 * environment-driven connection configuration as the application pool
 * (`./config.ts`), so migrations can never run against a different database than
 * the API. See `database/README.md` for the workflow.
 *
 * Usage (from the `backend` package):
 *   npm run migration:create -- add-widgets
 *   npm run migration:up
 *   npm run migration:down
 *   npm run migration:status
 *   npm run migration:redo
 *
 * This module is tooling only: it is excluded from the production build and is
 * never imported by the running API.
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runner, type RunnerOption } from 'node-pg-migrate';

import { env } from '../config/env.js';
import { buildClientConfig, describeTarget } from './config.js';
import { closePool, query } from './pool.js';

/** `node-pg-migrate` does not re-export `MigrationDirection` from its entry point. */
type MigrationDirection = RunnerOption['direction'];

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** `backend/` — the package root, and the cwd for npm scripts. */
const BACKEND_ROOT = path.resolve(MODULE_DIR, '..', '..');

/**
 * Absolute path to the migrations directory. An absolute `MIGRATIONS_DIR` is
 * used verbatim; a relative one resolves from the backend package root.
 */
const MIGRATIONS_DIR = path.isAbsolute(env.migrations.dir)
  ? env.migrations.dir
  : path.resolve(BACKEND_ROOT, env.migrations.dir);

/** Resolve the node-pg-migrate CLI entrypoint so `create` uses its own generator. */
function resolveCliPath(): string {
  return fileURLToPath(import.meta.resolve('node-pg-migrate/bin/node-pg-migrate'));
}

/**
 * Files that node-pg-migrate must not attempt to load as migrations.
 *
 * node-pg-migrate matches this against the file's base name and wraps it as
 * `^<pattern>$` itself, so this must be a single expression with no top-level
 * alternation and no anchors of its own. Everything with an extension that is
 * not a migration language (`ts` / `js` / `sql`) is excluded, so a stray README
 * or config file in the directory cannot break a migration run.
 * Keep in sync with {@link isMigrationFile}.
 */
const IGNORE_PATTERN = '.*\\.(config\\.[cm]?[jt]s|json|md|txt)$';

function isMigrationFile(fileName: string): boolean {
  return (
    !fileName.startsWith('.') &&
    !/.*\.(config\.[cm]?[jt]s|json)$/.test(fileName) &&
    /\.(ts|js|sql)$/.test(fileName)
  );
}

function baseRunnerConfig(direction: MigrationDirection): RunnerOption {
  return {
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
    ignorePattern: IGNORE_PATTERN,
    verbose: false,
  };
}

async function runMigrations(direction: MigrationDirection, count?: number): Promise<void> {
  console.log(`[migrate] target : ${describeTarget()}`);
  console.log(`[migrate] schema : ${env.migrations.schema}`);
  console.log(`[migrate] dir    : ${MIGRATIONS_DIR}`);

  const applied = await runner({
    ...baseRunnerConfig(direction),
    ...(count === undefined ? {} : { count }),
  });

  if (applied.length === 0) {
    console.log(`[migrate] no pending migrations to run (${direction}).`);
    return;
  }

  for (const migration of applied) {
    console.log(`[migrate] ${direction} ${migration.path ?? migration.name}`);
  }

  console.log(`[migrate] done — ${applied.length} migration(s) applied.`);
}

/**
 * `status` is not exposed by the node-pg-migrate programmatic API, so read the
 * tracking table directly and compare it with the files on disk.
 */
async function showStatus(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(isMigrationFile)
    .sort();

  console.log(`[migrate] target : ${describeTarget()}`);
  console.log(`[migrate] dir    : ${MIGRATIONS_DIR} (${files.length} file(s))\n`);

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  let rows: { id: string; name: string | null; run_on: Date }[];

  try {
    const result = await query<{ id: string; name: string | null; run_on: Date }>(
      `SELECT id, name, run_on
         FROM "${env.migrations.schema}"."${env.migrations.table}"
        ORDER BY run_on, id`,
    );
    rows = result.rows;
  } catch (error) {
    const code = (error as { code?: string }).code;

    // 42P01 = undefined_table. Only that means "no history yet" — anything else
    // (refused connection, auth failure, missing database) is a real problem and
    // must not be disguised as a first run.
    if (code !== '42P01') {
      throw new Error(
        `cannot read the migration history from "${describeTarget()}": ` +
          `${error instanceof Error ? error.message : String(error)}\n` +
          `Check the PG* variables in backend/.env.`,
        { cause: error },
      );
    }

    console.log(
      `Tracking table "${env.migrations.schema}"."${env.migrations.table}" does not exist yet.\n` +
        `Run "npm run migration:up" to initialise it.\n`,
    );
    rows = [];
  }

  // node-pg-migrate records the per-table sequence in `id` and the migration
  // file name (without extension) in `name`, so `name` is what matches a file
  // on disk.
  const appliedNames = new Set(rows.map((row) => row.name).filter((n): n is string => n !== null));
  const toMigrationName = (fileName: string): string => fileName.replace(/\.(ts|js|sql)$/, '');

  const appliedCount = files.filter((file) => appliedNames.has(toMigrationName(file))).length;

  for (const file of files) {
    const state = appliedNames.has(toMigrationName(file)) ? 'applied' : 'pending';
    console.log(`  [${state}] ${file}`);
  }

  console.log(
    `\n${appliedCount} applied, ${files.length - appliedCount} pending ` +
      `(${rows.length} record(s) in the tracking table).`,
  );
}

async function createMigration(name: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(
      `Invalid migration name: "${name}". Use letters, digits, hyphens and underscores.`,
    );
  }

  // Delegate to node-pg-migrate's own generator so the file header and naming
  // stay canonical. No database connection is needed for this command.
  const child = spawn(
    process.execPath,
    [
      resolveCliPath(),
      'create',
      name,
      '--migrations-dir',
      MIGRATIONS_DIR,
      '--migration-file-language',
      'ts',
      '--migration-filename-format',
      'timestamp',
    ],
    { stdio: 'inherit' },
  );

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`node-pg-migrate create exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

const USAGE = `Usage: npm run migration:<command> [-- args]

  create <name>   Create a new timestamped migration file
  up              Apply all pending migrations
  down [count]    Roll back the most recent migration (default: 1)
  redo            Roll back and re-apply the most recent migration
  status          Show applied and pending migrations
`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'create': {
      const name = args[0];
      if (!name) {
        throw new Error('A migration name is required.\n\n' + USAGE);
      }
      await createMigration(name);
      return;
    }

    case 'up': {
      await runMigrations('up');
      return;
    }

    case 'down': {
      const parsed = Number.parseInt(args[0] ?? '1', 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        throw new Error('Rollback count must be a positive integer.\n\n' + USAGE);
      }
      await runMigrations('down', parsed);
      return;
    }

    case 'redo': {
      // Re-apply the most recent migration to prove it is reversible.
      await runMigrations('down', 1);
      await runMigrations('up');
      return;
    }

    case 'status': {
      await showStatus();
      return;
    }

    default: {
      if (command === undefined || command === '--help' || command === '-h') {
        console.log(USAGE);
        process.exitCode = 0;
        return;
      }
      throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(`[migrate] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // `status` borrows the application pool; `up`/`down` manage their own
    // connection. Either way, never leave sockets open.
    return closePool().catch(() => undefined);
  });
