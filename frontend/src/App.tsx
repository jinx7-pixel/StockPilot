/**
 * StockPilot frontend shell.
 *
 * Foundation stage only: this confirms the React + TypeScript + Tailwind toolchain
 * is wired up. Business modules (dashboard, inventory, suppliers, …) are
 * intentionally not implemented yet.
 */

const FOUNDATION_CHECKLIST = [
  { label: 'React + TypeScript + Vite', done: true },
  { label: 'Tailwind CSS', done: true },
  { label: 'ESLint + type-check pipeline', done: true },
  { label: 'REST API client wiring', done: false },
  { label: 'Authentication', done: false },
  { label: 'Business modules', done: false },
] as const;

function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-widest text-brand-600 uppercase">
          Inventory Intelligence Platform
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          StockPilot
        </h1>
        <p className="text-lg text-slate-600">
          Track inventory, understand risk, explain the problem, recommend the action — and let the
          business owner decide.
        </p>
      </header>

      <section
        aria-labelledby="foundation-heading"
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 id="foundation-heading" className="text-lg font-semibold text-slate-900">
          Project foundation
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          No business features yet — this step only establishes the runnable foundation.
        </p>

        <ul className="mt-5 space-y-2.5">
          {FOUNDATION_CHECKLIST.map((item) => (
            <li key={item.label} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className={
                  item.done
                    ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-xs text-brand-700'
                    : 'flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400'
                }
              >
                {item.done ? '✓' : '–'}
              </span>
              <span className={item.done ? 'text-slate-700' : 'text-slate-400'}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="api-heading"
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 id="api-heading" className="text-lg font-semibold text-slate-900">
          API connectivity
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          The Vite dev server proxies <code className="text-slate-700">/api</code> to the backend.
          With the API running, <code className="text-slate-700">GET /api/health</code> returns:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
{`{
  "status": "ok",
  "service": "stockpilot-api"
}`}
        </pre>
      </section>
    </main>
  )
}

export default App
