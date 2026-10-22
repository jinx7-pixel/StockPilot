/**
 * Slow / Dead Stock page — the server's assessment, presented.
 *
 * This is a read-only view. It does not infer movement dates, calculate new
 * thresholds, or make changes to products or inventory.
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
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import { catalogApi } from '../lib/catalog';
import { ApiError } from '../lib/request';
import {
  slowDeadApi,
  type ConfidenceLevel,
  type ListMeta,
  type SlowDead,
  type SlowDeadStatus,
} from '../lib/slowDead';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<SlowDeadStatus, string> = {
  DEAD: 'Dead stock',
  SLOW: 'Slow stock',
  NORMAL: 'Moving normally',
  INSUFFICIENT_DATA: 'Not enough history',
};

const STATUS_BADGE: Record<SlowDeadStatus, string> = {
  DEAD: 'border-red-400/20 bg-red-400/[0.08] text-red-200',
  SLOW: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-200',
  NORMAL: 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200',
  INSUFFICIENT_DATA: 'border-slate-700 bg-slate-800/70 text-slate-300',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'Insufficient evidence',
};

/** Ordered from the most attention-worthy classification to the least. */
const STATUS_ORDER: SlowDeadStatus[] = ['DEAD', 'SLOW', 'NORMAL', 'INSUFFICIENT_DATA'];

const darkSecondaryLinkClass = 'rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';

function StatusBadge({ status }: { status: SlowDeadStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums text-slate-100">{value}</dd>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SummaryCard({
  status,
  count,
  available,
  loading,
}: {
  status: SlowDeadStatus;
  count: number | undefined;
  available: boolean;
  loading: boolean;
}) {
  const value = loading ? '…' : available ? (count ?? 0).toLocaleString() : '—';

  return (
    <Card darkSurface className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{STATUS_LABEL[status]}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-500">
        {loading ? 'Loading classification count…' : available ? 'Products in the current catalog scope' : 'Count unavailable'}
      </p>
    </Card>
  );
}

