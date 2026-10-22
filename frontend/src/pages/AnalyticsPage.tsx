/**
 * Analytics page. Values are read from the server's analytics and risk APIs;
 * the browser only formats them and draws views of the returned series.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { catalogApi, type Category } from '../lib/catalog';
import {
  analyticsApi,
  formatAmount,
  type GroupBy,
  type InventoryAnalytics,
  type ListMeta,
  type Overview,
  type ProductAnalytics,
  type SalesAnalytics,
  type SupplierAnalytics,
} from '../lib/analytics';
import { intelligenceApi, type RiskLevel } from '../lib/intelligence';
import { ApiError } from '../lib/request';

type MetricTone = 'emerald' | 'blue' | 'amber' | 'rose';
type MetricIcon = 'received' | 'issued' | 'sales' | 'movement' | 'revenue' | 'risk';

const RANGE_DAYS = 30;
const PAGE_SIZE = 20;
const METRIC_ICON_PATH: Record<MetricIcon, string> = {
  received: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3',
  issued: 'M12 21V9m0 0 4 4m-4-4-4 4M4 4v-1h16v1',
  sales: 'M4 19V5M4 19h16M7 15l4-4 3 2 5-6',
  movement: 'M4 7h11m0 0-3-3m3 3-3 3M20 17H9m0 0 3 3m-3-3 3-3',
  revenue: 'M12 2v20m5-15c0-1.7-2.2-3-5-3S7 5.3 7 7s2.2 3 5 3 5 1.3 5 3-2.2 3-5 3-5-1.3-5-3',
  risk: 'M12 3 2.8 20.5h18.4zM12 9v5M12 17v.1',
};

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatQuantity(value: number | string): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatPeriod(value: string, groupBy: GroupBy): string {
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = { month: 'short', timeZone: 'UTC' };
  if (groupBy === 'month') options.year = '2-digit';
  else options.day = 'numeric';
  return date.toLocaleDateString(undefined, options);
}

function MetricSymbol({ icon }: { icon: MetricIcon }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={METRIC_ICON_PATH[icon]} />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: MetricTone;
  icon: MetricIcon;
}) {
  const toneStyles: Record<MetricTone, { icon: string; value: string }> = {
    emerald: { icon: 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300', value: 'text-white' },
    blue: { icon: 'border-sky-400/15 bg-sky-400/[0.08] text-sky-300', value: 'text-white' },
    amber: { icon: 'border-amber-400/15 bg-amber-400/[0.08] text-amber-200', value: 'text-amber-100' },
    rose: { icon: 'border-rose-400/15 bg-rose-400/[0.08] text-rose-300', value: 'text-rose-200' },
  };
  const styles = toneStyles[tone];

  return (
    <article className="min-w-0 rounded-2xl border border-slate-800/90 bg-[#101a2a] p-4 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
          <p className={'mt-2 truncate text-2xl font-semibold tracking-tight sm:text-[1.7rem] ' + styles.value}>{value}</p>
        </div>
        <span className={'grid h-9 w-9 shrink-0 place-items-center rounded-xl border ' + styles.icon}>
          <MetricSymbol icon={icon} />
        </span>
      </div>
      <p className="mt-2 min-h-8 text-xs leading-4 text-slate-500">{hint}</p>
    </article>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={'min-w-0 overflow-hidden rounded-2xl border border-slate-800/90 bg-[#101a2a] shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)] ' + className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 sm:text-base">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelMessage({ children, loading = false }: { children: React.ReactNode; loading?: boolean }) {
  return (
    <div role="status" className="px-5 py-10 text-center sm:px-6">
      {loading ? <span aria-hidden="true" className="mx-auto mb-3 block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400 motion-reduce:animate-none" /> : null}
      <p className="text-sm font-medium text-slate-300">{children}</p>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 text-xs font-medium text-slate-400">
      {label}
      {children}
    </label>
  );
}

const controlClass = 'mt-1 block h-10 w-full min-w-0 rounded-lg border border-slate-700/80 bg-[#0b1220] px-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15 scheme-dark';
const buttonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400';

function SalesTrendChart({ sales }: { sales: SalesAnalytics }) {
  const width = 720;
  const height = 270;
  const left = 48;
  const right = 704;
  const top = 22;
  const bottom = 218;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const values = sales.series.map((point) => point.unitsSold);
  const maxValue = Math.max(1, ...values);
  const barWidth = Math.min(18, Math.max(5, (plotWidth / Math.max(values.length, 1)) * 0.52));
  const xAt = (index: number) => values.length <= 1 ? left + plotWidth / 2 : left + (plotWidth * index) / (values.length - 1);
  const yAt = (value: number) => bottom - (Math.max(0, value) / maxValue) * plotHeight;
  const ticks = Array.from(new Set([0, Math.ceil(maxValue / 2), maxValue]));
  const labelIndexes = Array.from(new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])).filter((index) => index >= 0);

  return (
    <div className="px-4 pb-4 pt-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Units sold
          <span className="text-slate-600">·</span>
          <span>Completed sales</span>
        </div>
        <span className="text-xs text-slate-500">{formatCount(sales.series.length)} active {sales.groupBy} {sales.series.length === 1 ? 'period' : 'periods'}</span>
      </div>
      <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label={'Units sold by ' + sales.groupBy + '. Periods without completed sales are omitted.'} className="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="analytics-sales-bars" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.32" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line x1={left} x2={right} y1={y} y2={y} stroke="#233044" strokeDasharray="3 6" />
              <text x={left - 10} y={y + 4} textAnchor="end" fill="#718096" fontSize="11">{formatQuantity(tick)}</text>
            </g>
          );
        })}
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#334155" />
        {sales.series.map((point, index) => {
          const x = xAt(index);
          const y = yAt(point.unitsSold);
          const barHeight = Math.max(0, bottom - y);
          return (
            <g key={point.period}>
              <rect x={x - barWidth / 2} y={y} width={barWidth} height={barHeight} rx="4" fill="url(#analytics-sales-bars)">
                <title>{formatPeriod(point.period, sales.groupBy) + ': ' + formatCount(point.unitsSold) + ' units sold across ' + formatCount(point.salesCount) + ' sales'}</title>
              </rect>
            </g>
          );
        })}
        {labelIndexes.map((index) => {
          const point = sales.series[index];
          if (!point) return null;
          return <text key={point.period} x={xAt(index)} y={bottom + 26} textAnchor="middle" fill="#718096" fontSize="11">{formatPeriod(point.period, sales.groupBy)}</text>;
        })}
      </svg>
      <p className="mt-2 text-[11px] leading-5 text-slate-600">The API returns periods with completed sales; periods without sales are omitted.</p>
    </div>
  );
}

function MovementBreakdown({ inventory }: { inventory: InventoryAnalytics }) {
  const rows = [
    { label: 'Received', value: inventory.movements.inQuantity, color: 'bg-emerald-400' },
    { label: 'Issued', value: inventory.movements.outQuantity, color: 'bg-sky-400' },
    { label: 'Adjustments', value: inventory.movements.adjustmentQuantity, color: 'bg-amber-300' },
  ];
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

  return (
    <div className="space-y-5 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Net movement</p>
          <p className={'mt-1 text-2xl font-semibold tracking-tight ' + (Number(inventory.movements.netMovement) < 0 ? 'text-amber-200' : 'text-emerald-200')}>
            {formatQuantity(inventory.movements.netMovement)} <span className="text-sm font-medium text-slate-500">units</span>
          </p>
        </div>
        <p className="text-xs text-slate-500">{formatCount(inventory.movements.movementCount)} ledger entries</p>
      </div>
      <div className="space-y-4 rounded-xl border border-slate-800/80 bg-[#0c1523] p-4 sm:p-5" role="group" aria-label="Stock movement totals">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[76px_minmax(0,1fr)_58px] items-center gap-3">
            <span className="text-xs text-slate-400">{row.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
              <span className={'block h-full rounded-full ' + row.color} style={{ width: String((Math.abs(row.value) / maxValue) * 100) + '%' }} />
            </div>
            <span className="text-right text-xs font-medium tabular-nums text-slate-300">{formatQuantity(row.value)}</span>
          </div>
        ))}
      </div>
      {inventory.movements.movementCount === 0 ? <p className="text-xs text-slate-500">No stock movements were recorded in this date range.</p> : null}
      <p className="text-[11px] leading-5 text-slate-600">Totals are from the stock ledger for the selected dates; adjustment quantities may be positive or negative.</p>
    </div>
  );
}

function InventoryHealth({ overview }: { overview: Overview }) {
  const totalProducts = overview.products.totalProducts;
  const inStock = overview.inventory.productsWithStock;
  const outOfStock = overview.inventory.outOfStockProducts;
  const inStockPercent = totalProducts > 0 ? (inStock / totalProducts) * 100 : 0;
  const outOfStockPercent = totalProducts > 0 ? (outOfStock / totalProducts) * 100 : 0;

  return (
    <div className="px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Products in catalog</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white">{formatCount(totalProducts)}</p>
        </div>
        <span className="rounded-full border border-slate-700/80 bg-slate-900/50 px-2.5 py-1 text-[11px] text-slate-400">Current stock snapshot</span>
      </div>
      {totalProducts > 0 ? (
        <div className="mt-6" role="img" aria-label={formatCount(inStock) + ' products with stock and ' + formatCount(outOfStock) + ' out of stock, out of ' + formatCount(totalProducts) + ' total products'}>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
            <span className="h-full bg-emerald-400" style={{ width: String(inStockPercent) + '%' }} />
            <span className="h-full bg-rose-400/80" style={{ width: String(outOfStockPercent) + '%' }} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">With stock</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-200">{formatCount(inStock)} <span className="text-xs font-normal text-slate-500">· {formatQuantity(inStockPercent)}%</span></p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">Out of stock</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-200">{formatCount(outOfStock)} <span className="text-xs font-normal text-slate-500">· {formatQuantity(outOfStockPercent)}%</span></p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-700 px-4 py-5 text-sm text-slate-400">Add products to see the stock health breakdown.</p>
      )}
      <p className="mt-5 border-t border-slate-800/80 pt-4 text-xs text-slate-500">
        {formatCount(overview.inventory.productsWithNoMovements)} products have no recorded stock movements.
      </p>
    </div>
  );
}

function DataUnavailable({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return <PanelMessage loading={loading}>{children}</PanelMessage>;
}

function ProductPerformance({
  products,
  meta,
  loading,
  page,
  onPageChange,
}: {
  products: ProductAnalytics[] | null;
  meta: ListMeta | null;
  loading: boolean;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const previousPage = () => onPageChange(Math.max(1, page - 1));
  const nextPage = () => onPageChange(Math.min(meta?.totalPages ?? page, page + 1));

  return (
    <SectionCard
      title="Product performance"
      subtitle="Sales and current stock by product. The API lists products alphabetically, not as a ranked top-movers list."
      action={meta && meta.total > PAGE_SIZE ? <span className="text-xs text-slate-500">{formatCount(meta.total)} products</span> : undefined}
    >
      {products === null ? (
        <DataUnavailable loading={loading}>Product analytics are unavailable right now.</DataUnavailable>
      ) : products.length === 0 ? (
        <PanelMessage>No products match this category in the selected period.</PanelMessage>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="border-b border-slate-800/80 bg-[#0c1523] text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium sm:px-6">Product</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">On hand</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Units sold</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Revenue</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Last sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {products.map((product) => (
                  <tr key={product.productId} className="transition hover:bg-white/[0.02]">
                    <td className="px-5 py-3.5 sm:px-6">
                      <Link to={'/app/inventory/' + product.productId} className="font-medium text-slate-200 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{product.name}</Link>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-600">{product.sku}{product.category ? ' · ' + product.category.name : ''}</p>
                    </td>
                    <td className={'px-4 py-3.5 text-right tabular-nums ' + (product.currentStock <= 0 ? 'text-rose-300' : 'text-slate-300')}>{formatQuantity(product.currentStock)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{formatQuantity(product.unitsSold)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{formatAmount(product.revenue)}</td>
                    <td className="px-5 py-3.5 text-right text-xs text-slate-500 sm:px-6">{formatDate(product.lastSaleAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta && meta.totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 px-5 py-3 sm:px-6">
              <p className="text-xs text-slate-500">Page {formatCount(page)} of {formatCount(meta.totalPages)} · alphabetical order</p>
              <div className="flex gap-2">
                <button type="button" onClick={previousPage} disabled={page <= 1 || loading} className={buttonClass}>Previous</button>
                <button type="button" onClick={nextPage} disabled={page >= meta.totalPages || loading} className={buttonClass}>Next</button>
              </div>
            </div>
          ) : meta ? <p className="border-t border-slate-800/80 px-5 py-3 text-xs text-slate-500 sm:px-6">Products shown in alphabetical order.</p> : null}
        </>
      )}
    </SectionCard>
  );
}

function SupplierPerformance({ suppliers, loading }: { suppliers: SupplierAnalytics[] | null; loading: boolean }) {
  return (
    <SectionCard title="Supplier performance" subtitle="Purchase order and receipt history returned by the supplier analytics API.">
      {suppliers === null ? (
        <DataUnavailable loading={loading}>Supplier analytics are unavailable right now.</DataUnavailable>
      ) : suppliers.length === 0 ? (
        <PanelMessage>No supplier activity is available yet.</PanelMessage>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-slate-800/80 bg-[#0c1523] text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium sm:px-6">Supplier</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Orders</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Units received</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Purchase value</th>
                <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Avg. lead time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {suppliers.map((supplier) => (
                <tr key={supplier.supplierId} className="transition hover:bg-white/[0.02]">
                  <td className="px-5 py-3.5 sm:px-6">
                    <Link to="/app/suppliers" className="font-medium text-slate-200 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{supplier.supplierName}</Link>
                    {!supplier.isActive ? <span className="ml-2 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">inactive</span> : null}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{formatCount(supplier.purchaseOrderCount)}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{formatQuantity(supplier.unitsReceived)}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-300">{formatAmount(supplier.purchaseValue)}</td>
                  <td className="px-5 py-3.5 text-right text-slate-400 sm:px-6">{supplier.averageLeadTimeDays === null ? '—' : formatQuantity(supplier.averageLeadTimeDays) + ' days'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function AnalyticsPage() {
  const [from, setFrom] = useState(() => isoDateDaysAgo(RANGE_DAYS));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [categoryId, setCategoryId] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [sales, setSales] = useState<SalesAnalytics | null>(null);
  const [inventory, setInventory] = useState<InventoryAnalytics | null>(null);
  const [products, setProducts] = useState<ProductAnalytics[] | null>(null);
  const [productMeta, setProductMeta] = useState<ListMeta | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierAnalytics[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [riskCounts, setRiskCounts] = useState<Partial<Record<RiskLevel, number>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      /*
       * Both branches — the invalid-range short circuit and the real fetch —
       * set state, so both run inside the async continuation. Doing the range
       * check inside the effect body would have made the invalid-range branch a
       * synchronous setState on every keystroke that momentarily empties a
       * date field.
       */
      if (!from || !to || from > to) {
        setLoading(false);
        setSales(null);
        setInventory(null);
        setProducts(null);
        setProductMeta(null);
        setError('Choose a valid date range. The start date must be on or before the end date.');
        return;
      }

      setLoading(true);
      setError(null);
      const range = { from, to, groupBy };

      /*
       * `sales` buckets its trend by `groupBy`, but the inventory endpoint's
       * schema is strict and accepts only `{ from, to }`. Sending `range`
       * here returned 400 "Unrecognized key: groupBy" and blanked the stock
       * received / units issued / net movement figures on every load.
       */
      const dateRange = { from, to };

      const [overviewResult, salesResult, inventoryResult, productsResult, suppliersResult, categoriesResult, riskResult] = await Promise.allSettled([
        analyticsApi.overview(),
        analyticsApi.sales(range),
        analyticsApi.inventory(dateRange),
        analyticsApi.products({ ...range, categoryId: categoryId || undefined, page: productPage, limit: PAGE_SIZE }),
        analyticsApi.suppliers(),
        catalogApi.listCategories(),
        intelligenceApi.list({ page: 1, limit: 1 }),
      ]);
      if (cancelled) return;
      const failures: string[] = [];
      const noteFailure = (label: string, cause: unknown) => {
        const message = cause instanceof ApiError ? cause.message : 'could not be loaded';
        failures.push(label + ': ' + message);
      };

      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
      else { setOverview(null); noteFailure('Overview', overviewResult.reason); }

      if (salesResult.status === 'fulfilled') setSales(salesResult.value);
      else { setSales(null); noteFailure('Sales trend', salesResult.reason); }

      if (inventoryResult.status === 'fulfilled') setInventory(inventoryResult.value);
      else { setInventory(null); noteFailure('Stock movement', inventoryResult.reason); }

      if (productsResult.status === 'fulfilled') {
        setProducts(productsResult.value.items);
        setProductMeta(productsResult.value.meta);
      } else {
        setProducts(null);
        setProductMeta(null);
        noteFailure('Product performance', productsResult.reason);
      }

      if (suppliersResult.status === 'fulfilled') setSuppliers(suppliersResult.value);
      else { setSuppliers(null); noteFailure('Supplier performance', suppliersResult.reason); }

      if (categoriesResult.status === 'fulfilled') setCategories(categoriesResult.value);
      else { setCategories([]); noteFailure('Categories', categoriesResult.reason); }

      if (riskResult.status === 'fulfilled') setRiskCounts(riskResult.value.riskCounts ?? null);
      else { setRiskCounts(null); noteFailure('Stock risk', riskResult.reason); }

      setError(failures.length > 0 ? 'Some analytics could not be loaded. ' + failures.join(' · ') : null);

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [from, to, groupBy, categoryId, productPage, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  function resetRange() {
    setFrom(isoDateDaysAgo(RANGE_DAYS));
    setTo(new Date().toISOString().slice(0, 10));
    setGroupBy('day');
    setProductPage(1);
  }

  const criticalRisk = riskCounts?.CRITICAL;
  const lowRisk = riskCounts?.LOW;
  const atRiskCount = criticalRisk !== undefined && lowRisk !== undefined ? criticalRisk + lowRisk : null;
  const hasNoActivity = Boolean(
    overview && sales && inventory && overview.products.totalProducts === 0 &&
    sales.summary.salesCount === 0 && inventory.movements.movementCount === 0,
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 sm:space-y-7" aria-busy={loading}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-emerald-300 uppercase">Performance overview</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Analytics</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Understand your stock movement, sales performance, and inventory trends.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 text-right">
            <p className="text-xs text-slate-500">{loading ? 'Updating analytics…' : overview ? 'Updated ' + formatDateTime(overview.generatedAt) : 'Analytics status'}</p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className={'h-1.5 w-1.5 rounded-full ' + (loading ? 'animate-pulse bg-amber-300' : error ? 'bg-amber-300' : 'bg-emerald-300')} />
              {loading ? 'Refreshing data' : error ? 'Partial data' : 'Server analytics'}
            </p>
          </div>
          <button type="button" onClick={refresh} disabled={loading} className={buttonClass}>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 7A6.8 6.8 0 0 0 4 5.4L3 6.5M3 3.5v3h3M3.5 13A6.8 6.8 0 0 0 16 14.6l1-1.1m0 3v-3h-3" /></svg>
            Refresh
          </button>
        </div>
      </header>

      {error ? <div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm leading-6 text-amber-100">{error}</div> : null}

      <section aria-label="Analytics filters" className="rounded-2xl border border-slate-800/90 bg-[#101a2a] p-4 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)] sm:p-5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_minmax(130px,0.9fr)_minmax(150px,1.1fr)_auto] xl:items-end">
          <FilterField label="From">
            <input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setProductPage(1); }} className={controlClass} />
          </FilterField>
          <FilterField label="To">
            <input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setProductPage(1); }} className={controlClass} />
          </FilterField>
          <FilterField label="Sales interval">
            <select value={groupBy} onChange={(event) => { setGroupBy(event.target.value as GroupBy); setProductPage(1); }} className={controlClass}>
              <option value="day">By day</option>
              <option value="week">By week</option>
              <option value="month">By month</option>
            </select>
          </FilterField>
          {categories.length > 0 ? (
            <FilterField label="Product category">
              <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setProductPage(1); }} className={controlClass}>
                <option value="">All categories</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </FilterField>
          ) : null}
          <button type="button" onClick={resetRange} className={buttonClass}>Reset 30 days</button>
        </div>
        <p className="mt-3 text-[11px] text-slate-600">The selected dates filter sales, stock movements, and product sales. Inventory health is a current snapshot; supplier figures are historical totals.</p>
      </section>

      <section aria-label="Analytics key metrics" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="Stock received" value={inventory ? formatQuantity(inventory.movements.inQuantity) : '—'} hint={inventory ? 'Units entered in the selected range' : 'Stock movement data unavailable'} tone="emerald" icon="received" />
        <MetricCard label="Units issued" value={inventory ? formatQuantity(inventory.movements.outQuantity) : '—'} hint={inventory ? 'Outgoing ledger quantity in range' : 'Stock movement data unavailable'} tone="blue" icon="issued" />
        <MetricCard label="Units sold" value={sales ? formatQuantity(sales.summary.unitsSold) : '—'} hint={sales ? formatCount(sales.summary.salesCount) + ' completed sales in range' : 'Sales data unavailable'} tone="emerald" icon="sales" />
        <MetricCard label="Net stock movement" value={inventory ? formatQuantity(inventory.movements.netMovement) : '—'} hint={inventory ? 'Server-calculated ledger effect for this range' : 'Stock movement data unavailable'} tone={inventory && Number(inventory.movements.netMovement) < 0 ? 'amber' : 'blue'} icon="movement" />
        <MetricCard label="Sales revenue" value={sales ? formatAmount(sales.summary.revenue) : '—'} hint={sales ? 'Completed sales in selected range' : 'Sales data unavailable'} tone="blue" icon="revenue" />
        <MetricCard label="Critical + low risk" value={atRiskCount === null ? '—' : formatCount(atRiskCount)} hint={atRiskCount === null ? 'Stock-risk counts unavailable' : 'Current server-assessed active products'} tone="amber" icon="risk" />
      </section>

      {hasNoActivity ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-dashed border-slate-700 bg-[#0d1726] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="font-semibold text-slate-100">Your analytics will build as you work</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">Add products, record stock movements, and complete sales to see your real inventory activity here.</p>
          </div>
          <Link to="/app/products" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-[#06251a] transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">Add a product</Link>
        </section>
      ) : null}

      <section aria-label="Sales and stock movement charts" className="grid min-w-0 gap-5 xl:grid-cols-2">
        <SectionCard title="Sales trend" subtitle={'Units sold by ' + groupBy + ' for the selected date range.'}>
          {sales ? sales.series.length > 0 ? <SalesTrendChart sales={sales} /> : <PanelMessage>No completed sales fall within the selected date range.</PanelMessage> : <DataUnavailable loading={loading}>Sales trend is unavailable.</DataUnavailable>}
        </SectionCard>
        <SectionCard title="Stock movement" subtitle="Received, issued, and adjustment quantities from the stock ledger.">
          {inventory ? <MovementBreakdown inventory={inventory} /> : <DataUnavailable loading={loading}>Stock movement totals are unavailable.</DataUnavailable>}
        </SectionCard>
      </section>

      <section aria-label="Inventory health and product performance" className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <SectionCard title="Inventory health" subtitle="Current catalog stock position, independent of the selected date range.">
          {overview ? <InventoryHealth overview={overview} /> : <DataUnavailable loading={loading}>Inventory health is unavailable.</DataUnavailable>}
        </SectionCard>
        <ProductPerformance products={products} meta={productMeta} loading={loading} page={productPage} onPageChange={setProductPage} />
      </section>

      <SupplierPerformance suppliers={suppliers} loading={loading} />

      {overview ? <p className="text-right text-[11px] text-slate-600">Current inventory and catalog snapshot generated {formatDateTime(overview.generatedAt)}.</p> : null}
    </div>
  );
}

