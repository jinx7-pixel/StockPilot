/** Public landing shell with a glass header and responsive navigation. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { HeroSection } from '../components/HeroSection';
import { ProductSection } from '../components/ProductSection';
import { FeaturesSection } from '../components/FeaturesSection';
import { HowItWorksSection } from '../components/HowItWorksSection';
import { BenefitsSection } from '../components/BenefitsSection';
import { FAQSection } from '../components/FAQSection';
import { FinalCTASection } from '../components/FinalCTASection';
import { Footer } from '../components/Footer';

/** In-page anchors exposed in the landing navbar. */
const SECTIONS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Why StockPilot', href: '#benefits' },
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

const drawerFocusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

const drawerLinkBase =
  `flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${drawerFocusRing}`;

export function LandingPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // On a fresh load, the browser can resolve the fragment before React mounts the section.
  useEffect(() => {
    const target = document.getElementById(window.location.hash.slice(1));
    if (target?.closest('.landing-page')) {
      target.scrollIntoView?.({ behavior: 'instant' });
    }
  }, []);

  // Only the initial page position is transparent, including on return to top.
  useEffect(() => {
    const updateSurface = () => setAtTop(window.scrollY <= 0);
    updateSurface();
    window.addEventListener('scroll', updateSurface, { passive: true });
    return () => window.removeEventListener('scroll', updateSurface);
  }, []);

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
    <div className="landing-page min-h-screen bg-navy-900 font-landing">
      <header className="sp-header sticky top-0 z-40" data-surface={atTop ? 'hero' : 'scrolled'}>
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8"
        >
          {/* Brand — far left ------------------------------------------------ */}
          <div className="flex min-w-0 flex-1 justify-start">
            <Link
              to="/"
              onClick={() => {
                // Keep `/` as the brand destination while making repeat clicks
                // from this page return to its top. `auto` follows the landing
                // page's CSS scroll behavior, including reduced-motion rules.
                if (window.location.pathname === '/') {
                  window.scrollTo({ top: 0, behavior: 'auto' });
                }
              }}
              className={`sp-brand flex shrink-0 items-center gap-2 rounded-md text-base font-semibold tracking-tight text-white ${focusRing}`}
            >
              <span
                aria-hidden="true"
                className="sp-brand-mark flex h-8 w-8 items-center justify-center rounded-lg"
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
                  className={`sp-nav-link ${navLinkBase}`}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>

          {/* Actions — far right --------------------------------------------- */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
            <Link
              to="/login"
              className={`sp-nav-login hidden md:inline-flex ${focusRing}`}
            >
              Log in
            </Link>

            <Link
              to="/register"
              className={`sp-nav-start hidden lg:inline-flex ${focusRing}`}
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
              className={`sp-menu-toggle inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-300 transition-colors hover:border-accent-500 hover:bg-navy-800 hover:text-white motion-reduce:transition-none lg:hidden ${focusRing}`}
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
        className={`fixed inset-0 z-40 bg-[#173a60]/20 transition-opacity duration-300 ease-out motion-reduce:transition-none lg:hidden ${
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
        className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col overflow-y-auto border-l border-[#d9e3ee] bg-white text-[#172b46] shadow-[-12px_0_40px_#173a6026] transition-[transform,opacity,visibility] duration-300 ease-out lg:hidden ${
          drawerOpen ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-full opacity-0'
        } motion-reduce:transition-none`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#e3edf5] px-5 py-3">
          <span className="text-lg font-semibold tracking-tight">Menu</span>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close navigation menu"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#f3f8fc] text-[#086dac] transition-colors hover:bg-[#e7f3fc] motion-reduce:transition-none ${drawerFocusRing}`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav aria-label="Mobile" className="flex flex-col gap-1.5 px-4 py-4">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              onClick={closeDrawer}
              className={`${drawerLinkBase} border-transparent hover:border-[#d9e8f4] hover:bg-[#f3f8fc] hover:text-[#086dac]`}
            >
              {section.label}
            </a>
          ))}

          <div className="my-3 h-px bg-[#e3edf5]" aria-hidden="true" />

          <Link
            to="/login"
            onClick={closeDrawer}
            className={`${drawerLinkBase} justify-center border-[#d9e3ee] bg-white hover:bg-[#f3f8fc]`}
          >
            Log in
          </Link>
          <Link
            to="/register"
            onClick={closeDrawer}
            className={`${drawerLinkBase} justify-center border-transparent bg-[#086dac] font-semibold text-white hover:bg-[#07588e]`}
          >
            Get Started
          </Link>
        </nav>
      </div>

      {/* The hero flows directly into the white product showcase. */}
      <main id="main-content">
        <HeroSection />
        <ProductSection />
        <FeaturesSection />
        <HowItWorksSection />
        <BenefitsSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}

export default LandingPage;
