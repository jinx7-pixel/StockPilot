import { Router } from 'express';

const SERVICE_NAME = 'stockpilot-api';

export const healthRouter: Router = Router();

/**
 * GET /api/health
 *
 * Liveness/readiness probe. Intentionally cheap and dependency-free: it does not
 * touch the database so that a database outage cannot mask the fact that the HTTP
 * process itself is still serving traffic.
 */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: SERVICE_NAME,
  });
});
