/**
 * Public landing page shell — navbar only.
 *
 * Deliberately a shell: the hero, features, footer and every other marketing
 * section are future work. The anchor targets the navbar links point at
 * (`#product`, `#features`, `#how-it-works`, `#about`) do not exist yet, so the
 * links are wired and correct but currently land on the page top.
 *
 * ## Why this is a separate component from WorkspaceLayout
 *
 * `WorkspaceLayout` is the authenticated shell: grouped navigation, session
 * context, an Outlet. None of that applies to an anonymous visitor, so none of it
 * is reused. What *is* reused is the project's conventions — parameterised
 * Tailwind classes, an explicit focus ring, and the locked palette tokens added
 * in `index.css`.
 *
 * The focus ring is written out rather than imported: `ui.tsx` keeps its
 * `focusRing` module-private, and that ring is `brand-500` blue, which reads
 * poorly against navy. The equivalent ring is spelled out here.
 *
 * ## Desktop alignment without absolute positioning
 *
 * An earlier draft centred the links with `absolute left-1/2 -translate-x-1/2`.
 * That is correct at one width and quietly wrong just below it, where the
 * centred links overlap the actions. Instead the bar is two equal, flexible
 * sides with a non-shrinking centre:
 *
 *     [ flex-1 brand ]  [ shrink-0 links ]  [ flex-1 actions ]
 *
 * Equal sides guarantee the middle is centred at *any* width wide enough to show
 * it. Below `lg` the centre is `display:none`, the two sides simply split the row,
 * and brand/actions land at the edges.
 *
 * ## The wrapper sets its own height
 *
 * A sticky element is bounded by its containing block. The wrapper therefore
 * needs a height of its own: it is what makes the header stick across the whole
 * scroll. It is also `navy-900` rather than the `slate-50` it used to be — the
 * hero and the product section are both dark, and a light wrapper showed through
 * as a band below the last section.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { HeroSection } from '../components/HeroSection';
import { MovingBorder } from '../components/moving-border';
import { ProductSection } from '../components/ProductSection';
import { SectionDivider } from '../components/SectionDivider';

/** Anchors for landing sections that do not exist yet. */
const SECTIONS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'About', href: '#about' },
] as const;

const MENU_ID = 'landing-drawer';

/**
 * Focus ring for the navy bar.
 *
 * `ring-offset` must match the navy it sits on, otherwise the offset shows as a
 * pale gap around the control.
 */
const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900';

/**
 * Nav link styling.
 *
 * The hover/focus outline uses a real `border` that is always present and merely
 * changes colour. A border that appears on hover would resize the element and
 * shift the whole row; holding it transparent keeps the box constant.
 */
const navLinkBase =
  `rounded-md border border-transparent px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none ${focusRing}`;

const drawerLinkBase =
  `flex min-h-11 items-center rounded-md border border-transparent px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${focusRing}`;

/**
 * Log in, wrapped in the orbiting emerald ring.
 *
 * Written out rather than derived from `navLinkBase` / `drawerLinkBase`: both of
 * those pin `border-transparent`, and adding a second border colour alongside it
 * would leave the winner up to the order Tailwind happens to emit the utilities
 * in. That is decided by the build, not by anything readable here, so a future
 * Tailwind upgrade could silently recolour the control.
 *
 * The resting border is faint on purpose — it only has to define the edge. The
 * ring supplies the accent.
 *
 * Horizontal padding is left to each call site (the bar's link is wider than the
 * drawer's full-width one). Emitting `px-3` here and `px-4` there would leave
 * the winner up to Tailwind's emit order.
 *
 * `py-2` is load-bearing: without it the bar's Log in collapses to the bare line
 * box and stops matching the height of Get Started beside it. The drawer link
 * overrides the height with `min-h-11` instead.
 *
 * There is deliberately no `border` here. `MovingBorder` supplies the only edge
 * this control has, and a static `border-accent-500/30` underneath it sat as a
 * permanent line the orbiting highlight could never replace — the button looked
 * permanently outlined even where the arc was elsewhere on the ring.
 */
const movingLoginBase =
  `items-center justify-center rounded-md py-2 text-sm font-medium ` +
  `text-slate-200 transition-colors hover:text-white motion-reduce:transition-none`;

