/**
 * The product section: what StockPilot actually is, shown rather than asserted.
 *
 * ## Grounding
 *
 * Every capability below maps to a page that exists in this app today. Nothing is
 * described ahead of the backend:
 *
 *   - **Inventory visibility** — `/app/inventory` is a *ledger*. `currentStock` is
 *     derived from movements server-side and is never accepted as input; a mistake
 *     is corrected by recording another movement, not by editing a number. Catalogue,
 *     suppliers, purchase orders and sales sit beside it.
 *   - **Actionable stock management** — `/app/actions` executes exactly one kind of
 *     action: turning a reviewed recommendation into a *draft* purchase order, with
 *     a stable idempotency key so a double-click replays rather than duplicates.
 *     The word "draft" is deliberate; the recommendations client has no write call
 *     for approving, ordering or adjusting stock at all.
 *   - **Insights and recommendations** — `/app/recommendations` returns ranked
 *     recommendations carrying a type, priority, confidence and the evidence behind
 *     them. The client is a renderer: it decides none of those fields.
 *
 * No performance figures, customer counts, testimonials or "AI-powered" claims
 * appear here, because none of them are supported by anything in the codebase.
 *
 * ## The preview is a picture, not a screen
 *
 * The dashboard below is *not* the authenticated app and makes no network calls —
 * it is static markup describing the product's shape. The figures are invented, so
 * the subtree is taken out of the accessibility tree entirely and the whole thing
 * is given one description instead. A visible caption repeats that to sighted
 * users, because a caption only helps people who can already see it.
 *
 * ## Colour
 *
 * This section is dark, and every surface below is chosen from the locked landing
 * palette rather than from Tailwind's `*-50/100` ramps. It was originally authored
 * light and rendered as a near-white band with white cards under the hero; there
 * was no dark theme being overridden, the light classes simply were the design.
 *
 * Depth comes from three steps rather than from shadows alone:
 *
 *     section      navy-900   the page field
 *     frame / card navy-800   raised surfaces
 *     sidebar / table / panel navy-900   recessed wells
 *
 * Body copy is `slate-400`, not `slate-500`. On `navy-900` slate-500 measures about
 * 3.8:1, which fails AA for small text; slate-400 measures about 7:1. Accents use
 * `accent-400` (#34d399, ~9.3:1 on navy-900) rather than `accent-500`, which is a
 * shape colour on this background.
 */

import type { CSSProperties } from 'react';

/**
 * Per-element entrance delay, following the hero's convention.
 *
 * Each rising element gets its own `--section-delay`, so they arrive in reading
 * order rather than all at once. The property is consumed by `.product-rise`.
 */
function rise(delaySeconds: number): CSSProperties {
  return { '--section-delay': `${delaySeconds}s` } as CSSProperties;
}

const NAV_PREVIEW = [
  { group: 'Overview', items: ['Overview', 'Analytics'] },
  { group: 'Intelligence', items: ['Stock risk', 'Demand', 'Reorder', 'Recommendations'] },
  { group: 'Operations', items: ['Inventory', 'Purchase orders', 'Suppliers'] },
  { group: 'Catalogue', items: ['Products', 'Categories'] },
] as const;

/**
 * The single navigation item drawn as current.
 *
 * Exactly one, because the real app highlights one. An earlier version marked the
 * first item of every group as active, which lit up four items at once and read
 * as a rendering fault rather than a design.
 */
const CURRENT_NAV_ITEM = 'Overview';

/** Shapes mirror `lib/analytics.ts` → `Overview`. */
const SUMMARY = [
  { label: 'Products', value: '412', alert: false },
  { label: 'Stock units', value: '18,940', alert: false },
  { label: 'With stock', value: '389', alert: false },
  { label: 'Out of stock', value: '23', alert: true },
] as const;

