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
  Card,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Spinner,
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
  draft: 'bg-slate-200 text-slate-700',
  ordered: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export function PurchaseOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [receiving, setReceiving] = useState(false);
  /** Per-item newly-received quantity, keyed by product id. */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    purchaseOrderApi
      .detail(orderId)
      .then(({ data }) => {
        if (cancelled) return;
        setOrder(data);
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
  }, [orderId, notice]);

  const refresh = useCallback(() => {
    setLoading(true);
    setNotice((current) => (current === 'reload' ? null : current));
    setNotice('reload');
  }, []);

  async function handlePlace() {
    if (!order) return;
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
    if (!order) return;
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
    if (!order) return;

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

  if (loading) return <Spinner label="Loading purchase order…" />;

  if (error && !order) {
    return (
      <div className="space-y-6">
        <ErrorBanner message={error} />
        <Link to="/app/purchase-orders">
          <SecondaryButton>Back to purchase orders</SecondaryButton>
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
        title={order.supplierName}
        description={`Raised ${new Date(order.createdAt).toLocaleString()}`}
        actions={
          <Link to="/app/purchase-orders">
            <SecondaryButton>Back</SecondaryButton>
          </Link>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice && notice !== 'reload' ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Total</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatAmount(order.totalAmount)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Items</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{order.itemCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Status</p>
          <p
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-sm font-medium capitalize ${
              STATUS_STYLE[order.status]
            }`}
          >
            {order.status.replace(/_/g, ' ')}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Raised by</p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-900">
            {order.createdBy.name}
          </p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        {canPlace ? (
          <PrimaryButton onClick={() => void handlePlace()} disabled={busy}>
            Place order
          </PrimaryButton>
        ) : null}

        {canReceive ? (
          <PrimaryButton onClick={openReceive} disabled={busy}>
            Receive goods
          </PrimaryButton>
        ) : null}

        {canCancel ? (
          <SecondaryButton onClick={() => void handleCancel()} disabled={busy}>
            Cancel order
          </SecondaryButton>
        ) : null}

        {isTerminal ? (
          <p className="text-sm text-slate-500">
            {order.status === 'received'
              ? 'Fully received. This order is complete and cannot be changed.'
              : 'Cancelled. This order is closed and cannot receive goods.'}
          </p>
        ) : null}

        <p className="ml-auto text-xs text-slate-500">
          {order.orderedAt ? `Ordered ${new Date(order.orderedAt).toLocaleString()}` : 'Not yet placed'}
          {order.expectedAt
            ? ` · expected ${new Date(order.expectedAt).toLocaleDateString()}`
            : ''}
          {order.receivedAt
            ? ` · received ${new Date(order.receivedAt).toLocaleString()}`
            : ''}
        </p>
      </Card>

      <Card>
        <header className="border-b border-slate-200 px-6 py-4">
          <h2 className="font-semibold text-slate-900">Items</h2>
          <p className="text-sm text-slate-500">
            Received and remaining quantities are computed by the server, never entered by hand.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
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

            <tbody className="divide-y divide-slate-200">
              {(order.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4">
                    <Link
                      to={`/app/inventory/${item.productId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {item.productName}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-700">{item.sku}</td>
                  <td className="px-6 py-4 text-right text-slate-600">
                    {formatQuantity(item.quantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">
                    {formatQuantity(item.receivedQuantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-600">
                    {formatQuantity(item.remainingQuantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-600">
                    {formatAmount(item.unitCost)}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">
                    {formatAmount(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td colSpan={6} className="px-6 py-3 text-right text-sm font-medium text-slate-700">
                  Total
                </td>
                <td className="px-6 py-3 text-right text-base font-bold text-slate-900">
                  {formatAmount(order.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {order.notes ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Notes</h2>
          <p className="mt-1 text-sm text-slate-600">{order.notes}</p>
        </Card>
      ) : null}

      {receiving ? (
        <Modal
          title="Receive goods"
          onClose={() => setReceiving(false)}
          footer={
            <>
              <SecondaryButton onClick={() => setReceiving(false)} disabled={busy}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" form="receive-form" disabled={busy}>
                {busy ? 'Recording…' : 'Record receipt'}
              </PrimaryButton>
            </>
          }
        >
          <form id="receive-form" onSubmit={handleReceive} className="space-y-4">
            <ErrorBanner message={receiveError} />

            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
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
                    step="0.01"
                    required={false}
                    value={amounts[item.productId] ?? ''}
                    onChange={(value) =>
                      setAmounts((current) => ({ ...current, [item.productId]: value }))
                    }
                    placeholder="0"
                  />
                </div>
              ))}

            {(order.items ?? []).every((item) => Number(item.remainingQuantity) <= 0) ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Everything on this order has already been received.
              </p>
            ) : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
