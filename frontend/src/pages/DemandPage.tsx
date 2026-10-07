/**
 * Demand Intelligence page — the engine's verdict, presented.
 *
 * Strictly historical. There is no forecast number anywhere on this screen, no
 * reorder button, no purchase-order action and no bulk selection: the engine
 * describes demand that already happened, and acting on it is a separate
 * decision belonging to a later milestone.
 *
 * The server is the only classifier. Trend, variability, confidence and every
 * rate are rendered as they arrive; the page never re-derives a level of its
 * own, because a second opinion computed in the browser is exactly the kind of
 * quiet disagreement with the audit trail this architecture avoids.
 */

import { DecisionExplanationView } from '../components/DecisionExplanationView';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import { catalogApi } from '../lib/catalog';
import {
  demandApi,
  type ConfidenceLevel,
  type Demand,
  type DemandTrend,
  type DemandVariability,
  type ListMeta,
} from '../lib/demand';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

const TREND_LABEL: Record<DemandTrend, string> = {
  INCREASING: 'Increasing',
  STABLE: 'Stable',
  DECREASING: 'Decreasing',
  INSUFFICIENT_DATA: 'Not enough data',
};

const TREND_BADGE: Record<DemandTrend, string> = {
  INCREASING: 'bg-emerald-100 text-emerald-700',
  STABLE: 'bg-slate-100 text-slate-700',
  DECREASING: 'bg-amber-100 text-amber-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-500',
};

const VARIABILITY_LABEL: Record<DemandVariability, string> = {
  LOW_VARIABILITY: 'Low',
  MEDIUM_VARIABILITY: 'Medium',
  HIGH_VARIABILITY: 'High',
  INSUFFICIENT_DATA: 'Not enough data',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'Insufficient evidence',
};

const TREND_ORDER: DemandTrend[] = ['INCREASING', 'STABLE', 'DECREASING', 'INSUFFICIENT_DATA'];

