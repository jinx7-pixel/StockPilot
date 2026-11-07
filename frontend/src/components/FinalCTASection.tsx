import { Link } from 'react-router-dom';
import './final-cta-showcase.css';

export function FinalCTASection() {
  return (
    <section id="get-started" aria-labelledby="landing-cta-heading" className="landing-close">
      <div className="landing-close-panel">
        <span className="landing-close-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 4.5 4.5L19 7" />
          </svg>
        </span>
        <h2 id="landing-cta-heading">Make your next stock decision with confidence.</h2>
        <p>See what’s on hand, spot low stock, and decide what to reorder in one workspace.</p>

        <div className="landing-close-actions">
          <Link to="/register" className="landing-close-link landing-close-primary">
            Get Started <span aria-hidden="true">→</span>
          </Link>
          <a href="#how-it-works" className="landing-close-link landing-close-secondary">
            Explore How It Works
          </a>
        </div>
      </div>
    </section>
  );
}

export default FinalCTASection;
