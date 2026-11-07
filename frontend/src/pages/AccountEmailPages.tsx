import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { AuthCard, Field, FormError, SubmitButton } from '../auth/components';
import { api, ApiError } from '../lib/api';

export function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (reset && token) {
        await api.resetPassword(token, value);
        // Reset revoked this browser's session too. Reload the auth provider.
        window.location.replace('/login?password=updated');
      } else {
        await api.requestReset(value);
        setSent(true);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title={reset ? 'Choose a new password' : 'Reset your password'}
      subtitle={reset ? 'Changing your password signs you out on every device.' : 'Enter the verified email on your StockPilot account.'}
      artHeading="Get back to your workspace." artDescription="Keep your workspace and account secure."
      showGoogle={false} footer={<Link to="/login" className="auth-text-link">Back to sign in</Link>}>
      {reset && !token ? (
        <Link to="/forgot-password" className="auth-text-link">Request a password reset link</Link>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <FormError message={error} />
          {sent && <p role="status" className="auth-notice">If this address is verified, you’ll receive a password reset link.</p>}
          <Field label={reset ? 'New password' : 'Email'} type={reset ? 'password' : 'email'} value={value}
            onChange={(next) => { setValue(next); setSent(false); }} disabled={pending}
            autoComplete={reset ? 'new-password' : 'email'} minLength={reset ? 12 : undefined} showPasswordToggle={reset} />
          <SubmitButton pending={pending} label={reset ? 'Update password' : sent ? 'Resend reset link' : 'Send reset link'} />
          {reset && <Link to="/forgot-password" className="auth-text-link">Request a new link</Link>}
        </form>
      )}
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const { hash } = useLocation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = new URLSearchParams(hash.slice(1)).get('token');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      await api.verifyEmail(token);
      navigate('/app/security', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Verify your email" subtitle={`Confirm this link for ${user?.business.name ?? 'your workspace'}.`}
      artHeading="Protect your account." artDescription="Verify your email to enable password recovery."
      showGoogle={false} footer={<Link to="/app/security" replace className="auth-text-link">Account security</Link>}>
      {token ? (
        <form className="auth-form" onSubmit={submit}>
          <FormError message={error} />
          <SubmitButton pending={pending} label="Verify email" />
        </form>
      ) : <p role="status" className="auth-notice">Open the link from your verification email.</p>}
    </AuthCard>
  );
}
