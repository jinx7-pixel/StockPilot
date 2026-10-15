/**
 * The features section, between the product showcase and the end of the landing
 * page.
 *
 * ## Layout — editorial, not card grid
 *
 * The product section above already uses a 4-card composition: icon, title,
 * body, dashboard preview. Repeating the same shape would read as a duplicate,
 * so the features section uses a different visual language: one editorial
 * featured row followed by three supporting rows. The supporting rows get a
 * subtle outline on desktop, without adding card backgrounds.
 *
 * The composition is:
 *
 *   - a centred header (eyebrow + headline + subhead),
 *   - Smart Stock Control (left, with a small preview to its right), followed
 *     by three supporting rows (Tracking, Analytics, Workspace). The Tracking
 *     preview sits below its text on desktop; the other two previews stay right,
 *   - a single stack on mobile, with the featured item first and the three
 *     supporting items below in the same order they appear on desktop.
 *
 * The featured capability is **Smart Stock Control**. It gets three pieces of
 * emphasis, none of them a giant card: an accent-coloured left border, a
 * brighter title, and a slightly larger preview. Every other row sits in the
 * same horizontal slot, visually subordinate.
 *
 * ## Why this differs from `ProductSection`
 *
 * `ProductSection` is a card grid (4 cards, distinct rounded chrome, hover lift,
 * inset shadows). `FeaturesSection` has one highlighted row and three supporting
 * desktop rows with subtle outlines and lower previews. They share tokens and
 * typography while keeping distinct layouts.
 *
 * ## What is reused
 *
 *   - The navy palette and the same typography as `ProductSection`.
 *   - The reduced-motion pattern from `ProductSection` — base keyframes start
 *     at 0, so an element whose animation never runs is simply visible.
 *   - The existing `.product-rise` entrance utility in `index.css`.
 *
 * ## What is claimed
 *
 * Everything below is anchored to a real surface in the app: the inventory
 * ledger (`/app/inventory`), stock-in / stock-out via movements, the reorder
 * engine (`/app/reorder`), the analytics pages (`/app/analytics`,
 * `/app/stock-risk`, `/app/slow-dead`, `/app/overstock`), and the workspace
 * roles (`owner`, `staff`). No new functionality is implied.
 */

import { useEffect, useId, useRef, useState } from 'react';

/** Tag line shown on the section eyebrow. */
const EYEBROW = 'Features';

/** Headline. Sentence case, no trailing period. */
const HEADLINE = 'Everything an operator needs, on one ledger.';

/** Single-paragraph description of the section. */
const SUBHEAD =
  'StockPilot pairs a real-time inventory ledger with a recommendation engine, a workspace for the people who run the business, and analytics that turn the data into the next decision.';

/** Eyebrow-style label on a dashboard preview. */
const PREVIEW_LABEL = 'Illustrative preview';

type PreviewKind = 'tracking' | 'control' | 'analytics' | 'workspace';

type Feature = {
  id: PreviewKind;
  /** True for the one row that gets accent emphasis. */
  featured: boolean;
  title: string;
  /** Short paragraph that lives next to the title on the same row. */
  body: string;
  /** Bullet-shaped list of concrete behaviours, anchored to real surfaces. */
  bullets: string[];
  /** Minimum-viable preview block. Always hidden from assistive tech. */
  preview: React.ReactNode;
};

/* ------------------------------------------------------------------ preview atoms */

/*
 * Each preview is a tight, single-row composition. They are intentionally
 * smaller than `ProductSection`'s preview so the editorial rows can sit side
 * by side with their text on a single line on tablet, and the previews fit
 * inside a phone width without truncation. All figures are illustrative.
 *
 * The `tracking`, `control`, `analytics` and `workspace` previews are
 * deliberately not the same component: the data shape differs enough that a
 * one-size component would either be too generic to read as a dashboard, or
 * too busy to fit the editorial row. Each one is built to communicate its own
 * capability with the smallest possible surface.
 */