function Badge({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Render an optional figure. A dash means "no evidence", which is a different
 * statement from zero and is never collapsed on screen.
 */
function optional(value: string | null): string {
  return value === null ? '—' : value;
}

export function DemandPage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'all' | 'true' | 'false'>('all');
  const [trend, setTrend] = useState<DemandTrend | 'all'>('all');
  const [variability, setVariability] = useState<DemandVariability | 'all'>('all');
  const [confidence, setConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Demand[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [trendCounts, setTrendCounts] = useState<Partial<Record<DemandTrend, number>>>({});
  const [selected, setSelected] = useState<Demand | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await demandApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(categoryId ? { categoryId } : {}),
          isActive: status,
          trend,
          variability,
          confidence,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setItems(result.data);
        setMeta(result.meta);
        setTrendCounts(result.trendCounts);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load demand data. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, status, trend, variability, confidence, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result.data);
      } catch {
        // The category filter is a convenience; a failure here must not take
        // the whole demand list down with it.
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

  function handleTrend(value: string) {
    setTrend(value as DemandTrend | 'all');
    setPage(1);
  }

  function handleVariability(value: string) {
    setVariability(value as DemandVariability | 'all');
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
    setTrend('all');
    setVariability('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    appliedSearch !== '' ||
    categoryId !== '' ||
    status !== 'all' ||
    trend !== 'all' ||
    variability !== 'all' ||
    confidence !== 'all';

  if (loading) return <Spinner label="Assessing demand…" />;

  const hasAnyCounts = TREND_ORDER.some((level) => (trendCounts[level] ?? 0) > 0);
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demand intelligence"
        description="How this product actually sold over the last 7, 30 and 90 days. Historical facts only — this page does not forecast, and it does not place orders."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}

      {hasAnyCounts ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Summary</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TREND_ORDER.map((level) => (
              <Card key={level} className="p-3">
                <p className="text-xs tracking-wide text-slate-500 uppercase">
                  {TREND_LABEL[level]}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{trendCounts[level] ?? 0}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <Card className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Name or SKU"
            required={false}
          />
          <Select
            label="Category"
            value={categoryId}
            onChange={handleCategory}
            options={[
              { value: '', label: 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <Select
            label="Trend"
            value={trend}
            onChange={handleTrend}
            options={[
              { value: 'all', label: 'Any trend' },
              ...TREND_ORDER.map((level) => ({ value: level, label: TREND_LABEL[level] })),
            ]}
          />
          <Select
            label="Variability"
            value={variability}
            onChange={handleVariability}
            options={[
              { value: 'all', label: 'Any variability' },
              { value: 'LOW_VARIABILITY', label: 'Low variability' },
              { value: 'MEDIUM_VARIABILITY', label: 'Medium variability' },
              { value: 'HIGH_VARIABILITY', label: 'High variability' },
              { value: 'INSUFFICIENT_DATA', label: 'Not enough data' },
            ]}
          />
          <Select
            label="Confidence"
            value={confidence}
            onChange={handleConfidence}
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
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2 lg:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              Apply
            </button>
            {hasFilters ? <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      {items === null || items.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? 'No products match these filters' : 'No demand data yet'}
            description={
              hasFilters
                ? 'Try widening the search, or clear the filters to see the full catalog.'
                : 'Once you record sales, each product’s historical demand behaviour appears here.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link to="/app/sales">
                  <SecondaryButton>Go to sales</SecondaryButton>
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Trend</th>
                  <th scope="col" className="px-4 py-3 text-right">7-day</th>
                  <th scope="col" className="px-4 py-3 text-right">30-day</th>
                  <th scope="col" className="px-4 py-3 text-right">90-day</th>
                  <th scope="col" className="px-4 py-3">Variability</th>
                  <th scope="col" className="px-4 py-3">Confidence</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.productId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {item.name}
                        {!item.isActive ? (
                          <span className="ml-2 text-xs text-slate-400">inactive</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.sku}
                        {item.category ? ` · ${item.category.name}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={TREND_BADGE[item.trend]} label={TREND_LABEL[item.trend]} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.averageDailySales7d}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.averageDailySales30d}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.averageDailySales90d}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {VARIABILITY_LABEL[item.variability]}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{CONFIDENCE_LABEL[item.confidence]}</td>
                    <td className="px-4 py-3 text-right">
                      <SecondaryButton onClick={() => setSelected(item)}>Details</SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              {meta ? `${meta.total} product${meta.total === 1 ? '' : 's'}` : '—'}
              {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              <span className="ml-2 text-xs text-slate-400">
                rates are units per day
              </span>
            </span>

            {meta && meta.totalPages > 1 ? (
              <div className="flex gap-2">
                <SecondaryButton disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </SecondaryButton>
                <SecondaryButton disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
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
              <Badge className={TREND_BADGE[selected.trend]} label={TREND_LABEL[selected.trend]} />
              <span className="text-sm text-slate-600">
                {VARIABILITY_LABEL[selected.variability]} variability ·{' '}
                {CONFIDENCE_LABEL[selected.confidence]}
              </span>
            </div>

            {/* The server's own words. Not paraphrased, not re-worded. */}
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {selected.reason}
            </p>

            <DecisionExplanationView
              explanation={selected.explanation}
              decisionLabel={TREND_LABEL[selected.trend]}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="7-day rate"
                value={selected.averageDailySales7d}
                hint={`${selected.unitsSold7d} units over ${selected.activeSalesDays7d} active day(s)`}
              />
              <Metric
                label="30-day rate"
                value={selected.averageDailySales30d}
                hint={`${selected.unitsSold30d} units over ${selected.activeSalesDays30d} active day(s)`}
              />
              <Metric
                label="90-day rate"
                value={selected.averageDailySales90d}
                hint={`${selected.unitsSold90d} units over ${selected.activeSalesDays90d} active day(s)`}
              />
              <Metric
                label="Change vs baseline"
                value={optional(selected.trendChangePercent)}
                hint={
                  selected.trendChangePercent === null
                    ? 'no meaningful comparison'
                    : '7-day rate against the 30-day rate'
                }
              />
              <Metric
                label="Variability"
                value={optional(selected.coefficientOfVariation)}
                hint="standard deviation over mean"
              />
              <Metric
                label="Total units sold"
                value={selected.evidence.totalUnitsSold}
                hint={`across the ${selected.evidence.salesWindowDays}-day window`}
              />
            </div>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Evidence
              </h3>
              <ul className="space-y-1 text-sm text-slate-600">
                <li>Sales window: {selected.evidence.salesWindowDays} days</li>
                <li>Active sales days in the 30-day window: {selected.evidence.activeSalesDays}</li>
                <li>Days with a sale in the whole window: {selected.evidence.demandObservationDays}</li>
                <li>Consistency ratio: {selected.evidence.consistencyRatio}</li>
                <li>Sufficient evidence: {selected.evidence.hasSufficientEvidence ? 'yes' : 'no'}</li>
              </ul>
            </section>

            <p className="text-xs text-slate-400">
              This assessment is historical and read-only. It does not forecast future demand, change
              stock, or place an order.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
