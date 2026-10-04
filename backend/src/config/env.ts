/**
 * Application environment configuration.
 *
 * Every runtime value the API needs is read from the process environment so that
 * no credential, connection string or API key ever has to live in source code.
 * See `.env.example` for the expected shape of a local `.env` file.
 */

import 'dotenv/config';

export type NodeEnv = 'development' | 'test' | 'production';

function readString(name: string, fallback?: string): string {
  const raw = process.env[name]?.trim();

  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return raw;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();

  if (raw === undefined || raw === '') return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received: ${raw}`);
  }

  return parsed;
}

function readPositiveInt(name: string, fallback: number): number {
  const value = readInt(name, fallback);
  if (value <= 0) {
    throw new Error(`Environment variable ${name} must be greater than zero, received: ${value}`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();

  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;

  throw new Error(`Environment variable ${name} must be a boolean, received: ${raw}`);
}

type CookieSameSite = 'lax' | 'strict' | 'none';

function readSameSite(name: string, fallback: CookieSameSite): CookieSameSite {
  const value = readString(name, fallback).toLowerCase();
  if (value === 'lax' || value === 'strict' || value === 'none') return value;
  throw new Error(`Environment variable ${name} must be lax, strict or none. Received: ${value}`);
}

function readNodeEnv(): NodeEnv {
  const value = readString('NODE_ENV', 'development');
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }
  throw new Error(`NODE_ENV must be development, test or production. Received: ${value}`);
}

const nodeEnv = readNodeEnv();

/** Immutable, validated view of the environment. */
export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',

  /** HTTP server */
  port: readInt('PORT', 4000),
  host: readString('HOST', '0.0.0.0'),
  /**
   * Number of reverse-proxy hops to trust for `req.ip`. Must be correct in
   * production or rate limiting would key every request on the proxy's address.
   */
  trustProxy: readInt('TRUST_PROXY', 0),
  /** Comma-separated list of origins allowed by the CORS middleware. */
  corsOrigins: readString('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),

  /** PostgreSQL — connection settings only, no schema/table creation happens here. */
  database: {
    url: process.env.DATABASE_URL?.trim() || undefined,
    host: readString('PGHOST', 'localhost'),
    port: readInt('PGPORT', 5432),
    database: readString('PGDATABASE', 'stockpilot'),
    user: readString('PGUSER', 'stockpilot'),
    password: process.env.PGPASSWORD?.trim() || undefined,
    ssl: readString('PGSSLMODE', 'disable'),
    maxConnections: readInt('PGPOOL_MAX', 10),
    connectionTimeoutMillis: readInt('PGCONNECT_TIMEOUT_MS', 5_000),
    /**
     * Database used by the automated test suite. Tests must never touch
     * `database` above — they truncate tables freely.
     */
    testDatabase: readString('TEST_PGDATABASE', 'stockpilot_test'),
  },

  /** Authentication: opaque session token in an HTTP-only cookie. */
  auth: {
    cookieName: readString('SESSION_COOKIE_NAME', 'sp_session'),
    /** Session lifetime in days. */
    sessionTtlDays: readPositiveInt('SESSION_TTL_DAYS', 7),
    /**
     * `true` forces the Secure flag, `false` disables it, and the default
     * (`true` in production, `false` elsewhere) keeps local HTTP development
     * working without weakening production.
     */
    cookieSecure: readBoolean('COOKIE_SECURE', nodeEnv === 'production'),
    /**
     * `lax` is correct while the app and API share a site (subdomains included).
     * Cross-site deployments need `none`, which browsers only accept together
     * with the Secure flag.
     */
    cookieSameSite: readSameSite('COOKIE_SAME_SITE', 'lax'),
  },

  /**
   * Migration tooling (node-pg-migrate). These values affect only the
   * `npm run migration:*` commands, never the running API.
   */
  migrations: {
    /**
     * Directory holding migration files. Relative paths resolve from the
     * backend package root (where npm scripts execute).
     */
    dir: readString('MIGRATIONS_DIR', '../database/migrations'),
    /** Schema that migrations run against, and that holds the tracking table. */
    schema: readString('PGSCHEMA', 'public'),
    /** Table in which applied migrations are recorded. */
    table: readString('PGMIGRATIONS_TABLE', 'pgmigrations'),
  },

  /** Log verbosity: 'debug' | 'info' | 'warn' | 'error' | 'silent' */
  logLevel: readString('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
} as const;

export type Env = typeof env;
