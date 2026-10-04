/**
 * Shared UI primitives.
 *
 * Deliberately small and unopinionated — no component library, no state
 * management. Every screen is assembled from these so the catalog pages and the
 * auth screens look and behave the same.
 */

import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
  required = true,
  min,
  max,
  step,
  minLength,
  maxLength,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
  minLength?: number;
  maxLength?: number;
  hint?: string;
}) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required ? '' : <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>

      <input
        id={id}
        name={id}
        type={type}
        value={value}
        required={required}
        min={min}
        max={max}
        step={step}
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />

      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>

      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Textarea({
  label,
  value,
  onChange,
  rows = 3,
  required = false,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = `textarea-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required ? '' : <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>

      <textarea
        id={id}
        name={id}
        value={value}
        rows={rows}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </div>
  );
}

export function PrimaryButton({
  type = 'button',
  onClick,
  disabled,
  form,
  children,
}: {
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  /** Id of a form elsewhere in the DOM, so a modal footer can submit it. */
  form?: string;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      form={form}
      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** Full-width submit button for a form. */
export function SubmitButton({
  pending,
  label,
  form,
  disabled,
}: {
  pending: boolean;
  label: string;
  form?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      form={form}
      disabled={pending || disabled}
      className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Please wait…' : label}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function DangerButton({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {message}
    </p>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      {action}
    </div>
  );
}

/** Accessible modal dialog. Closes on backdrop click and on Escape. */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-10"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-lg">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </header>

        <div className="px-6 py-5">{children}</div>

        {footer ? (
          <footer className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Page-level shell: heading, optional actions, then content. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}
