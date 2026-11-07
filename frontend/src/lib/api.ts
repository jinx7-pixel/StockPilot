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
  token: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
  workspaceId?: string;
  mfaCode?: string;
}

export interface AccountSecurity {
  emailVerified: boolean;
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
}

export type LoginWorkspace = AuthenticatedUser['business'];
type LoginResult = { user: AuthenticatedUser } | { workspaces: LoginWorkspace[] };

export const api = {
  requestRegistration: (email: string) =>
    request<{ accepted: boolean }>('/api/auth/register/request', { method: 'POST', body: { email } }),

  register: (input: RegisterInput) =>
    request<{ user: AuthenticatedUser }>('/api/auth/register', { method: 'POST', body: input }),

  login: (input: LoginInput) =>
    request<LoginResult>('/api/auth/login', { method: 'POST', body: input }),

  logout: () => request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => request<{ loggedOut: boolean }>('/api/auth/logout-all', { method: 'POST' }),

  requestReset: (email: string) =>
    request<{ accepted: boolean }>('/api/auth/password/request', { method: 'POST', body: { email } }),
  resetPassword: (token: string, password: string) =>
    request<{ reset: boolean }>('/api/auth/password/reset', { method: 'POST', body: { token, password } }),
  security: () => request<AccountSecurity>('/api/auth/security'),
  requestVerification: () =>
    request<{ accepted: boolean }>('/api/auth/email/request', { method: 'POST' }),
  verifyEmail: (token: string) =>
    request<{ verified: boolean }>('/api/auth/email/verify', { method: 'POST', body: { token } }),
  startMfa: (password: string) =>
    request<{ secret: string }>('/api/auth/mfa/start', { method: 'POST', body: { password } }),
  enableMfa: (code: string) =>
    request<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', { method: 'POST', body: { code } }),
  disableMfa: (password: string, code: string) =>
    request<{ disabled: boolean }>('/api/auth/mfa/disable', { method: 'POST', body: { password, code } }),

  /** Throws `ApiError` with status 401 when there is no valid session. */
  me: () => request<{ user: AuthenticatedUser }>('/api/auth/me'),
};

export { ApiError } from './request';
