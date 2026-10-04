/**
 * Application shell and route table.
 *
 * Route shape:
 *   /            → redirect to /app (or /login once the session is known)
 *   /login       → public only; a signed-in user is bounced to /app
 *   /register    → public only
 *   /app/*       → protected; requires a session, which supplies the tenant
 *
 * There is deliberately no `/:businessId` segment. Business scope comes from the
 * server-side session, so there is no tenant identifier in the URL to tamper
 * with, and no way to reach another business's data by editing a link.
 */

import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute, PublicOnlyRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { WorkspacePage } from './pages/WorkspacePage';

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<WorkspacePage />} />
        {/* Placeholder until the first real business module lands. */}
        <Route path="/app/:section" element={<WorkspacePage />} />
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default App;
