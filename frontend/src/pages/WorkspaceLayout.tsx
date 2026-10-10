/**
 * Signed-in shell: header, navigation and the routed area.
 *
 * Explicitly not the dashboard — that is a later milestone. This exists to host
 * the protected pages and give the user a sign-out action.
 */

import { useState, type KeyboardEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/authContext';

/**
 * Navigation destinations, grouped.
 *
 * The groups exist because seventeen links in one unwrapped row overflowed a
 * `max-w-5xl` header — roughly 1800px of content in a 976px box, with no
 * `flex-wrap` and no `overflow-x-auto` anywhere, so the row could neither wrap
 * nor scroll. Grouping puts the widest row at roughly half the container.
 *
 * Every destination and label is preserved exactly. The only behavioural change
 * is `end`, noted below.
 */
interface NavItem {
  to: string;
  label: string;
  /**
   * Whether the link matches only its own exact path.
   *
   * `false` is required where a list route has a detail route beneath it. With
   * `end: true`, `/app/inventory/abc` matched no nav item at all, so opening a
   * detail page silently de-highlighted every destination and the user lost
   * their location with no breadcrumb to recover it.
   */
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
      { to: '/app', label: 'Overview', end: true },
      // Sits with Overview rather than Intelligence: it is a business-wide
      // dashboard, not one of the six engines, and the engagement summary reads
      // naturally next to the landing page.
      { to: '/app/analytics', label: 'Analytics', end: true },
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
      // Step 11.9. A renderer of the unified view's decisions, not a new source
      // of analysis. Read-only.
      { to: '/app/recommendations', label: 'Recommendations', end: true },
      // Step 11.10. Executes one reviewed recommendation as a draft purchase
      // order. The only writable screen here.
      { to: '/app/actions', label: 'Actions', end: true },
      { to: '/app/slow-dead', label: 'Slow / Dead Stock', end: true },
      // The specification asked for `/app/suppliers`, but that path is already
      // the supplier CRUD page under Operations. Shadowing it would break an
      // approved screen, so the intelligence view sits beside it under its own
      // path and keeps the specified navigation label.
      { to: '/app/supplier-intelligence', label: 'Supplier Intelligence', end: true },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/app/inventory', label: 'Inventory', end: false },
      { to: '/app/sales', label: 'Sales', end: false },
      { to: '/app/purchase-orders', label: 'Purchase orders', end: false },
      { to: '/app/suppliers', label: 'Suppliers', end: true },
    ],
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    items: [
      { to: '/app/products', label: 'Products', end: false },
      { to: '/app/categories', label: 'Categories', end: false },
    ],
  },
] as const;

/** Stable DOM id for a group's visible label, derived from its unique slug. */
function groupLabelId(groupId: string): string {
  return `workspace-nav-group-${groupId}`;
}

/**
 * DOM id of the single group container the disclosure button controls.
 *
 * There is exactly one such element. The mobile and desktop presentations are the
 * same node with different CSS, never two copies — duplicating it would double
 * every link in the accessibility tree and give screen-reader users two copies of
 * the navigation.
 */
const NAV_GROUPS_ID = 'workspace-nav-groups';

function navClass(isActive: boolean): string {
  return [
    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
    isActive
      ? 'bg-brand-100 text-brand-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  ].join(' ');
}

/**
 * The focus ring used by the sign-out control.
 *
 * Mirrors `focusRing` in `components/ui.tsx`, which is the single source of truth
 * for focus styling across the app. That constant is module-private, so it cannot
 * be imported; the two must be kept in step until it is exported.
 *
 * This replaces the previous `focus:ring-brand-100` outright rather than adding a
 * ring beside it. `brand-100` is a near-white blue on a white header — very close
 * to invisible — and layering both would give the control two competing focus
 * indicators. After this change there is exactly one focus system.
 */
const signOutFocusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';

export function WorkspaceLayout() {
  const { user, logout } = useAuth();
  // Narrow-viewport disclosure state only. At `lg` and above the groups are shown
  // unconditionally by `lg:block`, so this value never governs desktop.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonId = 'workspace-nav-toggle';

  if (!user) return null;

  /** Escape closes the open menu and puts focus back on the button that opened it. */
  function handleNavKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!menuOpen) return;
    if (event.key !== 'Escape') return;

    setMenuOpen(false);
    // Focus is never moved *into* the menu, so the toggle is the natural place to
    // return it to — otherwise a keyboard user is stranded on a collapsed menu.
    document.getElementById(menuButtonId)?.focus();
  }

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
              className={`rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 ${signOutFocusRing}`}
            >
              Sign out
            </button>
          </div>
        </div>

        {/*
         * `aria-label` names the landmark: the layout will grow a breadcrumb
         * trail later, and two unlabelled `navigation` landmarks would be
         * indistinguishable to a screen-reader user.
         *
         * The disclosure is deliberately **not** the `Modal` component. A menu is
         * a complementary region, not a dialog; `Modal` is `aria-modal` with a
         * focus trap, which would trap keyboard users inside the navigation. This
         * is a plain button plus a collapsible region, and it never moves focus
         * into itself.
         */}
        <nav
          aria-label="Workspace"
          className="mx-auto max-w-5xl px-6 pb-3"
          onKeyDown={handleNavKeyDown}
        >
          <button
            type="button"
            id={menuButtonId}
            aria-expanded={menuOpen}
            aria-controls={NAV_GROUPS_ID}
            onClick={() => setMenuOpen((open) => !open)}
            className={`mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 lg:hidden ${signOutFocusRing}`}
          >
            <span aria-hidden="true">{menuOpen ? '▾' : '▸'}</span>
            Menu
          </button>

          {/*
           * One container, one render. `lg:block` is emitted after the base
           * `hidden`/`block` utilities in the cascade, so at `lg` and above the
           * groups are always visible regardless of `menuOpen` — the button
           * cannot hide desktop navigation.
           *
           * `max-h-[60vh] overflow-y-auto` bounds the menu on a short screen so a
           * long list scrolls within the header instead of pushing the page down.
           * It is a scroll container, not a focus trap: Tab still leaves it and
           * reaches the rest of the page.
           */}
          <div
            id={NAV_GROUPS_ID}
            className={`${menuOpen ? 'block' : 'hidden'} lg:block lg:max-h-none lg:overflow-visible max-h-[60vh] overflow-y-auto`}
          >
            {/*
             * Wrapping is deliberate at both levels. `flex-wrap` on the outer list
             * lets groups reflow onto a second row, `flex-wrap` on each group's
             * list stops a single group from overflowing as items are added, and
             * the nested list resets the left alignment so wrapped rows line up
             * under their first item.
             */}
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {NAV_GROUPS.map((group) => {
                const labelId = groupLabelId(group.id);
                return (
                  <li key={group.id} className="min-w-0">
                    <span
                      id={labelId}
                      className="block text-[11px] font-semibold tracking-wide text-slate-400 uppercase"
                    >
                      {group.label}
                    </span>
                    <ul
                      aria-labelledby={labelId}
                      className="mt-1 flex flex-wrap gap-x-1 gap-y-1"
                    >
                      {group.items.map((item) => (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            end={item.end}
                            // Leaving the menu would strand it open over the page
                            // just navigated to, so a selection closes it.
                            onClick={() => setMenuOpen(false)}
                            className={({ isActive }) => navClass(isActive)}
                          >
                            {item.label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
