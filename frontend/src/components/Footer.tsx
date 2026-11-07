import { useId } from 'react';
import { StockPilotLogo } from './StockPilotLogo';

const FOOTER_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Why StockPilot', href: '#benefits' },
  { label: 'FAQ', href: '#faq' },
] as const;

const GITHUB_PROFILE_URL = 'https://github.com/jinx7-pixel';
const PORTFOLIO_URL = 'https://jinx-portfolio.pages.dev/';
const CONTACT_EMAIL = 'jinx4784@gmail.com';

const FOOTER_LINK_CLASS =
  'rounded-sm text-sm text-slate-600 transition-colors duration-200 hover:text-[#086dac] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none';

const CONTACT_LINK_CLASS =
  'group flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg border border-[#d9e3ee] bg-white px-2.5 py-1.5 text-sm text-[#172b46] transition-colors duration-200 hover:border-[#b9d5ea] hover:bg-[#f5faff] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none';

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.68-3.76-1.32-3.76-1.32-.5-1.3-1.24-1.64-1.24-1.64-1.02-.7.08-.69.08-.69 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.62 1.21 3.26.92.1-.72.4-1.21.71-1.49-2.47-.28-5.07-1.24-5.07-5.52 0-1.22.44-2.21 1.15-2.99-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.11-1.44 3.05-1.14 3.05-1.14.61 1.53.23 2.67.11 2.95.72.78 1.15 1.77 1.15 2.99 0 4.29-2.61 5.23-5.1 5.5.4.35.76 1.03.76 2.08v3.11c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4.5 7 7.5 5.5L19.5 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M18.9 1.5h3.3l-7.2 8.2 8.5 12.8h-6.7l-5.2-7.7-6.8 7.7H1.5l7.7-8.8L1.1 1.5H8l4.7 7.1 6.2-7.1Zm-1.2 18.7h1.8L7.4 3.7H5.5l12.2 16.5Z" />
    </svg>
  );
}

export function Footer() {
  const year = new Date().getFullYear();
  const wordmarkGradient = useId();

  return (
    <footer id="footer" className="scroll-mt-20 bg-white px-5 font-landing text-[#172b46] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1280px] border-t border-[#d9e3ee] pt-10 pb-7 sm:pt-12 sm:pb-9">
        <div className="grid min-w-0 gap-8 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-[1.1fr_0.9fr_1fr] lg:gap-10">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <a
              href="#main-content"
              aria-label="StockPilot, back to top"
              className="inline-flex items-center gap-3 rounded-md text-[#172b46] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <StockPilotLogo className="[--stockpilot-logo-size:32px]" />
              <span className="text-lg font-semibold tracking-tight">StockPilot</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-600">
              Clearer stock information for more confident inventory decisions.
            </p>
          </div>

          <nav aria-label="Footer" className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#172b46]">
              Explore
            </h2>
            <ul className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {FOOTER_LINKS.map(({ label, href }) => (
                <li key={href}>
                  <a href={href} className={FOOTER_LINK_CLASS}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-labelledby="footer-connect-heading" className="min-w-0">
            <h2
              id="footer-connect-heading"
              className="text-xs font-semibold uppercase tracking-[0.16em] text-[#172b46]"
            >
              Connect
            </h2>
            <ul className="mt-3.5 grid min-w-0 gap-2">
              <li>
                <a
                  href={GITHUB_PROFILE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub profile, opens in a new tab"
                  className={CONTACT_LINK_CLASS}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#d9e3ee] bg-[#f6faff] text-[#086dac]">
                    <GitHubIcon />
                  </span>
                  <span className="min-w-0 flex-1">GitHub</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="h-3 w-3 shrink-0 text-slate-600 transition-colors group-hover:text-[#086dac] motion-reduce:transition-none"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 3h7v7M13 3 6.5 9.5" />
                    <path d="M11 9v4H3V5h4" />
                  </svg>
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  aria-label={`Email ${CONTACT_EMAIL}`}
                  className={CONTACT_LINK_CLASS}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#d9e3ee] bg-[#f6faff] text-[#086dac]">
                    <EmailIcon />
                  </span>
                  <span className="min-w-0 break-all">{CONTACT_EMAIL}</span>
                </a>
              </li>
              <li className="flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600">
                <span
                  role="img"
                  aria-label="X icon, visual only"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600"
                >
                  <XIcon />
                </span>
                <span>X</span>
                <span className="ml-auto text-xs text-slate-600">Visual only</span>
              </li>
            </ul>
          </section>
        </div>

        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 1200 246"
          className="mt-9 block h-auto w-full select-none sm:mt-12"
        >
          <defs>
            <linearGradient id={wordmarkGradient} x2="0" y2="1">
              <stop offset="0" stopColor="#e2e8ef" />
              <stop offset="1" stopColor="#f6f8fa" />
            </linearGradient>
          </defs>
          <text
            x="4"
            y="214"
            textLength="1192"
            lengthAdjust="spacingAndGlyphs"
            fontSize="244"
            fontWeight="750"
            fill={`url(#${wordmarkGradient})`}
          >
            StockPilot
          </text>
        </svg>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-4">
          <p className="text-sm text-slate-600">© {year} StockPilot. Code licensed under MIT.</p>
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Portfolio, opens in a new tab"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d9e3ee] bg-[#f8fafc] px-4 text-sm font-medium text-[#172b46] hover:border-[#b9d5ea] hover:text-[#086dac] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2"
          >
            Portfolio <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
