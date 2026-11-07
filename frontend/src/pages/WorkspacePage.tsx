/**
 * StockPilot workspace overview.
 *
 * The signed-in dashboard reads only from existing API contracts. The local
 * preview account has a separate, plainly labelled sample view so the layout can
 * be explored while the API is unavailable.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { secondaryButtonClass } from '../components/ui';
import { analyticsApi, type InventoryAnalytics, type Overview } from '../lib/analytics';
import { intelligenceApi, type StockRisk } from '../lib/intelligence';
import { purchaseOrderApi, type PurchaseOrder } from '../lib/purchasing';
import { salesApi, type Sale } from '../lib/sales';

type AttentionItem = {
  id: string;
  sku: string;
  name: string;
  currentStock: string;
  risk: 'CRITICAL' | 'LOW';
};

type DashboardData = {
  overview: Overview | null;
  inventory: InventoryAnalytics | null;
  lowStockCount: number | null;
  attention: AttentionItem[] | null;
  pendingOrderCount: number | null;
  purchaseOrders: PurchaseOrder[] | null;
  sales: Sale[] | null;
};

type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  icon: 'products' | 'stock' | 'alert' | 'empty' | 'orders' | 'sales';
  tone?: 'emerald' | 'amber' | 'red' | 'blue';
};

const SAMPLE_DASHBOARD: DashboardData = {
  overview: {
    products: { totalProducts: 128, activeProducts: 116, inactiveProducts: 12 },
    inventory: {
      totalStockUnits: 4628,
      productsWithStock: 109,
      outOfStockProducts: 7,
      productsWithNoMovements: 3,
    },
    sales: {
      today: { salesCount: 4, unitsSold: 18, revenue: '482.00' },
      last7Days: { salesCount: 37, unitsSold: 214, revenue: '5840.00' },
      last30Days: { salesCount: 142, unitsSold: 843, revenue: '22890.00' },
    },
    purchasing: {
      purchaseOrdersLast30Days: 18,
      purchaseValueLast30Days: '11640.00',
      unitsReceivedLast30Days: 1420,
    },
    generatedAt: new Date().toISOString(),
  },
  inventory: {
    currentStock: {
      totalStockUnits: 4628,
      productsWithStock: 109,
      outOfStockProducts: 7,
      productsWithNoMovements: 3,
    },
    movements: {
      inQuantity: 1420,
      outQuantity: 986,
      adjustmentQuantity: 42,
      netMovement: '434.00',
      movementCount: 196,
    },
    analysisWindow: {
      from: new Date(Date.now() - 29 * 86_400_000).toISOString(),
      toExclusive: new Date().toISOString(),
      days: 30,
    },
  },
  lowStockCount: 16,
  attention: [
    { id: 'demo-oat-milk', sku: 'SKU-2071', name: 'Oat Milk 1L', currentStock: '6', risk: 'CRITICAL' },
    { id: 'demo-espresso', sku: 'SKU-1042', name: 'Espresso Beans 1kg', currentStock: '9', risk: 'LOW' },
    { id: 'demo-cups', sku: 'SKU-3390', name: 'Ceramic Mug', currentStock: '4', risk: 'LOW' },
  ],
  pendingOrderCount: 5,
  purchaseOrders: [
    { id: 'demo-po-1048', supplierId: 'demo-supplier-1', supplierName: 'Northstar Foods', status: 'ordered', totalAmount: '0', orderedAt: null, expectedAt: null, receivedAt: null, notes: null, createdBy: { id: 'demo-preview-user', name: 'Demo User' }, itemCount: 4, createdAt: new Date(Date.now() - 1_800_000).toISOString() },
    { id: 'demo-po-1047', supplierId: 'demo-supplier-2', supplierName: 'Harbor Supply Co.', status: 'partially_received', totalAmount: '0', orderedAt: null, expectedAt: null, receivedAt: null, notes: null, createdBy: { id: 'demo-preview-user', name: 'Demo User' }, itemCount: 2, createdAt: new Date(Date.now() - 86_400_000).toISOString() },
    { id: 'demo-po-1046', supplierId: 'demo-supplier-1', supplierName: 'Northstar Foods', status: 'draft', totalAmount: '0', orderedAt: null, expectedAt: null, receivedAt: null, notes: null, createdBy: { id: 'demo-preview-user', name: 'Demo User' }, itemCount: 3, createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  ],
  sales: [
    { id: 'demo-sale-1', customerName: 'Walk-in sale', customerPhone: null, totalAmount: '0', status: 'completed', soldAt: new Date(Date.now() - 900_000).toISOString(), createdBy: { id: 'demo-preview-user', name: 'Demo User' }, itemCount: 3 },
    { id: 'demo-sale-2', customerName: 'Harbor Café', customerPhone: null, totalAmount: '0', status: 'completed', soldAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), createdBy: { id: 'demo-preview-user', name: 'Demo User' }, itemCount: 2 },
    { id: 'demo-sale-3', customerName: null, customerPhone: null, totalAmount: '0', status: 'completed', soldAt: new Date(Date.now() - 22 * 3_600_000).toISOString(), createdBy: { id: 'demo-preview-user', name: 'Demo User' }, itemCount: 1 },
  ],
};

const RISK_LABEL: Record<'CRITICAL' | 'LOW', string> = {
  CRITICAL: 'Critical',
  LOW: 'Low stock',
};

const SHORTCUTS = [
  { to: '/app/products', label: 'Manage products', icon: 'products', tone: 'blue' },
  { to: '/app/purchase-orders', label: 'Review orders', icon: 'orders', tone: 'blue' },
  { to: '/app/sales', label: 'View sales', icon: 'sales', tone: 'emerald' },
] as const;

function iconPath(icon: DashboardMetric['icon']): string {
  const paths: Record<DashboardMetric['icon'], string> = {
    products: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z M12 12v9 M4 7.5 12 12l8-4.5',
    stock: 'M4 5h16v14H4z M8 9h8 M8 13h5 M8 16h3',
    alert: 'M12 3 2.8 20h18.4z M12 9v5 M12 17v.1',
    empty: 'M5 5h14v14H5z M8 8h8 M8 12h8 M8 16h4',
    orders: 'M6 3h9l4 4v14H6z M15 3v5h4 M9 12h7 M9 16h7',
    sales: 'M4 19V5 M4 19h16 M7 15l4-4 3 2 5-6',
  };
  return paths[icon];
}

function MetricIcon({ icon, tone = 'emerald' }: { icon: DashboardMetric['icon']; tone?: DashboardMetric['tone'] }) {
  const colors = {
    emerald: 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-700',
    amber: 'border-amber-400/15 bg-amber-400/[0.08] text-amber-700',
    red: 'border-rose-400/15 bg-rose-400/[0.08] text-rose-700',
    blue: 'border-sky-400/15 bg-sky-400/[0.08] text-sky-700',
  };

  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${colors[tone]}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={iconPath(icon)} />
      </svg>
    </span>
  );
}

function MetricCard({ metric }: { metric: DashboardMetric }) {
  const valueColor = metric.tone === 'red'
    ? 'text-rose-700'
    : metric.tone === 'amber'
      ? 'text-amber-700'
      : 'text-slate-950';

  return (
    <article className="workspace-metric">
      <MetricIcon icon={metric.icon} tone={metric.tone} />
      <p className="workspace-metric-label">{metric.label}</p>
      <p className={`workspace-metric-value mt-1 ${valueColor}`}>{metric.value}</p>
      <p className="workspace-metric-detail">{metric.detail}</p>
    </article>
  );
}

function InventoryIllustration() {
  return (
    <svg className="workspace-hero-art" viewBox="0 0 470 220" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" fill="none">
      <defs>
        <pattern id="workspace-hero-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0H0V30" stroke="#c2ddff" strokeOpacity=".16" />
        </pattern>
        <linearGradient id="workspace-hero-fade">
          <stop stopColor="white" stopOpacity="0" />
          <stop offset=".6" stopColor="white" />
        </linearGradient>
        <mask id="workspace-hero-mask"><path d="M0 0h470v220H0z" fill="url(#workspace-hero-fade)" /></mask>
      </defs>
      <g mask="url(#workspace-hero-mask)">
        <path d="M0 0h470v220H0z" fill="url(#workspace-hero-grid)" />
        <circle cx="320" cy="112" r="91" stroke="#b9d7ff" strokeOpacity=".28" />
        <circle cx="320" cy="112" r="113" stroke="#b9d7ff" strokeOpacity=".22" strokeDasharray="4 6" />
        <path d="M212 145h-29l-19 18h-30m233-87h30l18-16h29M364 148h37l15 15h27" stroke="#a2c6ff" strokeOpacity=".68" />
        <circle cx="134" cy="163" r="3" fill="#b3d4ff" /><circle cx="444" cy="60" r="3" fill="#b3d4ff" /><circle cx="443" cy="163" r="3" fill="#b3d4ff" />
        <path d="m319 44 66 35-66 35-66-35z" fill="#a7caff" fillOpacity=".44" stroke="#c3dcff" strokeWidth="1.4" />
        <path d="m253 79 66 35v65l-66-35z" fill="#4b7ce1" fillOpacity=".88" stroke="#c3dcff" strokeWidth="1.4" />
        <path d="m319 114 66-35v65l-66 35z" fill="#2552ad" stroke="#c3dcff" strokeWidth="1.4" />
        <path d="m278 66 66 35v26l19-10V91l-66-35" fill="#c9e1ff" fillOpacity=".42" stroke="#c3dcff" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="m265 114 25 13m-25-4 19 10" stroke="#d5e7ff" strokeLinecap="round" />
        <path d="M218 57h9m-4.5-4.5v9M422 110h9m-4.5-4.5v9M218 185h9m-4.5-4.5v9" stroke="#c2ddff" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <p role="status" aria-live="polite" className="px-6 py-10 text-center text-sm leading-6 text-slate-500">{children}</p>;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function normaliseAttention(items: StockRisk[]): AttentionItem[] {
  return items
    .filter((item): item is StockRisk & { risk: 'CRITICAL' | 'LOW' } => item.risk === 'CRITICAL' || item.risk === 'LOW')
    .map((item) => ({
      id: item.productId,
      sku: item.sku,
      name: item.name,
      currentStock: item.currentStock,
      risk: item.risk,
    }));
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function makeSampleData(): DashboardData {
  return SAMPLE_DASHBOARD;
}

export function WorkspacePage() {
  const { user } = useAuth();
  const isDevelopmentPreview = import.meta.env.DEV && user?.id === 'dev-preview-user';
  const [data, setData] = useState<DashboardData | null>(() => isDevelopmentPreview ? makeSampleData() : null);
  const [loading, setLoading] = useState(!isDevelopmentPreview);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (isDevelopmentPreview) {
      /*
       * The dev-preview shortcut is a *derived* value, not a fetch: the sample
       * data depends only on props already in scope. Deferring it by one tick
       * keeps every branch of this effect off the synchronous setState path
       * while still running before the first paint the user perceives.
       */
      void Promise.resolve().then(() => {
        setData(makeSampleData());
        setLoading(false);
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);

      const results = await Promise.allSettled([
        analyticsApi.overview(),
        analyticsApi.inventory(),
        intelligenceApi.list({ risk: 'LOW', isActive: 'true', page: 1, limit: 4 }),
        intelligenceApi.list({ risk: 'CRITICAL', isActive: 'true', page: 1, limit: 4 }),
        purchaseOrderApi.list({ status: 'draft', page: 1, limit: 4 }),
        purchaseOrderApi.list({ status: 'ordered', page: 1, limit: 4 }),
        purchaseOrderApi.list({ status: 'partially_received', page: 1, limit: 4 }),
        salesApi.list({ page: 1, limit: 5 }),
      ]);
      if (cancelled) return;
      const [overviewResult, inventoryResult, lowResult, criticalResult, draftResult, orderedResult, partialResult, salesResult] = results;
      const overview = fulfilled(overviewResult);
      const inventory = fulfilled(inventoryResult);
      const low = fulfilled(lowResult);
      const critical = fulfilled(criticalResult);
      const drafts = fulfilled(draftResult);
      const ordered = fulfilled(orderedResult);
      const partial = fulfilled(partialResult);
      const sales = fulfilled(salesResult);

      const allOrderListsAvailable = drafts !== null && ordered !== null && partial !== null;
      const riskCounts = low?.riskCounts;
      const attention = low !== null && critical !== null
        ? [...normaliseAttention(critical.items), ...normaliseAttention(low.items)].slice(0, 5)
        : null;
      const orders = allOrderListsAvailable
        ? [...drafts.items, ...ordered.items, ...partial.items]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, 4)
        : null;

      setData({
        overview,
        inventory,
        lowStockCount: riskCounts
          ? (riskCounts.CRITICAL ?? 0) + (riskCounts.LOW ?? 0)
          : null,
        attention,
        pendingOrderCount: allOrderListsAvailable
          ? drafts.meta.total + ordered.meta.total + partial.meta.total
          : null,
        purchaseOrders: orders,
        sales: sales?.items ?? null,
      });

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isDevelopmentPreview, reloadToken]);

  if (!user) return null;

  const overview = data?.overview ?? null;
  const metrics: DashboardMetric[] = [
    {
      label: 'Total products',
      value: overview ? formatNumber(overview.products.totalProducts) : '—',
      detail: overview ? `${formatNumber(overview.products.activeProducts)} active in catalogue` : 'Live catalogue total',
      icon: 'products',
      tone: 'blue',
    },
    {
      label: 'Units in stock',
      value: overview ? formatNumber(overview.inventory.totalStockUnits) : '—',
      detail: overview ? `${formatNumber(overview.inventory.productsWithStock)} products holding stock` : 'Current ledger balance',
      icon: 'stock',
      tone: 'emerald',
    },
    {
      label: 'Low stock',
      value: data?.lowStockCount !== null && data?.lowStockCount !== undefined ? formatNumber(data.lowStockCount) : '—',
      detail: 'Critical and low risk assessments',
      icon: 'alert',
      tone: 'amber',
    },
    {
      label: 'Out of stock',
      value: overview ? formatNumber(overview.inventory.outOfStockProducts) : '—',
      detail: 'Products with no units available',
      icon: 'empty',
      tone: overview && overview.inventory.outOfStockProducts > 0 ? 'red' : 'emerald',
    },
    {
      label: 'Open purchase orders',
      value: data?.pendingOrderCount !== null && data?.pendingOrderCount !== undefined ? formatNumber(data.pendingOrderCount) : '—',
      detail: 'Draft, ordered, or part received',
      icon: 'orders',
      tone: 'blue',
    },
    {
      label: 'Units sold · 30 days',
      value: overview ? formatNumber(overview.sales.last30Days.unitsSold) : '—',
      detail: overview ? `${formatNumber(overview.sales.last30Days.salesCount)} completed sales` : 'Completed sales',
      icon: 'sales',
      tone: 'emerald',
    },
  ];

  const movement = data?.inventory?.movements;
  const maxMovement = movement ? Math.max(movement.inQuantity, movement.outQuantity, 1) : 1;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 sm:space-y-7">
      <header className="workspace-hero">
        <InventoryIllustration />
        <div className="workspace-hero-copy">
          <p className="workspace-hero-kicker">Workspace overview</p>
          <h1>Welcome back, {user.name.split(' ')[0] || user.name}</h1>
          <p>See where your stock stands, what needs attention, and what moved recently.</p>
        </div>
      </header>

      <section aria-labelledby="inventory-snapshot-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="inventory-snapshot-heading" className="text-lg font-semibold tracking-tight text-slate-900">Inventory snapshot</h2>
            <p role="status" className="text-xs text-slate-500">
              {isDevelopmentPreview ? 'Sample workspace' : loading ? 'Updating workspace…' : overview ? `Updated ${formatDateTime(overview.generatedAt)}` : 'Summary unavailable'}
            </p>
          </div>
          {isDevelopmentPreview ? null : (
            <button type="button" onClick={() => setReloadToken((token) => token + 1)} disabled={loading} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16.5 7A6.8 6.8 0 0 0 4 5.4L3 6.5M3 3.5v3h3M3.5 13A6.8 6.8 0 0 0 16 14.6l1-1.1m0 3v-3h-3" />
              </svg>
              Refresh
            </button>
          )}
        </div>
        <div className="workspace-metric-grid">
          {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
        </div>
      </section>

      <section aria-label="Stock overview and alerts" className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.9fr)]">
        <Panel title="Inventory overview" subtitle="Stock movement recorded in the last 30 days" action={<Link to="/app/inventory" className="rounded-md text-xs font-medium text-brand-600 transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">View inventory <span aria-hidden="true">→</span></Link>}>
          {movement ? (
            <div className="p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs tracking-wide text-slate-500 uppercase">Units moved</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{formatNumber(movement.inQuantity + movement.outQuantity)}</p>
                </div>
                <p className="text-xs text-slate-500">{formatNumber(movement.movementCount)} ledger entries</p>
              </div>
              <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <MovementBar label="Stock received" value={movement.inQuantity} max={maxMovement} tone="emerald" />
                <MovementBar label="Stock issued" value={movement.outQuantity} max={maxMovement} tone="blue" />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <span>Adjustments: <strong className="font-medium text-slate-700">{formatNumber(movement.adjustmentQuantity)} units</strong></span>
                <span>Based on recorded ledger movements</span>
              </div>
            </div>
          ) : (
            <EmptyPanel>{loading ? 'Loading inventory movement…' : 'Inventory movement is unavailable right now.'}</EmptyPanel>
          )}
        </Panel>

        <Panel title="Low stock watch" subtitle="Products with low or critical stock" action={<Link to="/app/stock-risk" className="rounded-md text-xs font-medium text-brand-600 transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">Review all <span aria-hidden="true">→</span></Link>}>
          {data?.attention ? data.attention.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {data.attention.map((item) => (
                <li key={item.id} className="flex min-w-0 items-center gap-3 px-5 py-4 sm:px-6">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${item.risk === 'CRITICAL' ? 'border-rose-400/15 bg-rose-400/[0.08] text-rose-700' : 'border-amber-400/15 bg-amber-400/[0.08] text-amber-700'}`}>
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2.5 2.4 17h15.2zM10 7v4.2M10 14.2v.1" /></svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{item.sku} <span className="px-1 text-slate-700">·</span> {item.currentStock} units on hand</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${item.risk === 'CRITICAL' ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-700' : 'border-amber-400/20 bg-amber-400/[0.08] text-amber-700'}`}>{RISK_LABEL[item.risk]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel>No low or critical stock alerts.</EmptyPanel>
          ) : (
            <EmptyPanel>{loading ? 'Reviewing stock risk…' : 'Stock-risk information is unavailable right now.'}</EmptyPanel>
          )}
          {data?.lowStockCount !== null && data?.lowStockCount !== undefined ? (
            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 sm:px-6">
              {formatNumber(data.lowStockCount)} critical or low risk items across active products
            </div>
          ) : null}
        </Panel>
      </section>

      <section aria-labelledby="workspace-shortcuts-heading" className="rounded-xl border border-slate-200 bg-slate-100/60 p-4 sm:p-5">
        <h2 id="workspace-shortcuts-heading" className="mb-3 text-sm font-semibold text-slate-900">Quick links</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {SHORTCUTS.map(({ to, label, icon, tone }) => (
            <Link key={to} to={to} className="workspace-shortcut focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
              <MetricIcon icon={icon} tone={tone} />
              <span>{label}</span>
              <span aria-hidden="true" className="workspace-shortcut-arrow">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Recent workspace activity" className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Panel title="Recent activity" subtitle="Latest completed sales" action={<Link to="/app/sales" className="rounded-md text-xs font-medium text-brand-600 transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">Sales history <span aria-hidden="true">→</span></Link>}>
          {data?.sales ? data.sales.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {data.sales.slice(0, 5).map((sale) => (
                <li key={sale.id} className="flex min-w-0 items-center gap-3 px-5 py-4 sm:px-6">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-700">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h10v13H5zM7.5 7h5M7.5 10h5M7.5 13h3" /></svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{sale.customerName?.trim() || 'Walk-in sale'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{formatNumber(sale.itemCount)} {sale.itemCount === 1 ? 'item' : 'items'} recorded</p>
                  </div>
                  <time dateTime={sale.soldAt} className="shrink-0 text-xs text-slate-500">{formatDateTime(sale.soldAt)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel>No sales have been recorded yet.</EmptyPanel>
          ) : (
            <EmptyPanel>{loading ? 'Loading recent sales…' : 'Recent activity is unavailable right now.'}</EmptyPanel>
          )}
        </Panel>

        <Panel title="Purchase orders" subtitle="Drafts and orders still in progress" action={<Link to="/app/purchase-orders" className="rounded-md text-xs font-medium text-brand-600 transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">Open orders <span aria-hidden="true">→</span></Link>}>
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
            <span className="text-sm text-slate-600">Open orders</span>
            <span className="text-2xl font-semibold tracking-tight text-slate-950">{data?.pendingOrderCount !== null && data?.pendingOrderCount !== undefined ? formatNumber(data.pendingOrderCount) : '—'}</span>
          </div>
          {data?.purchaseOrders ? data.purchaseOrders.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {data.purchaseOrders.slice(0, 3).map((order) => (
                <li key={order.id} className="flex min-w-0 items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h8l3 3v11H5zM13 3v4h3M8 10h5M8 13h5" /></svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{order.supplierName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{formatNumber(order.itemCount)} {order.itemCount === 1 ? 'line' : 'lines'} <span className="px-1 text-slate-700">·</span> {formatDate(order.createdAt)}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] font-medium capitalize text-slate-700">{order.status.replaceAll('_', ' ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel>No open purchase orders.</EmptyPanel>
          ) : (
            <EmptyPanel>{loading ? 'Loading purchase orders…' : 'Purchase-order information is unavailable right now.'}</EmptyPanel>
          )}
        </Panel>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <span>StockPilot workspace</span>
        <span>{isDevelopmentPreview ? 'Illustrative data only' : overview ? `Data refreshed ${formatDateTime(overview.generatedAt)}` : 'Live figures will appear when data is available'}</span>
      </footer>
    </div>
  );
}

function MovementBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'emerald' | 'blue' }) {
  const width = value === 0 ? 0 : Math.max(3, Math.round((value / max) * 100));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{formatNumber(value)} <span className="text-xs font-normal text-slate-500">units</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${label}: ${formatNumber(value)} units`}>
        <div style={{ width: `${width}%` }} className={`h-full rounded-full ${tone === 'emerald' ? 'bg-gradient-to-r from-emerald-500 to-emerald-300' : 'bg-gradient-to-r from-sky-600 to-sky-400'}`} />
      </div>
    </div>
  );
}
