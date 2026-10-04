/**
 * Authentication state provider.
 *
 * The provider bootstraps by asking the server "who am I?" on mount, so the
 * browser holds no credential to store and no token to leak. `status` starts as
 * `loading` to avoid flashing the sign-in screen for an already-signed-in user.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, type AuthenticatedUser, type LoginInput, type RegisterInput } from '../lib/api';
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore the session on load. A 401 here is the expected "not signed in"
  // path, not a failure.
  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.isUnauthenticated) {
          setUser(null);
          setStatus('unauthenticated');
          return;
        }
        setError('Could not reach the server. Please try again.');
        setStatus('unauthenticated');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    setError(null);
    const data = await api.login(input);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    setError(null);
    const data = await api.register(input);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await api.logout();
    } finally {
      // Clear local state even if the network call failed: the user asked to
      // sign out, so never leave a stale identity on screen.
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, error, clearError }),
    [status, user, login, register, logout, error, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
