/**
 * Action Center request and response contracts.
 *
 * ## What an action body may contain
 *
 * Deliberately narrow. The body carries **two** decisions the user is entitled to
 * make — how many units, and from whom — plus the product and, optionally, the
 * recommendation being carried out. Everything else is derived:
 *
 *   - the acting user comes from the session, never the body;
 *   - the business comes from the session, never the body;
 *   - the unit cost comes from the product record, never the body;
 *   - the action kind is fixed by this endpoint, never the body;
 *   - the suggested quantity is re-derived from the engine at execution time,
 *     never accepted from the body.
 *
 * A wider body would let a client assert facts the audit trail must own. Because
 * `actionType` is absent from the schema, a client cannot ask for a supplier
 * switch, a stock adjustment or a delete: there is no code path that would read
 * one.
 *
 * ## Quantity may differ from the suggestion
 *
 * `quantity` is the user's confirmed figure and `recommendedQuantity` in the
 * response records what the engine advised. They are allowed to differ — a buyer
 * who knows an upcoming promotion will deliberately buy less — and the audit
 * stores both so the override is visible later rather than lost.
 */

import { z } from 'zod';

import { ValidationError } from '../errors.js';

/** The one executable action kind. Every other recommendation stays review-only. */
export const EXECUTABLE_ACTION_TYPE = 'CREATE_DRAFT_PURCHASE_ORDER' as const;

/** Mirrors the `action_status` PostgreSQL enum. */
export const ACTION_STATUSES = ['COMPLETED', 'FAILED'] as const;

/** Mirrors the `action_type` PostgreSQL enum. */
export const ACTION_TYPES = [EXECUTABLE_ACTION_TYPE] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * How many units to order.
 *
 * A decimal string rather than a number, matching every other quantity in the
 * codebase: `numeric(12,2)` arithmetic must never pass through a binary float.
 * `z.string()` follows Zod 4's input-then-pipe convention, so the regex runs on
 * the incoming string before it is ever parsed.
 */
const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Quantity must be a positive number with at most 2 decimals.')
  .refine((value) => Number(value) > 0, 'Quantity must be greater than zero.')
  .refine((value) => Number(value) <= 99_999_999.99, 'Quantity is larger than this system stores.');

/**
 * POST /api/actions body.
 *
 * `strict()` rejects unknown keys outright rather than ignoring them, so a
 * client that sends `supplierSwitch: true` gets a clear 400 instead of a silent
 * no-op — silence would be indistinguishable from compliance.
 */
export const createActionSchema = z
  .object({
    productId: z.string().uuid('productId must be a UUID.'),
    supplierId: z.string().uuid('supplierId must be a UUID.'),
    quantity: quantitySchema,
    sourceRecommendationId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/**
 * GET /api/actions/:id path parameter.
 *
 * Validating the id up front means a malformed one is a clear 400 rather than a
 * UUID cast failure surfacing as a 500, and it keeps the route free of any
 * assumption about what Express hands it for a repeated segment.
 */
export const actionIdParamSchema = z.object({
  id: z.string().uuid('Invalid action id.'),
});

export type CreateActionInput = z.infer<typeof createActionSchema>;

/**
 * GET /api/actions query.
 *
 * No `businessId` and no `orderBy`: the tenant comes from the session, and
 * ordering is fixed to newest-first so an unvalidated sort expression can never
 * reach the database.
 */
export const listActionsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25),
    actionType: z.enum(ACTION_TYPES).optional(),
    status: z.enum(ACTION_STATUSES).optional(),
    productId: z.string().uuid().optional(),
  })
  .strict();

export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;

/** Parse and throw the project's `ValidationError`, which the error handler maps to 400. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ValidationError(first?.message ?? 'Invalid request.', first?.code ?? 'INVALID_REQUEST');
  }
  return result.data;
}