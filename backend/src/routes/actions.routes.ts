/**
 * Action Center routes.
 *
 * ## Surface
 *
 *   GET  /api/actions        — this tenant's action history, newest first
 *   GET  /api/actions/:id    — one recorded action and the order it produced
 *   POST /api/actions        — execute one reviewed recommendation
 *
 * ## What is deliberately absent
 *
 * There is no `PUT`, `PATCH` or `DELETE`. An executed action is immutable: an
 * audit trail whose rows can be edited is not an audit trail, and the orders
 * they point at have their own lifecycle endpoints. Anything that is not
 * `CREATE_DRAFT_PURCHASE_ORDER` has no route here at all.
 *
 * ## Authorization
 *
 * `requireAuth` only — no role gate. That is not an oversight: the purchase-order
 * module this acts on is likewise open to any authenticated member of the
 * business, so adding a stricter gate here would be a new policy introduced in
 * the wrong module. What *is* enforced is tenancy, and it is enforced in the
 * service layer from the session's business id, never from a request parameter.
 */

import { Router } from 'express';

import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requirePolicy } from '../auth/policy.js';
import { businessApiLimiter } from '../middlewares/rateLimit.js';
import type { AuthedRequest } from '../types/express.js';
import { createAction, getBusinessAction, listBusinessActions } from '../services/actions.service.js';
import {
  actionIdParamSchema,
  createActionSchema,
  listActionsQuerySchema,
  parseOrThrow,
} from '../services/actions.schemas.js';

/** The header carrying the client-generated replay key. */
const IDEMPOTENCY_HEADER = 'idempotency-key';

export const actionsRouter: Router = Router();

actionsRouter.use(requireAuth);

// After authentication, so the rate-limit key is the session's user and business
// rather than a shared IP. Executing an action is a write, so it draws from the
// tighter mutation budget.
actionsRouter.use(businessApiLimiter);

/**
 * GET /api/actions
 *
 * Action history for the caller's own business. `businessId` is not an accepted
 * query parameter, so it cannot be overridden; ordering is fixed to newest-first
 * and there is no `orderBy` to inject one.
 */
actionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const typed = req as AuthedRequest;
    const query = parseOrThrow(listActionsQuerySchema, req.query);

    const page = await listBusinessActions(typed.auth.businessId, query);

    res.json({
      data: {
        items: page.items,
        pagination: {
          page: page.page,
          limit: page.limit,
          total: page.total,
          totalPages: page.totalPages,
        },
      },
    });
  }),
);

/**
 * GET /api/actions/:id
 *
 * One recorded action, with the draft purchase order it produced.
 *
 * Read-only, like every other read in this module: there is no `PUT`, `PATCH` or
 * `DELETE` on this path, so an audit row cannot be edited or removed by anyone,
 * including its own author.
 *
 * Tenancy is decided by the service layer, which is handed only the session's
 * business id. An action belonging to another business answers 404 with the same
 * body as an id that never existed, so this endpoint cannot be used to probe which
 * ids are real.
 */
actionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const typed = req as AuthedRequest;
    const { id } = parseOrThrow(actionIdParamSchema, req.params);

    const result = await getBusinessAction(typed.auth.businessId, id);

    res.json({
      data: {
        action: result.action,
        purchaseOrder: result.purchaseOrder,
      },
    });
  }),
);

/**
 * POST /api/actions
 *
 * Executes one reviewed recommendation as a **draft** purchase order. The draft
 * is intentionally not sent anywhere: ordering, receiving and paying are separate
 * user-initiated steps.
 *
 * The user may confirm a quantity that differs from the suggestion — a deliberate
 * override, recorded as such. What they may not do is override the *decision*:
 * if no live `REPLENISH` recommendation stands at execution time, the request is
 * refused with 409 rather than executed on stale grounds.
 */
actionsRouter.post(
  '/',
  // Deliberately the same policy as raising a purchase order directly: executing
  // a recommendation *is* raising a draft order, so it must not be a second,
  // quieter way for staff to do the same thing.
  requirePolicy('action.execute'),
  asyncHandler(async (req, res) => {
    const typed = req as AuthedRequest;
    const input = parseOrThrow(createActionSchema, req.body);

    const header = req.get(IDEMPOTENCY_HEADER);
    const { result, replayed } = await createAction(
      typed.auth.businessId,
      // The actor comes from the session, never from the request body.
      typed.auth.id,
      input,
      header,
    );

    res.status(replayed ? 200 : 201).json({
      data: {
        action: result.action,
        purchaseOrder: result.purchaseOrder,
      },
    });
  }),
);