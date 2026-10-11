import { Router } from 'express';

import { checkConnection } from '../db/pool.js';

const SERVICE_NAME = 'stockpilot-api';

/** Must match `health.routes.ts` so both probes are identifiable side by side. */
export const readyRouter: Router = Router();

/**
 * GET /api/ready
 *
 * **Readiness** probe: is this instance able to serve real traffic *right now*?
 *
 * Deliberately distinct from `/api/health`, which is **liveness**: "this process
 * is alive" must stay answerable while the database is down, otherwise a
 * database outage would cause an orchestrator to restart a perfectly healthy
 * process and turn a dependency failure into an availability one.
 *
 * The response body is two fixed strings. The database error — host, port,
 * DSN, driver message — is logged server-side by {@link checkConnection} in
 * production and never reaches the caller, because a probe endpoint is
 * unauthenticated and must not become an information leak.
 *
 * Like the health route this applies no `requireAuth` and no rate limiter: it
 * must answer for an instance that has lost its database, and before any
 * session exists.
 */
readyRouter.get('/ready', async (_req, res) => {
  const ready = await checkConnection();

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    service: SERVICE_NAME,
  });
});