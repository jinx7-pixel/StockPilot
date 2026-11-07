import { Link } from 'react-router-dom';
import { StockPilotLogo } from './StockPilotLogo';
import './final-cta-showcase.css';

export function FinalCTASection() {
  return (
    <section id="get-started" aria-labelledby="landing-cta-heading" className="landing-close">
      <div className="landing-close-panel">
        <div className="landing-close-mark"><StockPilotLogo /></div>
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
