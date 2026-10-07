/**
 * Intelligence API — read-only risk assessment.
 *
 * Nothing here mutates state: no stock write, no purchase order, no inventory
 * movement. A risk assessment must never change the position it measures, and
 * there is no recommendation action in this step.
 *
 * `business_id` comes only from the session. The schemas are `.strict()`, so even
 * attempting to pass it returns `400`.
 */

import { Router } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { listDemandQuerySchema } from '../services/demand.schemas.js';
import * as demandService from '../services/demand.service.js';
import {
  listStockRiskQuerySchema,
  productIdParamSchema,
} from '../services/intelligence.schemas.js';
import { listOverstockQuerySchema } from '../services/overstock.schemas.js';
import * as overstockService from '../services/overstock.service.js';
import { listReorderQuerySchema } from '../services/reorder.schemas.js';
import { listUnifiedIntelligenceQuerySchema } from '../services/unified.schemas.js';
import * as unifiedService from '../services/unified.service.js';
import * as reorderService from '../services/reorder.service.js';
import { listSlowDeadQuerySchema } from '../services/slowDead.schemas.js';
import * as slowDeadService from '../services/slowDead.service.js';
import { listSuppliersQuerySchema, supplierIdParamSchema } from '../services/supplierIntelligence.schemas.js';
import * as supplierIntelligenceService from '../services/supplierIntelligence.service.js';
import * as intelligenceService from '../services/intelligence.service.js';
import type { AuthedRequest } from '../types/express.js';

export const intelligenceRouter: Router = Router();

intelligenceRouter.use(requireAuth);

/** Translate a Zod failure into a 400 that names the offending parameter. */
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

/**
 * GET /api/intelligence/stock-risk
 *
 * A corrupt fact (negative stock cannot exist under the inventory rules) is a
 * server-side fault, not a risk level, so it surfaces as a 500 rather than
 * being silently clamped to zero and reported as a healthy business.
 */
intelligenceRouter.get(
  '/stock-risk',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listStockRiskQuerySchema, req.query);

    const page = await intelligenceService.listStockRisk(req.auth.businessId, query);

    const { items, total, page: currentPage, limit, totalPages, riskCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      riskCounts,
    });
  }),
);

/** GET /api/intelligence/stock-risk/:productId */
intelligenceRouter.get(
  '/stock-risk/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await intelligenceService.getStockRisk(req.auth.businessId, productId);
    res.status(200).json({ data: result });
  }),
);

// ---------------------------------------------------------------------------
// Demand Intelligence
// ---------------------------------------------------------------------------

/**
 * GET /api/intelligence/demand
 *
 * Read-only historical description. It reports what already sold; it does not
 * project, forecast or recommend a purchase, and there is no write route for it.
 */
intelligenceRouter.get(
  '/demand',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listDemandQuerySchema, req.query);

    const page = await demandService.listDemand(req.auth.businessId, query);

    const { items, total, page: currentPage, limit, totalPages, trendCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      trendCounts,
    });
  }),
);

/** GET /api/intelligence/demand/:productId */
intelligenceRouter.get(
  '/demand/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await demandService.getDemand(req.auth.businessId, productId);
    res.status(200).json({ data: result });
  }),
);

// ---------------------------------------------------------------------------
// Reorder Engine
// ---------------------------------------------------------------------------

/**
 * GET /api/intelligence/reorder
 *
 * A recommendation only. This is the one route in the feature that sounds like
 * an action, and it deliberately has no counterpart: there is no POST, no
 * "place order", and no approval step. Deciding what to reorder is not the same
 * as ordering it, and collapsing the two would make a read-only assessment look
 * like a purchase.
 */
intelligenceRouter.get(
  '/reorder',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listReorderQuerySchema, req.query);

    const page = await reorderService.listReorder(req.auth.businessId, query);

    const { items, total, page: currentPage, limit, totalPages, decisionCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      decisionCounts,
    });
  }),
);

/** GET /api/intelligence/reorder/:productId */
intelligenceRouter.get(
  '/reorder/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await reorderService.getReorder(req.auth.businessId, productId);
    res.status(200).json({ data: result });
  }),
);

// ---------------------------------------------------------------------------
// Overstock Detection
// ---------------------------------------------------------------------------

