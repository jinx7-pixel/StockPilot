/**
 * Test bootstrap — loaded via `node --import` before any test file.
 *
 * Runs before the application modules are imported, which matters because
 * `config/env.ts` reads `process.env` once at import time. dotenv does not
 * override variables that are already set, so assigning here wins over `.env`.
 *
 * The suite is pointed at a dedicated test database so it can truncate freely
 * without touching development data.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');

if (process.env.DATABASE_URL?.trim()) {
  throw new Error('Tests require discrete PG* settings so DATABASE_URL cannot override TEST_PGDATABASE.');
}

const testDatabase = process.env.TEST_PGDATABASE?.trim() || 'stockpilot_test';

if (testDatabase === process.env.PGDATABASE?.trim()) {
  throw new Error(
    `Refusing to run tests against the development database ("${testDatabase}"). ` +
      'Set TEST_PGDATABASE to a different name.',
  );
}

process.env.PGDATABASE = testDatabase;

// Keep the cookie usable over plain HTTP in the suite.
process.env.COOKIE_SECURE = 'false';
