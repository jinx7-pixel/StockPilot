/**
 * Request validation for the inventory API.
 *
 * Schemas own shape and the quantity rules. They are `.strict()`, so a body
 * carrying `businessId`, `createdBy` or `currentStock` is rejected outright
 * rather than silently ignored — those values must come from the session and
 * from the ledger, never from the client.
 *
 * Quantities are validated as decimal strings and normalised to exactly two
 * decimal places, so no floating-point arithmetic is involved anywhere in the
 * request path.
 */

import { z } from 'zod';

import { MOVEMENT_TYPES, STOCK_STATUSES } from '../repositories/inventory.repository.js';

const DECIMAL_LIKE = /^-?\d{1,10}(\.\d{1,2})?$/;
/** Absolute amount only — a leading minus is not permitted. */
const ABSOLUTE_DECIMAL_LIKE = /^\d{1,10}(\.\d{1,2})?$/;

const normalise = (value: string): string => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return `${negative ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}`;
};

/**
 * An absolute amount, used for `in` and `out`.
 *
 * The pattern deliberately excludes a leading `-`, so a negative IN/OUT is a
 * 400 at the validation layer rather than falling through to the database check
 * constraint (a 500) or to the insufficient-stock guard (a misleading 409).
 */
const positiveQuantitySchema = z
  .union([z.string(), z.number()], { error: 'Enter a quantity greater than zero.' })
  .transform((value) => String(value).trim())
  .refine((value) => ABSOLUTE_DECIMAL_LIKE.test(value), {
    message: 'Enter a positive quantity. Use an adjustment to reduce stock.',
  })
  .transform(normalise);

/** A signed amount; zero is rejected in `superRefine` and again by the database. */
const signedQuantitySchema = z
  .union([z.string(), z.number()], {
    error: 'Enter a non-zero quantity of at most 2 decimal places.',
  })
  .transform((value) => String(value).trim())
  .refine((value) => DECIMAL_LIKE.test(value), {
    message: 'Enter a non-zero quantity of at most 2 decimal places.',
  })
  .transform(normalise);

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const listInventoryQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    categoryId: z.uuid('categoryId must be a valid id.').optional(),
    // Explicit enum: coercing would turn the string "false" into `true`.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    stockStatus: z.enum(STOCK_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  // `.strict()` means a `businessId` query parameter is a 400, not a silently
  // ignored key. Business scope is derived from the session, full stop.
  .strict();

export const productIdParamSchema = z.object({ productId: z.uuid('Invalid product id.') });

export const listMovementsQuerySchema = z.object({
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/**
 * Base shape shared by create and the service's re-validation.
 *
 * `businessId`, `createdBy` and `currentStock` are absent by design — the schema
 * is `.strict()`, so sending any of them is a 400.
 */
const movementBase = {
  productId: z.uuid('productId must be a valid id.'),
  movementType: z.enum(MOVEMENT_TYPES, {
    error: 'movementType must be one of: in, out, adjustment.',
  }),
  reason: z
    .string({ error: 'Reason must be text.' })
    .trim()
    .max(255, 'Reason must be at most 255 characters.')
    .optional(),
  referenceType: z
    .string({ error: 'referenceType must be text.' })
    .trim()
    .min(1, 'referenceType cannot be empty when provided.')
    .max(50, 'referenceType must be at most 50 characters.')
    .optional(),
  referenceId: z.uuid('referenceId must be a valid id.').optional(),
};

export const createMovementSchema = z
  .discriminatedUnion('movementType', [
    z
      .object({
        ...movementBase,
        movementType: z.literal('in'),
        quantity: positiveQuantitySchema,
      })
      .strict(),
    z
      .object({
        ...movementBase,
        movementType: z.literal('out'),
        quantity: positiveQuantitySchema,
      })
      .strict(),
    z
      .object({
        ...movementBase,
        movementType: z.literal('adjustment'),
        quantity: signedQuantitySchema,
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    // A quantity of zero is meaningless for every type, and the database
    // rejects it too — this turns a constraint error into a clear 400.
    if (Number(value.quantity) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Quantity must not be zero. Use an adjustment with a signed value instead.',
      });
    }

    // A reference is meaningful only as a pair: an id with no type, or a type
    // with no id, would be a dangling pointer into a future module.
    const hasType = value.referenceType !== undefined;
    const hasId = value.referenceId !== undefined;

    if (hasType && !hasId) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceId'],
        message: 'referenceId is required when referenceType is provided.',
      });
    }
    if (hasId && !hasType) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceType'],
        message: 'referenceType is required when referenceId is provided.',
      });
    }
  });

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
