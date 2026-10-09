/**
 * Suppliers API.
 *
 * There is deliberately **no** `DELETE`. Purchase orders reference suppliers
 * with `ON DELETE NO ACTION`, so a supplier that has history can never be
 * removed; deactivation via `PATCH { isActive: false }` is the supported way to
 * retire one.
 *
 * Both owner and staff may view, create, edit and activate/deactivate suppliers:
 * managing the supplier list is ordinary day-to-day work, and nothing here is
 * destructive.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requirePolicy } from '../auth/policy.js';
import { businessApiLimiter } from '../middlewares/rateLimit.js';
import * as supplierService from '../services/supplier.service.js';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  supplierIdParamSchema,
  updateSupplierSchema,
} from '../services/supplier.schemas.js';
import type { AuthedRequest } from '../types/express.js';

export const supplierRouter: Router = Router();

supplierRouter.use(requireAuth);

// After authentication, so the rate-limit key is the session's user and business
// rather than a shared IP. Reads and writes draw from separate budgets.
supplierRouter.use(businessApiLimiter);

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

supplierRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listSuppliersQuerySchema, req.query);
    const { items, page, limit, total, totalPages } = await supplierService.listBusinessSuppliers(
      req.auth.businessId,
      query,
    );
    res.status(200).json({ data: items, meta: { total, page, limit, totalPages } });
  }),
);

supplierRouter.post(
  '/',
  requirePolicy('supplier.create'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = parseOrThrow(createSupplierSchema, req.body);
    const supplier = await supplierService.createSupplierForBusiness(req.auth.businessId, input);
    res.status(201).json({ data: supplier });
  }),
);

supplierRouter.get(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(supplierIdParamSchema, req.params);
    const supplier = await supplierService.getSupplier(req.auth.businessId, id);
    res.status(200).json({ data: supplier });
  }),
);

supplierRouter.patch(
  '/:id',
  requirePolicy('supplier.update'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(supplierIdParamSchema, req.params);
    const input = parseOrThrow(updateSupplierSchema, req.body);
    const supplier = await supplierService.updateSupplierForBusiness(
      req.auth.businessId,
      id,
      input,
    );
    res.status(200).json({ data: supplier });
  }),
);
