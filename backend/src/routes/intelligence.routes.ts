/**
 * Intelligence API — read-only risk assessment.
 *
 * Nothing here mutates state: no stock write, no purchase order, no inventory
 * movement. A risk assessment must never change the position it measures, and
 * there is no recommendation action in this step.
 *
 * `business_id` comes only from the session. The schemas are `.strict()`, so even
 * attempting to pass it returns `400`.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import {
  listStockRiskQuerySchema,
  productIdParamSchema,
} from '../services/intelligence.schemas.js';
import * as intelligenceService from '../services/intelligence.service.js';
import type { AuthedRequest } from '../types/express.js';

export const intelligenceRouter: Router = Router();

intelligenceRouter.use(requireAuth);

/** Translate a Zod failure into a 400 that names the offending parameter. */
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

/**
 * GET /api/intelligence/stock-risk
 *
 * A corrupt fact (negative stock cannot exist under the inventory rules) is a
 * server-side fault, not a risk level, so it surfaces as a 500 rather than
 * being silently clamped to zero and reported as a healthy business.
 */
intelligenceRouter.get(
  '/stock-risk',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listStockRiskQuerySchema, req.query);

    const page = await intelligenceService.listStockRisk(req.auth.businessId, query);

    const { items, total, page: currentPage, limit, totalPages, riskCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      riskCounts,
    });
  }),
);

/** GET /api/intelligence/stock-risk/:productId */
intelligenceRouter.get(
  '/stock-risk/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await intelligenceService.getStockRisk(req.auth.businessId, productId);
    res.status(200).json({ data: result });
  }),
);
