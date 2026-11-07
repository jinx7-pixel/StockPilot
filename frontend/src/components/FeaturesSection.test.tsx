import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeaturesSection } from './FeaturesSection';

describe('FeaturesSection', () => {
  it('preserves the navigation anchor and labelled region', () => {
    render(<FeaturesSection />);
    expect(screen.getByRole('region', { name: /Every stock move.*Under control/i })).toHaveAttribute('id', 'features');
  });
  it('presents four real capabilities with descriptive headings', () => {
    render(<FeaturesSection />);
    for (const title of ['Smart Stock Control', 'Inventory Tracking', 'Inventory Analytics', 'Team & Business Management']) {
      expect(screen.getByRole('heading', { name: title, level: 3 })).toBeInTheDocument();
    }
  });
  it('explains the reviewed draft workflow without claiming automatic purchases', () => {
    render(<FeaturesSection />);
    expect(screen.getByRole('img', { name: /Orders are not placed automatically/ })).toBeInTheDocument();
    expect(screen.getByText('Your decision comes before the order.')).toBeInTheDocument();
  });
  it('labels sample data and provides text alternatives for every visual', () => {
    render(<FeaturesSection />);
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getByText(/Illustrative examples with sample data/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Sample inventory.*zero units, out of stock/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /weekly demand chart.*Sample data, not live/ })).toBeInTheDocument();
  });
  it('links to the real workflow section without focusable mock controls', () => {
    render(<FeaturesSection />);
    expect(screen.getByRole('link', { name: /See how StockPilot works/ })).toHaveAttribute('href', '#how-it-works');
    for (const visual of screen.getAllByRole('img')) {
      expect(within(visual).queryByRole('button')).not.toBeInTheDocument();
      expect(visual.querySelector('a,button,input,[tabindex]')).toBeNull();
    }
  });
});
