import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FinalCTASection } from './FinalCTASection';

describe('FinalCTASection', () => {
  it('keeps its closing message and links to the existing How It Works section', () => {
    render(<FinalCTASection />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Make your next stock decision with confidence.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Explore how StockPilot brings inventory information and priorities into a clearer view.',
      ),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Explore How It Works' });
    expect(link).toHaveAttribute('href', '#how-it-works');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('motion-reduce:transition-none');
  });
});
