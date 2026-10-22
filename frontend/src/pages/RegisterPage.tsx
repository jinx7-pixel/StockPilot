import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { AuthCard, Field, FormError, SubmitButton } from '../auth/components';
import { ApiError } from '../lib/api';

/** Must match the server's minimum, so the browser catches it before the round trip. */
const MIN_PASSWORD_LENGTH = 12;

export function RegisterPage() {
  const { register, error, clearError } = useAuth();
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    clearError();

    try {
      // The server creates the business and makes this user its owner, then
      // signs them in — all in one transaction.
      await register({ businessName, name, email, password });
      navigate('/app', { replace: true });
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.message : 'Registration failed. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      darkSurface
      compact
      title="Create your business"
      subtitle="You will be the owner of a new StockPilot workspace."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-accent-400 hover:text-accent-300">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormError message={formError ?? error} darkSurface />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Business name"
            value={businessName}
            onChange={setBusinessName}
            autoComplete="organization"
            placeholder="Acme Supplies Ltd"
            darkSurface
          />

          <Field
            label="Your name"
            value={name}
            onChange={setName}
            autoComplete="name"
            placeholder="Alex Morgan"
            darkSurface
          />
        </div>

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@business.com"
          darkSurface
        />

        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          darkSurface
          showPasswordToggle
        />

        <p className="text-xs text-slate-400">Use at least {MIN_PASSWORD_LENGTH} characters.</p>

        <SubmitButton pending={pending} label="Create business" darkSurface />
      </form>

      <div
        aria-hidden="true"
        className="mt-4 flex items-center gap-4 text-xs font-medium tracking-[0.18em] text-slate-500"
      >
        <span className="h-px flex-1 bg-slate-700" />
        <span>OR</span>
        <span className="h-px flex-1 bg-slate-700" />
      </div>

      <button
        type="button"
        disabled
        aria-describedby="google-sign-up-status"
        className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-lg border border-slate-700 bg-navy-900 px-4 py-2.5 text-sm font-medium text-slate-400 opacity-75"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 48 48" fill="none">
          <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.6h11c-.5 2.4-1.8 4.4-3.9 5.8v4.9h6.3c3.7-3.4 5.8-8.4 5.8-14.3Z" />
          <path fill="#34A853" d="M24 44c5.4 0 9.9-1.8 13.2-5.2L31 33c-1.8 1.2-4.1 2-7 2-5.4 0-9.9-3.7-11.5-8.6H6.1v5.1C9.4 39 16.1 44 24 44Z" />
          <path fill="#FBBC05" d="M12.5 26.4a12 12 0 0 1 0-4.8v-5.1H6.1a20 20 0 0 0 0 15Z" />
          <path fill="#EA4335" d="M24 12.9c3 0 5.7 1 7.8 3l5.8-5.8C34.1 6.8 29.4 4.8 24 4.8c-7.9 0-14.6 5-17.9 11.7l6.4 5.1c1.6-4.9 6.1-8.7 11.5-8.7Z" />
        </svg>
        Continue with Google
      </button>
      <p id="google-sign-up-status" className="mt-2 text-center text-xs text-slate-500">
        Google sign-in is not configured yet.
      </p>
    </AuthCard>
  );
}

