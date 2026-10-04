import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors.js';

/** Minimal structural type so the middleware does not depend on Express internals. */
interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

/**
 * Terminal error handler.
 *
 * `AppError`s carry a safe, client-facing message and are returned as-is.
 * Anything else is an unexpected fault: it is logged in full and reported as a
 * generic 500, so stack traces and internal messages never reach a client.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      status: 'error',
      error: error.message,
      code: error.code,
    });
    return;
  }

  const httpError = error as HttpError;
  const status = httpError.status ?? httpError.statusCode ?? 500;
  const isClientError = status < 500;

  if (isClientError) {
    // A 4xx that is not an AppError is usually a framework-level rejection
    // (e.g. malformed JSON). It is safe to surface its message.
    res.status(status).json({
      status: 'error',
      error: httpError.message ?? 'Bad Request',
      code: httpError.code ?? 'BAD_REQUEST',
    });
    return;
  }

  console.error('[error]', error);

  res.status(500).json({
    status: 'error',
    // Deliberately generic: never leak internals in production.
    error: 'Internal Server Error',
  });
}
