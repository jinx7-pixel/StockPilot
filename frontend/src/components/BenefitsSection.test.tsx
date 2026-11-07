import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BenefitsSection } from './BenefitsSection';

describe('BenefitsSection', () => {
  it('renders the requested heading and supporting copy', () => {
    const { container } = render(<BenefitsSection />);

    expect(container.querySelector('section#benefits')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Less Guesswork. Better Stock Decisions.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('WHY STOCKPILOT')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Know what’s available, what’s running low, and what to reorder first.',
      ),
    ).toBeInTheDocument();
  });

  it('presents all four requested benefits without adding an About section', () => {
    render(<BenefitsSection />);

    const benefits = screen.getByRole('list');
    expect(
      within(benefits)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Clear Stock Visibility',
      'Fewer Inventory Surprises',
      'Smarter Priorities',
      'More Confident Decisions',
    ]);

    expect(
      within(benefits).getByText('Check on-hand quantities and recent movements in one place.'),
    ).toBeInTheDocument();
    expect(
      within(benefits).getByText(
        'See which items are running low and which are already out of stock.',
      ),
    ).toBeInTheDocument();
    expect(
      within(benefits).getByText('Use replenishment recommendations to decide what to order first.'),
    ).toBeInTheDocument();
    expect(
      within(benefits).getByText(
        'Review the evidence behind a recommendation before creating a draft order.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /about/i })).not.toBeInTheDocument();
  });

  it('includes a static inventory illustration as the section focal point', () => {
    render(<BenefitsSection />);

    expect(
      screen.getByRole('img', {
        name: 'Static illustration of organized inventory boxes, with one item highlighted to represent a product that needs attention.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Illustrative')).toBeInTheDocument();
    expect(screen.getByText('6 units on hand · reorder at 12')).toBeInTheDocument();
    expect(screen.getByText('Low stock')).toBeInTheDocument();
  });
});
