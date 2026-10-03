import type { NextFunction, Request, Response } from 'express';

/** Minimal structural type so the middleware does not depend on Express internals. */
interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

/**
 * Terminal error handler. Keeps internal error details out of the response body
 * in production while still logging them server-side.
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

  const httpError = error as HttpError;
  const status = httpError.status ?? httpError.statusCode ?? 500;
  const isServerError = status >= 500;

  if (isServerError) {
    console.error('[error]', error);
  }

  res.status(status).json({
    status: 'error',
    error: isServerError ? 'Internal Server Error' : (httpError.message ?? 'Bad Request'),
    ...(process.env.NODE_ENV !== 'production' && !isServerError
      ? { code: httpError.code }
      : {}),
  });
}
