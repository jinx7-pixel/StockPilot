/**
 * Supplier Intelligence page — the measurements, presented.
 *
 * **Read-only, and deliberately non-judgemental.** There is no supplier score,
 * no ranking, no "good" or "bad" label, and no button to create a purchase
 * order, replace a supplier or change anything at all. A long lead time is a
 * fact with several possible causes, and only someone with context this system
 * does not hold can say which; a page that sorted on it would be making that
 * call on their behalf.
 *
 * The server is the only classifier. Median, percentile, variability, stability
 * and confidence are rendered exactly as they arrive; the page never recomputes
 * a figure, because a second answer computed in the browser is how a screen
 * starts disagreeing with the assessment behind it.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

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
import { ApiError } from '../lib/request';
import {
  supplierIntelligenceApi,
  type ConfidenceLevel,
  type ListMeta,
  type Supplier,
  type SupplierStability,
} from '../lib/supplierIntelligence';

const PAGE_SIZE = 20;

const STABILITY_LABEL: Record<SupplierStability, string> = {
  STABLE: 'Consistent',
  VARIABLE: 'Variable',
  INSUFFICIENT_DATA: 'Not enough orders',
};

const STABILITY_BADGE: Record<SupplierStability, string> = {
  STABLE: 'bg-emerald-100 text-emerald-700',
  VARIABLE: 'bg-amber-100 text-amber-700',
  INSUFFICIENT_DATA: 'bg-slate-100 text-slate-500',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'No completed orders',
};

const STABILITY_ORDER: SupplierStability[] = ['STABLE', 'VARIABLE', 'INSUFFICIENT_DATA'];

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
 * Render an optional figure. A dash means "not measured", which is a different
 * statement from zero and is never collapsed on screen.
 */
