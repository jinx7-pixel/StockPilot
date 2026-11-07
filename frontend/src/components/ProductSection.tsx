import { StockPilotLogo } from './StockPilotLogo';
import './product-showcase.css';

const PRODUCTS = [
  { name: 'Arabica Beans 1kg', sku: 'SKU-1042', category: 'Beverages', stock: '148', status: 'In stock', tone: 'ok' },
  { name: 'Oat Milk 1L', sku: 'SKU-2071', category: 'Dairy alternatives', stock: '6', status: 'Low stock', tone: 'low' },
  { name: 'Ceramic Mug', sku: 'SKU-3390', category: 'Homeware', stock: '0', status: 'Out of stock', tone: 'out' },
  { name: 'Cold Brew Bottle', sku: 'SKU-4417', category: 'Beverages', stock: '312', status: 'In stock', tone: 'ok' },
];

/** A single illustrative workspace; its sample figures are never live data. */
export function ProductSection() {
  return (
    <section id="product" aria-labelledby="product-heading" className="sp-product">
      <div className="sp-product-inner">
        <div className="sp-product-intro">
          <div>
            <p className="sp-product-eyebrow"><span aria-hidden="true" /> The Product</p>
            <h2 id="product-heading">Your Inventory. <span>One Clear Picture.</span></h2>
          </div>
          <div className="sp-product-lead">
            <p>Your catalogue, stock ledger, sales and purchasing, together. See what needs attention and decide your next move.</p>
            <a href="#how-it-works">See how it works <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <figure className="sp-workspace-figure">
          <div className="sp-workspace-preview" role="img" aria-label="Illustrative StockPilot workspace with sample data: 412 products and 18,940 stock units. Oat Milk has 6 units against a reorder point of 12. Its recommendation includes evidence and medium confidence; a reviewed recommendation can become a draft purchase order.">
            <div aria-hidden="true" className="sp-workspace-shell">
              <div className="sp-workspace-toolbar">
                <span className="sp-workspace-brand"><StockPilotLogo /> StockPilot</span>
                <span className="sp-workspace-path">Workspace <span>/</span> Overview</span>
                <span className="sp-workspace-demo"><i /> Sample workspace</span>
              </div>
              <div className="sp-workspace-layout">
                <div className="sp-workspace-sidebar">
                  <span className="sp-workspace-business"><b>N</b><span>Northside Supply<small>Business workspace</small></span></span>
                  <span className="sp-workspace-nav-label">WORKSPACE</span>
                  <span className="sp-workspace-nav-active">▦ <span>Overview</span></span>
                  <span>↗ <span>Analytics</span></span>
                  <span className="sp-workspace-nav-label">OPERATIONS</span>
                  <span>▤ <span>Inventory</span></span>
                  <span>◫ <span>Products</span></span>
                  <span>↳ <span>Purchase orders</span></span>
                  <span className="sp-workspace-nav-label">INTELLIGENCE</span>
                  <span>◎ <span>Stock insights</span></span>
                  <span>✓ <span>Action center</span></span>
                </div>
                <div className="sp-workspace-main">
                  <div className="sp-workspace-heading"><div><p>Inventory overview</p><span>A clearer view of what’s on your shelves.</span></div><span className="sp-workspace-period">Overview</span></div>
                  <div className="sp-workspace-metrics">
                    <div><span>Products</span><strong>412</strong></div>
                    <div><span>Stock units</span><strong>18,940</strong></div>
                    <div><span>With stock</span><strong>389</strong></div>
                    <div><span>Out of stock</span><strong className="sp-metric-alert">23</strong></div>
                  </div>
                  <div className="sp-workspace-detail">
                    <div className="sp-workspace-stock">
                      <div className="sp-workspace-panel-title"><b>Your inventory</b><span>4 sample products</span></div>
                      <table>
                        <thead><tr><th>Product</th><th className="sp-workspace-category">Category</th><th>Stock</th><th>Status</th></tr></thead>
                        <tbody>{PRODUCTS.map((product) => (
                          <tr key={product.sku} className={product.tone === 'low' ? 'sp-workspace-highlight' : undefined}>
                            <td><b>{product.name}</b><small>{product.sku}</small></td>
                            <td className="sp-workspace-category">{product.category}</td>
                            <td>{product.stock}</td>
                            <td><span className={`sp-stock-status sp-stock-status-${product.tone}`}>{product.status}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                      <div className="sp-workspace-table-note"><span /> Every movement. One consistent stock record.</div>
                    </div>
                    <div className="sp-workspace-insight">
                      <div className="sp-workspace-insight-title"><span>✦</span> Stock insight</div>
                      <span className="sp-workspace-priority">REPLENISH</span>
                      <p>Oat Milk needs <br />your attention.</p>
                      <div className="sp-workspace-stock-meter"><strong>6 <small>units left</small></strong><span>Reorder at 12</span></div>
                      <div className="sp-workspace-meter"><span /></div>
                      <span className="sp-workspace-evidence">Evidence · 21 stock movements</span>
                      <span className="sp-workspace-confidence">Medium confidence</span>
                      <div className="sp-workspace-next"><span>NEXT STEP</span><b>Review → draft purchase order</b></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <figcaption>Illustrative preview · Sample data. Your workspace shows your own inventory.</figcaption>
        </figure>
        <div className="sp-product-takeaway"><span aria-hidden="true">↳</span><p>From seeing your stock to knowing your next move.<br /><span>Review the evidence. Create a draft purchase order. Stay in control.</span></p></div>
      </div>
    </section>
  );
}

export default ProductSection;
