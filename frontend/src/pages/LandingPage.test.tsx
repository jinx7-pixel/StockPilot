/**
 * Public landing navbar.
 *
 * What this suite protects:
 *
 *  - **The navbar is reachable without a session.** `/` is the entry point; if
 *    it regresses to a redirect, an anonymous visitor has no way in.
 *  - **The disclosure is honestly labelled.** `aria-expanded` must track real
 *    state and `aria-controls` must resolve to the element it controls,
 *    otherwise a screen-reader user is told the wrong thing.
 *  - **The menu closes after use.** Navigating away leaves it open behind the
 *    next page's mount.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { LandingPage } from './LandingPage';

function renderNavbar() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByRole('button', { name: /open menu|close menu/i });

describe('landing navbar', () => {
  it('renders the brand, and it links to the landing page', () => {
    renderNavbar();

    const brand = screen.getByRole('link', { name: /stockpilot/i });
    expect(brand).toHaveAttribute('href', '/');
  });

  it('exposes the four section links with their future anchor targets', () => {
    renderNavbar();

    for (const [label, href] of [
      ['Product', '#product'],
      ['Features', '#features'],
      ['How It Works', '#how-it-works'],
      ['About', '#about'],
    ]) {
      expect(screen.getAllByRole('link', { name: label })[0]).toHaveAttribute('href', href);
    }
  });

  it('links both authentication entry points', () => {
    renderNavbar();

    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: 'Get Started' })[0]).toHaveAttribute('href', '/register');
  });

  it('gives Log in the orbiting ring at every breakpoint', () => {
    renderNavbar();

    /*
     * The ring is on both the bar's Log in and the drawer's — the drawer is the
     * only one visible on a phone, so styling just the bar's would leave mobile
     * with no effect at all.
     *
     * Both stay real links rather than divs with handlers: the ring is decoration
     * and must not cost the control its semantics or its single focus stop.
     */
    const login = screen.getAllByRole('link', { name: 'Log in' });
    expect(login).toHaveLength(2);

    for (const link of login) {
      expect(link).toHaveAttribute('href', '/login');
      expect(link).toHaveClass('moving-border');
      expect(link.tagName).toBe('A');
    }
  });

  it('gives Log in no static border of its own', () => {
    renderNavbar();

    /*
     * `MovingBorder` is meant to be the only edge on this control. A permanent
     * `border` underneath it showed as a continuous outline the whole time, so
     * the orbiting arc never looked like it *was* the border — it looked like
     * decoration travelling around a permanently-outlined box.
     */
    for (const link of screen.getAllByRole('link', { name: 'Log in' })) {
      expect(link.className).not.toMatch(/(^|\s)border(\s|$)/);
      expect(link.className).not.toContain('border-accent');
      expect(link.className).not.toContain('border-slate');
    }
  });

  it('keeps the drawer Log in inside the drawer and closes it on use', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(toggle());

    const drawer = document.getElementById('landing-drawer')!;
    const drawerLogin = within(drawer).getByRole('link', { name: 'Log in' });
    expect(drawerLogin).toHaveClass('moving-border');

    await user.click(drawerLogin);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the drawer collapsed by default', () => {
    renderNavbar();

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('has a labelled button whose aria-controls resolves to the menu', () => {
    renderNavbar();

    const button = toggle();
    // An accessible name that says what it does, not a bare icon.
    expect(button).toHaveAccessibleName('Open menu');

    const id = button.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toBeInTheDocument();
  });

  it('opens and closes the drawer, tracking state in both the label and aria-expanded', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveAccessibleName('Close menu');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveAccessibleName('Open menu');
  });

  it('closes the drawer when a section link is chosen', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    // Scoped to the drawer: jsdom applies no CSS, so the desktop list (hidden by
    // `lg:flex` in a real browser) is still present in the DOM here.
    const drawer = document.getElementById('landing-drawer')!;
    await user.click(within(drawer).getByRole('link', { name: 'Product' }));

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the drawer as a dialog anchored to the right edge', async () => {
    const user = userEvent.setup();
    renderNavbar();

    const drawer = document.getElementById('landing-drawer');
    expect(drawer).toHaveAttribute('role', 'dialog');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveClass('right-0');
    // Closed, it must not be reachable by keyboard.
    expect(drawer).toHaveClass('invisible');

    await user.click(toggle());
    expect(drawer).not.toHaveClass('invisible');
  });

  it('locks background scrolling while open and restores it after', async () => {
    const user = userEvent.setup();
    renderNavbar();

    expect(document.body.style.overflow).toBe('');

    await user.click(toggle());
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('gives Get Started no decorative layer of any kind', () => {
    renderNavbar();

    /*
     * Get Started is a plain link. It has carried a sweeping shine and, briefly, a
     * sprite-sheet mask; both are gone. Assert nothing decorative crept back in —
     * an extra absolutely-positioned child is exactly how a band that renders
     * underneath the label comes back unnoticed.
     */
    for (const cta of screen.getAllByRole('link', { name: 'Get Started' })) {
      expect(cta.querySelector('.animate-shine')).toBeNull();
      expect(cta.querySelector('[data-mask]')).toBeNull();
      expect(cta.querySelector('[aria-hidden="true"]')).toBeNull();
      // Nothing to clip any longer.
      expect(cta.className).not.toContain('overflow-hidden');
      // The label is the element's own text.
      expect(cta.textContent).toBe('Get Started');
    }
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    // Focus must not be stranded now that the menu is collapsed.
    expect(toggle()).toHaveFocus();
  });

  it('is operable from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.tab(); // brand
    expect(screen.getByRole('link', { name: /stockpilot/i })).toHaveFocus();

    // Tab until the toggle has focus, then activate it with the keyboard.
    for (let i = 0; i < 12 && document.activeElement !== toggle(); i++) {
      await user.tab();
    }
    expect(toggle()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });
});