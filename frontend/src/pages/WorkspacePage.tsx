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
          title="Nothing to show yet"
          description="StockPilot currently covers accounts and the product catalog. Inventory tracking, suppliers, purchasing and risk insights arrive in later milestones."
          action={
            <div className="flex gap-2">
              <Link to="/app/products">
                <PrimaryButton>Go to products</PrimaryButton>
              </Link>
              <Link to="/app/categories">
                <PrimaryButton>Manage categories</PrimaryButton>
              </Link>
            </div>
          }
        />
      </Card>
    </div>
  );
}
