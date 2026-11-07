import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { HowItWorksSection } from './HowItWorksSection';

describe('HowItWorksSection', () => {
  it('provides the navbar anchor and three steps in order', () => {
    render(<HowItWorksSection />);

    expect(screen.getByRole('region', { name: 'How StockPilot Works' })).toHaveAttribute('id', 'how-it-works');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAccessibleName('Organize Inventory');
    expect(tabs[1]).toHaveAccessibleName('Understand Stock');
    expect(tabs[2]).toHaveAccessibleName('Take Action');
  });

  it('shows a labeled sample and follows the same product through the workflow', async () => {
    const user = userEvent.setup();
    render(<HowItWorksSection />);

    expect(screen.getByText('Sample data')).toBeVisible();
    expect(screen.getByText(/Oat Milk 1L/)).toBeVisible();
    expect(screen.getByRole('tabpanel', { name: 'Organize Inventory' })).toHaveTextContent('−12 units');

    await user.click(screen.getByRole('tab', { name: 'Understand Stock' }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'Understand Stock' })).toHaveTextContent('below its reorder point');

    await user.click(screen.getByRole('tab', { name: 'Take Action' }));
    const draft = screen.getByRole('tabpanel', { name: 'Take Action' });
    expect(within(draft).getByRole('heading', { name: 'Draft purchase order' })).toBeVisible();
    expect(draft).toHaveTextContent('before placing it');
  });

  it('updates selection and focus when navigating steps with the keyboard', async () => {
    const user = userEvent.setup();
    render(<HowItWorksSection />);

    await user.tab();
    expect(screen.getByRole('tab', { name: 'Organize Inventory' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    const second = screen.getByRole('tab', { name: 'Understand Stock', selected: true });
    expect(second).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Understand Stock' })).toBeVisible();
  });
});
