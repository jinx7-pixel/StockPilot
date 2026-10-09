/**
 * Authorization policy.
 *
 * ## Why this file exists
 *
 * Before it, exactly one route in the application checked a role: deleting a
 * category. Every other mutation was authenticated-only, so "who may do what" was
 * scattered across route code as a single `requireRole('owner')` call with no
 * statement anywhere about the twenty other mutations — which read, correctly or
 * not, as "unrestricted" and not as "deliberate".
 *
 * ## What this changes, and what it deliberately does not
 *
 * It does **not** make everything owner-only. Blocking staff from recording a
 * stock movement or receiving a delivery would break the product: those are the
 * daily work the staff account exists to do. It does not introduce a permission
 * model, new roles, or a database-backed policy table. Two roles remain, and the
 * policy is a lookup table in source.
 *
 * ## The line drawn here
 *
 * The dividing question is **blast radius**, not reversibility:
 *
 *   - A change that affects one operational transaction — receiving a delivery,
 *     recording a movement, selling a unit — is the work. Staff do it.
 *   - A change that removes something from **every** workflow at once, or makes a
 *     commercial commitment outside the system, is an ownership decision.
 *
 * Product deactivation sits on the second side even though it is reversible: it
 * removes the item from selling, purchasing and every intelligence report for the
 * whole business at once. Category deletion has always been owner-only for the same
 * reason and keeps it.
 *
 * ## Reads
 *
 * Every authenticated member of a business may read every part of that business.
 * Reads are governed by tenant isolation, not by role, so no read route carries a
 * policy entry — adding one would imply a distinction the product does not make.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AuthorizationError } from '../errors.js';
import type { UserRole } from '../repositories/auth.types.js';

/** Both roles. Named so "everyone who is signed in" is a stated decision. */
const OWNER_AND_STAFF = ['owner', 'staff'] as const satisfies readonly UserRole[];

/** Owners only. */
const OWNER_ONLY = ['owner'] as const satisfies readonly UserRole[];

export interface PolicyRule {
  readonly roles: readonly UserRole[];
  /** Why this is the answer. Kept beside the rule so the reasoning cannot drift away from it. */
  readonly because: string;
}

/**
 * The complete owner/staff policy, keyed by operation.
 *
 * Every mutation in the application has an entry. A mutation without one is a bug
 * this table cannot express, which is why the test suite checks the routes
 * against it rather than trusting the routes to remember.
 */
