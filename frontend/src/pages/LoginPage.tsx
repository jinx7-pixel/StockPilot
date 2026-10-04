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
      title="Sign in"
      subtitle="Access your business inventory workspace."
      footer={
        <>
          Need an account?{' '}
          <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={formError ?? error} />

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@business.com"
        />

        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <SubmitButton pending={pending} label="Sign in" />
      </form>
    </AuthCard>
  );
}

