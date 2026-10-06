/**
 * Request validation for the Reorder Engine API.
 *
 * `.strict()` throughout, so an unknown query parameter — `businessId`, an
 * `orderBy` aimed at the SQL, anything unexpected — is refused with a `400`
 * rather than ignored. The tenant is never client-controlled, and there is no
 * write route: a replenishment recommendation is a read.
 */

import { z } from 'zod';

import { CONFIDENCE_LEVELS, REORDER_DECISIONS } from '../intelligence/index.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './intelligence.schemas.js';

export const listReorderQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    /**
     * An inactive product is not an operational candidate, so the list defaults
     * to active only. `'all'` is how a caller asks for the whole catalog back.
     */
    isActive: z
      .enum(['active', 'inactive', 'all'])
      .default('active')
      .transform((value) => {
        if (value === 'all') return undefined;
        return value === 'active';
      }),
    decision: z.enum(REORDER_DECISIONS).optional(),
    confidence: z.enum(CONFIDENCE_LEVELS).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListReorderQuery = z.infer<typeof listReorderQuerySchema>;
