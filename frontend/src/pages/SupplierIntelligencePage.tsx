/**
 * Supplier Intelligence — purchasing history and server-measured delivery signals.
 *
 * This page is read-only. It reports returned order facts and the supplier
 * engine's measurements; it does not assign supplier scores or recommend actions.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { DecisionExplanationView } from '../components/DecisionExplanationView';
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
import { analyticsApi, type SupplierAnalytics } from '../lib/analytics';
import { ApiError } from '../lib/request';
import { formatAmount } from '../lib/purchasing';
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
  STABLE: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  VARIABLE: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
  INSUFFICIENT_DATA: 'border-slate-700 bg-slate-800 text-slate-300',
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'No completed orders',
};

const STABILITY_ORDER: SupplierStability[] = ['STABLE', 'VARIABLE', 'INSUFFICIENT_DATA'];
const darkSecondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';

function displayError(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

function formatDate(instant: string | null): string {
  if (!instant) return '—';
  const date = new Date(instant);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatCount(count: number): string {
  return new Intl.NumberFormat().format(count);
}

function Badge({ className, label }: { className: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function StabilityBadge({ stability }: { stability: SupplierStability }) {
  return <Badge className={STABILITY_BADGE[stability]} label={STABILITY_LABEL[stability]} />;
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card darkSurface className="min-w-0 p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-slate-100">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </Card>
  );
}

function DetailMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0c1523] p-3">
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</dd>
      {hint ? <p className="text-xs leading-5 text-slate-400">{hint}</p> : null}
    </div>
  );
}

function PurchaseOrderStatusSummary({ supplier }: { supplier: Supplier }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-400" aria-label="Purchase order status counts">
      <span>Received <strong className="font-semibold tabular-nums text-slate-200">{supplier.completedPOCount}</strong></span>
      <span>Open <strong className="font-semibold tabular-nums text-slate-200">{supplier.openPOCount}</strong></span>
      <span>Draft <strong className="font-semibold tabular-nums text-slate-200">{supplier.draftPOCount}</strong></span>
      <span>Cancelled <strong className="font-semibold tabular-nums text-slate-200">{supplier.cancelledPOCount}</strong></span>
    </div>
  );
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
  const [stabilityCounts, setStabilityCounts] = useState<Partial<Record<SupplierStability, number>> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listReloadToken, setListReloadToken] = useState(0);

  const [analyticsSuppliers, setAnalyticsSuppliers] = useState<SupplierAnalytics[] | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsReloadToken, setAnalyticsReloadToken] = useState(0);

  const [selected, setSelected] = useState<Supplier | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadToken, setDetailReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setListLoading(true);
      setListError(null);
      setItems(null);
      setMeta(null);
      setStabilityCounts(null);
      setSelected(null);
      setDetailError(null);

      // `try/finally` replaces the chain's `.finally()` so the loading flag is
      // still cleared on the success path, the failure path and a rethrow.
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

        setItems(result.items);
        setMeta(result.meta);
        // The service emits keys only for classifications present in the
        // scoped catalog, so an omitted key in a successful response is zero.
        // A missing summary object remains unavailable.
        setStabilityCounts(result.stabilityCounts ?? null);
      } catch (cause) {
        if (cancelled) return;
        setItems(null);
        setMeta(null);
        setStabilityCounts(null);
        setListError(displayError(cause, 'Could not load supplier intelligence.'));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, activeStatus, stability, confidence, page, listReloadToken]);

  // The analytics endpoint returns the authenticated business's supplier
  // aggregates in one request, so it can enrich the visible page without an
  // N+1 request for every supplier row.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      setAnalyticsSuppliers(null);

      try {
        const result = await analyticsApi.suppliers();
        if (!cancelled) setAnalyticsSuppliers(result);
      } catch (cause) {
        if (!cancelled) {
          setAnalyticsSuppliers(null);
          setAnalyticsError(displayError(cause, 'Could not load supplier purchasing aggregates.'));
        }
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analyticsReloadToken]);

  const selectedSupplierId = selected?.supplierId ?? null;
  useEffect(() => {
    if (!selectedSupplierId) return;

    let cancelled = false;

    void (async () => {
      setDetailLoading(true);
      setDetailError(null);

      try {
        const result = await supplierIntelligenceApi.detail(selectedSupplierId);
        if (!cancelled) setSelected(result);
      } catch (cause) {
        if (!cancelled) setDetailError(displayError(cause, 'Could not load the supplier evidence.'));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, detailReloadToken]);

  const refresh = useCallback(() => {
    setListReloadToken((token) => token + 1);
    setAnalyticsReloadToken((token) => token + 1);
  }, []);

  const retryDetail = useCallback(() => {
    setDetailLoading(true);
    setDetailReloadToken((token) => token + 1);
  }, []);

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

  function openDetail(supplier: Supplier) {
    setDetailError(null);
    setDetailLoading(true);
    setSelected(supplier);
  }

  const hasFilters = appliedSearch !== '' || activeStatus !== 'all' || stability !== 'all' || confidence !== 'all';
  const hasUnappliedSearch = searchInput.trim() !== '' && searchInput.trim() !== appliedSearch;
  const totalPages = meta?.totalPages ?? 1;
  const analyticsBySupplierId = new Map((analyticsSuppliers ?? []).map((supplier) => [supplier.supplierId, supplier]));
  const totalSupplierCount = analyticsSuppliers?.length;
  const activeSupplierCount = analyticsSuppliers?.filter((supplier) => supplier.isActive).length;
  const suppliersWithOrdersCount = analyticsSuppliers?.filter((supplier) => supplier.purchaseOrderCount > 0).length;
  const nonCancelledOrderCount = analyticsSuppliers?.reduce((sum, supplier) => sum + supplier.purchaseOrderCount, 0);
  const countsAvailable = stabilityCounts !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Intelligence"
        description="Understand supplier activity, purchasing history, and available performance signals."
        darkSurface
        actions={(
          <div className="flex flex-wrap gap-2">
            <SecondaryButton darkSurface disabled={listLoading || analyticsLoading} onClick={refresh}>Refresh</SecondaryButton>
            <Link className={darkSecondaryButtonClass} to="/app/suppliers">Manage suppliers</Link>
            <Link className={darkSecondaryButtonClass} to="/app/purchase-orders">Review purchase orders</Link>
          </div>
        )}
      />

      <section aria-labelledby="supplier-portfolio-heading" className="space-y-3">
        <div>
          <h2 id="supplier-portfolio-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-300">Supplier portfolio</h2>
          <p className="mt-1 text-xs text-slate-400">Business-wide totals from the supplier analytics API · all time.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Suppliers"
            value={analyticsLoading ? '…' : totalSupplierCount === undefined ? '—' : formatCount(totalSupplierCount)}
            detail={analyticsLoading ? 'Loading supplier totals…' : totalSupplierCount === undefined ? 'Total unavailable' : 'All active and inactive suppliers'}
          />
          <MetricCard
            label="Active suppliers"
            value={analyticsLoading ? '…' : activeSupplierCount === undefined ? '—' : formatCount(activeSupplierCount)}
            detail={analyticsLoading ? 'Loading supplier totals…' : activeSupplierCount === undefined ? 'Active total unavailable' : 'Current supplier status'}
          />
          <MetricCard
            label="Suppliers with purchase orders"
            value={analyticsLoading ? '…' : suppliersWithOrdersCount === undefined ? '—' : formatCount(suppliersWithOrdersCount)}
            detail={analyticsLoading ? 'Loading purchasing activity…' : suppliersWithOrdersCount === undefined ? 'Purchasing total unavailable' : 'At least one non-cancelled order'}
          />
          <MetricCard
            label="Non-cancelled purchase orders"
            value={analyticsLoading ? '…' : nonCancelledOrderCount === undefined ? '—' : formatCount(nonCancelledOrderCount)}
            detail={analyticsLoading ? 'Loading order totals…' : nonCancelledOrderCount === undefined ? 'Order total unavailable' : 'All time; includes drafts and open orders'}
          />
        </div>
        {analyticsError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200" role="alert">
            <p>Supplier purchasing aggregates could not be loaded: {analyticsError}</p>
            <SecondaryButton darkSurface disabled={analyticsLoading} onClick={() => setAnalyticsReloadToken((token) => token + 1)}>Retry purchasing data</SecondaryButton>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="supplier-consistency-heading" className="space-y-3">
        <div>
          <h2 id="supplier-consistency-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-300">Delivery-time consistency</h2>
          <p className="mt-1 text-xs text-slate-400">
            Counts follow the applied supplier-name search and active-status filter; they include all confidence and consistency classes.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {STABILITY_ORDER.map((level) => {
            const value = listLoading ? '…' : countsAvailable ? formatCount(stabilityCounts?.[level] ?? 0) : '—';
            const detail = listLoading ? 'Loading classification count…' : countsAvailable ? 'Suppliers in this scope' : 'Count unavailable';
            return <MetricCard key={level} label={STABILITY_LABEL[level]} value={value} detail={detail} />;
          })}
        </div>
      </section>

      <div className="rounded-lg border border-slate-800 bg-[#101a2a] px-4 py-3 text-sm leading-6 text-slate-300">
        Purchase totals are all-time aggregates. Recorded order value excludes cancelled orders but includes draft and open orders, so it is not a paid-spend total. Delivery measurements use received orders with valid timestamps; no promised delivery date is stored, so on-time or late-delivery rates are unavailable.
      </div>

      <Card darkSurface className="p-4 sm:p-5">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Search supplier name"
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Supplier name"
            required={false}
            darkSurface
          />
          <Select
            label="Delivery consistency"
            value={stability}
            onChange={handleStability}
            darkSurface
            options={[
              { value: 'all', label: 'Any consistency' },
              ...STABILITY_ORDER.map((level) => ({ value: level, label: STABILITY_LABEL[level] })),
            ]}
          />
          <Select
            label="Evidence confidence"
            value={confidence}
            onChange={handleConfidence}
            darkSurface
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
            darkSurface
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />
          <div className="flex items-end gap-2 xl:col-span-4">
            <PrimaryButton darkSurface type="submit">Apply filters</PrimaryButton>
            {hasFilters || hasUnappliedSearch ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      {listLoading ? (
        <Card darkSurface className="flex min-h-48 items-center justify-center p-6">
          <Spinner darkSurface label="Loading supplier performance and purchasing history…" />
        </Card>
      ) : listError ? (
        <Card darkSurface className="border-red-400/25 bg-red-400/[0.07] p-5">
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-red-200">Supplier delivery measurements could not be loaded</h2>
              <p className="mt-1 text-sm text-red-200/90">{listError}</p>
            </div>
            <SecondaryButton darkSurface onClick={() => setListReloadToken((token) => token + 1)}>Try again</SecondaryButton>
          </div>
        </Card>
      ) : items && items.length === 0 ? (
        <Card darkSurface>
          <EmptyState
            darkSurface
            title={hasFilters ? 'No suppliers match these filters' : 'No suppliers yet'}
            description={
              hasFilters
                ? 'Try a different name or filter, or clear the filters to see every supplier.'
                : 'Add suppliers and record purchase orders to see their purchasing history and delivery measurements here.'
            }
            action={hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : undefined}
          />
        </Card>
      ) : items ? (
        <Card darkSurface className="overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-4 sm:px-5">
            <h2 className="font-semibold text-slate-100">Supplier purchasing and delivery history</h2>
            <p className="mt-1 text-sm text-slate-400">
              {meta ? `${formatCount(meta.total)} matching supplier${meta.total === 1 ? '' : 's'}` : 'Supplier count unavailable'}
              {meta && meta.totalPages > 1 ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
            </p>
          </div>

          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[1380px] text-left text-sm">
              <thead className="bg-[#0c1523] text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Supplier</th>
                  <th scope="col" className="px-4 py-3">PO status summary</th>
                  <th scope="col" className="px-4 py-3 text-right">Recorded value</th>
                  <th scope="col" className="px-4 py-3">Latest order / receipt</th>
                  <th scope="col" className="px-4 py-3 text-right">Median / P90 lead time</th>
                  <th scope="col" className="px-4 py-3 text-right">Lead-time CV</th>
                  <th scope="col" className="px-4 py-3">Consistency</th>
                  <th scope="col" className="px-4 py-3">Confidence</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Supplier details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((supplier) => {
                  const aggregate = analyticsBySupplierId.get(supplier.supplierId);
                  return (
                    <tr key={supplier.supplierId} className="align-top transition hover:bg-white/[0.025]">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-100">{supplier.supplierName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span>{supplier.isActive ? 'Active supplier' : 'Inactive supplier'}</span>
                          {aggregate ? <span>· {formatCount(aggregate.productCount)} products in non-cancelled orders</span> : null}
                        </div>
                      </td>
                      <td className="min-w-52 px-4 py-4"><PurchaseOrderStatusSummary supplier={supplier} /></td>
                      <td className="px-4 py-4 text-right tabular-nums text-slate-200">
                        {aggregate ? formatAmount(aggregate.purchaseValue) : '—'}
                        <span className="mt-1 block text-xs text-slate-400">{aggregate ? 'all time · excl. cancelled' : 'purchasing data unavailable'}</span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300">
                        <span className="block">Order: {formatDate(aggregate?.lastOrderAt ?? null)}</span>
                        <span className="mt-1 block text-xs text-slate-400">Received: {formatDate(aggregate?.lastReceivedAt ?? null)}</span>
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums text-slate-200">
                        <span className="block">{supplier.medianLeadTimeDays === null ? '—' : `${supplier.medianLeadTimeDays} d`}</span>
                        <span className="mt-1 block text-xs text-slate-400">P90 {supplier.p90LeadTimeDays === null ? '—' : `${supplier.p90LeadTimeDays} d`}</span>
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums text-slate-300">{supplier.leadTimeCV ?? '—'}</td>
                      <td className="px-4 py-4"><StabilityBadge stability={supplier.stability} /></td>
                      <td className="px-4 py-4 text-slate-300">{CONFIDENCE_LABEL[supplier.confidence]}</td>
                      <td className="px-4 py-4 text-right">
                        <SecondaryButton darkSurface disabled={detailLoading} onClick={() => openDetail(supplier)}>
                          {detailLoading && selected?.supplierId === supplier.supplierId ? 'Loading…' : 'Details'}
                        </SecondaryButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 p-3 xl:hidden">
            {items.map((supplier) => {
              const aggregate = analyticsBySupplierId.get(supplier.supplierId);
              return (
                <article key={supplier.supplierId} className="rounded-xl border border-slate-800 bg-[#0c1523] p-4 shadow-sm shadow-black/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-slate-100">{supplier.supplierName}</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {supplier.isActive ? 'Active supplier' : 'Inactive supplier'}
                        {aggregate ? ` · ${formatCount(aggregate.productCount)} products in non-cancelled orders` : ''}
                      </p>
                    </div>
                    <StabilityBadge stability={supplier.stability} />
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-800 bg-[#101a2a] p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Purchase order statuses</p>
                    <PurchaseOrderStatusSummary supplier={supplier} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <DetailMetric label="Recorded value" value={aggregate ? formatAmount(aggregate.purchaseValue) : '—'} hint="All-time; excludes cancelled orders" />
                    <DetailMetric label="Median lead time" value={supplier.medianLeadTimeDays === null ? '—' : `${supplier.medianLeadTimeDays} days`} hint={`${supplier.leadTimeSampleCount} completed orders with usable timestamps`} />
                    <DetailMetric label="P90 lead time" value={supplier.p90LeadTimeDays === null ? '—' : `${supplier.p90LeadTimeDays} days`} />
                    <DetailMetric label="Lead-time CV" value={supplier.leadTimeCV ?? '—'} hint="A spread measure, not a rating" />
                    <DetailMetric label="Latest placed order" value={formatDate(aggregate?.lastOrderAt ?? null)} />
                    <DetailMetric label="Latest receipt" value={formatDate(aggregate?.lastReceivedAt ?? null)} />
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                    <span className="text-xs text-slate-400">{CONFIDENCE_LABEL[supplier.confidence]}</span>
                    <SecondaryButton darkSurface disabled={detailLoading} onClick={() => openDetail(supplier)}>
                      {detailLoading && selected?.supplierId === supplier.supplierId ? 'Loading…' : 'View evidence'}
                    </SecondaryButton>
                  </div>
                </article>
              );
            })}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
            <span>
              {meta ? `${formatCount(meta.total)} matching supplier${meta.total === 1 ? '' : 's'}` : 'Supplier count unavailable'}
              {meta && meta.totalPages > 1 ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
              <span className="ml-2 text-xs text-slate-500">lead-time values are in days</span>
            </span>
            {meta && meta.totalPages > 1 ? (
              <div className="flex gap-2">
                <SecondaryButton darkSurface disabled={listLoading || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</SecondaryButton>
                <SecondaryButton darkSurface disabled={listLoading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</SecondaryButton>
              </div>
            ) : null}
          </footer>
        </Card>
      ) : null}

      <section aria-labelledby="supplier-workflows-heading" className="space-y-3">
        <div>
          <h2 id="supplier-workflows-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-300">Related workflows</h2>
          <p className="mt-1 text-xs text-slate-400">Continue with the existing supplier and purchasing screens.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={darkSecondaryButtonClass} to="/app/suppliers">Supplier management</Link>
          <Link className={darkSecondaryButtonClass} to="/app/purchase-orders">Purchase orders and receiving</Link>
          <Link className={darkSecondaryButtonClass} to="/app/actions">Actions</Link>
          <Link className={darkSecondaryButtonClass} to="/app/reorder">Reorder</Link>
        </div>
      </section>

      {selected ? (
        <Modal darkSurface title={selected.supplierName} onClose={() => setSelected(null)}>
          {detailLoading ? (
            <Spinner darkSurface label="Loading completed-order evidence…" />
          ) : detailError ? (
            <div className="space-y-3">
              <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/[0.07] p-3 text-sm text-red-200">
                Supplier evidence could not be loaded: {detailError}
              </p>
              <div className="flex justify-end">
                <SecondaryButton darkSurface onClick={retryDetail}>Retry evidence</SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StabilityBadge stability={selected.stability} />
                <span className="text-sm text-slate-300">{CONFIDENCE_LABEL[selected.confidence]}</span>
                <span className="text-sm text-slate-400">{selected.completedPOCount} received orders</span>
              </div>

              <p className="rounded-lg border border-slate-800 bg-[#0c1523] p-3 text-sm leading-6 text-slate-300">{selected.reason}</p>

              <DecisionExplanationView
                explanation={selected.explanation}
                decisionLabel={STABILITY_LABEL[selected.stability]}
                darkSurface
              />

              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailMetric label="Median lead time" value={selected.medianLeadTimeDays === null ? '—' : `${selected.medianLeadTimeDays} days`} hint={`${selected.leadTimeSampleCount} completed orders with usable timestamps`} />
                <DetailMetric label="90th percentile" value={selected.p90LeadTimeDays === null ? '—' : `${selected.p90LeadTimeDays} days`} hint="Nearest-rank percentile from observed deliveries" />
                <DetailMetric label="Lead-time variability (CV)" value={selected.leadTimeCV ?? '—'} hint={`Server consistency limit: ${selected.evidence.stableMaxCoefficientOfVariation}`} />
                <DetailMetric label="Observed range" value={selected.evidence.minLeadTimeDays === null ? '—' : `${selected.evidence.minLeadTimeDays}–${selected.evidence.maxLeadTimeDays} days`} hint="Fastest to slowest qualifying completed order" />
                <DetailMetric label="PO status counts" value={`${selected.completedPOCount} received · ${selected.openPOCount} open · ${selected.draftPOCount} draft · ${selected.cancelledPOCount} cancelled`} hint="Open means ordered or partially received" />
                <DetailMetric label="Evidence used" value={`${selected.evidence.leadTimeSampleCount} observations`} hint={`Variability needs ${selected.evidence.minimumSamplesForVariability} completed orders with usable timestamps`} />
              </dl>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completed-order lead-time observations</h3>
                {(selected.leadTimeObservations ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">No received order has both valid ordered and received timestamps, so there is no lead time to measure.</p>
                ) : (
                  <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="sticky top-0 bg-[#0c1523] text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th scope="col" className="px-3 py-2">Purchase order</th>
                          <th scope="col" className="px-3 py-2">Ordered</th>
                          <th scope="col" className="px-3 py-2">Received</th>
                          <th scope="col" className="px-3 py-2 text-right">Elapsed time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {(selected.leadTimeObservations ?? []).map((observation) => (
                          <tr key={observation.purchaseOrderId}>
                            <td className="px-3 py-2">
                              <Link className="font-mono text-xs text-emerald-300 underline-offset-2 hover:text-emerald-200 hover:underline" to={`/app/purchase-orders/${encodeURIComponent(observation.purchaseOrderId)}`}>
                                {observation.purchaseOrderId.slice(0, 8)}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-slate-300">{formatDate(observation.orderedAt)}</td>
                            <td className="px-3 py-2 text-slate-300">{formatDate(observation.receivedAt)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">{observation.leadTimeDays} days</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-200">
                The database has no promised delivery dates. These elapsed times cannot establish whether an order was early, on time, or late; cancellations are reported as order history, not as supplier fault.
              </p>

              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                <Link className={darkSecondaryButtonClass} to="/app/purchase-orders">Review purchase orders</Link>
                <Link className={darkSecondaryButtonClass} to="/app/suppliers">Manage suppliers</Link>
              </div>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