export function SlowDeadPage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [activeStatus, setActiveStatus] = useState<'all' | 'true' | 'false'>('all');
  const [status, setStatus] = useState<SlowDeadStatus | 'all'>('all');
  const [confidence, setConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [items, setItems] = useState<SlowDead[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<SlowDeadStatus, number>> | null>(null);
  const [selected, setSelected] = useState<SlowDead | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [categoriesReloadToken, setCategoriesReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    /*
     * The resets live inside the async continuation rather than in the effect
     * body, so they are queued in the same microtask as the request kick-off and
     * React batches them into a single render. Written in the effect body they
     * were a synchronous setState: React had to commit a render for the resets,
     * then a second render when the fetch settled, which is the cascading-render
     * cost the hook lint rule exists to prevent. Behaviour is identical — same
     * values cleared, same cancellation guard, same dependency list.
     */
    void (async () => {
      setLoading(true);
      setError(null);
      setItems(null);
      setMeta(null);
      setStatusCounts(null);
      setSelected(null);

      try {
        const result = await slowDeadApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(categoryId ? { categoryId } : {}),
          isActive: activeStatus,
          status,
          confidence,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setItems(result.items);
        setMeta(result.meta);
        // An absent summary is unavailable; an empty map from the API is a real
        // zero-count summary for the current catalog scope.
        setStatusCounts(result.statusCounts ?? null);
      } catch (cause) {
        if (cancelled) return;
        setItems(null);
        setMeta(null);
        setStatusCounts(null);
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not load slow or dead stock. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, activeStatus, status, confidence, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);

      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result);
      } catch (cause) {
        if (!cancelled) {
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
  }, [categoriesReloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const retryCategories = useCallback(() => {
    setCategoriesReloadToken((token) => token + 1);
  }, []);

  function handleCategory(value: string) {
    setCategoryId(value);
    setPage(1);
  }

  function handleStatus(value: string) {
    setStatus(value as SlowDeadStatus | 'all');
    setPage(1);
  }

  function handleConfidence(value: string) {
    setConfidence(value as ConfidenceLevel | 'all');
    setPage(1);
  }

  function handleActive(value: string) {
    setActiveStatus(value as 'all' | 'true' | 'false');
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
    setActiveStatus('all');
    setStatus('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    searchInput.trim() !== '' ||
    appliedSearch !== '' ||
    categoryId !== '' ||
    activeStatus !== 'all' ||
    status !== 'all' ||
    confidence !== 'all';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Slow / Dead Stock"
        description="Identify inventory that is moving slowly or has stopped moving, using available stock and sales history."
        darkSurface
        actions={<SecondaryButton darkSurface disabled={loading} onClick={reload}>Refresh</SecondaryButton>}
      />

      <section aria-labelledby="slow-dead-guide-heading" className="space-y-3">
        <div>
          <h2 id="slow-dead-guide-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            How the classifications work
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            The authenticated API applies the classification policy and returns its evidence with each product.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card darkSurface className="p-4">
            <StatusBadge status="DEAD" />
            <p className="mt-3 text-sm leading-5 text-slate-400">No units sold in the analysis window while stock is still held, after enough history is available.</p>
          </Card>
          <Card darkSurface className="p-4">
            <StatusBadge status="SLOW" />
            <p className="mt-3 text-sm leading-5 text-slate-400">Stock remains on hand, and sales occurred on no more active days than the server policy allows.</p>
          </Card>
          <Card darkSurface className="p-4">
            <StatusBadge status="NORMAL" />
            <p className="mt-3 text-sm leading-5 text-slate-400">With enough history, neither condition applies; no stock held is classified as normal.</p>
          </Card>
          <Card darkSurface className="p-4">
            <StatusBadge status="INSUFFICIENT_DATA" />
            <p className="mt-3 text-sm leading-5 text-slate-400">There is not enough observable history to draw a reliable conclusion.</p>
          </Card>
        </div>
        <p className="rounded-lg border border-slate-800 bg-[#0c1523] px-4 py-3 text-sm text-slate-400">
          This assessment uses sales history and current ledger stock. The API does not provide a last-sale date or include non-sale stock movements in this classification; open a product&apos;s stock history for the dated ledger.
        </p>
      </section>

      <section aria-labelledby="slow-dead-summary-heading" className="space-y-3">
        <div>
          <h2 id="slow-dead-summary-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Classification totals
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Counts follow the applied search, category, and product-status scope. They include every classification and confidence level.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((level) => (
            <SummaryCard
              key={level}
              status={level}
              count={statusCounts?.[level]}
              available={statusCounts !== null}
              loading={loading}
            />
          ))}
        </div>
      </section>

      <Card darkSurface className="p-4 sm:p-5">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field
            label="Search product"
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
            darkSurface
            disabled={categoriesLoading || categoriesError !== null}
            hint={
              categoriesLoading
                ? 'Loading category options…'
                : categoriesError
                  ? 'Category options are unavailable; other filters still work.'
                  : undefined
            }
            options={[
              { value: '', label: categoriesError ? 'Categories unavailable' : 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <Select
            label="Classification"
            value={status}
            onChange={handleStatus}
            darkSurface
            options={[
              { value: 'all', label: 'All classifications' },
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
            value={activeStatus}
            onChange={handleActive}
            darkSurface
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2 xl:col-span-3">
            <PrimaryButton type="submit" variant="emerald">Apply filters</PrimaryButton>
            {hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
        {categoriesError ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-300/[0.06] px-3 py-2 text-sm text-amber-200">
            <p>Categories could not be loaded: {categoriesError}</p>
            <SecondaryButton darkSurface disabled={categoriesLoading} onClick={retryCategories}>Retry categories</SecondaryButton>
          </div>
        ) : null}
      </Card>

      {loading ? (
        <Card darkSurface className="flex min-h-48 items-center justify-center p-6">
          <Spinner darkSurface label="Loading server-assessed stock classifications…" />
        </Card>
      ) : error ? (
        <Card darkSurface className="border-red-400/20 bg-red-400/[0.06] p-5">
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-red-200">Slow / dead stock could not be loaded</h2>
              <p className="mt-1 text-sm text-red-100">{error}</p>
            </div>
            <SecondaryButton darkSurface onClick={reload}>Try again</SecondaryButton>
          </div>
        </Card>
      ) : items && items.length === 0 ? (
        <Card darkSurface>
          <EmptyState
            title={hasFilters ? 'No products match these filters' : 'No products to assess yet'}
            description={
              hasFilters
                ? 'Adjust your filters or clear them to see the full catalog.'
                : 'Add products and record sales to see server-assessed slow and dead stock here.'
            }
            darkSurface
            action={
              hasFilters ? (
                <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link className={darkSecondaryLinkClass} to="/app/products">Go to products</Link>
              )
            }
          />
        </Card>
      ) : items ? (
        <Card darkSurface className="overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-4 sm:px-5">
            <h2 className="font-semibold text-slate-100">Product assessments</h2>
            <p className="mt-1 text-sm text-slate-400">
              {meta?.total.toLocaleString() ?? '—'} matching product{meta?.total === 1 ? '' : 's'}
              {meta && meta.totalPages > 1 ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
            </p>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[#0b1220] text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Classification</th>
                  <th scope="col" className="px-4 py-3 text-right">Current stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Units sold · analysis window</th>
                  <th scope="col" className="px-4 py-3 text-right">Sale days · analysis window</th>
                  <th scope="col" className="px-4 py-3 text-right">Average daily sales</th>
                  <th scope="col" className="px-4 py-3">Confidence</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Product details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((item) => (
                  <tr key={item.productId} className="align-top transition hover:bg-white/[0.025]">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-100">{item.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.sku}{item.category ? ` · ${item.category.name}` : ' · No category'}
                        {!item.isActive ? ' · Inactive' : ''}
                      </p>
                    </td>
                    <td className="max-w-sm px-4 py-4">
                      <StatusBadge status={item.status} />
                      <p className="mt-2 text-xs leading-5 text-slate-400">{item.reason}</p>
                    </td>
                    <td className="px-4 py-4 text-right font-medium tabular-nums text-slate-100">{item.currentStock}</td>
                    <td className="px-4 py-4 text-right tabular-nums text-slate-300">
                      <span className="block">{item.unitsSold90d}</span>
                      <span className="text-xs text-slate-400">{item.analysisWindowDays} days</span>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums text-slate-300">
                      <span className="block">{item.activeSalesDays90d}</span>
                      <span className="text-xs text-slate-400">{item.analysisWindowDays} days</span>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums text-slate-300">{item.averageDailySales90d}</td>
                    <td className="px-4 py-4 text-slate-400">{CONFIDENCE_LABEL[item.confidence]}</td>
                    <td className="px-4 py-4 text-right">
                      <SecondaryButton darkSurface onClick={() => setSelected(item)}>Details</SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 p-3 md:hidden">
            {items.map((item) => (
              <article key={item.productId} className="rounded-xl border border-slate-800 bg-[#0b1220] p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold text-slate-100">{item.name}</h3>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {item.sku}{item.category ? ` · ${item.category.name}` : ' · No category'}
                      {!item.isActive ? ' · Inactive' : ''}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <Metric label="Current stock" value={item.currentStock} />
                  <Metric label="Units sold" value={item.unitsSold90d} hint={`${item.analysisWindowDays}-day window`} />
                  <Metric label="Sale days" value={String(item.activeSalesDays90d)} hint={`${item.analysisWindowDays}-day window`} />
                  <Metric label="Average daily sales" value={item.averageDailySales90d} />
                </dl>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">{CONFIDENCE_LABEL[item.confidence]}</span>
                  <SecondaryButton darkSurface onClick={() => setSelected(item)}>View assessment</SecondaryButton>
                </div>
                <p className="mt-3 border-t border-slate-800 pt-3 text-sm leading-5 text-slate-400">{item.reason}</p>
              </article>
            ))}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
            <span>
              {meta ? `${meta.total.toLocaleString()} matching product${meta.total === 1 ? '' : 's'}` : 'Product count unavailable'}
              {meta && meta.totalPages > 1 ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
            </span>
            {meta && meta.totalPages > 1 ? (
              <div className="flex gap-2">
                <SecondaryButton darkSurface disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>
                  Previous
                </SecondaryButton>
                <SecondaryButton darkSurface disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>
                  Next
                </SecondaryButton>
              </div>
            ) : null}
          </footer>
        </Card>
      ) : null}

      <section aria-labelledby="slow-dead-workflows-heading" className="space-y-3">
        <div>
          <h2 id="slow-dead-workflows-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Related workflows
          </h2>
          <p className="mt-1 text-xs text-slate-400">Review stock history and the existing sales and inventory-planning tools.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={darkSecondaryLinkClass} to="/app/inventory">Inventory</Link>
          <Link className={darkSecondaryLinkClass} to="/app/sales">Sales</Link>
          <Link className={darkSecondaryLinkClass} to="/app/demand">Demand planning</Link>
          <Link className={darkSecondaryLinkClass} to="/app/analytics">Analytics</Link>
          <Link className={darkSecondaryLinkClass} to="/app/overstock">Overstock</Link>
          <Link className={darkSecondaryLinkClass} to="/app/reorder">Reorder</Link>
          <Link className={darkSecondaryLinkClass} to="/app/recommendations">Recommendations</Link>
        </div>
      </section>

      {selected ? (
        <Modal darkSurface title={selected.name} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selected.status} />
              <span className="text-sm text-slate-300">{CONFIDENCE_LABEL[selected.confidence]}</span>
              <span className="text-sm text-slate-400">{selected.sku}</span>
            </div>

            <p className="rounded-lg border border-slate-800 bg-[#0b1220] p-3 text-sm leading-6 text-slate-300">
              {selected.reason}
            </p>

            <DecisionExplanationView
              explanation={selected.explanation}
              decisionLabel={STATUS_LABEL[selected.status]}
              darkSurface
            />

            <dl className="grid gap-3 sm:grid-cols-2">
              <Metric label="Current stock" value={selected.currentStock} hint="Calculated from the inventory ledger" />
              <Metric label="Units sold" value={selected.unitsSold90d} hint={`Across the ${selected.analysisWindowDays}-day analysis window`} />
              <Metric label="Active sales days" value={String(selected.activeSalesDays90d)} hint={`Server slow-stock limit: ${selected.evidence.slowMaxActiveSalesDays} days`} />
              <Metric label="Average daily sales" value={selected.averageDailySales90d} hint="Server-calculated across the analysis window" />
            </dl>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Server evidence</h3>
              <ul className="space-y-1 text-sm text-slate-300">
                <li>Analysis window: {selected.evidence.analysisWindowDays} days</li>
                <li>Minimum observable history: {selected.evidence.minimumObservableDays} days</li>
                <li>Slow-stock limit: {selected.evidence.slowMaxActiveSalesDays} active sale days</li>
                <li>Stock currently held: {selected.evidence.holdsInventory ? 'yes' : 'no'}</li>
                <li>History sufficient for a verdict: {selected.evidence.hasSufficientHistory ? 'yes' : 'no'}</li>
                <li>Classification basis: {selected.evidence.classificationBasis}</li>
              </ul>
            </section>

            <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4" aria-label="Related product workflows">
              <Link className={darkSecondaryLinkClass} to={`/app/inventory/${encodeURIComponent(selected.productId)}`}>
                View stock history
              </Link>
              <Link className={darkSecondaryLinkClass} to="/app/demand">Demand planning</Link>
              <Link className={darkSecondaryLinkClass} to="/app/analytics">Analytics</Link>
              <Link className={darkSecondaryLinkClass} to="/app/overstock">Overstock</Link>
              <Link className={darkSecondaryLinkClass} to="/app/reorder">Reorder</Link>
              <Link className={darkSecondaryLinkClass} to="/app/recommendations">Recommendations</Link>
            </div>

            <p className="rounded-lg border border-amber-400/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-200">
              This page reports a server classification only. It does not markdown, write off, deactivate, adjust, transfer, or order stock.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
