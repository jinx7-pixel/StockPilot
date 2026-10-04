/**
 * Placeholder for the signed-in area.
 *
 * Deliberately NOT the dashboard â€” that is a later milestone. This exists only to
 * prove the protected-route and session plumbing work, and to give the user a way
 * to sign out.
 */

import { useAuth } from '../auth/authContext';

export function WorkspacePage() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-widest text-brand-600 uppercase">
              StockPilot
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {user.business.name}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            Sign out
          </button>
        </header>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Signed in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Authentication is working end to end. Business modules come next.
          </p>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-slate-500">Name</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{user.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Email</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Role</dt>
              <dd className="mt-0.5 font-medium text-slate-900 capitalize">{user.role}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Business ID</dt>
              <dd className="mt-0.5 font-mono text-xs break-all text-slate-900">
                {user.businessId}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}

