/**
 * Workspace navigation tests.
 *
 * ## What these protect
 *
 * The navigation is the only way a user reaches every other screen, and it had
 * two verified defects: seventeen unwrapped links that overflowed the header,
 * and `end: true` on list routes that made every destination go inactive the
 * moment a detail page opened.
 *
 * ## Why they assert behaviour
 *
 * These render a real `MemoryRouter` and a real `Routes` tree, so "active" is
 * decided by React Router's own matcher rather than by a class name we chose.
 * A test that asserted `className` would pass even if the highlight were applied
 * to the wrong element, and would fail for the right code the moment a colour
 * changed.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceLayout } from './WorkspaceLayout';

vi.mock('../auth/authContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      businessId: 'b1',
      name: 'Ada Owner',
      email: 'ada@example.com',
      role: 'owner',
      business: { id: 'b1', name: 'Acme Supplies' },
    },
    status: 'authenticated',
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

/**
 * Render the layout at `path`, with an outlet stub.
 *
 * Both an `index` route and a splat are needed: in React Router v7 a nested
 * `path="*"` does **not** match the parent's own path, so without the index
 * route the `<Outlet />` renders empty at `/app`. With both present, the outlet
 * resolves the location exactly as it does in production, which is what makes
 * the active-state assertions meaningful rather than self-fulfilling.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={<WorkspaceLayout />}>
          <Route index element={<p>page body</p>} />
          <Route path="*" element={<p>page body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Workspace' });

describe('Workspace navigation — structure', () => {
  it('exposes a single, named navigation landmark', () => {
    renderAt('/app');
    expect(nav()).toBeInTheDocument();
    // A second unlabelled landmark would make this ambiguous for screen readers.
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('groups the destinations under four labelled sections, in order', () => {
    renderAt('/app');

    // Select the group labels by their id, not by text: "Overview" and
    // "Intelligence" are also link labels, so a text query would match twice.
    const labels = Array.from(
      nav().querySelectorAll<HTMLElement>('span[id^="workspace-nav-group-"]'),
    ).map((node) => node.textContent);

    expect(labels).toEqual(['Overview', 'Intelligence', 'Operations', 'Catalogue']);
  });

  it('gives each group list an accessible name that resolves to its visible label', () => {
    renderAt('/app');

    // A visible label is not automatically an accessible name for the list; the
    // relationship has to be wired up.
    const lists = within(nav()).getAllByRole('list');
    const groupLists = lists.filter((list) => list.getAttribute('aria-labelledby'));

    expect(groupLists).toHaveLength(4);
    for (const list of groupLists) {
      const id = list.getAttribute('aria-labelledby')!;
      const label = document.getElementById(id);
      expect(label).not.toBeNull();
      expect(label!.tagName.toLowerCase()).toBe('span');
      expect(label!.textContent!.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps every destination unique', () => {
    renderAt('/app');

    const hrefs = within(nav())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    expect(hrefs).toHaveLength(17);
    expect(new Set(hrefs).size).toBe(17);
  });

  it('preserves every pre-existing destination and label', () => {
    renderAt('/app');

    const pairs = within(nav())
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);

    // The exact set that existed before grouping, so a regroup cannot quietly
    // drop or rename a destination.
    expect(pairs).toEqual(
      expect.arrayContaining([
        ['Overview', '/app'],
        ['Analytics', '/app/analytics'],
        ['Stock risk', '/app/stock-risk'],
        ['Demand', '/app/demand'],
        ['Reorder', '/app/reorder'],
        ['Overstock', '/app/overstock'],
        ['Intelligence', '/app/intelligence'],
        ['Recommendations', '/app/recommendations'],
        ['Actions', '/app/actions'],
        ['Slow / Dead Stock', '/app/slow-dead'],
        ['Supplier Intelligence', '/app/supplier-intelligence'],
        ['Inventory', '/app/inventory'],
        ['Sales', '/app/sales'],
        ['Purchase orders', '/app/purchase-orders'],
        ['Suppliers', '/app/suppliers'],
        ['Products', '/app/products'],
        ['Categories', '/app/categories'],
      ]),
    );
    expect(pairs).toHaveLength(17);
  });

  it('places each destination inside its intended group', () => {
    renderAt('/app');

    const groupOf = (label: string) => {
      const link = within(nav()).getByRole('link', { name: label });
      // The group list is the nearest ancestor <ul> carrying an aria-labelledby.
      const list = link.closest('ul[aria-labelledby]')!;
      return document.getElementById(list.getAttribute('aria-labelledby')!)!.textContent;
    };

    expect(groupOf('Overview')).toBe('Overview');
    expect(groupOf('Analytics')).toBe('Overview');
    expect(groupOf('Stock risk')).toBe('Intelligence');
    expect(groupOf('Actions')).toBe('Intelligence');
    expect(groupOf('Inventory')).toBe('Operations');
    expect(groupOf('Suppliers')).toBe('Operations');
    expect(groupOf('Products')).toBe('Catalogue');
    expect(groupOf('Categories')).toBe('Catalogue');
  });

  it('lets each group wrap instead of forcing horizontal overflow', () => {
    renderAt('/app');

    const lists = within(nav()).getAllByRole('list');

    // Every list level must be allowed to wrap. Without it the seventeen links
    // overflowed the header, which is the defect this milestone fixes.
    for (const list of lists) {
      expect(list.className).toContain('flex-wrap');
    }
  });
});

describe('Workspace navigation — active destination', () => {
  const cases: Array<[string, string]> = [
    ['/app', 'Overview'],
    ['/app/actions', 'Actions'],
    ['/app/products', 'Products'],
    ['/app/supplier-intelligence', 'Supplier Intelligence'],
  ];

  for (const [path, label] of cases) {
    it(`marks ${label} current at ${path}`, () => {
      renderAt(path);
      // NavLink sets aria-current when the router matches, so this is the real
      // matcher result rather than a class we hand-checked.
      expect(within(nav()).getByRole('link', { name: label })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }

  it('marks exactly one destination current at a time', () => {
    renderAt('/app/reorder');

    const current = within(nav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Reorder');
  });

  // The regression: with `end: true` on a list route, opening a detail page
  // matched no destination at all and every highlight silently disappeared.
  it.each([
    ['/app/inventory/product-1', 'Inventory'],
    ['/app/sales/sale-1', 'Sales'],
    ['/app/purchase-orders/order-1', 'Purchase orders'],
  ])('keeps %s highlighted by its parent link', (path, label) => {
    renderAt(path);

    const current = within(nav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it('does not highlight a parent whose prefix merely matches a sibling', () => {
    // `/app/sales` must not light up when `/app/suppliers` is open, even though
    // both sit under Operations.
    renderAt('/app/suppliers');

    const current = within(nav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Suppliers');
  });
});

describe('Workspace navigation — shell', () => {
  it('renders the signed-in business and offers sign out', () => {
    renderAt('/app');

    expect(screen.getByText('Acme Supplies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('keeps the accessible focus ring on sign out', () => {
    renderAt('/app');

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    const classes = signOut.className;

    // Guards the Step 13.3.1 fix from being undone by a later restyle, and guards
    // the near-invisible `ring-brand-100` from creeping back.
    expect(classes).toContain('focus-visible:ring-brand-500');
    expect(classes).not.toContain('ring-brand-100');
  });

  it('keeps the header navigation and the routed body as separate landmarks', () => {
    renderAt('/app');

    expect(nav()).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });
});

/**
 * The narrow-viewport disclosure.
 *
 * These assert behaviour — state, focus, and DOM identity — rather than class
 * names, because the collapsed presentation is pure CSS and jsdom has no layout
 * box. What can be proven here is that the links exist exactly once, that the
 * toggle owns them, and that keyboard use behaves; the responsive breakpoint
 * itself needs a real browser.
 */
