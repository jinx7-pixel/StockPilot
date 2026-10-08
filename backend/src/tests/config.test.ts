/**
 * Production configuration hardening tests.
 *
 * ## Why this file exists
 *
 * Every value below has a working local default, which is exactly why the
 * misconfigurations it guards against were silent: a production deployment that
 * forgets `PGSSLMODE` connects in plaintext and still boots; one that sets
 * `TRUST_PROXY=0` behind a load balancer collapses every client into a single
 * rate-limit bucket without complaint.
 *
 * ## How production configuration is exercised
 *
 * `config/env.ts` reads `process.env` at module scope, so each scenario imports a
 * **fresh module instance** via a cache-busting specifier. That re-evaluates the
 * module against a mutated environment without a separate process, and without
 * touching the database — these tests need no server and no PostgreSQL.
 *
 * `dotenv/config` never overrides a variable that is already set, so the values
 * assigned here are the ones the module sees.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';

import type { ClientConfig } from 'pg';

import type { Env } from '../config/env.js';
import { resolveSsl } from '../db/config.js';

/** What a freshly evaluated configuration module hands back. */
interface LoadedConfig {
  env: Env;
  buildClientConfig: () => ClientConfig;
}

/** Snapshot of the process environment, restored after every test. */
const ORIGINAL_ENV = { ...process.env };

let moduleCounter = 0;

/**
 * Import a fresh copy of the configuration modules under `overrides`.
 *
 * The cache-busting query string is what forces a re-evaluation; without it Node
 * would hand back the module already loaded by the test bootstrap.
 */
async function loadConfig(overrides: Record<string, string | undefined>): Promise<LoadedConfig> {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  moduleCounter += 1;
  const envModule = await import(`../config/env.js?case=${moduleCounter}`);
  const dbModule = await import(`../db/config.js?case=${moduleCounter}`);
  return { env: envModule.env, buildClientConfig: dbModule.buildClientConfig };
}

/** A production environment that satisfies every fail-fast rule. */
const VALID_PRODUCTION = {
  NODE_ENV: 'production',
  PGHOST: 'db.internal',
  PGPORT: '5432',
  PGDATABASE: 'stockpilot_prod',
  PGUSER: 'stockpilot_app',
  PGPASSWORD: 'a-real-password',
  PGSSLMODE: 'require',
  TRUST_PROXY: '1',
  CORS_ORIGINS: 'https://app.example.com',
  COOKIE_SECURE: 'true',
  // Not production-relevant, cleared so the local .env cannot leak in.
  DATABASE_URL: undefined,
} as const;

/** Capture the error thrown while loading, or `null` if it loaded cleanly. */
async function loadError(
  overrides: Record<string, string | undefined>,
): Promise<Error | null> {
  try {
    await loadConfig(overrides);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

afterEach(() => {
  // Every scenario mutates `process.env`; leaving it dirty would make the rest
  // of the suite depend on test ordering.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
});

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------

describe('Configuration — production succeeds when everything required is set', () => {
  it('accepts a fully specified production environment', async () => {
    const error = await loadError(VALID_PRODUCTION);
    assert.equal(error, null, error?.message);
  });

  it('reports itself as production and applies the configured values', async () => {
    const { env } = await loadConfig(VALID_PRODUCTION);

    assert.equal(env.isProduction, true);
    assert.equal(env.trustProxy, 1);
    assert.deepEqual(env.corsOrigins, ['https://app.example.com']);
    assert.equal(env.auth.cookieSecure, true);
    assert.equal(env.database.sslMode, 'require');
    assert.equal(env.database.host, 'db.internal');
    assert.equal(env.database.user, 'stockpilot_app');
  });

  it('accepts TRUST_PROXY=true as an explicit trust-everything choice', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, TRUST_PROXY: 'true' });
    assert.equal(error, null, error?.message);

    const { env } = await loadConfig({ ...VALID_PRODUCTION, TRUST_PROXY: 'true' });
    assert.equal(env.trustProxy, true);
  });

  it('accepts a DATABASE_URL instead of discrete variables', async () => {
    const error = await loadError({
      ...VALID_PRODUCTION,
      PGPASSWORD: undefined,
      DATABASE_URL: 'postgresql://app:secret@db.internal:5432/stockpilot_prod',
    });
    assert.equal(error, null, error?.message);
  });
});