export function LandingPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Escape closes and returns focus to the control that opened the drawer, so a
  // keyboard user is never left with focus nowhere in particular.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        toggleRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // Stop the page behind the drawer scrolling. Restored to its previous value
  // rather than cleared, so a pre-existing inline style survives.
  useEffect(() => {
    if (!drawerOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-navy-900 font-landing">
      <header className="sticky top-0 z-40 bg-navy-900">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8"
        >
          {/* Brand — far left ------------------------------------------------ */}
          <div className="flex min-w-0 flex-1 justify-start">
            <Link
              to="/"
              className={`flex shrink-0 items-center gap-2 rounded-md text-base font-semibold tracking-tight text-white ${focusRing}`}
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-navy-900" fill="currentColor">
                  <path
                    d="M5 13.5 9 17l10-11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              StockPilot
            </Link>
          </div>

          {/* Section links — centred, wide spacing --------------------------- */}
          <ul className="hidden shrink-0 items-center gap-2 lg:flex">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <a
                  href={section.href}
                  className={`${navLinkBase} text-slate-300 hover:border-accent-500 hover:bg-navy-800 hover:text-white focus-visible:border-accent-500`}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>

          {/* Actions — far right --------------------------------------------- */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
            <MovingBorder
              as={Link}
              to="/login"
              className={`hidden ${movingLoginBase} px-4 md:inline-flex ${focusRing}`}
            >
              Log in
            </MovingBorder>

            <Link
              to="/register"
              className={`hidden rounded-lg bg-accent-500 px-5 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-accent-400 motion-reduce:transition-none lg:inline-flex ${focusRing}`}
            >
              Get Started
            </Link>

            {/* Drawer toggle — tablet and below ------------------------------ */}
            <button
              ref={toggleRef}
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-expanded={drawerOpen}
              aria-controls={MENU_ID}
              aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-300 transition-colors hover:border-accent-500 hover:bg-navy-800 hover:text-white motion-reduce:transition-none lg:hidden ${focusRing}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                {drawerOpen ? (
                  <path d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </nav>
      </header>

      {/* Backdrop ----------------------------------------------------------- */}
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={`fixed inset-0 z-40 bg-navy-900/60 transition-opacity duration-300 ease-out lg:hidden ${
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Right-side drawer -------------------------------------------------- */}
      {/*
        Always mounted so it can animate, and `invisible` when closed so its
        links leave the tab order instead of becoming invisible focus stops.
      */}
      <div
        id={MENU_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-navy-900 shadow-2xl transition-[transform,opacity,visibility] duration-300 ease-out lg:hidden ${
          drawerOpen ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-full opacity-0'
        } motion-reduce:transition-none`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm font-semibold tracking-tight text-white">Menu</span>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close navigation menu"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-navy-800 hover:text-white ${focusRing}`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav aria-label="Mobile" className="flex flex-col gap-1 px-4 pb-4">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              onClick={closeDrawer}
              className={`${drawerLinkBase} text-slate-200 hover:border-accent-500 hover:bg-navy-800 hover:text-white`}
            >
              {section.label}
            </a>
          ))}

          <div className="my-3 h-px bg-navy-800" aria-hidden="true" />

          <MovingBorder
            as={Link}
            to="/login"
            onClick={closeDrawer}
            className={`${movingLoginBase} flex min-h-11 w-full px-3 ${focusRing}`}
          >
            Log in
          </MovingBorder>
          <Link
            to="/register"
            onClick={closeDrawer}
            className={`${drawerLinkBase} justify-center bg-accent-500 font-semibold text-navy-900 hover:bg-accent-400`}
          >
            Get Started
          </Link>
        </nav>
      </div>

      {/*
        The hero owns its own container and full-bleed background, so `<main>`
        stays a bare landmark rather than a layout wrapper. The navbar above is
        untouched.

        `ProductSection` carries `id="product"`, which is the target the navbar's
        Product link points at — so that anchor resolves for the first time.

        `SectionDivider` sits between the two. Both sections are the same navy,
        so the rule has to be drawn to exist at all; it is decorative and
        announces nothing.
      */}
      <main id="main-content">
        <HeroSection />
        <SectionDivider />
        <ProductSection />
      </main>
    </div>
  );
}

export default LandingPage;