function optional(value: string | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

function formatDate(instant: string): string {
  return new Date(instant).toISOString().slice(0, 10);
}

export function SupplierIntelligencePage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState<'all' | 'true' | 'false'>('all');
  const [stability, setStability] = useState<SupplierStability | 'all'>('all');
  const [confidence, setConfidence] = useState<ConfidenceLevel | 'all'>('all');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Supplier[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [stabilityCounts, setStabilityCounts] = useState<
    Partial<Record<SupplierStability, number>>
  >({});
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await supplierIntelligenceApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          isActive: activeStatus,
          stability,
          confidence,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setItems(result.data);
        setMeta(result.meta);
        setStabilityCounts(result.stabilityCounts);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load supplier data. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, activeStatus, stability, confidence, page, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  // Opening the detail view fetches the individual orders behind the figures,
  // so a reader can check the median and the spread by hand.
  async function openDetail(supplierId: string) {
    setDetailLoading(true);
    try {
      const result = await supplierIntelligenceApi.detail(supplierId);
      setSelected(result.data);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Could not load supplier detail. Please try again.',
      );
    } finally {
      setDetailLoading(false);
    }
  }

  // Any filter change returns to page one: staying on page 4 of a list that just
  // shrank to one page would show an empty table.
  function handleStability(value: string) {
    setStability(value as SupplierStability | 'all');
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
    setActiveStatus('all');
    setStability('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    appliedSearch !== '' || activeStatus !== 'all' || stability !== 'all' || confidence !== 'all';

  if (loading) return <Spinner label="Measuring supplier performance…" />;

  const hasAnyCounts = STABILITY_ORDER.some((level) => (stabilityCounts[level] ?? 0) > 0);
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Intelligence"
        description="How suppliers have actually delivered: measured elapsed time on completed purchase orders, and how consistent it has been. Read-only — this page measures, it does not judge or act."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}

      {hasAnyCounts ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Summary</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {STABILITY_ORDER.map((level) => (
              <Card key={level} className="p-3">
                <p className="text-xs tracking-wide text-slate-500 uppercase">
                  {STABILITY_LABEL[level]}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{stabilityCounts[level] ?? 0}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <Card className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Search"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Supplier name"
            required={false}
          />
          <Select
            label="Stability"
            value={stability}
            onChange={handleStability}
            options={[
              { value: 'all', label: 'Any stability' },
              ...STABILITY_ORDER.map((level) => ({ value: level, label: STABILITY_LABEL[level] })),
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
              { value: 'INSUFFICIENT', label: 'No completed orders' },
            ]}
          />
          <Select
            label="Supplier status"
            value={activeStatus}
            onChange={handleActive}
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2 lg:col-span-4">
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
            title={hasFilters ? 'No suppliers match these filters' : 'No suppliers yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters to see every supplier.'
                : 'Once you add suppliers and complete purchase orders, their delivery performance appears here.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">Supplier</th>
                  <th scope="col" className="px-4 py-3 text-right">Completed</th>
                  <th scope="col" className="px-4 py-3 text-right">Open</th>
                  <th scope="col" className="px-4 py-3 text-right">Cancelled</th>
                  <th scope="col" className="px-4 py-3 text-right">Median</th>
                  <th scope="col" className="px-4 py-3 text-right">P90</th>
                  <th scope="col" className="px-4 py-3 text-right">Variability</th>
                  <th scope="col" className="px-4 py-3">Stability</th>
                  <th scope="col" className="px-4 py-3">Confidence</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.supplierId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {item.supplierName}
                        {!item.isActive ? (
                          <span className="ml-2 text-xs text-slate-400">inactive</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.totalUnitsReceived} of {item.totalUnitsOrdered} units received
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.completedPOCount}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.openPOCount}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {item.cancelledPOCount}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {optional(item.medianLeadTimeDays)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {optional(item.p90LeadTimeDays)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 tabular-nums">
                      {optional(item.leadTimeCV)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={STABILITY_BADGE[item.stability]}
                        label={STABILITY_LABEL[item.stability]}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{CONFIDENCE_LABEL[item.confidence]}</td>
                    <td className="px-4 py-3 text-right">
                      <SecondaryButton
                        disabled={detailLoading}
                        onClick={() => void openDetail(item.supplierId)}
                      >
                        Details
                      </SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              {meta ? `${meta.total} supplier${meta.total === 1 ? '' : 's'}` : '—'}
              {meta && meta.total > PAGE_SIZE ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              <span className="ml-2 text-xs text-slate-400">lead times in days</span>
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
        <Modal title={selected.supplierName} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={STABILITY_BADGE[selected.stability]}
                label={STABILITY_LABEL[selected.stability]}
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
                label="Median lead time"
                value={optional(selected.medianLeadTimeDays, ' days')}
                hint={`across ${selected.leadTimeSampleCount} completed order(s)`}
              />
              <Metric
                label="90th percentile"
                value={optional(selected.p90LeadTimeDays, ' days')}
                hint="the slow end of the range"
              />
              <Metric
                label="Lead-time variability"
                value={optional(selected.leadTimeCV)}
                hint={`standard deviation over mean; ${selected.evidence.stableMaxCoefficientOfVariation} or below is consistent`}
              />
              <Metric
                label="Range observed"
                value={
                  selected.evidence.minLeadTimeDays === null
                    ? '—'
                    : `${selected.evidence.minLeadTimeDays} – ${selected.evidence.maxLeadTimeDays} days`
                }
                hint="fastest to slowest completed order"
              />
              <Metric
                label="Units ordered"
                value={selected.totalUnitsOrdered}
                hint={`${selected.totalUnitsReceived} received`}
              />
              <Metric
                label="Purchase orders"
                value={`${selected.completedPOCount} / ${selected.openPOCount} / ${selected.cancelledPOCount}`}
                hint="completed / open / cancelled"
              />
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Lead-time observations
              </h3>
              {(selected.leadTimeObservations ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">
                  No completed order with both timestamps, so there is nothing to measure yet.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th scope="col" className="px-3 py-2">Order</th>
                        <th scope="col" className="px-3 py-2">Ordered</th>
                        <th scope="col" className="px-3 py-2">Received</th>
                        <th scope="col" className="px-3 py-2 text-right">Lead time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(selected.leadTimeObservations ?? []).map((observation) => (
                        <tr key={observation.purchaseOrderId}>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">
                            {observation.purchaseOrderId.slice(0, 8)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {formatDate(observation.orderedAt)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {formatDate(observation.receivedAt)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                            {observation.leadTimeDays}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Evidence
              </h3>
              <ul className="space-y-1 text-sm text-slate-600">
                <li>Completed orders used: {selected.evidence.completedPOCount}</li>
                <li>
                  Variability needs at least {selected.evidence.minimumSamplesForVariability}{' '}
                  completed orders with usable timestamps
                </li>
                {selected.evidence.hasPromisedDeliveryDate ? null : (
                  <li>
                    No promised delivery date is recorded, so on-time delivery cannot be measured.
                  </li>
                )}
              </ul>
            </section>

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              These are measurements, not a judgement. Delivery time alone does not make a supplier
              good or bad, and a cancellation is not evidence of fault.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}