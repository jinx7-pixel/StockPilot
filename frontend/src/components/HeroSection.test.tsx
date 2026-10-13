/**
 * Tests for the landing hero.
 *
 * The 3D composition and its motion are CSS, and `jsdom` applies no stylesheet,
 * so none of that is assertable here — it is verified in a real browser. What
 * *is* assertable, and what this file covers, is the part that would actually
 * break a visitor: the copy, the heading hierarchy, where the CTAs point, and
 * the fact that the invented dashboard figures are never announced as if they
 * were real readings.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { HeroSection } from './HeroSection';

function renderHero() {
  return render(
    <MemoryRouter>
      <HeroSection />
    </MemoryRouter>,
  );
}

describe('HeroSection', () => {
  it('leads with a single h1 carrying the headline', () => {
    renderHero();

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Know Your Stock. Make Smarter Moves.');
    // One h1 only — a second would flatten the document outline.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows the eyebrow and supporting copy', () => {
    renderHero();

    expect(screen.getByText(/inventory intelligence/i)).toBeInTheDocument();
    expect(
      screen.getByText(/track inventory, uncover sales trends/i),
    ).toBeInTheDocument();
  });

  it('points the primary CTA at the register route', () => {
    renderHero();
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('prepares the secondary CTA for the features section', () => {
    renderHero();
    /*
     * `#features` does not exist yet — building that section is explicitly out
     * of scope for this task — so this asserts the anchor is prepared rather
     * than that it resolves.
     */
    expect(screen.getByRole('link', { name: 'Explore Features' })).toHaveAttribute(
      'href',
      '#features',
    );
  });

  it('lists the three capability labels', () => {
    renderHero();

    for (const label of ['Inventory Tracking', 'Sales Intelligence', 'Smart Reordering']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('gives both CTAs a 44px touch target', () => {
    renderHero();

    for (const name of ['Get Started', 'Explore Features']) {
      expect(screen.getByRole('link', { name })).toHaveClass('min-h-11');
    }
  });

  it('offers the dashboard preview as one described image, not as data', () => {
    renderHero();

    const visual = screen.getByRole('img');
    // The figures are invented, so they must not be announced as readings.
    expect(visual.getAttribute('aria-label')).toMatch(/illustrative/i);
  });

  it('marks the preview as illustrative for sighted users too', () => {
    renderHero();
    expect(screen.getByText(/illustrative preview/i)).toBeInTheDocument();
  });

  it('invents no statistics, testimonials or live-AI claims', () => {
    renderHero();

    const text = document.body.textContent ?? '';
    for (const claim of [
      /\b\d+\s*customers?\b/i,
      /\b\d+\s*(?:k|m|million)?\s*(?:revenue|users|companies)\b/i,
      /\btestimonials?\b/i,
      /\bAI[- ]powered\b/i,
      /\blive\s+AI\b/i,
    ]) {
      expect(text).not.toMatch(claim);
    }
  });
});