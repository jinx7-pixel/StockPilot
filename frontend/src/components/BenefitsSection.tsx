import { StockCheckpoint } from './StockCheckpoint';
import './benefits-showcase.css';

type BenefitIconName = 'visibility' | 'alert' | 'priority' | 'confidence';

type Benefit = {
  title: string;
  description: string;
  icon: BenefitIconName;
};

const BENEFITS: Benefit[] = [
  {
    title: 'Clear Stock Visibility',
    description: 'Check on-hand quantities and recent movements in one place.',
    icon: 'visibility',
  },
  {
    title: 'Fewer Inventory Surprises',
    description:
      'See which items are running low and which are already out of stock.',
    icon: 'alert',
  },
  {
    title: 'Smarter Priorities',
    description: 'Use replenishment recommendations to decide what to order first.',
    icon: 'priority',
  },
  {
    title: 'More Confident Decisions',
    description:
      'Review the evidence behind a recommendation before creating a draft order.',
    icon: 'confidence',
  },
];

function BenefitIcon({ name }: { name: BenefitIconName }) {
  let shape;

  switch (name) {
    case 'visibility':
      shape = (
        <>
          <path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
      break;
    case 'alert':
      shape = (
        <>
          <path d="M12 3.5 2.8 19h18.4L12 3.5Z" />
          <path d="M12 9v4m0 3h.01" />
        </>
      );
      break;
    case 'priority':
      shape = (
        <>
          <path d="M4 5v14h16" />
          <path d="m8 15 3-3 2.5 2.5L19 9" />
          <path d="M15.5 9H19v3.5" />
        </>
      );
      break;
    case 'confidence':
      shape = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16.5 9" />
        </>
      );
      break;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.125rem] w-[1.125rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

function InventoryFocusIllustration() {
  return (
    <figure className="sb-figure">
      <div className="sb-figure-header">
        <span>Inventory in focus</span>
        <span className="sb-sample">Illustrative</span>
      </div>

      <svg
        role="img"
        aria-label="Static illustration of organized inventory boxes, with one item highlighted to represent a product that needs attention."
        viewBox="30 74 460 190"
        className="sb-shelf"
        fill="none"
      >
        <path d="M43 244h433" stroke="#c6d7e7" strokeWidth="2" strokeLinecap="round" />
        <path d="M56 251h407" stroke="#edf4fa" strokeWidth="7" strokeLinecap="round" />
        <g fill="#f4f8fc" stroke="#a8bfd3" strokeWidth="1.6" strokeLinejoin="round">
          <path d="m67 151 42-22 42 22v69l-42 23-42-23v-69Z" />
          <path d="m67 151 42 24 42-24m-42 24v68" />
          <path d="m165 170 37-20 38 20v51l-38 21-37-21v-51Z" />
          <path d="m165 170 37 21 38-21m-38 21v51" />
          <path d="m388 167 34-18 35 18v53l-35 18-34-18v-53Z" />
          <path d="m388 167 34 20 35-20m-35 20v51" />
        </g>
        <g stroke="#2586c2" strokeWidth="2" strokeLinejoin="round">
          <path d="m278 147 45-24 46 24-46 26-45-26Z" fill="#e3f5ff" />
          <path d="m278 147 45 26v71l-45-24v-73Z" fill="#d2ebfc" />
          <path d="m323 173 46-26v73l-46 24v-71Z" fill="#acd9f5" />
        </g>
        <path d="M323 118V99" stroke="#2586c2" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 4" />
        <circle cx="323" cy="92" r="11" fill="#fff0d2" />
        <path d="M323 87v5m0 4h.01" stroke="#79551a" strokeWidth="1.7" strokeLinecap="round" />
      </svg>

      <figcaption className="sb-figure-caption">
        <div>
          <strong>Oat Milk 1L</strong>
          <span>6 units on hand · reorder at 12</span>
        </div>
        <span className="sb-status">Low stock</span>
      </figcaption>
    </figure>
  );
}

export function BenefitsSection() {
  return (
    <section id="benefits" aria-labelledby="benefits-heading" className="sb-section">
      <div className="sb-inner">
        <header className="sb-header">
          <div>
            <p className="sb-eyebrow"><span aria-hidden="true">03</span> WHY STOCKPILOT</p>
            <h2 id="benefits-heading">
              Less Guesswork. <span>Better Stock Decisions.</span>
            </h2>
          </div>
          <p>Know what’s available, what’s running low, and what to reorder first.</p>
        </header>

        <div className="sb-layout">
          <InventoryFocusIllustration />

          <ul className="sb-benefits" role="list">
            {BENEFITS.map(benefit => (
              <li key={benefit.title}>
                <span className="sb-icon"><BenefitIcon name={benefit.icon} /></span>
                <h3>{benefit.title}</h3>
                <p>{benefit.description}</p>
              </li>
            ))}
          </ul>
        </div>
        <StockCheckpoint />
      </div>
    </section>
  );
}

export default BenefitsSection;
