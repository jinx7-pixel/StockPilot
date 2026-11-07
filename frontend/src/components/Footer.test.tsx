import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Footer } from './Footer';

describe('Footer', () => {
  it('provides working links to the existing landing-page anchors', () => {
    render(<Footer />);

    const navigation = screen.getByRole('navigation', { name: 'Footer' });
    const expectedLinks = [
      ['Product', '#product'],
      ['Features', '#features'],
      ['How It Works', '#how-it-works'],
      ['Why StockPilot', '#benefits'],
      ['FAQ', '#faq'],
    ];

    for (const [label, href] of expectedLinks) {
      expect(within(navigation).getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('links GitHub and the portfolio in separate tabs', () => {
    render(<Footer />);

    for (const [name, href] of [
      ['GitHub profile, opens in a new tab', 'https://github.com/jinx7-pixel'],
      ['Portfolio, opens in a new tab', 'https://jinx-portfolio.pages.dev/'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('makes the displayed email a mailto link', () => {
    render(<Footer />);

    const email = screen.getByRole('link', { name: 'Email jinx4784@gmail.com' });
    expect(email).toHaveAttribute('href', 'mailto:jinx4784@gmail.com');
    expect(email).toHaveTextContent('jinx4784@gmail.com');
  });

  it('renders the X mark as a clearly labeled, noninteractive visual', () => {
    render(<Footer />);

    const xMark = screen.getByRole('img', { name: 'X icon, visual only' });
    expect(xMark.closest('a, button')).toBeNull();
    expect(xMark.closest('li')?.className).not.toContain('hover:');
    expect(screen.getByText('Visual only')).toBeInTheDocument();
  });

  it('uses compact, consistently sized icon wells for contact items', () => {
    render(<Footer />);

    const github = screen.getByRole('link', { name: 'GitHub profile, opens in a new tab' });
    const email = screen.getByRole('link', { name: 'Email jinx4784@gmail.com' });
    const xMark = screen.getByRole('img', { name: 'X icon, visual only' });

    for (const iconWell of [github.querySelector('span'), email.querySelector('span'), xMark]) {
      expect(iconWell).toHaveClass('h-8', 'w-8', 'rounded-md');
    }
    for (const icon of [github.querySelector('svg'), email.querySelector('svg'), xMark.querySelector('svg')]) {
      expect(icon).toHaveClass('h-4', 'w-4');
    }
  });

  it('exposes accessible footer landmarks, visible focus styling, and the current year', () => {
    render(<Footer />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FAQ' }).className).toContain('focus-visible:ring-2');
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} StockPilot`);
    expect(screen.getByRole('link', { name: 'StockPilot, back to top' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });
});
