/**
 * Action Center.
 *
 * ## What this screen does
 *
 * Two things, and no more:
 *
 *   1. Shows the user's own action history — every draft purchase order the
 *      Action Center has raised, and every attempt it refused.
 *   2. Executes exactly one kind of action: turning a reviewed `REPLENISH`
 *      recommendation into a **draft** purchase order.
 *
 * ## What it deliberately cannot do
 *
 * There is no button here to switch a supplier, adjust stock, delete anything, or
 * run a bulk job. Those are not features that were left for later; they have no
 * code path on the server, so no button could invoke them even if one existed.
 *
 * ## What this page does not know
 *
 * Nothing about demand, reorder points, safety stock or confidence thresholds.
 * Every quantity, priority and supplier shown here comes from the server. The only
 * things this page decides are the two the user owns: **how many** to order and
 * **from whom**. Whether the action is still warranted is the server's call, and
 * it re-checks that at the moment of execution — so a stale screen is refused
 * rather than acted on.
 *
 * ## Idempotency
 *
 * Confirming generates a key that is held for that confirmation. A double-click or
 * a retry of the *same* confirmation therefore cannot raise two orders. Changing
 * the quantity or supplier generates a new key, which is correct: that is a
 * different action, not a repeat of the first.
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
import { supplierApi, type Supplier } from '../lib/purchasing';
import {
  actionsApi,
  type Action,
  type ActionPage,
  type ActionStatus,
  type ExecuteActionResult,
} from '../lib/actions';
import { recommendationsApi, type Recommendation } from '../lib/recommendations';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 25;

/** Only a replenishment recommendation can become an order. */
const EXECUTABLE_TYPE = 'REPLENISH';

type SupplierOption = Pick<Supplier, 'id' | 'name' | 'isActive'>;

/**
 * A recommendation joined to the product it concerns.
 *
 * The list endpoint nests recommendations under their product; flattening them for
 * the action screen needs both, so the pairing is made explicit in the type rather
 * than left to the shape of an anonymous object.
 */
type ActionableRecommendation = Recommendation & { productId: string; productName: string };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function statusBadgeClass(status: ActionStatus): string {
  return status === 'COMPLETED'
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-rose-100 text-rose-800';
}

/**
 * One row of action history.
 *
 * Shows the stored traceability rather than re-deriving it: `confidence` and
 * `reason` come from the recorded context, because by now the live intelligence
 * result may say something different from what justified the order at the time.
 */
