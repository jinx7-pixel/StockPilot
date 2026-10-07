/**
 * Supplier business rules.
 *
 * Suppliers are tenant-scoped and **deactivated, never deleted**, so historical
 * purchase orders keep a valid reference. There is deliberately no delete
 * function: the API exposes none, and the database's `ON DELETE NO ACTION` would
 * refuse it anyway for any supplier that has history.
 */

import type { PoolClient } from 'pg';

import { ConflictError, NotFoundError } from '../errors.js';
import {
  createSupplier,
  findSupplierById,
  listSuppliers,
  supplierNameExists,
  updateSupplier,
  type Supplier,
} from '../repositories/supplier.repository.js';
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from './supplier.schemas.js';

export interface SupplierPage {
  items: Supplier[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listBusinessSuppliers(
  businessId: string,
  query: ListSuppliersQuery,
): Promise<SupplierPage> {
  const { items, total } = await listSuppliers(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/** A supplier in another business is simply not found. */
export async function getSupplier(businessId: string, supplierId: string): Promise<Supplier> {
  const supplier = await findSupplierById(businessId, supplierId);
  if (!supplier) throw new NotFoundError('Supplier not found.');
  return supplier;
}

export async function createSupplierForBusiness(
  businessId: string,
  input: CreateSupplierInput,
): Promise<Supplier> {
  // Uniqueness is case-insensitive, matching the expression index.
  if (await supplierNameExists(businessId, input.name)) {
    throw new ConflictError('A supplier with this name already exists.', 'SUPPLIER_NAME_TAKEN');
  }

  return createSupplier({
    businessId,
    name: input.name,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
  });
}

export async function updateSupplierForBusiness(
  businessId: string,
  supplierId: string,
  input: UpdateSupplierInput,
): Promise<Supplier> {
  // Confirms existence *and* tenant ownership before the name check, so a
  // cross-tenant update 404s instead of leaking a name conflict.
  await getSupplier(businessId, supplierId);

  if (input.name !== undefined && (await supplierNameExists(businessId, input.name, supplierId))) {
    throw new ConflictError('A supplier with this name already exists.', 'SUPPLIER_NAME_TAKEN');
  }

  const updated = await updateSupplier({
    businessId,
    supplierId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });

  if (!updated) throw new NotFoundError('Supplier not found.');
  return updated;
}

/**
 * Confirm a supplier id belongs to this business and is usable for new orders.
 *
 * A foreign supplier yields the same error as a non-existent one, so a caller
 * cannot probe for another tenant's suppliers.
 */
export async function assertSupplierUsable(
  businessId: string,
  supplierId: string,
  client?: PoolClient,
): Promise<void> {
  const supplier = await findSupplierById(businessId, supplierId, client);

  if (!supplier) {
    throw new NotFoundError('Supplier not found.', 'SUPPLIER_NOT_FOUND');
  }

  if (!supplier.isActive) {
    throw new ConflictError(
      `Supplier "${supplier.name}" is inactive. Reactivate it before raising new orders.`,
      'SUPPLIER_INACTIVE',
    );
  }
}
