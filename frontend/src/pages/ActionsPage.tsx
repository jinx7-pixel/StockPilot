/**
 * Actions workspace.
 *
 * The server currently supports one executable action: create a draft purchase
 * order from a current REPLENISH recommendation. Successful and refused attempts
 * are persisted in the action history; other recommendation types remain
 * review-only on their existing pages.
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
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import { actionsApi, type Action, type ActionPage, type ActionStatus, type ExecuteActionResult } from '../lib/actions';
import { ApiError } from '../lib/request';
import { recommendationsApi, type Recommendation, type RecommendationsPage } from '../lib/recommendations';
import { supplierApi, type Supplier } from '../lib/purchasing';

const HISTORY_PAGE_SIZE = 25;
const RECOMMENDATION_PAGE_SIZE = 25;
const EXECUTABLE_TYPE = 'REPLENISH';

type SupplierOption = Pick<Supplier, 'id' | 'name'>;
type ActionableRecommendation = Recommendation & {
  productName: string;
  productSku: string;
  categoryName: string | null;
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function apiMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

function statusBadgeClass(status: ActionStatus): string {
  return status === 'COMPLETED'
    ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200'
    : 'border-rose-400/20 bg-rose-400/[0.08] text-rose-200';
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card darkSurface className="p-4 sm:p-5">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </Card>
  );
}

/** Persisted action history shows the server's recorded context, not a fresh re-evaluation. */
function ActionHistoryCard({ action }: { action: Action }) {
  const completed = action.status === 'COMPLETED';

  return (
    <Card darkSurface className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(action.status)}`}>
              {completed ? 'Completed' : 'Refused'}
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-800 text-slate-300 px-2.5 py-1 text-xs font-medium">
              Draft purchase order
            </span>
            {action.sourceRecommendationContext.priority ? (
              <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-slate-300">
                {action.sourceRecommendationContext.priority} priority at the time
              </span>
            ) : null}
          </div>

          <p className="text-sm font-semibold text-slate-100">
            {completed ? 'Draft order created' : 'Draft order attempt refused'}
          </p>
          <p className="text-sm text-slate-300">
            {completed ? 'Recorded quantity: ' : 'Requested quantity: '}
            <span className="font-semibold tabular-nums">{action.quantity} units</span>
            {Number(action.recommendedQuantity) !== Number(action.quantity) ? (
              <span className="text-slate-400"> · engine suggested {action.recommendedQuantity} units</span>
            ) : null}
          </p>

          <p className="text-xs text-slate-400">
            Source: <span className="font-medium">{action.sourceRecommendationType}</span>
            {action.sourceRecommendationContext.confidence
              ? ` · ${action.sourceRecommendationContext.confidence.toLowerCase()} confidence at the time`
              : null}
            {' · '}{formatDateTime(action.createdAt)}
          </p>

          {action.sourceRecommendationContext.reason ? (
            <p className="max-w-3xl text-sm leading-6 text-slate-300">{action.sourceRecommendationContext.reason}</p>
          ) : null}

          {!completed && action.failureReason ? (
            <p className="text-sm text-rose-200">Reason: {action.failureReason}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Link
            to={`/app/inventory/${encodeURIComponent(action.productId)}`}
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]"
          >
            Open product inventory
          </Link>
          {action.purchaseOrderId ? (
            <Link
              to={`/app/purchase-orders/${encodeURIComponent(action.purchaseOrderId)}`}
              className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm font-semibold text-emerald-200 shadow-sm transition hover:bg-emerald-400/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]"
            >
              View draft order
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function ConfirmDraftOrderDialog({
  recommendation,
  suppliers,
  onClose,
  onCompleted,
}: {
  recommendation: ActionableRecommendation;
  suppliers: SupplierOption[];
  onClose: () => void;
  onCompleted: (result: ExecuteActionResult) => void;
}) {
  const [quantity, setQuantity] = useState(recommendation.recommendedQuantity ?? '');
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reused on retry; changing either user choice creates a new action identity.
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );

  function updateQuantity(value: string) {
    setQuantity(value);
    setIdempotencyKey(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  function updateSupplier(value: string) {
    setSupplierId(value);
    setIdempotencyKey(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  function dismiss() {
    if (!submitting) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await actionsApi.execute(
        {
          productId: recommendation.productId,
          supplierId,
          quantity,
          sourceRecommendationId: recommendation.id,
        },
        idempotencyKey,
      );
      onCompleted(result);
    } catch (cause) {
      if (cause instanceof ApiError && actionsApi.isStale(cause)) {
        setError('This recommendation is no longer current. Refresh and review the latest recommendation before acting.');
      } else {
        setError(apiMessage(cause, 'Could not create the draft purchase order. Please try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal darkSurface title="Create draft purchase order" onClose={dismiss}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="font-medium text-slate-100">{recommendation.productName}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {recommendation.productSku}{recommendation.categoryName ? ` · ${recommendation.categoryName}` : ''}
          </p>
        </div>

        {error ? <ErrorBanner darkSurface message={error} /> : null}

        <div className="rounded-lg border border-slate-800 bg-[#0c1523] p-3">
          <p className="text-sm font-semibold text-slate-100">{recommendation.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{recommendation.reason}</p>
          <p className="mt-2 text-xs text-slate-400">
            This creates a draft only. It is not sent to the supplier and does not move stock. The server rechecks that the replenishment recommendation is still current.
          </p>
        </div>

        <Field
          darkSurface
          label="Quantity"
          type="number"
          min={0.01}
          max={99999999.99}
          step={0.01}
          value={quantity}
          onChange={updateQuantity}
          disabled={submitting}
          hint={recommendation.recommendedQuantity
            ? `Engine suggestion: ${recommendation.recommendedQuantity} units. You can adjust the quantity.`
            : 'Enter a quantity to request. The server will validate the current recommendation.'}
        />

        <Select
          darkSurface
          label="Active supplier"
          value={supplierId}
          onChange={updateSupplier}
          disabled={submitting}
          options={[
            { value: '', label: 'Choose a supplier' },
            ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
          ]}
        />

        <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <SecondaryButton darkSurface onClick={dismiss} disabled={submitting}>Cancel</SecondaryButton>
          <PrimaryButton darkSurface type="submit" disabled={submitting || quantity.trim() === '' || supplierId === ''}>
            {submitting ? 'Creating…' : 'Create draft order'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function ActionsPage() {
  const [status, setStatus] = useState<'all' | ActionStatus>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [recommendationPage, setRecommendationPage] = useState(1);

  const [history, setHistory] = useState<ActionPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);

  const [recommendationData, setRecommendationData] = useState<RecommendationsPage | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [recommendationsReloadToken, setRecommendationsReloadToken] = useState(0);

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliersError, setSuppliersError] = useState<string | null>(null);
  const [suppliersReloadToken, setSuppliersReloadToken] = useState(0);

  const [confirming, setConfirming] = useState<ActionableRecommendation | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setHistoryLoading(true);
      setHistory(null);
      setHistoryError(null);
      try {
        const result = await actionsApi.list({
          ...(status !== 'all' ? { status } : {}),
          page: historyPage,
          limit: HISTORY_PAGE_SIZE,
        });
        if (!cancelled) setHistory(result);
      } catch (cause) {
        if (!cancelled) setHistoryError(apiMessage(cause, 'Could not load action history. Please try again.'));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [status, historyPage, historyReloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setRecommendationsLoading(true);
      setRecommendationData(null);
      setRecommendationsError(null);
      try {
        const result = await recommendationsApi.list({
          type: EXECUTABLE_TYPE,
          isActive: 'true',
          page: recommendationPage,
          limit: RECOMMENDATION_PAGE_SIZE,
        });
        if (!cancelled) setRecommendationData(result);
      } catch (cause) {
        if (!cancelled) setRecommendationsError(apiMessage(cause, 'Could not load current replenishment recommendations.'));
      } finally {
        if (!cancelled) setRecommendationsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [recommendationPage, recommendationsReloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setSuppliersLoading(true);
      setSuppliers([]);
      setSuppliersError(null);
      try {
        const result = await supplierApi.list({ isActive: 'true', page: 1, limit: 100 });
        if (!cancelled) setSuppliers(result.items.map(({ id, name }) => ({ id, name })));
      } catch (cause) {
        if (!cancelled) setSuppliersError(apiMessage(cause, 'Could not load active suppliers.'));
      } finally {
        if (!cancelled) setSuppliersLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [suppliersReloadToken]);

  const refreshAll = useCallback(() => {
    setHistoryReloadToken((token) => token + 1);
    setRecommendationsReloadToken((token) => token + 1);
    setSuppliersReloadToken((token) => token + 1);
  }, []);

  function changeStatus(value: string) {
    setStatus(value as 'all' | ActionStatus);
    setHistoryPage(1);
  }

  function completeAction(result: ExecuteActionResult) {
    setConfirming(null);
    const orderRef = result.purchaseOrder?.id ? ` ${result.purchaseOrder.id.slice(0, 8)}` : '';
    setSuccessMessage(`Draft purchase order${orderRef} created for ${result.action.quantity} units. Review it in Purchase Orders before placing it.`);
    refreshAll();
  }

  const candidates: ActionableRecommendation[] = recommendationData
    ? recommendationData.items.flatMap((item) => item.recommendations
      .filter((recommendation) => recommendation.type === EXECUTABLE_TYPE)
      .map((recommendation) => ({
        ...recommendation,
        productName: item.product.name,
        productSku: item.product.sku,
        categoryName: item.product.category?.name ?? null,
      })))
    : [];

  const historyPages = history?.pagination.totalPages ?? 1;
  const recommendationPages = recommendationData?.pagination.limit
    ? Math.max(1, Math.ceil(recommendationData.pagination.total / recommendationData.pagination.limit))
    : 1;
  const historyResultLabel = status === 'all'
    ? 'Recorded action entries'
    : status === 'COMPLETED' ? 'Completed action entries' : 'Refused action entries';
  const completedOnPage = history?.items.filter((action) => action.status === 'COMPLETED').length;
  const refusedOnPage = history?.items.filter((action) => action.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Actions"
        description="Find the next steps that need attention across your inventory."
        darkSurface
        actions={<SecondaryButton darkSurface onClick={refreshAll} disabled={historyLoading || recommendationsLoading || suppliersLoading}>Refresh</SecondaryButton>}
      />

      {successMessage ? (
        <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-sm text-emerald-200">
          {successMessage} <Link to="/app/purchase-orders" className="font-semibold text-emerald-100 underline underline-offset-2 hover:text-white">Open Purchase Orders</Link>
        </p>
      ) : null}

      <section aria-label="Action summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title={historyResultLabel}
          value={history ? history.pagination.total.toLocaleString() : '—'}
          detail={history
            ? status === 'all' ? 'Business-wide total from the action history API.' : `Business-wide total matching the ${status === 'FAILED' ? 'refused' : 'completed'} filter.`
            : historyLoading ? 'Loading action history…' : 'Action count unavailable.'}
        />
        <SummaryCard
          title="Completed on this page"
          value={completedOnPage === undefined ? '—' : completedOnPage.toLocaleString()}
          detail={history ? `${history.items.length} action records loaded on this page.` : historyLoading ? 'Loading action history…' : 'Page count unavailable.'}
        />
        <SummaryCard
          title="Refused on this page"
          value={refusedOnPage === undefined ? '—' : refusedOnPage.toLocaleString()}
          detail={history ? 'Only refused attempts in the loaded page.' : historyLoading ? 'Loading action history…' : 'Page count unavailable.'}
        />
      </section>

      <Card darkSurface className="overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Ready to replenish</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                Live REPLENISH recommendations for active products. The server rechecks each recommendation when you create a draft; viewing a recommendation does not change stock or place an order.
              </p>
            </div>
            <Link to="/app/recommendations" className="text-sm font-medium text-emerald-300 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
              Review recommendations <span aria-hidden="true">→</span>
            </Link>
          </div>
          {recommendationData ? (
            <p className="mt-3 text-xs text-slate-400">
              {recommendationData.recommendationCount} recommendation{recommendationData.recommendationCount === 1 ? '' : 's'} returned on this product page · page {recommendationData.pagination.page} of {recommendationPages}
            </p>
          ) : null}
        </div>

        {suppliersError ? (
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <ErrorBanner darkSurface message={`Supplier options are unavailable: ${suppliersError}. Draft order creation is disabled until suppliers load.`} />
            <SecondaryButton darkSurface onClick={() => setSuppliersReloadToken((token) => token + 1)} disabled={suppliersLoading}>Retry suppliers</SecondaryButton>
          </div>
        ) : null}
        {/*
          Only warn about missing suppliers when there is actually something to
          act on. With no actionable recommendation the user cannot reach the
          supplier field at all, so the amber banner was pure noise above the
          "no recommendations" empty state.
        */}
        {!suppliersError && !suppliersLoading && suppliers.length === 0 && candidates.length > 0 ? (
          <p className="border-b border-slate-800 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-200 sm:px-5">
            No active suppliers are available. Add or activate a supplier before creating a draft order. <Link to="/app/suppliers" className="font-semibold text-amber-100 underline underline-offset-2">Manage suppliers</Link>
          </p>
        ) : null}
        {suppliersLoading ? <p className="border-b border-slate-800 px-4 py-3 text-sm text-slate-400">Loading active supplier options…</p> : null}

        {recommendationsLoading ? (
          <div className="px-4 sm:px-5"><Spinner darkSurface label="Loading replenishment recommendations…" /></div>
        ) : recommendationsError ? (
          <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <ErrorBanner darkSurface message={`Replenishment recommendations could not be loaded: ${recommendationsError}. No ready-to-order list can be shown until this source is available.`} />
            <SecondaryButton darkSurface onClick={() => setRecommendationsReloadToken((token) => token + 1)} disabled={recommendationsLoading}>Try again</SecondaryButton>
          </div>
        ) : candidates.length === 0 ? (
          <div className="px-4 sm:px-5">
              <EmptyState
                darkSurface
              title="No replenishment recommendations on this page"
              description={recommendationData && recommendationPages > recommendationData.pagination.page
                ? 'This product page has no REPLENISH recommendations. Continue to the next product page to review the rest of the matching scope.'
                : 'The recommendations API returned no current REPLENISH items for this product scope.'}
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {candidates.map((recommendation) => {
              const canCreateDraft = !suppliersLoading && !suppliersError && suppliers.length > 0;
              return (
                <article key={recommendation.id} className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-xs font-semibold text-emerald-200">Replenish</span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${recommendation.priority === 'URGENT' ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-200' : recommendation.priority === 'HIGH' ? 'border-orange-400/20 bg-orange-400/[0.08] text-orange-200' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                        {recommendation.priority} priority
                      </span>
                      <span className="text-xs text-slate-400">{recommendation.confidence.toLowerCase()} confidence</span>
                    </div>
                    <h3 className="mt-2 font-semibold text-slate-100">{recommendation.title}</h3>
                    <p className="mt-1 text-sm font-medium text-slate-200">
                      {recommendation.productName} <span className="font-normal text-slate-400">· {recommendation.productSku}{recommendation.categoryName ? ` · ${recommendation.categoryName}` : ''}</span>
                    </p>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{recommendation.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                      <span className="text-slate-300">Suggested quantity: <strong className="tabular-nums text-slate-100">{recommendation.recommendedQuantity ?? 'Not supplied'}</strong></span>
                      <Link to={`/app/inventory/${encodeURIComponent(recommendation.productId)}`} className="font-medium text-emerald-300 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Stock history</Link>
                      <Link to="/app/reorder" className="font-medium text-emerald-300 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Review Reorder</Link>
                    </div>
                  </div>
                  <PrimaryButton
                    darkSurface
                    disabled={!canCreateDraft}
                    onClick={() => setConfirming(recommendation)}
                  >
                    Create draft order
                  </PrimaryButton>
                </article>
              );
            })}
          </div>
        )}

        {recommendationData && recommendationPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-[#0c1523] px-4 py-3 text-sm text-slate-300 sm:px-5">
            <span>Product page {recommendationData.pagination.page} of {recommendationPages} · product results matching the active REPLENISH filter</span>
            <div className="flex gap-2">
              <SecondaryButton darkSurface disabled={recommendationsLoading || recommendationPage <= 1} onClick={() => setRecommendationPage((current) => current - 1)}>Previous</SecondaryButton>
              <SecondaryButton darkSurface disabled={recommendationsLoading || recommendationPage >= recommendationPages} onClick={() => setRecommendationPage((current) => current + 1)}>Next</SecondaryButton>
            </div>
          </div>
        ) : null}
      </Card>

      <section aria-labelledby="action-history-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="action-history-heading" className="text-lg font-semibold text-slate-100">Action history</h2>
            <p className="mt-1 text-sm text-slate-400">Persisted draft-order executions and refused attempts, newest first.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Select
                darkSurface
                label="Action status"
                value={status}
                onChange={changeStatus}
                disabled={historyLoading}
                options={[
                  { value: 'all', label: 'All action records' },
                  { value: 'COMPLETED', label: 'Completed' },
                  { value: 'FAILED', label: 'Refused' },
                ]}
              />
            </div>
            {status !== 'all' ? <SecondaryButton darkSurface onClick={() => changeStatus('all')} disabled={historyLoading}>Clear filter</SecondaryButton> : null}
          </div>
        </div>

        {historyLoading ? (
          <Card darkSurface><Spinner darkSurface label="Loading action history…" /></Card>
        ) : historyError ? (
          <Card darkSurface className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <ErrorBanner darkSurface message={`Action history could not be loaded: ${historyError}`} />
            <SecondaryButton darkSurface onClick={() => setHistoryReloadToken((token) => token + 1)}>Retry history</SecondaryButton>
          </Card>
        ) : history && history.items.length === 0 ? (
          <Card darkSurface>
            <EmptyState
              darkSurface
              title={status === 'all' ? 'No action records yet' : `No ${status === 'FAILED' ? 'refused' : 'completed'} actions`}
              description={status === 'all'
                ? 'When a draft order is created from a replenishment recommendation, its persisted record will appear here.'
                : 'There are no records matching this status filter. Try another status or clear the filter.'}
              action={status !== 'all' ? <SecondaryButton darkSurface onClick={() => changeStatus('all')}>Clear filter</SecondaryButton> : undefined}
            />
          </Card>
        ) : history ? (
          <div className="space-y-3">
            {history.items.map((action) => <ActionHistoryCard key={action.id} action={action} />)}
          </div>
        ) : null}

        {history && historyPages > 1 ? (
          <Card darkSurface className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm text-slate-300">
            <span>Page {history.pagination.page} of {historyPages} · {history.pagination.total.toLocaleString()} matching action records</span>
            <div className="flex gap-2">
              <SecondaryButton darkSurface disabled={historyLoading || historyPage <= 1} onClick={() => setHistoryPage((current) => current - 1)}>Previous</SecondaryButton>
              <SecondaryButton darkSurface disabled={historyLoading || historyPage >= historyPages} onClick={() => setHistoryPage((current) => current + 1)}>Next</SecondaryButton>
            </div>
          </Card>
        ) : null}
      </section>

      {confirming ? (
        <ConfirmDraftOrderDialog
          recommendation={confirming}
          suppliers={suppliers}
          onClose={() => setConfirming(null)}
          onCompleted={completeAction}
        />
      ) : null}
    </div>
  );
}
