/**
 * Signed-in shell: header, navigation and the routed area.
 *
 * Explicitly not the dashboard — that is a later milestone. This exists to host
 * the protected pages and give the user a sign-out action.
 */

import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/authContext';

const NAV = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/analytics', label: 'Analytics', end: true },
  { to: '/app/stock-risk', label: 'Stock risk', end: true },
  { to: '/app/demand', label: 'Demand', end: true },
  { to: '/app/reorder', label: 'Reorder', end: true },
  { to: '/app/overstock', label: 'Overstock', end: true },
  { to: '/app/inventory', label: 'Inventory', end: true },
  { to: '/app/sales', label: 'Sales', end: true },
  { to: '/app/purchase-orders', label: 'Purchase orders', end: true },
  { to: '/app/suppliers', label: 'Suppliers', end: true },
  { to: '/app/products', label: 'Products', end: false },
  { to: '/app/categories', label: 'Categories', end: false },
] as const;

function navClass(isActive: boolean): string {
  return [
    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
    isActive
      ? 'bg-brand-100 text-brand-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  ].join(' ');
}

export function WorkspaceLayout() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
              StockPilot
            </p>
            <p className="text-lg font-bold tracking-tight text-slate-900">{user.business.name}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">
              {user.name} · <span className="capitalize">{user.role}</span>
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="mx-auto max-w-5xl px-6 pb-3">
          <ul className="flex gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
