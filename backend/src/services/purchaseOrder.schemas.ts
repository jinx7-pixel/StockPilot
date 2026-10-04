/**
 * Request validation for the purchase orders API.
 *
 * `.strict()` throughout, so a payload carrying `businessId`, `createdBy`,
 * `totalAmount`, `lineTotal`, `receivedQuantity`, `status` or `stock` is
 * rejected with a 400. All of those are derived server-side: the tenant and actor
 * from the session, the money from PostgreSQL, and `received_quantity` from a
 * receipt's increments.
 */

import { z } from 'zod';

import { PURCHASE_ORDER_STATUSES } from '../repositories/purchaseOrder.repository.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** NUMERIC(12,2) maximum is 9,999,999,999.99 — ten integer digits. */
const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Strictly positive, normalised to two decimals. */
const positiveQuantitySchema = z
  .union([z.string(), z.number()], { error: 'quantity is required.' })
  .transform((value) => String(value).trim())
  .refine((value) => DECIMAL_PATTERN.test(value), {
    message: 'Quantity must be a number with at most 2 decimal places.',
  })
  .transform(normalise)
  .refine((value) => Number(value) > 0, { message: 'Quantity must be greater than zero.' });

/** Non-negative, normalised to two decimals. `0.00` is a valid unit cost. */
const nonNegativeAmountSchema = z
  .union([z.string(), z.number()], { error: 'unitCost is required.' })
  .transform((value) => String(value).trim())
  .refine((value) => DECIMAL_PATTERN.test(value), {
    message: 'unitCost must be a number with at most 2 decimal places.',
  })
  .transform(normalise);

function normalise(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

const orderItemSchema = z
  .object({
    productId: z.uuid('productId must be a valid id.'),
    quantity: positiveQuantitySchema,
    /** What the business will pay. Products' `selling_price` is irrelevant here. */
    unitCost: nonNegativeAmountSchema,
  })
  .strict();

const notesSchema = z
  .string({ error: 'Notes must be text.' })
  .trim()
  .max(2000, 'Notes must be at most 2000 characters.');

export const createPurchaseOrderSchema = z
  .object({
    supplierId: z.uuid('supplierId must be a valid id.'),
    expectedAt: z.coerce.date().optional(),
    notes: notesSchema.optional(),
    items: z
      .array(orderItemSchema)
      .min(1, 'A purchase order must contain at least one item.')
      // A practical ceiling, so one request cannot lock an unbounded number of
      // products and stall other writers.
      .max(200, 'A purchase order may contain at most 200 items.'),
  })
  .strict();

/**
 * Draft edits only.
 *
 * `status` accepts **only** `cancelled`: moving to `ordered` is what
 * `POST /:id/order` is for, and the receive-driven statuses must not be settable
 * by hand. `receivedQuantity`, `totalAmount` and `lineTotal` are absent
 * entirely, so a client cannot set them.
 *
 * `items` is not editable here. Changing the lines of an order after it has been
 * placed is a real business operation (a variation) and deserves its own
 * endpoint; silently letting a `draft` be rewritten by anyone who can reach the
 * PATCH route would be a worse trade. A draft can be **cancelled** and re-raised.
 */
export const updatePurchaseOrderSchema = z
  .object({
    expectedAt: z.coerce.date().nullable().optional(),
    notes: notesSchema.nullable().optional(),
    status: z.literal('cancelled', {
      error: 'Only `cancelled` may be set here. Use POST /:id/order to place an order.',
    }).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/** Receiving: quantities are *increments*, not new totals. */
export const receivePurchaseOrderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.uuid('productId must be a valid id.'),
            quantity: positiveQuantitySchema,
          })
          .strict(),
      )
      .min(1, 'A receipt must contain at least one item.')
      .max(200, 'A receipt may contain at most 200 items.'),
  })
  .strict();

export const listPurchaseOrdersQuerySchema = z
  .object({
    /** Free text, matched against supplier name and order notes. */
    search: z.string().trim().min(1).max(150).optional(),
    supplierId: z.uuid('supplierId must be a valid id.').optional(),
    status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict()
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: '`from` must not be later than `to`.', path: ['from'] },
  );

export const purchaseOrderIdParamSchema = z.object({
  id: z.uuid('Invalid purchase order id.'),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