describe('Configuration — production requires real database settings', () => {
  it('fails when no password or connection URL is provided', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGPASSWORD: undefined });
    assert.ok(error, 'production must refuse to run unauthenticated');
    assert.match(error!.message, /DATABASE_URL/);
    assert.match(error!.message, /PGPASSWORD/);
  });

  it('fails when the host is still the localhost default', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGHOST: undefined });
    assert.ok(error);
    assert.match(error!.message, /PGHOST/);
  });

  it('fails when the database name is still the local default', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGDATABASE: undefined });
    assert.ok(error);
    assert.match(error!.message, /PGDATABASE/);
  });

  it('reports every problem at once rather than one per restart', async () => {
    const error = await loadError({
      ...VALID_PRODUCTION,
      PGPASSWORD: undefined,
      PGHOST: undefined,
      PGDATABASE: undefined,
      PGUSER: undefined,
    });

    assert.ok(error);
    // All four must appear in one message, so an operator fixes them in one pass.
    assert.match(error!.message, /PGPASSWORD/);
    assert.match(error!.message, /PGHOST/);
    assert.match(error!.message, /PGDATABASE/);
    assert.match(error!.message, /PGUSER/);
  });
});

describe('Configuration — PostgreSQL SSL', () => {
  it('rejects an unrecognised PGSSLMODE instead of silently going plaintext', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGSSLMODE: 'requrie' });
    assert.ok(error, 'a typo must fail loudly');
    assert.match(error!.message, /PGSSLMODE/);
    assert.match(error!.message, /verify-full/);
  });

  it('normalises a mode that carries stray whitespace', async () => {
    // Previously this value parsed as valid in `env` but was unknown to `pg`,
    // which then connected in plaintext with no error at all. The mode is now
    // trimmed and lower-cased, and handed to `pg` explicitly, so neither a
    // trailing space nor an upper-case spelling can be silently ignored.
    const { env } = await loadConfig({ ...VALID_PRODUCTION, PGSSLMODE: 'verify-full ' });
    assert.equal(env.database.sslMode, 'verify-full');

    const upper = await loadConfig({ ...VALID_PRODUCTION, PGSSLMODE: 'REQUIRE' });
    assert.equal(upper.env.database.sslMode, 'require');
  });

  it('accepts every mode pg understands', async () => {
    // `disable`, `allow` and `prefer` are legal *values* but are refused by the
    // separate production TLS rule; the rest must parse cleanly.
    for (const mode of ['require', 'no-verify', 'verify-ca', 'verify-full']) {
      const error = await loadError({ ...VALID_PRODUCTION, PGSSLMODE: mode });
      assert.equal(error, null, `${mode} should be accepted: ${error?.message}`);
    }
  });

  it('refuses PGSSLMODE=disable in production', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGSSLMODE: 'disable' });
    assert.ok(error, 'production must not silently disable TLS');
    assert.match(error!.message, /does not guarantee an encrypted database session/);
  });

  it('refuses PGSSLMODE=prefer in production because it can fall back to plaintext', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGSSLMODE: 'prefer' });
    assert.ok(error);
    assert.match(error!.message, /fall back to plaintext/);
  });
});

