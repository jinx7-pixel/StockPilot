/**
 * Recommendations page — what to consider, and why.
 *
 * **Read-only by design.** There is no Approve, Execute, Create PO, Adjust Stock,
 * Apply, Delete or bulk action anywhere on this screen, and no write call
 * behind the API. Deciding whether to act on a recommendation is a judgement
 * that belongs to a person and belongs to Step 11.10; offering a button here
 * would imply the decision has already been made.
 *
 * Nothing is computed client-side. Type, priority, confidence and quantity are
 * rendered exactly as the server returned them, and the evidence shown is the
 * evidence the source engine produced.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { DecisionExplanationView } from '../components/DecisionExplanationView';
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
  recommendationsApi,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_TYPES,
  type Recommendation,
  type RecommendationPriority,
  type RecommendationType,
  type RecommendationsPage,
} from '../lib/recommendations';

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<RecommendationType, string> = {
  REPLENISH: 'Replenish',
  REVIEW_REPLENISHMENT: 'Review replenishment',
  REVIEW_OVERSTOCK: 'Review overstock',
  REVIEW_SLOW_STOCK: 'Review slow stock',
  REVIEW_DEAD_STOCK: 'Review dead stock',
  REVIEW_SUPPLIER: 'Review supplier',
};

const TYPE_BADGE: Record<RecommendationType, string> = {
  REPLENISH: 'bg-blue-100 text-blue-700',
  REVIEW_REPLENISHMENT: 'bg-orange-100 text-orange-700',
  REVIEW_OVERSTOCK: 'bg-violet-100 text-violet-700',
  REVIEW_SLOW_STOCK: 'bg-amber-100 text-amber-700',
  REVIEW_DEAD_STOCK: 'bg-red-100 text-red-700',
  REVIEW_SUPPLIER: 'bg-teal-100 text-teal-700',
};

const PRIORITY_BADGE: Record<RecommendationPriority, string> = {
  URGENT: 'bg-red-600 text-white',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-slate-100 text-slate-600',
};

function Badge({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

/** Renders a server-provided explanation; the shape is trusted, not recomputed. */
function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={TYPE_BADGE[recommendation.type]}
          label={TYPE_LABEL[recommendation.type]}
        />
        <Badge
          className={PRIORITY_BADGE[recommendation.priority]}
          label={recommendation.priority}
        />
        <span className="text-xs text-slate-500">
          {recommendation.confidence.toLowerCase().replace(/_/g, ' ')} confidence
        </span>
      </div>

      <h3 className="mt-2 font-semibold text-slate-900">{recommendation.title}</h3>
      <p className="mt-1 text-sm text-slate-700">{recommendation.reason}</p>

      {/* Shown only when the Reorder Engine supplied one. */}
      {recommendation.recommendedQuantity !== undefined ? (
        <p className="mt-2 text-sm">
          <span className="text-slate-500">Suggested quantity: </span>
          <span className="font-bold text-slate-900 tabular-nums">
            {recommendation.recommendedQuantity}
          </span>
        </p>
      ) : null}

      <p className="mt-2 text-xs text-slate-400">
        Based on: {recommendation.sourceDecisions.join(', ')}
      </p>

      {recommendation.limitations.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
            Evidence and limitations ({recommendation.evidence.length} facts,{' '}
            {recommendation.limitations.length} limitations)
          </summary>
          <div className="mt-2">
            <DecisionExplanationView
              explanation={{
                decision: recommendation.type,
                confidence: recommendation.confidence,
                evidence: recommendation.evidence,
                limitations: recommendation.limitations,
              }}
            />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

export function RecommendationsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [activeStatus, setActiveStatus] = useState<'all' | 'true' | 'false'>('all');
  const [type, setType] = useState<RecommendationType | 'all'>('all');
  const [priority, setPriority] = useState<RecommendationPriority | 'all'>('all');
  const [confidence, setConfidence] = useState<'all' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<RecommendationsPage | null>(null);
  const [detail, setDetail] = useState<{ product: { id: string; name: string }; recommendations: Recommendation[]; summary: { recommendationCount: number; highestPriority: RecommendationPriority | null } } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await recommendationsApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(categoryId ? { categoryId } : {}),
          isActive: activeStatus,
          type,
          priority,
          confidence,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setData(result);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not load recommendations. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, activeStatus, type, priority, confidence, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result.data);
      } catch {
        // The category filter is a convenience; it must not take the page down.
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

  async function openDetail(productId: string) {
    setDetailLoading(true);
    try {
      const result = await recommendationsApi.forProduct(productId);
      setDetail(result.data);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Could not load that product. Please try again.',
      );
    } finally {
      setDetailLoading(false);
    }
  }

  // Any filter change returns to page one.
  function handleCategory(value: string) {
    setCategoryId(value);
    setPage(1);
  }

  function handleActive(value: string) {
    setActiveStatus(value as 'all' | 'true' | 'false');
    setPage(1);
  }

  function handleType(value: string) {
    setType(value as RecommendationType | 'all');
    setPage(1);
  }

  function handlePriority(value: string) {
    setPriority(value as RecommendationPriority | 'all');
    setPage(1);
  }

  function handleConfidence(value: string) {
    setConfidence(value as 'all' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT');
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
    setType('all');
    setPriority('all');
    setConfidence('all');
    setPage(1);
  }

  const hasFilters =
    appliedSearch !== '' ||
    categoryId !== '' ||
    activeStatus !== 'all' ||
    type !== 'all' ||
    priority !== 'all' ||
    confidence !== 'all';

  if (loading) return <Spinner label="Loading recommendations…" />;

  const totalPages =
    data === null || data.pagination.limit === 0
      ? 1
      : Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recommendations"
        description="What the intelligence says is worth considering, and the evidence behind it. Recommendations only — nothing here orders, adjusts or approves anything."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Card className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            label="Type"
            value={type}
            onChange={handleType}
            options={[
              { value: 'all', label: 'Any type' },
              ...RECOMMENDATION_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] })),
            ]}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={handlePriority}
            options={[
              { value: 'all', label: 'Any priority' },
              ...RECOMMENDATION_PRIORITIES.map((value) => ({ value, label: value })),
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
            value={activeStatus}
            onChange={handleActive}
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              Search
            </button>
            {hasFilters ? (
              <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
            ) : null}
          </div>
        </form>
      </Card>

      {data === null || data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? 'No recommendations match these filters' : 'Nothing to consider right now'}
            description={
              hasFilters
                ? 'Try widening the search, or clear the filters to see everything.'
                : 'No product currently trips a stock, demand or supplier concern. That is a real result, not a missing one — the intelligence found nothing worth your attention.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <Link to="/app/intelligence">
                  <SecondaryButton>View intelligence</SecondaryButton>
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {data.recommendationCount} recommendation
            {data.recommendationCount === 1 ? '' : 's'} across {data.items.length} product
            {data.items.length === 1 ? '' : 's'}
          </p>

          {data.items.map((item) => (
            <section key={item.product.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{item.product.name}</h2>
                  <p className="text-xs text-slate-500">
                    {item.product.sku}
                    {item.product.category ? ` · ${item.product.category.name}` : ''}
                  </p>
                </div>
                <SecondaryButton
                  disabled={detailLoading}
                  onClick={() => void openDetail(item.product.id)}
                >
                  Detail
                </SecondaryButton>
              </div>
              {item.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))}
            </section>
          ))}
        </div>
      )}

      {data !== null && totalPages > 1 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm text-slate-600">
          <span>
            page {data.pagination.page} of {totalPages} · {data.pagination.total} products
            examined
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

      {detail ? (
        <Modal title={detail.product.name} onClose={() => setDetail(null)}>
          <div className="space-y-3">
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-semibold">Recommendations: </span>
              {detail.summary.recommendationCount}
              {' · '}
              <span className="font-semibold">Highest priority: </span>
              {detail.summary.highestPriority ?? 'none'}
            </p>

            {detail.recommendations.length === 0 ? (
              <p className="text-sm text-slate-500">
                No recommendations for this product.
              </p>
            ) : (
              detail.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))
            )}

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Read-only. Nothing here has been ordered, approved or adjusted.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}