function MiniPreviewShell({
  label,
  children,
  desktopRoomier = false,
}: {
  label: string;
  children: React.ReactNode;
  desktopRoomier?: boolean;
}) {
  /*
   * A flat recessed well — the same `navy-900` as the section background, with
   * a single hairline border. No header bar, no shadow: the rows already have
   * their own separators, and adding a second border layer would crowd the
   * line. The "Illustrative preview" caption rides inside the shell so a
   * sighted reader sees the same disclaimer everywhere.
   */
  return (
    <div
      aria-hidden="true"
      className="features-preview min-w-0 overflow-hidden rounded-lg border border-slate-700/60 bg-navy-900"
    >
      <p
        className={
          'border-b border-slate-700/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 ' +
          (desktopRoomier ? 'min-[1025px]:py-2' : '')
        }
      >
        {label} · {PREVIEW_LABEL}
      </p>
      {children}
    </div>
  );
}

function TrackingPreview() {
  return (
    <MiniPreviewShell label="Today · 09:14">
      <div className="grid grid-cols-2 divide-x divide-slate-700/60 sm:grid-cols-3">
        <div className="px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">SKUs</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">412</p>
        </div>
        <div className="px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Low</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-red-400">7</p>
        </div>
        <div className="col-span-2 px-3 py-2 text-center sm:col-span-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Out</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-red-400">3</p>
        </div>
      </div>
      <ul className="divide-y divide-slate-700/60 border-t border-slate-700/60">
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5 text-[12px]">
          <span className="truncate text-slate-200">Arabica Beans 1kg</span>
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="text-slate-100">12</span>
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              Low
            </span>
          </span>
        </li>
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5 text-[12px]">
          <span className="truncate text-slate-200">Oat Milk 1L</span>
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="text-slate-100">4</span>
            <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
              Out
            </span>
          </span>
        </li>
      </ul>
    </MiniPreviewShell>
  );
}

function ControlPreview() {
  return (
    <MiniPreviewShell label="Action center" desktopRoomier>
      <ul className="divide-y divide-slate-700/60">
        <li className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] min-[1025px]:py-2">
          <span className="shrink-0 text-slate-500 tabular-nums">09:12</span>
          <span className="shrink-0 tabular-nums text-red-400">−6</span>
          <span className="min-w-0 flex-1 truncate text-slate-200">Oat Milk 1L</span>
          <span className="shrink-0 rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
            applied
          </span>
        </li>
        <li className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] min-[1025px]:py-2">
          <span className="shrink-0 text-slate-500 tabular-nums">08:51</span>
          <span className="shrink-0 tabular-nums text-emerald-400">+24</span>
          <span className="min-w-0 flex-1 truncate text-slate-200">Arabica Beans 1kg</span>
          <span className="shrink-0 rounded-full bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-400">
            draft
          </span>
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-700/60 px-3 py-1.5 text-[11px] min-[1025px]:py-2">
        <span className="font-mono text-slate-500">SKU-2071</span>
        <span className="tabular-nums text-slate-100">on hand 4</span>
        <span className="rounded-full bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-400">
          Reorder · High
        </span>
      </div>
    </MiniPreviewShell>
  );
}

function AnalyticsPreview() {
  return (
    <MiniPreviewShell label="Last 30 days">
      <div className="grid grid-cols-3 divide-x divide-slate-700/60">
        <div className="px-2 py-2 text-center sm:px-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Value</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">$184k</p>
        </div>
        <div className="px-2 py-2 text-center sm:px-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Sell-thru</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">71%</p>
        </div>
        <div className="px-2 py-2 text-center sm:px-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Dead</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-red-400">$4.8k</p>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 border-t border-slate-700/60 px-3 py-1.5 text-[12px]">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
        />
        <span className="min-w-0 flex-1 truncate text-slate-200">Cold Brew Bottle</span>
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
          fast
        </span>
      </div>
    </MiniPreviewShell>
  );
}

function WorkspacePreview() {
  return (
    <MiniPreviewShell label="Workspace">
      <ul className="divide-y divide-slate-700/60">
        <li className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px]">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-[10px] font-semibold text-accent-400">
            NS
          </span>
          <span className="min-w-0 flex-1 truncate text-slate-100">Nadia S.</span>
          <span className="shrink-0 rounded-full bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-400">
            Owner
          </span>
        </li>
        <li className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px]">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700/60 text-[10px] font-semibold text-slate-300">
            AR
          </span>
          <span className="min-w-0 flex-1 truncate text-slate-100">Aman R.</span>
          <span className="shrink-0 rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
            Staff
          </span>
        </li>
      </ul>
      <p className="border-t border-slate-700/60 px-3 py-1.5 text-[10px] text-slate-500">
        Roles are server-enforced.
      </p>
    </MiniPreviewShell>
  );
}

