/**
 * Recommendations API — read-only.
 *
 * GET only, by design and not by omission: there is no POST, PATCH, PUT or
 * DELETE on these routes, and a recommendation is never acted on here. Placing a
 * purchase order, adjusting stock, approving or dismissing anything belongs to
 * Step 11.10, which is a deliberate act by a person, not a side effect of
 * reading a screen.
 *
 * Tenant identity comes only from the authenticated session; the query schema is
 * `.strict()` and rejects `businessId` outright.
 */

import { Router } from 'express';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { businessApiLimiter } from '../middlewares/rateLimit.js';
import type { ZodType } from 'zod';

import type { AuthedRequest } from '../types/express.js';

import { productIdParamSchema } from '../services/intelligence.schemas.js';
import { listRecommendationsQuerySchema } from '../services/recommendations.schemas.js';
import * as recommendationsService from '../services/recommendations.service.js';

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw new ValidationError(
      issue ? `${field}: ${issue.message}` : 'Invalid request.',
      'INVALID_REQUEST',
    );
  }
  return result.data;
}

export const recommendationsRouter: Router = Router();

recommendationsRouter.use(requireAuth);

// After authentication, so the rate-limit key is the session's user and business
// rather than a shared IP.
recommendationsRouter.use(businessApiLimiter);

/**
 * GET /api/recommendations
 *
 * Wrapped in the application's standard `{ data }` envelope, like every other
 * list route. The contents inside `data` — `items`, `pagination` and
 * `recommendationCount` — are unchanged; only the outermost wrapping moved, so a
 * client that unwraps `data` once sees exactly what it always did.
 */
recommendationsRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listRecommendationsQuerySchema, req.query);

    const page = await recommendationsService.listRecommendations(req.auth.businessId, query);

    res.status(200).json({
      data: {
        items: page.items,
        pagination: page.pagination,
        recommendationCount: page.recommendationCount,
      },
    });
  }),
);

/** GET /api/recommendations/products/:productId */
recommendationsRouter.get(
  '/products/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await recommendationsService.getProductRecommendations(
      req.auth.businessId,
      productId,
    );
    res.status(200).json({ data: result });
  }),
);