/**
 * Stock Risk page — the risk engine's verdict, presented.
 *
 * Read-only by design. There is no "reorder" button and no bulk action: this
 * milestone produces an assessment, and acting on an assessment is deliberately
 * a separate, later decision.
 *
 * The server is the only classifier. Risk, confidence, days of stock, safety
 * stock and the reorder point are all rendered as they arrive; the page sorts by
 * the `priority` the server assigned and never derives a level of its own. A
 * client-side re-classification is exactly the kind of second opinion that
 * silently disagrees with the audit trail.
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
import {
  intelligenceApi,
  type ConfidenceLevel,
  type ListMeta,
  type RiskLevel,
  type StockRisk,
} from '../lib/intelligence';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;
const darkSecondaryButtonClass =
  'inline-flex h-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';

const RISK_LABEL: Record<RiskLevel, string> = {
  OUT_OF_STOCK: 'Out of stock',
  CRITICAL: 'Critical',
  LOW: 'Low',
  HEALTHY: 'Healthy',
  OVERSTOCK: 'Overstock',
  INSUFFICIENT_DATA: 'Not enough data',
};

const RISK_BADGE: Record<RiskLevel, string> = {
  OUT_OF_STOCK: 'bg-red-100 text-red-700',
  CRITICAL: 'bg-orange-100 text-orange-700',
  LOW: 'bg-amber-100 text-amber-700',
  OVERSTOCK: 'bg-sky-100 text-sky-700',
  HEALTHY: 'bg-emerald-100 text-emerald-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-600',
};

const RISK_BADGE_DARK: Record<RiskLevel, string> = {
  OUT_OF_STOCK: 'bg-red-400/10 text-red-200',
  CRITICAL: 'bg-orange-400/10 text-orange-200',
  LOW: 'bg-amber-400/10 text-amber-200',
  OVERSTOCK: 'bg-sky-400/10 text-sky-200',
  HEALTHY: 'bg-emerald-400/10 text-emerald-200',
  INSUFFICIENT_DATA: 'bg-slate-700/70 text-slate-300',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'Insufficient evidence',
};

/** Ordered most to least urgent; the server's `priority` matches this order. */
const RISK_ORDER: RiskLevel[] = [
  'OUT_OF_STOCK',
  'CRITICAL',
  'LOW',
  'OVERSTOCK',
  'INSUFFICIENT_DATA',
  'HEALTHY',
];

