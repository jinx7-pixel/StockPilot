type WalkthroughDetail = {
  label: string;
  text: string;
};

type WalkthroughStep = {
  number: string;
  title: string;
  summary: string;
  details: WalkthroughDetail[];
};

const STEPS: WalkthroughStep[] = [
  {
    number: '01',
    title: 'Organize Inventory',
    summary:
      'Bring products into one structured catalog and keep each stock change recorded as a movement.',
    details: [
      { label: 'You do', text: 'Add product details and record stock in, stock out, or adjustments.' },
      { label: 'You see', text: 'Product names, SKUs, on-hand units, and stock status together.' },
      { label: 'Why it helps', text: 'Keep the inventory picture easier to maintain and reconcile.' },
    ],
  },
  {
    number: '02',
    title: 'Understand Stock',
    summary:
      'Read current balances alongside movement history, reorder points, and product trends.',
    details: [
      { label: 'You do', text: 'Check low-stock items and compare demand with stock on hand.' },
      { label: 'You see', text: 'Balances, movement history, and products that need attention.' },
      { label: 'Why it helps', text: 'Focus on the items that deserve a closer look.' },
    ],
  },
  {
    number: '03',
    title: 'Take Action',
    summary:
      'Use stock signals and recommendation evidence to decide what to replenish first.',
    details: [
      { label: 'You do', text: 'Review replenishment recommendations and prioritize products.' },
      { label: 'You see', text: 'A suggested priority and the evidence behind it.' },
      { label: 'Why it helps', text: 'Turn a reviewed recommendation into a draft purchase order.' },
    ],
  },
];

const SAMPLE_PRODUCTS = [
  { name: 'Arabica Beans 1kg', sku: 'SKU-1042', units: '148', status: 'In stock', tone: 'healthy' },
  { name: 'Oat Milk 1L', sku: 'SKU-2071', units: '6', status: 'Low', tone: 'low' },
  { name: 'Ceramic Mug', sku: 'SKU-3390', units: '0', status: 'Out', tone: 'out' },
  { name: 'Cold Brew Bottle', sku: 'SKU-4417', units: '312', status: 'In stock', tone: 'healthy' },
] as const;

const STATUS_STYLES = {
  healthy: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  low: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  out: 'bg-red-500/10 text-red-300 ring-red-400/20',
} as const;

