/** Hero copy, navigation and motion controls. Visual layout is checked in-browser. */

import userEvent from '@testing-library/user-event';
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

  it('keeps the decorative flower out of the accessibility tree', () => {
    renderHero();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('lets visitors pause and resume background motion', async () => {
    const user = userEvent.setup();
    renderHero();
    const hero = screen.getByRole('region', { name: /Know Your Stock/ });
    await user.click(screen.getByRole('button', { name: 'Pause animation' }));
    expect(hero).toHaveAttribute('data-motion', 'paused');
    expect(screen.getByRole('button', { name: 'Resume animation' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Resume animation' }));
    expect(hero).toHaveAttribute('data-motion', 'running');
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