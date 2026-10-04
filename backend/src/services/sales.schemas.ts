/**
 * Request validation for the sales API.
 *
 * The schemas are `.strict()`, so a payload carrying `businessId`, `createdBy`,
 * `totalAmount`, `unitPrice`, `lineTotal`, `stock` or `status` is rejected with
 * a 400 rather than silently ignored. Those values are derived server-side:
 * the tenant and actor from the session, the money from PostgreSQL, and the
 * status from the database default.
 */

import { z } from 'zod';

import { SALE_STATUSES } from '../repositories/sale.repository.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** NUMERIC(12,2) maximum is 9,999,999,999.99 — ten integer digits. */
const QUANTITY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** True when a normalised two-decimal string represents a strictly positive amount. */
function isPositiveDecimal(value: string): boolean {
  // Strip the fractional part; "1.00" -> "1", "0.05" -> "0", "10.50" -> "10".
  const whole = value.split('.')[0] ?? '0';
  return Number(whole) > 0 || Number(value) > 0;
}

/**
 * A strictly positive quantity, normalised to exactly two decimals.
 *
 * The zero check lives here rather than only in the database: `quantity > 0` is
 * a CHECK constraint, so letting a zero through would surface a constraint
 * violation as an opaque 500 instead of a clear 400.
 *
 * The multiplication and sums that follow are done by PostgreSQL in `numeric`;
 * this schema only guarantees a well-formed, positive decimal string.
 */
const quantitySchema = z
  .union([z.string(), z.number()], { error: 'quantity is required.' })
  .transform((value) => String(value).trim())
  .refine((value) => QUANTITY_PATTERN.test(value), {
    message: 'Quantity must be a number with at most 2 decimal places.',
  })
  .transform((value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  })
  .refine(isPositiveDecimal, {
    message: 'Quantity must be greater than zero.',
  });

const saleItemSchema = z
  .object({
    productId: z.uuid('productId must be a valid id.'),
    quantity: quantitySchema,
  })
  // No `unitPrice` here: the price is snapshotted from the product, so a client
  // that sends one is either confused or attempting to set the price.
  .strict();

export const createSaleSchema = z
  .object({
    customerName: z
      .string({ error: 'customerName must be text.' })
      .trim()
      .max(150, 'Customer name must be at most 150 characters.')
      .optional(),
    customerPhone: z
      .string({ error: 'customerPhone must be text.' })
      .trim()
      .max(30, 'Customer phone must be at most 30 characters.')
      .optional(),
    /**
     * When the sale happened, which may differ from when it was recorded. An
     * ISO 8601 string; a Date object is accepted and converted.
     */
    soldAt: z
      .coerce
      .date({ error: 'soldAt must be a valid date.' })
      .refine((value) => !Number.isNaN(value.getTime()), { message: 'soldAt must be a valid date.' })
      .optional(),
    items: z
      .array(saleItemSchema)
      .min(1, 'A sale must contain at least one item.')
      // A practical ceiling, so one request cannot lock an unbounded number of
      // products and stall other writers.
      .max(200, 'A sale may contain at most 200 items.'),
  })
  .strict();

export const listSalesQuerySchema = z
  .object({
    /** Free text, matched against customer name and phone. */
    search: z.string().trim().min(1).max(150).optional(),
    status: z.enum(SALE_STATUSES).optional(),
    /** Inclusive lower bound on `soldAt`. */
    from: z.coerce.date().optional(),
    /** Inclusive upper bound on `soldAt`. */
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict()
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: '`from` must not be later than `to`.', path: ['from'] },
  );

export const saleIdParamSchema = z.object({ id: z.uuid('Invalid sale id.') });

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
