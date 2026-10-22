/** Shared signed-in shell: a responsive navigation rail and routed workspace. */

import { useEffect, useState, type KeyboardEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/authContext';

interface NavItem {
  to: string;
  label: string;
  end: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { to: '/app', label: 'Dashboard', end: true },
      { to: '/app/analytics', label: 'Analytics', end: true },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { to: '/app/products', label: 'Products', end: false },
      { to: '/app/categories', label: 'Categories', end: false },
      { to: '/app/inventory', label: 'Inventory', end: false },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/app/sales', label: 'Sales', end: false },
      { to: '/app/purchase-orders', label: 'Purchase orders', end: false },
      { to: '/app/suppliers', label: 'Suppliers', end: true },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { to: '/app/stock-risk', label: 'Stock risk', end: true },
      { to: '/app/demand', label: 'Demand', end: true },
      { to: '/app/reorder', label: 'Reorder', end: true },
      { to: '/app/overstock', label: 'Overstock', end: true },
      { to: '/app/intelligence', label: 'Intelligence', end: true },
      { to: '/app/recommendations', label: 'Recommendations', end: true },
      { to: '/app/actions', label: 'Actions', end: true },
      { to: '/app/slow-dead', label: 'Slow / Dead Stock', end: true },
      { to: '/app/supplier-intelligence', label: 'Supplier Intelligence', end: true },
    ],
  },
] as const;

const NAV_GROUPS_ID = 'workspace-nav-groups';

const NAV_ICON_PATHS: Record<string, string> = {
  '/app': 'M3.5 3.5h7v7h-7zM13.5 3.5h7v5h-7zM13.5 11.5h7v9h-7zM3.5 13.5h7v7h-7z',
  '/app/analytics': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  '/app/products': 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM12 12v9M4 7.5 12 12l8-4.5',
  '/app/categories': 'm12 3 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  '/app/inventory': 'M4 5h16v14H4zM8 9h8M8 13h5M8 16h3',
  '/app/sales': 'M4 19V5M4 19h16M7 15l4-4 3 2 5-6',
  '/app/purchase-orders': 'M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h7',
  '/app/suppliers': 'M3 7h11v10H3zM14 10h4l3 3v4h-7M6 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  '/app/stock-risk': 'M12 3 2.8 20.5h18.4zM12 9v5M12 17v.1',
  '/app/demand': 'M3 17 8 12l4 3 8-9M15 6h5v5',
  '/app/reorder': 'M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 6l2 1M4 17l2-1a7 7 0 0 0 12.5-3',
  '/app/overstock': 'M4 19h16M6 16V9M12 16V5M18 16v-4',
  '/app/intelligence': 'M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10',
  '/app/recommendations': 'M5 5h14M5 10h14M5 15h9M5 20h7',
  '/app/actions': 'M4 12h15M13 6l6 6-6 6',
  '/app/slow-dead': 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  '/app/supplier-intelligence': 'M3 17 8 12l4 3 8-9M15 6h5v5',
};

function NavigationIcon({ to }: { to: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={NAV_ICON_PATHS[to]} />
    </svg>
  );
}

function SidebarToggleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M10 5v14" />
    </svg>
  );
}

function groupLabelId(groupId: string): string {
  return `workspace-nav-group-${groupId}`;
}

function navClass(isActive: boolean): string {
  return [
    'flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
    isActive
      ? 'border-emerald-400/15 bg-emerald-400/[0.09] text-emerald-200 shadow-[inset_2px_0_0_0_#34d399]'
      : 'border-transparent text-slate-400 hover:bg-white/[0.045] hover:text-slate-100',
  ].join(' ');
}

const signOutFocusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1220]';

