/**
 * Sales API.
 *
 * There is deliberately **no** `PATCH` or `DELETE` for a sale. A sale is a
 * completed transaction, and its stock effect is an immutable ledger entry —
 * editing either would rewrite history.
 *
 * Creating a sale writes the header, its lines and the `out` inventory movements
 * in one transaction, so a rejected sale leaves no trace. See
 * `services/sales.service.ts`.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requirePolicy } from '../auth/policy.js';
import { businessApiLimiter } from '../middlewares/rateLimit.js';
import { createSaleSchema, listSalesQuerySchema, saleIdParamSchema } from '../services/sales.schemas.js';
import * as salesService from '../services/sales.service.js';
import type { AuthedRequest } from '../types/express.js';

export const salesRouter: Router = Router();

salesRouter.use(requireAuth);

// After authentication, so the rate-limit key is the session's user and business
// rather than a shared IP. Reads and writes draw from separate budgets.
salesRouter.use(businessApiLimiter);

/** Translate a Zod failure into a 400 that names the offending field. */
function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'request';
    throw new ValidationError(
      issue ? `${field}: ${issue.message}` : 'Invalid request.',
      'INVALID_REQUEST',
    );
  }

  return result.data;
}

/** GET /api/sales — paginated list with search, status and date filters. */
salesRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listSalesQuerySchema, req.query);
    const { items, page, limit, total, totalPages } = await salesService.listBusinessSales(
      req.auth.businessId,
      query,
    );

    res.status(200).json({ data: items, meta: { total, page, limit, totalPages } });
  }),
);

/** POST /api/sales — record a sale and reduce stock in one transaction. */
salesRouter.post(
  '/',
  requirePolicy('sale.create'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = parseOrThrow(createSaleSchema, req.body);

    const sale = await salesService.createSale(
      req.auth.businessId,
      // The actor comes from the session, never from the request body.
      req.auth.id,
      input,
    );

    res.status(201).json({ data: sale });
  }),
);

/** GET /api/sales/:id — one sale with its lines. */
salesRouter.get(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(saleIdParamSchema, req.params);
    const sale = await salesService.getSale(req.auth.businessId, id);
    res.status(200).json({ data: sale });
  }),
);
