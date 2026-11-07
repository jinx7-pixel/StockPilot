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
      title="Create an account"
      subtitle="Set up your business workspace and start tracking stock."
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
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
          showPasswordToggle
        />

        <SubmitButton pending={pending} label="Create account" />
      </form>
    </AuthCard>
  );
}
