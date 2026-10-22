/**
 * Sales activity and completed transaction history.
 *
 * Sale values and stock effects are authoritative on the server. This page
 * formats the API data and delegates new transactions to CreateSaleForm.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { CreateSaleForm, type SellableProduct } from '../components/CreateSaleForm';
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
import { analyticsApi, type SalesAnalytics } from '../lib/analytics';
import { catalogApi, type Product } from '../lib/catalog';
import { inventoryApi, type InventoryItem } from '../lib/inventory';
import { ApiError } from '../lib/request';
import {
  formatAmount,
  formatQuantity,
  salesApi,
  type ListMeta,
  type Sale,
  type SaleStatus,
} from '../lib/sales';

const PAGE_SIZE = 20;
const PRODUCT_PAGE_SIZE = 100;

type StatusFilter = 'all' | SaleStatus;
type PageResult<T> = { items: T[]; meta: { totalPages: number } };

async function loadAllPages<T>(
  loadPage: (page: number) => Promise<PageResult<T>>,
): Promise<T[]> {
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

function formatSaleDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SalesPage() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [summary, setSummary] = useState<SalesAnalytics | null>(null);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [summaryRetryToken, setSummaryRetryToken] = useState(0);

  const [creating, setCreating] = useState(false);
  const [sellable, setSellable] = useState<SellableProduct[]>([]);

  useEffect(() => {
    let cancelled = false;

    salesApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        status,
        from: appliedFrom || undefined,
        to: endOfUtcDay(appliedTo),
        page,
        limit: PAGE_SIZE,
      })
      .then(({ items, meta: listMeta }) => {
        if (cancelled) return;
        setSales(items);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSales(null);
        setMeta(null);
        setError(cause instanceof ApiError ? cause.message : 'Could not load sales.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, status, appliedFrom, appliedTo, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    analyticsApi
      .sales({ from: appliedFrom || undefined, to: appliedTo || undefined })
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setSummaryError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(
          cause instanceof ApiError ? cause.message : 'Could not load sales summary.',
        );
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedFrom, appliedTo, reloadToken, summaryRetryToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [products, inventory] = await Promise.all([
          loadAllPages((currentPage) =>
            catalogApi.listProducts({ isActive: 'true', page: currentPage, limit: PRODUCT_PAGE_SIZE }),
          ),
          loadAllPages((currentPage) =>
            inventoryApi.list({ isActive: 'true', page: currentPage, limit: PRODUCT_PAGE_SIZE }),
          ),
        ]);
        if (cancelled) return;

        const stockByProduct = new Map<string, number>(
          inventory.map((item: InventoryItem) => [item.id, item.currentStock]),
        );
        const missingStock = products.some((product: Product) => !stockByProduct.has(product.id));
        if (missingStock) {
          throw new Error('Current stock could not be loaded for every active product.');
        }

        setSellable(
          products.map((product: Product) => ({
            id: product.id,
            name: product.name,
            sku: product.sku,
            unit: product.unit,
            sellingPrice: product.sellingPrice,
            currentStock: stockByProduct.get(product.id)!,
          })),
        );
      } catch (cause) {
        if (cancelled) return;
        setSellable([]);
        setProductsError(
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : 'Could not load active products and stock levels.',
        );
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setSummaryLoading(true);
    setProductsLoading(true);
    setError(null);
    setSummaryError(null);
    setProductsError(null);
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
    setAppliedFrom(from);
    setAppliedTo(to);
    setPage(1);
    setLoading(true);
    setSummaryLoading(true);
    setError(null);
  }

  function clearFilters() {
    setSearch('');
    setAppliedSearch('');
    setFrom('');
    setTo('');
    setAppliedFrom('');
    setAppliedTo('');
    setStatus('all');
    setPage(1);
    setRangeError(null);
    setError(null);
    setLoading(true);
    setSummaryLoading(true);
  }

  const hasFilters =
    appliedSearch !== '' ||
    appliedFrom !== '' ||
    appliedTo !== '' ||
    status !== 'all';
  const showClearFilters = hasFilters || search !== '' || from !== '' || to !== '';
  const totalPages = meta?.totalPages ?? 1;
  const periodLabel = appliedFrom && appliedTo
    ? 'Selected date range'
    : appliedFrom
      ? 'From selected date'
      : appliedTo
        ? '30 days ending on selected date'
        : 'Last 30 days';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Track sales transactions and manage sales activity."
        actions={<PrimaryButton onClick={() => setCreating(true)} darkSurface>New Sale</PrimaryButton>}
        darkSurface
      />

      {error ? <ErrorBanner message={error} darkSurface /> : null}
      {rangeError ? <ErrorBanner message={rangeError} darkSurface /> : null}
      {summaryError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ErrorBanner message={`Sales summary unavailable: ${summaryError}`} darkSurface />
          <SecondaryButton
            darkSurface
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
      {notice ? (
        <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Sales · {periodLabel}</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {summary?.summary.salesCount ?? '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {summary ? 'Completed transactions' : summaryLoading ? 'Loading summary' : 'Unavailable'}
          </p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Units sold · {periodLabel}</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {summary ? formatQuantity(String(summary.summary.unitsSold)) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">Quantities from completed sales</p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Revenue · {periodLabel}</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {summary ? formatAmount(summary.summary.revenue) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">Server-calculated sale totals</p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Average sale · {periodLabel}</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {summary && summary.summary.salesCount > 0
              ? formatAmount(summary.summary.averageSaleValue)
              : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {summary?.summary.salesCount === 0
              ? 'No completed sales in this period'
              : 'Server-calculated average transaction value'}
          </p>
        </Card>
      </div>

      <Card darkSurface className="p-4">
        <form onSubmit={applyFilters} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Search customer"
            value={search}
            onChange={setSearch}
            required={false}
            maxLength={150}
            placeholder="Name or phone"
            darkSurface
          />

          <Select
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value as StatusFilter);
              setPage(1);
              setLoading(true);
              setError(null);
            }}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'completed', label: 'Completed' },
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
            <PrimaryButton type="submit" darkSurface>Apply</PrimaryButton>
            {showClearFilters ? <SecondaryButton onClick={clearFilters} darkSurface>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card darkSurface className="overflow-hidden">
        {loading ? (
          sales === null ? <Spinner label="Loading sales…" darkSurface /> : <Spinner label="Updating sales…" darkSurface />
        ) : sales === null ? (
          <EmptyState
            title="Sales could not be loaded"
            description="Check the connection and retry to load your sales history."
            action={<SecondaryButton onClick={reload} darkSurface>Retry</SecondaryButton>}
            darkSurface
          />
        ) : sales.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No sales match those filters' : 'No sales recorded yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'A sale records its items and stock movements together in the inventory ledger.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters} darkSurface>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton onClick={() => setCreating(true)} darkSurface>Record the first sale</PrimaryButton>
              )
            }
            darkSurface
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Sale</th>
                    <th scope="col" className="px-5 py-3 font-medium">Customer</th>
                    <th scope="col" className="px-5 py-3 font-medium">Items</th>
                    <th scope="col" className="px-5 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-5 py-3 font-medium">Sold at</th>
                    <th scope="col" className="px-5 py-3 font-medium">Recorded by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {sales.map((sale) => (
                    <tr key={sale.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-5 py-4">
                        <Link
                          to={`/app/sales/${sale.id}`}
                          aria-label={`View sale ${sale.id}`}
                          className="rounded font-mono text-xs font-medium text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                          title={sale.id}
                        >
                          #{sale.id.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          to={`/app/sales/${sale.id}`}
                          className="rounded font-medium text-slate-100 hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          {sale.customerName?.trim() || 'Walk-in customer'}
                        </Link>
                        {sale.customerPhone ? (
                          <p className="text-xs text-slate-400">{sale.customerPhone}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        {sale.itemCount} {sale.itemCount === 1 ? 'item' : 'items'}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-0.5 text-xs font-medium text-emerald-200">
                          {sale.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right font-medium tabular-nums text-slate-100">
                        {formatAmount(sale.totalAmount)}
                      </td>
                      <td className="px-5 py-4 text-slate-300">{formatSaleDate(sale.soldAt)}</td>
                      <td className="px-5 py-4 text-slate-300">{sale.createdBy.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-800 md:hidden">
              {sales.map((sale) => (
                <article key={sale.id} className="space-y-3 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/app/sales/${sale.id}`}
                        className="break-words rounded font-semibold text-slate-100 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        {sale.customerName?.trim() || 'Walk-in customer'}
                      </Link>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">Sale #{sale.id.slice(0, 8).toUpperCase()}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-0.5 text-xs font-medium text-emerald-200">
                      {sale.status}
                    </span>
                  </div>

                  {sale.customerPhone ? <p className="text-sm text-slate-300">{sale.customerPhone}</p> : null}

                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-[#0c1523] p-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Total</p>
                      <p className="mt-0.5 font-semibold tabular-nums text-slate-100">{formatAmount(sale.totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Items</p>
                      <p className="mt-0.5 font-medium text-slate-200">{sale.itemCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Sold at</p>
                      <p className="mt-0.5 text-slate-300">{formatSaleDate(sale.soldAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Recorded by</p>
                      <p className="mt-0.5 truncate text-slate-300">{sale.createdBy.name}</p>
                    </div>
                  </div>

                  <Link
                    to={`/app/sales/${sale.id}`}
                    className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-medium text-emerald-300 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    View sale details <span aria-hidden="true" className="ml-1">→</span>
                  </Link>
                </article>
              ))}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400 sm:px-6">
              <span>
                {meta ? `${meta.total} sale${meta.total === 1 ? '' : 's'}` : '—'}
                {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              </span>
              {meta && meta.totalPages > 1 ? (
                <div className="flex gap-2">
                  <SecondaryButton
                    darkSurface
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((current) => current - 1);
                      setLoading(true);
                      setError(null);
                    }}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton
                    darkSurface
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
        <Modal title="New sale" onClose={() => setCreating(false)} darkSurface>
          {productsLoading ? (
            <Spinner label="Loading active products and stock…" darkSurface />
          ) : productsError ? (
            <div className="space-y-3">
              <ErrorBanner message={`Product data unavailable: ${productsError}`} darkSurface />
              <div className="flex justify-end">
                <SecondaryButton onClick={reload} darkSurface>Retry product loading</SecondaryButton>
              </div>
            </div>
          ) : (
            <CreateSaleForm
              products={sellable}
              onClose={() => setCreating(false)}
              darkSurface
              onCreated={(sale) => {
                setNotice(`Recorded sale for ${formatAmount(sale.totalAmount)}.`);
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
