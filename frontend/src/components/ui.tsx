/**
 * Shared UI primitives.
 *
 * Deliberately small and unopinionated — no component library, no state
 * management. Every screen is assembled from these so the catalog pages and the
 * auth screens look and behave the same.
 *
 * ## Accessibility rules applied here, once
 *
 * Rather than fixing focus and labelling on every page, the primitives own it:
 *
 *   - **Ids come from `useId`, never from the label text.** Deriving an id from
 *     the label silently produced duplicate DOM ids whenever two fields shared a
 *     label on one page, and the `htmlFor` then pointed at the wrong control.
 *   - **Errors are part of the control, not a detached banner.** A field with a
 *     validation failure sets `aria-invalid` and links its message through
 *     `aria-describedby`, so a screen reader announces it with the field.
 *   - **The dialog manages focus.** It moves focus in, keeps Tab inside, closes
 *     on Escape, restores focus to whatever opened it, and locks background
 *     scroll. Escape previously hung off a non-focusable `div`, so it only fired
 *     when focus happened to already be inside the dialog — which nothing did.
 *   - **Loading is announced.** The spinner carries `role="status"`; the
 *     animated ring is `aria-hidden` because motion alone conveys nothing.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Focus helpers
// ---------------------------------------------------------------------------

/** Elements that can hold focus, in DOM order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * True when the element must not receive focus.
 *
 * Deliberately avoids `offsetParent`: jsdom provides no layout, so that check
 * returns `null` for every element and would silently disable the focus trap
 * entirely in tests while appearing to work in a browser. These checks read
 * attributes and inline styles only, so they behave identically in both.
 */
function isHidden(element: HTMLElement): boolean {
  // `closest()` matches the element itself as well as its ancestors, so these two
  // lines cover both a hidden element and one nested inside a hidden container.
  // They are deliberately symmetric: `aria-hidden` was previously checked on the
  // element alone, which let a focusable control inside an `aria-hidden` wrapper
  // slip into the trap while its `[hidden]` equivalent was correctly excluded.
  if (element.closest('[hidden]') !== null) return true;
  if (element.closest('[aria-hidden="true"]') !== null) return true;
  if (element.style.display === 'none') return true;
  if (element.style.visibility === 'hidden') return true;
  return false;
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  // The selector already excludes `:disabled` and `tabindex="-1"`. Hidden
  // elements are filtered separately so Tab can never land on an invisible
  // control inside the dialog.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !isHidden(element),
  );
}

/**
 * The focus ring used by every control.
 *
 * Previously `ring-brand-100` on its own: a near-white blue, which on a white
 * background is very close to invisible. `ring-brand-500` with a 1px white offset
 * gives a clearly visible ring against both the page and the control, while
 * leaving the existing colour system untouched.
 */
