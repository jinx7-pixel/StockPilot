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

const isDevelopmentPreview =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.location.pathname === '/app' &&
  new URLSearchParams(window.location.search).get('preview') === '1';

const developmentPreviewUser: AuthenticatedUser = {
  id: 'dev-preview-user',
  businessId: 'dev-preview-business',
  name: 'Demo User',
  email: 'demo@stockpilot.local',
  role: 'owner',
  business: { id: 'dev-preview-business', name: 'StockPilot Demo Workspace' },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isDevelopmentPreview ? 'authenticated' : 'loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(
    isDevelopmentPreview ? developmentPreviewUser : null,
  );
  const [error, setError] = useState<string | null>(null);

  // Restore the session on load. A 401 here is the expected "not signed in"
  // path, not a failure.
  useEffect(() => {
    // This explicit Vite-development-only entry lets the workspace UI be previewed
    // without a running backend. It never changes production authentication.
    if (isDevelopmentPreview) return;

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
    if ('workspaces' in data) return data.workspaces;

    setUser(data.user);
    setStatus('authenticated');
    return null;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    setError(null);
    const data = await api.register(input);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async (all: boolean) => {
    setError(null);
    try {
      if (all) await api.logoutAll();
      else await api.logout();
      setUser(null);
      setStatus('unauthenticated');
    } catch {
      setError('Sign-out could not be confirmed. Please try again.');
    }
  }, []);
  const logout = useCallback(() => signOut(false), [signOut]);
  const logoutAll = useCallback(() => signOut(true), [signOut]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, logoutAll, error, clearError }),
    [status, user, login, register, logout, logoutAll, error, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
