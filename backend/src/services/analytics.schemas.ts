/**
 * Request validation for the analytics API.
 *
 * Every schema is `.strict()`, so an unknown query parameter — including an
 * attempt to steer the SQL with `orderBy`, `groupBy=...; DROP TABLE` or a
 * `businessId` — is refused with a `400` rather than ignored.
 *
 * The service, not the schema, resolves the analysis window and guarantees it
 * spans at least one day, so `averageDailySales` can never divide by zero.
 */

import { z } from 'zod';

export const GROUP_BY_VALUES = ['day', 'week', 'month'] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Most recent movements returned in a product's history section. */
export const MOVEMENT_HISTORY_LIMIT = 50;

const fromSchema = z.coerce.date({ error: '`from` must be a valid date.' }).optional();
const toSchema = z.coerce.date({ error: '`to` must be a valid date.' }).optional();

/** `from` must not sit after `to`. Mirrors the shared date-range rule. */
function requireOrderedRange(
  value: { from?: Date | undefined; to?: Date | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.from !== undefined && value.to !== undefined && value.from > value.to) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: '`from` must not be later than `to`.',
    });
  }
}

export const overviewQuerySchema = z.object({}).strict();

export const salesAnalyticsQuerySchema = z
  .object({
    from: fromSchema,
    to: toSchema,
    groupBy: z.enum(GROUP_BY_VALUES).default('day'),
  })
  .strict()
  .superRefine(requireOrderedRange);

export const inventoryAnalyticsQuerySchema = z
  .object({ from: fromSchema, to: toSchema })
  .strict()
  .superRefine(requireOrderedRange);

export const listProductsQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    // Explicit enum: a boolean coercion would turn the string "false" into true.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    from: fromSchema,
    to: toSchema,
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict()
  .superRefine(requireOrderedRange);

export const productDetailQuerySchema = z
  .object({
    from: fromSchema,
    to: toSchema,
    groupBy: z.enum(GROUP_BY_VALUES).default('day'),
  })
  .strict()
  .superRefine(requireOrderedRange);

/** Supplier analytics takes no parameters; anything sent is refused. */
export const suppliersQuerySchema = z.object({}).strict();

export const productIdParamSchema = z.object({
  productId: z.uuid('Invalid product id.'),
});

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
export type SalesAnalyticsQuery = z.infer<typeof salesAnalyticsQuerySchema>;
export type InventoryAnalyticsQuery = z.infer<typeof inventoryAnalyticsQuerySchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type ProductDetailQuery = z.infer<typeof productDetailQuerySchema>;
export type ProductIdParam = z.infer<typeof productIdParamSchema>;

