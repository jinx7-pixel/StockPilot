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
import { buildClientConfig } from './config.js';

const isProduction = env.isProduction;

/**
 * Single shared pool per process. Created lazily so that importing this module
 * (for example from a type-only import or a test) never opens sockets eagerly.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool === null) {
    pool = new Pool({
      // Connection settings are shared with the migration runner — see ./config.ts
      ...buildClientConfig(),
      max: env.database.maxConnections,
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
 * Lightweight connectivity probe. Returns `false` instead of throwing so that a
 * database outage degrades the readiness payload rather than crashing the
 * request.
 *
 * ## Why this takes its own connection
 *
 * `SELECT 1` alone is **not** bounded. The pool sets `connectionTimeoutMillis`,
 * which covers connect and authenticate — not query execution — and no
 * `statement_timeout` is configured, so a backend that accepts a connection and
 * then stops responding would hang forever.
 *
 * `Promise.race` on its own would only stop *waiting*: the query would keep
 * running and the client would stay checked out, which is worse than a slow
 * answer. So on timeout the client is **destroyed** rather than released.
 * Closing the socket makes PostgreSQL abort the query server-side, which is
 * real cancellation, and it guarantees a wedged connection is never handed back
 * to the pool for an application query to inherit.
 *
 * ## Known limitation
 *
 * That cancellation depends on PostgreSQL noticing the closed socket. On a hard
 * network partition — where packets are dropped rather than refused — the
 * server-side query can outlive the probe until TCP itself times out. The HTTP
 * request still returns promptly, which is what a readiness probe needs; the
 * residue is a backend that finishes, or is reaped, on its own.
 *
 * A pool-wide `statement_timeout` would close this gap more cleanly, but it
 * would also silently bound every application query, which is a much larger
 * behavioural change than a health check warrants.
 */
export async function checkConnection(timeoutMs = 2_000): Promise<boolean> {
  let client: PoolClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abandoned = true;
      reject(new Error('connectivity probe timed out'));
    }, timeoutMs);
    // Never let a probe keep the process alive.
    timer.unref?.();
  });

  try {
    client = await Promise.race([getPool().connect(), deadline]);
    await Promise.race([client.query('SELECT 1'), deadline]);
    return true;
  } catch (error) {
    // Never return a connection that may still be running a query.
    abandoned = true;
    if (isProduction) {
      console.error('[db] connectivity check failed:', error);
    }
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    if (client) {
      // `release(true)` destroys the client. A client that was abandoned mid-query
      // is poisoned by definition, so it must not go back into the pool.
      if (abandoned) client.release(true);
      else client.release();
    }
  }
}

/** Close the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool === null) return;

  const closing = pool;
  pool = null;
  await closing.end();
}
