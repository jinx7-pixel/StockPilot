/**
 * Authentication API client.
 *
 * Transport lives in `request.ts`; this module only describes the auth contract.
 */

import { request } from './request';

export type UserRole = 'owner' | 'staff';

export interface AuthenticatedUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  role: UserRole;
  business: { id: string; name: string };
}

export interface RegisterInput {
  businessName: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const api = {
  register: (input: RegisterInput) =>
    request<{ user: AuthenticatedUser }>('/api/auth/register', { method: 'POST', body: input }),

  login: (input: LoginInput) =>
    request<{ user: AuthenticatedUser }>('/api/auth/login', { method: 'POST', body: input }),

  logout: () => request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),

  /** Throws `ApiError` with status 401 when there is no valid session. */
  me: () => request<{ user: AuthenticatedUser }>('/api/auth/me'),
};

export { ApiError } from './request';
