/**
 * Request validation for the Recommendations API.
 *
 * `.strict()`, so an unknown query parameter — `businessId`, an `orderBy` aimed
 * at the SQL — is refused with a `400` rather than ignored. The tenant comes
 * only from the authenticated session.
 */

import { z } from 'zod';

import { RECOMMENDATION_PRIORITIES, RECOMMENDATION_TYPES } from '../intelligence/recommendations.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './intelligence.schemas.js';

export const listRecommendationsQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    // Explicit enum: a boolean coercion would turn the string "false" into true.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    type: z.enum(RECOMMENDATION_TYPES).optional(),
    priority: z.enum(RECOMMENDATION_PRIORITIES).optional(),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListRecommendationsQuery = z.infer<typeof listRecommendationsQuerySchema>;