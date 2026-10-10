/**
 * Breadcrumbs on the three detail screens.
 *
 * ## What this protects
 *
 * Each detail page is reachable only by drilling in from its list, and the only
 * way back was a "Back" button that gives no indication of where it goes. The
 * breadcrumb makes that relationship explicit — but only if it is wired to the
 * *correct* list route. A trail that links "Inventory" to, say, `/app/products`
 * is worse than no trail at all, because it looks authoritative.
 *
 * The primitive itself is unit-tested in `components/ui.test.tsx`. What these
 * tests add is the wiring: that each page passes its own real list route, names
 * the landmark so it is distinguishable from the workspace navigation, and marks
 * the entity being viewed as the current page.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { InventoryDetailPage } from './InventoryDetailPage';
import { PurchaseOrderDetailPage } from './PurchaseOrderDetailPage';
import { SaleDetailPage } from './SaleDetailPage';

/**
 * Mocked at the transport, not at the API clients.
 *
 * Intercepting `../lib/request` lets the real `inventoryApi`, `salesApi` and
 * `purchaseOrderApi` run — so the fixtures are addressed by the same URL the
 * client builds, and the amount formatters still render real output. Mocking the
 * clients instead would mean restating their shape here, and a fixture that
 * drifts from the client would keep passing.
 */
const { mocks, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(message: string, status: number, code: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  return {
    MockApiError,
    mocks: { request: vi.fn(), requestList: vi.fn(), requestWithMeta: vi.fn() },
  };
});

vi.mock('../lib/request', () => ({
  ApiError: MockApiError,
  request: mocks.request,
  requestList: mocks.requestList,
  requestWithMeta: mocks.requestWithMeta,
}));

const EMPTY_META = { total: 0, page: 1, limit: 20, totalPages: 1 };

const INVENTORY_DETAIL = {
  product: {
    id: 'product-1',
    sku: 'A-1',
    name: 'Cable',
    description: null,
    unit: 'unit',
    costPrice: 3,
    sellingPrice: 5,
    isActive: true,
    categoryId: null,
    categoryName: null,
  },
  currentStock: 5,
  movementCount: 0,
  lastMovementAt: null,
  totals: { in: 6, out: 1, adjustment: 0 },
};

const SALE_DETAIL = {
  id: 'sale-1',
  customerName: 'Ada Buyer',
  customerPhone: null,
  totalAmount: '25.00',
  status: 'completed',
  soldAt: '2024-01-02T10:00:00.000Z',
  createdBy: { id: 'u1', name: 'Ada Owner' },
  itemCount: 1,
  items: [],
};

const WALK_IN_SALE = { ...SALE_DETAIL, id: 'sale-2', customerName: null };

const ORDER_DETAIL = {
  id: 'order-1',
  supplierId: 'supplier-1',
  supplierName: 'Northwind Traders',
  status: 'draft',
  totalAmount: '100.00',
  orderedAt: null,
  expectedAt: null,
  receivedAt: null,
  notes: null,
  createdBy: { id: 'u1', name: 'Ada Owner' },
  itemCount: 1,
  createdAt: '2024-01-03T10:00:00.000Z',
  items: [],
};

/**
 * Render a page at its real production route.
 *
 * The nesting matters: the pages read their id from `useParams`, so a flat route
 * like `/app/inventory/product-1` would match the literal URL while leaving
 * `productId` undefined — the page would sit on its spinner forever and the test
 * would pass for the wrong reason. `App.tsx` nests these under `/app`, so this
 * harness does too.
 */
