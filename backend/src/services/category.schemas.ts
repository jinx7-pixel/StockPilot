/**
 * Request validation for the categories API.
 *
 * Schemas own shape (required fields, lengths, types). Rejecting unknown keys
 * with `.strict()` matches the auth endpoints, so a client cannot smuggle in
 * `businessId` and have it silently ignored.
 */

import { z } from 'zod';

/** Matches the `categories.name` column width. */
const nameSchema = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(1, 'Name is required.')
  .max(100, 'Name must be at most 100 characters.');

const descriptionSchema = z
  .string({ error: 'Description must be text.' })
  .trim()
  .max(2000, 'Description must be at most 2000 characters.');

export const createCategorySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: nameSchema.optional(),
    // `null` explicitly clears the description.
    description: descriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const categoryIdParamSchema = z.object({ id: z.uuid('Invalid category id.') });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
