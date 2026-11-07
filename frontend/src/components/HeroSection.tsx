import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './hero-bloom.css';

const CAPABILITIES = ['Inventory Tracking', 'Sales Intelligence', 'Smart Reordering'];

/** Two treatments of one cached image move together; no frame-by-frame JS. */
export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting), { threshold: 0, rootMargin: '-80px 0px 0px 0px' },
    );
    if (sectionRef.current) observer?.observe(sectionRef.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  return (
    <section ref={sectionRef} className="sp-hero" aria-labelledby="hero-heading"
      data-motion={paused || !inView || !pageVisible ? 'paused' : 'running'}>
      <div className="sp-bloom-stage" aria-hidden="true">
        <div className="sp-bloom-motion">
          {['sp-bloom-haze', 'sp-bloom-core'].map((treatment) => (
            <img key={treatment} className={`sp-bloom ${treatment}`} src="/images/stockpilot-bloom-1280.webp"
              srcSet="/images/stockpilot-bloom-640.webp 640w, /images/stockpilot-bloom-1280.webp 1280w"
              sizes="(max-width: 640px) 620px, 1000px" width="1280" height="1280"
              alt="" fetchPriority="high" decoding="async" draggable="false" />
          ))}
        </div>
      </div>
      <div className="sp-hero-shade" aria-hidden="true" />
      <div className="sp-hero-content">
        <p className="sp-eyebrow"><span aria-hidden="true" /> Inventory Intelligence</p>
        <h1 id="hero-heading">Know Your Stock.{' '}<span>Make Smarter Moves.</span></h1>
        <p className="sp-hero-description">
          Track inventory, uncover sales trends, and make confident stock decisions
          — all from one intelligent workspace.
        </p>
        <div className="sp-hero-actions">
          <Link to="/register" className="sp-hero-primary min-h-11">
            Get Started <span aria-hidden="true">↗</span>
          </Link>
          <a href="#features" className="sp-hero-secondary min-h-11">
            Explore Features <span aria-hidden="true">↓</span>
          </a>
        </div>
        <ul className="sp-capabilities">
          {CAPABILITIES.map((item) => (
            <li key={item}><span aria-hidden="true">✓</span>{item}</li>
          ))}
        </ul>
      </div>
      <div className="sp-hero-bottom">
        <a href="#product" className="sp-discover">Discover StockPilot <span aria-hidden="true">↓</span></a>
        <button type="button" className="sp-motion-toggle" aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            {paused ? <path d="M4 2.5 13 8l-9 5.5z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
          </svg>
          {paused ? 'Resume animation' : 'Pause animation'}
        </button>
      </div>
    </section>
  );
}
export default HeroSection;
