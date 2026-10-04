/**
 * Request validation for the suppliers API.
 *
 * `.strict()` throughout, so a payload carrying `businessId` or `createdBy` is
 * rejected with a 400 rather than silently ignored — both are derived from the
 * session.
 */

import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Matches the `suppliers.name` column width. */
const nameSchema = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(1, 'Name is required.')
  .max(150, 'Name must be at most 150 characters.');

/**
 * Phone is validated for plausibility only.
 *
 * The column is `varchar(30)` and businesses write numbers in every format
 * imaginable — spaces, dashes, brackets, a leading `+`, an extension. Rejecting
 * a valid-but-unusual number helps nobody, so the rule is simply "something
 * sensible that fits the column", rather than pretending to parse international
 * dialling rules.
 */
const phoneSchema = z
  .string({ error: 'Phone must be text.' })
  .trim()
  .min(5, 'Phone must be at least 5 characters.')
  .max(30, 'Phone must be at most 30 characters.')
  .regex(/^[+()\d\s.-]+$/, 'Phone may only contain digits, spaces and + ( ) - . characters');

const emailSchema = z
  .string({ error: 'Email must be text.' })
  .trim()
  .toLowerCase()
  .max(255, 'Email must be at most 255 characters.')
  .email('Enter a valid email address.');

const contactNameSchema = z
  .string({ error: 'Contact name must be text.' })
  .trim()
  .min(1, 'Contact name cannot be empty when provided.')
  .max(100, 'Contact name must be at most 100 characters.');

const addressSchema = z
  .string({ error: 'Address must be text.' })
  .trim()
  .min(1, 'Address cannot be empty when provided.')
  .max(255, 'Address must be at most 255 characters.');

const notesSchema = z
  .string({ error: 'Notes must be text.' })
  .trim()
  .max(2000, 'Notes must be at most 2000 characters.');

export const createSupplierSchema = z
  .object({
    name: nameSchema,
    contactName: contactNameSchema.optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    address: addressSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict();

export const updateSupplierSchema = z
  .object({
    name: nameSchema.optional(),
    /** `null` clears the field. */
    contactName: contactNameSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    address: addressSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
    /** Deactivate or reactivate. */
    isActive: z.boolean('isActive must be true or false.').optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const supplierIdParamSchema = z.object({ id: z.uuid('Invalid supplier id.') });

export const listSuppliersQuerySchema = z
  .object({
    /** Free text, matched against name and contact name. */
    search: z.string().trim().min(1).max(150).optional(),
    // Explicit enum: coercing would turn the string "false" into `true`.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
