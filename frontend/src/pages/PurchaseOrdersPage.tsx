/**
 * Purchase order list and draft creation entry point.
 *
 * Creating an order records intent only. The existing detail page owns placing,
 * cancelling, and receiving orders; receiving is the only lifecycle step that
 * adds inventory movements.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
import { analyticsApi } from '../lib/analytics';
import { catalogApi, type Product } from '../lib/catalog';
import { ApiError } from '../lib/request';
import {
  formatAmount,
  formatQuantity,
  purchaseOrderApi,
  supplierApi,
  PURCHASE_ORDER_STATUSES,
  type ListMeta,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type Supplier,
} from '../lib/purchasing';

const PAGE_SIZE = 20;
const LOOKUP_PAGE_SIZE = 100;

type StatusFilter = 'all' | PurchaseOrderStatus;
type PageResult<T> = { items: T[]; meta: { totalPages: number } };

type PurchaseOrderSummary = {
  total: number;
  draft: number;
  awaitingReceipt: number;
  received: number;
};

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'border-slate-700 bg-slate-800 text-slate-200',
  ordered: 'border-sky-400/20 bg-sky-400/[0.08] text-sky-200',
  partially_received: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-200',
  received: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200',
  cancelled: 'border-rose-400/20 bg-rose-400/[0.08] text-rose-200',
};

async function loadAllPages<T>(loadPage: (page: number) => Promise<PageResult<T>>): Promise<T[]> {
  const firstPage = await loadPage(1);
  const items = [...firstPage.items];

  for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
    const result = await loadPage(page);
    items.push(...result.items);
  }

  return items;
}

function endOfUtcDay(date: string): string | undefined {
  return date ? `${date}T23:59:59.999Z` : undefined;
}

function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

function statusLabel(status: PurchaseOrderStatus): string {
  return status.replaceAll('_', ' ');
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card darkSurface className="min-w-0 p-4 sm:p-5">
      <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-slate-100">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </Card>
  );
}

export function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<PurchaseOrderSummary | null>(null);
  const [purchaseValueLast30Days, setPurchaseValueLast30Days] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [appliedSupplierId, setAppliedSupplierId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [appliedStatus, setAppliedStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supplierLookupError, setSupplierLookupError] = useState<string | null>(null);
  const [productLookupError, setProductLookupError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [listRetryToken, setListRetryToken] = useState(0);
  const [summaryRetryToken, setSummaryRetryToken] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    purchaseOrderApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(appliedSupplierId ? { supplierId: appliedSupplierId } : {}),
        status: appliedStatus,
        from: appliedFrom || undefined,
        to: endOfUtcDay(appliedTo),
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
        setOrders(null);
        setMeta(null);
        setError(cause instanceof ApiError ? cause.message : 'Could not load purchase orders.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, appliedSupplierId, appliedStatus, appliedFrom, appliedTo, page, reloadToken, listRetryToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [supplierResult, productResult] = await Promise.allSettled([
        loadAllPages((currentPage) =>
          supplierApi.list({ isActive: 'all', page: currentPage, limit: LOOKUP_PAGE_SIZE }),
        ),
        loadAllPages((currentPage) =>
          catalogApi.listProducts({ isActive: 'true', page: currentPage, limit: LOOKUP_PAGE_SIZE }),
        ),
      ]);
      if (cancelled) return;

      if (supplierResult.status === 'fulfilled') {
        setSuppliers(supplierResult.value);
        setSupplierLookupError(null);
      } else {
        setSuppliers([]);
        setSupplierLookupError(
          supplierResult.reason instanceof ApiError || supplierResult.reason instanceof Error
            ? supplierResult.reason.message
            : 'Could not load active suppliers.',
        );
      }

      if (productResult.status === 'fulfilled') {
        setProducts(productResult.value);
        setProductLookupError(null);
      } else {
        setProducts([]);
        setProductLookupError(
          productResult.reason instanceof ApiError || productResult.reason instanceof Error
            ? productResult.reason.message
            : 'Could not load active products.',
        );
      }

      setLookupsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [countsResult, overviewResult] = await Promise.allSettled([
        Promise.all([
          purchaseOrderApi.list({ status: 'all', page: 1, limit: 1 }),
          purchaseOrderApi.list({ status: 'draft', page: 1, limit: 1 }),
          purchaseOrderApi.list({ status: 'ordered', page: 1, limit: 1 }),
          purchaseOrderApi.list({ status: 'partially_received', page: 1, limit: 1 }),
          purchaseOrderApi.list({ status: 'received', page: 1, limit: 1 }),
        ]),
        analyticsApi.overview(),
      ]);
      if (cancelled) return;

      const failures: string[] = [];
      if (countsResult.status === 'fulfilled') {
        const [allOrders, drafts, ordered, partial, received] = countsResult.value;
        setSummary({
          total: allOrders.meta.total,
          draft: drafts.meta.total,
          awaitingReceipt: ordered.meta.total + partial.meta.total,
          received: received.meta.total,
        });
      } else {
        setSummary(null);
        failures.push(
          `Order counts unavailable: ${countsResult.reason instanceof ApiError || countsResult.reason instanceof Error ? countsResult.reason.message : 'Could not load purchase-order counts.'}`,
        );
      }

      if (overviewResult.status === 'fulfilled') {
        setPurchaseValueLast30Days(overviewResult.value.purchasing.purchaseValueLast30Days);
      } else {
        setPurchaseValueLast30Days(null);
        failures.push(
          `Purchase value unavailable: ${overviewResult.reason instanceof ApiError || overviewResult.reason instanceof Error ? overviewResult.reason.message : 'Could not load purchase value.'}`,
        );
      }

      setSummaryError(failures.length > 0 ? failures.join(' ') : null);
      setSummaryLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken, summaryRetryToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setLookupsLoading(true);
    setSummaryLoading(true);
    setError(null);
    setSupplierLookupError(null);
    setProductLookupError(null);
    setSummaryError(null);
    setReloadToken((token) => token + 1);
  }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (from && to && from > to) {
      setRangeError('The start date must be on or before the end date.');
      return;
    }

    setRangeError(null);
    setAppliedSearch(search.trim());
    setAppliedSupplierId(supplierId);
    setAppliedStatus(status);
    setAppliedFrom(from);
    setAppliedTo(to);
    setPage(1);
    setLoading(true);
    setError(null);
    setListRetryToken((token) => token + 1);
  }

  function clearFilters() {
    setSearch('');
    setAppliedSearch('');
    setSupplierId('');
    setAppliedSupplierId('');
    setStatus('all');
    setAppliedStatus('all');
    setFrom('');
    setTo('');
    setAppliedFrom('');
    setAppliedTo('');
    setPage(1);
    setRangeError(null);
    setError(null);
    setLoading(true);
    setListRetryToken((token) => token + 1);
  }

  const hasFilters =
    appliedSearch !== '' ||
    appliedSupplierId !== '' ||
    appliedStatus !== 'all' ||
    appliedFrom !== '' ||
    appliedTo !== '';
  const showClearFilters = hasFilters || search !== '' || supplierId !== '' || status !== 'all' || from !== '' || to !== '';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        description="Track supplier orders and manage incoming inventory."
        darkSurface
        actions={<PrimaryButton darkSurface onClick={() => setCreating(true)}>Create Purchase Order</PrimaryButton>}
      />

      {rangeError ? <ErrorBanner darkSurface message={rangeError} /> : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}
      {summaryError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1"><ErrorBanner darkSurface message={`Purchase-order summary unavailable: ${summaryError}`} /></div>
          <SecondaryButton darkSurface
            onClick={() => {
              setSummaryLoading(true);
              setSummaryError(null);
              setSummaryRetryToken((token) => token + 1);
            }}
          >
            Retry summary
          </SecondaryButton>
        </div>
      ) : null}

      <section aria-label="Purchase order summary" className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          label="Total purchase orders"
          value={summary ? formatQuantity(String(summary.total)) : '—'}
          detail={summary ? 'All statuses, all dates' : summaryLoading ? 'Loading order totals' : 'Order total unavailable'}
        />
        <SummaryCard
          label="Draft orders"
          value={summary ? formatQuantity(String(summary.draft)) : '—'}
          detail="Not yet placed with suppliers"
        />
        <SummaryCard
          label="Awaiting receipt"
          value={summary ? formatQuantity(String(summary.awaitingReceipt)) : '—'}
          detail="Ordered or partially received"
        />
        <SummaryCard
          label="Received"
          value={summary ? formatQuantity(String(summary.received)) : '—'}
          detail="Fully received orders"
        />
        <SummaryCard
          label="Order value · 30 days"
          value={purchaseValueLast30Days !== null ? formatAmount(purchaseValueLast30Days) : '—'}
          detail={purchaseValueLast30Days !== null ? 'Server-reported purchasing value' : summaryLoading ? 'Loading value summary' : 'Value unavailable'}
        />
      </section>

      <Card darkSurface className="p-4 sm:p-5">
        <form onSubmit={applyFilters} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <Field
            label="Search supplier or notes"
            value={search}
            onChange={setSearch}
            required={false}
            maxLength={150}
            placeholder="Supplier name or note"
            darkSurface
          />
          <Select
            label="Supplier"
            value={supplierId}
            onChange={setSupplierId}
            options={[
              { value: '', label: 'All suppliers' },
              ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
            ]}
            hint={supplierLookupError ? 'Supplier options could not be loaded.' : undefined}
            darkSurface
          />
          <Select
            label="Status"
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { value: 'all', label: 'All statuses' },
              ...PURCHASE_ORDER_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            ]}
            darkSurface
          />
          <Field
            label="From"
            type="date"
            value={from}
            onChange={(value) => {
              setFrom(value);
              setRangeError(null);
            }}
            required={false}
            darkSurface
          />
          <Field
            label="To"
            type="date"
            value={to}
            onChange={(value) => {
              setTo(value);
              setRangeError(null);
            }}
            required={false}
            darkSurface
          />
          <div className="flex items-end gap-2">
            <PrimaryButton darkSurface type="submit">Apply</PrimaryButton>
            {showClearFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card darkSurface className="overflow-hidden">
        {loading ? (
          orders === null ? <Spinner darkSurface label="Loading purchase orders…" /> : <Spinner darkSurface label="Updating purchase orders…" />
        ) : orders === null ? (
          <EmptyState
            title="Purchase orders could not be loaded"
            description={error ?? 'Check the connection and retry to load the order history.'}
            action={<SecondaryButton darkSurface onClick={reload}>Retry</SecondaryButton>}
            darkSurface
          />
        ) : orders.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No orders match those filters' : 'No purchase orders yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'Raising an order tells your supplier what you need. Stock changes when the goods arrive.'
            }
            action={
              hasFilters ? (
                <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton darkSurface onClick={() => setCreating(true)}>Create the first order</PrimaryButton>
              )
            }
            darkSurface
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs tracking-wide text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Purchase order</th>
                    <th scope="col" className="px-4 py-3 font-medium">Supplier</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Items</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-4 py-3 font-medium">Expected</th>
                    <th scope="col" className="px-4 py-3 font-medium">Raised</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {orders.map((order) => (
                    <tr key={order.id} className="transition-colors hover:bg-white/[0.025]">
                      <td className="px-5 py-4">
                        <Link
                          to={`/app/purchase-orders/${order.id}`}
                          aria-label={`View purchase order ${order.id}`}
                          title={order.id}
                          className="rounded font-mono text-xs font-medium text-emerald-300 hover:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          PO-{order.id.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-100">{order.supplierName}</td>
                      <td className="px-4 py-4 text-right text-slate-300">
                        {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[order.status]}`}>
                          {statusLabel(order.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-medium tabular-nums text-slate-100">
                        {formatAmount(order.totalAmount)}
                      </td>
                      <td className="px-4 py-4 text-slate-300">{formatDate(order.expectedAt)}</td>
                      <td className="px-4 py-4 text-slate-300">
                        <span>{formatDate(order.createdAt)}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{order.createdBy.name}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/app/purchase-orders/${order.id}`}
                          className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          View order <span aria-hidden="true" className="ml-1">→</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-800 xl:hidden">
              {orders.map((order) => (
                <article key={order.id} className="space-y-3 p-4 sm:p-5">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/app/purchase-orders/${order.id}`}
                        className="break-words font-semibold text-slate-100 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        {order.supplierName}
                      </Link>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">PO-{order.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[order.status]}`}>
                      {statusLabel(order.status)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-[#0b1220] p-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Total</p>
                      <p className="mt-0.5 font-semibold tabular-nums text-slate-100">{formatAmount(order.totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Items</p>
                      <p className="mt-0.5 font-medium text-slate-200">{formatQuantity(String(order.itemCount))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Expected</p>
                      <p className="mt-0.5 text-slate-300">{formatDate(order.expectedAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Raised</p>
                      <p className="mt-0.5 text-slate-300">{formatDate(order.createdAt)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">Raised by {order.createdBy.name}</p>
                  <Link
                    to={`/app/purchase-orders/${order.id}`}
                    className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    View order details <span aria-hidden="true" className="ml-1">→</span>
                  </Link>
                </article>
              ))}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400 sm:px-6">
              <span>
                {meta ? `${meta.total} order${meta.total === 1 ? '' : 's'}` : '—'}
                {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              </span>
              {meta && meta.totalPages > 1 ? (
                <div className="flex gap-2">
                  <SecondaryButton darkSurface
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((current) => current - 1);
                      setLoading(true);
                      setError(null);
                    }}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton darkSurface
                    disabled={page >= totalPages}
                    onClick={() => {
                      setPage((current) => current + 1);
                      setLoading(true);
                      setError(null);
                    }}
                  >
                    Next
                  </SecondaryButton>
                </div>
              ) : null}
            </footer>
          </>
        )}
      </Card>

      {creating ? (
        <Modal title="Create Purchase Order" darkSurface onClose={() => setCreating(false)}>
          {lookupsLoading ? (
            <Spinner darkSurface label="Loading active suppliers and products…" />
          ) : supplierLookupError || productLookupError ? (
            <div className="space-y-3">
              <ErrorBanner darkSurface
                message={[
                  supplierLookupError ? `Supplier data unavailable: ${supplierLookupError}` : null,
                  productLookupError ? `Product data unavailable: ${productLookupError}` : null,
                ].filter(Boolean).join(' ')}
              />
              <div className="flex justify-end">
                <SecondaryButton darkSurface onClick={reload}>Retry</SecondaryButton>
              </div>
            </div>
          ) : (
            <CreatePurchaseOrderForm
              suppliers={suppliers}
              products={products}
              darkSurface
              onClose={() => setCreating(false)}
              onCreated={(order) => {
                setNotice(`Created ${statusLabel(order.status)} purchase order for ${formatAmount(order.totalAmount)}.`);
                setCreating(false);
                setPage(1);
                reload();
              }}
            />
          )}
        </Modal>
      ) : null}
    </div>
  );
}
