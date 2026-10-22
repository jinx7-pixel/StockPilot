/**
 * Overstock Detection page — the assessment, presented.
 *
 * **Read-only, and deliberately inert.** There is no markdown button, no
 * supplier return, no discount action, no bulk selection and no write path
 * anywhere behind it. Flagging excess stock is a measurement; deciding what to
 * do about it is a recommendation and an action, and both belong to modules
 * that do not exist yet. A button here would imply a decision this page has not
 * made.
 *
 * The server is the only classifier. Status, priority and days of cover are
 * rendered exactly as they arrive; the page never recomputes a figure, because
 * a second answer computed in the browser is how a screen starts disagreeing
 * with the assessment behind it.
 */

import { DecisionExplanationView } from '../components/DecisionExplanationView';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import { catalogApi } from '../lib/catalog';
import { overstockApi, type ConfidenceLevel, type ListMeta, type Overstock, type OverstockStatus } from '../lib/overstock';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<OverstockStatus, string> = {
  OVERSTOCK: 'Overstocked',
  NORMAL: 'Within range',
  INSUFFICIENT_DATA: 'Not enough data',
};

const STATUS_BADGE: Record<OverstockStatus, string> = {
  OVERSTOCK: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-200',
  NORMAL: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200',
  INSUFFICIENT_DATA: 'border-slate-700 bg-slate-800/70 text-slate-300',
};

const STATUS_ICON: Record<OverstockStatus, string> = {
  OVERSTOCK: '↑',
  NORMAL: '✓',
  INSUFFICIENT_DATA: '?',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'Insufficient evidence',
};

/** Ordered so the summary reads most to least actionable. */
const STATUS_ORDER: OverstockStatus[] = ['OVERSTOCK', 'NORMAL', 'INSUFFICIENT_DATA'];

