import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { AuthCard, Field, FormError, SubmitButton } from '../auth/components';
import { api, ApiError } from '../lib/api';

/** Must match the server's minimum, so the browser catches it before the round trip. */
const MIN_PASSWORD_LENGTH = 12;

export function RegisterPage() {
  const { register, error, clearError } = useAuth();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token');

  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    clearError();

    try {
      if (token) {
        await register({ businessName, name, email, token, password });
        navigate('/app', { replace: true });
      } else {
        await api.requestRegistration(email);
        setSent(true);
      }
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
      title="Create an account"
      subtitle={token ? 'Confirm the email that received the link and set up your workspace.' : 'Start by verifying your email address.'}
      showGoogle={false}
      artHeading={<>Put your inventory<br />in one place.</>}
      artDescription="Track products and stock levels with your team."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="auth-text-link">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <FormError message={formError ?? error} />

        <Field label="Email" type="email" value={email} onChange={(value) => { setEmail(value); setSent(false); }}
          autoComplete="email" placeholder="you@business.com" disabled={pending} />
        {token ? <>
        <div className="auth-form-row">
          <Field
            label="Business name"
            value={businessName}
            onChange={setBusinessName}
            autoComplete="organization"
            placeholder="Acme Supplies Ltd"
          />

          <Field
            label="Your name"
            value={name}
            onChange={setName}
            autoComplete="name"
            placeholder="Alex Morgan"
          />
        </div>

        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
          showPasswordToggle
        />

        <SubmitButton pending={pending} label="Create account" />
        <Link to="/register" replace onClick={() => setFormError(null)} className="auth-text-link">Request a new link</Link>
        </> : <>
          {sent && <p role="status" className="auth-notice">If this address can be registered, you’ll receive a link that expires in 30 minutes.</p>}
          <SubmitButton pending={pending} label={sent ? 'Resend verification link' : 'Send verification link'} />
        </>}
      </form>
    </AuthCard>
  );
}
