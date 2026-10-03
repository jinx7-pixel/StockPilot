/**
 * PostgreSQL connection configuration.
 *
 * This module owns *connectivity* only: it builds a `pg` connection pool from
 * environment variables and exposes small query helpers. It deliberately does not
 * create, alter or seed any application tables — the schema is managed through
 * versioned migrations (see `database/README.md`).
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { env } from '../config/env.js';

const isProduction = env.isProduction;

/**
 * Single shared pool per process. Created lazily so that importing this module
 * (for example from a type-only import or a test) never opens sockets eagerly.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool === null) {
    pool = new Pool({
      // DATABASE_URL takes precedence when present, otherwise discrete PG* vars.
      connectionString: env.database.url,
      host: env.database.host,
      port: env.database.port,
      database: env.database.database,
      user: env.database.user,
      password: env.database.password,
      ssl: env.database.ssl === 'require' ? { rejectUnauthorized: false } : undefined,
      max: env.database.maxConnections,
      connectionTimeoutMillis: env.database.connectionTimeoutMillis,
      application_name: 'stockpilot-api',
    });

    // A pool-level error must never crash the process: an idle client can be
    // dropped by the server or a proxy at any time.
    pool.on('error', (error) => {
      console.error('[db] unexpected idle client error:', error.message);
    });
  }

  return pool;
}

/** Run a parameterised query. Never interpolate user input into `sql`. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params as unknown[]);
}

/**
 * Run `handler` inside a transaction, committing on success and rolling back on
 * any thrown error. The client is always released back to the pool.
 */
export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lightweight connectivity probe. Used by health checks to report whether the
 * database is reachable. Returns `false` instead of throwing so that a database
 * outage degrades the health payload rather than crashing the request.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    if (isProduction) {
      console.error('[db] connectivity check failed:', error);
    }
    return false;
  }
}

/** Close the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool === null) return;

  const closing = pool;
  pool = null;
  await closing.end();
}
