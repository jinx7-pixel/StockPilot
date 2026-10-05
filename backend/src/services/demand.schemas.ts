/**
 * Request validation for the Demand Intelligence API.
 *
 * `.strict()` throughout, so an unknown query parameter — `businessId`, an
 * `orderBy` aimed at the SQL, anything unexpected — is refused with a `400`
 * rather than ignored. The tenant is never client-controlled.
 */

import { z } from 'zod';

import { DEMAND_TRENDS, DEMAND_VARIABILITY } from '../intelligence/index.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './intelligence.schemas.js';

export const listDemandQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    // Explicit enum: a boolean coercion would turn the string "false" into true.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    trend: z.enum(DEMAND_TRENDS).optional(),
    variability: z.enum(DEMAND_VARIABILITY).optional(),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListDemandQuery = z.infer<typeof listDemandQuerySchema>;