function InventoryWalkthroughPreview() {
  return (
    <div
      role="img"
      aria-label="Illustrative static inventory preview with four sample products, stock statuses, and a low-stock signal for Oat Milk 1L: 6 units on hand against a reorder point of 12."
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-700/70 bg-navy-900 shadow-xl shadow-black/20 ring-1 ring-white/5"
    >
      <div aria-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-400/15">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                <path d="M3.5 9h17M9 9v10.5" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-slate-100">
                Inventory overview
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Catalog and stock status</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-700/70 bg-navy-800/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <span className="relative flex h-1 w-1 shrink-0 items-center justify-center" aria-hidden="true">
              <span className="flex h-2 w-2 animate-ping items-center justify-center rounded-full bg-accent-400/45 motion-reduce:animate-none">
                <span className="flex h-2 w-2 animate-ping items-center justify-center rounded-full bg-accent-400/35 motion-reduce:animate-none" />
              </span>
              <span className="absolute top-1/2 left-1/2 flex h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent-400/90" />
            </span>
            Illustrative · static
          </span>
        </div>

        <div className="flex items-center gap-1 border-b border-slate-700/60 px-4 py-3 sm:gap-2 sm:px-5">
          {STEPS.map((step, index) => (
            <div key={step.number} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums text-accent-500 ring-1 ring-inset sm:h-6 sm:w-6 ${
                  index === 0
                    ? 'bg-accent-500/15 ring-accent-400/30'
                    : 'bg-navy-800 ring-slate-700'
                }`}
              >
                {step.number}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[10px] font-medium text-slate-400 sm:shrink sm:truncate sm:text-xs">
                {['Catalog', 'Signals', 'Action'][index]}
              </span>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="hidden h-px min-w-2 flex-1 bg-gradient-to-r from-accent-500/35 to-slate-700 sm:block"
                />
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-px border-b border-slate-700/60 bg-slate-700/60">
          <div className="bg-navy-800/60 px-4 py-3 sm:px-5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Products shown
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">04</p>
          </div>
          <div className="bg-navy-800/60 px-4 py-3 sm:px-5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Need attention
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-amber-300">02</p>
          </div>
        </div>

        <div className="px-3 py-4 sm:px-5">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-xs font-semibold text-slate-200">Product stock</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">On hand</p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-700/60">
            <table className="w-full table-fixed text-left">
              <thead className="bg-navy-800/70 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="px-2.5 py-2 font-medium sm:px-3">Product</th>
                  <th scope="col" className="w-14 px-1.5 py-2 text-right font-medium sm:w-20 sm:px-3">
                    Units
                  </th>
                  <th scope="col" className="w-[4.75rem] px-2 py-2 text-right font-medium sm:w-24 sm:px-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {SAMPLE_PRODUCTS.map((product) => (
                  <tr key={product.sku} className="bg-navy-900/70">
                    <td className="min-w-0 px-2.5 py-2.5 sm:px-3">
                      <span className="block truncate text-[11px] font-medium text-slate-200 sm:text-xs">
                        {product.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[9px] text-slate-500 sm:text-[10px]">
                        {product.sku}
                      </span>
                    </td>
                    <td className="px-1.5 py-2.5 text-right text-xs font-medium tabular-nums text-slate-200 sm:px-3 sm:text-sm">
                      {product.units}
                    </td>
                    <td className="px-2 py-2.5 text-right sm:px-3">
                      <span
                        className={`inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-1 text-[9px] font-medium leading-none ring-1 ring-inset sm:gap-1.5 sm:px-2 sm:text-[10px] ${STATUS_STYLES[product.tone]}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            product.tone === 'healthy'
                              ? 'bg-emerald-400'
                              : product.tone === 'low'
                                ? 'bg-amber-400'
                                : 'bg-red-400'
                          }`}
                        />
                        {product.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.06] p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3 2.8 19h18.4L12 3Z" />
                  <path d="M12 9v4m0 3h.01" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                    Stock insight
                  </p>
                  <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[9px] font-medium text-amber-200">
                    Review replenishment
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium leading-relaxed text-slate-200 sm:text-sm">
                  Oat Milk 1L is below its reorder point.
                </p>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-700/70">
                    <div className="h-full w-1/2 rounded-full bg-amber-400/80" />
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                    6 on hand · reorder at 12
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="bg-navy-800/20 py-20 font-landing sm:py-24 lg:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">
            How It Works
          </p>
          <h2
            id="how-it-works-heading"
            className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl"
          >
            How StockPilot Works
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">
            From scattered inventory data to confident decisions in three simple steps.
          </p>
        </header>

        <div className="mx-auto mt-12 grid max-w-7xl min-w-0 items-start gap-10 lg:mt-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14">
          <ol className="relative min-w-0">
            {STEPS.map((step, index) => (
              <li
                key={step.number}
                className="group relative grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 pb-8 last:pb-0 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-5 sm:pb-9"
              >
                {index < STEPS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-0 left-6 top-12 w-px bg-gradient-to-b from-accent-500/50 via-accent-500/20 to-transparent sm:left-7 sm:top-14"
                  >
                    <span
                      className="how-it-works-travel-bubble"
                      style={{ animationDelay: index === 1 ? '-3.5s' : '0s' }}
                    />
                  </span>
                ) : null}

                <span
                  aria-hidden="true"
                        className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-accent-500/35 bg-navy-900 text-sm font-semibold tabular-nums text-accent-500 ring-4 ring-navy-900/80 transition-colors duration-200 group-hover:border-accent-400/70 group-hover:bg-navy-800 motion-reduce:transition-none sm:h-14 sm:w-14"
                >
                  {step.number}
                </span>

                <div className="min-w-0 pt-0.5 sm:pt-1">
                  <h3 className="text-lg font-semibold tracking-tight text-slate-100 sm:text-xl">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-300 sm:text-[15px]">
                    {step.summary}
                  </p>
                  <dl className="mt-3 space-y-2.5">
                    {step.details.map((detail) => (
                      <div
                        key={detail.label}
                        className="grid grid-cols-1 gap-y-0.5 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-0"
                      >
                        <dt className="pt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-accent-400/80 sm:text-[10px]">
                          {detail.label}
                        </dt>
                        <dd className="min-w-0 text-xs leading-relaxed text-slate-400 sm:text-[13px]">
                          {detail.text}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </li>
            ))}
          </ol>

          <InventoryWalkthroughPreview />
        </div>
      </div>
    </section>
  );
}

export default HowItWorksSection;
