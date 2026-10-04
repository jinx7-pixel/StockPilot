/**
 * Auth context definition and consumer hook.
 *
 * Kept separate from `AuthProvider.tsx` so that file only exports a component —
 * otherwise React Fast Refresh cannot preserve state between edits.
 */

import { createContext, useContext } from 'react';

import type { AuthenticatedUser, LoginInput, RegisterInput } from '../lib/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Set when a sign-in attempt fails, for display on the form. */
  error: string | null;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }

  return context;
}
