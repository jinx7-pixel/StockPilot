import { useEffect, useRef, useState } from 'react';
import './stock-checkpoint.css';

const COMPARISONS = [
  {
    before: { title: 'Scattered records', detail: 'Counts across separate files' },
    after: { title: 'One stock ledger', detail: 'Movements and balances together' },
  },
  {
    before: { title: 'Missed low stock', detail: 'Problems found during stock checks' },
    after: { title: 'Reorder alerts', detail: 'See what’s below its reorder point' },
  },
  {
    before: { title: 'Unclear priorities', detail: 'Guess which items to replenish first' },
    after: { title: 'Ranked recommendations', detail: 'See which items to review first' },
  },
  {
    before: { title: 'Manual order prep', detail: 'Re-enter items and quantities' },
    after: { title: 'Draft purchase orders', detail: 'Create a draft after review' },
  },
] as const;

const TRACK_DESCRIPTION = COMPARISONS.map(({ before, after }) =>
  `${before.title} → ${after.title}.`,
).join(' ');

function CheckpointBelt({ side }: { side: 'before' | 'after' }) {
  return (
    <div className={`checkpoint-lane checkpoint-${side}`} aria-hidden="true">
      <div className="checkpoint-belt">
        {[0, 1, 2].map(repeat => (
          <div className="checkpoint-group" key={repeat}>
            {COMPARISONS.map(comparison => {
              const card = comparison[side];
              return (
                <div className="checkpoint-card" key={card.title}>
                  <strong>{card.title}</strong>
                  <p>{card.detail}</p>
                  {side === 'after' && <span className="checkpoint-check">✓</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StockCheckpoint() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!frameRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.15,
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="stock-checkpoint" className="stock-checkpoint" aria-labelledby="checkpoint-heading">
      <h3 id="checkpoint-heading">Turn stock problems into clear next steps.</h3>
      <p className="checkpoint-intro">
        See what changes when stock counts, alerts, and purchasing share one workspace.
      </p>

      <div ref={frameRef} className="checkpoint-frame" data-running={inView && !paused}>
        <div className="checkpoint-labels" aria-hidden="true">
          <span>Without StockPilot</span>
          <span>With StockPilot</span>
        </div>

        <div className="checkpoint-scene" role="img" aria-label={TRACK_DESCRIPTION}>
          <CheckpointBelt side="before" />
          <CheckpointBelt side="after" />
          <div className="checkpoint-divider" aria-hidden="true" />
          <div className="checkpoint-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4.5 4.5L19 7" />
            </svg>
          </div>
        </div>

        <dl className="checkpoint-static">
          {COMPARISONS.map(({ before, after }) => (
            <div key={before.title}>
              <dt><strong>{before.title}</strong><span>{before.detail}</span></dt>
              <dd><strong>{after.title}</strong><span>{after.detail}</span></dd>
            </div>
          ))}
        </dl>

        <button type="button" className="checkpoint-toggle" onClick={() => setPaused(value => !value)}>
          {paused ? 'Play animation' : 'Pause animation'}
        </button>
      </div>
    </section>
  );
}
