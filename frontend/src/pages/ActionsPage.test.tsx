/**
 * Action Center confirmation dialog.
 *
 * ## What this protects
 *
 * The dialog holds its idempotency key in component state, so unmounting discards
 * it. If it could be dismissed while the create request was still in flight and
 * the user then reopened and submitted again, the retry would carry a *fresh* key
 * - and because idempotency only deduplicates on a matching key, the second
 * submit would create a second draft purchase order even though the first had
 * already succeeded server-side.
 *
 * The fix routes Escape, the backdrop and Cancel through one guarded handler and
 * freezes the inputs while pending, so the key cannot be regenerated underneath an
 * in-flight request. These tests pin that behaviour.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { ActionsPage } from './ActionsPage';

/**
 * Mocked dependencies.
 *
 * Everything the `vi.mock` factories close over must live inside `vi.hoisted`,
 * because those factories are lifted above the module's own imports.
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
    mocks: { execute: vi.fn(), list: vi.fn() },
  };
});

vi.mock('../lib/actions', () => ({
  actionsApi: {
    list: mocks.list,
    execute: mocks.execute,
    isStale: (cause: unknown) =>
      cause instanceof MockApiError && cause.code === 'RECOMMENDATION_STALE',
  },
}));

/**
 * `ActionsPage` narrows errors with the `ApiError` class from the transport
 * module, not the one re-exported by `lib/actions`. Both mocks therefore have to
 * yield the *same* class object, or `instanceof` silently fails and every failure
 * collapses to the generic message.
 */
vi.mock('../lib/request', () => ({ ApiError: MockApiError }));