/**
 * Column widths, declared on the header cells rather than on a `<colgroup>`.
 *
 * A `<col>` reserves its width whether or not the cells it governs are rendered,
 * so the Category column kept claiming 112px on a phone even with every
 * Category cell `display:none`. That left ~37px for the product name and rendered
 * "Arabica Beans 1kg" as "A.". A hidden `<th>` is not a table cell at all and
 * reserves nothing, which is what `table-fixed` needs here.
 *
 * The `w-` step on Status is sized to the widest pill ("Out of stock"), not to the
 * header text.
 */
const COLUMNS = [
  { label: 'Product', width: '', hideOnMobile: false },
  { label: 'Category', width: 'w-28 sm:w-32', hideOnMobile: true },
  { label: 'Stock', width: 'w-14 sm:w-16', hideOnMobile: false },
  { label: 'Status', width: 'w-[5.25rem] sm:w-24', hideOnMobile: false },
] as const;

/** Columns mirror `lib/catalog.ts` → `Product` and `lib/inventory.ts` → `InventoryItem`. */
const PRODUCTS = [
  { sku: 'SKU-1042', name: 'Arabica Beans 1kg', category: 'Beverages', unit: 'kg', stock: '148', status: 'In stock', alert: false },
  { sku: 'SKU-2071', name: 'Oat Milk 1L', category: 'Dairy Alternatives', unit: 'L', stock: '6', status: 'In stock', alert: false },
  { sku: 'SKU-3390', name: 'Ceramic Mug', category: 'Homeware', unit: 'pcs', stock: '0', status: 'Out of stock', alert: true },
  { sku: 'SKU-4417', name: 'Cold Brew Bottle', category: 'Beverages', unit: 'pcs', stock: '312', status: 'In stock', alert: false },
  { sku: 'SKU-5128', name: 'Paper Filter V60', category: 'Brewing', unit: 'pack', stock: '54', status: 'In stock', alert: false },
] as const;

/** Mirrors `lib/recommendations.ts` → `RecommendationType` / `Priority` / `ConfidenceLevel`. */
const INSIGHT = {
  type: 'REPLENISH',
  priority: 'Urgent',
  confidence: 'Medium confidence',
  reason: 'Stock is below this item’s reorder point.',
  evidence: ['21 movements recorded', 'Last movement 4 days ago'],
} as const;

/*
 * Status pills: the *dark* counterparts of the tones in `BADGE_TONES`
 * (`components/ui.tsx`), not the light ones. That table is `emerald-100` on
 * `emerald-800` and `red-100` on `red-800`, which on navy-900 would be pale chips
 * carrying the only bright thing on the card. Here the same semantic pair is
 * inverted — a translucent fill with a light step of text — so the meaning survives
 * the repaint.
 *
 * Colour is still never the only carrier of meaning: every pill is paired with its
 * label, and the alert row also recolours its number.
 */
const PILL = {
  ok: 'bg-emerald-500/15 text-emerald-300',
  alert: 'bg-red-500/15 text-red-300',
} as const;

const CAPABILITIES = [
  {
    title: 'Inventory visibility',
    body: 'Every item, movement and balance in one ledger. Stock is derived from movements on the server, so the figure on screen is the ledger’s — never something typed in by hand.',
  },
  {
    title: 'Actionable stock management',
    body: 'Stock risk, demand, reorder and overstock views sit beside the ledger. A recommendation you have reviewed can be turned into a draft purchase order from the Action Center.',
  },
  {
    title: 'Inventory insights and recommendations',
    body: 'Recommendations arrive ranked, with a priority, a confidence level and the evidence behind them, alongside analytics across stock, sales and purchasing.',
  },
] as const;

/**
 * One capability glyph per card.
 *
 * Indexed rather than stored on the objects above so the copy and the artwork
 * cannot drift apart — both are positional, and adding a card is one array entry
 * plus one path.
 */
const CAPABILITY_ICONS = [
  <path key="ledger" d="M3 7h18M3 12h18M3 17h12" />,
  <path key="action" d="M5 13.5 9 17l10-11" />,
  <path key="insight" d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />,
] as const;