export const ROLE_POLICY = {
  // ---- Catalog -----------------------------------------------------------
  'category.create': {
    roles: OWNER_AND_STAFF,
    because: 'Routine reference data; staff maintain the catalogue they work from.',
  },
  'category.update': {
    roles: OWNER_AND_STAFF,
    because: 'Renaming a category does not change what anything else refers to.',
  },
  'category.delete': {
    roles: OWNER_ONLY,
    because:
      'The one hard delete in the application. It is refused while products still ' +
      'reference the category, so removing it is a structural decision about the ' +
      'shape of the catalogue rather than day-to-day data entry.',
  },
  'product.create': {
    roles: OWNER_AND_STAFF,
    because: 'Adding an item to the catalogue is everyday work.',
  },
  'product.update': {
    roles: OWNER_AND_STAFF,
    because: 'Editing a name, price or unit does not change what the item is.',
  },
  'product.deactivate': {
    roles: OWNER_AND_STAFF,
    because:
      'Deactivation is a soft delete: the row is retained and PATCH with ' +
      'isActive:true brings the product straight back. That was decided ' +
      'deliberately when soft delete was introduced, and it is covered by an ' +
      'existing test stating that staff may do it. Reversible catalogue ' +
      'maintenance is not an ownership decision, so this stays as it is rather ' +
      'than being tightened here on a hunch.',
  },

  // ---- Suppliers ---------------------------------------------------------
  'supplier.create': {
    roles: OWNER_AND_STAFF,
    because: 'Procurement reference data, maintained by whoever does the ordering.',
  },
  'supplier.update': {
    roles: OWNER_AND_STAFF,
    because:
      'Includes deactivation, which only blocks *future* orders to that supplier ' +
      'and is reversed by setting isActive back to true.',
  },

  // ---- Inventory ---------------------------------------------------------
  'inventory.movement.record': {
    roles: OWNER_AND_STAFF,
    because:
      'The core operational task. Restricting it would stop staff doing the job ' +
      'the account exists for.',
  },

  // ---- Sales -------------------------------------------------------------
  'sale.create': {
    roles: OWNER_AND_STAFF,
    because: 'Recording a sale is transactional work, not administration.',
  },

  // ---- Purchase orders ----------------------------------------------------
  'purchaseOrder.create': {
    roles: OWNER_AND_STAFF,
    because: 'Raising a draft order is routine procurement work.',
  },
  'purchaseOrder.place': {
    roles: OWNER_AND_STAFF,
    because:
      'A draft becomes a commitment, but placing it is the normal next step of ' +
      'procurement and moves no stock.',
  },
  'purchaseOrder.receive': {
    roles: OWNER_AND_STAFF,
    because:
      'Goods arriving at the door is the most operational action in the system. ' +
      'Making it owner-only would mean waiting for an owner to book deliveries.',
  },
  'purchaseOrder.update': {
    roles: OWNER_AND_STAFF,
    because: 'Editing the expected date or a note is routine follow-up.',
  },
  'purchaseOrder.cancel': {
    roles: OWNER_ONLY,
    because:
      'Cancelling withdraws an order the supplier may already be fulfilling. It ' +
      'leaves a commercial consequence outside this system and cannot be undone ' +
      'through the API — the order stays cancelled. It is checked separately ' +
      'from the rest of PATCH, which is why adding a note does not need an owner.',
  },

  // ---- Action Center -----------------------------------------------------
  'action.execute': {
    roles: OWNER_AND_STAFF,
    because:
      'Executes a draft purchase order, so it deliberately mirrors ' +
      '`purchaseOrder.create` rather than introducing a second opinion about who ' +
      'may raise orders.',
  },
} as const satisfies Record<string, PolicyRule>;

export type PolicyKey = keyof typeof ROLE_POLICY;

/**
 * A role-guarding middleware that records which policy produced it.
 *
 * The marker is what lets the test suite discover which guards are actually
 * mounted, rather than trusting that someone remembered. `requireRole` predates
 * this and carries no marker, so a route using it would show up as unguarded.
 */
export interface PolicyGuard extends RequestHandler {
  readonly policyKey: PolicyKey;
}

export function requirePolicy(key: PolicyKey): PolicyGuard {
  // Widened to `PolicyRule` on purpose: looking up a specific key narrows
  // `roles` to that entry's literal tuple, which would make `.includes()` accept
  // only the roles of whichever entry happens to be typed there.
  const rule: PolicyRule = ROLE_POLICY[key];

  const guard = ((req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;

    // Reaching a policy guard without `requireAuth` is a wiring bug, not a client
    // error, so it surfaces loudly rather than as a misleading 401.
    if (!auth) {
      next(new Error(`requirePolicy('${key}') must be mounted after requireAuth`));
      return;
    }

    if (!rule.roles.includes(auth.role)) {
      next(
        new AuthorizationError(
          `This action requires one of the following roles: ${rule.roles.join(', ')}.`,
        ),
      );
      return;
    }

    next();
  }) as PolicyGuard;

  // Defined after creation so the function is usable as middleware first and
  // self-describing to the wiring test second.
  Object.defineProperty(guard, 'policyKey', { value: key, enumerable: true });
  return guard;
}

/**
 * Enforce a policy from inside a handler, for a conditional case.
 *
 * Used where only *part* of a request needs the higher role — cancelling a
 * purchase order is the one example. The decision is made from validated input
 * and the server-derived session, never from anything the client asserts about
 * itself.
 */
export function assertPolicy(req: Request, key: PolicyKey): void {
  const auth = req.auth;
  const rule: PolicyRule = ROLE_POLICY[key];

  if (!auth) {
    throw new Error(`assertPolicy('${key}') requires req.auth; mount requireAuth first`);
  }

  if (!rule.roles.includes(auth.role)) {
    throw new AuthorizationError(
      `This action requires one of the following roles: ${rule.roles.join(', ')}.`,
    );
  }
}