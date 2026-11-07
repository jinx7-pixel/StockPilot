import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { StockPilotLogo } from '../components/StockPilotLogo';
import { ErrorBanner, Field, SubmitButton } from '../components/ui';
import './auth-showcase.css';

export { ErrorBanner as FormError, Field, SubmitButton };

export function AuthCard({
  title,
  subtitle,
  artHeading,
  artDescription,
  children,
  footer,
  showGoogle = true,
}: {
  title: string;
  subtitle: string;
  artHeading: ReactNode;
  artDescription: string;
  children: ReactNode;
  footer: ReactNode;
  showGoogle?: boolean;
}) {
  const headingId = useId();
  const googleStatusId = useId();

  return (
    <main className="auth-page font-landing">
      <div className="auth-art">
        <span className="auth-art-label">Inventory intelligence</span>
        <div className="auth-art-copy">
          <p>{artHeading}</p>
          <p>{artDescription}</p>
        </div>
      </div>

      <div className="auth-content">
        <section aria-labelledby={headingId} className="auth-panel">
          <Link to="/" className="auth-brand" aria-label="StockPilot home">
            <StockPilotLogo className="[--stockpilot-logo-size:40px]" />
            StockPilot
          </Link>

          <header className="auth-heading">
            <h1 id={headingId}>{title}</h1>
            <p>{subtitle}</p>
          </header>

          {children}

          {showGoogle && <>
          <div className="auth-divider" aria-hidden="true">or</div>
          <button type="button" disabled aria-describedby={googleStatusId} className="auth-google">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 48 48" fill="none">
              <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.6h11c-.5 2.4-1.8 4.4-3.9 5.8v4.9h6.3c3.7-3.4 5.8-8.4 5.8-14.3Z" />
              <path fill="#34A853" d="M24 44c5.4 0 9.9-1.8 13.2-5.2L31 33c-1.8 1.2-4.1 2-7 2-5.4 0-9.6-3.7-11.5-8.6H6.1v5.1C9.4 39 16.1 44 24 44Z" />
              <path fill="#FBBC05" d="M12.5 26.4a12 12 0 0 1 0-4.8v-5.1H6.1a20 20 0 0 0 0 15Z" />
              <path fill="#EA4335" d="M24 12.9c3 0 5.7 1 7.8 3l5.8-5.8C34.1 6.8 29.4 4.8 24 4.8c-7.9 0-14.6 4.8-17.9 11.7l6.4 5.1c1.6-4.9 6.1-8.7 11.5-8.7Z" />
            </svg>
            Continue with Google
          </button>
          <p id={googleStatusId} className="auth-google-status">
            Google sign-in is not configured yet.
          </p>
          </>}

          <p className="auth-footer">{footer}</p>
        </section>
      </div>
    </main>
  );
}
