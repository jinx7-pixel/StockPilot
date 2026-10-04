/**
 * Route guard.
 *
 * Two rules, in order:
 *  - while the session is still being restored, render nothing decisive, so a
 *    signed-in user is not bounced to /login by a race;
 *  - an unauthenticated visitor is redirected to /login, remembering where they
 *    were headed.
 *
 * Note the tenant is never taken from the URL: business scope comes from the
 * session, so there is no `/:businessId` segment to tamper with.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './authContext';

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
      {children}
    </div>
  );
}

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <FullPageMessage>
        <p className="text-sm">Checking your sessionâ€¦</p>
      </FullPageMessage>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/** Inverse guard: keeps a signed-in user away from the sign-in screens. */
export function PublicOnlyRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <FullPageMessage>
        <p className="text-sm">Checking your sessionâ€¦</p>
      </FullPageMessage>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/app" replace />;
  }

  return <Outlet />;
}