describe('Workspace navigation — mobile disclosure', () => {
  const toggle = () => screen.getByRole('button', { name: /Menu/ });

  it('starts collapsed', () => {
    renderAt('/app');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('is a native button, so Enter and Space both operate it', () => {
    renderAt('/app');
    // A <div> would silently drop Space; only a real button gets both for free.
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle()).toHaveAttribute('type', 'button');
  });

  it('points aria-controls at the single group container that holds the links', () => {
    renderAt('/app');

    const controls = toggle().getAttribute('aria-controls');
    expect(controls).toBeTruthy();

    const container = document.getElementById(controls!);
    expect(container).not.toBeNull();
    // The relationship is real, not decorative: the controlled element must
    // actually contain the navigation.
    expect(container!.querySelectorAll('a').length).toBe(17);
  });

  it('renders the links exactly once, collapsed or not', async () => {
    const user = userEvent.setup();
    renderAt('/app');

    // One set of links in the DOM. A mobile/desktop fork would double this.
    expect(screen.getAllByRole('link')).toHaveLength(17);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);

    await user.click(toggle());

    // Still one set after opening.
    expect(screen.getAllByRole('link')).toHaveLength(17);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('opens with a click and reports the change through aria-expanded', async () => {
    const user = userEvent.setup();
    renderAt('/app');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens with the keyboard', async () => {
    const user = userEvent.setup();
    renderAt('/app');

    toggle().focus();
    expect(toggle()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderAt('/app');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    // Tab *into* the menu first. This is the only sequence where restoring focus
    // is observable: had focus never left the toggle, the assertion below would
    // pass whether or not the component restored it, and the test would prove
    // nothing. A keyboard user reaches Escape from inside the menu, and if focus
    // is not moved back the user is left focused on a hidden element.
    await user.tab();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveFocus();

    await user.keyboard('{Escape}')

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    // Without this the keyboard user is stranded on a collapsed menu.
    expect(toggle()).toHaveFocus()
  });

  it('ignores Escape while already closed', async () => {
    const user = userEvent.setup();
    renderAt('/app');

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    // No crash, and it has not been opened behind the user's back.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes after a link is chosen, and keeps the active route correct', async () => {
    const user = userEvent.setup();
    renderAt('/app/reorder');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('link', { name: 'Overstock' }));

    // Leaving the menu open would cover the page just navigated to.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    // Active state is decided by the router, so it must follow the navigation
    // even though the menu is collapsed.
    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Overstock');
  });

  it('does not move focus into the menu when it opens', async () => {
    const user = userEvent.setup();
    renderAt('/app');

    await user.click(toggle());

    // No focus trap: the toggle keeps focus so a keyboard user can Tab onward or
    // press Escape without hunting for where they are.
    expect(toggle()).toHaveFocus();
  });

  it('bounds the menu height without hiding the desktop presentation', () => {
    renderAt('/app');

    const container = document.getElementById(toggle().getAttribute('aria-controls')!);
    const classes = container!.className;

    // Scrollable and bounded on a short screen...
    expect(classes).toContain('overflow-y-auto');
    expect(classes).toContain('max-h-[60vh]');
    // ...but lifted at desktop so the grouped nav behaves exactly as in 13.3.3.
    expect(classes).toContain('lg:block');
    expect(classes).toContain('lg:max-h-none');
    expect(classes).toContain('lg:overflow-visible');
  });

  it('hides the toggle at desktop and keeps the named landmark either way', () => {
    renderAt('/app');

    // The button must never appear beside the permanently visible desktop nav.
    expect(toggle().className).toContain('lg:hidden');
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument();
  });
});