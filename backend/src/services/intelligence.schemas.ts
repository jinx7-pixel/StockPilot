/**
 * Request validation for the intelligence API.
 *
 * `.strict()` throughout, so an unknown query parameter — `businessId`, an
 * `orderBy` aimed at the SQL, anything unexpected — is refused with a `400`
 * rather than ignored.
 */

import { z } from 'zod';

import { CONFIDENCE_LEVELS, RISK_LEVELS } from '../intelligence/index.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const listStockRiskQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    // Explicit enum: a boolean coercion would turn the string "false" into true.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    risk: z.enum(RISK_LEVELS).optional(),
    confidence: z.enum(CONFIDENCE_LEVELS).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export const productIdParamSchema = z.object({
  productId: z.uuid('Invalid product id.'),
});

export type ListStockRiskQuery = z.infer<typeof listStockRiskQuerySchema>;
export type ProductIdParam = z.infer<typeof productIdParamSchema>;
