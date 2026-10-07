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
import { ActionsPage } from './pages/ActionsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { DemandPage } from './pages/DemandPage';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { OverstockPage } from './pages/OverstockPage';
import { ProductsPage } from './pages/ProductsPage';
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReorderPage } from './pages/ReorderPage';
import { SaleDetailPage } from './pages/SaleDetailPage';
import { SalesPage } from './pages/SalesPage';
import { SlowDeadPage } from './pages/SlowDeadPage';
import { StockRiskPage } from './pages/StockRiskPage';
import { UnifiedIntelligencePage } from './pages/UnifiedIntelligencePage';
import { SupplierIntelligencePage } from './pages/SupplierIntelligencePage';
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
          <Route path="demand" element={<DemandPage />} />
          <Route path="reorder" element={<ReorderPage />} />
          <Route path="overstock" element={<OverstockPage />} />
          <Route path="intelligence" element={<UnifiedIntelligencePage />} />
          <Route path="recommendations" element={<RecommendationsPage />} />
          <Route path="actions" element={<ActionsPage />} />
          <Route path="slow-dead" element={<SlowDeadPage />} />
          <Route path="supplier-intelligence" element={<SupplierIntelligencePage />} />
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
