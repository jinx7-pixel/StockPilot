/**
 * Products API.
 *
 * Thin by design: validate, delegate to the service, respond. No SQL and no
 * business rules live here.
 *
 * `DELETE /:id` is a **soft delete** (deactivate) and therefore non-destructive
 * from a catalog standpoint, so it is available to staff as well as owners. See
 * `services/product.service.ts` for the reasoning.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requirePolicy } from '../auth/policy.js';
import { businessApiLimiter } from '../middlewares/rateLimit.js';
import * as productService from '../services/product.service.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
} from '../services/product.schemas.js';
import type { AuthedRequest } from '../types/express.js';

export const productRouter: Router = Router();

productRouter.use(requireAuth);

// After authentication, so the rate-limit key is the session's user and business
// rather than a shared IP. Reads and writes draw from separate budgets.
productRouter.use(businessApiLimiter);

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

productRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listProductsQuerySchema, req.query);
    const result = await productService.listProductsForBusiness(req.auth.businessId, query);

    const { items, total, page, limit, totalPages } = result;
    res.status(200).json({ data: items, meta: { total, page, limit, totalPages } });
  }),
);

productRouter.post(
  '/',
  requirePolicy('product.create'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = parseOrThrow(createProductSchema, req.body);
    const product = await productService.createProductForBusiness(req.auth.businessId, input);
    res.status(201).json({ data: product });
  }),
);

productRouter.get(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(productIdParamSchema, req.params);
    const product = await productService.getProduct(req.auth.businessId, id);
    res.status(200).json({ data: product });
  }),
);

productRouter.patch(
  '/:id',
  requirePolicy('product.update'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(productIdParamSchema, req.params);
    const input = parseOrThrow(updateProductSchema, req.body);
    const product = await productService.updateProductForBusiness(
      req.auth.businessId,
      id,
      input,
    );
    res.status(200).json({ data: product });
  }),
);

/** Soft delete: deactivates the product and returns its new state. */
productRouter.delete(
  '/:id',
  requirePolicy('product.deactivate'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(productIdParamSchema, req.params);
    const product = await productService.deactivateProduct(req.auth.businessId, id);
    res.status(200).json({ data: product });
  }),
);