export function ProductSection() {
  return (
    <section
      id="product"
      aria-labelledby="product-heading"
      className="product-root font-landing"
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        {/* ------------------------------------------------ Section introduction */}
        <div className="mx-auto max-w-2xl text-center">
          <p
            className="product-rise inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent-400"
            style={rise(0)}
          >
            The Product
          </p>

          <h2
            id="product-heading"
            className="product-rise mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl"
            style={rise(0.06)}
          >
            Your Inventory. One Clear Picture.
          </h2>

          <p
            className="product-rise mt-4 text-base leading-relaxed text-slate-400"
            style={rise(0.12)}
          >
            StockPilot brings your catalogue, stock ledger, sales and purchasing into one
            workspace, so you can see what you hold, recognise what needs attention, and
            decide what to do next without assembling the picture yourself.
          </p>
        </div>

        {/* ------------------------------------------------- Main product preview */}
        <div
          className="product-rise mt-14"
          style={rise(0.18)}
          role="img"
          aria-label="Illustrative preview of the StockPilot workspace: a sidebar of
            Overview, Intelligence, Operations and Catalogue navigation; summary cards for
            products, stock units, items with stock and items out of stock; a product table
            listing SKU, name, category, unit, stock and status; and a recommendation panel
            marked Replenish, Urgent, with medium confidence. The figures are sample data for
            illustration only."
        >
          {/*
            `aria-hidden` is load-bearing, and it is *not* redundant with the
            `role="img"` above.

            `role="img"` marks its children presentational, but that is a rule the
            accessibility-tree builder computes, and Chrome's tree does not apply
            it to this subtree: measured against a real browser, the table still
            surfaced as 6 rows and 20 cells, with the invented figures ("18,940",
            "SKU-1042") announced as text. `aria-hidden` removes the subtree
            outright and is an attribute rather than a computation, so it holds
            regardless of how a given engine implements presentational children.

            Both are kept: `role="img"` + label gives the preview one name, and
            `aria-hidden` guarantees nothing underneath it is read a second time.
          */}
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-2xl border border-slate-700 bg-navy-800 shadow-2xl shadow-black/40"
          >
            <div className="flex min-w-0">
              {/*
                Sidebar. Dropped below `md`, where the real app switches to a
                disclosure instead. The section stays a picture at every width, so
                nothing is lost when it goes.
              */}
              <aside className="hidden w-52 shrink-0 flex-col gap-5 border-r border-slate-700 bg-navy-900 p-4 md:flex">
                <div className="flex items-center gap-2 px-1">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5 text-navy-900"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 13.5 9 17l10-11" />
                    </svg>
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-slate-50">
                    StockPilot
                  </span>
                </div>

                {NAV_PREVIEW.map((group) => (
                  <div key={group.group}>
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {group.group}
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {group.items.map((item) => (
                        <li
                          key={item}
                          className={`truncate rounded-md px-2 py-1.5 text-[13px] ${
                            item === CURRENT_NAV_ITEM
                              ? 'bg-navy-800 font-medium text-white ring-1 ring-slate-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </aside>

              {/* Main column */}
              <div className="min-w-0 flex-1">
                {/* Top navigation */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 shrink-0 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <span className="truncate rounded-md bg-slate-800 px-2.5 py-1 text-[13px] text-slate-400">
                      Search products, SKUs⬦
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-xs text-slate-400 sm:inline">
                      Northside Supply Co.
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500/20 text-[11px] font-semibold text-accent-400">
                      NS
                    </span>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <p className="text-sm font-semibold text-white">Overview</p>

                  {/* Summary cards */}
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {SUMMARY.map((card) => (
                      <div
                        key={card.label}
                        className="rounded-lg border border-slate-700 bg-navy-900 p-3"
                      >
                        <p className="text-[11px] leading-tight text-slate-400">
                          {card.label}
                        </p>
                        <p
                          className={`mt-1.5 text-xl font-semibold leading-none ${
                            card.alert ? 'text-red-400' : 'text-slate-50'
                          }`}
                        >
                          {card.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                    {/* Product table */}
                    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-navy-900">
                      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2.5">
                        <p className="text-[13px] font-semibold text-slate-100">Inventory</p>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                          5 of 412
                        </span>
                      </div>

                      {/*
                        `table-fixed` is load-bearing. An auto-layout table sizes
                        its columns from their content, so the longest product name
                        would push the table wider than its container and the whole
                        section would scroll sideways on a phone.
                      */}
                      <table className="w-full table-fixed border-collapse text-left">
                        <thead>
                          <tr className="border-b border-slate-700 bg-navy-800/50">
                            {COLUMNS.map((col) => (
                              <th
                                key={col.label}
                                scope="col"
                                className={`px-3 py-2 text-[11px] font-medium text-slate-400 ${col.width} ${
                                  col.hideOnMobile ? 'hidden sm:table-cell' : ''
                                }`}
                              >
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {PRODUCTS.map((p) => (
                            <tr key={p.sku} className="border-b border-slate-700/70 last:border-0">
                              <td className="min-w-0 px-3 py-2">
                                <span className="block truncate text-[13px] font-medium text-slate-100">
                                  {p.name}
                                </span>
                                <span className="block truncate text-[11px] text-slate-400">
                                  {p.sku} · {p.unit}
                                </span>
                              </td>
                              {/* Category is the first thing to go when width is tight. */}
                              <td className="hidden truncate px-3 py-2 text-[13px] text-slate-400 sm:table-cell">
                                {p.category}
                              </td>
                              <td className="px-3 py-2 text-[13px] font-medium tabular-nums text-slate-100">
                                {p.stock}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    p.alert ? PILL.alert : PILL.ok
                                  }`}
                                >
                                  {p.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Insight panel */}
                    {/*
                      `h-full` + `mt-auto` on the confidence line: the grid row
                      is as tall as the table, so a short panel left a ragged hole
                      beside it. Stretching the panel and pinning its confidence
                      note to the bottom reads as a card with a footer.
                    */}
                    <div className="flex h-full flex-col rounded-lg border border-slate-700 bg-navy-900 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold text-slate-100">
                          Recommendation
                        </p>
                        {/* `Urgent` is a warning in the app's own tone table. */}
                        <span className="whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                          {INSIGHT.priority}
                        </span>
                      </div>

                      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-accent-400">
                        {INSIGHT.type}
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
                        {INSIGHT.reason}
                      </p>

                      <ul className="mt-3 space-y-1.5 border-t border-slate-700 pt-3">
                        {INSIGHT.evidence.map((item) => (
                          <li key={item} className="flex items-center gap-2 text-[12px] text-slate-400">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-accent-400" />
                            {item}
                          </li>
                        ))}
                      </ul>

                      <p className="mt-auto pt-3 text-[11px] font-medium text-slate-400">
                        {INSIGHT.confidence}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Illustrative preview — sample data. The live workspace reads your own catalogue
          and ledger.
        </p>

        {/* --------------------------------------------- Supporting capabilities */}
        {/*
          The entrance animation sits on the <li> and the hover on the inner div.
          Putting both on one element does not work: `.product-rise` fills forwards,
          so its final `transform: none` would keep overriding `.product-card:hover`
          long after the animation ended and the hover lift would simply never fire.
        */}
        <ul className="mt-14 grid gap-5 md:grid-cols-3">
          {CAPABILITIES.map((capability, index) => (
            <li
              key={capability.title}
              className="product-rise min-w-0"
              style={rise(0.24 + index * 0.07)}
            >
              {/* Border colour and shadow come from `.product-card`, not from a
                  utility — see the note in `index.css` about cascade layers. */}
              <div className="product-card group h-full rounded-2xl border bg-navy-800 p-6">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400 transition-colors group-hover:bg-accent-500/25"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {CAPABILITY_ICONS[index]}
                  </svg>
                </span>

                <h3 className="mt-4 text-base font-semibold text-white">
                  {capability.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{capability.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ProductSection;
