import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HowItWorksSection } from './HowItWorksSection';

describe('HowItWorksSection', () => {
  it('provides the navbar anchor, heading and subtitle', () => {
    const { container } = render(<HowItWorksSection />);

    expect(container.querySelector('section#how-it-works')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'How StockPilot Works' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('From scattered inventory data to confident decisions in three simple steps.'),
    ).toBeInTheDocument();
  });

  it('presents the three requested stages in order with useful guidance', () => {
    render(<HowItWorksSection />);

    const steps = screen.getByRole('list');
    expect(steps.tagName).toBe('OL');
    expect(
      within(steps)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Organize Inventory', 'Understand Stock', 'Take Action']);

    expect(
      within(steps).getByText(/Add product details and record stock in, stock out, or adjustments/i),
    ).toBeInTheDocument();
    expect(
      within(steps).getByText(/Check low-stock items and compare demand with stock on hand/i),
    ).toBeInTheDocument();
    expect(
      within(steps).getByText(/Turn a reviewed recommendation into a draft purchase order/i),
    ).toBeInTheDocument();
  });

  it('shows the product preview as clearly illustrative and static', () => {
    render(<HowItWorksSection />);

    expect(
      screen.getByRole('img', { name: /illustrative static inventory preview/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Illustrative · static/i)).toBeInTheDocument();
    expect(screen.getByText('Arabica Beans 1kg')).toBeInTheDocument();
    expect(screen.getByText('Oat Milk 1L')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Out')).toBeInTheDocument();
    expect(screen.getByText(/below its reorder point/i)).toBeInTheDocument();
  });
});
