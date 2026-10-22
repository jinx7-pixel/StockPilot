/** Product catalogue with live catalog, stock, and stock-risk data. */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ErrorBanner, Field, Modal } from '../components/ui';
import { analyticsApi, type Overview } from '../lib/analytics';
import {
  catalogApi,
  type Category,
  type ListMeta,
  type Product,
  type ProductQuery,
} from '../lib/catalog';
import { intelligenceApi, type RiskLevel, type StockRisk } from '../lib/intelligence';
import { inventoryApi, type InventoryItem, type StockStatus } from '../lib/inventory';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'true' | 'false';
type StockFilter = 'all' | StockStatus;

interface ProductRow {
  id: string;
  product: Product | null;
  inventory: InventoryItem | null;
}

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

type SafeResult<T> = { value: T; error: null } | { value: null; error: unknown };

async function safeRequest<T>(request: Promise<T>): Promise<SafeResult<T>> {
  try {
    return { value: await request, error: null };
  } catch (error) {
    return { value: null, error };
  }
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

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function displayError(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

const inputClass = 'mt-1 block h-10 w-full min-w-0 rounded-lg border border-slate-700/80 bg-[#0b1220] px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15 scheme-dark';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';
const dangerButtonClass = 'inline-flex h-9 items-center justify-center rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 text-xs font-medium text-rose-200 transition hover:border-rose-400/40 hover:bg-rose-400/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]';

function MetricIcon({ type }: { type: 'products' | 'active' | 'stock' | 'attention' }) {
  const paths = {
    products: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z M12 12v9 M4 7.5 12 12l8-4.5',
    active: 'M5 12.5 9.2 17 19 7',
    stock: 'M4 5h16v14H4z M8 9h8 M8 13h5 M8 16h3',
    attention: 'M12 3 2.8 20h18.4z M12 9v5 M12 17v.1',
  };
  const color = type === 'attention'
    ? 'border-amber-400/15 bg-amber-400/[0.08] text-amber-300'
    : type === 'stock'
      ? 'border-sky-400/15 bg-sky-400/[0.08] text-sky-300'
      : 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300';

  return (
    <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl border ' + color}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={paths[type]} />
      </svg>
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: 'products' | 'active' | 'stock' | 'attention';
}) {
  return (
    <article className="group min-w-0 rounded-2xl border border-slate-800/90 bg-[#101a2a] p-4 shadow-[0_14px_35px_-24px_rgba(0,0,0,0.8)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-[#121f31] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <MetricIcon type={icon} />
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function ProductSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block min-w-0 text-xs font-medium text-slate-400">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'rose' | 'slate'; children: React.ReactNode }) {
  const styles = {
    green: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200',
    amber: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-200',
    rose: 'border-rose-400/20 bg-rose-400/[0.07] text-rose-200',
    slate: 'border-slate-700 bg-slate-800/50 text-slate-400',
  };
  return <span className={'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ' + styles[tone]}>{children}</span>;
}

function statusForStock(
  inventory: InventoryItem | null,
  risk: StockRisk | undefined,
  stockFilter: StockFilter,
): { label: string; tone: 'green' | 'amber' | 'rose' | 'slate' } {
  if (!inventory) return { label: 'Unavailable', tone: 'slate' };
  if (stockFilter === 'no_movements') return { label: 'No movements', tone: 'slate' };
  if (inventory.currentStock <= 0 || risk?.risk === 'OUT_OF_STOCK') return { label: 'Out of stock', tone: 'rose' };
  if (risk?.risk === 'CRITICAL') return { label: 'Critical', tone: 'rose' };
  if (risk?.risk === 'LOW') return { label: 'Low stock', tone: 'amber' };
  return { label: 'In stock', tone: 'green' };
}

function ProductActions({
  row,
  onEdit,
  onRetire,
}: {
  row: ProductRow;
  onEdit: (product: Product) => void;
  onRetire: (product: Product) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Link to={'/app/inventory/' + row.id} className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-medium text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">View</Link>
      {row.product ? <button type="button" onClick={() => onEdit(row.product!)} className="inline-flex h-9 items-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Edit</button> : null}
      {row.product?.isActive ? <button type="button" onClick={() => onRetire(row.product!)} className={dangerButtonClass}>Retire</button> : null}
    </div>
  );
}

export function ProductsPage() {
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [stockStatus, setStockStatus] = useState<StockFilter>('all');
  const [page, setPage] = useState(1);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [riskCounts, setRiskCounts] = useState<Partial<Record<RiskLevel, number>> | null>(null);
  const [riskById, setRiskById] = useState<Record<string, StockRisk>>({});
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [riskDetailsLoading, setRiskDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryWarning, setCategoryWarning] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [stockWarning, setStockWarning] = useState<string | null>(null);
  const [riskWarning, setRiskWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const beginReload = useCallback(() => {
    setLoading(true);
    setSummaryLoading(true);
    setReloadToken((token) => token + 1);
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    catalogApi.listCategories().then((value) => {
      if (!cancelled) {
        setCategories(value);
        setCategoryWarning(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setCategories([]);
        setCategoryWarning(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setSummaryLoading(true);

      const [overviewResult, riskResult] = await Promise.all([
        safeRequest(analyticsApi.overview()),
        safeRequest(intelligenceApi.list({ isActive: 'true', page: 1, limit: 1 })),
      ]);

      if (cancelled) return;
      setOverview(overviewResult.value);
      setRiskCounts(riskResult.value?.riskCounts ?? null);
      const failures: string[] = [];
      if (overviewResult.error) failures.push('Product totals and stock summary are unavailable.');
      if (riskResult.error) failures.push('Stock-risk count is unavailable.');
      setSummaryError(failures.length ? failures.join(' ') : null);

      if (!cancelled) setSummaryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setError(null);
      setStockWarning(null);

      const productQuery: ProductQuery = {
        ...(appliedSearch ? { search: appliedSearch } : {}),
        ...(categoryId ? { categoryId } : {}),
        isActive: status,
        page,
        limit: PAGE_SIZE,
      };
      const inventoryQuery = {
        ...productQuery,
        stockStatus,
      };

      const catalogPromise = stockStatus === 'all'
        ? safeRequest(catalogApi.listProducts(productQuery))
        : Promise.resolve(null);

      const [catalogResult, inventoryResult] = await Promise.all([
        catalogPromise,
        safeRequest(inventoryApi.list(inventoryQuery)),
      ]);

      /*
       * `try/finally` replaces the promise chain's `.finally()`. The early
       * returns below must still clear the loading flag — in the chain they
       * fell through to `.finally`, and a bare `return` out of an async
       * function would otherwise skip it and strand the page in a spinner.
       */
      try {
        if (cancelled) return;

        if (stockStatus === 'all') {
          if (!catalogResult?.value) {
            setRows(null);
            setMeta(null);
            setError(displayError(catalogResult?.error, 'Could not load products.'));
            return;
          }

          const stockMap = new Map(
            (inventoryResult.value?.items ?? []).map((item) => [item.id, item]),
          );
          setRows(catalogResult.value.items.map((product) => ({
            id: product.id,
            product,
            inventory: stockMap.get(product.id) ?? null,
          })));
          setMeta(catalogResult.value.meta);
          if (inventoryResult.error) {
            setStockWarning('Product records loaded, but current stock quantities are unavailable.');
          }
          return;
        }

        if (!inventoryResult.value) {
          setRows(null);
          setMeta(null);
          setError(displayError(inventoryResult.error, 'Could not load products for that stock filter.'));
          return;
        }

        const detailResults = await Promise.allSettled(
          inventoryResult.value.items.map(async (inventory) => ({
            id: inventory.id,
            inventory,
            product: await catalogApi.getProduct(inventory.id),
          })),
        );
        if (cancelled) return;

        const loadedRows: ProductRow[] = [];
        let unavailableProducts = 0;
        detailResults.forEach((result, index) => {
          if (result.status === 'fulfilled') loadedRows.push(result.value);
          else {
            unavailableProducts += 1;
            const inventory = inventoryResult.value!.items[index];
            loadedRows.push({ id: inventory.id, inventory, product: null });
          }
        });
        setRows(loadedRows);
        setMeta(inventoryResult.value.meta);
        if (unavailableProducts > 0) {
          setStockWarning('Some product details could not be loaded; their price and edit action are unavailable.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [appliedSearch, categoryId, status, stockStatus, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    const rowsToAssess = (rows ?? []).filter((row) => {
      const isActive = row.product?.isActive ?? row.inventory?.isActive ?? false;
      return isActive && (row.inventory?.currentStock ?? 0) > 0;
    });

    void (async () => {
      /*
       * These three resets run on both branches, including the "nothing to
       * assess" early return below, so they stay ahead of it inside the async
       * continuation rather than in the effect body.
       */
      setRiskById({});
      setRiskWarning(false);
      setRiskDetailsLoading(rowsToAssess.length > 0);

      if (rowsToAssess.length === 0) return;

      const results = await Promise.allSettled(rowsToAssess.map(async (row) => ({
        id: row.id,
        risk: await intelligenceApi.detail(row.id),
      })));
      if (cancelled) return;

      const next: Record<string, StockRisk> = {};
      let failed = false;
      results.forEach((result) => {
        if (result.status === 'fulfilled') next[result.value.id] = result.value.risk;
        else failed = true;
      });
      setRiskById(next);
      setRiskWarning(failed);

      if (!cancelled) setRiskDetailsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [rows]);

  function applyFilters() {
    const nextSearch = search.trim();
    if (nextSearch === appliedSearch && page === 1) {
      beginReload();
      return;
    }
    setAppliedSearch(nextSearch);
    setPage(1);
    setLoading(true);
  }

  function clearFilters() {
    const queryWillChange = appliedSearch !== '' || categoryId !== '' || status !== 'all' || stockStatus !== 'all' || page !== 1;
    setSearch('');
    setAppliedSearch('');
    setCategoryId('');
    setStatus('all');
    setStockStatus('all');
    setPage(1);
    if (queryWillChange) setLoading(true);
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

  function changeStockStatus(value: string) {
    setStockStatus(value as StockFilter);
    setPage(1);
    setLoading(true);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
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
      const input = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        ...(description ? { description } : {}),
        categoryId: form.categoryId === '' ? null : form.categoryId,
        unit: form.unit.trim(),
        costPrice: form.costPrice.trim(),
        sellingPrice: form.sellingPrice.trim(),
        isActive: form.isActive,
      };

      if (editing) {
        await catalogApi.updateProduct(editing.id, input);
        setNotice('Product updated.');
      } else {
        await catalogApi.createProduct(input);
        setNotice('Product created.');
      }

      closeDialog();
      beginReload();
    } catch (cause) {
      setFormError(displayError(cause, 'Could not save the product.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRetire(product: Product) {
    if (!window.confirm(`Retire "${product.name}"? It will remain in the catalogue as inactive.`)) return;
    setError(null);
    setNotice(null);
    try {
      await catalogApi.deactivateProduct(product.id);
      setNotice(`Retired "${product.name}".`);
      beginReload();
    } catch (cause) {
      setError(displayError(cause, 'Could not retire the product.'));
    }
  }

  const hasFilters = appliedSearch !== '' || search.trim() !== '' || categoryId !== '' || status !== 'all' || stockStatus !== 'all';
  const totalPages = meta?.totalPages ?? 1;
  const needsAttention = riskCounts === null
    ? null
    : (riskCounts.OUT_OF_STOCK ?? 0) + (riskCounts.CRITICAL ?? 0) + (riskCounts.LOW ?? 0);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 sm:space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-emerald-300 uppercase">Catalogue management</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Products</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Manage your product catalogue, pricing, and stock details.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/app/categories" className={secondaryButtonClass}>Manage categories</Link>
          <button type="button" onClick={openCreate} className={primaryButtonClass}>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4v12M4 10h12" /></svg>
            Add product
          </button>
        </div>
      </header>

      {error ? <ErrorBanner message={error} darkSurface /> : null}
      {notice ? <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-200">{notice}</p> : null}
      {categoryWarning ? <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-sm text-amber-100">Categories could not be loaded. Product search and the other filters are still available.</p> : null}
      {summaryError ? <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-sm text-amber-100">{summaryError}</p> : null}
      {stockWarning ? <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-sm text-amber-100">{stockWarning}</p> : null}
      {riskWarning ? <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-sm text-amber-100">Some low-stock classifications could not be loaded. Stock quantities remain available.</p> : null}

      <section aria-label="Product summary" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total products" value={overview ? formatCount(overview.products.totalProducts) : '—'} detail={summaryLoading && !overview ? 'Loading catalogue totals' : overview ? 'Across your catalogue' : 'Catalogue totals unavailable'} icon="products" />
        <MetricCard label="Active products" value={overview ? formatCount(overview.products.activeProducts) : '—'} detail={overview ? 'Marked active in the catalogue' : 'Active product count unavailable'} icon="active" />
        <MetricCard label="Products in stock" value={overview ? formatCount(overview.inventory.productsWithStock) : '—'} detail={overview ? 'Current inventory snapshot' : 'Inventory summary unavailable'} icon="stock" />
        <MetricCard label="Needs attention" value={needsAttention === null ? '—' : formatCount(needsAttention)} detail={needsAttention === null ? summaryLoading ? 'Loading stock-risk count' : 'Stock-risk count unavailable' : 'Out of stock, critical, or low stock'} icon="attention" />
      </section>

      <section aria-label="Product filters" className="rounded-2xl border border-slate-800/90 bg-[#101a2a] p-4 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)] sm:p-5">
        <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1.4fr)_minmax(140px,1fr)_minmax(135px,0.9fr)_minmax(145px,1fr)_auto] xl:items-end">
          <Field label="Search name or SKU" value={search} onChange={setSearch} required={false} maxLength={200} placeholder="e.g. Arabica Beans or SKU-1042" darkSurface />
          <ProductSelect label="Category" value={categoryId} onChange={changeCategory} options={[
            { value: '', label: 'All categories' },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]} />
          <ProductSelect label="Product status" value={status} onChange={changeStatus} options={[
            { value: 'all', label: 'All statuses' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ]} />
          <ProductSelect label="Stock status" value={stockStatus} onChange={changeStockStatus} options={[
            { value: 'all', label: 'All stock levels' },
            { value: 'in_stock', label: 'In stock' },
            { value: 'out_of_stock', label: 'Out of stock' },
            { value: 'no_movements', label: 'No movements yet' },
          ]} />
          <div className="flex items-end gap-2">
            <button type="submit" className={primaryButtonClass}>Search</button>
            {hasFilters ? <button type="button" onClick={clearFilters} className={secondaryButtonClass}>Clear</button> : null}
          </div>
        </form>
        <p className="mt-3 text-[11px] leading-5 text-slate-600">Stock quantities come from the inventory ledger. Low-stock labels use the current server stock-risk assessment.</p>
      </section>

      <section aria-label="Products list" className="min-w-0 overflow-hidden rounded-2xl border border-slate-800/90 bg-[#101a2a] shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 sm:text-base">Product catalogue</h2>
            <p className="mt-1 text-xs text-slate-500">Pricing and stock are shown from their respective workspace records.</p>
          </div>
          <div className="flex items-center gap-3">
            {meta ? <span className="text-xs text-slate-500">{formatCount(meta.total)} products</span> : null}
            {riskDetailsLoading ? <span role="status" className="hidden text-[11px] text-slate-500 sm:inline">Updating stock assessments…</span> : null}
            <button type="button" onClick={beginReload} disabled={loading} className={secondaryButtonClass}>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 7A6.8 6.8 0 0 0 4 5.4L3 6.5M3 3.5v3h3M3.5 13A6.8 6.8 0 0 0 16 14.6l1-1.1m0 3v-3h-3" /></svg>
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-3 py-14 text-sm text-slate-400">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400 motion-reduce:animate-none" />
            Loading products…
          </div>
        ) : rows === null ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-200">Products could not be loaded.</p>
            <button type="button" onClick={beginReload} className={'mt-4 ' + secondaryButtonClass}>Try again</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM12 12v9M4 7.5 12 12l8-4.5" /></svg>
            </span>
            <h3 className="mt-4 text-sm font-semibold text-slate-100">{hasFilters ? 'No products match these filters' : 'Your catalogue is ready to begin'}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{hasFilters ? 'Adjust your search or filters to see more products.' : 'Add your first product to start organizing prices and stock details.'}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {hasFilters ? <button type="button" onClick={clearFilters} className={secondaryButtonClass}>Clear filters</button> : null}
              <button type="button" onClick={openCreate} className={primaryButtonClass}>Add product</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 sm:p-4 lg:hidden">
              {rows.map((row) => {
                const name = row.product?.name ?? row.inventory?.name ?? 'Product details unavailable';
                const sku = row.product?.sku ?? row.inventory?.sku ?? '—';
                const category = row.product?.categoryName ?? row.inventory?.category?.name ?? 'Uncategorised';
                const isActive = row.product?.isActive ?? row.inventory?.isActive ?? false;
                const stockState = statusForStock(row.inventory, riskById[row.id], stockStatus);
                return (
                  <article key={row.id} className="rounded-xl border border-slate-800 bg-[#0c1523] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={'/app/inventory/' + row.id} className="break-words text-sm font-semibold text-slate-100 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{name}</Link>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">{sku}</p>
                      </div>
                      <Badge tone={isActive ? 'green' : 'slate'}>{isActive ? 'Active' : 'Inactive'}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-800/80 pt-3">
                      <div><p className="text-[10px] tracking-wide text-slate-600 uppercase">Category</p><p className="mt-1 truncate text-xs text-slate-300">{category}</p></div>
                      <div><p className="text-[10px] tracking-wide text-slate-600 uppercase">Selling price</p><p className="mt-1 text-xs tabular-nums text-slate-300">{row.product ? formatMoney(row.product.sellingPrice) : '—'}</p></div>
                      <div><p className="text-[10px] tracking-wide text-slate-600 uppercase">On hand</p><p className="mt-1 text-xs tabular-nums text-slate-300">{row.inventory ? formatQuantity(row.inventory.currentStock) + ' ' + row.inventory.unit : '—'}</p></div>
                      <div><p className="text-[10px] tracking-wide text-slate-600 uppercase">Stock condition</p><div className="mt-1"><Badge tone={stockState.tone}>{stockState.label}</Badge></div></div>
                    </div>
                    <div className="mt-3 border-t border-slate-800/80 pt-2">
                      <ProductActions row={row} onEdit={openEdit} onRetire={(product) => void handleRetire(product)} />
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-800/80 bg-[#0c1523] text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium sm:px-6">Product</th>
                    <th scope="col" className="px-4 py-3 font-medium">Category</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Selling price</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">On hand</th>
                    <th scope="col" className="px-4 py-3 font-medium">Stock condition</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rows.map((row) => {
                    const name = row.product?.name ?? row.inventory?.name ?? 'Product details unavailable';
                    const sku = row.product?.sku ?? row.inventory?.sku ?? '—';
                    const category = row.product?.categoryName ?? row.inventory?.category?.name ?? null;
                    const isActive = row.product?.isActive ?? row.inventory?.isActive ?? false;
                    const stockState = statusForStock(row.inventory, riskById[row.id], stockStatus);
                    return (
                      <tr key={row.id} className="transition hover:bg-white/[0.02]">
                        <td className="px-5 py-3.5 sm:px-6">
                          <Link to={'/app/inventory/' + row.id} className="font-medium text-slate-200 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{name}</Link>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-600">{sku} · {row.inventory?.unit ?? row.product?.unit ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-400">{category ?? '—'}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{row.product ? formatMoney(row.product.sellingPrice) : '—'}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{row.inventory ? formatQuantity(row.inventory.currentStock) + ' ' + row.inventory.unit : '—'}</td>
                        <td className="px-4 py-3.5"><Badge tone={stockState.tone}>{stockState.label}</Badge></td>
                        <td className="px-4 py-3.5"><Badge tone={isActive ? 'green' : 'slate'}>{isActive ? 'Active' : 'Inactive'}</Badge></td>
                        <td className="px-5 py-3.5 sm:px-6"><ProductActions row={row} onEdit={openEdit} onRetire={(product) => void handleRetire(product)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 px-4 py-3 sm:px-6">
              <p className="text-xs text-slate-500">{meta ? formatCount(meta.total) + ' products' : '—'}{meta && meta.totalPages > 1 ? ' · Page ' + formatCount(meta.page) + ' of ' + formatCount(meta.totalPages) : ''}</p>
              {meta && meta.totalPages > 1 ? (
                <div className="flex gap-2">
                  <button type="button" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)} className={secondaryButtonClass}>Previous</button>
                  <button type="button" disabled={page >= totalPages || loading} onClick={() => changePage(page + 1)} className={secondaryButtonClass}>Next</button>
                </div>
              ) : null}
            </footer>
          </>
        )}
      </section>

      {creating || editing ? (
        <Modal darkSurface title={editing ? 'Edit product' : 'Add product'} onClose={saving ? () => undefined : closeDialog} footer={
          <>
            <button type="button" onClick={closeDialog} disabled={saving} className={secondaryButtonClass}>Cancel</button>
            <button type="submit" form="product-form" disabled={saving} className={primaryButtonClass}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}</button>
          </>
        }>
          <form id="product-form" onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} darkSurface />
            <Field label="SKU" value={form.sku} onChange={(sku) => setForm((current) => ({ ...current, sku }))} maxLength={100} placeholder="BOLT-M8-40" hint="Stored in uppercase and unique within your business." darkSurface />
            <Field label="Product name" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} maxLength={200} placeholder="M8 x 40mm hex bolt" darkSurface />
            <label className="block space-y-1.5 text-sm font-medium text-slate-200" htmlFor="product-description">
              Description <span className="ml-1 text-xs font-normal text-slate-500">(optional)</span>
              <textarea id="product-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} maxLength={2000} placeholder="Add useful product details" className="block w-full rounded-lg border border-slate-700/80 bg-[#0b1220] px-3 py-2 text-sm font-normal text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15" />
            </label>
            <ProductSelect label="Category" value={form.categoryId} onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))} options={[
              { value: '', label: 'No category' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Unit" value={form.unit} onChange={(unit) => setForm((current) => ({ ...current, unit }))} maxLength={30} placeholder="piece" hint="piece, box, kg…" darkSurface />
              <Field label="Cost price" type="number" value={form.costPrice} onChange={(costPrice) => setForm((current) => ({ ...current, costPrice }))} min={0} step="0.01" darkSurface />
              <Field label="Selling price" type="number" value={form.sellingPrice} onChange={(sellingPrice) => setForm((current) => ({ ...current, sellingPrice }))} min={0} step="0.01" darkSurface />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 rounded border-slate-600 bg-[#0b1220] text-emerald-400 accent-emerald-400 focus:ring-emerald-400" />
              Active product
            </label>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