/* ----------------------------------------------------------------- feature rows */

const FEATURE_CONTROL: Feature = {
  id: 'control',
  featured: true,
  title: 'Smart Stock Control',
  body:
    'Stock-in, stock-out and adjustments are movements, never edits. Reorder levels are computed; the recommendation engine surfaces what to act on.',
  bullets: [
    'Every stock change is a server-side movement',
    'Reorder levels computed from the same ledger',
    'Draft purchase orders raised in the action center',
  ],
  preview: <ControlPreview />,
};

const FEATURE_TRACKING: Feature = {
  id: 'tracking',
  featured: false,
  title: 'Real-Time Inventory Tracking',
  body:
    'Stock levels, low-stock alerts and the full movement history are derived from the ledger — never typed in by hand.',
  bullets: [
    'Live units-on-hand, low-stock and out-of-stock counts',
    'Server-side low-stock alerts tied to reorder points',
    'Full movement history per SKU',
  ],
  preview: <TrackingPreview />,
};

const FEATURE_ANALYTICS: Feature = {
  id: 'analytics',
  featured: false,
  title: 'Inventory Analytics',
  body:
    'Stock valuation, demand trend and fast- versus slow-moving product insights, computed from the same movements that update the ledger.',
  bullets: [
    'Stock valuation, sell-through and dead-stock signals',
    'Fast- and slow-moving product tagging',
    'Demand trend, stock risk and overstock views',
  ],
  preview: <AnalyticsPreview />,
};

const FEATURE_WORKSPACE: Feature = {
  id: 'workspace',
  featured: false,
  title: 'Team & Business Management',
  body:
    'A business workspace with owner and staff roles. The owner decides who can record movements and read which parts of the analytics.',
  bullets: [
    'Owner and staff roles, server-enforced',
    'Per-role access to movements, reorder and analytics',
    'Single workspace per business, invite by owner',
  ],
  preview: <WorkspacePreview />,
};

const FEATURES = [FEATURE_CONTROL, FEATURE_TRACKING, FEATURE_ANALYTICS, FEATURE_WORKSPACE] as const;

/* ----------------------------------------------------------------- presentation */

/** Inline icon for a feature row. */
function FeatureIcon({ id }: { id: PreviewKind }) {
  const cls = 'h-4 w-4';
  switch (id) {
    case 'tracking':
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M9 5v14" />
        </svg>
      );
    case 'control':
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M4 7h12M4 12h16M4 17h8" />
          <path d="M19 7l2 2-2 2" />
        </svg>
      );
    case 'analytics':
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M4 19V5M4 19h16" />
          <path d="M7 16l4-4 3 3 5-6" />
        </svg>
      );
    case 'workspace':
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="3" />
          <circle cx="17" cy="11" r="2.4" />
          <path d="M3 19c0-3 3-5 6-5s6 2 6 5M14 19c0-2 2-4 4-4s3 1 3 4" />
        </svg>
      );
  }
}

/**
 * One feature row.
 *
 * The featured row uses two columns on desktop. Supporting rows place the
 * preview below the text. Mobile stacks the text and preview in every row.
 * `min-w-0` is set on every grid track so the inner preview can shrink instead
 * of forcing a horizontal scrollbar.
 */
