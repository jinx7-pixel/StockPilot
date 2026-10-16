/** A final, in-page invitation to explore the existing StockPilot walkthrough. */
export function FinalCTASection() {
  return (
    <section
      aria-labelledby="landing-cta-heading"
      className="relative isolate overflow-hidden bg-navy-900 px-4 py-14 font-landing sm:px-6 sm:py-16 lg:px-8 lg:py-20"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-64 w-[min(72vw,42rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/[0.055] blur-3xl" />
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 rounded-2xl border border-accent-400/15 bg-navy-800/35 px-5 py-7 shadow-[0_20px_64px_-48px_rgba(16,185,129,0.28)] sm:gap-8 sm:px-8 sm:py-8 md:flex-row md:items-center lg:px-10">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">
            A clearer view of stock
          </p>
          <h2
            id="landing-cta-heading"
            className="mt-3 max-w-[34rem] text-2xl font-bold leading-tight tracking-tight text-slate-50 sm:text-3xl"
          >
            Make your next stock decision with confidence.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Explore how StockPilot brings inventory information and priorities into a clearer view.
          </p>
        </div>

        <a
          href="#how-it-works"
          className="group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-accent-400/25 bg-accent-500 px-4 py-2.5 text-sm font-semibold text-navy-900 shadow-[0_8px_24px_-16px_rgba(16,185,129,0.72)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-400 hover:shadow-[0_12px_28px_-16px_rgba(16,185,129,0.82)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 motion-reduce:transition-none motion-reduce:hover:translate-y-0 md:ml-auto"
        >
          Explore How It Works
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 10h12m-5-5 5 5-5 5" />
          </svg>
        </a>
      </div>
    </section>
  );
}

export default FinalCTASection;
