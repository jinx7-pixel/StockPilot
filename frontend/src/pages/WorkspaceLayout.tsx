/** Shared signed-in shell: a responsive navigation rail and routed workspace. */

import { useEffect, useState, type KeyboardEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { StockPilotLogo } from '../components/StockPilotLogo';
import './workspace.css';

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
const SIDEBAR_SHORTCUT = 'Ctrl + B';

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
  return `workspace-nav-link flex min-w-0 items-center gap-2.5 ${focusRing} ${isActive ? 'workspace-nav-current' : ''}`;
}

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

export function WorkspaceLayout() {
  const { user, logout, error, clearError } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    shortcut?: string;
    top: number;
    left: number;
  } | null>(null);
  const signedIn = Boolean(user);
  const isDevelopmentPreview = import.meta.env.DEV && user?.id === 'dev-preview-user';
  const route = location.pathname.split('/').slice(0, 3).join('/');
  const currentGroup = NAV_GROUPS.find((group) => group.items.some((item) => item.to === route));
  const currentItem = currentGroup?.items.find((item) => item.to === route);
  const menuButtonId = 'workspace-nav-toggle';

  useEffect(() => {
    if (!signedIn || typeof window.matchMedia !== 'function') return;

    const desktopViewport = window.matchMedia('(min-width: 1024px)');
    const restoreFullSidebarOnMobile = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        setSidebarCollapsed(false);
        setRailTooltip(null);
      }
    };

    const toggleSidebarWithShortcut = (event: globalThis.KeyboardEvent) => {
      if (!desktopViewport.matches || event.defaultPrevented || event.repeat || event.isComposing) return;
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== 'b') return;

      const target = event.target;
      if (target instanceof HTMLElement && target.isContentEditable) return;

      event.preventDefault();
      setRailTooltip(null);
      setSidebarCollapsed((collapsed) => !collapsed);
    };

    desktopViewport.addEventListener('change', restoreFullSidebarOnMobile);
    window.addEventListener('keydown', toggleSidebarWithShortcut);
    return () => {
      desktopViewport.removeEventListener('change', restoreFullSidebarOnMobile);
      window.removeEventListener('keydown', toggleSidebarWithShortcut);
    };
  }, [signedIn]);

  if (!user) return null;

  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((name) => name.charAt(0)).join('').toUpperCase();

  function dismissMenu() {
    setMenuOpen(false);
    document.getElementById(menuButtonId)?.focus();
  }

  function handleNavKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (menuOpen && event.key === 'Escape') {
      dismissMenu();
    }
  }

  function showRailTooltip(label: string, element: HTMLElement, shortcut?: string) {
    const bounds = element.getBoundingClientRect();
    setRailTooltip({ label, shortcut, top: bounds.top + bounds.height / 2, left: bounds.right + 8 });
  }

  return (
    <div onKeyDown={handleNavKeyDown} className="workspace-shell min-h-screen lg:flex">
      <header className="workspace-topbar sticky top-0 z-30 flex items-center justify-between px-4 lg:hidden">
        <div className="flex items-center gap-2.5">
          <StockPilotLogo className="workspace-mark" />
          <span className="workspace-wordmark">StockPilot</span>
        </div>
        <button
          type="button"
          id={menuButtonId}
          aria-expanded={menuOpen}
          aria-controls={NAV_GROUPS_ID}
          onClick={() => setMenuOpen((open) => !open)}
          className={`workspace-menu-button ${focusRing}`}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
          Menu
        </button>
      </header>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Dismiss navigation backdrop"
          tabIndex={-1}
          onClick={dismissMenu}
          className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden"
        />
      ) : null}

      <aside aria-hidden={sidebarCollapsed} inert={sidebarCollapsed} className={`${menuOpen ? 'flex' : 'hidden'} workspace-sidebar fixed inset-y-0 left-0 z-50 w-[min(19rem,86vw)] flex-col border-r border-slate-200 bg-white shadow-xl lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-screen lg:min-w-0 lg:shrink-0 lg:overflow-hidden lg:shadow-none lg:transition-[width,opacity] lg:duration-200 motion-reduce:transition-none ${sidebarCollapsed ? 'lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none' : 'lg:w-[236px] lg:opacity-100'}`}>
        <div className="workspace-sidebar-brand flex shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <StockPilotLogo className="workspace-mark" />
            <span className="workspace-wordmark">StockPilot</span>
          </div>
          <button
            type="button"
            aria-label="Collapse sidebar"
            aria-keyshortcuts="Control+B"
            aria-controls={NAV_GROUPS_ID}
            aria-expanded={!sidebarCollapsed}
            onClick={() => {
              setRailTooltip(null);
              setSidebarCollapsed(true);
            }}
            onMouseEnter={(event) => showRailTooltip('Collapse sidebar', event.currentTarget, SIDEBAR_SHORTCUT)}
            onMouseLeave={() => setRailTooltip(null)}
            onFocus={(event) => showRailTooltip('Collapse sidebar', event.currentTarget, SIDEBAR_SHORTCUT)}
            onBlur={() => setRailTooltip(null)}
            className={`workspace-icon-button hidden lg:grid ${focusRing}`}
          >
            <SidebarToggleIcon />
          </button>
          <button type="button" onClick={dismissMenu} aria-label="Close workspace navigation" className={`workspace-icon-button grid text-xl lg:hidden ${focusRing}`}>×</button>
        </div>

        <nav aria-label="Workspace" id={NAV_GROUPS_ID} className="workspace-nav-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-2">
          <div className="space-y-4 pb-4">
            {NAV_GROUPS.map((group) => {
              const labelId = groupLabelId(group.id);
              return (
                <section key={group.id} aria-labelledby={labelId}>
                  <span id={labelId} className="workspace-nav-label">{group.label}</span>
                  <ul aria-labelledby={labelId} className="min-w-0 mt-1.5 space-y-0.5">
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

          <div className="workspace-account sticky bottom-0 mt-auto bg-white pb-3 pt-2">
            <div className="workspace-business">
              <span className="workspace-avatar" aria-hidden="true">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900" title={user.business.name}>{user.business.name}</p>
                <p className="truncate text-xs text-slate-500"><span className="capitalize">{user.role}</span> workspace</p>
              </div>
            </div>
            <NavLink to="/app/security" onClick={() => setMenuOpen(false)}
              className={({ isActive }) => navClass(isActive)}>
              Account security
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className={`workspace-nav-link mt-1 flex w-full items-center gap-2.5 text-left ${focusRing}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
              Sign out
            </button>
          </div>
        </nav>
      </aside>

      <aside aria-label="Collapsed workspace sidebar" aria-hidden={!sidebarCollapsed} inert={!sidebarCollapsed} className={`hidden h-screen min-w-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:transition-[width,opacity] lg:duration-200 motion-reduce:transition-none ${sidebarCollapsed ? 'lg:w-16 lg:opacity-100' : 'lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none'}`}>
          <div className="workspace-sidebar-brand flex shrink-0 items-center justify-center">
            <button
              type="button"
              aria-label="Expand sidebar"
              aria-keyshortcuts="Control+B"
              aria-controls={NAV_GROUPS_ID}
              aria-expanded={false}
              onClick={() => {
                setRailTooltip(null);
                setSidebarCollapsed(false);
              }}
              onMouseEnter={(event) => showRailTooltip('Expand sidebar', event.currentTarget, SIDEBAR_SHORTCUT)}
              onMouseLeave={() => setRailTooltip(null)}
              onFocus={(event) => showRailTooltip('Expand sidebar', event.currentTarget, SIDEBAR_SHORTCUT)}
              onBlur={() => setRailTooltip(null)}
              className={`workspace-icon-button grid ${focusRing}`}
            >
              <SidebarToggleIcon />
            </button>
          </div>

          <nav aria-label="Workspace" className="workspace-nav-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <ul className="space-y-1">
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
                    className={({ isActive }) => `workspace-icon-button mx-auto grid ${focusRing} ${isActive ? 'workspace-nav-current' : ''}`}
                  >
                    <NavigationIcon to={item.to} />
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="shrink-0 border-t border-slate-200 p-2">
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => void logout()}
              onMouseEnter={(event) => showRailTooltip('Sign out', event.currentTarget)}
              onMouseLeave={() => setRailTooltip(null)}
              onFocus={(event) => showRailTooltip('Sign out', event.currentTarget)}
              onBlur={() => setRailTooltip(null)}
              className={`workspace-icon-button mx-auto grid ${focusRing}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
            </button>
          </div>
      </aside>

      {railTooltip ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-md"
          style={{ top: railTooltip.top, left: railTooltip.left }}
        >
          {railTooltip.label}
          {railTooltip.shortcut && (
            <kbd className="ml-2 rounded border border-slate-600 px-1.5 py-0.5 font-sans text-[10px] text-slate-200">
              {railTooltip.shortcut}
            </kbd>
          )}
        </div>
      ) : null}

      <main className="min-w-0 flex-1">
        <div className="workspace-topbar sticky top-0 z-20 hidden items-center justify-between gap-4 px-7 lg:flex" aria-label="Workspace context">
          <div className="flex min-w-0 items-center gap-2.5 text-sm text-slate-500">
            {currentItem ? <NavigationIcon to={currentItem.to} /> : null}
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <span className="truncate font-semibold text-slate-900">
              {location.pathname === '/app/security' ? 'Account security' : currentItem?.label ?? 'Overview'}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2.5 border-l border-slate-200 pl-4">
            {sidebarCollapsed && <NavLink to="/app/security" className="text-sm font-medium text-slate-700 hover:underline">
              Account security
            </NavLink>}
            <span className="truncate text-sm font-medium text-slate-700" title={user.name}>{user.name}</span>
            <span className="workspace-avatar" aria-hidden="true">{initials}</span>
          </div>
        </div>
        <div className="workspace-content mx-auto w-full max-w-[1620px] px-4 py-5 sm:px-6 lg:px-7 lg:py-7 2xl:px-9">
          {error && <div className="mb-5 flex items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-950">
            <p role="alert">{error}</p>
            <button type="button" onClick={clearError} className="font-semibold">Dismiss</button>
          </div>}
          {isDevelopmentPreview ? (
            <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
              Development preview · Sample data
            </p>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