function RiskBadge({ risk, darkSurface = false }: { risk: RiskLevel; darkSurface?: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${(darkSurface ? RISK_BADGE_DARK : RISK_BADGE)[risk]}`}
    >
      {RISK_LABEL[risk]}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Render an optional decimal. A dash means "no evidence", which is a different
 * statement from zero — the two are never collapsed on screen.
 */
function optional(value: string | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

export function StockRiskPage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'all' | 'true' | 'false'>('all');
  const [risk, setRisk] = useState<RiskLevel | 'all'>('all');
  const [confidence, setConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<StockRisk[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [riskCounts, setRiskCounts] = useState<Partial<Record<RiskLevel, number>> | null>(null);
  const [selected, setSelected] = useState<StockRisk | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const query = {
    ...(appliedSearch ? { search: appliedSearch } : {}),
    ...(categoryId ? { categoryId } : {}),
    isActive: status,
    risk,
    confidence,
    page,
    limit: PAGE_SIZE,
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await intelligenceApi.list(query);
        if (cancelled) return;

        setItems(result.items);
        setMeta(result.meta);
        // A missing summary is unavailable data, not a zero-risk result. The
        // backend returns an empty object for a real zero-count summary.
        setRiskCounts(result.riskCounts ?? null);
      } catch (cause) {
        if (cancelled) return;
        setItems(null);
        setMeta(null);
        setRiskCounts(null);
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load stock risk. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch, categoryId, status, risk, confidence, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result);
      } catch {
        // The category filter is a convenience; a failure here must not take the
        // whole risk list down with it.
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

  // Any filter change returns to page one: staying on page 4 of a list that just
  // shrank to one page would show an empty table.
  function handleCategory(value: string) {
    setCategoryId(value);
    setPage(1);
  }

  function handleRisk(value: string) {
    setRisk(value as RiskLevel | 'all');
    setPage(1);
  }

  function handleConfidence(value: string) {
    setConfidence(value as ConfidenceLevel | 'all');
    setPage(1);
  }

  function handleStatus(value: string) {
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
    setRisk('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    appliedSearch !== '' ||
    categoryId !== '' ||
    status !== 'all' ||
    risk !== 'all' ||
    confidence !== 'all';

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Risk"
        description="Identify inventory risks before they affect your business."
        darkSurface
        actions={<SecondaryButton darkSurface disabled={loading} onClick={reload}>Refresh</SecondaryButton>}
      />

      {loading ? (
        <Card darkSurface className="flex min-h-32 items-center justify-center p-6">
          <Spinner darkSurface label="Assessing stock risk…" />
        </Card>
      ) : error ? (
        <Card darkSurface className="border-red-400/20 bg-red-400/[0.06] p-5">
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-red-200">Stock risk could not be loaded</h2>
              <p className="mt-1 text-sm text-red-100">{error}</p>
            </div>
            <SecondaryButton darkSurface onClick={reload}>Try again</SecondaryButton>
          </div>
        </Card>
      ) : (
        <>
      {riskCounts !== null ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">Summary</h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {RISK_ORDER.map((level) => (
              <Card darkSurface key={level} className="p-3">
                <p className="text-xs tracking-wide text-slate-400 uppercase">
                  {RISK_LABEL[level]}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-100">{riskCounts[level] ?? 0}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-200">
          Risk summary counts are unavailable.
        </p>
      )}

      <Card darkSurface className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
            darkSurface
            options={[
              { value: '', label: 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <Select
            label="Risk"
            value={risk}
            onChange={handleRisk}
            darkSurface
            options={[
              { value: 'all', label: 'All risk levels' },
              ...RISK_ORDER.map((level) => ({ value: level, label: RISK_LABEL[level] })),
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
            label="Status"
            value={status}
            onChange={handleStatus}
            darkSurface
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2 lg:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]"
            >
              Apply
            </button>
            {hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      {items === null || items.length === 0 ? (
        <Card darkSurface>
          <EmptyState
            darkSurface
            title={hasFilters ? 'No products match these filters' : 'No products to assess yet'}
            description={
              hasFilters
                ? 'Try widening the search, or clear the filters to see the full catalog.'
                : 'Once you add products and record stock movements and sales, each one is assessed here.'
            }
            action={
              hasFilters ? (
                <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link className={darkSecondaryButtonClass} to="/app/products">
                  Go to products
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <Card darkSurface className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0c1523] text-xs tracking-wide text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Risk</th>
                  <th scope="col" className="px-4 py-3 text-right">Stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Days of stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Lead time</th>
                  <th scope="col" className="px-4 py-3 text-right">Reorder point</th>
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
                      <RiskBadge risk={item.risk} darkSurface />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {item.currentStock}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {optional(item.daysOfStock)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {optional(item.effectiveLeadTimeDays)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {optional(item.reorderPoint)}
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
                <SecondaryButton darkSurface
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </SecondaryButton>
              </div>
            ) : null}
          </footer>
        </Card>
      )}

      {selected ? (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge risk={selected.risk} />
              <span className="text-sm text-slate-600">
                {CONFIDENCE_LABEL[selected.confidence]}
              </span>
            </div>

            {/* The server's own words. Not paraphrased, not re-worded. */}
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {selected.reason}
            </p>

            <DecisionExplanationView
              explanation={selected.explanation}
              decisionLabel={RISK_LABEL[selected.risk]}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="Current stock"
                value={selected.currentStock}
                hint={`${selected.unitsSold} units sold in ${selected.analysisWindowDays} days`}
              />
              <Metric
                label="Average daily sales"
                value={selected.averageDailySales}
                hint="units per day"
              />
              <Metric
                label="Days of stock"
                value={optional(selected.daysOfStock)}
                hint="current stock ÷ average daily sales"
              />
              <Metric
                label="Supplier lead time"
                value={optional(selected.effectiveLeadTimeDays, ' days')}
                hint={
                  selected.leadTimeSampleCount > 0
                    ? `median of ${selected.leadTimeSampleCount} completed order${selected.leadTimeSampleCount === 1 ? '' : 's'}`
                    : 'no completed purchase order yet'
                }
              />
              <Metric
                label="Safety stock"
                value={optional(selected.safetyStock)}
                hint={`${selected.safetyStockDays} days of cover`}
              />
              <Metric
                label="Reorder point"
                value={optional(selected.reorderPoint)}
                hint="lead time + safety stock"
              />
            </div>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Evidence
              </h3>
              <ul className="space-y-1 text-sm text-slate-600">
                <li>Sales window: {selected.evidence.salesWindowDays} days</li>
                <li>Units sold in window: {selected.evidence.unitsSold}</li>
                <li>Observable history: {selected.evidence.observableHistoryDays} days</li>
                <li>Days with a sale: {selected.evidence.activeSalesDays}</li>
                <li>
                  Completed purchase orders used: {selected.evidence.leadTimeSamples}{' '}
                  {selected.evidence.hasLeadTimeEvidence ? '' : '(no lead-time evidence)'}
                </li>
              </ul>
            </section>

            <p className="text-xs text-slate-400">
              This assessment is read-only. It does not change stock and does not place an order.
            </p>
          </div>
        </Modal>
      ) : null}
        </>
      )}
    </div>
  );
}
