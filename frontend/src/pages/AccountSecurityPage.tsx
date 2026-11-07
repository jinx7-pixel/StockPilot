import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../auth/authContext';
import { Field, FormError, SubmitButton } from '../auth/components';
import { api, ApiError, type AccountSecurity } from '../lib/api';

const panelClass = 'space-y-4 rounded-xl border border-slate-200 bg-white p-5 sm:p-6';
const actionClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50';

function errorMessage(cause: unknown) {
  return cause instanceof ApiError ? cause.message : 'Please try again.';
}

export function AccountSecurityPage() {
  const { user, logoutAll } = useAuth();
  const [security, setSecurity] = useState<AccountSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    api.security().then((data) => { if (active) setSecurity(data); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!security) return;
    void run(async () => {
      if (security.mfaEnabled) {
        await api.disableMfa(password, code);
        setRecoveryCodes([]);
        setSecurity({ ...security, mfaEnabled: false, recoveryCodesRemaining: 0 });
        setNotice('Two-step verification is off. Other sessions were signed out.');
      } else if (secret) {
        const result = await api.enableMfa(code);
        setRecoveryCodes(result.recoveryCodes);
        setSecret(null);
        setSecurity({ ...security, mfaEnabled: true, recoveryCodesRemaining: result.recoveryCodes.length });
        setNotice('Two-step verification is on. Other sessions were signed out.');
      } else {
        const result = await api.startMfa(password);
        setSecret(result.secret);
      }
      setCode('');
      setPassword('');
    });
  }

  return (
    <section className="max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Account security</h1>
        <p className="mt-1 text-sm text-slate-600">Manage your verified email, two-step verification, and sessions.</p>
      </header>
      <FormError message={error} />
      {notice && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-950">{notice}</p>}
      {security ? <>
        <section className={panelClass} aria-labelledby="security-email">
          <h2 id="security-email" className="font-semibold text-slate-950">Email verification</h2>
          <p className="text-sm text-slate-600">{user?.email} · {security.emailVerified ? 'Verified' : 'Unverified'}</p>
          {!security.emailVerified && <button type="button" className={actionClass} disabled={pending}
            onClick={() => void run(async () => {
              await api.requestVerification();
              setNotice('Check your inbox for a verification link.');
            })}>Send verification link</button>}
        </section>
        <section className={panelClass} aria-labelledby="security-mfa">
          <h2 id="security-mfa" className="font-semibold text-slate-950">Two-step verification</h2>
          <p className="text-sm text-slate-600">
            {security.mfaEnabled ? `On · ${security.recoveryCodesRemaining} recovery codes remaining`
              : 'Use an authenticator app to add a second step at sign in.'}
          </p>
          {recoveryCodes.length > 0 && <div className="rounded-lg bg-sky-50 p-4 text-sm text-sky-950">
            <p>Save these one-time recovery codes somewhere safe. You can only see them now.</p>
            <ul className="my-3 grid gap-2 font-mono sm:grid-cols-2">
              {recoveryCodes.map((value) => <li key={value}>{value}</li>)}
            </ul>
            <button type="button" className={actionClass} onClick={() => setRecoveryCodes([])}>I saved my codes</button>
          </div>}
          {!security.emailVerified ? <p className="text-sm text-slate-600">Verify your email to enable two-step verification.</p>
            : recoveryCodes.length === 0 && <form onSubmit={submitMfa} className="max-w-sm space-y-4">
              {secret ? <p className="text-sm text-slate-700">Add a time-based account named StockPilot in your authenticator app and enter this setup key.
                <code className="mt-2 block break-all rounded bg-slate-100 p-2">{secret}</code>
              </p> : <Field label="Current password" type="password" value={password} onChange={setPassword}
                autoComplete="current-password" disabled={pending} />}
              {(secret || security.mfaEnabled) && <Field label={secret ? 'Authenticator code' : 'Authenticator or recovery code'}
                value={code} onChange={setCode} autoComplete="one-time-code" disabled={pending} />}
              <SubmitButton pending={pending} label={security.mfaEnabled ? 'Turn off two-step verification' : secret ? 'Verify and enable' : 'Set up authenticator'} />
              {secret && <button type="button" className={actionClass} disabled={pending}
                onClick={() => { setSecret(null); setCode(''); }}>Cancel setup</button>}
            </form>}
        </section>
        <section className={panelClass} aria-labelledby="security-sessions">
          <h2 id="security-sessions" className="font-semibold text-slate-950">Sessions</h2>
          <p className="text-sm text-slate-600">Sign out of every device, including this one.</p>
          <button type="button" className={actionClass} disabled={pending}
            onClick={() => void run(logoutAll)}>Sign out everywhere</button>
        </section>
      </> : !error && <p role="status" className="text-sm text-slate-600">Loading account security…</p>}
    </section>
  );
}
