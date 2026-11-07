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
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [workspaces, setWorkspaces] = useState<LoginWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');

  function clearWorkspaceChoice() {
    setWorkspaces(null);
    setWorkspaceId('');
    setMfaRequired(false);
    setMfaCode('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    clearError();

    try {
      const choices = await login({
        email, password,
        ...(workspaceId ? { workspaceId } : {}),
        ...(mfaRequired ? { mfaCode } : {}),
      });
      if (choices) {
        setWorkspaces(choices);
        setWorkspaceId('');
        return;
      }
      const target = (location.state as LocationState | null)?.from ?? '/app';
      navigate(target, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'MFA_REQUIRED') {
        setMfaRequired(true);
        return;
      }
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
        {new URLSearchParams(location.search).get('password') === 'updated' &&
          <p role="status" className="auth-notice">Password updated. Sign in with your new password.</p>}
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
            <Link to="/forgot-password" className="auth-text-link">Forgot password?</Link>
          </div>
        </div>

        {workspaces ? (
          <>
            <p role="status" className="auth-notice">These sign-in details match more than one workspace.</p>
            <Select
              label="Workspace"
              value={workspaceId}
              onChange={(value) => { setWorkspaceId(value); setMfaRequired(false); setMfaCode(''); }}
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

        {mfaRequired ? (
          <Field label="Authenticator or recovery code" value={mfaCode} onChange={setMfaCode}
            autoComplete="one-time-code" disabled={pending} />
        ) : null}
        <SubmitButton pending={pending} label={mfaRequired ? 'Verify and sign in' : workspaces ? 'Open workspace' : 'Sign in'} />
      </form>
    </AuthCard>
  );
}
