/**
 * Supplier persistence.
 *
 * Every function takes `businessId` explicitly; there is no unscoped lookup, so
 * a forgotten tenant scope is a compile error rather than a data leak.
 *
 * Suppliers are **deactivated, never deleted**: purchase orders reference them
 * with `ON DELETE NO ACTION`, so a supplier that has history cannot be removed.
 * `updated_at` is maintained by the `suppliers_set_updated_at` trigger, not by
 * these statements.
 */

import type { PoolClient } from 'pg';

import { query } from '../db/pool.js';

export interface Supplier {
  id: string;
  businessId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SupplierRow {
  id: string;
  business_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, business_id, name, contact_name, phone, email, address, notes, is_active, created_at, updated_at';

const SELECT = `SELECT ${COLUMNS} FROM suppliers`;

function mapRow(row: SupplierRow): Supplier {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListSuppliersFilters {
  search?: string;
  isActive?: boolean;
  limit: number;
  offset: number;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listSuppliers(
  businessId: string,
  filters: ListSuppliersFilters,
): Promise<{ items: Supplier[]; total: number }> {
  const conditions: string[] = ['business_id = $1'];
  const params: unknown[] = [businessId];

  if (filters.search !== undefined) {
    params.push(`%${escapeLikePattern(filters.search)}%`);
    const placeholder = `$${params.length}`;
    conditions.push(
      `(name ILIKE ${placeholder} ESCAPE '\\' OR contact_name ILIKE ${placeholder} ESCAPE '\\')`,
    );
  }

  if (filters.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`is_active = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM suppliers WHERE ${where}`,
    params,
  );

  const pageParams = [...params, filters.limit, filters.offset];
  const limitPlaceholder = `$${pageParams.length - 1}`;
  const offsetPlaceholder = `$${pageParams.length}`;

  // Ordering is fixed server-side; there is no user-controllable ORDER BY,
  // because the value cannot be parameterised.
  const result = await query<SupplierRow>(
    `${SELECT} WHERE ${where} ORDER BY lower(name) ASC, id ASC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    pageParams,
  );

  return {
    items: result.rows.map(mapRow),
    total: countResult.rows[0]?.count ?? 0,
  };
}

export async function findSupplierById(
  businessId: string,
  supplierId: string,
  client?: PoolClient,
): Promise<Supplier | null> {
  // The optional client mirrors `findPurchaseOrderById`: pass one to read inside
  // a caller's transaction, omit it for an ordinary pool-scoped read.
  const sql = `${SELECT} WHERE business_id = $1 AND id = $2`;
  const result = client
    ? await client.query<SupplierRow>(sql, [businessId, supplierId])
    : await query<SupplierRow>(sql, [businessId, supplierId]);

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** Case-insensitive, matching the unique expression index. */
export async function supplierNameExists(
  businessId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM suppliers
        WHERE business_id = $1
          AND lower(name) = lower($2)
          AND ($3::uuid IS NULL OR id <> $3::uuid)
     ) AS exists`,
    [businessId, name, excludeId ?? null],
  );
  return result.rows[0]?.exists ?? false;
}

export async function createSupplier(input: {
  businessId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}): Promise<Supplier> {
  const result = await query<SupplierRow>(
    `INSERT INTO suppliers
       (business_id, name, contact_name, phone, email, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      input.businessId,
      input.name,
      input.contactName,
      input.phone,
      input.email,
      input.address,
      input.notes,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Failed to create supplier');
  return mapRow(row);
}

/**
 * Partial update. `updated_at` is intentionally omitted: the
 * `suppliers_set_updated_at` trigger owns it.
 */
export async function updateSupplier(input: {
  businessId: string;
  supplierId: string;
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}): Promise<Supplier | null> {
  const result = await query<SupplierRow>(
    `UPDATE suppliers
        SET name         = COALESCE($3, name),
            contact_name = CASE WHEN $4::boolean THEN $5::text ELSE contact_name END,
            phone        = CASE WHEN $6::boolean THEN $7::text ELSE phone END,
            email        = CASE WHEN $8::boolean THEN $9::text ELSE email END,
            address      = CASE WHEN $10::boolean THEN $11::text ELSE address END,
            notes        = CASE WHEN $12::boolean THEN $13::text ELSE notes END,
            is_active    = COALESCE($14::boolean, is_active)
      WHERE business_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    [
      input.businessId,
      input.supplierId,
      input.name ?? null,
      input.contactName !== undefined,
      input.contactName ?? null,
      input.phone !== undefined,
      input.phone ?? null,
      input.email !== undefined,
      input.email ?? null,
      input.address !== undefined,
      input.address ?? null,
      input.notes !== undefined,
      input.notes ?? null,
      input.isActive ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
