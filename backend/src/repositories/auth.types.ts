/**
 * Row types and mapping for the auth tables.
 *
 * These are the only shapes that mirror the database. Everything above this
 * layer (services, routes, clients) uses the redacted DTOs from
 * `services/auth.service.ts` instead, so a `password_hash` cannot reach a
 * response body by accident.
 */

export const USER_ROLES = ['owner', 'staff'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export interface BusinessRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  id: string;
  business_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  last_used_at: Date;
}

/** A user joined to their business — the shape every authenticated read needs. */
export interface UserWithBusinessRow extends UserRow {
  business_name: string;
}
