import { useEffect, useRef, useState, type ReactNode } from 'react';
import './features-showcase.css';

function FeatureCard({ kind, children }: { kind: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setEntered(true);
        observer.disconnect();
      }
    }, { threshold: 0.15 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <article ref={ref} className={`sf-card sf-${kind}`} data-entered={entered}>{children}</article>;
}

const STEPS = [
  { mark: '↗', title: 'Record a stock movement', detail: 'Stock in, stock out, or an adjustment.' },
  { mark: '!', title: 'Spot a low-stock signal', detail: 'See what has fallen below its reorder point.' },
  { mark: '✓', title: 'Review the recommendation', detail: 'Check the evidence before deciding.' },
  { mark: '↳', title: 'Create a draft purchase order', detail: 'You review it. You stay in control.' },
];

export function FeaturesSection() {
  const footerRef = useRef<HTMLDivElement>(null);
  const [showShine, setShowShine] = useState(false);
  useEffect(() => {
    if (!footerRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShowShine(true); observer.disconnect(); }
    }, { threshold: 0.5 });
    observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, []);
  return (
    <section id="features" aria-labelledby="features-heading" className="sf-section">
      <div className="sf-inner">
        <header className="sf-header">
          <div>
            <p className="sf-eyebrow"><span aria-hidden="true">01</span> Features</p>
            <h2 id="features-heading">Every stock move.<br /><span>Under control.</span></h2>
          </div>
          <p className="sf-intro">Track what changes, understand what matters, and give your team a clear next step.</p>
        </header>
        <div className="sf-grid">
          <FeatureCard kind="control">
            <p className="sf-card-kicker">FROM SIGNAL TO ACTION</p>
            <h3>Smart Stock Control</h3>
            <p className="sf-copy">Turn stock movements into replenishment decisions. Review the evidence, then create a draft purchase order.</p>
            <div className="sf-flow" role="img" aria-label="Stock control flow: record a movement, identify low stock, review the recommendation, then create a draft purchase order. Orders are not placed automatically.">
              <ol aria-hidden="true">
                {STEPS.map((step, i) => <li key={step.title} style={{ animationDelay: `${i * 0.85}s` }}>
                  <span className="sf-step-mark">{step.mark}</span>
                  <div><strong>{step.title}</strong><p>{step.detail}</p></div>
                </li>)}
              </ol>
            </div>
            <div className="sf-control-note"><span aria-hidden="true">✓</span> Your decision comes before the order.</div>
          </FeatureCard>
          <FeatureCard kind="tracking">
            <h3>Inventory Tracking</h3>
            <p className="sf-copy">On-hand stock, low-stock alerts, and movement history in one place.</p>
            <div className="sf-stock" role="img" aria-label="Sample inventory: Arabica Beans has 148 units, in stock. Oat Milk has 6 units, low stock. Ceramic Mug has zero units, out of stock.">
              <div aria-hidden="true">
                <div className="sf-stock-labels"><span>Product</span><span>On hand</span><span>Status</span></div>
                <div><strong>Arabica Beans</strong><span>148</span><span className="sf-status sf-ok">In stock</span></div>
                <div><strong>Oat Milk</strong><span>6</span><span className="sf-status sf-low">Low stock</span></div>
                <div><strong>Ceramic Mug</strong><span>0</span><span className="sf-status sf-out">Out of stock</span></div>
              </div>
            </div>
          </FeatureCard>
          <FeatureCard kind="analytics">
            <h3>Inventory Analytics</h3>
            <p className="sf-copy">See demand trends and find fast-moving, slow-moving, and idle stock.</p>
            <div className="sf-chart" role="img" aria-label="Illustrative weekly demand chart: 24, 38, 31 and 52 units across four weeks. Sample data, not live inventory.">
              <div aria-hidden="true">
                <div className="sf-chart-title"><span>Demand trend</span><span>Units · 4 weeks</span></div>
                <div className="sf-bars">{[24, 38, 31, 52].map((value, i) => <div key={i} className="sf-bar-column"><strong>{value}</strong><span className={i === 3 ? 'sf-bar sf-bar-accent' : 'sf-bar'} style={{ height: `${value * 1.65}px`, animationDelay: `${i * 0.1}s` }} /><span>W{i + 1}</span></div>)}</div>
              </div>
            </div>
          </FeatureCard>
          <FeatureCard kind="team">
            <div className="sf-team-copy"><p className="sf-card-kicker">ONE SHARED WORKSPACE</p><h3>Team &amp; Business Management</h3><p className="sf-copy">Owner and staff roles keep your team together. The owner controls access to stock movements and analytics.</p></div>
            <div className="sf-team-visual" role="img" aria-label="Workspace roles: the owner manages team access; staff work with the permissions the owner grants.">
              <div aria-hidden="true"><div className="sf-member"><span className="sf-avatar">O</span><div><strong>Owner</strong><p>Manage team &amp; access</p></div><span className="sf-role">Owner</span></div><div className="sf-member"><span className="sf-avatar sf-avatar-staff">S</span><div><strong>Staff</strong><p>Work with granted access</p></div><span className="sf-role sf-role-staff">Staff</span></div></div>
            </div>
          </FeatureCard>
        </div>
        <div ref={footerRef} className="sf-footer" data-entered={showShine}><p>Illustrative examples with sample data.<br /><span>Your workspace reflects your own inventory.</span></p><a href="#how-it-works" className="sf-cta">See how StockPilot works <span aria-hidden="true">↗</span></a></div>
      </div>
    </section>
  );
}

export default FeaturesSection;
