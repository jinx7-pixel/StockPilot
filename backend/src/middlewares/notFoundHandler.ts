import type { NextFunction, Request, Response } from 'express';

/** Catch-all for requests that matched no route. */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    status: 'error',
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
}
