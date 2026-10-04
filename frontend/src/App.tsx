/**
 * Application shell and route table.
 *
 * Route shape:
 *   /            → redirect to /app
 *   /login       → public only; a signed-in user is bounced to /app
 *   /register    → public only
 *   /app/*       → protected; the session supplies the tenant
 *
 * There is deliberately no `/:businessId` segment. Business scope comes from the
 * server-side session, so there is no tenant identifier in the URL to tamper
 * with, and no way to reach another business's data by editing a link.
 */

import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute, PublicOnlyRoute } from './auth/ProtectedRoute';
import { CategoriesPage } from './pages/CategoriesPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { RegisterPage } from './pages/RegisterPage';
import { WorkspaceLayout } from './pages/WorkspaceLayout';
import { WorkspacePage } from './pages/WorkspacePage';

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<WorkspaceLayout />}>
          <Route index element={<WorkspacePage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default App;
