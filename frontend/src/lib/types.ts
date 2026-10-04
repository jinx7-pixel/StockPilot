/** Shared client-side types. Mirrors the API's redacted user shape. */

export type UserRole = 'owner' | 'staff';

export interface AuthenticatedUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: UserRole;
  business: { id: string; name: string };
}
