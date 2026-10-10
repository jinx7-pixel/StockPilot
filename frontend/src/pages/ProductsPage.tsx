/**
 * Products catalog.
 *
 * Products are catalog definitions only — nothing here displays or edits stock
 * quantities, availability or reorder points. Those belong to the inventory
 * module, which does not exist yet.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Link } from 'react-router-dom';

import {
  Card,
  DangerButton,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { catalogApi, type Category, type ListMeta, type Product, type ProductQuery } from '../lib/catalog';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'true' | 'false';

interface FormState {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  unit: string;
  costPrice: string;
  sellingPrice: string;
  isActive: boolean;
}

function emptyForm(): FormState {
  return {
    sku: '',
    name: '',
    description: '',
    categoryId: '',
    unit: 'piece',
    costPrice: '0.00',
    sellingPrice: '0.00',
    isActive: true,
  };
}

function formFrom(product: Product): FormState {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    unit: product.unit,
    costPrice: product.costPrice.toFixed(2),
    sellingPrice: product.sellingPrice.toFixed(2),
    isActive: product.isActive,
  };
}

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // `search` is the value in the box; `appliedSearch` is what the query uses.
  // That separation keeps typing responsive without a request per keystroke.
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (overrides: Partial<ProductQuery> = {}): ProductQuery => ({
      ...(appliedSearch ? { search: appliedSearch } : {}),
      ...(categoryId ? { categoryId } : {}),
      isActive: status,
      page,
      limit: PAGE_SIZE,
      ...overrides,
    }),
    [appliedSearch, categoryId, status, page],
  );

  /**
   * Fetching lives in the effect, but `loading` is raised by whichever
   * interaction caused the fetch. Setting it inside the effect body would add an
   * extra render on every mount; here the effect only settles a promise and
   * updates state in its callbacks.
   */
  useEffect(() => {
    let cancelled = false;

    catalogApi
      .listProducts(buildQuery())
      .then(({ items, meta: listMeta }) => {
        if (cancelled) return;
        setProducts(items);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load products.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [buildQuery, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    catalogApi
      .listCategories()
      .then((value) => {
        if (!cancelled) setCategories(value);
      })
      .catch(() => {
        // The category filter is optional; an empty list is a usable fallback.
        if (!cancelled) setCategories([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Start a loading cycle: raise the flag, then trigger the effect. */
  const beginLoad = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  /** Refresh without changing any filter. */
  const reload = useCallback(() => {
    beginLoad();
  }, [beginLoad]);

  function applyFilters() {
    setAppliedSearch(search.trim());
    setPage(1);
    setLoading(true);
  }

  function clearFilters() {
    setSearch('');
    setAppliedSearch('');
    setCategoryId('');
    setStatus('all');
    setPage(1);
    setLoading(true);
  }

  function changeCategory(value: string) {
    setCategoryId(value);
    setPage(1);
    setLoading(true);
  }

  function changeStatus(value: string) {
    setStatus(value as StatusFilter);
    setPage(1);
    setLoading(true);
  }

  function changePage(next: number) {
    setPage(next);
    setLoading(true);
  }

  function openCreate() {
    setForm(emptyForm());
    setFormError(null);
    setCreating(true);
  }

  function openEdit(product: Product) {
    setForm(formFrom(product));
    setFormError(null);
    setEditing(product);
  }

  function closeDialog() {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setNotice(null);

    const description = form.description.trim();

    try {
      if (editing) {
        await catalogApi.updateProduct(editing.id, {
          sku: form.sku.trim(),
          name: form.name.trim(),
          ...(description ? { description } : {}),
          // An empty selection means "no category", which the API accepts as null.
          categoryId: form.categoryId === '' ? null : form.categoryId,
          unit: form.unit.trim(),
          costPrice: form.costPrice.trim(),
          sellingPrice: form.sellingPrice.trim(),
          isActive: form.isActive,
        });
        setNotice('Product updated.');
      } else {
        await catalogApi.createProduct({
          sku: form.sku.trim(),
          name: form.name.trim(),
          ...(description ? { description } : {}),
          categoryId: form.categoryId === '' ? null : form.categoryId,
          unit: form.unit.trim(),
          costPrice: form.costPrice.trim(),
          sellingPrice: form.sellingPrice.trim(),
          isActive: form.isActive,
        });
        setNotice('Product created.');
      }

      closeDialog();
      reload();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : 'Could not save the product.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(product: Product) {
    const confirmed = window.confirm(
      `Retire "${product.name}"? It stays in the catalog but is marked inactive.`,
    );
    if (!confirmed) return;

    setError(null);
    setNotice(null);

    try {
      await catalogApi.deactivateProduct(product.id);
      setNotice(`Retired "${product.name}".`);
      reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not retire the product.');
    }
  }

  const hasFilters = appliedSearch !== '' || categoryId !== '' || status !== 'all';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Your catalog. Stock levels arrive with the inventory module."
        actions={
          <>
            <Link to="/app/categories">
              <SecondaryButton>Manage categories</SecondaryButton>
            </Link>
            <PrimaryButton onClick={openCreate}>New product</PrimaryButton>
          </>
        }
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
            applyFilters();
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
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
            onChange={changeCategory}
            options={[
              { value: '', label: 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />

          <Select
            label="Status"
            value={status}
            onChange={changeStatus}
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
          <Spinner label="Loading products…" />
        ) : products === null ? null : products.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No products match those filters' : 'No products yet'}
            description={
              hasFilters
                ? 'Try a different search term, or clear the filters to see everything.'
                : 'Add the products you sell. Stock quantities are tracked separately by the inventory module.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton onClick={openCreate}>Add the first product</PrimaryButton>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">SKU</th>
                    <th scope="col" className="px-6 py-3 font-medium">Name</th>
                    <th scope="col" className="px-6 py-3 font-medium">Category</th>
                    <th scope="col" className="px-6 py-3 font-medium">Unit</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Cost</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Price</th>
                    <th scope="col" className="px-6 py-3 font-medium">Status</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {products.map((product) => (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-mono text-xs text-slate-700">{product.sku}</td>
                      <td className="px-6 py-4 font-medium text-slate-900">{product.name}</td>
                      <td className="px-6 py-4 text-slate-600">
                        {product.categoryName ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{product.unit}</td>
                      <td className="px-6 py-4 text-right text-slate-600">
                        {money(product.costPrice)}
                      </td>
                      <td className="px-6 py-4 text-right text-slate-600">
                        {money(product.sellingPrice)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={
                            product.isActive
                              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                              : 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600'
                          }
                        >
                          {product.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <SecondaryButton onClick={() => openEdit(product)}>Edit</SecondaryButton>
                          {product.isActive ? (
                            <DangerButton onClick={() => void handleDeactivate(product)}>
                              Retire
                            </DangerButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3 text-sm text-slate-600">
              <span>
                {meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : '—'}
                {meta && meta.total > PAGE_SIZE
                  ? ` · page ${meta.page} of ${meta.totalPages}`
                  : ''}
              </span>

              {meta && meta.totalPages > 1 ? (
                <div className="flex gap-2">
                  <SecondaryButton disabled={page <= 1} onClick={() => changePage(page - 1)}>
                    Previous
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={page >= totalPages}
                    onClick={() => changePage(page + 1)}
                  >
                    Next
                  </SecondaryButton>
                </div>
              ) : null}
            </footer>
          </>
        )}
      </Card>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit product' : 'New product'}
          onClose={closeDialog}
          footer={
            <>
              <SecondaryButton onClick={closeDialog} disabled={saving}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" form="product-form" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </PrimaryButton>
            </>
          }
        >
          <form id="product-form" onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />

            <Field
              label="SKU"
              value={form.sku}
              onChange={(sku) => setForm((f) => ({ ...f, sku }))}
              maxLength={100}
              placeholder="BOLT-M8-40"
              hint="Stored upper-case. Must be unique within your business."
            />

            <Field
              label="Name"
              value={form.name}
              onChange={(name) => setForm((f) => ({ ...f, name }))}
              maxLength={200}
              placeholder="M8 x 40mm hex bolt"
            />

            <Textarea
              label="Description"
              value={form.description}
              onChange={(description) => setForm((f) => ({ ...f, description }))}
              maxLength={2000}
              placeholder="Galvanised, 50 per box"
            />

            <Select
              label="Category"
              value={form.categoryId}
              onChange={(value) => setForm((f) => ({ ...f, categoryId: value }))}
              options={[
                { value: '', label: 'No category' },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Unit"
                value={form.unit}
                onChange={(unit) => setForm((f) => ({ ...f, unit }))}
                maxLength={30}
                placeholder="piece"
                hint="piece, box, kg…"
              />

              <Field
                label="Cost price"
                type="number"
                value={form.costPrice}
                onChange={(costPrice) => setForm((f) => ({ ...f, costPrice }))}
                min={0}
                step="0.01"
              />

              <Field
                label="Selling price"
                type="number"
                value={form.sellingPrice}
                onChange={(sellingPrice) => setForm((f) => ({ ...f, sellingPrice }))}
                min={0}
                step="0.01"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((f) => ({ ...f, isActive: event.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Active
            </label>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

