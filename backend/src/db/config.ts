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

import { env, type PgSslMode } from '../config/env.js';

/**
 * The session timezone every PostgreSQL connection is pinned to.
 *
 * ## Why this is pinned rather than assumed
 *
 * Three timezone conventions would otherwise coexist silently. Some queries use
 * explicit `AT TIME ZONE 'UTC'`; others call `date_trunc('day', …)` and
 * `now()`, which resolve against whatever the **session** timezone happens to be.
 * That defaults to the PostgreSQL *server's* setting, not the application's — so
 * the same query can bucket a sale into different calendar days depending on
 * where the database happens to run.
 *
 * The damage is not cosmetic. `COUNT(DISTINCT date_trunc('day', sold_at))` is a
 * direct input to the active-sales-days evidence gate and to every confidence
 * ladder, so a session-timezone-dependent bucket can flip an Overstock verdict or
 * move a confidence level.
 *
 * Pinning at the connection makes the session timezone deterministic and
 * identical in production, in CI and on a developer machine in any region. The
 * explicit `AT TIME ZONE 'UTC'` calls elsewhere stay regardless: they document
 * intent at the query and would keep the queries correct even if someone later
 * connects outside this factory.
 */
const SESSION_TIMEZONE_OPTIONS = '-c timezone=UTC';

/**
 * Translate a validated `PGSSLMODE` into the value `pg` should use.
 *
 * ## Why this is explicit rather than delegated
 *
 * `pg` resolves SSL from `process.env.PGSSLMODE` on its own **only** when the
 * caller passes `ssl: undefined`, and its fallback for a value it does not
 * recognise is plaintext. That meant a typo silently downgraded an intended TLS
 * connection, and a valid mode carrying stray whitespace was parsed as valid
 * here but unknown to `pg` — so it went out in plaintext too.
 *
 * Passing an explicit value for every supported mode removes the dependency on
 * `pg` reading the ambient environment. The mapping is deliberately identical to
 * `pg`'s own, so no connection changes behaviour; only the previously silent
 * typo becomes an error at startup.
 */
export function resolveSsl(mode: PgSslMode): ClientConfig['ssl'] {
  switch (mode) {
    case 'disable':
      return false;
    case 'allow':
      return undefined; // `pg` treats an undefined `ssl` as no TLS request.
    case 'require':
    case 'no-verify':
      // Encrypt, but do not validate the server certificate. Matches both
      // `pg`'s mapping and StockPilot's pre-existing behaviour for `require`.
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
    case 'prefer':
      return true;
  }
}

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
    // Always explicit, so `pg` never has to infer TLS from the environment.
    ssl: resolveSsl(env.database.sslMode),
    connectionTimeoutMillis: env.database.connectionTimeoutMillis,
    // Sent as the startup packet by `pg`, before any query runs, so the very
    // first statement of a fresh connection already sees UTC.
    options: SESSION_TIMEZONE_OPTIONS,
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
