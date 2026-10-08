/**
 * Unified Intelligence page — one screen showing every engine's verdict.
 *
 * Strictly read-only. There is no Create PO, no Adjust Stock, no reorder
 * action, no supplier replacement and no bulk selection: those belong to later
 * modules, and a button here would imply a decision this page has not made.
 *
 * Nothing on this screen is calculated. The summary, the priorities and every
 * confidence come from the server. In particular this page never re-counts how
 * many modules are unhappy and never re-ranks them — a browser that "helped"
 * with either would quietly disagree with the assessment it is displaying.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

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
  unifiedApi,
  type UnifiedPagination,
  type UnifiedProductIntelligence,
} from '../lib/unified';

/** The server caps this endpoint at 25; the page follows it. */
const PAGE_SIZE = 25;

const CONFIDENCE_BADGE: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-orange-100 text-orange-700',
  INSUFFICIENT: 'bg-slate-100 text-slate-500',
};

/**
 * Pure display mapping — turns a server value like `INSUFFICIENT_DATA` into
 * "Insufficient data". A label, not a classification: the underlying value is
 * what the server decided and is never changed.
 */
function humanise(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function ConfidenceChip({ confidence }: { confidence: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${CONFIDENCE_BADGE[confidence] ?? CONFIDENCE_BADGE.INSUFFICIENT}`}
    >
      {confidence}
    </span>
  );
}

/** One engine's verdict in the list, exactly as the server worded it. */
function ModuleCell({
  label,
  value,
  confidence,
  emphasise,
}: {
  label: string;
  value: string;
  confidence: string;
  emphasise?: boolean;
}) {
  return (
    <td className="px-3 py-2">
      <p className="text-[10px] tracking-wide text-slate-400 uppercase">{label}</p>
      <p
        className={`text-sm ${emphasise ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
      >
        {humanise(value)}
      </p>
      <ConfidenceChip confidence={confidence} />
    </td>
  );
}

export function UnifiedIntelligencePage() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [activeStatus, setActiveStatus] = useState<'all' | 'true' | 'false'>('all');
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<UnifiedProductIntelligence[] | null>(null);
  const [pagination, setPagination] = useState<UnifiedPagination | null>(null);
  const [selected, setSelected] = useState<UnifiedProductIntelligence | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await unifiedApi.list({
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(categoryId ? { categoryId } : {}),
          isActive: activeStatus,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;

        setItems(result.items);
        setPagination(result.pagination);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not load intelligence data. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, categoryId, activeStatus, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await catalogApi.listCategories();
        if (!cancelled) setCategories(result);
      } catch {
        // The category filter is a convenience; a failure here must not take
        // the whole page down with it.
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

  function handleCategory(value: string) {
    setCategoryId(value);
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
    setCategoryId('');
    setActiveStatus('all');
    setPage(1);
  }

  const hasFilters = appliedSearch !== '' || categoryId !== '' || activeStatus !== 'all';

  if (loading) return <Spinner label="Assessing product intelligence…" />;

  const totalPages =
    pagination === null || pagination.limit === 0
      ? 1
      : Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligence"
        description="Every intelligence verdict for a product in one place: stock risk, demand, reorder, overstock, slow/dead stock and supplier performance. Read-only — nothing here takes an action."
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
              Apply
            </button>
            {hasFilters ? <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      {items === null || items.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? 'No products match these filters' : 'No products yet'}
            description={
              hasFilters
                ? 'Try widening the search, or clear the filters to see the full catalog.'
                : 'Once you add products and record sales and purchase orders, their intelligence appears here.'
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
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-3 py-3">Stock risk</th>
                  <th scope="col" className="px-3 py-3">Demand</th>
                  <th scope="col" className="px-3 py-3">Reorder</th>
                  <th scope="col" className="px-3 py-3">Overstock</th>
                  <th scope="col" className="px-3 py-3">Slow / dead</th>
                  <th scope="col" className="px-3 py-3">Supplier</th>
                  <th scope="col" className="px-3 py-3">Attention</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{item.product.name}</p>
                      <p className="text-xs text-slate-500">
                        {item.product.sku}
                        {item.product.category ? ` · ${item.product.category.name}` : ''}
                      </p>
                    </td>
                    <ModuleCell
                      label="Stock risk"
                      value={item.stockRisk.risk}
                      confidence={item.stockRisk.confidence}
                      emphasise={item.summary.attentionRequired && item.stockRisk.risk !== 'HEALTHY'}
                    />
                    <ModuleCell
                      label="Demand"
                      value={item.demand.trend}
                      confidence={item.demand.confidence}
                    />
                    <ModuleCell
                      label="Reorder"
                      value={item.reorder.decision}
                      confidence={item.reorder.confidence}
                      emphasise={item.reorder.reorder}
                    />
                    <ModuleCell
                      label="Overstock"
                      value={item.overstock.status}
                      confidence={item.overstock.confidence}
                    />
                    <ModuleCell
                      label="Slow / dead"
                      value={item.slowDead.status}
                      confidence={item.slowDead.confidence}
                    />
                    <ModuleCell
                      label="Supplier"
                      value={item.supplier?.stability ?? 'no supplier'}
                      confidence={item.supplier?.confidence ?? 'INSUFFICIENT'}
                    />
                    {/* Straight from the server: never recomputed here. */}
                    <td className="px-3 py-2 text-slate-700 tabular-nums">
                      {item.summary.decisionCount > 0 ? (
                        <span className="font-semibold text-orange-700">
                          {item.summary.decisionCount} · p{item.summary.highestPriority}
                        </span>
                      ) : (
                        <span className="text-slate-400">none</span>
                      )}
                    </td>
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
              {pagination
                ? `${pagination.total} product${pagination.total === 1 ? '' : 's'}`
                : '—'}
              {pagination && totalPages > 1 ? ` · page ${pagination.page} of ${totalPages}` : ''}
            </span>

            {totalPages > 1 ? (
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
        <Modal title={selected.product.name} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {selected.product.sku}
              {selected.product.category ? ` · ${selected.product.category.name}` : ''}
            </p>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-semibold">Attention required: </span>
              {selected.summary.attentionRequired ? 'yes' : 'no'}
              {' · '}
              <span className="font-semibold">Decisions needing action: </span>
              {selected.summary.decisionCount}
              {' · '}
              <span className="font-semibold">Highest priority: </span>
              {selected.summary.highestPriority}
            </div>

            {(
              [
                ['Stock risk', selected.stockRisk],
                ['Demand', selected.demand],
                ['Reorder', selected.reorder],
                ['Overstock', selected.overstock],
                ['Slow / dead', selected.slowDead],
                ...(selected.supplier === null ? [] : ([['Supplier', selected.supplier]] as const)),
              ] as Array<
                readonly [
                  string,
                  { explanation: Parameters<typeof DecisionExplanationView>[0]['explanation'] },
                ]
              >
            ).map(([label, block]) => (
              <section key={label} className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {label}
                </h3>
                <DecisionExplanationView explanation={block.explanation} />
              </section>
            ))}

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Read-only. Nothing here has created a purchase order, adjusted stock or contacted a
              supplier.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}