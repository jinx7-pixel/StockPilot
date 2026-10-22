/**
 * Purchase order detail — the place a draft becomes a real order, and where goods
 * are received.
 *
 * Receiving is the only action here that moves stock, and the server does it by
 * appending immutable `in` movements. Quantities entered are **increments**:
 * receiving 20 against 100 ordered with 40 already received leaves 60 received.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  Breadcrumbs,
  Card,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Spinner,
  Textarea,
} from '../components/ui';
import { ApiError } from '../lib/request';
import {
  formatAmount,
  formatQuantity,
  purchaseOrderApi,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '../lib/purchasing';

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'border border-slate-700 bg-slate-800 text-slate-200',
  ordered: 'border border-sky-400/20 bg-sky-400/[0.08] text-sky-200',
  partially_received: 'border border-amber-400/20 bg-amber-400/[0.08] text-amber-200',
  received: 'border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200',
  cancelled: 'border border-rose-400/20 bg-rose-400/[0.08] text-rose-200',
};

const darkSecondaryLinkClass = 'inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';

export function PurchaseOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [editingDraft, setEditingDraft] = useState(false);
  const [draftExpectedAt, setDraftExpectedAt] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const [receiving, setReceiving] = useState(false);
  /** Per-item newly-received quantity, keyed by product id. */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    purchaseOrderApi
      .detail(orderId)
      .then((value) => {
        if (cancelled) return;
        setOrder(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load this order.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, reloadToken]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  async function handlePlace() {
    if (!order || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await purchaseOrderApi.place(order.id);
      setNotice('Order placed with the supplier. Stock is unchanged until goods arrive.');
      refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not place the order.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!order || busy) return;
    if (!window.confirm('Cancel this purchase order? This cannot be undone.')) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await purchaseOrderApi.update(order.id, { status: 'cancelled' });
      setNotice('Purchase order cancelled.');
      refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not cancel the order.');
    } finally {
      setBusy(false);
    }
  }

  function openReceive() {
    const initial: Record<string, string> = {};
    for (const item of order?.items ?? []) initial[item.productId] = '';
    setAmounts(initial);
    setReceiveError(null);
    setReceiving(true);
  }

  async function handleReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || busy) return;

    const items = Object.entries(amounts)
      .filter(([, value]) => value.trim() !== '' && Number(value) > 0)
      .map(([productId, value]) => ({ productId, quantity: value.trim() }));

    if (items.length === 0) {
      setReceiveError('Enter a quantity for at least one item.');
      return;
    }

    setBusy(true);
    setReceiveError(null);

    try {
      await purchaseOrderApi.receive(order.id, items);
      setReceiving(false);
      setNotice('Goods received. Stock has been increased by the ledger.');
      refresh();
    } catch (cause) {
      setReceiveError(
        cause instanceof ApiError ? cause.message : 'Could not record the receipt.',
      );
    } finally {
      setBusy(false);
    }
  }

  function openDraftEdit() {
    setDraftExpectedAt(order?.expectedAt?.slice(0, 10) ?? '');
    setDraftNotes(order?.notes ?? '');
    setDraftError(null);
    setEditingDraft(true);
  }

  async function handleSaveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || order.status !== 'draft' || busy) return;

    setBusy(true);
    setDraftError(null);
    try {
      await purchaseOrderApi.update(order.id, {
        expectedAt: draftExpectedAt ? new Date(draftExpectedAt).toISOString() : null,
        notes: draftNotes.trim() || null,
      });
      setEditingDraft(false);
      setNotice('Draft details saved.');
      refresh();
    } catch (cause) {
      setDraftError(
        cause instanceof ApiError ? cause.message : 'Could not save the draft details.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner darkSurface label="Loading purchase order…" />;

  if (error && !order) {
    return (
      <div className="space-y-6">
        <ErrorBanner darkSurface message={error} />
        <Link className={darkSecondaryLinkClass} to="/app/purchase-orders">
          Back to purchase orders
        </Link>
      </div>
    );
  }

  if (!order) return null;

  const canPlace = order.status === 'draft';
  const canCancel = order.status === 'draft' || order.status === 'ordered';
  const canReceive = order.status === 'ordered' || order.status === 'partially_received';
  const isTerminal = order.status === 'received' || order.status === 'cancelled';

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            darkSurface
            items={[
              { label: 'Purchase orders', to: '/app/purchase-orders' },
              { label: order.supplierName },
            ]}
          />
        }
        title={order.supplierName}
        description={`Raised ${new Date(order.createdAt).toLocaleString()}`}
        darkSurface
        actions={
          <Link className={darkSecondaryLinkClass} to="/app/purchase-orders">
            Back
          </Link>
        }
      />

      {error ? <ErrorBanner darkSurface message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Total</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {formatAmount(order.totalAmount)}
          </p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Items</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{order.itemCount}</p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Status</p>
          <p
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-sm font-medium capitalize ${
              STATUS_STYLE[order.status]
            }`}
          >
            {order.status.replace(/_/g, ' ')}
          </p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Raised by</p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-100">
            {order.createdBy.name}
          </p>
        </Card>
      </div>

      <Card darkSurface className="flex flex-wrap items-center gap-3 p-4">
        {canPlace ? (
          <SecondaryButton darkSurface onClick={openDraftEdit} disabled={busy}>
            Edit draft details
          </SecondaryButton>
        ) : null}

        {canPlace ? (
          <PrimaryButton darkSurface onClick={() => void handlePlace()} disabled={busy}>
            Place order
          </PrimaryButton>
        ) : null}

        {canReceive ? (
          <PrimaryButton darkSurface onClick={openReceive} disabled={busy}>
            Receive goods
          </PrimaryButton>
        ) : null}

        {canCancel ? (
          <SecondaryButton darkSurface onClick={() => void handleCancel()} disabled={busy}>
            Cancel order
          </SecondaryButton>
        ) : null}

        {isTerminal ? (
          <p className="text-sm text-slate-400">
            {order.status === 'received'
              ? 'Fully received. This order is complete and cannot be changed.'
              : 'Cancelled. This order is closed and cannot receive goods.'}
          </p>
        ) : null}

        <p className="ml-auto text-xs text-slate-400">
          {order.orderedAt ? `Ordered ${new Date(order.orderedAt).toLocaleString()}` : 'Not yet placed'}
          {order.expectedAt
            ? ` · expected ${new Date(order.expectedAt).toLocaleDateString()}`
            : ''}
          {order.receivedAt
            ? ` · received ${new Date(order.receivedAt).toLocaleString()}`
            : ''}
        </p>
      </Card>

      <Card darkSurface>
        <header className="border-b border-slate-800 px-6 py-4">
          <h2 className="font-semibold text-slate-100">Items</h2>
          <p className="text-sm text-slate-400">
            Received and remaining quantities are computed by the server, never entered by hand.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs tracking-wide text-slate-400 uppercase">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">Product</th>
                <th scope="col" className="px-6 py-3 font-medium">SKU</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Ordered</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Received</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Remaining</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Unit cost</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Line total</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {(order.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4">
                    <Link
                      to={`/app/inventory/${item.productId}`}
                      className="font-medium text-emerald-300 hover:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      {item.productName}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-300">{item.sku}</td>
                  <td className="px-6 py-4 text-right text-slate-300">
                    {formatQuantity(item.quantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-100">
                    {formatQuantity(item.receivedQuantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-300">
                    {formatQuantity(item.remainingQuantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-300">
                    {formatAmount(item.unitCost)}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-100">
                    {formatAmount(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot className="border-t border-slate-800 bg-[#0b1220]">
              <tr>
                <td colSpan={6} className="px-6 py-3 text-right text-sm font-medium text-slate-300">
                  Total
                </td>
                <td className="px-6 py-3 text-right text-base font-bold text-slate-100">
                  {formatAmount(order.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {order.notes ? (
        <Card darkSurface className="p-4">
          <h2 className="text-sm font-semibold text-slate-100">Notes</h2>
          <p className="mt-1 text-sm text-slate-300">{order.notes}</p>
        </Card>
      ) : null}

      {receiving ? (
        <Modal
          title="Receive goods"
          darkSurface
          onClose={() => setReceiving(false)}
          footer={
            <>
              <SecondaryButton darkSurface onClick={() => setReceiving(false)} disabled={busy}>
                Cancel
              </SecondaryButton>
              <PrimaryButton darkSurface type="submit" form="receive-form" disabled={busy}>
                {busy ? 'Recording…' : 'Record receipt'}
              </PrimaryButton>
            </>
          }
        >
          <form id="receive-form" onSubmit={handleReceive} className="space-y-4">
            <ErrorBanner darkSurface message={receiveError} />

            <p className="rounded-lg border border-sky-400/20 bg-sky-400/[0.07] px-3 py-2 text-sm text-sky-200">
              Enter the quantity arriving <em>now</em>. Stock increases by exactly this
              amount, as immutable inventory movements.
            </p>

            {(order.items ?? [])
              .filter((item) => Number(item.remainingQuantity) > 0)
              .map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <Field
                    label={`${item.productName} — ${formatQuantity(item.remainingQuantity)} ${item.unit} outstanding`}
                    type="number"
                    min={0.01}
                    max={Number(item.remainingQuantity)}
                    step="0.01"
                    required={false}
                    value={amounts[item.productId] ?? ''}
                    onChange={(value) =>
                      setAmounts((current) => ({ ...current, [item.productId]: value }))
                    }
                    placeholder="0"
                    darkSurface
                  />
                </div>
              ))}

            {(order.items ?? []).every((item) => Number(item.remainingQuantity) <= 0) ? (
              <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-sm text-amber-200">
                Everything on this order has already been received.
              </p>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {editingDraft ? (
        <Modal
          title="Edit draft details"
          darkSurface
          onClose={() => setEditingDraft(false)}
          footer={
            <>
              <SecondaryButton darkSurface onClick={() => setEditingDraft(false)} disabled={busy}>
                Cancel
              </SecondaryButton>
              <PrimaryButton darkSurface type="submit" form="edit-draft-po-form" disabled={busy}>
                {busy ? 'Saving…' : 'Save draft'}
              </PrimaryButton>
            </>
          }
        >
          <form id="edit-draft-po-form" onSubmit={handleSaveDraft} className="space-y-4">
            <ErrorBanner darkSurface message={draftError} />
            <Field
              label="Expected delivery"
              type="date"
              value={draftExpectedAt}
              onChange={setDraftExpectedAt}
              required={false}
              darkSurface
            />
            <Textarea
              label="Notes"
              value={draftNotes}
              onChange={setDraftNotes}
              required={false}
              maxLength={2000}
              rows={3}
              placeholder="Optional note for your records"
              darkSurface
            />
            <p className="text-xs text-slate-400">
              Order items and unit costs stay as originally recorded. Cancel and raise a new order to change them.
            </p>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
