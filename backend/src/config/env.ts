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

/**
 * PostgreSQL SSL modes this application understands.
 *
 * The list matches exactly what `pg` recognises. Anything outside it is rejected
 * rather than ignored — see {@link readSslMode} for why that matters.
 */
const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'no-verify', 'verify-ca', 'verify-full'] as const;

export type PgSslMode = (typeof SSL_MODES)[number];

/** Modes in which a successful connection *guarantees* an encrypted session. */
const TLS_ENFORCING_MODES: readonly PgSslMode[] = ['require', 'no-verify', 'verify-ca', 'verify-full'];

/**
 * Read and validate `PGSSLMODE`.
 *
 * ## Why an unrecognised value must be an error
 *
 * `pg` resolves its own SSL configuration from `process.env.PGSSLMODE` whenever
 * the caller passes `ssl: undefined`, and its fallback for a value it does not
 * recognise is **plaintext**. A typo therefore used to downgrade an intended TLS
 * connection to an unencrypted one with no error and no warning — the exact
 * failure a TLS setting exists to prevent.
 *
 * Trimming made it worse in a subtle way: this module trimmed the value while
 * `pg` read the raw one, so even a valid mode with stray whitespace parsed as
 * valid here and as unknown to `pg`, and the connection went out in plaintext.
 *
 * Validating here, and resolving the mode explicitly in `db/config.ts`, removes
 * both problems. `db/config.ts` no longer depends on `pg` reading the ambient
 * environment at all.
 */
function readSslMode(name: string, fallback: PgSslMode): PgSslMode {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim().toLowerCase();

  if ((SSL_MODES as readonly string[]).includes(value)) return value as PgSslMode;

  throw new Error(
    `Environment variable ${name} must be one of: ${SSL_MODES.join(', ')}. Received: ${JSON.stringify(raw)}`,
  );
}

/**
 * Read `TRUST_PROXY`.
 *
 * Express accepts either a hop count or `true` ("trust every proxy"). Rejecting
 * anything else — a negative number, a hostname, a typo — stops an operator
 * believing they have configured proxy trust when they have not.
 */
function readTrustProxy(name: string): number | true {
  const raw = readString(name).trim().toLowerCase();
  if (raw === 'true') return true;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || String(parsed) !== raw || parsed < 0) {
    throw new Error(
      `Environment variable ${name} must be a non-negative integer or "true". Received: ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
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
   * Number of reverse-proxy hops to trust for `req.ip`, or `true` to trust any.
   *
   * Required in production: behind a load balancer a wrong value makes every
   * client share one rate-limit bucket, and an over-generous value lets any
   * caller forge `X-Forwarded-For`. Development and test keep the local default.
   */
  trustProxy: nodeEnv === 'production' ? readTrustProxy('TRUST_PROXY') : readInt('TRUST_PROXY', 0),
  /**
   * Comma-separated list of origins allowed by the CORS middleware.
   *
   * Production has **no default**: the local fallback is `http://localhost:5173`,
   * so a deployment that forgot this variable would silently admit nothing and
   * present a baffling CORS failure with no error anywhere. Requiring it makes the
   * operator state which frontends may call the API.
   */
  corsOrigins: (
    nodeEnv === 'production'
      ? readString('CORS_ORIGINS')
      : readString('CORS_ORIGINS', 'http://localhost:5173')
  )
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
    /**
     * Validated mode, resolved into an explicit `ssl` value by `db/config.ts`.
     * The default of `disable` is a deliberate local-development convenience;
     * production is not allowed to keep it (see {@link assertProductionSafe}).
     */
    sslMode: readSslMode('PGSSLMODE', 'disable'),
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

/**
 * Fail-fast rules that apply **only** in production.
 *
 * ## Why these exist
 *
 * Every one of these values has a working local default, and that is the whole
 * problem: a deployment that forgets to set them starts cleanly and then behaves
 * unsafely — plaintext database traffic, an unencrypted session cookie, every
 * client collapsed into one rate-limit bucket, or a CORS allow-list that silently
 * permits only localhost. None of those announce themselves at boot.
 *
 * Requiring them turns a silent misconfiguration into a startup error naming the
 * variable and the accepted values.
 *
 * ## Secret hygiene
 *
 * No message here echoes a configured value for a variable that can carry a
 * credential. The variable *name* and the *acceptable values* are reported; the
 * content is not, so a stack trace or log line cannot become a credential leak.
 */
export function assertProductionSafe(config: Env): void {
  if (!config.isProduction) return;

  const problems: string[] = [];

  // -- Database connectivity ------------------------------------------------

  if (config.database.url === undefined && config.database.password === undefined) {
    problems.push(
      'Set DATABASE_URL, or PGPASSWORD, so the API authenticates to PostgreSQL. ' +
        'Without either it would attempt an unauthenticated connection.',
    );
  }
  if (config.database.url === undefined && config.database.host === 'localhost') {
    problems.push(
      'PGHOST defaults to localhost. Set PGHOST to the database host in production.',
    );
  }
  if (config.database.url === undefined && config.database.database === 'stockpilot') {
    problems.push('PGDATABASE defaults to "stockpilot". Set PGDATABASE explicitly.');
  }
  if (config.database.url === undefined && config.database.user === 'stockpilot') {
    problems.push('PGUSER defaults to "stockpilot". Set PGUSER explicitly.');
  }

  // -- Transport security ----------------------------------------------------

  if (!TLS_ENFORCING_MODES.includes(config.database.sslMode)) {
    problems.push(
      `PGSSLMODE is "${config.database.sslMode}", which does not guarantee an encrypted ` +
        `database session. Use one of: ${TLS_ENFORCING_MODES.join(', ')}. ` +
        `"allow" and "prefer" fall back to plaintext when the server does not offer TLS.`,
    );
  }

  // -- Session cookie --------------------------------------------------------

  if (!config.auth.cookieSecure) {
    problems.push(
      'COOKIE_SECURE is false. The session cookie would be sent over plain HTTP. ' +
        'It must be true in production.',
    );
  }
  if (config.auth.cookieSameSite === 'none' && !config.auth.cookieSecure) {
    problems.push('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true; browsers reject the pair otherwise.');
  }

  // -- CORS ------------------------------------------------------------------

  if (config.corsOrigins.length === 0) {
    problems.push('CORS_ORIGINS is empty. Set the frontend origin explicitly.');
  }
  if (config.corsOrigins.some((origin) => origin === '*')) {
    // `credentials: true` plus a wildcard origin is rejected by browsers and, if
    // it ever were honoured, would allow any site to call the API with cookies.
    problems.push('CORS_ORIGINS must not contain "*" in production; list the exact frontend origins.');
  }
  if (config.corsOrigins.some((origin) => origin.startsWith('http://') && !origin.includes('localhost'))) {
    problems.push('CORS_ORIGINS must use https:// in production; plain http origins can be tampered with in transit.');
  }

  if (problems.length > 0) {
    throw new Error(
      `Unsafe production configuration:\n  - ${problems.join('\n  - ')}\n\n` +
        'See backend/.env.example for the expected values.',
    );
  }
}

assertProductionSafe(env);
