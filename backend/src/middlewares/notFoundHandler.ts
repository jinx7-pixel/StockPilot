import type { NextFunction, Request, Response } from 'express';

/**
 * Catch-all for requests that matched no route.
 *
 * The body mirrors `NotFoundError`, so a client sees one 404 shape whether the
 * path was a real route reached with a bad id or not a route at all — and so
 * `error` / `code` can be read without first checking which happened.
 *
 * It deliberately does **not** reflect the request URL. An earlier version put
 * `Cannot GET ${req.originalUrl}` in a `message` field, which echoed the query
 * string straight back: list endpoints accept a `search` matched against
 * customer names and phone numbers, and a frontend or proxy that logged
 * response bodies would have captured it. Step 10B removed the same leak from
 * the access log; this closes the response side.
 *
 * The request id is on the `X-Request-Id` response header, not here, so that two
 * different 404s remain byte-identical in the body — which several tenancy tests
 * rely on.
 */
export function notFoundHandler(_req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    status: 'error',
    error: 'Not Found',
    code: 'NOT_FOUND',
  });
}