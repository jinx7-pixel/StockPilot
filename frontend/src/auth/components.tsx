/**
 * Auth-screen specific layout.
 *
 * The generic form primitives live in `components/ui.tsx` and are shared with
 * the catalog screens; only the centred card shell is auth-specific.
 */

import type { ReactNode } from 'react';

import { ErrorBanner, Field, SubmitButton } from '../components/ui';

export { ErrorBanner as FormError, Field, SubmitButton };

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  darkSurface = false,
  compact = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
  darkSurface?: boolean;
  compact?: boolean;
}) {
  return (
    <main
      className={`flex min-h-screen items-center justify-center px-6 ${compact ? 'py-5 sm:py-6' : 'py-12'} ${
        darkSurface ? 'bg-navy-900' : 'bg-slate-50'
      }`}
      style={
        darkSurface
          ? {
              backgroundImage:
                'linear-gradient(rgba(17, 24, 39, 0.58), rgba(17, 24, 39, 0.68)), url("/images/login-warehouse.png")',
              backgroundPosition: 'center',
              backgroundSize: 'cover',
            }
          : undefined
      }
    >
      <div
        className={`w-full max-w-md ${
          darkSurface
            ? `rounded-2xl border border-accent-400/50 bg-navy-900 ${compact ? 'py-3' : 'py-5'}`
            : ''
        }`}
      >
        <div className={`${compact ? 'mb-5' : 'mb-8'} text-center`}>
          <p
            className={`text-sm font-semibold tracking-widest uppercase ${darkSurface ? 'text-accent-400' : 'text-brand-600'}`}
          >
            StockPilot
          </p>
          <h1 className={`mt-2 text-3xl font-bold tracking-tight ${darkSurface ? 'text-white' : 'text-slate-900'}`}>
            {title}
          </h1>
          <p className={`mt-2 text-sm ${darkSurface ? 'text-slate-300' : 'text-slate-500'}`}>
            {subtitle}
          </p>
        </div>

        <div
          className={`rounded-xl border ${compact ? 'p-4 sm:p-5' : 'p-6'} shadow-sm ${
            darkSurface
              ? 'border-slate-700 bg-navy-900 [&_label]:text-slate-200'
              : 'border-slate-200 bg-white'
          }`}
        >
          {children}
        </div>

        <div className={`${compact ? 'mt-4' : 'mt-6'} text-center text-sm ${darkSurface ? 'text-slate-300' : 'text-slate-500'}`}>
          {footer}
        </div>
      </div>
    </main>
  );
}
