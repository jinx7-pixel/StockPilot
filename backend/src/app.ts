import crypto from 'node:crypto';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFoundHandler.js';
import { apiRouter } from './routes/index.js';

/** Header carrying the correlation id, in and out. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * The only shape of client id that is trusted. Deliberately narrow — see the
 * middleware below for why each part matters.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

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

  /**
   * Attach a correlation id to every request, before anything that might want
   * to log or fail.
   *
   * A client-supplied `X-Request-Id` is honoured **only** when it matches
   * `^[A-Za-z0-9_-]{8,64}$`. That single pattern is the whole safety story:
   *
   *  - bounded, so a client cannot inflate logs or the response header;
   *  - no CR or LF, so a hostile value cannot forge an extra log line;
   *  - no `<`, `>` or `"`, so the value is inert if anything ever reflects it;
   *  - ASCII only, so it survives log aggregation and header round-trips.
   *
   * Anything else — empty, too short, too long, whitespace-bearing, non-ASCII,
   * HTML-like — is discarded and replaced with a fresh UUID. A rejected value
   * never reaches a log line or a response.
   *
   * The id lives in the **header**, never the body. Several tests require two
   * different responses to be byte-identical (a cross-tenant 404 and an unknown
   * id; an unknown email and a wrong password), and a per-request id in the
   * body would make them differ.
   */
  app.use((req, res, next) => {
    const supplied = req.header(REQUEST_ID_HEADER);
    const requestId =
      supplied !== undefined && REQUEST_ID_PATTERN.test(supplied)
        ? supplied
        : crypto.randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  });

  // Baseline request logging. Kept dependency-free on purpose.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    /**
     * The path only — never the query string.
     *
     * `search` parameters are matched against customer names, phone numbers and
     * free-text notes, so `req.originalUrl` wrote real personal data into stdout
     * and from there into whatever log aggregator is attached, indefinitely.
     * `req.path` is the pathname with the query already stripped.
     *
     * It is read here, before `next()`, rather than inside the `finish` handler:
     * Express rewrites `req.url` while routing and restores it afterwards, so
     * `req.path` inside the handler would be reading a value that had been
     * mutated in between.
     */
    const requestPath = req.path;

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(
        `[http] ${req.requestId} ${req.method} ${requestPath} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
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
