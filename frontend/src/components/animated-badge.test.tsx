/**
 * Tests for the animated eyebrow badge.
 *
 * The light above the badge and the pulsing dot are both CSS, and `jsdom` applies
 * no stylesheet, so none of the motion is assertable here — that is verified in a
 * real browser. What *is* assertable, and what this file covers, is the part that
 * would actually reach a user: the text, the colour plumbing, and the fact that
 * the decoration is kept out of the accessibility tree and the hit-test area.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AnimatedBadge } from './animated-badge';

describe('AnimatedBadge', () => {
  it('renders the given text', () => {
    render(<AnimatedBadge text="Inventory Intelligence" />);
    expect(screen.getByText('Inventory Intelligence')).toBeInTheDocument();
  });

  it('defaults to the hero copy when no text is given', () => {
    render(<AnimatedBadge />);
    expect(screen.getByText('Inventory Intelligence')).toBeInTheDocument();
  });

  it('is not a link unless an href is supplied', () => {
    render(<AnimatedBadge text="Badge" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('becomes a real router link when given an href', () => {
    render(
      <MemoryRouter>
        <AnimatedBadge text="Badge" href="/features" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /badge/i });
    expect(link).toHaveAttribute('href', '/features');
  });

  it('keeps the traced line out of the accessibility tree', () => {
    render(<AnimatedBadge text="Badge" />);

    /*
     * The line is decoration sitting outside the badge box. If it were ever
     * exposed, a screen reader would announce an empty label before the text.
     */
    const line = document.querySelector('.sp-badge-line');
    expect(line).toBeInTheDocument();
    expect(line).toHaveAttribute('aria-hidden', 'true');
  });

  it('never lets the decoration intercept a click', () => {
    render(<AnimatedBadge text="Badge" />);
    expect(document.querySelector('.sp-badge-line')?.className).toContain(
      'pointer-events-none',
    );
  });

  it('disables the pulse under reduced motion', () => {
    render(<AnimatedBadge text="Badge" />);

    const pings = document.querySelectorAll('.animate-ping');
    expect(pings).toHaveLength(2);
    for (const ping of pings) {
      expect(ping.className).toContain('motion-reduce:animate-none');
    }
  });

  it('forwards className and style so it can join the hero stagger', () => {
    render(<AnimatedBadge text="Badge" className="hero-rise" style={{ '--hero-delay': '0.05s' } as React.CSSProperties} />);

    const badge = screen.getByText('Badge').closest('span')!.parentElement!;
    expect(badge.className).toContain('hero-rise');
    expect((badge as HTMLElement).style.getPropertyValue('--hero-delay')).toBe('0.05s');
  });

  it('drives the dot and the traced line from the single colour prop', () => {
    const { container } = render(<AnimatedBadge text="Badge" color="#34d399" />);

    // The line's light comes from the gradient stops inside the SVG.
    // Note `stop-color`, not `stopColor` — React writes the camelCase prop but
    // the DOM attribute is kebab-case.
    const stops = [...container.querySelectorAll('stop')].map((s) =>
      s.getAttribute('stop-color'),
    );
    expect(stops.filter(Boolean)).toContain('#34d399');
  });

  it('renders the light that walks the line', () => {
    const { container } = render(<AnimatedBadge text="Badge" />);

    const light = container.querySelector('.sp-badge-light');
    expect(light).toBeInTheDocument();
    expect(light?.getAttribute('r')).toBeTruthy();
    // It is masked to the path, which is what turns the path into a line.
    expect(container.querySelector('mask')).toBeInTheDocument();
    expect(container.querySelector('mask path')).toBeInTheDocument();
  });

  it('gives each badge its own mask id', () => {
    const { container: a } = render(<AnimatedBadge text="Badge" />);
    const { container: b } = render(<AnimatedBadge text="Badge" />);

    const idA = a.querySelector('mask')?.id;
    const idB = b.querySelector('mask')?.id;

    // Two badges sharing one mask would light both from a single gradient.
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});