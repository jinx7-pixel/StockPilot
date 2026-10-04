/**
 * Inventory overview â€” every product with its derived stock level.
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
  ErrorBanner,
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
   * interaction caused the fetch â€” setting it in the effect body would add a
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
      .then(({ data, meta: listMeta }) => {
        if (cancelled) return;
        setItems(data);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
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
      .then(({ data }) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // The summary is a convenience; the list still works without it.
      });

    catalogApi
      .listCategories()
      .then(({ data }) => {
        if (!cancelled) setCategories(data);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });

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
    setCategoryId('');
    setStatus('all');
    setStockStatus('all');
    setPage(1);
    setLoading(true);
  }

  const hasFilters =
    appliedSearch !== '' || categoryId !== '' || status !== 'all' || stockStatus !== 'all';
  const totalPages = meta?.totalPages ?? 1;

  function stockTone(stock: number): string {
    if (stock <= 0) return 'text-red-600 font-semibold';
    if (stock < 5) return 'text-amber-600 font-medium';
    return 'text-slate-900 font-medium';
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock levels derived from the movement ledger. Nothing here is a stored total."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      ) : null}

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs tracking-wide text-slate-500 uppercase">Active products</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{summary.productCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs tracking-wide text-slate-500 uppercase">With movements</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {summary.productsWithMovements}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs tracking-wide text-slate-500 uppercase">Out of stock</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{summary.outOfStockCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs tracking-wide text-slate-500 uppercase">Ledger entries</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {summary.totalMovementCount}
            </p>
          </Card>
        </div>
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
            maxLength={200}
            placeholder="Name or SKU"
          />

          <Select
            label="Category"
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              setPage(1);
              setLoading(true);
            }}
            options={[
              { value: '', label: 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />

          <Select
            label="Stock status"
            value={stockStatus}
            onChange={(value) => {
              setStockStatus(value as StockFilter);
              setPage(1);
              setLoading(true);
            }}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'in_stock', label: 'In stock' },
              { value: 'out_of_stock', label: 'Zero or negative' },
              { value: 'no_movements', label: 'No movements yet' },
            ]}
          />

          <Select
            label="Product status"
            value={status}
            onChange={(value) => {
              setStatus(value as StatusFilter);
              setPage(1);
              setLoading(true);
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2">
            <PrimaryButton type="submit">Search</PrimaryButton>
            {hasFilters ? <SecondaryButton onClick={clearFilters}>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <Spinner label="Loading inventoryâ€¦" />
        ) : items === null ? null : items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No products match those filters' : 'No products yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'Add products first, then record stock movements against them.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link to="/app/products">
                  <PrimaryButton>Go to products</PrimaryButton>
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Product</th>
                    <th scope="col" className="px-6 py-3 font-medium">SKU</th>
                    <th scope="col" className="px-6 py-3 font-medium">Category</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Stock</th>
                    <th scope="col" className="px-6 py-3 font-medium">Status</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <Link
                          to={`/app/inventory/${item.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-700">{item.sku}</td>
                      <td className="px-6 py-4 text-slate-600">
                        {item.category?.name ?? <span className="text-slate-400">â€”</span>}
                      </td>
                      <td className={`px-6 py-4 text-right ${stockTone(item.currentStock)}`}>
                        {item.currentStock} {item.unit}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={
                            item.isActive
                              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                              : 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600'
                          }
                        >
                          {item.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          {MOVEMENT_BUTTONS.map((button) => (
                            <SecondaryButton
                              key={button.type}
                              onClick={() => setMoving({ product: item, type: button.type })}
                            >
                              {button.label}
                            </SecondaryButton>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3 text-sm text-slate-600">
              <span>
                {meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : 'â€”'}
                {meta && meta.total > PAGE_SIZE ? ` Â· page ${meta.page} of ${meta.totalPages}` : ''}
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
        >
          <MovementForm
            key={moving.type}
            movementType={moving.type}
            product={moving.product}
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

