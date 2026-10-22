/**
 * Recommendations page — server-authored inventory guidance, with its evidence
 * and links to the existing workflows. This page is read-only.
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
  type RecommendationProductItem,
  type RecommendationsPage,
} from '../lib/recommendations';

const PAGE_SIZE = 25;

const darkSecondaryLinkClass = 'inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]';

const TYPE_LABEL: Record<RecommendationType, string> = {
  REPLENISH: 'Replenish',
  REVIEW_REPLENISHMENT: 'Review replenishment',
  REVIEW_OVERSTOCK: 'Review overstock',
  REVIEW_SLOW_STOCK: 'Review slow stock',
  REVIEW_DEAD_STOCK: 'Review dead stock',
  REVIEW_SUPPLIER: 'Review supplier',
};

const TYPE_BADGE: Record<RecommendationType, string> = {
  REPLENISH: 'bg-sky-400/10 text-sky-200',
  REVIEW_REPLENISHMENT: 'bg-orange-400/10 text-orange-200',
  REVIEW_OVERSTOCK: 'bg-violet-400/10 text-violet-200',
  REVIEW_SLOW_STOCK: 'bg-amber-400/10 text-amber-200',
  REVIEW_DEAD_STOCK: 'bg-rose-400/10 text-rose-200',
  REVIEW_SUPPLIER: 'bg-teal-400/10 text-teal-200',
};

const PRIORITY_BADGE: Record<RecommendationPriority, string> = {
  URGENT: 'bg-rose-400/15 text-rose-200',
  HIGH: 'bg-orange-400/10 text-orange-200',
  MEDIUM: 'bg-slate-800 text-slate-300',
};

const RELATED_ROUTES = [
  { label: 'Intelligence', to: '/app/intelligence' },
  { label: 'Stock Risk', to: '/app/stock-risk' },
  { label: 'Demand Planning', to: '/app/demand' },
  { label: 'Reorder', to: '/app/reorder' },
  { label: 'Overstock', to: '/app/overstock' },
  { label: 'Purchase Orders', to: '/app/purchase-orders' },
] as const;

function recommendationWorkflow(type: RecommendationType): { label: string; to: string } {
  switch (type) {
    case 'REPLENISH':
    case 'REVIEW_REPLENISHMENT':
      return { label: 'Review reorder', to: '/app/reorder' };
    case 'REVIEW_OVERSTOCK':
      return { label: 'Review overstock', to: '/app/overstock' };
    case 'REVIEW_SLOW_STOCK':
    case 'REVIEW_DEAD_STOCK':
      return { label: 'Review slow / dead stock', to: '/app/slow-dead' };
    case 'REVIEW_SUPPLIER':
      return { label: 'Review supplier intelligence', to: '/app/supplier-intelligence' };
  }
}

function Badge({ className, label }: { className: string; label: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const workflow = recommendationWorkflow(recommendation.type);

  return (
    <Card darkSurface className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={TYPE_BADGE[recommendation.type]} label={TYPE_LABEL[recommendation.type]} />
        <Badge className={PRIORITY_BADGE[recommendation.priority]} label={`${recommendation.priority} priority`} />
        <span className="text-xs text-slate-400">
          {recommendation.confidence.toLowerCase().replace(/_/g, ' ')} confidence
        </span>
      </div>

      <h3 className="mt-3 font-semibold text-slate-100">{recommendation.title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-300">{recommendation.reason}</p>

      {recommendation.recommendedQuantity !== undefined ? (
        <p className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-sm">
          <span className="text-emerald-300">Suggested quantity: </span>
          <span className="font-semibold tabular-nums text-emerald-100">
            {recommendation.recommendedQuantity}
          </span>
        </p>
      ) : null}

      {recommendation.sourceDecisions.length > 0 ? (
        <p className="mt-3 text-xs text-slate-400">Source decisions: {recommendation.sourceDecisions.join(', ')}</p>
      ) : null}

      {recommendation.evidence.length > 0 || recommendation.limitations.length > 0 ? (
        <details className="mt-3 border-t border-slate-800 pt-3">
          <summary className="w-fit cursor-pointer rounded text-xs font-medium text-slate-400 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            Evidence and limitations ({recommendation.evidence.length} facts, {recommendation.limitations.length} limitations)
          </summary>
          <div className="mt-3">
            <DecisionExplanationView
              explanation={{
                decision: recommendation.type,
                confidence: recommendation.confidence,
                evidence: recommendation.evidence,
                limitations: recommendation.limitations,
              }}
              darkSurface
            />
          </div>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-3">
        <Link className={darkSecondaryLinkClass} to={workflow.to}>{workflow.label}</Link>
      </div>
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
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [data, setData] = useState<RecommendationsPage | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof recommendationsApi.forProduct>> | null>(null);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [categoryReloadToken, setCategoryReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      setData(null);
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
        if (!cancelled) setData(result);
      } catch (cause) {
        if (cancelled) return;
        setData(null);
        setError(cause instanceof ApiError ? cause.message : 'Could not load recommendations. Please try again.');
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
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result);
      } catch (cause) {
        if (cancelled) return;
        setCategoriesError(cause instanceof ApiError ? cause.message : 'Category options could not be loaded.');
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [categoryReloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
    setCategoryReloadToken((token) => token + 1);
  }, []);

  async function openDetail(productId: string) {
    setDetailLoading(true);
    setDetailError(null);
    setDetailProductId(productId);
    setDetail(null);
    try {
      const result = await recommendationsApi.forProduct(productId);
      setDetail(result);
    } catch (cause) {
      setDetailError(cause instanceof ApiError ? cause.message : 'Could not load product recommendations. Please try again.');
    } finally {
      setDetailLoading(false);
    }
  }

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

  const hasFilters = appliedSearch !== '' || categoryId !== '' || activeStatus !== 'all' || type !== 'all' || priority !== 'all' || confidence !== 'all';
  const totalPages = data === null || data.pagination.limit === 0
    ? 1
    : Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recommendations"
        description="Review inventory recommendations and understand the reasoning behind each decision."
        darkSurface
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link className={darkSecondaryLinkClass} to="/app/intelligence">View intelligence</Link>
            <SecondaryButton darkSurface disabled={loading} onClick={reload}>Refresh</SecondaryButton>
          </div>
        )}
      />

      <nav aria-label="Related inventory workflows" className="flex flex-wrap gap-2">
        {RELATED_ROUTES.map((route) => (
          <Link key={route.to} className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" to={route.to}>
            {route.label}<span aria-hidden="true" className="ml-1">→</span>
          </Link>
        ))}
      </nav>

      <section aria-label="Recommendation page summary" className="grid gap-3 sm:grid-cols-2">
        <Card darkSurface className="p-4">
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Recommendations on this page</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{data ? data.recommendationCount.toLocaleString() : '—'}</p>
          <p className="mt-1 text-xs text-slate-400">{data ? 'Count returned by the recommendation API for this page.' : loading ? 'Loading recommendation results…' : 'Recommendation count unavailable.'}</p>
        </Card>
        <Card darkSurface className="p-4">
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Products with recommendations on this page</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{data ? data.items.length.toLocaleString() : '—'}</p>
          <p className="mt-1 text-xs text-slate-400">{data ? 'One product group per returned product.' : loading ? 'Loading product results…' : 'Product count unavailable.'}</p>
        </Card>
      </section>
      {data ? <p className="-mt-3 text-xs text-slate-400">Counts describe this loaded page, not a global total. The API paginates products; recommendation filters apply to each product page.</p> : null}

      {error ? (
        <Card darkSurface className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ErrorBanner darkSurface message={`Recommendations could not be loaded: ${error}`} />
            <SecondaryButton darkSurface disabled={loading} onClick={() => setReloadToken((token) => token + 1)}>Try again</SecondaryButton>
          </div>
        </Card>
      ) : null}

      <Card darkSurface className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field darkSurface label="Search product" value={searchInput} onChange={setSearchInput} placeholder="Name or SKU" required={false} />
          <Select
            label="Category"
            darkSurface
            value={categoryId}
            onChange={handleCategory}
            disabled={categoriesLoading || (categoriesError !== null && categories.length === 0)}
            options={[
              { value: '', label: categoriesLoading ? 'Loading categories…' : categoriesError && categories.length === 0 ? 'Categories unavailable' : 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <Select darkSurface label="Recommendation type" value={type} onChange={handleType} options={[{ value: 'all', label: 'Any type' }, ...RECOMMENDATION_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }))]} />
          <Select darkSurface label="Priority" value={priority} onChange={handlePriority} options={[{ value: 'all', label: 'Any priority' }, ...RECOMMENDATION_PRIORITIES.map((value) => ({ value, label: value }))]} />
          <Select
            label="Confidence"
            darkSurface
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
            darkSurface
            value={activeStatus}
            onChange={handleActive}
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />
          <div className="flex items-end gap-2">
            <button type="submit" disabled={loading} className="min-h-10 rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]">
              Apply filters
            </button>
            {hasFilters ? <SecondaryButton darkSurface disabled={loading} onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>

        {categoriesError ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ErrorBanner darkSurface message={`Category options could not be loaded: ${categoriesError}. Recommendations and other filters remain available.`} />
            <SecondaryButton darkSurface disabled={categoriesLoading} onClick={() => setCategoryReloadToken((token) => token + 1)}>Retry categories</SecondaryButton>
          </div>
        ) : null}
      </Card>

      {loading ? (
        <Card darkSurface className="p-5"><Spinner darkSurface label="Loading recommendations…" /></Card>
      ) : error ? null : data === null ? (
        <Card darkSurface>
          <EmptyState darkSurface title="Recommendations are unavailable" description="The recommendation service did not return data. Retry to load current results." action={<SecondaryButton darkSurface onClick={() => setReloadToken((token) => token + 1)}>Retry</SecondaryButton>} />
        </Card>
      ) : data.items.length === 0 ? (
        <Card darkSurface>
          <EmptyState
            darkSurface
            title={data.pagination.total === 0 ? (hasFilters ? 'No products match these filters' : 'No products to assess yet') : totalPages > 1 ? 'No recommendations on this product page' : hasFilters ? 'No recommendations match these filters' : 'No recommendations returned'}
            description={
              totalPages > 1 && data.pagination.total > 0
                ? 'The API paginates by product. Review the other product pages before concluding that the full product scope has no matching recommendations.'
                : hasFilters
                  ? 'Try broader filters, clear them, or adjust the search to review another product scope.'
                  : data.pagination.total === 0
                    ? 'Add products and record inventory activity before looking for recommendations.'
                    : 'The recommendation service returned no findings for the products in this result scope.'
            }
            action={hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Recommendation list</h2>
              <p className="mt-1 text-sm text-slate-400">Priority, confidence, reasoning, and quantities come from the existing server-side engines.</p>
            </div>
            <p className="text-sm text-slate-300">
              {data.recommendationCount} recommendation{data.recommendationCount === 1 ? '' : 's'} across {data.items.length} product{data.items.length === 1 ? '' : 's'} on this page
            </p>
          </div>

          {data.items.map((item: RecommendationProductItem) => (
            <section key={item.product.id} className="space-y-3 rounded-xl border border-slate-800 bg-[#0c1523] p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="break-words font-semibold text-slate-100">{item.product.name}</h3>
                  <p className="mt-0.5 break-words text-xs text-slate-400">
                    {item.product.sku}{item.product.category ? ` · ${item.product.category.name}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className={darkSecondaryLinkClass} to={`/app/inventory/${encodeURIComponent(item.product.id)}`}>Stock history</Link>
                  <SecondaryButton darkSurface disabled={detailLoading} onClick={() => void openDetail(item.product.id)}>
                    {detailLoading && detailProductId === item.product.id ? 'Loading…' : 'Details'}
                  </SecondaryButton>
                </div>
              </div>
              {item.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))}
            </section>
          ))}
        </div>
      )}

      {data !== null && totalPages > 1 ? (
        <Card darkSurface className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm text-slate-300">
          <span>Product page {data.pagination.page} of {totalPages} · {data.pagination.total} products in the search/category/status scope</span>
          <div className="flex gap-2">
            <SecondaryButton darkSurface disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</SecondaryButton>
            <SecondaryButton darkSurface disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</SecondaryButton>
          </div>
        </Card>
      ) : null}

      {detailError ? (
        <Card darkSurface className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ErrorBanner darkSurface message={`Product recommendations could not be loaded: ${detailError}`} />
            {detailProductId ? <SecondaryButton darkSurface disabled={detailLoading} onClick={() => void openDetail(detailProductId)}>Retry details</SecondaryButton> : null}
          </div>
        </Card>
      ) : null}

      {detail ? (
        <Modal darkSurface title={detail.product.name} onClose={() => { setDetail(null); setDetailError(null); setDetailProductId(null); }}>
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              {detail.product.sku}{detail.product.category ? ` · ${detail.product.category.name}` : ''}
            </p>
            <p className="rounded-lg border border-slate-800 bg-[#0c1523] p-3 text-sm text-slate-300">
              <span className="font-semibold">Recommendations on this product: </span>
              {detail.summary.recommendationCount}
              {' · '}
              <span className="font-semibold">Highest priority: </span>
              {detail.summary.highestPriority ?? 'none'}
            </p>
            {detail.recommendations.length === 0 ? (
              <p className="text-sm text-slate-400">No recommendations are currently returned for this product.</p>
            ) : (
              detail.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))
            )}
            <Link className={darkSecondaryLinkClass} to={`/app/inventory/${encodeURIComponent(detail.product.id)}`}>View stock history</Link>
            <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs text-amber-200">
              Read-only. Nothing here has been ordered, approved, dismissed, or adjusted.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
