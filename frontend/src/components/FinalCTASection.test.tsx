import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { FinalCTASection } from './FinalCTASection';

describe('FinalCTASection', () => {
  it('presents the closing message and links to signup and the existing walkthrough', () => {
    render(<MemoryRouter><FinalCTASection /></MemoryRouter>);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Make your next stock decision with confidence.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'See what’s on hand, spot low stock, and decide what to reorder in one workspace.',
      ),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Explore How It Works' });
    expect(link).toHaveAttribute('href', '#how-it-works');
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/register');
  });
});
