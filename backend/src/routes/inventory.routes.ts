/**
 * Inventory API — read the ledger, and append to it.
 *
 * There is deliberately **no** `PATCH` or `DELETE` for a movement. The ledger is
 * append-only: a mistake is corrected by recording a new movement, never by
 * editing history.
 *
 * Route order matters. `/summary` is declared before `/:productId`, otherwise
 * Express would treat the literal string `summary` as a product id and answer
 * with a 400 about an invalid UUID.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import {
  createMovementSchema,
  listInventoryQuerySchema,
  listMovementsQuerySchema,
  productIdParamSchema,
} from '../services/inventory.schemas.js';
import * as inventoryService from '../services/inventory.service.js';
import type { AuthedRequest } from '../types/express.js';

export const inventoryRouter: Router = Router();

inventoryRouter.use(requireAuth);

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

/** GET /api/inventory/summary — must be registered before `/:productId`. */
inventoryRouter.get(
  '/summary',
  asyncHandler(async (req: AuthedRequest, res) => {
    const summary = await inventoryService.getBusinessInventorySummary(req.auth.businessId);
    res.status(200).json({ data: summary });
  }),
);

/** POST /api/inventory/movements — record one immutable movement. */
inventoryRouter.post(
  '/movements',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = parseOrThrow(createMovementSchema, req.body);

    const result = await inventoryService.recordMovement(
      req.auth.businessId,
      // The actor comes from the session, never from the request body.
      req.auth.id,
      input,
    );

    res.status(201).json({ data: result.movement, meta: { currentStock: result.currentStock } });
  }),
);

/** GET /api/inventory — products with derived stock, filtered and paginated. */
inventoryRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listInventoryQuerySchema, req.query);
    const { items, page, limit, total, totalPages } = await inventoryService.listBusinessInventory(
      req.auth.businessId,
      query,
    );

    res.status(200).json({ data: items, meta: { total, page, limit, totalPages } });
  }),
);

/** GET /api/inventory/:productId — product, stock and a movement summary. */
inventoryRouter.get(
  '/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const inventory = await inventoryService.getProductInventory(req.auth.businessId, productId);
    res.status(200).json({ data: inventory });
  }),
);

/** GET /api/inventory/:productId/movements — the paginated ledger. */
inventoryRouter.get(
  '/:productId/movements',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const query = parseOrThrow(listMovementsQuerySchema, req.query);

    const { items, page, limit, total, totalPages } = await inventoryService.listProductMovements(
      req.auth.businessId,
      productId,
      query,
    );

    res.status(200).json({ data: items, meta: { total, page, limit, totalPages } });
  }),
);
