import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFoundHandler.js';
import { apiRouter } from './routes/index.js';

/**
 * Build the Express application.
 *
 * Kept separate from `server.ts` so the app can be mounted in tests without
 * binding a network port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  // Without this, `req.ip` is the proxy's address and every request shares one
  // rate-limit bucket.
  app.set('trust proxy', env.trustProxy);

  app.use(
    cors({
      origin: env.corsOrigins,
      // Required for the session cookie to survive cross-origin requests.
      credentials: true,
    }),
  );

  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Baseline request logging. Kept dependency-free on purpose.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(
        `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
      );
    });

    next();
  });

  app.use('/api', apiRouter);

  app.get('/', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'stockpilot-api',
      docs: '/api/health',
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
