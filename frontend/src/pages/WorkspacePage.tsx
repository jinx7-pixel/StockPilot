/**
 * Placeholder overview.
 *
 * Deliberately NOT the dashboard — that is a later milestone. It exists so the
 * navigation has a landing page and to confirm the protected-route plumbing.
 */

import { Link } from 'react-router-dom';

import { Card, EmptyState, PageHeader, PrimaryButton } from '../components/ui';
import { useAuth } from '../auth/authContext';

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
              <Link to="/app/analytics">
                <PrimaryButton>View analytics</PrimaryButton>
              </Link>
              <Link to="/app/inventory">
                <PrimaryButton>Go to inventory</PrimaryButton>
              </Link>
            </div>
          }
        />
      </Card>
    </div>
  );
}