describe('Configuration — resolveSsl maps each mode explicitly', () => {
  it('maps every supported mode to the value pg would have used', () => {
    // Deliberately identical to pg's own mapping, so no existing connection
    // changes behaviour — only the previously silent typo becomes an error.
    assert.equal(resolveSsl('disable'), false);
    assert.equal(resolveSsl('allow'), undefined);
    assert.deepEqual(resolveSsl('require'), { rejectUnauthorized: false });
    assert.deepEqual(resolveSsl('no-verify'), { rejectUnauthorized: false });
    assert.equal(resolveSsl('verify-ca'), true);
    assert.equal(resolveSsl('verify-full'), true);
    assert.equal(resolveSsl('prefer'), true);
  });

  it('never returns undefined for a mode that must encrypt', () => {
    for (const mode of ['require', 'no-verify', 'verify-ca', 'verify-full'] as const) {
      assert.notEqual(
        resolveSsl(mode),
        undefined,
        `${mode} must produce an explicit ssl value, not defer to pg`,
      );
    }
  });

  it('always carries an explicit ssl value, so pg never infers it from the environment', async () => {
    // The invariant that matters: `db/config.ts` must never pass `ssl: undefined`
    // for a mode that should encrypt, because that is what let `pg` fall back to
    // reading the ambient `PGSSLMODE` and guessing.
    const { buildClientConfig } = await loadConfig({ NODE_ENV: 'development' });
    assert.ok('ssl' in buildClientConfig(), 'the ssl key must always be present');
  });

  it('leaves development on its documented plaintext default', async () => {
    const { buildClientConfig } = await loadConfig({ NODE_ENV: 'development', PGSSLMODE: undefined });
    assert.equal(buildClientConfig().ssl, false);
  });
});

describe('Configuration — TRUST_PROXY', () => {
  it('is required in production rather than silently defaulting to 0', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, TRUST_PROXY: undefined });
    assert.ok(error, 'production must state its proxy topology');
    assert.match(error!.message, /TRUST_PROXY/);
  });

  it('rejects a negative hop count', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, TRUST_PROXY: '-1' });
    assert.ok(error);
    assert.match(error!.message, /TRUST_PROXY/);
  });

  it('rejects a non-numeric value', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, TRUST_PROXY: 'one-proxy' });
    assert.ok(error);
    assert.match(error!.message, /TRUST_PROXY/);
  });

  it('allows an explicit 0 for a directly exposed deployment', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, TRUST_PROXY: '0' });
    assert.equal(error, null, error?.message);
  });

  it('keeps the development default of 0', async () => {
    const { env } = await loadConfig({ NODE_ENV: 'development', TRUST_PROXY: undefined });
    assert.equal(env.trustProxy, 0);
  });

  it('keeps the test default of 0', async () => {
    const { env } = await loadConfig({ NODE_ENV: 'test', TRUST_PROXY: undefined });
    assert.equal(env.trustProxy, 0);
  });
});

describe('Configuration — cookie security cannot silently downgrade', () => {
  it('refuses COOKIE_SECURE=false in production', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, COOKIE_SECURE: 'false' });
    assert.ok(error, 'the session cookie must not be sent over plain HTTP');
    assert.match(error!.message, /COOKIE_SECURE/);
  });

  it('refuses a SameSite=none cookie without the Secure flag', async () => {
    const error = await loadError({
      ...VALID_PRODUCTION,
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'none',
    });
    assert.ok(error);
    assert.match(error!.message, /COOKIE_SAME_SITE=none requires COOKIE_SECURE=true/);
  });

  it('defaults the Secure flag to true in production when unset', async () => {
    const { env } = await loadConfig({ ...VALID_PRODUCTION, COOKIE_SECURE: undefined });
    assert.equal(env.auth.cookieSecure, true);
  });

  it('keeps cookies workable for local HTTP development', async () => {
    const { env } = await loadConfig({ NODE_ENV: 'development', COOKIE_SECURE: undefined });
    assert.equal(env.auth.cookieSecure, false, 'local dev must still work over http');
    assert.equal(env.auth.cookieSameSite, 'lax');
  });
});

