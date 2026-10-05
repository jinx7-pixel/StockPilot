/**
 * Analytics page — the facts layer, presented.
 *
 * Every number is rendered exactly as the server computed it. The page
 * deliberately does no arithmetic of its own: an "estimated total" here would
 * quietly disagree with the ledger the moment a price changed.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

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
import {
  analyticsApi,
  formatAmount,
  type InventoryAnalytics,
  type Overview,
  type ProductAnalytics,
  type SalesAnalytics,
  type SupplierAnalytics,
} from '../lib/analytics';
import { ApiError } from '../lib/request';

const RANGE_DAYS = 30;
const PAGE_SIZE = 20;

type GroupBy = 'day' | 'week' | 'month';

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-red-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : 'text-slate-900';

  return (
    <Card className="p-4">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </Card>
  );
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function AnalyticsPage() {
  const [from, setFrom] = useState(() => isoDateDaysAgo(RANGE_DAYS));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState<GroupBy>('day');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [sales, setSales] = useState<SalesAnalytics | null>(null);
  const [inventory, setInventory] = useState<InventoryAnalytics | null>(null);
  const [products, setProducts] = useState<ProductAnalytics[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierAnalytics[] | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const range = { from, to, groupBy };

    void (async () => {
      // Six bounded reads, issued together. None of them is an aggregate
      // computed in the browser, and none of them is per-row.
      const [overviewResult, salesResult, inventoryResult, productsResult, suppliersResult] =
        await Promise.all([
          analyticsApi.overview(),
          analyticsApi.sales(range),
          analyticsApi.inventory(range),
          analyticsApi.products({ ...range, limit: PAGE_SIZE }),
          analyticsApi.suppliers(),
        ]);

      if (cancelled) return;

      setOverview(overviewResult.data);
      setSales(salesResult.data);
      setInventory(inventoryResult.data);
      setProducts(productsResult.data);
      setSuppliers(suppliersResult.data);
      setError(null);
    })()
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load analytics. Please try again.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, groupBy, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  function resetRange() {
    setFrom(isoDateDaysAgo(RANGE_DAYS));
    setTo(new Date().toISOString().slice(0, 10));
    setGroupBy('day');
    setLoading(true);
  }

  if (loading) return <Spinner label="Loading analytics…" />;

  const isEmpty =
    overview !== null &&
    overview.products.totalProducts === 0 &&
    overview.sales.today.salesCount === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Facts derived from your stock ledger, sales and purchase orders. Historical only — no forecasts."
        actions={<SecondaryButton onClick={reload}>Refresh</SecondaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="From" type="date" value={from} onChange={setFrom} required={false} />
          <Field label="To" type="date" value={to} onChange={setTo} required={false} />
          <Select
            label="Sales grouping"
            value={groupBy}
            onChange={(value) => {
              setGroupBy(value as GroupBy);
              setLoading(true);
            }}
            options={[
              { value: 'day', label: 'By day' },
              { value: 'week', label: 'By week' },
              { value: 'month', label: 'By month' },
            ]}
          />
          <div className="flex items-end">
            <SecondaryButton onClick={resetRange}>Reset to last 30 days</SecondaryButton>
          </div>
        </div>
      </Card>

      {isEmpty ? (
        <Card>
          <EmptyState
            title="Nothing to report yet"
            description="Once you add products, record stock movements and record a sale, the numbers will appear here."
            action={
              <Link to="/app/products">
                <SecondaryButton>Go to products</SecondaryButton>
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {/* ---- Catalog and stock ---- */}
          {overview ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Catalog &amp; stock
              </h2>
              <div className="grid gap-3 sm:grid-cols-4">
                <MetricCard label="Products" value={overview.products.totalProducts} hint={`${overview.products.activeProducts} active`} />
                <MetricCard
                  label="Units in stock"
                  value={overview.inventory.totalStockUnits}
                  hint={`${overview.inventory.productsWithStock} products holding stock`}
                />
                <MetricCard
                  label="Out of stock"
                  value={overview.inventory.outOfStockProducts}
                  tone={overview.inventory.outOfStockProducts > 0 ? 'bad' : 'default'}
                  hint={`${overview.inventory.productsWithNoMovements} never stocked`}
                />
                <MetricCard
                  label="Units received"
                  value={overview.purchasing.unitsReceivedLast30Days}
                  hint="last 30 days"
                />
              </div>
            </section>
          ) : null}

          {/* ---- Sales ---- */}
          {sales ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Sales
              </h2>
              <div className="grid gap-3 sm:grid-cols-4">
                <MetricCard
                  label="Revenue (range)"
                  value={formatAmount(sales.summary.revenue)}
                  hint={`${sales.summary.salesCount} sales`}
                />
                <MetricCard
                  label="Units sold (range)"
                  value={sales.summary.unitsSold}
                  hint={`${sales.analysisWindow.days} day window`}
                />
                <MetricCard
                  label="Average sale"
                  value={formatAmount(sales.summary.averageSaleValue)}
                  hint="completed sales only"
                />
                <MetricCard
                  label="Revenue today"
                  value={formatAmount(overview?.sales.today.revenue ?? '0.00')}
                  hint={`${overview?.sales.today.salesCount ?? 0} sales today`}
                />
              </div>

              <Card>
                <header className="border-b border-slate-200 px-6 py-4">
                  <h3 className="font-semibold text-slate-900">Sales trend</h3>
                  <p className="text-sm text-slate-500">
                    Grouped by {sales.groupBy} across the selected range.
                  </p>
                </header>

                {sales.series.length === 0 ? (
                  <EmptyState
                    title="No sales in this range"
                    description="Widen the date range, or record a sale."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                        <tr>
                          <th scope="col" className="px-6 py-3 font-medium">Period</th>
                          <th scope="col" className="px-6 py-3 text-right font-medium">Sales</th>
                          <th scope="col" className="px-6 py-3 text-right font-medium">Units</th>
                          <th scope="col" className="px-6 py-3 text-right font-medium">Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sales.series.map((point) => (
                          <tr key={point.period}>
                            <td className="px-6 py-3 text-slate-900">{point.period}</td>
                            <td className="px-6 py-3 text-right text-slate-600">
                              {point.salesCount}
                            </td>
                            <td className="px-6 py-3 text-right text-slate-600">
                              {point.unitsSold}
                            </td>
                            <td className="px-6 py-3 text-right font-medium text-slate-900">
                              {formatAmount(point.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </section>
          ) : null}

          {/* ---- Inventory ---- */}
          {inventory ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                Inventory movement
              </h2>
              <div className="grid gap-3 sm:grid-cols-5">
                <MetricCard label="In" value={inventory.movements.inQuantity} />
                <MetricCard label="Out" value={inventory.movements.outQuantity} />
                <MetricCard
                  label="Adjustment"
                  value={inventory.movements.adjustmentQuantity}
                />
                <MetricCard
                  label="Net movement"
                  value={formatAmount(inventory.movements.netMovement)}
                  tone={Number(inventory.movements.netMovement) < 0 ? 'warn' : 'default'}
                />
                <MetricCard
                  label="Entries"
                  value={inventory.movements.movementCount}
                  hint="in range"
                />
              </div>
            </section>
          ) : null}

          {/* ---- Product performance ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
              Product performance
            </h2>
            <Card>
              {products === null || products.length === 0 ? (
                <EmptyState
                  title="No products to report on"
                  description="Products appear here whether or not they have sold."
                  action={
                    <Link to="/app/products">
                      <SecondaryButton>Go to products</SecondaryButton>
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th scope="col" className="px-6 py-3 font-medium">Product</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Stock</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Units sold</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Revenue</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Avg/day</th>
                        <th scope="col" className="px-6 py-3 font-medium">Last sale</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {products.map((product) => (
                        <tr key={product.productId}>
                          <td className="px-6 py-3">
                            <Link
                              to={`/app/inventory/${product.productId}`}
                              className="font-medium text-brand-700 hover:underline"
                            >
                              {product.name}
                            </Link>
                            <p className="font-mono text-xs text-slate-500">{product.sku}</p>
                          </td>
                          <td
                            className={`px-6 py-3 text-right ${
                              product.currentStock <= 0 ? 'font-semibold text-red-600' : 'text-slate-900'
                            }`}
                          >
                            {product.currentStock}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-600">
                            {product.unitsSold}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-900">
                            {formatAmount(product.revenue)}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-600">
                            {product.averageDailySales}
                          </td>
                          <td className="px-6 py-3 text-slate-500">
                            {formatDate(product.lastSaleAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>

          {/* ---- Supplier performance ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
              Supplier performance
            </h2>
            <Card>
              {suppliers === null || suppliers.length === 0 ? (
                <EmptyState
                  title="No suppliers yet"
                  description="Add a supplier to start tracking order and lead-time history."
                  action={
                    <Link to="/app/suppliers">
                      <SecondaryButton>Go to suppliers</SecondaryButton>
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th scope="col" className="px-6 py-3 font-medium">Supplier</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Orders</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Received</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Value</th>
                        <th scope="col" className="px-6 py-3 text-right font-medium">Avg lead time</th>
                        <th scope="col" className="px-6 py-3 font-medium">Last received</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {suppliers.map((supplier) => (
                        <tr key={supplier.supplierId}>
                          <td className="px-6 py-3">
                            <span className="font-medium text-slate-900">
                              {supplier.supplierName}
                            </span>
                            {!supplier.isActive ? (
                              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                                inactive
                              </span>
                            ) : null}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-600">
                            {supplier.purchaseOrderCount}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-600">
                            {supplier.unitsReceived}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-900">
                            {formatAmount(supplier.purchaseValue)}
                          </td>
                          <td className="px-6 py-3 text-right text-slate-600">
                            {supplier.averageLeadTimeDays === null
                              ? '—'
                              : `${supplier.averageLeadTimeDays.toFixed(1)} d`}
                          </td>
                          <td className="px-6 py-3 text-slate-500">
                            {formatDateTime(supplier.lastReceivedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
