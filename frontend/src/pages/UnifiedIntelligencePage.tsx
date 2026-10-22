/**
 * Intelligence hub — server-authored recommendations with direct links to the
 * existing inventory workflows. The page is read-only: a recommendation never
 * creates an order or changes stock by being viewed.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { DecisionExplanationView } from '../components/DecisionExplanationView';
import {
  Card,
  EmptyState,
  ErrorBanner,
  Field,
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
  REPLENISH: 'border-sky-400/20 bg-sky-400/[0.08] text-sky-200',
  REVIEW_REPLENISHMENT: 'border-orange-400/20 bg-orange-400/[0.08] text-orange-200',
  REVIEW_OVERSTOCK: 'border-violet-400/20 bg-violet-400/[0.08] text-violet-200',
  REVIEW_SLOW_STOCK: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-200',
  REVIEW_DEAD_STOCK: 'border-rose-400/20 bg-rose-400/[0.08] text-rose-200',
  REVIEW_SUPPLIER: 'border-teal-400/20 bg-teal-400/[0.08] text-teal-200',
};

const PRIORITY_BADGE: Record<RecommendationPriority, string> = {
  URGENT: 'border-rose-400/25 bg-rose-400/[0.1] text-rose-200',
  HIGH: 'border-orange-400/25 bg-orange-400/[0.1] text-orange-200',
  MEDIUM: 'border-slate-700 bg-slate-800 text-slate-300',
};

const WORKFLOW_LINKS = [
  { label: 'Analytics', to: '/app/analytics', detail: 'Review inventory and sales trends' },
  { label: 'Stock Risk', to: '/app/stock-risk', detail: 'Review server-assessed stock risk' },
  { label: 'Demand Planning', to: '/app/demand', detail: 'Review demand patterns' },
  { label: 'Reorder', to: '/app/reorder', detail: 'Review replenishment decisions' },
  { label: 'Overstock', to: '/app/overstock', detail: 'Review excess-stock classifications' },
  { label: 'Purchase Orders', to: '/app/purchase-orders', detail: 'Open the existing order workflow' },
] as const;

function workflowFor(type: RecommendationType): { label: string; to: string } {
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
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function workflowLinkClass(): string {
  return 'inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/40 hover:bg-slate-800 hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400';
}

function RecommendationCard({
  product,
  recommendation,
}: {
  product: RecommendationsPage['items'][number]['product'];
  recommendation: Recommendation;
}) {
  const nextStep = workflowFor(recommendation.type);

  return (
    <article className="rounded-xl border border-slate-800 bg-[#101a2a] p-4 shadow-sm shadow-black/20 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={TYPE_BADGE[recommendation.type]} label={TYPE_LABEL[recommendation.type]} />
        <Badge className={PRIORITY_BADGE[recommendation.priority]} label={`${recommendation.priority} priority`} />
        <span className="text-xs text-slate-400">
          {recommendation.confidence.toLowerCase()} confidence
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-100">{recommendation.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{recommendation.reason}</p>
          <p className="mt-2 break-words text-xs text-slate-400">
            {product.name} <span className="px-1 text-slate-600">·</span> {product.sku}
            {product.category ? <><span className="px-1 text-slate-600">·</span>{product.category.name}</> : null}
          </p>
        </div>
        {recommendation.recommendedQuantity !== undefined ? (
          <div className="shrink-0 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 sm:text-right">
            <p className="text-[10px] font-semibold tracking-wide text-emerald-300 uppercase">Suggested quantity</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-100">{recommendation.recommendedQuantity}</p>
          </div>
        ) : null}
      </div>

      {recommendation.sourceDecisions.length > 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          Source decisions: {recommendation.sourceDecisions.join(', ')}
        </p>
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
        <Link className={workflowLinkClass()} to={nextStep.to}>{nextStep.label}</Link>
        <Link className={workflowLinkClass()} to={`/app/inventory/${encodeURIComponent(product.id)}`}>View stock history</Link>
      </div>
    </article>
  );
}

export function UnifiedIntelligencePage() {
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
        if (cancelled) return;
        setData(result);
      } catch (cause) {
        if (cancelled) return;
        setData(null);
        setError(cause instanceof ApiError ? cause.message : 'Could not load intelligence. Please try again.');
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
        setCategories([]);
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
        title="Intelligence"
        description="Turn inventory data into clear, actionable decisions."
        darkSurface
        actions={<SecondaryButton darkSurface disabled={loading} onClick={reload}>Refresh</SecondaryButton>}
      />

      <section aria-label="Explore inventory workflows" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {WORKFLOW_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group rounded-xl border border-slate-800 bg-[#101a2a] p-4 shadow-sm shadow-black/20 transition hover:border-emerald-400/30 hover:bg-[#121f31] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <span className="font-semibold text-slate-100 group-hover:text-emerald-200">{item.label}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-400">{item.detail}</span>
          </Link>
        ))}
      </section>

      <section aria-label="Current page recommendation summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card darkSurface className="p-4 sm:p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Recommendations on this page</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{data ? data.recommendationCount.toLocaleString() : '—'}</p>
          <p className="mt-1 text-xs text-slate-400">{data ? 'Returned by the recommendation service for this product page.' : loading ? 'Loading recommendation results…' : 'Recommendation count unavailable.'}</p>
        </Card>
        <Card darkSurface className="p-4 sm:p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Products with recommendations on this page</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{data ? data.items.length.toLocaleString() : '—'}</p>
          <p className="mt-1 text-xs text-slate-400">{data ? `${data.pagination.total.toLocaleString()} products in the product search scope; results are paginated by product.` : loading ? 'Loading product results…' : 'Product count unavailable.'}</p>
        </Card>
      </section>

      {data ? (
        <p className="-mt-3 text-xs text-slate-400">Summary values describe this page only. Product pages follow search, category, and product-status filters; recommendation type, priority, and confidence filters apply within each page. No global recommendation total is provided.</p>
      ) : null}

      <Card darkSurface className="p-4">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field darkSurface label="Search product" value={searchInput} onChange={setSearchInput} placeholder="Name or SKU" required={false} />
          <Select
            label="Category"
            value={categoryId}
            onChange={handleCategory}
            disabled={categoriesLoading || categoriesError !== null}
            darkSurface
            options={[
              { value: '', label: categoriesLoading ? 'Loading categories…' : categoriesError ? 'Categories unavailable' : 'All categories' },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <Select
            label="Recommendation type"
            value={type}
            onChange={handleType}
            darkSurface
            options={[{ value: 'all', label: 'Any type' }, ...RECOMMENDATION_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }))]}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={handlePriority}
            darkSurface
            options={[{ value: 'all', label: 'Any priority' }, ...RECOMMENDATION_PRIORITIES.map((value) => ({ value, label: value }))]}
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
            label="Product status"
            value={activeStatus}
            onChange={handleActive}
            darkSurface
            options={[
              { value: 'all', label: 'Active and inactive' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />
          <div className="flex items-end gap-2">
            <button type="submit" disabled={loading} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-[#06251a] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]">
              Apply filters
            </button>
            {hasFilters ? <SecondaryButton darkSurface disabled={loading} onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>

        {categoriesError ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ErrorBanner darkSurface message={`Category options could not be loaded: ${categoriesError}. Other filters and recommendations remain available.`} />
            <SecondaryButton darkSurface disabled={categoriesLoading} onClick={() => setCategoryReloadToken((token) => token + 1)}>Retry categories</SecondaryButton>
          </div>
        ) : null}
      </Card>

      {error ? (
        <Card darkSurface className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ErrorBanner darkSurface message={`Intelligence recommendations could not be loaded: ${error}`} />
            <SecondaryButton darkSurface disabled={loading} onClick={() => setReloadToken((token) => token + 1)}>Try again</SecondaryButton>
          </div>
        </Card>
      ) : loading ? (
        <Card darkSurface className="p-5"><Spinner darkSurface label="Loading actionable intelligence…" /></Card>
      ) : data === null ? (
        <Card darkSurface className="p-5">
          <EmptyState darkSurface title="Intelligence is unavailable" description="The recommendation service did not return data. Retry to load current results." action={<SecondaryButton darkSurface onClick={() => setReloadToken((token) => token + 1)}>Retry</SecondaryButton>} />
        </Card>
      ) : data.items.length === 0 ? (
        <Card darkSurface>
          <EmptyState
            darkSurface
            title={hasFilters ? 'No recommendations on this product page match the filters' : totalPages > 1 ? 'No recommendations were returned for this product page' : 'No recommendations were returned'}
            description={totalPages > 1 ? 'The API paginates by product. Continue through the product pages before concluding that the full search scope has no recommendations.' : hasFilters ? 'Try broader filters or clear them to review the current product scope.' : 'The recommendation service returned no findings for the products in this result scope.'}
            action={hasFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Actionable insights</h2>
              <p className="mt-1 text-sm text-slate-400">Recommendations and priority are supplied by StockPilot’s existing engines.</p>
            </div>
            <p className="text-sm text-slate-300">
              {data.recommendationCount} recommendation{data.recommendationCount === 1 ? '' : 's'} across {data.items.length} product{data.items.length === 1 ? '' : 's'} on this page
            </p>
          </div>

          {data.items.map((item) => (
            <section key={item.product.id} className="space-y-3">
              {item.recommendations.map((recommendation) => (
                <RecommendationCard key={recommendation.id} product={item.product} recommendation={recommendation} />
              ))}
            </section>
          ))}
        </div>
      )}

      {data && totalPages > 1 ? (
        <Card darkSurface className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm text-slate-300">
          <span>Product page {data.pagination.page} of {totalPages} · {data.pagination.total.toLocaleString()} products in the search, category, and status scope</span>
          <div className="flex gap-2">
            <SecondaryButton darkSurface disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</SecondaryButton>
            <SecondaryButton darkSurface disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</SecondaryButton>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
