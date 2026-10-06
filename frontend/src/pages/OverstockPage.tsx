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
import { overstockApi, type ConfidenceLevel, type ListMeta, type Overstock, type OverstockStatus } from '../lib/overstock';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<OverstockStatus, string> = {
  OVERSTOCK: 'Overstocked',
  NORMAL: 'Within range',
  INSUFFICIENT_DATA: 'Not enough data',
};

const STATUS_BADGE: Record<OverstockStatus, string> = {
  OVERSTOCK: 'bg-violet-100 text-violet-700',
  NORMAL: 'bg-emerald-100 text-emerald-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-500',
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

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Overstock[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<OverstockStatus, number>>>({});
  const [selected, setSelected] = useState<Overstock | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
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

        setItems(result.data);
        setMeta(result.meta);
        setStatusCounts(result.statusCounts);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
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
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result.data);
      } catch {
        // The category filter is a convenience; a failure here must not take
        // the whole assessment list down with it.
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

  if (loading) return <Spinner label="Assessing stock cover…" />;

  const hasAnyCounts = STATUS_ORDER.some((level) => (statusCounts[level] ?? 0) > 0);
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overstock"
        description="Products carrying more stock than their own recent demand justifies, measured as days of cover. Read-only: this page flags excess, it does not act on it."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}

      {hasAnyCounts ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Summary</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {STATUS_ORDER.map((level) => (
              <Card key={level} className="p-3">
                <p className="text-xs tracking-wide text-slate-500 uppercase">
                  {STATUS_LABEL[level]}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{statusCounts[level] ?? 0}</p>
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
            label="Status"
            value={overstockStatus}
            onChange={handleStatus}
            options={[
              { value: 'all', label: 'Any status' },
              ...STATUS_ORDER.map((level) => ({ value: level, label: STATUS_LABEL[level] })),
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
            label="Product status"
            value={status}
            onChange={handleActive}
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
            title={hasFilters ? 'No products match these filters' : 'Nothing to assess yet'}
            description={
              hasFilters
                ? 'Try widening the search, or clear the filters to see the full catalog.'
                : 'Once you add products and record sales, each product gets a days-of-cover reading here.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link to="/app/products">
                  <SecondaryButton>Go to products</SecondaryButton>
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
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Avg daily sales</th>
                  <th scope="col" className="px-4 py-3 text-right">Days of stock</th>
                  <th scope="col" className="px-4 py-3 text-right">Threshold</th>
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
                      <Badge
                        className={STATUS_BADGE[item.status]}
                        label={STATUS_LABEL[item.status]}
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.currentStock}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.averageDailySales30d}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {optional(item.daysOfStock)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                      {item.thresholdDays}
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
              <Badge
                className={STATUS_BADGE[selected.status]}
                label={STATUS_LABEL[selected.status]}
              />
              <span className="text-sm text-slate-600">
                {CONFIDENCE_LABEL[selected.confidence]}
              </span>
            </div>

            {/* The server's own words. Not paraphrased, not re-worded. */}
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {selected.reason}
            </p>

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
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Evidence
              </h3>
              <ul className="space-y-1 text-sm text-slate-600">
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
                  <li className="text-slate-500">
                    Not met: {selected.evidence.unmetEvidenceGates.join(', ')}
                  </li>
                ) : null}
              </ul>
            </section>

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              This is a measurement, not a recommendation. Nothing on this page has been marked
              down, returned, discounted or ordered.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}