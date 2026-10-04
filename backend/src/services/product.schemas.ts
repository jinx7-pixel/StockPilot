/**
 * Request validation for the products API.
 *
 * Two normalisations happen here and only here:
 *  - **SKU** is trimmed and upper-cased, so "abc-1" and "ABC-1" are the same
 *    product. The unique index uses `upper(sku)` to match.
 *  - **Money** is validated as a strict decimal string and emitted with exactly
 *    two decimal places, so `12`, `12.0` and `12.00` are identical and no
 *    floating-point arithmetic is involved.
 */

import { z } from 'zod';

/** Matches the `products.sku` column width. */
const skuSchema = z
  .string({ error: 'SKU is required.' })
  .trim()
  .min(1, 'SKU is required.')
  .max(100, 'SKU must be at most 100 characters.')
  .transform((value) => value.toUpperCase());

const nameSchema = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(1, 'Name is required.')
  .max(200, 'Name must be at most 200 characters.');

const descriptionSchema = z
  .string({ error: 'Description must be text.' })
  .trim()
  .max(2000, 'Description must be at most 2000 characters.');

const unitSchema = z
  .string({ error: 'Unit is required.' })
  .trim()
  .min(1, 'Unit is required.')
  .max(30, 'Unit must be at most 30 characters.');

/** NUMERIC(12,2) maximum is 9,999,999,999.99 — ten integer digits. */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Accepts a number or decimal string, rejects negatives, exponents and more than
 * two decimal places, and normalises to exactly two decimal places.
 */
const moneySchema = z
  .union([z.string(), z.number()], { error: 'Enter a valid amount.' })
  .transform((value) => String(value).trim())
  .refine((value) => MONEY_PATTERN.test(value), {
    message: 'Use an amount of 0 or more with at most 2 decimal places.',
  })
  .transform((value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  });

export const createProductSchema = z
  .object({
    sku: skuSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    categoryId: z.uuid('categoryId must be a valid id.').nullable().optional(),
    unit: unitSchema,
    costPrice: moneySchema,
    sellingPrice: moneySchema,
    isActive: z.boolean('isActive must be true or false.').optional(),
  })
  .strict();

export const updateProductSchema = z
  .object({
    sku: skuSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    /** `null` removes the product from its category. */
    categoryId: z.uuid('categoryId must be a valid id.').nullable().optional(),
    unit: unitSchema.optional(),
    costPrice: moneySchema.optional(),
    sellingPrice: moneySchema.optional(),
    isActive: z.boolean('isActive must be true or false.').optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const productIdParamSchema = z.object({ id: z.uuid('Invalid product id.') });

/** Defaults chosen so a listing is useful without pagination, and never unbounded. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const listProductsQuerySchema = z.object({
  /** Free text, matched against name and SKU. */
  search: z.string().trim().min(1).max(200).optional(),
  categoryId: z.uuid('categoryId must be a valid id.').optional(),
  // Explicit enum: a boolean coercion would turn the string "false" into true.
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