vi.mock('../lib/recommendations', () => ({
  recommendationsApi: {
    list: vi.fn(async () => ({
      items: [
        {
          product: { id: 'product-1', sku: 'A-1', name: 'Cable', category: null },
          recommendations: [
            {
              id: 'product-1:REPLENISH',
              productId: 'product-1',
              type: 'REPLENISH',
              priority: 'HIGH',
              confidence: 'HIGH',
              title: 'Replenish cable',
              reason: 'Stock is below the reorder point.',
              evidence: [],
              limitations: [],
              sourceDecisions: ['REORDER'],
              recommendedQuantity: '100',
            },
          ],
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      recommendationCount: 1,
    })),
    forProduct: vi.fn(),
  },
}));

vi.mock('../lib/purchasing', () => ({
  supplierApi: {
    list: vi.fn(async () => ({
      items: [{ id: 'supplier-1', name: 'Cable Co', isActive: true }],
      meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
    })),
  },
  purchaseOrderApi: {},
}));

/** A signed-in owner, so the page renders without a login round-trip. */
vi.mock('../auth/authContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', businessId: 'b1', name: 'Owner', email: 'o@example.com', role: 'owner' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

/** A promise whose settlement the test controls. */
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ORDER_RESULT = {
  action: {
    id: 'action-1',
    status: 'COMPLETED',
    actionType: 'CREATE_DRAFT_PURCHASE_ORDER',
    productId: 'product-1',
    supplierId: 'supplier-1',
    quantity: '100',
    recommendedQuantity: '100',
    purchaseOrderId: 'po-1',
    idempotencyKey: null,
    sourceRecommendationType: 'REPLENISH',
    sourceRecommendationId: 'product-1:REPLENISH',
    sourceRecommendationContext: {},
    failureReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:00.000Z',
  },
  purchaseOrder: { id: 'po-1', status: 'draft' },
};

beforeEach(() => {
  mocks.list.mockResolvedValue({
    items: [],
    pagination: { page: 1, limit: 25, total: 0, totalPages: 1 },
  });
});

afterEach(() => {
  mocks.execute.mockReset();
  mocks.list.mockReset();
});

/** Render the page and open the confirmation dialog. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  render(<ActionsPage />);
  await user.click(await screen.findByRole('button', { name: 'Create draft order' }));
  return screen.findByRole('dialog', { name: 'Create draft purchase order' });
}

/**
 * The dialog's submit control.
 *
 * Matched structurally on `type="submit"` rather than by label, because the label
 * changes to the pending state once clicked.
 */
function submitControl(): HTMLElement {
  const dialog = screen.getByRole('dialog', { name: 'Create draft purchase order' });
  const button = within(dialog).getByRole('button', { name: /Create draft order|Creating/ });
  expect(button).toHaveAttribute('type', 'submit');
  return button;
}

/**
 * The real `Modal` backdrop — the overlay a user clicks to dismiss by clicking
 * outside the panel.
 *
 * It carries `aria-hidden`, so no role-based query can reach it, and it is the
 * dialog's previous sibling inside the fixed positioning wrapper. Reaching it this
 * way is deliberate: the backdrop is a genuine dismissal route into
 * `handleDismiss`, exactly like Escape and Cancel, so it needs its own coverage
 * rather than being assumed to follow.
 */
function modalBackdrop(): HTMLElement {
  const wrapper = screen.getByRole('dialog', { name: 'Create draft purchase order' }).parentElement;
  expect(wrapper).not.toBeNull();
  const backdrop = wrapper!.firstElementChild as HTMLElement;
  expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  return backdrop;
}

describe('Action Center - the dialog cannot be dismissed mid-request', () => {
  it('closes on a backdrop click when idle, proving the click path is live', async () => {
    // A control for the regression test below. Without it, "the dialog stayed
    // open" could be satisfied by a backdrop click that never reached the handler
    // at all, and the test would prove nothing.
    const user = userEvent.setup();

    await openDialog(user);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(modalBackdrop());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('ignores a backdrop click while the request is in flight', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    mocks.execute.mockReturnValue(gate.promise);

    await openDialog(user);
    await user.click(submitControl());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));

    // Clicking the overlay is the third dismissal route, alongside Escape and
    // Cancel, and it must be blocked by the same guard. Otherwise the dialog
    // unmounts, discards the in-flight idempotency key, and a retry would create
    // a second draft order.
    await user.click(modalBackdrop());

    expect(screen.getByRole('dialog', { name: 'Create draft purchase order' })).toBeInTheDocument();

    // Hammering it must not produce a second request either.
    await user.dblClick(modalBackdrop());
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.execute.mock.calls.map((call) => call[1])).size).toBe(1);

    gate.resolve(ORDER_RESULT);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ignores Escape while the request is in flight', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    mocks.execute.mockReturnValue(gate.promise);

    await openDialog(user);
    await user.click(submitControl());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));

    await user.keyboard('{Escape}');

    // Still open. Dismissing here would discard the in-flight idempotency key.
    expect(screen.getByRole('dialog', { name: 'Create draft purchase order' })).toBeInTheDocument();

    gate.resolve(ORDER_RESULT);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ignores Cancel while the request is in flight', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    mocks.execute.mockReturnValue(gate.promise);

    await openDialog(user);
    await user.click(submitControl());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('dialog', { name: 'Create draft purchase order' })).toBeInTheDocument();

    gate.resolve(ORDER_RESULT);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('freezes quantity and supplier while pending so no new key can be minted', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    mocks.execute.mockReturnValue(gate.promise);

    await openDialog(user);
    await user.click(submitControl());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));

    // Both change handlers regenerate the idempotency key, so both controls must be
    // unreachable while the original request may still complete.
    expect(screen.getByLabelText('Quantity')).toBeDisabled();
    expect(screen.getByLabelText('Supplier')).toBeDisabled();

    const keySent = mocks.execute.mock.calls[0]![1] as string;
    expect(typeof keySent).toBe('string');
    expect(keySent.length).toBeGreaterThan(0);

    gate.resolve(ORDER_RESULT);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('submits exactly once, with one key, however hard it is clicked', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    mocks.execute.mockReturnValue(gate.promise);

    await openDialog(user);
    await user.click(submitControl());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));

    // The busy label replaces the idle one, so the control is identifiable by its
    // pending state without hard-coding the ellipsis character.
    const busy = within(screen.getByRole('dialog')).getByRole('button', { name: /Creating/ });
    expect(busy).toBeDisabled();

    await user.click(busy);
    await user.dblClick(busy);

    // One call, one key, so a retry could not become a second order.
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const keys = new Set(mocks.execute.mock.calls.map((call) => call[1]));
    expect(keys.size).toBe(1);

    gate.resolve(ORDER_RESULT);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog dismissible once the request settles', async () => {
    const user = userEvent.setup();
    mocks.execute.mockResolvedValue(ORDER_RESULT);

    await openDialog(user);
    await user.click(submitControl());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('allows dismissal after a failure, since nothing was created', async () => {
    const user = userEvent.setup();
    mocks.execute.mockRejectedValue(new Error('Network down'));

    await openDialog(user);
    await user.click(submitControl());
    await screen.findByRole('alert');

    // The dialog is still open and Cancel works, because no order exists.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('surfaces a stale recommendation without closing', async () => {
    const user = userEvent.setup();
    mocks.execute.mockRejectedValue(
      new MockApiError(
        'This recommendation is no longer current.',
        409,
        'RECOMMENDATION_STALE',
      ),
    );

    await openDialog(user);
    await user.click(submitControl());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no longer current/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});