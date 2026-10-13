/**
 * The landing hero — the first thing below the navbar.
 *
 * Deliberately a separate file. The navbar is a finished, verified piece of work
 * and the brief for this section is "do not alter the navbar", so the hero is
 * rendered into the page's empty `<main>` rather than edited into the page shell
 * next to it.
 *
 * ## Everything here is CSS
 *
 * The brief rules out Three.js and Framer Motion, which is not much of a
 * constraint: the "3D" is a perspective stage with a rotated, depth-preserving
 * child, and the polish is `transform` and `opacity` keyframes. That also keeps
 * the whole section inside the compositor — no layout is animated, so nothing
 * reflows and nothing shifts.
 *
 * ## Motion is additive, never load-bearing
 *
 * Every entrance animation is defined `from { opacity: 0 }` with **no** matching
 * `opacity: 0` in the base styles. If an animation never runs — reduced motion,
 * an old browser, a stylesheet that failed to parse — the content is simply
 * visible. The same is true of the floating cards. Nothing is ever hidden waiting
 * for an animation to reveal it.
 *
 * ## The visual is a picture of a dashboard, not a dashboard
 *
 * The figures on the panel are invented. They are therefore marked as
 * illustrative twice over: a visible badge for sighted users, and a single
 * `role="img"` with a descriptive `aria-label` so assistive technology is
 * offered a description instead of a stream of fake numbers.
 */

import { AnimatedBadge } from './animated-badge';
import { ShinyButton } from './shiny-button';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

/** Stagger helper: entrance order is carried by one variable, not by N rules. */
function rise(delaySeconds: number): CSSProperties {
  return { '--hero-delay': `${delaySeconds}s` } as CSSProperties;
}

const CAPABILITIES = [
  'Inventory Tracking',
  'Sales Intelligence',
  'Smart Reordering',
] as const;

/** Invented figures, shown only inside the illustrative preview. */
const STATS = [
  { label: 'SKUs tracked', value: '248' },
  { label: 'Units on hand', value: '12.4k' },
  { label: 'Needs reorder', value: '12' },
] as const;

