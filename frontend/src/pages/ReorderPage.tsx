/**
 * Reorder Engine page — the assessment, presented.
 *
 * **This page recommends. It does not order.** There is no "place order" button,
 * no approval step, no bulk action and no write path anywhere behind it. That
 * omission is the point: deciding *what* should be reordered and actually
 * *reordering* it are different acts, and a screen that collapsed them would
 * make a read-only assessment look like a purchase.
 *
 * The server is the only classifier. Decision, quantity, reorder point and
 * confidence are rendered exactly as they arrive; the page never recomputes a
 * figure, because a second answer computed in the browser is precisely how a
 * screen starts disagreeing with the assessment behind it.
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
import { ApiError } from '../lib/request';
import {
  reorderApi,
  type ConfidenceLevel,
  type ListMeta,
  type Reorder,
  type ReorderDecision,
} from '../lib/reorder';

const PAGE_SIZE = 20;

const DECISION_LABEL: Record<ReorderDecision, string> = {
  REORDER: 'Reorder',
  NO_REORDER: 'No reorder needed',
  INSUFFICIENT_DATA: 'Not enough evidence',
  DATA_ERROR: 'Ledger problem',
};

const DECISION_BADGE: Record<ReorderDecision, string> = {
  REORDER: 'bg-orange-100 text-orange-700',
  NO_REORDER: 'bg-emerald-100 text-emerald-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-500',
  DATA_ERROR: 'bg-red-100 text-red-700',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'Insufficient evidence',
};

/** Ordered so the summary reads most to least actionable. */
const DECISION_ORDER: ReorderDecision[] = [
  'REORDER',
  'NO_REORDER',
  'INSUFFICIENT_DATA',
  'DATA_ERROR',
];

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

export function ReorderPage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [decision, setDecision] = useState<ReorderDecision | 'all'>('all');
  const [confidence, setConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Reorder[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [decisionCounts, setDecisionCounts] = useState<
    Partial<Record<ReorderDecision, number>>
  >({});
  const [selected, setSelected] = useState<Reorder | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await reorderApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(categoryId ? { categoryId } : {}),
          isActive: status,
          decision,
          confidence,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setItems(result.data);
        setMeta(result.meta);
        setDecisionCounts(result.decisionCounts);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load reorder data. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, status, decision, confidence, page, reloadToken]);

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

  function handleDecision(value: string) {
    setDecision(value as ReorderDecision | 'all');
    setPage(1);
  }

  function handleConfidence(value: string) {
    setConfidence(value as ConfidenceLevel | 'all');
    setPage(1);
  }

  function handleStatus(value: string) {
    setStatus(value as 'active' | 'inactive' | 'all');
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
    setStatus('active');
    setDecision('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    appliedSearch !== '' ||
    categoryId !== '' ||
    status !== 'active' ||
    decision !== 'all' ||
    confidence !== 'all';

  if (loading) return <Spinner label="Assessing reorder needs…" />;

  const hasAnyCounts = DECISION_ORDER.some((level) => (decisionCounts[level] ?? 0) > 0);
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reorder"
        description="What needs reordering, and how much — from stock on hand, what is already on order, and how fast each product sells. Recommendations only: nothing here places an order or changes stock."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}

      {hasAnyCounts ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Summary</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DECISION_ORDER.map((level) => (
              <Card key={level} className="p-3">
                <p className="text-xs tracking-wide text-slate-500 uppercase">
                  {DECISION_LABEL[level]}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{decisionCounts[level] ?? 0}</p>
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
            label="Decision"
            value={decision}
            onChange={handleDecision}
            options={[
              { value: 'all', label: 'Any decision' },
              ...DECISION_ORDER.map((level) => ({ value: level, label: DECISION_LABEL[level] })),
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
            onChange={handleStatus}
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'inactive', label: 'Inactive only' },
              { value: 'all', label: 'Active and inactive' },
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
                : 'Once you add products, record sales, and complete a purchase order, each product gets a reorder recommendation here.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link to="/app/purchase-orders">
                  <SecondaryButton>Go to purchase orders</SecondaryButton>
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
                  <th scope="col" className="px-4 py-3">Decision</th>
                  <th scope="col" className="px-4 py-3 text-right">On hand</th>
                  <th scope="col" className="px-4 py-3 text-right">On order</th>
                  <th scope="col" className="px-4 py-3 text-right">Available</th>
                  <th scope="col" className="px-4 py-3 text-right">Reorder point</th>
                  <th scope="col" className="px-4 py-3 text-right">Suggested qty</th>
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
                        className={DECISION_BADGE[item.decision]}
                        label={DECISION_LABEL[item.decision]}
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.currentStock}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.onOrderQuantity}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.netAvailable}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {optional(item.reorderPoint)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {item.reorder ? optional(item.recommendedQuantity) : '—'}
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
                className={DECISION_BADGE[selected.decision]}
                label={DECISION_LABEL[selected.decision]}
              />
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
              decisionLabel={DECISION_LABEL[selected.decision]}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="On hand"
                value={selected.currentStock}
                hint="sum of the inventory ledger"
              />
              <Metric
                label="On order"
                value={selected.onOrderQuantity}
                hint="ordered or partly received"
              />
              <Metric
                label="Available"
                value={selected.netAvailable}
                hint="on hand plus on order"
              />
              <Metric
                label="Reorder point"
                value={optional(selected.reorderPoint)}
                hint={
                  selected.effectiveLeadTimeDays === null
                    ? 'no lead-time evidence'
                    : `${selected.effectiveLeadTimeDays} day(s) of lead time plus ${selected.safetyStockDays} days of safety stock`
                }
              />
              <Metric
                label="Safety stock"
                value={optional(selected.safetyStock)}
                hint={`${selected.safetyStockDays} days of cover`}
              />
              <Metric
                label="Suggested quantity"
                value={selected.reorder ? optional(selected.recommendedQuantity) : '—'}
                hint={
                  selected.reorder
                    ? 'brings available stock up to the reorder point'
                    : 'no order is needed'
                }
              />
            </div>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Evidence
              </h3>
              <ul className="space-y-1 text-sm text-slate-600">
                <li>Units sold in the 30-day window: {selected.evidence.unitsSold30d}</li>
                <li>Days with a sale in the 30-day window: {selected.evidence.activeSalesDays30d}</li>
                <li>Completed purchase orders behind the lead time: {selected.evidence.leadTimeSamples}</li>
                <li>
                  Lead-time spread (slowest minus fastest):{' '}
                  {selected.evidence.leadTimeSpreadDays === null
                    ? 'not enough orders to compare'
                    : `${selected.evidence.leadTimeSpreadDays} days`}
                </li>
                {selected.evidence.leadTimeUnreliable ? (
                  <li className="text-amber-700">
                    Lead time is unusually long or inconsistent, which caps confidence.
                  </li>
                ) : null}
              </ul>
            </section>

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              This is a recommendation, not an order. Nothing on this page has been placed with a
              supplier, and no stock has been changed.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
