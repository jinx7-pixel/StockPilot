/**
 * Request validation for the Unified Intelligence API.
 *
 * `.strict()`, so an unknown query parameter — `businessId`, an `orderBy` aimed
 * at the SQL — is refused with a `400` rather than ignored. The tenant comes
 * only from the authenticated session.
 *
 * The list is capped at **25** products by design: each row carries six complete
 * engine results, and a wider page would be a large payload rather than a
 * useful one.
 */

import { z } from 'zod';

export const UNIFIED_PAGE_SIZE = 25;

export const listUnifiedIntelligenceQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    // Explicit enum: a boolean coercion would turn the string "false" into true.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(UNIFIED_PAGE_SIZE).default(UNIFIED_PAGE_SIZE),
  })
  .strict();

export type ListUnifiedIntelligenceQuery = z.infer<typeof listUnifiedIntelligenceQuerySchema>;