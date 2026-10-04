/**
 * Purchase orders API.
 *
 * Creating an order records intent and **does not touch inventory**. Stock
 * increases only through `POST /:id/receive`, which appends immutable `in`
 * movements via the inventory service. There is no `DELETE` route.
 *
 * Status transitions are enforced server-side: `received` and `cancelled` are
 * terminal, and only a draft can be placed.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as purchaseOrderService from '../services/purchaseOrder.service.js';
import {
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  purchaseOrderIdParamSchema,
  receivePurchaseOrderSchema,
  updatePurchaseOrderSchema,
} from '../services/purchaseOrder.schemas.js';
import type { AuthedRequest } from '../types/express.js';

export const purchaseOrderRouter: Router = Router();

purchaseOrderRouter.use(requireAuth);

/** Translate a Zod failure into a 400 that names the offending field. */
function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'request';
    throw new ValidationError(
      issue ? `${field}: ${issue.message}` : 'Invalid request.',
      'INVALID_REQUEST',
    );
  }

  return result.data;
}

purchaseOrderRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listPurchaseOrdersQuerySchema, req.query);
    const { items, page, limit, total, totalPages } =
      await purchaseOrderService.listBusinessPurchaseOrders(req.auth.businessId, query);
    res.status(200).json({ data: items, meta: { total, page, limit, totalPages } });
  }),
);

purchaseOrderRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = parseOrThrow(createPurchaseOrderSchema, req.body);
    const order = await purchaseOrderService.createPurchaseOrder(
      req.auth.businessId,
      // The actor comes from the session, never from the request body.
      req.auth.id,
      input,
    );
    res.status(201).json({ data: order });
  }),
);

/**
 * POST /:id/order — `draft -> ordered`, stamping `ordered_at`.
 *
 * Touches no inventory. Declared before `/:id` routes for readability only;
 * Express matches an exact segment count, so there is no shadowing here.
 */
purchaseOrderRouter.post(
  '/:id/order',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(purchaseOrderIdParamSchema, req.params);
    const order = await purchaseOrderService.placePurchaseOrder(req.auth.businessId, id);
    res.status(200).json({ data: order });
  }),
);

/**
 * POST /:id/receive — record an arrival.
 *
 * Each `quantity` is a newly received increment. Creates immutable `in`
 * movements and recomputes the order status, all in one transaction. `201`,
 * because a receipt creates new ledger entries.
 */
purchaseOrderRouter.post(
  '/:id/receive',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(purchaseOrderIdParamSchema, req.params);
    const input = parseOrThrow(receivePurchaseOrderSchema, req.body);
    const order = await purchaseOrderService.receivePurchaseOrder(
      req.auth.businessId,
      req.auth.id,
      id,
      input,
    );
    res.status(201).json({ data: order });
  }),
);

purchaseOrderRouter.get(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(purchaseOrderIdParamSchema, req.params);
    const order = await purchaseOrderService.getPurchaseOrder(req.auth.businessId, id);
    res.status(200).json({ data: order });
  }),
);

/** PATCH accepts only `expectedAt`, `notes` and `status: 'cancelled'`. */
purchaseOrderRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { id } = parseOrThrow(purchaseOrderIdParamSchema, req.params);
    const input = parseOrThrow(updatePurchaseOrderSchema, req.body);
    const order = await purchaseOrderService.updatePurchaseOrder(
      req.auth.businessId,
      id,
      input,
    );
    res.status(200).json({ data: order });
  }),
);
