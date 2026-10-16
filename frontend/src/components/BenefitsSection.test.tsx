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
        'Keep inventory information clear, spot the products that need attention, and make more confident stock decisions.',
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
      within(benefits).getByText('Understand what is available and which products need attention.'),
    ).toBeInTheDocument();
    expect(
      within(benefits).getByText(
        'Spot low-stock and out-of-stock items before they become bigger operational problems.',
      ),
    ).toBeInTheDocument();
    expect(
      within(benefits).getByText('Focus your attention on the products that need replenishment first.'),
    ).toBeInTheDocument();
    expect(
      within(benefits).getByText(
        'Use organized inventory information and stock insights to make informed decisions.',
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
  });
});
