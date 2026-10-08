/**
 * Purchase orders list.
 *
 * A PO records intent to buy. Nothing here moves stock — the "Receive goods"
 * action on the detail page is what increases it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { CreatePurchaseOrderForm } from '../components/CreatePurchaseOrderForm';
import {
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import { catalogApi, type Product } from '../lib/catalog';
import { ApiError } from '../lib/request';
import {
  formatAmount,
  purchaseOrderApi,
  supplierApi,
  PURCHASE_ORDER_STATUSES,
  type ListMeta,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type Supplier,
} from '../lib/purchasing';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | PurchaseOrderStatus;

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-200 text-slate-700',
  ordered: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    purchaseOrderApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(supplierId ? { supplierId } : {}),
        status,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ items, meta: listMeta }) => {
        if (cancelled) return;
        setOrders(items);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load purchase orders.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, supplierId, status, from, to, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [suppliersResult, productsResult] = await Promise.all([
          supplierApi.list({ limit: 100 }),
          catalogApi.listProducts({ isActive: 'true', limit: 100 }),
        ]);
        if (cancelled) return;
        setSuppliers(suppliersResult.items);
        setProducts(productsResult.items);
      } catch {
        if (!cancelled) {
          setSuppliers([]);
          setProducts([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  function applySearch() {
    setAppliedSearch(search.trim());
    setPage(1);
    setLoading(true);
  }

  function clearFilters() {
    setSearch('');
    setAppliedSearch('');
    setSupplierId('');
    setStatus('all');
    setFrom('');
    setTo('');
    setPage(1);
    setLoading(true);
  }

  const hasFilters =
    appliedSearch !== '' || supplierId !== '' || status !== 'all' || from !== '' || to !== '';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="Raising an order records intent. Stock increases only when goods are received."
        actions={<PrimaryButton onClick={() => setCreating(true)}>New purchase order</PrimaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      ) : null}

      <Card className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <Field
            label="Search"
            value={search}
            onChange={setSearch}
            required={false}
            maxLength={150}
            placeholder="Supplier or notes"
          />

          <Select
            label="Supplier"
            value={supplierId}
            onChange={(value) => {
              setSupplierId(value);
              setPage(1);
              setLoading(true);
            }}
            options={[
              { value: '', label: 'All suppliers' },
              ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
            ]}
          />

          <Select
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value as StatusFilter);
              setPage(1);
              setLoading(true);
            }}
            options={[
              { value: 'all', label: 'All' },
              ...PURCHASE_ORDER_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })),
            ]}
          />

          <Field label="From" type="date" value={from} onChange={setFrom} required={false} />
          <Field label="To" type="date" value={to} onChange={setTo} required={false} />

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <PrimaryButton type="submit">Apply</PrimaryButton>
            {hasFilters ? <SecondaryButton onClick={clearFilters}>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <Spinner label="Loading purchase orders…" />
        ) : orders === null ? null : orders.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No orders match those filters' : 'No purchase orders yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'Raising an order tells your supplier what you need. Stock changes when the goods arrive.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton onClick={() => setCreating(true)}>Raise the first order</PrimaryButton>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Supplier</th>
                    <th scope="col" className="px-6 py-3 font-medium">Items</th>
                    <th scope="col" className="px-6 py-3 font-medium">Status</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-6 py-3 font-medium">Expected</th>
                    <th scope="col" className="px-6 py-3 font-medium">Raised by</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {orders.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <Link
                          to={`/app/purchase-orders/${order.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {order.supplierName}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            STATUS_STYLE[order.status]
                          }`}
                        >
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-slate-900">
                        {formatAmount(order.totalAmount)}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {order.expectedAt
                          ? new Date(order.expectedAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{order.createdBy.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 ? (
              <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm text-slate-600">
                <span>
                  {meta.total} order{meta.total === 1 ? '' : 's'}
                </span>
                <div className="flex gap-2">
                  <SecondaryButton
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                      setLoading(true);
                    }}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={page >= totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
                      setLoading(true);
                    }}
                  >
                    Next
                  </SecondaryButton>
                </div>
              </footer>
            ) : null}
          </>
        )}
      </Card>

      {creating ? (
        <Modal title="New purchase order" onClose={() => setCreating(false)}>
          <CreatePurchaseOrderForm
            suppliers={suppliers}
            products={products}
            onClose={() => setCreating(false)}
            onCreated={(order) => {
              setNotice(`Created ${order.status} purchase order for ${formatAmount(order.totalAmount)}.`);
              setCreating(false);
              reload();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}
