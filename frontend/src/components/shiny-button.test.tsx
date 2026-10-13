/**
 * Tests for the shiny button.
 *
 * The gradient border, speckle and sheen are all CSS emitted into a scoped
 * `<style>` tag, and `jsdom` applies no stylesheet — so none of the motion can be
 * asserted here and it is verified in a real browser instead. What this file
 * covers is the part that reaches a user: the element type, the accessible name,
 * and that the colour and sizing props actually land in the generated CSS.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ShinyButton } from './shiny-button';

// jsdom's `matchMedia` has no real implementation, and the component subscribes to
// the reduced-motion query on mount. A minimal stub keeps that subscription honest
// instead of silently throwing.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** The scoped <style> the component injects, for prop-plumbing assertions. */
function generatedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
}

describe('ShinyButton', () => {
  it('renders the label and exposes it as the accessible name', () => {
    render(<ShinyButton label="Explore Features" />);

    expect(screen.getByRole('button', { name: 'Explore Features' })).toBeInTheDocument();
  });

  it('renders a real button by default, without an href', () => {
    render(<ShinyButton label="Go" />);

    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.tagName).toBe('BUTTON');
    // The reference hard-coded `type="button"`; keep it, so the control can
    // never submit an unrelated form it happens to sit inside.
    expect(button).toHaveAttribute('type', 'button');
    expect(button).not.toHaveAttribute('href');
  });

  it('renders a real link when asked, and drops the button-only attributes', () => {
    render(
      <MemoryRouter>
        <ShinyButton as="a" href="#features" label="Explore Features" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Explore Features' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '#features');
    // `type` on an anchor is invalid and serves no purpose.
    expect(link).not.toHaveAttribute('type');
  });

  it('lets children replace the label text', () => {
    render(<ShinyButton label="Explore Features">Explore&nbsp;now</ShinyButton>);
    expect(screen.getByRole('button')).toHaveTextContent('Explore now');
  });

  it('appends the caller className to its own scope class', () => {
    render(<ShinyButton label="Go" className="min-h-11 w-full" />);

    const button = screen.getByRole('button');
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('w-full');
    expect(button.className).toMatch(/gleam-edge-\w+/);
  });

  it('plumbs the emerald colours into the generated CSS', () => {
    render(
      <ShinyButton
        label="Explore"
        fillColor="#1f2937"
        labelColor="#f8fafc"
        accentColor="#10b981"
        accentSoftColor="#34d399"
      />,
    );

    const css = generatedCss();
    expect(css).toContain('--gleam-base: #1f2937');
    expect(css).toContain('--gleam-label: #f8fafc');
    expect(css).toContain('--gleam-accent: #10b981');
    expect(css).toContain('--gleam-accent-soft: #34d399');
  });

  it('registers the custom properties the conic gradient depends on', () => {
    render(<ShinyButton label="Go" />);
    const css = generatedCss();

    const id = screen.getByRole('button').className.match(/gleam-edge-(\w+)/)![1];
    // Unregistered custom properties cannot interpolate, so the border would
    // snap between values instead of rotating.
    expect(css).toContain(`@property --gradient-angle-${id}`);
    expect(css).toContain(`@property --gradient-angle-offset-${id}`);
    expect(css).toContain(`@property --gradient-percent-${id}`);
    expect(css).toContain(`@property --gradient-shine-${id}`);
  });

  it('gives each instance its own scope so gradients are not shared', () => {
    const { container: a } = render(<ShinyButton label="One" />);
    const { container: b } = render(<ShinyButton label="Two" />);

    const idA = a.querySelector('button')!.className.match(/gleam-edge-(\w+)/)![1];
    const idB = b.querySelector('button')!.className.match(/gleam-edge-(\w+)/)![1];

    expect(idA).not.toBe(idB);
  });

  it('honours the sizing props instead of the demo defaults', () => {
    render(<ShinyButton label="Go" padding="0.625rem 1.25rem" fontSize="0.875rem" cornerRadius={12} />);

    const css = generatedCss();
    expect(css).toContain('padding: 0.625rem 1.25rem;');
    expect(css).toContain('font-size: 0.875rem;');
    expect(css).toContain('border-radius: 12px;');
  });

  it('honours the speckle and sheen toggles', () => {
    render(<ShinyButton label="Go" showSpeckle={false} showSheen={false} />);

    const css = generatedCss();
    // Both are driven by the literal opacity in the generated rule.
    expect(css.match(/opacity: 0;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('carries a reduced-motion state for callers that branch on it', () => {
    render(<ShinyButton label="Go" />);
    const button = screen.getByRole('button');

    // The stub reports no preference, so the attribute is absent.
    expect(button.getAttribute('data-reduced-motion')).toBeNull();
    expect(generatedCss()).toContain('prefers-reduced-motion: reduce');
  });

  it('reflects a reduced-motion preference onto data-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<ShinyButton label="Go" />);
    expect(screen.getByRole('button')).toHaveAttribute('data-reduced-motion', 'true');
  });

  it('does not throw when matchMedia is unavailable', () => {
    // jsdom's real state: no matchMedia at all. The reference subscribed to it
    // unguarded, which threw on mount and took every ancestor test with it.
    vi.stubGlobal('matchMedia', undefined);

    expect(() => render(<ShinyButton label="Go" />)).not.toThrow();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});