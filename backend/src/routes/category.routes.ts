/**
 * Categories API.
 *
 * Thin by design: validate, delegate to the service, respond. No SQL and no
 * business rules live here.
 *
 * `requireAuth` supplies the tenant. `requireRole('owner')` guards the one
 * destructive operation — staff may manage the catalog day to day, but only an
 * owner may delete a category.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/requireAuth.js';
import * as categoryService from '../services/category.service.js';
import {
  categoryIdParamSchema,
  createCategorySchema,
  updateCategorySchema,
} from '../services/category.schemas.js';
import type { AuthedRequest } from '../types/express.js';

export const categoryRouter: Router = Router();

categoryRouter.use(requireAuth);

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

categoryRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const categories = await categoryService.listCategoriesForBusiness(req.auth.businessId);
    res.status(200).json({ data: categories });
  }),
);

categoryRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = parseOrThrow(createCategorySchema, req.body);
    const category = await categoryService.createCategoryForBusiness(req.auth.businessId, input);
    res.status(201).json({ data: category });
  }),
);

categoryRouter.get(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(categoryIdParamSchema, req.params);
    const category = await categoryService.getCategory(req.auth.businessId, id);
    res.status(200).json({ data: category });
  }),
);

categoryRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(categoryIdParamSchema, req.params);
    const input = parseOrThrow(updateCategorySchema, req.body);
    const category = await categoryService.updateCategoryForBusiness(
      req.auth.businessId,
      id,
      input,
    );
    res.status(200).json({ data: category });
  }),
);

categoryRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(categoryIdParamSchema, req.params);
    await categoryService.deleteCategoryForBusiness(req.auth.businessId, id);
    res.status(204).send();
  }),
);