describe('Configuration — CORS', () => {
  it('requires an explicit production origin', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, CORS_ORIGINS: undefined });
    assert.ok(error, 'production must not silently allow only localhost');
    assert.match(error!.message, /CORS_ORIGINS/);
  });

  it('refuses a wildcard origin in production', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, CORS_ORIGINS: '*' });
    assert.ok(error);
    assert.match(error!.message, /must not contain "\*"/);
  });

  it('refuses a plain-http origin in production', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, CORS_ORIGINS: 'http://app.example.com' });
    assert.ok(error);
    assert.match(error!.message, /https:\/\//);
  });

  it('accepts several explicit https origins', async () => {
    const { env } = await loadConfig({
      ...VALID_PRODUCTION,
      CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
    });
    assert.deepEqual(env.corsOrigins, ['https://app.example.com', 'https://admin.example.com']);
  });

  it('keeps the localhost default for development', async () => {
    const { env } = await loadConfig({ NODE_ENV: 'development', CORS_ORIGINS: undefined });
    assert.deepEqual(env.corsOrigins, ['http://localhost:5173']);
  });
});

describe('Configuration — secrets never appear in error messages', () => {
  it('does not echo a password when production configuration is rejected', async () => {
    const secret = 'sup3r-s3cret-do-not-log';
    const error = await loadError({
      ...VALID_PRODUCTION,
      PGPASSWORD: secret,
      PGSSLMODE: 'disable',
    });

    assert.ok(error, 'the SSL rule should still fire');
    assert.ok(
      !error!.message.includes(secret),
      `the password leaked into the error message: ${error!.message}`,
    );
  });

  it('does not echo a password from a connection string', async () => {
    const secret = 'another-secret-value';
    const error = await loadError({
      ...VALID_PRODUCTION,
      PGSSLMODE: 'disable',
      DATABASE_URL: `postgresql://app:${secret}@db.internal:5432/stockpilot_prod`,
    });

    assert.ok(error);
    assert.ok(!error!.message.includes(secret), 'the connection-string password leaked');
  });

  it('does not echo credentials when a TRUST_PROXY value is malformed', async () => {
    const error = await loadError({
      ...VALID_PRODUCTION,
      TRUST_PROXY: 'proxy.internal:8080',
    });

    assert.ok(error);
    // The rejected value may be echoed for a non-secret variable; the password
    // must never be, so the assertion is specifically about the secret.
    assert.ok(!error!.message.includes(VALID_PRODUCTION.PGPASSWORD));
  });

  it('names the variable and the acceptable values instead', async () => {
    const error = await loadError({ ...VALID_PRODUCTION, PGSSLMODE: 'requrie' });

    assert.ok(error);
    assert.match(error!.message, /PGSSLMODE/);
    assert.match(error!.message, /disable, allow, prefer, require/);
  });
});

describe('Configuration — development and test are untouched', () => {
  it('starts with no production-only variables set', async () => {
    const error = await loadError({ NODE_ENV: 'development' });
    assert.equal(error, null, error?.message);
  });

  it('starts with only NODE_ENV=test', async () => {
    const error = await loadError({ NODE_ENV: 'test' });
    assert.equal(error, null, error?.message);
  });

  it('still rejects an invalid PGSSLMODE outside production', async () => {
    // The typo guard protects every environment, not just production: a local
    // developer should not silently lose TLS either.
    const error = await loadError({ NODE_ENV: 'development', PGSSLMODE: 'not-a-mode' });
    assert.ok(error);
    assert.match(error!.message, /PGSSLMODE/);
  });

  it('still rejects a malformed TRUST_PROXY outside production', async () => {
    const error = await loadError({ NODE_ENV: 'development', TRUST_PROXY: 'lots' });
    assert.ok(error);
    assert.match(error!.message, /TRUST_PROXY/);
  });

  it('rejects an invalid NODE_ENV', async () => {
    const error = await loadError({ NODE_ENV: 'staging' });
    assert.ok(error);
    assert.match(error!.message, /NODE_ENV/);
  });
});