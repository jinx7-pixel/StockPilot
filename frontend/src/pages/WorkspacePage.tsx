/**
 * Placeholder overview.
 *
 * Deliberately NOT the dashboard — that is a later milestone. It exists so the
 * navigation has a landing page and to confirm the protected-route plumbing.
 */

import { Link } from 'react-router-dom';

import { Card, EmptyState, PageHeader } from '../components/ui';
import { useAuth } from '../auth/authContext';

/**
 * A router link that looks like a button.
 *
 * Previously this was `<Link><PrimaryButton>…</PrimaryButton></Link>`, which
 * nests a `<button>` inside an `<a>`. Nested interactive elements are invalid HTML:
 * Enter activates the inner button rather than following the link, and assistive
 * technology announces two overlapping controls. `Link` renders the `<a>` itself,
 * so the button styling has to be applied to it.
 */
const linkButtonClass =
  'inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:outline-none';

export function WorkspacePage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0] ?? user.name}`}
        description="Your workspace is ready. Business modules are being added next."
      />

      <Card>
        <EmptyState
          title="Your workspace at a glance"
          description="Record stock, sell, and buy — then let Analytics show you what is moving. Suppliers, purchasing and risk insights arrive in later milestones."
          action={
            <div className="flex gap-2">
              <Link to="/app/analytics" className={linkButtonClass}>
                View analytics
              </Link>
              <Link to="/app/inventory" className={linkButtonClass}>
                Go to inventory
              </Link>
            </div>
          }
        />
      </Card>
    </div>
  );
}