function FeatureRow({ f, delaySeconds }: { f: Feature; delaySeconds: number }) {
  // Same `product-rise` + `--section-delay` stagger pair used by
  // `ProductSection`. The entrance sits on the wrapper rather than the row
  // so the hover lift (handled in CSS via the wrapper's group + the subtle
  // background tint) does not have to fight the keyframe's final
  // `transform: none`.
  return (
    <li
      className="product-rise min-w-0"
      style={{ ['--section-delay' as never]: `${delaySeconds}s` }}
    >
      <div
        data-feature-card={f.id}
        className={
          'group relative min-w-0 py-8 sm:py-10 ' +
          (f.featured
            ? 'rounded-xl border border-slate-700/60 bg-navy-800/40 px-4 sm:px-8 sm:py-12 lg:pl-10 lg:pr-8 min-[1025px]:-mx-4 min-[1025px]:py-16'
            : f.id === 'analytics'
              ? 'features-support-card features-support-card--right'
              : 'features-support-card')
        }
      >
        {/*
         * The featured row also gets a vertical accent stripe on its left edge.
         * `lg:pl-10` on the inner content makes room for the stripe without
         * disturbing the small-screen layout, where the stripe is unnecessary
         * — the parent border already gives the row its emphasis.
         */}
        {f.featured ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 hidden w-1 rounded-l-xl bg-accent-500 lg:block"
          />
        ) : null}

        <div
          className={
            'grid min-w-0 grid-cols-1 items-start gap-x-8 gap-y-5 ' +
            (f.featured ? 'min-[1025px]:gap-x-10 ' : '') +
            (f.id === 'tracking'
              ? 'lg:grid-cols-1'
              : f.featured
                ? 'lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]'
                : '')
          }
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ' +
                  (f.featured
                    ? 'bg-accent-500/20 text-accent-400'
                    : 'bg-accent-500/10 text-accent-400')
                }
              >
                <FeatureIcon id={f.id} />
              </span>
              <h3
                className={
                  'min-w-0 font-semibold tracking-tight ' +
                  (f.featured
                    ? 'text-xl text-slate-50 sm:text-2xl'
                    : 'text-base text-slate-100 sm:text-lg')
                }
              >
                {f.title}
              </h3>
            </div>
            <p
              className={
                'mt-3 min-w-0 ' +
                (f.featured
                  ? 'text-sm leading-relaxed text-slate-300 sm:text-base'
                  : 'text-sm leading-relaxed text-slate-400')
              }
            >
              {f.body}
            </p>
            <ul
              className={
                'mt-4 grid min-w-0 gap-x-6 gap-y-1.5 text-slate-400 ' +
                /*
                 * Bullets live in a 1-column on mobile, 2-column on tablet and
                 * up. Two-column keeps the supporting rows short; the
                 * featured row's three bullets collapse to 1 column on
                 * tablet so the text does not crowd the preview column.
                 */
                (f.featured
                  ? 'sm:grid-cols-1'
                  : 'sm:grid-cols-2')
              }
            >
              {f.bullets.map((b) => (
                <li
                  key={b}
                  className="flex min-w-0 items-start gap-2 text-[12px] sm:text-[13px]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-accent-500"
                  />
                  <span className="min-w-0">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            className={
              'min-w-0 ' +
              (f.id === 'tracking'
                ? 'features-tracking-preview'
                : f.featured
                  ? ''
                  : 'features-desktop-support-preview')
            }
          >
            {f.preview}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Eyebrow + headline + subhead.
 *
 * No animation here. The feature rows stagger themselves via `.product-rise`
 * and `style={{ '--section-delay': ... }}`, the same pair `ProductSection`
 * uses.
 */
function FeaturesHeader() {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="features-eyebrow text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">
        {EYEBROW}
      </p>
      <h2
        id="features-heading"
        className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl"
      >
        {HEADLINE}
      </h2>
      <p className="mt-4 text-base leading-relaxed text-slate-400">{SUBHEAD}</p>
    </div>
  );
}

type ConnectorPoint = { x: number; y: number };

type FeatureConnectorLayout = {
  width: number;
  height: number;
  trackingToAnalytics: string;
  analyticsToWorkspace: string;
  travelFirstPath: string;
  travelBridgePath: string;
  travelSecondPath: string;
};

/** Draw a horizontal-to-vertical connector with a soft quarter-turn. */
function connectorPath(from: ConnectorPoint, to: ConnectorPoint, includeMove = true) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const direction = Math.sign(dx);
  const radius = Math.min(44, Math.abs(dx) * 0.4, Math.max(0, dy) * 0.35);
  const startOfBend = to.x - direction * radius;
  const controlOffset = radius * 0.5523;
  const n = (value: number) => Number(value.toFixed(2));

  return [
    includeMove ? `M ${n(from.x)} ${n(from.y)}` : '',
    `H ${n(startOfBend)}`,
    `C ${n(startOfBend + direction * controlOffset)} ${n(from.y)}`,
    `${n(to.x)} ${n(from.y + radius - controlOffset)}`,
    `${n(to.x)} ${n(from.y + radius)}`,
    `V ${n(to.y)}`,
  ].join(' ');
}

export function FeaturesSection() {
  const glowId = `features-travel-glow-${useId().replace(/:/g, '')}`;
  const journeyRef = useRef<HTMLDivElement>(null);
  const travelFirstPathRef = useRef<SVGPathElement>(null);
  const travelBridgePathRef = useRef<SVGPathElement>(null);
  const travelSecondPathRef = useRef<SVGPathElement>(null);
  const travelLightRef = useRef<SVGGElement>(null);
  const [connectorLayout, setConnectorLayout] = useState<FeatureConnectorLayout | null>(null);

  useEffect(() => {
    const journey = journeyRef.current;
    if (!journey) return;

    const updateConnectors = () => {
      const tracking = journey.querySelector<HTMLElement>('[data-feature-card="tracking"]');
      const analytics = journey.querySelector<HTMLElement>('[data-feature-card="analytics"]');
      const workspace = journey.querySelector<HTMLElement>('[data-feature-card="workspace"]');
      if (!tracking || !analytics || !workspace) return;

      const journeyBounds = journey.getBoundingClientRect();
      const trackingBounds = tracking.getBoundingClientRect();
      const analyticsBounds = analytics.getBoundingClientRect();
      const workspaceBounds = workspace.getBoundingClientRect();
      const localX = (x: number) => x - journeyBounds.left;
      const localY = (y: number) => y - journeyBounds.top;
      const analyticsEntry = {
        x: localX(analyticsBounds.left + analyticsBounds.width / 2),
        y: localY(analyticsBounds.top),
      };
      const analyticsExit = {
        x: localX(analyticsBounds.left),
        y: localY(analyticsBounds.top + analyticsBounds.height / 2),
      };
      const workspaceEntry = {
        x: localX(workspaceBounds.left + workspaceBounds.width / 2),
        y: localY(workspaceBounds.top),
      };
      const endpointOffset = 5;
      const trackingTravelStart = {
        x: localX(trackingBounds.right) + endpointOffset,
        y: localY(trackingBounds.top + trackingBounds.height / 2),
      };
      const analyticsTravelEntry = {
        x: analyticsEntry.x,
        y: analyticsEntry.y - endpointOffset,
      };
      const analyticsTravelExit = {
        x: analyticsExit.x - endpointOffset,
        y: analyticsExit.y,
      };
      const workspaceTravelEnd = {
        x: workspaceEntry.x,
        y: workspaceEntry.y - endpointOffset,
      };
      const trackingToAnalytics = connectorPath(
        {
          x: localX(trackingBounds.right),
          y: localY(trackingBounds.top + trackingBounds.height / 2),
        },
        analyticsEntry,
      );
      const analyticsToWorkspace = connectorPath(analyticsExit, workspaceEntry);
      const n = (value: number) => Number(value.toFixed(2));

      setConnectorLayout({
        width: journeyBounds.width,
        height: journeyBounds.height,
        trackingToAnalytics,
        analyticsToWorkspace,
        travelFirstPath: connectorPath(trackingTravelStart, analyticsTravelEntry),
        travelBridgePath: `M ${n(analyticsTravelEntry.x)} ${n(analyticsTravelEntry.y)} L ${n(analyticsTravelExit.x)} ${n(analyticsTravelExit.y)}`,
        travelSecondPath: connectorPath(analyticsTravelExit, workspaceTravelEnd),
      });
    };

    // Supporting rows finish their staggered entrance before the lines attach.
    let resizeObserver: ResizeObserver | undefined;
    const settleTimer = window.setTimeout(() => {
      updateConnectors();
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateConnectors);
        resizeObserver.observe(journey);
        for (const id of ['tracking', 'analytics', 'workspace']) {
          const card = journey.querySelector<HTMLElement>(`[data-feature-card="${id}"]`);
          if (card) resizeObserver.observe(card);
        }
      }
    }, 950);

    window.addEventListener('resize', updateConnectors);
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', updateConnectors);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!connectorLayout) return;

    const firstPath = travelFirstPathRef.current;
    const bridgePath = travelBridgePathRef.current;
    const secondPath = travelSecondPathRef.current;
    const light = travelLightRef.current;
    if (!firstPath || !bridgePath || !secondPath || !light) return;

    const firstLength = firstPath.getTotalLength();
    const bridgeLength = bridgePath.getTotalLength();
    const secondLength = secondPath.getTotalLength();
    const endPoint = secondPath.getPointAtLength(secondLength);
    const desktopMotion = window.matchMedia(
      '(min-width: 1025px) and (prefers-reduced-motion: no-preference)',
    );
    const firstLegMs = 1800;
    const hiddenHandoffMs = 16;
    const secondLegMs = (secondLength / firstLength) * firstLegMs;
    const cycleMs = firstLegMs + hiddenHandoffMs + secondLegMs;
    let frameId = 0;
    let running = false;
    let cycleStartedAt = 0;

    const tick = (now: number) => {
      if (!running) return;
      const elapsed = (now - cycleStartedAt) % cycleMs;
      let point: DOMPoint;
      let opacity = 1;

      if (elapsed < firstLegMs) {
        point = firstPath.getPointAtLength(firstLength * (elapsed / firstLegMs));
      } else if (elapsed < firstLegMs + hiddenHandoffMs) {
        const progress = (elapsed - firstLegMs) / hiddenHandoffMs;
        point = bridgePath.getPointAtLength(bridgeLength * progress);
        opacity = 0;
      } else if (elapsed < firstLegMs + hiddenHandoffMs + secondLegMs) {
        const legElapsed = elapsed - firstLegMs - hiddenHandoffMs;
        const progress = legElapsed / secondLegMs;
        point = secondPath.getPointAtLength(secondLength * progress);
      } else {
        point = endPoint;
      }

      light.setAttribute('transform', `translate(${point.x} ${point.y})`);
      light.setAttribute('opacity', String(opacity));
      frameId = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (!desktopMotion.matches) return;
      running = true;
      cycleStartedAt = window.performance.now();
      frameId = window.requestAnimationFrame(tick);
    };

    const updateMotion = () => {
      running = false;
      window.cancelAnimationFrame(frameId);
      light.setAttribute('opacity', '0');
      if (desktopMotion.matches) start();
    };

    start();
    desktopMotion.addEventListener('change', updateMotion);
    return () => {
      running = false;
      window.cancelAnimationFrame(frameId);
      desktopMotion.removeEventListener('change', updateMotion);
    };
  }, [connectorLayout]);

  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="features-root bg-navy-900 py-20 font-landing sm:py-28"
    >
      {/*
        The visible headline is the section's labelled-by heading. The section
        exposes `id="features"` (the navbar's anchor) and `aria-labelledby`
        points at the h2 inside `FeaturesHeader` — one heading, not two.
      */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <FeaturesHeader />

        {/* The featured row keeps its card chrome; supporting rows stay unboxed. */}
        <div ref={journeyRef} className="features-journey mt-12 min-w-0 sm:mt-16">
          <svg
            aria-hidden="true"
            className="features-connectors"
            focusable="false"
            preserveAspectRatio="none"
            viewBox={
              connectorLayout
                ? `0 0 ${connectorLayout.width} ${connectorLayout.height}`
                : '0 0 1 1'
            }
          >
            {connectorLayout ? (
              <>
                <defs>
                  <filter
                    id={glowId}
                    x="-200%"
                    y="-200%"
                    width="400%"
                    height="400%"
                  >
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path d={connectorLayout.trackingToAnalytics} />
                <path d={connectorLayout.analyticsToWorkspace} />
                <path
                  ref={travelFirstPathRef}
                  d={connectorLayout.travelFirstPath}
                  style={{ fill: 'none', opacity: 0, stroke: 'none' }}
                />
                <path
                  ref={travelBridgePathRef}
                  d={connectorLayout.travelBridgePath}
                  style={{ fill: 'none', opacity: 0, stroke: 'none' }}
                />
                <path
                  ref={travelSecondPathRef}
                  d={connectorLayout.travelSecondPath}
                  style={{ fill: 'none', opacity: 0, stroke: 'none' }}
                />
                <g ref={travelLightRef} className="features-travel-light" opacity="0">
                  <circle r="6" fill="#10b981" opacity="0.62" filter={`url(#${glowId})`} />
                  <circle r="2.5" fill="#a7f3d0" />
                </g>
              </>
            ) : null}
          </svg>
          <ul className="features-rows min-w-0">
            {FEATURES.map((f, i) => (
              <FeatureRow
                key={f.id}
                f={f}
                delaySeconds={i === 0 ? 0 : 0.1 + (i - 1) * 0.08}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default FeaturesSection;