function renderAt(childPath: string, element: ReactNode, concretePath?: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/${concretePath ?? childPath}`]}>
      <Routes>
        <Route path="/app">
          <Route path={childPath} element={element} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const breadcrumbNav = () => screen.getByRole('navigation', { name: 'Breadcrumb' });

beforeEach(() => {
  vi.clearAllMocks();

  // Route by the path the real client builds, so a fixture can never silently
  // answer the wrong screen.
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/inventory/')) return INVENTORY_DETAIL;
    if (path.startsWith('/api/sales/')) {
      return path.endsWith('/sale-2') ? WALK_IN_SALE : SALE_DETAIL;
    }
    if (path.startsWith('/api/purchase-orders/')) return ORDER_DETAIL;
    throw new Error(`unexpected request: ${path}`);
  });

  // The inventory ledger loads alongside the record; it is not what these tests
  // are about, but an unresolved promise would hang the render.
  mocks.requestList.mockResolvedValue({ items: [], meta: EMPTY_META });
  mocks.requestWithMeta.mockResolvedValue({ data: null, meta: EMPTY_META });
});

describe('Inventory detail breadcrumb', () => {
  it('links "Inventory" to the inventory list', async () => {
    renderAt('inventory/:productId', <InventoryDetailPage />, 'inventory/product-1');
    expect(await screen.findByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'href',
      '/app/inventory',
    );
  });

  it('marks the product as the current page', async () => {
    renderAt('inventory/:productId', <InventoryDetailPage />, 'inventory/product-1');
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    const current = breadcrumbNav().querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent('Cable');
    expect(screen.queryByRole('link', { name: 'Cable' })).not.toBeInTheDocument();
  });
});

describe('Sale detail breadcrumb', () => {
  it('links "Sales" to the sales list', async () => {
    renderAt('sales/:saleId', <SaleDetailPage />, 'sales/sale-1');
    expect(await screen.findByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Sales' })).toHaveAttribute('href', '/app/sales');
  });

  it('marks the customer as the current page', async () => {
    renderAt('sales/:saleId', <SaleDetailPage />, 'sales/sale-1');
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    const current = breadcrumbNav().querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent('Ada Buyer');
  });

  it('falls back to a generic current-page label for a walk-in sale', async () => {
    renderAt('sales/:saleId', <SaleDetailPage />, 'sales/sale-2');
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    // The trail must match the heading, which uses the same fallback.
    const current = breadcrumbNav().querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent('Walk-in customer');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Walk-in customer');
  });
});

describe('Purchase order detail breadcrumb', () => {
  it('links "Purchase orders" to the purchase order list', async () => {
    renderAt(
      'purchase-orders/:orderId',
      <PurchaseOrderDetailPage />,
      'purchase-orders/order-1',
    );
    expect(await screen.findByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Purchase orders' })).toHaveAttribute(
      'href',
      '/app/purchase-orders',
    );
  });

  it('marks the supplier as the current page', async () => {
    renderAt(
      'purchase-orders/:orderId',
      <PurchaseOrderDetailPage />,
      'purchase-orders/order-1',
    );
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    const current = breadcrumbNav().querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent('Northwind Traders');
  });
});

describe('Breadcrumbs alongside the existing shell', () => {
  it('navigates to the list when the ancestor link is activated', async () => {
    const user = userEvent.setup();

    // Both routes are present so the click is resolved by the router itself,
    // which is what proves the link points somewhere real.
    render(
      <MemoryRouter initialEntries={['/app/inventory/product-1']}>
        <Routes>
          <Route path="/app">
            <Route path="inventory/:productId" element={<InventoryDetailPage />} />
            <Route path="inventory" element={<p>inventory list</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('navigation', { name: 'Breadcrumb' });
    await user.click(screen.getByRole('link', { name: 'Inventory' }));

    expect(screen.getByText('inventory list')).toBeInTheDocument();
  });

  it('keeps exactly one navigation landmark per detail page', async () => {
    renderAt('inventory/:productId', <InventoryDetailPage />, 'inventory/product-1');
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    // The shell's own nav is absent here because the layout is not rendered, so
    // the count of 1 confirms the breadcrumb introduces no extra landmarks.
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('does not turn the trail into a second heading', async () => {
    renderAt('inventory/:productId', <InventoryDetailPage />, 'inventory/product-1');
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    // The page must keep exactly one h1 — the entity being viewed.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cable');
  });

  it('preserves the existing Back control on the detail page', async () => {
    renderAt('sales/:saleId', <SaleDetailPage />, 'sales/sale-1');
    await screen.findByRole('navigation', { name: 'Breadcrumb' });

    // Breadcrumbs are additive; the approved Back button must survive.
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.closest('a')).toHaveAttribute('href', '/app/sales');
  });
});