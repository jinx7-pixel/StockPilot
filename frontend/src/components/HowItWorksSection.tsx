import { useId, useRef, useState, type KeyboardEvent } from 'react';
import './workflow-showcase.css';

const STEPS = [
  {
    title: 'Organize Inventory',
    summary: 'Add products to your catalog and record stock in, stock out, or adjustments.',
    preview: 'Stock movement',
    metrics: [
      { label: 'Before movement', value: '18 units' },
      { label: 'Stock out', value: '−12 units' },
      { label: 'On hand', value: '6 units' },
    ],
    status: 'Movement recorded',
    detail: 'Recording the stock-out updates the on-hand balance.',
  },
  {
    title: 'Understand Stock',
    summary: 'Compare what’s on hand with reorder points and review what’s running low.',
    preview: 'Reorder signal',
    metrics: [
      { label: 'On hand', value: '6 units' },
      { label: 'Reorder point', value: '12 units' },
    ],
    status: 'Low stock',
    detail: 'Oat Milk is below its reorder point. Check the recommendation and its evidence.',
  },
  {
    title: 'Take Action',
    summary: 'Review the recommendation, choose a quantity, and create a draft purchase order.',
    preview: 'Draft purchase order',
    metrics: [
      { label: 'Order quantity', value: '12 units' },
      { label: 'Order status', value: 'Draft' },
    ],
    status: 'Ready for review',
    detail: 'Review the draft in Purchase Orders before placing it.',
  },
] as const;

export function HowItWorksSection() {
  const id = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % STEPS.length; break;
      case 'ArrowUp': next = (index + STEPS.length - 1) % STEPS.length; break;
      case 'Home': next = 0; break;
      case 'End': next = STEPS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="how-it-works" aria-labelledby="how-it-works-heading" className="sw-section">
      <div className="sw-inner">
        <header className="sw-header">
          <p className="sw-eyebrow"><span aria-hidden="true">02</span> How it works</p>
          <h2 id="how-it-works-heading">How StockPilot Works</h2>
          <p>Follow one product from a stock movement to a draft purchase order.</p>
        </header>

        <div className="sw-layout">
          <div className="sw-steps" role="tablist" aria-label="Inventory workflow" aria-orientation="vertical">
            {STEPS.map((step, index) => (
              <button
                key={step.title}
                ref={element => { tabs.current[index] = element; }}
                type="button"
                role="tab"
                id={`${id}-step-${index}`}
                aria-controls={`${id}-preview-${index}`}
                aria-label={step.title}
                aria-describedby={`${id}-summary-${index}`}
                aria-selected={active === index}
                tabIndex={active === index ? 0 : -1}
                className="sw-step"
                onClick={() => setActive(index)}
                onKeyDown={event => moveFocus(event, index)}
              >
                <span className="sw-number" aria-hidden="true">0{index + 1}</span>
                <span className="sw-step-copy">
                  <strong>{step.title}</strong>
                  <span id={`${id}-summary-${index}`}>{step.summary}</span>
                </span>
                <span className="sw-step-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>

          <div className="sw-preview">
            <div className="sw-preview-header">
              <div>
                <p className="sw-preview-kicker">Example workspace</p>
                <p className="sw-product">Oat Milk 1L <span>SKU-2071</span></p>
              </div>
              <span className="sw-sample">Sample data</span>
            </div>
            {STEPS.map((step, index) => (
              <div
                key={step.preview}
                role="tabpanel"
                id={`${id}-preview-${index}`}
                aria-labelledby={`${id}-step-${index}`}
                hidden={active !== index}
                tabIndex={0}
                className="sw-panel"
              >
                <h3>{step.preview}</h3>
                <dl className="sw-metrics">
                  {step.metrics.map(metric => (
                    <div key={metric.label}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="sw-outcome">
                  <p className="sw-status" data-tone={index === 1 ? 'caution' : 'blue'}>{step.status}</p>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default HowItWorksSection;