export function HeroSection() {
  return (
    <section className="hero-root relative isolate overflow-hidden bg-navy-900">
      {/* Atmospheric light. Decorative, and deliberately slow. */}
      <div className="hero-glow hero-glow-a" aria-hidden="true" />
      <div className="hero-glow hero-glow-b" aria-hidden="true" />

      {/*
        The bottom padding is deliberately larger at `lg` than below it. The weekly
        card hangs well below the dashboard panel, so desktop needs the room to stop
        the card reaching the hero's bottom edge. Once that card is hidden on
        smaller screens the same padding would be a large empty navy band under the
        copy, so it drops back to match the top padding.
      */}
      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8 lg:pb-36 lg:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          {/* ---------------------------------------------------------- Copy */}
          <div className="max-w-xl">
            <AnimatedBadge
              className="hero-rise"
              style={rise(0.05)}
              text="Inventory Intelligence"
              color="#34d399"
            />

            <h1
              className="hero-rise mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-slate-50 sm:text-5xl lg:text-[3.4rem]"
              style={rise(0.12)}
            >
              Know Your Stock. Make Smarter Moves.
            </h1>

            <p
              className="hero-rise mt-5 text-base leading-relaxed text-slate-300 sm:text-lg"
              style={rise(0.19)}
            >
              Track inventory, uncover sales trends, and make confident stock decisions
              — all from one intelligent workspace.
            </p>

            <div
              className="hero-rise mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
              style={rise(0.26)}
            >
              {/* Matches the navbar's Get Started: emerald fill, navy label. */}
              <Link
                to="/register"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent-500 px-5 py-2.5 text-sm font-semibold text-navy-900 shadow-lg shadow-accent-500/20 transition hover:-translate-y-0.5 hover:bg-accent-400 hover:shadow-accent-500/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                Get Started
              </Link>

              {/* `#features` is prepared but does not exist yet — the brief keeps
                  the features section out of this task. */}
              {/*
              Replaces the old `border-slate-600` outline: ShinyButton supplies
              its own 1px gradient border, and it is the only thing that can
              animate that border. Sized to sit level with Get Started beside it.
            */}
              <ShinyButton
                as="a"
                href="#features"
                label="Explore Features"
                fillColor="#1f2937"
                labelColor="#f8fafc"
                accentColor="#10b981"
                accentSoftColor="#34d399"
                cornerRadius={12}
                padding="0.625rem 1.25rem"
                fontSize="0.875rem"
                className="inline-flex min-h-11 w-full items-center justify-center font-semibold sm:w-auto"
              />
            </div>

            <ul
              className="hero-rise mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-300"
              style={rise(0.33)}
            >
              {CAPABILITIES.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-accent-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 13.5 9 17l10-11" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* -------------------------------------------------------- Visual */}
          <HeroVisual />
        </div>
      </div>

      {/*
        The bottom blend lives in the hero's own background (see `.hero-root`)
        rather than in an overlay. As a translucent panel it sat on top of the
        content and read as grey fog across the lower third; as a background it
        only lightens the backdrop, leaving every label crisp.
      */}
    </section>
  );
}

/**
 * The floating dashboard composition.
 *
 * Exposed to assistive technology as one image with a description, so the
 * invented figures inside are never announced as if they were real readings.
 */
function HeroVisual() {
  return (
    /*
     * Desktop only, and `hidden` rather than a conditional render.
     *
     * Below `lg` the hero is a single column, so the dashboard would sit under the
     * copy as a tall narrow block and push the headline far up the page. Hiding it
     * with CSS keeps one tree — no separate markup, no duplicated copy, and the
     * `role="img"` description cannot be announced on a screen where the image is
     * not there.
     */
    <div className="hero-rise relative hidden lg:block" style={rise(0.2)}>
      <div
        className="hero-stage mx-auto w-full max-w-[30rem]"
        role="img"
        aria-label="Illustrative preview of the StockPilot dashboard: a glassy inventory
          panel showing tracked SKUs, units on hand and items needing reorder, a
          compact sales chart trending upward, and a low-stock alert. The figures are
          sample data for illustration only."
      >
        <div className="hero-panel-3d">
          {/* Atmospheric light behind the panel. */}
          <div className="hero-glow hero-glow-panel" aria-hidden="true" />

          {/* Central glass panel ------------------------------------------- */}
          <div className="hero-glass relative rounded-2xl p-5 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2 w-2 rounded-full bg-white/30" />
                  <span className="h-2 w-2 rounded-full bg-white/30" />
                  <span className="h-2 w-2 rounded-full bg-white/30" />
                </span>
                <span className="text-xs font-semibold text-slate-100">Inventory Overview</span>
              </div>
              <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent-400">
                Illustrative
              </span>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-2.5">
              {STATS.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
                  <dt className="text-[11px] font-medium leading-tight text-slate-300">{stat.label}</dt>
                  <dd className="mt-1 text-lg font-semibold leading-none text-slate-50">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Compact sales chart. */}
            <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                  Sales trend
                </span>
                <span className="text-[11px] font-bold text-accent-400">+18%</span>
              </div>
              <svg
                viewBox="0 0 240 60"
                className="mt-2 h-14 w-full"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="hero-chart-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,52 L30,44 L60,48 L90,32 L120,36 L150,22 L180,26 L210,12 L240,16 L240,60 L0,60 Z"
                  fill="url(#hero-chart-fill)"
                />
                <path
                  d="M0,52 L30,44 L60,48 L90,32 L120,36 L150,22 L180,26 L210,12 L240,16"
                  fill="none"
                  stroke="#34D399"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>

          {/* Floating card: low stock.
              Straddles the panel's top-left corner, sized against the *lowest*
              point of its float cycle — the card drifts up and down, so a position
              that clears the header mid-flight still clips it at the bottom of
              the cycle.

              The tall `lg:` lift is deliberately not applied at tablet. There the
              hero is stacked, so the space above the panel belongs to the text
              column; lifting the card that far parks it on the capability
              labels. Tablet keeps the modest lift, which still clears the panel
              header. The overhang is `sm:` and up only — on a phone the stage is
              nearly the full viewport width, so the same offset would push the
              card off-screen and `overflow-hidden` would shear it in half. */}
          <div className="hero-float hero-float-a absolute -left-2 -top-12 w-40 rounded-xl p-3 sm:-left-16 sm:w-44 lg:-top-[4.75rem]">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning-100/15">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 text-warning-100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 9v4m0 4h.01M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-300">Low stock</p>
                <p className="truncate text-xs font-semibold text-slate-50">Coffee Beans 1kg</p>
              </div>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/4 rounded-full bg-warning-100" />
            </div>
          </div>

          {/* Floating card: weekly units. Off the bottom-right corner.
              Dropped and pushed out far enough to clear the sales chart at the
              *highest* point of its float, and far enough right that it misses the
              caption underneath. It now overlaps only the panel's bottom padding.
              Inset on phones for the same reason as the card above. */}
          <div className="hero-float hero-float-b absolute -bottom-10 -right-2 w-36 rounded-xl p-3 sm:-bottom-20 sm:-right-20 sm:w-40">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-300">This week</p>
            <p className="mt-0.5 text-base font-semibold text-slate-50">1,284 units</p>
            <div className="mt-2 flex items-end gap-1" aria-hidden="true">
              {[38, 62, 45, 78, 58, 92].map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-sm bg-accent-500/70"
                  style={{ height: `${h * 0.28}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/*
          More clearance on phones. The weekly card hangs below the panel, and at
          375px the card and this line occupy enough of the same narrow column that
          the default gap let them collide.
        */}
      <p className="mt-20 text-center text-xs text-slate-400 sm:mt-12">
        Illustrative preview — sample data, not live figures.
      </p>
    </div>
  );
}

export default HeroSection;