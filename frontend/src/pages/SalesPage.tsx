/**
 * Sales list.
 *
 * Read-only view of completed sales plus the create-sale action. Sales are
 * immutable, so there are no edit or delete controls anywhere.
 */

import { useCallback, useEffect, useState } from 'react';
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
import { catalogApi, type Product } from '../lib/catalog';
import { inventoryApi, type InventoryItem } from '../lib/inventory';
import { ApiError } from '../lib/request';
import { formatAmount, salesApi, type ListMeta, type Sale, type SaleStatus } from '../lib/sales';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | SaleStatus;

export function SalesPage() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [creating, setCreating] = useState(false);
  const [sellable, setSellable] = useState<SellableProduct[]>([]);

  /**
   * Fetching lives in the effect; `loading` is raised by the interaction that
   * caused the fetch, so the effect body never sets state synchronously.
   */
  useEffect(() => {
    let cancelled = false;

    salesApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        status,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ data, meta: listMeta }) => {
        if (cancelled) return;
        setSales(data);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load sales.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, status, from, to, page, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  /**
   * Build the sellable list: prices from the products API, stock from the
   * inventory listing, joined by product id. Neither API contract is changed.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [productsResult, inventoryResult] = await Promise.all([
          catalogApi.listProducts({ isActive: 'true', limit: 100 }),
          inventoryApi.list({ isActive: 'true', limit: 100 }),
        ]);
        if (cancelled) return;

        const stockByProduct = new Map<string, number>(
          inventoryResult.data.map((item: InventoryItem) => [item.id, item.currentStock]),
        );

        const merged: SellableProduct[] = productsResult.data.map((product: Product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          sellingPrice: product.sellingPrice,
          currentStock: stockByProduct.get(product.id) ?? 0,
        }));

        setSellable(merged);
      } catch {
        if (!cancelled) setSellable([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function applySearch() {
    setAppliedSearch(search.trim());
    setPage(1);
    setLoading(true);
  }

  function clearFilters() {
    setSearch('');
    setAppliedSearch('');
    setStatus('all');
    setFrom('');
    setTo('');
    setPage(1);
    setLoading(true);
  }

  const hasFilters = appliedSearch !== '' || status !== 'all' || from !== '' || to !== '';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Completed sales. Recording a sale reduces stock through the inventory ledger."
        actions={<PrimaryButton onClick={() => setCreating(true)}>Record sale</PrimaryButton>}
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
            label="Search customer"
            value={search}
            onChange={setSearch}
            required={false}
            maxLength={150}
            placeholder="Name or phone"
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
              { value: 'completed', label: 'Completed' },
            ]}
          />

          <Field
            label="From"
            type="date"
            value={from}
            onChange={setFrom}
            required={false}
          />
          <Field label="To" type="date" value={to} onChange={setTo} required={false} />

          <div className="flex items-end gap-2">
            <PrimaryButton type="submit">Apply</PrimaryButton>
            {hasFilters ? <SecondaryButton onClick={clearFilters}>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <Spinner label="Loading sales…" />
        ) : sales === null ? null : sales.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No sales match those filters' : 'No sales recorded yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'Recording a sale creates immutable stock movements, so the ledger always matches the sale history.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton onClick={() => setCreating(true)}>Record the first sale</PrimaryButton>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Customer</th>
                    <th scope="col" className="px-6 py-3 font-medium">Items</th>
                    <th scope="col" className="px-6 py-3 font-medium">Status</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-6 py-3 font-medium">Sold at</th>
                    <th scope="col" className="px-6 py-3 font-medium">Recorded by</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {sales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <Link
                          to={`/app/sales/${sale.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {sale.customerName ?? 'Walk-in customer'}
                        </Link>
                        {sale.customerPhone ? (
                          <p className="text-xs text-slate-500">{sale.customerPhone}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {sale.itemCount} {sale.itemCount === 1 ? 'item' : 'items'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          {sale.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-slate-900">
                        {formatAmount(sale.totalAmount)}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {new Date(sale.soldAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{sale.createdBy.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3 text-sm text-slate-600">
              <span>
                {meta ? `${meta.total} sale${meta.total === 1 ? '' : 's'}` : '—'}
                {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              </span>

              {meta && meta.totalPages > 1 ? (
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
              ) : null}
            </footer>
          </>
        )}
      </Card>

      {creating ? (
        <Modal title="Record sale" onClose={() => setCreating(false)}>
          <CreateSaleForm
            products={sellable}
            onClose={() => setCreating(false)}
            onCreated={(sale) => {
              setNotice(`Recorded sale for ${formatAmount(sale.totalAmount)}.`);
              setCreating(false);
              reload();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}