export function WorkspaceLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const isDevelopmentPreview = import.meta.env.DEV && user?.id === 'dev-preview-user';
  const isDashboard = location.pathname === '/app';
  const isAnalytics = location.pathname === '/app/analytics';
  const isProducts = location.pathname === '/app/products';
  const isSuppliers = location.pathname === '/app/suppliers';
  const isCategories = location.pathname === '/app/categories';
  const isInventory = location.pathname === '/app/inventory';
  const isSales = location.pathname === '/app/sales';
  const isStockRisk = location.pathname === '/app/stock-risk';
  const isPurchaseOrders = location.pathname === '/app/purchase-orders';
  const isPurchaseOrderPage = location.pathname.startsWith('/app/purchase-orders');
  const isDemand = location.pathname === '/app/demand';
  const isReorder = location.pathname === '/app/reorder';
  const isOverstock = location.pathname === '/app/overstock';
  const isIntelligence = location.pathname === '/app/intelligence';
  const isRecommendations = location.pathname === '/app/recommendations';
  const isActions = location.pathname === '/app/actions';
  const isSlowDead = location.pathname === '/app/slow-dead';
  const isSupplierIntelligence = location.pathname === '/app/supplier-intelligence';
  const isDarkWorkspacePage = isDashboard || isAnalytics || isProducts || isSuppliers || isCategories || isInventory || isSales || isPurchaseOrderPage || isStockRisk || isDemand || isReorder || isOverstock || isIntelligence || isRecommendations || isActions || isSlowDead || isSupplierIntelligence;
  const isWideWorkspacePage = isDashboard || isAnalytics || isProducts || isPurchaseOrders || isStockRisk || isDemand || isReorder || isOverstock || isSlowDead || isSupplierIntelligence;
  const menuButtonId = 'workspace-nav-toggle';

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const desktopViewport = window.matchMedia('(min-width: 1024px)');
    const restoreFullSidebarOnMobile = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        setSidebarCollapsed(false);
        setRailTooltip(null);
      }
    };

    desktopViewport.addEventListener('change', restoreFullSidebarOnMobile);
    return () => desktopViewport.removeEventListener('change', restoreFullSidebarOnMobile);
  }, []);

  if (!user) return null;

  function handleNavKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (menuOpen && event.key === 'Escape') {
      setMenuOpen(false);
      document.getElementById(menuButtonId)?.focus();
    }
  }

  function showRailTooltip(label: string, element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    setRailTooltip({ label, top: bounds.top + bounds.height / 2, left: bounds.right + 8 });
  }

  return (
    <div onKeyDown={handleNavKeyDown} className="min-h-screen bg-[#0a1120] text-slate-100 lg:flex">
      <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-slate-800 bg-[#0a1120]/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400 text-[#06251a]">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 10.3 3.2 3.2 7.8-7.8" /></svg>
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">Stock<span className="text-emerald-300">Pilot</span></span>
        </div>
        <button
          type="button"
          id={menuButtonId}
          aria-expanded={menuOpen}
          aria-controls={NAV_GROUPS_ID}
          onClick={() => setMenuOpen((open) => !open)}
          className={`inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 ${signOutFocusRing}`}
        >
          <span aria-hidden="true" className="text-lg leading-none">{menuOpen ? '×' : '☰'}</span>
          Menu
        </button>
      </header>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Dismiss navigation backdrop"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      <aside aria-hidden={sidebarCollapsed} inert={sidebarCollapsed} className={`${menuOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-[min(19rem,86vw)] flex-col border-r border-slate-800 bg-[#0b1220] shadow-2xl lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-screen lg:min-w-0 lg:shrink-0 lg:overflow-hidden lg:shadow-none lg:transition-[width,opacity] lg:duration-300 lg:ease-in-out motion-reduce:transition-none ${sidebarCollapsed ? 'lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none' : 'lg:w-[260px] lg:opacity-100'}`}>
        <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-slate-800/80 px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400 text-[#06251a] shadow-[0_0_26px_-10px_rgba(52,211,153,0.9)]">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 10.3 3.2 3.2 7.8-7.8" /></svg>
            </span>
            <span className="text-base font-semibold tracking-tight text-white">Stock<span className="text-emerald-300">Pilot</span></span>
          </div>
          <button
            type="button"
            aria-label="Collapse sidebar"
            aria-controls={NAV_GROUPS_ID}
            aria-expanded={!sidebarCollapsed}
            onClick={() => {
              setRailTooltip(null);
              setSidebarCollapsed(true);
            }}
            onMouseEnter={(event) => showRailTooltip('Collapse sidebar', event.currentTarget)}
            onMouseLeave={() => setRailTooltip(null)}
            onFocus={(event) => showRailTooltip('Collapse sidebar', event.currentTarget)}
            onBlur={() => setRailTooltip(null)}
            className={`hidden h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 lg:grid ${signOutFocusRing}`}
          >
            <SidebarToggleIcon />
          </button>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close workspace navigation" className={`grid h-8 w-8 place-items-center rounded-lg text-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden ${signOutFocusRing}`}>×</button>
        </div>

        <nav aria-label="Workspace" id={NAV_GROUPS_ID} className="workspace-nav-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-5">
          <div className="space-y-6">
            {NAV_GROUPS.map((group) => {
              const labelId = groupLabelId(group.id);
              return (
                <section key={group.id} aria-labelledby={labelId}>
                  <span id={labelId} className="block px-3 text-[10px] font-semibold tracking-[0.18em] text-slate-600 uppercase">{group.label}</span>
                  <ul aria-labelledby={labelId} className="min-w-0 mt-2 space-y-1">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          onClick={() => setMenuOpen(false)}
                          className={({ isActive }) => navClass(isActive)}
                        >
                          <NavigationIcon to={item.to} />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <div className="mt-auto pt-6">
            <div className="mb-3 rounded-xl border border-slate-800/80 bg-white/[0.025] p-3">
              <p className="truncate text-sm font-medium text-slate-200">{user.business.name}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{user.name} <span className="px-1 text-slate-700">·</span> <span className="capitalize">{user.role}</span></p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-100 ${signOutFocusRing}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
              Sign out
            </button>
          </div>
        </nav>
      </aside>

      <aside aria-label="Collapsed workspace sidebar" aria-hidden={!sidebarCollapsed} inert={!sidebarCollapsed} className={`hidden h-screen min-w-0 shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-[#0b1220] lg:sticky lg:top-0 lg:flex lg:transition-[width,opacity] lg:duration-300 lg:ease-in-out motion-reduce:transition-none ${sidebarCollapsed ? 'lg:w-16 lg:opacity-100' : 'lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none'}`}>
          <div className="flex h-[76px] shrink-0 items-center justify-center border-b border-slate-800/80">
            <button
              type="button"
              aria-label="Expand sidebar"
              aria-controls={NAV_GROUPS_ID}
              aria-expanded={false}
              onClick={() => {
                setRailTooltip(null);
                setSidebarCollapsed(false);
              }}
              onMouseEnter={(event) => showRailTooltip('Expand sidebar', event.currentTarget)}
              onMouseLeave={() => setRailTooltip(null)}
              onFocus={(event) => showRailTooltip('Expand sidebar', event.currentTarget)}
              onBlur={() => setRailTooltip(null)}
              className={`grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${signOutFocusRing}`}
            >
              <SidebarToggleIcon />
            </button>
          </div>

          <nav aria-label="Workspace" className="workspace-nav-scroll min-h-0 flex-1 overflow-y-auto px-2 py-4">
            <ul className="space-y-2">
              {NAV_GROUPS.flatMap((group) => group.items).map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    aria-label={item.label}
                    onClick={() => setMenuOpen(false)}
                    onMouseEnter={(event) => showRailTooltip(item.label, event.currentTarget)}
                    onMouseLeave={() => setRailTooltip(null)}
                    onFocus={(event) => showRailTooltip(item.label, event.currentTarget)}
                    onBlur={() => setRailTooltip(null)}
                    className={({ isActive }) => [
                      'mx-auto grid h-10 w-10 place-items-center rounded-xl border transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
                      isActive
                        ? 'border-emerald-400/15 bg-emerald-400/[0.09] text-emerald-200'
                        : 'border-transparent text-slate-500 hover:bg-white/[0.045] hover:text-slate-100',
                    ].join(' ')}
                  >
                    <NavigationIcon to={item.to} />
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="shrink-0 border-t border-slate-800/80 p-2">
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => void logout()}
              onMouseEnter={(event) => showRailTooltip('Sign out', event.currentTarget)}
              onMouseLeave={() => setRailTooltip(null)}
              onFocus={(event) => showRailTooltip('Sign out', event.currentTarget)}
              onBlur={() => setRailTooltip(null)}
              className={`mx-auto grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-white/[0.045] hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${signOutFocusRing}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
            </button>
          </div>
      </aside>

      {railTooltip ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-[#0b1220] px-2.5 py-1.5 text-xs font-medium text-slate-200 shadow-xl"
          style={{ top: railTooltip.top, left: railTooltip.left }}
        >
          {railTooltip.label}
        </div>
      ) : null}

      <main className={`min-w-0 flex-1 ${isDarkWorkspacePage ? 'bg-[#0a1120] text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
        <div className={isWideWorkspacePage ? 'mx-auto w-full max-w-[1740px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9' : 'mx-auto max-w-5xl px-6 py-8'}>
          {isDevelopmentPreview ? (
            <p className={`mb-6 rounded-xl border px-4 py-3 text-sm ${isDarkWorkspacePage ? 'border-amber-300/15 bg-amber-300/[0.06] text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
              Development preview · illustrative sample data, not live business data.
            </p>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
