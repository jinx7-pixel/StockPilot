/**
 * Tests for the orbiting-border primitive.
 *
 * The effect itself lives in CSS and is verified in a real browser, not here —
 * `jsdom` applies no stylesheet, so a computed `conic-gradient` cannot be read
 * here at all. What *is* assertable, and what this file covers, is everything
 * that determines whether the decoration can interfere with the real control:
 * that it forwards props so the control keeps its link semantics, that it stays
 * a single focusable node, and that it never injects its own display utility.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { MovingBorder } from './moving-border';

describe('MovingBorder', () => {
  it('renders its children inside the ring element', () => {
    render(<MovingBorder>Log in</MovingBorder>);
    expect(screen.getByText('Log in')).toBeInTheDocument();
  });

  it('marks the element so the CSS ring can attach to it', () => {
    render(<MovingBorder>Log in</MovingBorder>);
    expect(screen.getByText('Log in')).toHaveClass('moving-border');
  });

  it('appends the caller className instead of replacing it', () => {
    render(<MovingBorder className="px-4 md:inline-flex">Log in</MovingBorder>);
    const el = screen.getByText('Log in');
    expect(el).toHaveClass('moving-border');
    expect(el).toHaveClass('px-4');
    expect(el).toHaveClass('md:inline-flex');
  });

  /*
   * `hidden` and `inline-flex` are both display utilities, and the winner is
   * whichever Tailwind emits later in the stylesheet — not whichever is written
   * later in this string. The component must therefore never add a display
   * utility of its own, or it could silently override a responsive one.
   */
  it('adds no display utility of its own', () => {
    render(<MovingBorder>Log in</MovingBorder>);
    const cls = screen.getByText('Log in').className.split(/\s+/).filter(Boolean);
    expect(cls).toEqual(['moving-border']);
  });

  it('renders the requested element via `as`', () => {
    render(
      <MovingBorder as="button" type="button">
        Log in
      </MovingBorder>,
    );
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('keeps real link semantics by forwarding props through `as={Link}`', () => {
    render(
      <MemoryRouter>
        <MovingBorder as={Link} to="/login">
          Log in
        </MovingBorder>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Log in' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveClass('moving-border');
    // The decoration must not become a second focus stop.
    expect(link.querySelectorAll('a, button')).toHaveLength(0);
  });

  it('forwards arbitrary props such as onClick to the rendered control', async () => {
    let clicked = false;
    render(
      <MovingBorder
        as="button"
        type="button"
        onClick={() => {
          clicked = true;
        }}
      >
        Log in
      </MovingBorder>,
    );

    screen.getByRole('button', { name: 'Log in' }).click();
    expect(clicked).toBe(true);
  });

  it('sets the orbit duration through a custom property when asked', () => {
    const { rerender } = render(<MovingBorder>Log in</MovingBorder>);
    const el = screen.getByText('Log in');
    expect(el.style.getPropertyValue('--moving-border-duration')).toBe('');

    rerender(<MovingBorder duration={6}>Log in</MovingBorder>);
    expect(el.style.getPropertyValue('--moving-border-duration')).toBe('6s');
  });
});