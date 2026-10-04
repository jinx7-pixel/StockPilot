/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * pipeline instead of becoming an unhandled rejection.
 *
 * Express 5 already forwards rejections from async handlers, so this is
 * belt-and-braces rather than a requirement — it keeps the behaviour explicit
 * and identical if a handler is ever mounted on Express 4.
 *
 * The generic parameter lets a handler behind `requireAuth` declare
 * `req: AuthedRequest` and use `req.auth` without a cast at every call site.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncHandler<Req extends Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler<Req extends Request = Request>(
  handler: AsyncHandler<Req>,
): RequestHandler {
  // Safe: `Req` is always a subtype of `Request`; the only difference is that
  // the caller has already established `auth` is present.
  const run = handler as AsyncHandler<Request>;

  return (req, res, next) => {
    run(req, res, next).catch(next);
  };
}