/**
 * GET /api/intelligence/overstock
 *
 * Read-only classification. It reports stock that exceeds its own demand and
 * nothing more: no markdown, no supplier return, no recommendation and no
 * action. Deciding what to do about excess stock is a later module, and naming
 * one here would make an assessment look like advice.
 */
intelligenceRouter.get(
  '/overstock',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listOverstockQuerySchema, req.query);

    const page = await overstockService.listOverstock(req.auth.businessId, query);

    const { items, total, page: currentPage, limit, totalPages, statusCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      statusCounts,
    });
  }),
);

/** GET /api/intelligence/overstock/:productId */
intelligenceRouter.get(
  '/overstock/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await overstockService.getOverstock(req.auth.businessId, productId);
    res.status(200).json({ data: result });
  }),
);

// ---------------------------------------------------------------------------
// Slow / Dead Stock Detection
// ---------------------------------------------------------------------------

/**
 * GET /api/intelligence/slow-dead
 *
 * Read-only classification. It identifies inventory that is not moving and
 * nothing more: no markdown, no supplier return, no stock adjustment, no
 * recommendation and no action. Those belong to later recommendation modules,
 * and naming one here would make an assessment look like advice.
 */
intelligenceRouter.get(
  '/slow-dead',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listSlowDeadQuerySchema, req.query);

    const page = await slowDeadService.listSlowDead(req.auth.businessId, query);

    const { items, total, page: currentPage, limit, totalPages, statusCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      statusCounts,
    });
  }),
);

/** GET /api/intelligence/slow-dead/:productId */
intelligenceRouter.get(
  '/slow-dead/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await slowDeadService.getSlowDead(req.auth.businessId, productId);
    res.status(200).json({ data: result });
  }),
);

// ---------------------------------------------------------------------------
// Supplier Intelligence
// ---------------------------------------------------------------------------

/**
 * GET /api/intelligence/suppliers
 *
 * Read-only measurement of how suppliers have actually delivered. There is no
 * on-time percentage, no SLA compliance and no good/bad score: the schema records
 * no promised delivery date, so there is nothing to measure lateness against,
 * and ranking suppliers on elapsed time alone would be a judgement dressed up as
 * a metric.
 */
intelligenceRouter.get(
  '/suppliers',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listSuppliersQuerySchema, req.query);

    const page = await supplierIntelligenceService.listSupplierIntelligence(
      req.auth.businessId,
      query,
    );

    const { items, total, page: currentPage, limit, totalPages, stabilityCounts } = page;
    res.status(200).json({
      data: items,
      meta: { total, page: currentPage, limit, totalPages },
      stabilityCounts,
    });
  }),
);

/** GET /api/intelligence/suppliers/:supplierId */
intelligenceRouter.get(
  '/suppliers/:supplierId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { supplierId } = parseOrThrow(supplierIdParamSchema, req.params);
    const result = await supplierIntelligenceService.getSupplierIntelligence(
      req.auth.businessId,
      supplierId,
    );
    res.status(200).json({ data: result });
  }),
);

// ---------------------------------------------------------------------------
// Unified Intelligence
// ---------------------------------------------------------------------------

/**
 * GET /api/intelligence/products
 *
 * One row per product carrying all six complete engine results, including each
 * one's 11.7 explanation envelope. Read-only, and capped at 25 products because
 * a row is six verdicts rather than a summary line.
 */
intelligenceRouter.get(
  '/products',
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = parseOrThrow(listUnifiedIntelligenceQuerySchema, req.query);

    const page = await unifiedService.listUnifiedIntelligence(req.auth.businessId, query);

    res.status(200).json({
      items: page.items,
      pagination: page.pagination,
    });
  }),
);

/**
 * GET /api/intelligence/products/:productId
 *
 * Orchestration only: every figure inside came from the engine that owns it. No
 * verdict, quantity, confidence or limitation is computed here.
 */
intelligenceRouter.get(
  '/products/:productId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { productId } = parseOrThrow(productIdParamSchema, req.params);
    const result = await unifiedService.getUnifiedIntelligence(
      req.auth.businessId,
      productId,
    );
    res.status(200).json({ data: result });
  }),
);