const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  children,
  className = '',
  darkSurface = false,
}: {
  children: ReactNode;
  className?: string;
  darkSurface?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border shadow-sm ${
        darkSurface
          ? 'border-slate-800 bg-[#101a2a] shadow-black/20'
          : 'border-slate-200 bg-white'
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * One entry in a breadcrumb trail.
 *
 * `to` is optional by design: the trail's final entry is the page the user is
 * already on, and offering a link to the current page would be a no-op that
 * still announces as a destination.
 */
export type Crumb = {
  label: string;
  to?: string;
};

/**
 * Breadcrumb trail.
 *
 * Markup follows the WAI-ARIA breadcrumb pattern: a `nav` landmark labelled
 * `Breadcrumb`, wrapping an ordered list. The label is what separates this from
 * the workspace navigation introduced in Step 13.3.3 — a page carrying two
 * `navigation` landmarks is unusable without distinct names.
 *
 * The final entry carries `aria-current="page"` and is **not** a link, which is
 * what tells assistive tech the trail has reached the present page rather than
 * simply ending.
 *
 * Separators are real elements rather than CSS `::after` content: a generated
 * pseudo-element is invisible to the accessibility tree, and an unlabelled `/`
 * read aloud between two links is noise. Marking it `aria-hidden` keeps the
 * visual affordance without adding it to the announcement.
 */
export function Breadcrumbs({ items, darkSurface = false }: { items: readonly Crumb[]; darkSurface?: boolean }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {item.to ? (
                <Link
                  to={item.to}
                  className={`rounded transition ${
                    darkSurface
                      ? 'text-slate-400 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]'
                      : `text-slate-500 hover:text-slate-900 ${focusRing}`
                  }`}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className={`font-medium ${darkSurface ? 'text-slate-200' : 'text-slate-900'}`}>
                  {item.label}
                </span>
              )}

              {isLast ? null : (
                <span aria-hidden="true" className={darkSurface ? 'text-slate-600' : 'text-slate-300'}>
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  darkSurface = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  darkSurface?: boolean;
  /** Rendered above the title; `PageHeader` owns the spacing either way. */
  breadcrumbs?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {breadcrumbs ? <div className="mb-2">{breadcrumbs}</div> : null}
        <h1 className={`text-2xl font-bold tracking-tight ${darkSurface ? 'text-slate-100' : 'text-slate-900'}`}>
          {title}
        </h1>
        {description ? (
          <p className={`mt-1 text-sm ${darkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

/** Shared wiring for label / hint / error on a single control. */
interface ControlProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /**
   * Marks the control unusable and removes it from the tab order.
   *
   * Beyond the obvious, this matters for forms that carry hidden state: freezing
   * the inputs stops a user from editing them mid-request, which is what keeps a
   * submitted identifier from being regenerated while the original request is
   * still in flight.
   */
  disabled?: boolean;
}

function describedBy(hintId: string | undefined, errorId: string | undefined): string | undefined {
  const ids = [errorId, hintId].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
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
  error,
  disabled,
  darkSurface = false,
  showPasswordToggle = false,
}: ControlProps & {
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  /*
   * `string | number`, matching React's own `InputHTMLAttributes['step']`.
   *
   * The DOM attribute accepts both spellings: `step="0.01"` and `step={0.01}`
   * serialise to the same `step="0.01"`. Narrowing this to `string` alone
   * rejected the numeric literal, which forced call sites into stringly-typed
   * arithmetic — or into an assertion that silenced the real type mismatch.
   */
  step?: string | number;
  minLength?: number;
  maxLength?: number;
  /** Dark styling for authentication forms; shared screens keep the default surface. */
  darkSurface?: boolean;
  /** Adds a keyboard-accessible visibility toggle to password fields. */
  showPasswordToggle?: boolean;
}) {
  // Unique per rendered instance, so two "Quantity" fields on one page no longer
  // collide. `name` stays derived from the label because it is a stable,
  // human-readable identifier rather than a DOM handle.
  const generatedId = useId();
  const id = `field-${generatedId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const hasPasswordToggle = type === 'password' && showPasswordToggle;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className={`block text-sm font-medium ${darkSurface ? 'text-slate-200' : 'text-slate-700'}`}
      >
        {label}
        {required ? '' : <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>

      <div className={hasPasswordToggle ? 'relative' : undefined}>
        <input
          id={id}
          name={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
          type={hasPasswordToggle && passwordVisible ? 'text' : type}
          value={value}
          required={required}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
          // A failed validation must be announced as part of the control, not as a
          // detached banner the user has to find.
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hintId, errorId)}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm shadow-sm outline-none transition ${
            hasPasswordToggle ? 'pr-11' : ''
          } ${
            darkSurface
              ? error
                ? 'border-red-400 bg-red-950/30 text-slate-100 placeholder:text-slate-400 focus:border-red-300'
                : 'border-slate-600 bg-navy-800 text-slate-100 placeholder:text-slate-400 focus:border-accent-400'
              : `text-slate-900 focus:border-brand-500 ${error ? 'border-red-400 bg-red-50/40' : 'border-slate-300'}`
          } ${darkSurface ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900' : focusRing}`}
        />
        {hasPasswordToggle ? (
          <button
            type="button"
            disabled={disabled}
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={passwordVisible}
            aria-controls={id}
            onClick={() => setPasswordVisible((visible) => !visible)}
            className={`absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 transition focus:outline-none focus-visible:ring-2 ${
              darkSurface
                ? 'text-slate-400 hover:text-accent-400 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900'
                : 'text-slate-500 hover:text-slate-800 focus-visible:ring-brand-500'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.25 12s3.5-6.75 9.75-6.75S21.75 12 21.75 12s-3.5 6.75-9.75 6.75S2.25 12 2.25 12Z" />
              <circle cx="12" cy="12" r="3" />
              {!passwordVisible ? <path d="m3 3 18 18" /> : null}
            </svg>
          </button>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className={`text-xs ${darkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={`text-xs font-medium ${darkSurface ? 'text-red-300' : 'text-red-700'}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  required,
  disabled,
  darkSurface = false,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  darkSurface?: boolean;
}) {
  const generatedId = useId();
  const id = `select-${generatedId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`block text-sm font-medium ${darkSurface ? 'text-slate-200' : 'text-slate-700'}`}>
        {label}
        {required === false ? (
          <span className="ml-1 font-normal text-slate-400">(optional)</span>
        ) : null}
      </label>

      <select
        id={id}
        name={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm shadow-sm outline-none transition ${
          darkSurface
            ? error
              ? 'border-red-400 bg-red-950/30 text-slate-100 focus:border-red-300'
              : 'border-slate-700 bg-[#0b1220] text-slate-200 scheme-dark focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15'
            : `bg-white text-slate-900 focus:border-brand-500 ${error ? 'border-red-400 bg-red-50/40' : 'border-slate-300'} ${focusRing}`
        } ${darkSurface ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]' : ''}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hint ? (
        <p id={hintId} className={`text-xs ${darkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={`text-xs font-medium ${darkSurface ? 'text-red-300' : 'text-red-700'}`}>
          {error}
        </p>
      ) : null}
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
  hint,
  error,
  darkSurface = false,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  /** Midnight styling for forms owned by dark workspace pages. */
  darkSurface?: boolean;
}) {
  const generatedId = useId();
  const id = `textarea-${generatedId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`block text-sm font-medium ${darkSurface ? 'text-slate-200' : 'text-slate-700'}`}>
        {label}
        {required ? '' : <span className="ml-1 font-normal text-slate-400">(optional)</span>}
      </label>

      <textarea
        id={id}
        name={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
        value={value}
        rows={rows}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm shadow-sm outline-none transition ${
          darkSurface
            ? error
              ? 'border-red-400 bg-red-950/30 text-slate-100 placeholder:text-slate-400 focus:border-red-300'
              : 'border-slate-600 bg-navy-800 text-slate-100 placeholder:text-slate-400 focus:border-accent-400'
            : `text-slate-900 focus:border-brand-500 ${error ? 'border-red-400 bg-red-50/40' : 'border-slate-300'}`
        } ${darkSurface ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900' : focusRing}`}
      />

      {hint ? (
        <p id={hintId} className={`text-xs ${darkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={`text-xs font-medium ${darkSurface ? 'text-red-300' : 'text-red-700'}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/**
 * Styling for a control that *navigates*.
 *
 * `Link` renders the `<a>` itself, so a router link cannot be wrapped in a
 * button component without putting a `<button>` inside an `<a>` — interactive
 * content nested in interactive content. That markup is invalid, gives the
 * control two tab stops, and makes Enter activate the inner button instead of
 * following the link.
 *
 * The correct alternative is to style the `Link` itself, which is only safe if
 * the link and the button cannot drift apart. That is what these exported
 * constants are for: the button components below render from them, so a link
 * styled here is identical to the button by construction rather than by
 * convention. `WorkspacePage` previously kept a private hand-copied copy of
 * `PrimaryButton`'s class string, and sixteen other call sites had no way to
 * reuse it — which is exactly how the nesting spread.
 *
 * The `disabled:` variants are retained for exact parity with the buttons.
 * They never match on an anchor, so they cost nothing, and omitting them would
 * make the parity test in `ui.test.tsx` compare two different strings.
 */
export const primaryButtonClass = `rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

/** Counterpart of {@link primaryButtonClass} for a `SecondaryButton`-styled link. */
export const secondaryButtonClass = `rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export function PrimaryButton({
  type = 'button',
  onClick,
  disabled,
  form,
  children,
  darkSurface = false,
  variant = 'default',
}: {
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  /** Id of a form elsewhere in the DOM, so a modal footer can submit it. */
  form?: string;
  children: ReactNode;
  darkSurface?: boolean;
  variant?: 'default' | 'emerald';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      form={form}
      className={darkSurface
        ? 'rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]'
        : variant === 'emerald'
          ? 'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2'
          : primaryButtonClass}
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
  darkSurface = false,
}: {
  pending: boolean;
  label: string;
  form?: string;
  disabled?: boolean;
  /** Emerald styling for authentication forms. */
  darkSurface?: boolean;
}) {
  return (
    <button
      type="submit"
      form={form}
      disabled={pending || disabled}
      // `aria-busy` tells assistive tech the control is working, and the label
      // changes so the state is not communicated by the disabled style alone.
      aria-busy={pending}
      className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
        darkSurface
          ? 'bg-accent-500 text-navy-900 hover:bg-accent-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900'
          : `bg-brand-600 text-white hover:bg-brand-700 ${focusRing}`
      }`}
    >
      {pending ? 'Please wait…' : label}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  disabled,
  children,
  darkSurface = false,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** Midnight styling for controls in dark workspace dialogs. */
  darkSurface?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={darkSurface
        ? 'rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]'
        : secondaryButtonClass}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  onClick,
  disabled,
  children,
  darkSurface = false,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** Midnight styling for destructive controls in dark workspace dialogs. */
  darkSurface?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={darkSurface
        ? 'rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-sm font-medium text-rose-200 shadow-sm transition hover:border-rose-400/40 hover:bg-rose-400/[0.12] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]'
        : `rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function ErrorBanner({
  message,
  darkSurface = false,
}: {
  message: string | null;
  darkSurface?: boolean;
}) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className={`rounded-lg border px-3 py-2 text-sm ${
        darkSurface
          ? 'border-red-400/30 bg-red-950/40 text-red-200'
          : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      {message}
    </p>
  );
}

export function Spinner({ label = 'Loading…', darkSurface = false }: { label?: string; darkSurface?: boolean }) {
  return (
    // `role="status"` with a polite live region: assistive tech announces the
    // wait without interrupting. Previously the spinner was `aria-hidden` and the
    // label was ordinary text, so loading was completely silent.
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-3 py-12 text-sm ${darkSurface ? 'text-slate-400' : 'text-slate-500'}`}
    >
      <span
        aria-hidden="true"
        className={`h-4 w-4 animate-spin rounded-full border-2 ${darkSurface ? 'border-slate-700 border-t-emerald-400' : 'border-slate-300 border-t-brand-600'}`}
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  darkSurface = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  darkSurface?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className={`text-base font-semibold ${darkSurface ? 'text-slate-100' : 'text-slate-900'}`}>
        {title}
      </h3>
      <p className={`max-w-sm text-sm ${darkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
        {description}
      </p>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Semantic tones, defined once.
 *
 * Six intelligence pages previously each defined their own `Badge` plus a
 * label/colour pair per status, so the same meaning could be rendered a different
 * colour on different screens. The tone is always paired with text by the caller;
 * colour is never the only carrier of meaning.
 */
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-brand-100 text-brand-700',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/**
 * Body scroll locking, reference-counted.
 *
 * A plain "remember the previous value, restore it on unmount" scheme breaks when
 * two dialogs overlap: the inner one captures `'hidden'`, and on close restores
 * `'hidden'` — leaving the page permanently frozen even though the outer dialog
 * has also closed. Counting open dialogs makes the last one out responsible for
 * unlocking, so an inner dialog can neither leave the body locked nor unlock it
 * out from under the outer one.
 */
let scrollLockCount = 0;
let overflowBeforeLock = '';

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = overflowBeforeLock;
    overflowBeforeLock = '';
  }
}

/**
 * Accessible modal dialog.
 *
 * Focus handling is the whole point of this component:
 *
 *   1. On open, remember what had focus and move focus **to the dialog itself**
 *      (`tabIndex={-1}`). Focusing the first control instead is a common choice
 *      but it silently skips the title, and on long forms it drops the user into
 *      the middle of the form.
 *   2. Tab and Shift+Tab cycle within the dialog, so keyboard focus cannot reach
 *      the page behind it.
 *   3. Escape closes — handled on the dialog element, which now genuinely has
 *      focus, so the keydown actually arrives.
 *   4. On close, focus returns to the element that opened the dialog.
 *   5. Background scroll is locked while open and restored exactly as it was.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  darkSurface = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Midnight theme for dialogs owned by dark workspace pages. */
  darkSurface?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Remember the trigger *before* the dialog moves focus anywhere.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    panel?.focus();

    lockBodyScroll();

    return () => {
      unlockBodyScroll();
      // Returning focus to the trigger is what makes a dialog feel like it closed
      // rather than teleporting the user somewhere arbitrary.
      triggerRef.current?.focus?.();
    };
    // Intentionally mount-only: re-running on every render would yank focus back
    // to the dialog every time a keystroke changed the form state.
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = focusableWithin(panel);
      // Nothing focusable inside: keep focus on the dialog rather than letting Tab
      // escape to the page behind.
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10 ${darkSurface ? 'bg-slate-950/75' : 'bg-slate-900/40'}`}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Focusable programmatically, but removed from the Tab order so the trap
        // below controls traversal explicitly.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`relative w-full max-w-lg rounded-xl border shadow-lg ${darkSurface ? 'border-slate-700 bg-[#101a2a] text-slate-100 shadow-black/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101a2a]' : `border-slate-200 bg-white ${focusRing}`}`}
      >
        <header className={`flex items-center justify-between border-b px-6 py-4 ${darkSurface ? 'border-slate-800' : 'border-slate-200'}`}>
          <h2 id={titleId} className={`text-lg font-semibold ${darkSurface ? 'text-slate-100' : 'text-slate-900'}`}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`rounded p-1 transition focus:outline-none focus-visible:ring-2 ${darkSurface ? 'text-slate-400 hover:bg-white/5 hover:text-slate-100 focus-visible:ring-emerald-400' : `text-slate-400 hover:bg-slate-100 hover:text-slate-600 ${focusRing}`}`}
          >
            ✕
          </button>
        </header>

        <div className="px-6 py-5">{children}</div>

        {footer ? (
          <footer className={`flex justify-end gap-3 border-t px-6 py-4 ${darkSurface ? 'border-slate-800' : 'border-slate-200'}`}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Yes/no confirmation, replacing native `window.confirm` on a later milestone.
 *
 * Native confirm cannot be styled, blocks the main thread, and looks unrelated to
 * the rest of the product. This is the same question, answered in the product's
 * own voice — and because it builds on `Modal`, it inherits the focus handling.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  pending = false,
  darkSurface = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  /** Midnight styling for confirmations owned by dark workspace pages. */
  darkSurface?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;

  return (
    <Modal
      title={title}
      onClose={pending ? () => undefined : onCancel}
      darkSurface={darkSurface}
      footer={
        <>
          <SecondaryButton onClick={onCancel} disabled={pending} darkSurface={darkSurface}>
            {cancelLabel}
          </SecondaryButton>
          {tone === 'danger' ? (
            <DangerButton onClick={onConfirm} disabled={pending} darkSurface={darkSurface}>
              {pending ? 'Working…' : confirmLabel}
            </DangerButton>
          ) : (
            <PrimaryButton onClick={onConfirm} disabled={pending}>
              {pending ? 'Working…' : confirmLabel}
            </PrimaryButton>
          )}
        </>
      }
    >
      <p className={`text-sm ${darkSurface ? 'text-slate-300' : 'text-slate-600'}`}>{description}</p>
      {children}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export interface DataTableColumn<Row> {
  /** Stable key, also used as the accessible header id. */
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  /** Applied to every cell in the column — typically a numeric font style. */
  className?: string;
}

/**
 * A table with its four states built in.
 *
 * Loading, empty and error previously depended on each page remembering to render
 * them, and several pages rendered *nothing* while `data === null`, so the screen
 * simply went blank. Making the states part of the component removes that failure
 * mode by construction: you supply the data and cannot forget the rest.
 *
 * Narrow viewports scroll horizontally rather than reflowing the table into
 * unreadable stacks.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  empty,
  onRetry,
}: {
  /** Describes the table for assistive technology. Required — a table without one is not navigable. */
  caption: string;
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  error?: string | null;
  empty?: { title: string; description: string; action?: ReactNode };
  onRetry?: () => void;
}) {
  const alignClass = (align?: 'left' | 'right') =>
    align === 'right' ? 'text-right' : 'text-left';

  if (loading) return <Spinner label="Loading…" />;

  if (error) {
    return (
      <div className="space-y-3 p-6">
        <ErrorBanner message={error} />
        {onRetry ? (
          <SecondaryButton onClick={onRetry}>Try again</SecondaryButton>
        ) : null}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? 'Nothing to show'}
        description={empty?.description ?? 'There is no data for the current filters.'}
        {...(empty?.action !== undefined ? { action: empty.action } : {})}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold tracking-wide text-slate-500 uppercase ${alignClass(
                  column.align,
                )}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-3 text-slate-700 ${alignClass(column.align)} ${column.className ?? ''}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
