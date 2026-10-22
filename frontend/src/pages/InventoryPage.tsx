/**
 * Inventory overview — every product with its derived stock level.
 *
 * Stock is computed by the server from the movement ledger. This page never
 * calculates a balance locally; it displays what the API reports.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { MovementForm } from '../components/MovementForm';
import {
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import { catalogApi, type Category } from '../lib/catalog';
import {
  inventoryApi,
  type InventoryItem,
  type InventorySummary,
  type ListMeta,
  type MovementType,
} from '../lib/inventory';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'true' | 'false';
type StockFilter = 'all' | 'in_stock' | 'out_of_stock' | 'no_movements';

const MOVEMENT_BUTTONS: { type: MovementType; label: string }[] = [
  { type: 'in', label: 'Stock in' },
  { type: 'out', label: 'Stock out' },
  { type: 'adjustment', label: 'Adjust' },
];

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summaryError, setSummaryError] = useState(false);
  const [categoriesError, setCategoriesError] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [stockStatus, setStockStatus] = useState<StockFilter>('all');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [moving, setMoving] = useState<{ product: InventoryItem; type: MovementType } | null>(
    null,
  );

  /**
   * Fetching lives in the effect, but `loading` is raised by whichever
   * interaction caused the fetch — setting it in the effect body would add a
   * render on every mount.
   */
  useEffect(() => {
    let cancelled = false;

    inventoryApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(categoryId ? { categoryId } : {}),
        isActive: status,
        stockStatus,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ items, meta: listMeta }) => {
        if (cancelled) return;
        setItems(items);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setItems(null);
        setMeta(null);
        setError(cause instanceof ApiError ? cause.message : 'Could not load inventory.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, status, stockStatus, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    inventoryApi
      .summary()
      .then((summary) => {
        if (!cancelled) {
          setSummary(summary);
          setSummaryError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(true);
        }
      });

    catalogApi
      .listCategories()
      .then((value) => {
        if (!cancelled) {
          setCategories(value);
          setCategoriesError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
          setCategoriesError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setError(null);
    setSummaryError(false);
    setCategoriesError(false);
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  function applySearch() {
    setError(null);
    setAppliedSearch(search.trim());
    setPage(1);
    setLoading(true);
  }

  function clearFilters() {
    setError(null);
    setSearch('');
    setAppliedSearch('');
    setCategoryId('');
    setStatus('all');
    setStockStatus('all');
    setPage(1);
    setLoading(true);
  }

  const hasFilters =
    appliedSearch !== '' ||
    search.trim() !== '' ||
    categoryId !== '' ||
    status !== 'all' ||
    stockStatus !== 'all';
  const totalPages = meta?.totalPages ?? 1;

  function stockTone(stock: number): string {
    if (stock <= 0) return 'text-rose-300 font-semibold';
    return 'text-emerald-300 font-semibold';
  }

  function retryInventory() {
    setError(null);
    setSummaryError(false);
    setCategoriesError(false);
    setLoading(true);
    setReloadToken((token) => token + 1);
  }

  function statusBadge(item: InventoryItem) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <span
          className={
            item.isActive
              ? 'rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-0.5 text-xs font-medium text-emerald-200'
              : 'rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-xs font-medium text-slate-400'
          }
        >
          {item.isActive ? 'Active' : 'Inactive'}
        </span>
        <span
          className={
            item.currentStock > 0
              ? 'rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-0.5 text-xs font-medium text-emerald-200'
              : 'rounded-full border border-rose-400/20 bg-rose-400/[0.08] px-2 py-0.5 text-xs font-medium text-rose-200'
          }
        >
          {item.currentStock > 0 ? 'In stock' : 'Out of stock'}
        </span>
      </div>
    );
  }

  function movementActions(
    item: InventoryItem,
    alignment: 'justify-end' | 'justify-start' = 'justify-end',
  ) {
    return (
      <div className={`flex flex-wrap gap-2 ${alignment}`}>
        {MOVEMENT_BUTTONS.map((button) => (
          <SecondaryButton
            darkSurface
            key={button.type}
            onClick={() => setMoving({ product: item, type: button.type })}
          >
            {button.label}
          </SecondaryButton>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Monitor stock levels and keep inventory under control."
        darkSurface
      />

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-3 py-2 text-sm text-rose-200">
          <span>{error}</span>
          <SecondaryButton darkSurface onClick={retryInventory}>Retry</SecondaryButton>
        </div>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {summaryError || categoriesError ? (
        <div className="space-y-2">
          {summaryError ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-sm text-amber-200">
              <span>Inventory summary is unavailable. The product list remains usable.</span>
              <SecondaryButton darkSurface onClick={retryInventory}>Retry</SecondaryButton>
            </div>
          ) : null}
          {categoriesError ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-sm text-amber-200">
              <span>Categories could not be loaded, so category filtering is unavailable.</span>
              <SecondaryButton darkSurface onClick={retryInventory}>Retry</SecondaryButton>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Active products</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{summary?.productCount ?? '—'}</p>
          <p className="mt-1 text-xs text-slate-400">
            {summary ? 'Active catalogue items' : summaryError ? 'Unavailable' : 'Loading summary'}
          </p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">In stock</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {summary ? summary.productCount - summary.outOfStockCount : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">Active products with positive stock</p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Out of stock</p>
          <p className="mt-1 text-2xl font-bold text-rose-300">
            {summary?.outOfStockCount ?? '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">Active products at zero stock or below</p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Ledger entries</p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {summary?.totalMovementCount ?? '—'}
          </p>
          <p className="mt-1 text-xs text-slate-400">Recorded stock movements</p>
        </Card>
      </div>

      <Card darkSurface className="p-4">
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
            maxLength={200}
            placeholder="Name or SKU"
            darkSurface
          />

          <Select
            label="Category"
            value={categoryId}
            onChange={(value) => {
              setError(null);
              setCategoryId(value);
              setPage(1);
              setLoading(true);
            }}
            darkSurface
            options={[
              {
                value: '',
                label: categoriesError ? 'Categories unavailable' : 'All categories',
              },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />

          <Select
            label="Stock status"
            value={stockStatus}
            onChange={(value) => {
              setError(null);
              setStockStatus(value as StockFilter);
              setPage(1);
              setLoading(true);
            }}
            darkSurface
            options={[
              { value: 'all', label: 'Any' },
              { value: 'in_stock', label: 'In stock' },
              { value: 'out_of_stock', label: 'Out of stock' },
              { value: 'no_movements', label: 'No movements yet' },
            ]}
          />

          <Select
            label="Product status"
            value={status}
            onChange={(value) => {
              setError(null);
              setStatus(value as StatusFilter);
              setPage(1);
              setLoading(true);
            }}
            darkSurface
            options={[
              { value: 'all', label: 'All' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2">
            <PrimaryButton type="submit" darkSurface>Search</PrimaryButton>
            {hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card darkSurface className="overflow-hidden">
        {loading ? (
          items === null ? (
            <Spinner label="Loading inventory…" darkSurface />
          ) : (
            <div className="border-b border-slate-800 py-3">
              <Spinner label="Updating inventory…" darkSurface />
            </div>
          )
        ) : items === null ? (
          <EmptyState
            title="Inventory could not be loaded"
            description="Check your connection and try loading the inventory again."
            action={<SecondaryButton darkSurface onClick={retryInventory}>Retry</SecondaryButton>}
            darkSurface
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No products match those filters' : 'No products yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'Add products first, then record stock movements against them.'
            }
            action={
              hasFilters ? (
                <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]" to="/app/products">
                  Go to products
                </Link>
              )
            }
            darkSurface
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Product</th>
                    <th scope="col" className="px-6 py-3 font-medium">SKU</th>
                    <th scope="col" className="px-6 py-3 font-medium">Category</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Stock</th>
                    <th scope="col" className="px-6 py-3 font-medium">Status</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {items.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-white/[0.025]">
                      <td className="px-6 py-4">
                        <Link
                          to={`/app/inventory/${item.id}`}
                          className="rounded font-medium text-slate-200 transition hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-400">{item.sku}</td>
                      <td className="px-6 py-4 text-slate-400">
                        {item.category?.name ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className={`px-6 py-4 text-right ${stockTone(item.currentStock)}`}>
                        {item.currentStock} {item.unit}
                      </td>
                      <td className="px-6 py-4">{statusBadge(item)}</td>
                      <td className="px-6 py-4">
                        {movementActions(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-800 md:hidden">
              {items.map((item) => (
                <article key={item.id} className="space-y-4 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/app/inventory/${item.id}`}
                        className="break-words rounded font-semibold text-slate-200 transition hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        {item.name}
                      </Link>
                      <p className="mt-1 break-all font-mono text-xs text-slate-500">{item.sku}</p>
                    </div>
                    <p className={`shrink-0 text-right text-sm ${stockTone(item.currentStock)}`}>
                      {item.currentStock} {item.unit}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-slate-400">{item.category?.name ?? 'Uncategorized'}</p>
                    {statusBadge(item)}
                  </div>
                  {movementActions(item, 'justify-start')}
                </article>
              ))}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400 sm:px-6">
              <span>
                {meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : '—'}
                {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              </span>

              {meta && meta.totalPages > 1 ? (
                <div className="flex gap-2">
                  <SecondaryButton darkSurface
                    disabled={page <= 1}
                    onClick={() => {
                      setError(null);
                      setPage((p) => p - 1);
                      setLoading(true);
                    }}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton darkSurface
                    disabled={page >= totalPages}
                    onClick={() => {
                      setError(null);
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

      {moving ? (
        <Modal
          title={
            moving.type === 'in'
              ? 'Record stock in'
              : moving.type === 'out'
                ? 'Record stock out'
                : 'Adjust stock'
          }
          onClose={() => setMoving(null)}
          darkSurface
        >
          <MovementForm
            key={moving.type}
            movementType={moving.type}
            product={moving.product}
            darkSurface
            onClose={() => setMoving(null)}
            onRecorded={(currentStock) => {
              setNotice(
                `Recorded. ${moving.product.name} now has ${currentStock} ${moving.product.unit}.`,
              );
              setMoving(null);
              reload();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

