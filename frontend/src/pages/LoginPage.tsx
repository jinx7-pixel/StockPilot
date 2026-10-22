import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { ApiError } from '../lib/api';
import { AuthCard, Field, FormError, SubmitButton } from '../auth/components';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    clearError();

    try {
      await login({ email, password });
      const target = (location.state as LocationState | null)?.from ?? '/app';
      navigate(target, { replace: true });
    } catch (cause) {
      // The API returns one indistinguishable message for a wrong password and
      // an unknown email, so this cannot be used to probe for accounts.
      setFormError(cause instanceof ApiError ? cause.message : 'Sign in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      darkSurface
      title="Sign in"
      subtitle="Access your business inventory workspace."
      footer={
        <>
          Need an account?{' '}
          <Link to="/register" className="font-semibold text-accent-400 hover:text-accent-300">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={formError ?? error} darkSurface />

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@business.com"
          darkSurface
        />

        <div className="space-y-2">
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            darkSurface
            showPasswordToggle
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRecoveryNotice(true)}
              className="rounded text-sm font-semibold text-accent-400 underline-offset-4 transition hover:text-accent-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
            >
              Forgot password?
            </button>
          </div>
        </div>

        {recoveryNotice ? (
          <p role="status" className="text-xs text-slate-400">
            Password recovery is not configured yet.
          </p>
        ) : null}

        <SubmitButton pending={pending} label="Sign in" darkSurface />
      </form>

      <div
        aria-hidden="true"
        className="mt-5 flex items-center gap-4 text-xs font-medium tracking-[0.18em] text-slate-500"
      >
        <span className="h-px flex-1 bg-slate-700" />
        <span>OR</span>
        <span className="h-px flex-1 bg-slate-700" />
      </div>

      <button
        type="button"
        disabled
        aria-describedby="google-sign-in-status"
        className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-lg border border-slate-700 bg-navy-900 px-4 py-2.5 text-sm font-medium text-slate-400 opacity-75"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 48 48" fill="none">
          <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.6h11c-.5 2.4-1.8 4.4-3.9 5.8v4.9h6.3c3.7-3.4 5.8-8.4 5.8-14.3Z" />
          <path fill="#34A853" d="M24 44c5.4 0 9.9-1.8 13.2-5.2L31 33c-1.8 1.2-4.1 2-7 2-5.4 0-9.9-3.7-11.5-8.6H6.1v5.1C9.4 39 16.1 44 24 44Z" />
          <path fill="#FBBC05" d="M12.5 26.4a12 12 0 0 1 0-4.8v-5.1H6.1a20 20 0 0 0 0 15Z" />
          <path fill="#EA4335" d="M24 12.9c3 0 5.7 1 7.8 3l5.8-5.8C34.1 6.8 29.4 4.8 24 4.8c-7.9 0-14.6 5-17.9 11.7l6.4 5.1c1.6-4.9 6.1-8.7 11.5-8.7Z" />
        </svg>
        Continue with Google
      </button>
      <p id="google-sign-in-status" className="mt-3 text-center text-xs text-slate-500">
        Google sign-in is not configured yet.
      </p>
    </AuthCard>
  );
}

