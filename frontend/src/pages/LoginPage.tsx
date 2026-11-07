import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { ApiError, type LoginWorkspace } from '../lib/api';
import { AuthCard, Field, FormError, SubmitButton } from '../auth/components';
import { Select } from '../components/ui';

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
  const [workspaces, setWorkspaces] = useState<LoginWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');

  function clearWorkspaceChoice() {
    setWorkspaces(null);
    setWorkspaceId('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    clearError();

    try {
      const choices = await login({ email, password, ...(workspaceId ? { workspaceId } : {}) });
      if (choices) {
        setWorkspaces(choices);
        setWorkspaceId('');
        return;
      }
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
      subtitle="Welcome back to your inventory workspace."
      artHeading={<>Know your stock.<br />Plan what’s next.</>}
      artDescription="Stock levels, movements, and reorder decisions in one workspace."
      footer={
        <>
          New to StockPilot?{' '}
          <Link to="/register" className="auth-text-link">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <FormError message={formError ?? error} />

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(value) => { setEmail(value); clearWorkspaceChoice(); }}
          disabled={pending}
          autoComplete="email"
          placeholder="you@business.com"
        />

        <div>
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(value) => { setPassword(value); clearWorkspaceChoice(); }}
            disabled={pending}
            autoComplete="current-password"
            showPasswordToggle
          />
          <div className="auth-recovery">
            <button
              type="button"
              onClick={() => setRecoveryNotice(true)}
              className="auth-text-link"
            >
              Forgot password?
            </button>
          </div>
        </div>

        {recoveryNotice ? (
          <p role="status" className="auth-notice">
            Password recovery is not configured yet.
          </p>
        ) : null}

        {workspaces ? (
          <>
            <p role="status" className="auth-notice">These sign-in details match more than one workspace.</p>
            <Select
              label="Workspace"
              value={workspaceId}
              onChange={setWorkspaceId}
              options={[
                { value: '', label: 'Choose your workspace' },
                ...workspaces.map(({ id, name }, index) => ({
                  value: id,
                  label: workspaces.some((other) => other.id !== id && other.name === name)
                    ? `${name} (${index + 1})`
                    : name,
                })),
              ]}
              required
              disabled={pending}
            />
          </>
        ) : null}

        <SubmitButton pending={pending} label={workspaces ? 'Open workspace' : 'Sign in'} />
      </form>
    </AuthCard>
  );
}
