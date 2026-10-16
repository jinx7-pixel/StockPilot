type BenefitIconName = 'visibility' | 'alert' | 'priority' | 'confidence';

type Benefit = {
  title: string;
  description: string;
  icon: BenefitIconName;
};

const BENEFITS: Benefit[] = [
  {
    title: 'Clear Stock Visibility',
    description: 'Understand what is available and which products need attention.',
    icon: 'visibility',
  },
  {
    title: 'Fewer Inventory Surprises',
    description:
      'Spot low-stock and out-of-stock items before they become bigger operational problems.',
    icon: 'alert',
  },
  {
    title: 'Smarter Priorities',
    description: 'Focus your attention on the products that need replenishment first.',
    icon: 'priority',
  },
  {
    title: 'More Confident Decisions',
    description:
      'Use organized inventory information and stock insights to make informed decisions.',
    icon: 'confidence',
  },
];

function BenefitIcon({ name }: { name: BenefitIconName }) {
  let shape;

  switch (name) {
    case 'visibility':
      shape = (
        <>
          <path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
      break;
    case 'alert':
      shape = (
        <>
          <path d="M12 3.5 2.8 19h18.4L12 3.5Z" />
          <path d="M12 9v4m0 3h.01" />
        </>
      );
      break;
    case 'priority':
      shape = (
        <>
          <path d="M4 5v14h16" />
          <path d="m8 15 3-3 2.5 2.5L19 9" />
          <path d="M15.5 9H19v3.5" />
        </>
      );
      break;
    case 'confidence':
      shape = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16.5 9" />
        </>
      );
      break;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.125rem] w-[1.125rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

function InventoryFocusIllustration() {
  return (
    <figure
      role="img"
      aria-label="Static illustration of organized inventory boxes, with one item highlighted to represent a product that needs attention."
      className="group relative isolate min-w-0 overflow-hidden rounded-[1.75rem] border border-slate-700/80 bg-[#141f2d] p-5 shadow-[0_28px_80px_-50px_rgba(0,0,0,0.9)] transition-colors duration-300 hover:border-accent-400/35 motion-reduce:transition-none sm:p-7 lg:p-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_80%,rgba(16,185,129,0.12),transparent_58%)] opacity-80 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none"
      />

      <div aria-hidden="true" className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-slate-400">
          Inventory, in focus
        </p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-600/70 bg-navy-900/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
          <span
            className="relative flex h-1 w-1 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <span className="flex h-2 w-2 animate-ping items-center justify-center rounded-full bg-accent-400/45 motion-reduce:animate-none">
              <span className="flex h-2 w-2 animate-ping items-center justify-center rounded-full bg-accent-400/35 motion-reduce:animate-none" />
            </span>
            <span className="absolute top-1/2 left-1/2 flex h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent-400/90" />
          </span>
          Illustrative
        </span>
      </div>

      <div aria-hidden="true" className="relative mx-auto mt-3 max-w-[34rem]">
        <svg viewBox="0 0 520 300" className="h-auto w-full" fill="none">
          <defs>
            <linearGradient id="benefits-box-face" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#253347" />
              <stop offset="1" stopColor="#1a2737" />
            </linearGradient>
            <linearGradient id="benefits-box-focus" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#174b43" />
              <stop offset="1" stopColor="#17352f" />
            </linearGradient>
            <radialGradient id="benefits-soft-glow" cx="0" cy="0" r="1" gradientTransform="matrix(0 120 -170 0 286 165)" gradientUnits="userSpaceOnUse">
              <stop stopColor="#10b981" stopOpacity=".18" />
              <stop offset="1" stopColor="#10b981" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse cx="278" cy="171" fill="url(#benefits-soft-glow)" rx="176" ry="118" />
          <path d="M38 244h444" stroke="#334155" strokeLinecap="round" strokeWidth="2" />
          <path d="M56 249h408" stroke="#1e293b" strokeLinecap="round" strokeWidth="8" />

          <g stroke="#475569" strokeLinejoin="round" strokeWidth="1.5">
            <path d="m67 151 42-22 42 22v69l-42 23-42-23v-69Z" fill="url(#benefits-box-face)" />
            <path d="m67 151 42 24 42-24m-42 24v68" />
            <path d="m165 170 37-20 38 20v51l-38 21-37-21v-51Z" fill="url(#benefits-box-face)" />
            <path d="m165 170 37 21 38-21m-38 21v51" />
            <path d="m278 147 45-24 46 24v73l-46 24-45-24v-73Z" fill="url(#benefits-box-focus)" stroke="#34d399" strokeWidth="2" />
            <path d="m278 147 45 26 46-26m-46 26v71" stroke="#34d399" strokeOpacity=".72" />
            <path d="m388 167 34-18 35 18v53l-35 18-34-18v-53Z" fill="url(#benefits-box-face)" />
            <path d="m388 167 34 20 35-20m-35 20v51" />
          </g>

          <path d="M102 159v9m-5-4.5h10m99 15v9m-5-4.5h10m120-27v11m-6-5.5h12m100 13v9m-5-4.5h10" stroke="#64748b" strokeLinecap="round" strokeWidth="1.5" />
          <path d="M323 124V98h73" stroke="#34d399" strokeDasharray="3 5" strokeLinecap="round" strokeWidth="1.5" />
          <circle cx="323" cy="124" r="4" fill="#34d399" />
          <circle cx="323" cy="124" r="9" stroke="#34d399" strokeOpacity=".28" />

          <g transform="translate(386 72)">
            <rect width="112" height="34" rx="17" fill="#111827" stroke="#334155" />
            <circle cx="17" cy="17" r="4" fill="#fbbf24" />
            <text x="29" y="21" fill="#d7e0eb" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="11" fontWeight="600">Needs attention</text>
          </g>

          <path d="M72 267h110" stroke="#34d399" strokeLinecap="round" strokeOpacity=".65" strokeWidth="2" />
          <path d="M190 267h55" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
          <circle cx="260" cy="267" r="2" fill="#64748b" />
          <circle cx="271" cy="267" r="2" fill="#64748b" />
          <circle cx="282" cy="267" r="2" fill="#64748b" />
        </svg>
      </div>

      <figcaption aria-hidden="true" className="mt-1 flex items-center gap-2 text-xs text-slate-400">
        <span className="h-px w-7 bg-accent-400/70" />
        Organized stock. Attention made visible.
      </figcaption>
    </figure>
  );
}

export function BenefitsSection() {
  return (
    <section
      id="benefits"
      aria-labelledby="benefits-heading"
      className="relative isolate overflow-hidden bg-navy-900 py-20 font-landing sm:py-24 lg:py-28"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -right-20 top-0 h-72 w-72 rounded-full bg-accent-500/[0.035] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl min-w-0 px-4 sm:px-6 lg:px-8">
        <header className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:items-end lg:gap-12">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-accent-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]"
              />
              WHY STOCKPILOT
            </p>
            <h2
              id="benefits-heading"
              aria-label="Less Guesswork. Better Stock Decisions."
              className="mt-5 max-w-3xl text-[2.55rem] font-bold leading-[1.04] tracking-[-0.045em] text-slate-50 sm:text-5xl lg:text-[3.35rem]"
            >
              <span className="block">Less Guesswork.</span>
              <span className="mt-1 block bg-gradient-to-r from-accent-400 via-emerald-200 to-accent-400 bg-clip-text text-transparent">
                Better Stock Decisions.
              </span>
            </h2>
          </div>

          <div className="relative max-w-xl border-l border-accent-400/40 pl-5 sm:pl-6 lg:mb-1 lg:justify-self-end lg:pl-7">
            <span className="absolute -left-px top-0 h-8 w-px bg-accent-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]" />
            <p className="max-w-lg text-base leading-relaxed text-slate-300 sm:text-lg sm:leading-8">
              Keep inventory information clear, spot the products that need attention, and make
              more confident stock decisions.
            </p>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Clarity for the decisions that keep stock moving
            </p>
          </div>
        </header>

        <div className="mt-12 grid min-w-0 items-start gap-9 sm:mt-14 lg:mt-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 xl:gap-20">
          <InventoryFocusIllustration />

          <ol className="min-w-0 divide-y divide-slate-700/70 border-y border-slate-700/70">
            {BENEFITS.map((benefit, index) => (
              <li
                key={benefit.title}
                className="group relative grid min-w-0 grid-cols-[1.75rem_2.75rem_minmax(0,1fr)] items-start gap-3 border-l-2 border-transparent py-5 pl-3 transition-colors duration-300 hover:border-accent-400/65 hover:bg-accent-500/[0.025] sm:grid-cols-[2rem_3rem_minmax(0,1fr)] sm:gap-4 sm:py-6 sm:pl-4 motion-reduce:transition-none"
              >
                <span className="pt-1 text-[11px] font-semibold tabular-nums tracking-[0.12em] text-accent-400/75">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-navy-800/80 text-accent-400 transition-colors duration-300 group-hover:border-accent-400/35 group-hover:bg-accent-500/[0.08] sm:h-11 sm:w-11 motion-reduce:transition-none">
                  <BenefitIcon name={benefit.icon} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-base font-semibold tracking-tight text-slate-100 transition-colors duration-300 group-hover:text-white sm:text-lg motion-reduce:transition-none">
                    {benefit.title}
                  </h3>
                  <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-400 sm:mt-2 sm:text-[15px]">
                    {benefit.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export default BenefitsSection;
