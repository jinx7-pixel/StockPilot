/**
 * Shared PostgreSQL connection configuration.
 *
 * This is the single place where connection settings are turned into a
 * `pg` config object. Both the application connection pool (`pool.ts`) and the
 * migration runner (`migrate.ts`) build their clients from this function, so a
 * migration can never end up pointed at a different database than the API — a
 * class of bug that is very hard to diagnose later.
 *
 * Credentials come exclusively from environment variables. See `.env.example`.
 */

import type { ClientConfig } from 'pg';

import { env } from '../config/env.js';

/** Resolve the env-driven database settings into a `pg` config object. */
export function buildClientConfig(): ClientConfig {
  return {
    // DATABASE_URL takes precedence when present, otherwise discrete PG* vars.
    connectionString: env.database.url,
    host: env.database.host,
    port: env.database.port,
    database: env.database.database,
    user: env.database.user,
    password: env.database.password,
    ssl: env.database.ssl === 'require' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: env.database.connectionTimeoutMillis,
  };
}

/** Human-readable description of the target, with the password redacted. */
export function describeTarget(): string {
  const { host, port, database, user, url } = env.database;

  if (url) {
    // Strip any credentials that may be embedded in the connection string.
    return url.replace(/\/\/([^@/]*)@/, '//***@');
  }

  return `postgresql://${user}@${host}:${port}/${database}`;
}
