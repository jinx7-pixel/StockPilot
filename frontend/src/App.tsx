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
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { RegisterPage } from './pages/RegisterPage';
import { SaleDetailPage } from './pages/SaleDetailPage';
import { SalesPage } from './pages/SalesPage';
import { StockRiskPage } from './pages/StockRiskPage';
import { SuppliersPage } from './pages/SuppliersPage';
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
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="stock-risk" element={<StockRiskPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/:productId" element={<InventoryDetailPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="sales/:saleId" element={<SaleDetailPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="purchase-orders/:orderId" element={<PurchaseOrderDetailPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default App;
