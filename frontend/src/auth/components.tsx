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
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold tracking-widest text-brand-600 uppercase">
            StockPilot
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>

        <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>
      </div>
    </main>
  );
}