function Badge({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: OverstockStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[status]}`}>
      <span aria-hidden="true" className="font-bold">{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-3">
      <p className="text-xs tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-100 tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Render an optional figure. A dash means "cannot be calculated", which is a
 * different statement from zero and is never collapsed on screen.
 */
function optional(value: string | null): string {
  return value === null ? '—' : value;
}

export function OverstockPage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'all' | 'true' | 'false'>('all');
  const [overstockStatus, setOverstockStatus] = useState<OverstockStatus | 'all'>('all');
  const [confidence, setConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [items, setItems] = useState<Overstock[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<OverstockStatus, number>> | null>(null);
  const [selected, setSelected] = useState<Overstock | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await overstockApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(categoryId ? { categoryId } : {}),
          isActive: status,
          status: overstockStatus,
          confidence,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setItems(result.items);
        setMeta(result.meta);
        setStatusCounts(result.statusCounts ?? null);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setItems(null);
        setMeta(null);
        setStatusCounts(null);
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load overstock data. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, status, overstockStatus, confidence, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result);
      } catch (cause) {
        // The category filter is a convenience; a failure here must not take
        // the whole assessment list down with it.
        if (!cancelled) {
          setCategories(null);
          setCategoriesError(
            cause instanceof ApiError ? cause.message : 'Could not load category options.',
          );
        }
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadToken((token) => token + 1);
  }, []);

  // Any filter change returns to page one: staying on page 4 of a list that just
  // shrank to one page would show an empty table.
  function handleCategory(value: string) {
    setCategoryId(value);
    setPage(1);
  }

  function handleStatus(value: string) {
    setOverstockStatus(value as OverstockStatus | 'all');
    setPage(1);
  }

  function handleConfidence(value: string) {
    setConfidence(value as ConfidenceLevel | 'all');
    setPage(1);
  }

  function handleActive(value: string) {
    setStatus(value as 'all' | 'true' | 'false');
    setPage(1);
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedSearch(searchInput.trim());
    setPage(1);
  }

  function clearFilters() {
    setSearchInput('');
    setAppliedSearch('');
    setCategoryId('');
    setStatus('all');
    setOverstockStatus('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    appliedSearch !== '' ||
    categoryId !== '' ||
    status !== 'all' ||
    overstockStatus !== 'all' ||
    confidence !== 'all';

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overstock"
        description="Identify excess inventory and understand where stock may be tied up."
        darkSurface
        actions={<SecondaryButton darkSurface disabled={loading} onClick={reload}>Refresh</SecondaryButton>}
      />

      <p className="text-sm text-slate-400">
        Overstock is assessed from historical days of cover. This page is read-only and does not recommend or change stock actions.
      </p>

      {statusCounts !== null ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">Classification summary</h2>
            <p className="mt-1 text-xs text-slate-500">
              Counts follow search, category, and product status. Classification and confidence filters only narrow the list.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {STATUS_ORDER.map((level) => (
              <Card key={level} darkSurface className="min-w-0 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs tracking-wide text-slate-400 uppercase">{STATUS_LABEL[level]}</p>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-sm font-bold ${STATUS_BADGE[level]}`} aria-hidden="true">
                    {STATUS_ICON[level]}
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-100 tabular-nums">{statusCounts[level] ?? 0}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <p role="status" className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200">
          Overstock classification totals are unavailable. Product assessments may still load below.
        </p>
      )}

      <Card darkSurface className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field
            label="Search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Name or SKU"
            required={false}
            darkSurface
          />
          <Select
            label="Category"
            value={categoryId}
            onChange={handleCategory}
            disabled={categoriesLoading || categoriesError !== null}
            hint={categoriesError ? 'Category options are unavailable until the lookup succeeds.' : undefined}
            darkSurface
            options={[
              { value: '', label: 'All categories' },
              ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <Select
            label="Status"
            value={overstockStatus}
            onChange={handleStatus}
            darkSurface
            options={[
              { value: 'all', label: 'Any status' },
              ...STATUS_ORDER.map((level) => ({ value: level, label: STATUS_LABEL[level] })),
            ]}
          />
          <Select
            label="Confidence"
            value={confidence}
            onChange={handleConfidence}
            darkSurface
            options={[
              { value: 'all', label: 'Any confidence' },
              { value: 'HIGH', label: 'High confidence' },
              { value: 'MEDIUM', label: 'Medium confidence' },
              { value: 'LOW', label: 'Low confidence' },
              { value: 'INSUFFICIENT', label: 'Insufficient evidence' },
            ]}
          />
          <Select
            label="Product status"
            value={status}
            onChange={handleActive}
            darkSurface
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex flex-wrap items-end gap-2 xl:col-span-3">
            <button
              type="submit"
              className="min-h-10 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]"
            >
              Search
            </button>
            {hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      {categoriesError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200">
          <span>Category options could not be loaded: {categoriesError}</span>
          <SecondaryButton darkSurface disabled={loading} onClick={reload}>Retry</SecondaryButton>
        </div>
      ) : null}

      {loading ? (
        <Card darkSurface className="p-8"><Spinner darkSurface label="Assessing stock cover…" /></Card>
      ) : error ? (
        <Card darkSurface className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div role="alert" className="min-w-0">
            <h2 className="font-semibold text-rose-200">Overstock assessments could not be loaded</h2>
            <p className="mt-1 break-words text-sm text-rose-300">{error}</p>
          </div>
          <SecondaryButton darkSurface onClick={reload}>Try again</SecondaryButton>
        </Card>
      ) : items === null ? (
        <Card darkSurface className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-semibold text-slate-100">Overstock data is unavailable</h2>
            <p className="mt-1 text-sm text-slate-400">The assessment list has not returned data yet.</p>
          </div>
          <SecondaryButton darkSurface onClick={reload}>Try again</SecondaryButton>
        </Card>
      ) : items.length === 0 ? (
        <Card darkSurface>
          <EmptyState
            title={hasFilters ? 'No products match these filters' : 'Nothing to assess yet'}
            description={
              hasFilters
                ? 'Try widening the search, or clear the filters to see the full catalog.'
                : 'Once you add products and record sales, each product gets a days-of-cover reading here.'
            }
            action={hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : <Link className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" to="/app/products">Go to products</Link>}
            darkSurface
          />
        </Card>
      ) : (
        <>
        <div className="space-y-3 lg:hidden">
          {items.map((item) => (
            <Card key={item.productId} darkSurface className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold text-slate-100">
                    {item.name}
                    {!item.isActive ? <span className="ml-2 text-xs font-normal text-slate-500">inactive</span> : null}
                  </h2>
                  <p className="mt-1 break-words text-xs text-slate-400">
                    {item.sku}{item.category ? ` · ${item.category.name}` : ''}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div><dt className="text-xs text-slate-400">Current stock</dt><dd className="mt-0.5 font-medium text-slate-100 tabular-nums">{item.currentStock}</dd></div>
                <div><dt className="text-xs text-slate-400">Average daily sales</dt><dd className="mt-0.5 font-medium text-slate-100 tabular-nums">{item.averageDailySales30d}</dd></div>
                <div><dt className="text-xs text-slate-400">Days of stock</dt><dd className="mt-0.5 font-semibold text-slate-100 tabular-nums">{optional(item.daysOfStock)}</dd></div>
                <div><dt className="text-xs text-slate-400">Threshold</dt><dd className="mt-0.5 font-medium text-slate-100 tabular-nums">{item.thresholdDays} days</dd></div>
                <div className="col-span-2"><dt className="text-xs text-slate-400">Confidence</dt><dd className="mt-0.5 text-slate-300">{CONFIDENCE_LABEL[item.confidence]}</dd></div>
              </dl>
              <div className="mt-4 border-t border-slate-800 pt-3">
                <SecondaryButton darkSurface onClick={() => setSelected(item)}>View details</SecondaryButton>
              </div>
            </Card>
          ))}
          <footer className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-slate-400">
            <span>{meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : '—'}{meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}</span>
            {meta && meta.totalPages > 1 ? (
              <div className="flex gap-2">
                <SecondaryButton darkSurface disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</SecondaryButton>
                <SecondaryButton darkSurface disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</SecondaryButton>
              </div>
            ) : null}
          </footer>
        </div>

        <Card darkSurface className="hidden overflow-hidden lg:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0c1523] text-xs tracking-wide text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Avg daily sales</th>
                  <th scope="col" className="px-4 py-3 text-right">Days of stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Threshold</th>
                  <th scope="col" className="px-4 py-3">Confidence</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((item) => (
                  <tr key={item.productId} className="transition-colors hover:bg-white/[0.025]">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">
                        {item.name}
                        {!item.isActive ? (
                          <span className="ml-2 text-xs text-slate-500">inactive</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-400">
                        {item.sku}
                        {item.category ? ` · ${item.category.name}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {item.currentStock}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {item.averageDailySales30d}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-100 tabular-nums">
                      {optional(item.daysOfStock)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                      {item.thresholdDays}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{CONFIDENCE_LABEL[item.confidence]}</td>
                    <td className="px-4 py-3 text-right">
                      <SecondaryButton darkSurface onClick={() => setSelected(item)}>Details</SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
            <span>
              {meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : '—'}
              {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
            </span>

            {meta && meta.totalPages > 1 ? (
              <div className="flex gap-2">
                <SecondaryButton darkSurface disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </SecondaryButton>
                <SecondaryButton darkSurface disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </SecondaryButton>
              </div>
            ) : null}
          </footer>
        </Card>
        </>
      )}

      {selected ? (
        <Modal title={selected.name} darkSurface onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={STATUS_BADGE[selected.status]}
                label={STATUS_LABEL[selected.status]}
              />
              <span className="text-sm text-slate-300">
                {CONFIDENCE_LABEL[selected.confidence]}
              </span>
            </div>

            {/* The server's own words. Not paraphrased, not re-worded. */}
            <p className="rounded-lg border border-slate-800 bg-[#0b1220] p-3 text-sm text-slate-300">
              {selected.reason}
            </p>

            <DecisionExplanationView
              explanation={selected.explanation}
              decisionLabel={STATUS_LABEL[selected.status]}
              darkSurface
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="Current stock"
                value={selected.currentStock}
                hint="sum of the inventory ledger"
              />
              <Metric
                label="Average daily sales"
                value={selected.averageDailySales30d}
                hint={`${selected.unitsSold30d} units over ${selected.analysisWindowDays} days`}
              />
              <Metric
                label="Days of stock"
                value={optional(selected.daysOfStock)}
                hint="current stock divided by the recent daily rate"
              />
              <Metric
                label="Threshold"
                value={`${selected.thresholdDays} days`}
                hint="at or above this is overstocked"
              />
            </div>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                Evidence
              </h3>
              <ul className="space-y-1 text-sm text-slate-300">
                <li>
                  Active sales days in the {selected.evidence.analysisWindowDays}-day window:{' '}
                  {selected.activeSalesDays30d}
                </li>
                <li>
                  Units sold over the wider 90-day window: {selected.evidence.unitsSold90d} across{' '}
                  {selected.evidence.activeSalesDays90d} days
                </li>
                <li>Observable history: {selected.evidence.observableHistoryDays} days</li>
                <li>
                  Required: {selected.evidence.minimumActiveSalesDays30d} active sales days and{' '}
                  {selected.evidence.minimumUnitsSold30d} units in the window
                </li>
                <li>Sufficient evidence: {selected.evidence.hasSufficientEvidence ? 'yes' : 'no'}</li>
                {selected.evidence.unmetEvidenceGates.length > 0 ? (
                  <li className="text-slate-400">
                    Not met: {selected.evidence.unmetEvidenceGates.join(', ')}
                  </li>
                ) : null}
              </ul>
            </section>

            <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-200">
              This is a measurement, not a recommendation. Nothing on this page has been marked
              down, returned, discounted or ordered.
            </p>

            <nav aria-label="Related inventory pages" className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
              <Link className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" to={`/app/inventory/${selected.productId}`}>
                Inventory history
              </Link>
              <Link className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" to="/app/demand">
                Demand Planning
              </Link>
              <Link className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" to="/app/reorder">
                Reorder
              </Link>
              <Link className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" to="/app/purchase-orders">
                Purchase Orders
              </Link>
            </nav>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