function ActionRow({ action }: { action: Action }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                action.status,
              )}`}
            >
              {action.status === 'COMPLETED' ? 'Completed' : 'Refused'}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {action.actionType === 'CREATE_DRAFT_PURCHASE_ORDER'
                ? 'Draft purchase order'
                : action.actionType}
            </span>
          </div>

          <p className="text-sm text-slate-700">
            Ordered <span className="font-semibold">{action.quantity}</span> units
            {Number(action.recommendedQuantity) !== Number(action.quantity) ? (
              <span className="text-slate-500">
                {' '}
                (engine suggested {action.recommendedQuantity})
              </span>
            ) : null}
          </p>

          <p className="text-xs text-slate-500">
            From recommendation{' '}
            <span className="font-mono">{action.sourceRecommendationType}</span>
            {action.sourceRecommendationContext.confidence ? (
              <> · {action.sourceRecommendationContext.confidence} confidence at the time</>
            ) : null}
            {' · '}
            {formatDateTime(action.createdAt)}
          </p>

          {action.sourceRecommendationContext.reason ? (
            <p className="max-w-2xl text-xs text-slate-600">
              {action.sourceRecommendationContext.reason}
            </p>
          ) : null}

          {action.status === 'FAILED' ? (
            <p className="text-xs text-rose-700">Refused: {action.failureReason}</p>
          ) : null}
        </div>

        <div className="text-right text-xs text-slate-500">
          {action.purchaseOrderId ? (
            <>
              <p>
                Purchase order{' '}
                <span className="font-mono">{action.purchaseOrderId.slice(0, 8)}</span>
              </p>
              <Link
                to="/app/purchase-orders"
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                Open purchase orders
              </Link>
            </>
          ) : (
            <p>No purchase order was created</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The confirmation dialog.
 *
 * The quantity defaults to the engine's suggestion but is fully editable — the
 * user may know something the system does not, and that judgement is theirs.
 * What they cannot do here is change the *decision*: there is no way to act on
 * anything other than a `REPLENISH` recommendation.
 */
function ConfirmDialog({
  recommendation,
  productLabel,
  suppliers,
  defaultSupplierId,
  onClose,
  onCompleted,
}: {
  recommendation: ActionableRecommendation;
  productLabel: string;
  suppliers: SupplierOption[];
  defaultSupplierId: string;
  onClose: () => void;
  onCompleted: (result: ExecuteActionResult) => void;
}) {
  const [quantity, setQuantity] = useState(recommendation.recommendedQuantity ?? '');
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per confirmation. Reused across a retry of *this* dialog so a
  // double-submit cannot become two orders.
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );

  // Changing what is being ordered is a different action, so it needs a new key.
  function handleQuantity(value: string) {
    setQuantity(value);
    setIdempotencyKey(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  function handleSupplier(value: string) {
    setSupplierId(value);
    setIdempotencyKey(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        setError(
          'This recommendation is no longer current — stock or orders changed since you reviewed it. Close this and refresh to see the current picture.',
        );
      } else {
        setError(cause instanceof ApiError ? cause.message : 'Could not create the order.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inactiveSelected = suppliers.find((supplier) => supplier.id === supplierId)?.isActive === false;

  return (
    <Modal title="Create draft purchase order" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">{productLabel}</p>

        {error ? <ErrorBanner message={error} /> : null}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-semibold">{recommendation.title}</p>
          <p className="mt-1 text-xs text-slate-600">{recommendation.reason}</p>
          <p className="mt-2 text-xs text-slate-500">
            This creates a <strong>draft</strong> order. Nothing is sent to the supplier, and
            stock does not move — that happens only when you order and then receive it.
          </p>
        </div>

        <Field
          label="Quantity"
          value={quantity}
          onChange={handleQuantity}
          hint={
            recommendation.recommendedQuantity
              ? `The engine suggested ${recommendation.recommendedQuantity}. Change it if you know better.`
              : undefined
          }
        />

        <Select
          label="Supplier"
          value={supplierId}
          onChange={handleSupplier}
          options={[
            { value: '', label: 'Choose a supplier' },
            ...suppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.isActive ? supplier.name : `${supplier.name} (inactive)`,
            })),
          ]}
        />

        {inactiveSelected ? (
          <p className="text-xs text-amber-700">
            That supplier is inactive and cannot receive new orders.
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <SecondaryButton onClick={onClose} disabled={submitting}>
            Cancel
          </SecondaryButton>
          <button
            type="submit"
            disabled={submitting || quantity.trim() === '' || supplierId === '' || inactiveSelected}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create draft order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ActionsPage() {
  const [status, setStatus] = useState<'all' | ActionStatus>('all');
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<ActionPage | null>(null);

  const [actionable, setActionable] = useState<ActionableRecommendation[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  const [confirming, setConfirming] = useState<ActionableRecommendation | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await actionsApi.list({
          ...(status !== 'all' ? { status } : {}),
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        setHistory(result);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not load action history. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Only replenishment recommendations are executable, so only those are
        // fetched. Everything else on the recommendations screen is review-only
        // and has no button here.
        const [recommendations, supplierList] = await Promise.all([
          recommendationsApi.list({ type: EXECUTABLE_TYPE, limit: 50 }),
          supplierApi.list({ isActive: 'all', limit: 100 }),
        ]);
        if (cancelled) return;

        setActionable(
          recommendations.items.flatMap((item) =>
            item.recommendations
              .filter((recommendation) => recommendation.type === EXECUTABLE_TYPE)
              .map((recommendation) => ({
                ...recommendation,
                productId: item.product.id,
                productName: item.product.name,
              })),
          ),
        );
        setSuppliers(supplierList.items);
      } catch {
        // The actionable list and the supplier picker are conveniences; a failure
        // must not hide the action history, which is the page's main purpose.
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

  function handleStatus(value: string) {
    setStatus(value as 'all' | ActionStatus);
    setPage(1);
  }

  function handleCompleted(result: ExecuteActionResult) {
    setConfirming(null);
    setBanner(
      `Draft purchase order ${result.purchaseOrder?.id.slice(0, 8) ?? ''} created for ${
        result.action.quantity
      } units. Review and send it from Purchase orders.`,
    );
    reload();
  }

  if (loading) return <Spinner label="Loading actions…" />;

  const totalPages =
    history === null || history.pagination.limit === 0
      ? 1
      : Math.max(1, Math.ceil(history.pagination.total / history.pagination.limit));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Actions"
        description="Turn a reviewed replenishment recommendation into a draft purchase order. Every action is recorded, and nothing is sent to a supplier without you."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {banner ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {banner}
        </div>
      ) : null}

      <Card className="p-4">
        <h2 className="font-semibold text-slate-900">Ready to order</h2>
        <p className="mt-1 text-sm text-slate-600">
          These are products whose live recommendation still says to replenish. Confirming
          creates a draft order — it does not place an order, and it does not move stock.
        </p>

        <div className="mt-4 space-y-2">
          {actionable.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing is waiting to be ordered right now.
            </p>
          ) : (
            actionable.map((recommendation) => (
              <div
                key={recommendation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {recommendation.productName}
                  </p>
                  <p className="text-xs text-slate-500">
                    Suggested {recommendation.recommendedQuantity} units ·{' '}
                    {recommendation.priority.toLowerCase()} priority ·{' '}
                    {recommendation.confidence.toLowerCase()} confidence
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirming(recommendation)}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  Create draft order
                </button>
              </div>
            ))
          )}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Overstock, slow stock, dead stock and supplier reviews are deliberately not
          actionable. They stay on the{' '}
          <Link to="/app/recommendations" className="font-medium text-brand-600 hover:text-brand-700">
            recommendations
          </Link>{' '}
          screen for a human to consider.
        </p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">History</h2>
        <div className="w-56">
          <Select
            label="Status"
            value={status}
            onChange={handleStatus}
            options={[
              { value: 'all', label: 'All actions' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'FAILED', label: 'Refused' },
            ]}
          />
        </div>
      </div>

      {history === null || history.items.length === 0 ? (
        <Card>
          <EmptyState
            title={status === 'all' ? 'No actions yet' : `No ${status === 'FAILED' ? 'refused' : 'completed'} actions`}
            description={
              status === 'all'
                ? 'When you create a draft purchase order from a recommendation, it will appear here with the reasoning that justified it.'
                : 'Try a different status filter.'
            }
            action={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {history.items.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      )}

      {history !== null && totalPages > 1 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm text-slate-600">
          <span>
            page {history.pagination.page} of {totalPages} · {history.pagination.total} actions
          </span>
          <div className="flex gap-2">
            <SecondaryButton disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </SecondaryButton>
            <SecondaryButton disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
            </SecondaryButton>
          </div>
        </Card>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          recommendation={confirming}
          productLabel={`${confirming.productName} · suggested ${confirming.recommendedQuantity ?? '—'} units`}
          suppliers={suppliers}
          defaultSupplierId={suppliers[0]?.id ?? ''}
          onClose={() => setConfirming(null)}
          onCompleted={handleCompleted}
        />
      ) : null}
    </div>
  );
}