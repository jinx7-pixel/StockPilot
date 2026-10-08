/**
 * Analytics API — the facts layer.
 *
 * Read-only. Every figure is derived from the transactional tables at query
 * time, so analytics can never become a second source of truth.
 *
 * `business_id` comes only from the authenticated session and is never a query
 * parameter; the schemas are `.strict()`, so even attempting it returns `400`.
 * There is no user-controllable SQL fragment anywhere — `groupBy` is a validated
 * enum passed as a bound parameter.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { businessApiLimiter } from '../middlewares/rateLimit.js';
import {
  inventoryAnalyticsQuerySchema,
  listProductsQuerySchema,
  overviewQuerySchema,
  productDetailQuerySchema,
  productIdParamSchema,
  salesAnalyticsQuerySchema,
  suppliersQuerySchema,
} from '../services/analytics.schemas.js';
import * as analyticsService from '../services/analytics.service.js';
import type { AuthedRequest } from '../types/express.js';

export const analyticsRouter: Router = Router();

analyticsRouter.use(requireAuth);

// After authentication, so the rate-limit key is the session's user and business
// rather than a shared IP. Reads and writes draw from separate budgets.
analyticsRouter.use(businessApiLimiter);

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

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req: AuthedRequest, res) => {
    parseOrThrow(overviewQuerySchema, req.query);
    const overview = await analyticsService.getOverview(req.auth.businessId);
    res.status(200).json({ data: overview });
  }),
);

analyticsRouter.get(
  '/sales',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(salesAnalyticsQuerySchema, req.query);
    const analytics = await analyticsService.getSalesAnalytics(req.auth.businessId, query);
    res.status(200).json({ data: analytics });
  }),
);

analyticsRouter.get(
  '/inventory',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(inventoryAnalyticsQuerySchema, req.query);
    const analytics = await analyticsService.getInventoryAnalytics(req.auth.businessId, query);
    res.status(200).json({ data: analytics });
  }),
);

/**
 * Declared before `/products/:productId` for clarity. Express matches on exact
 * segment count, so the literal path `/products` is not shadowed by the
 * parameterised route below it.
 */
analyticsRouter.get(
  '/products',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listProductsQuerySchema, req.query);
    const page = await analyticsService.listProductAnalytics(req.auth.businessId, query);

    const { items, total, totalPages } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: page.page, limit: page.limit, totalPages },
    });
  }),
);

analyticsRouter.get(
  '/products/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const query = parseOrThrow(productDetailQuerySchema, req.query);
    const detail = await analyticsService.getProductAnalytics(
      req.auth.businessId,
      productId,
      query,
    );
    res.status(200).json({ data: detail });
  }),
);

analyticsRouter.get(
  '/suppliers',
  asyncHandler(async (req: AuthedRequest, res) => {
    parseOrThrow(suppliersQuerySchema, req.query);
    const suppliers = await analyticsService.getSupplierAnalytics(req.auth.businessId);
    res.status(200).json({ data: suppliers });
  }),
);
