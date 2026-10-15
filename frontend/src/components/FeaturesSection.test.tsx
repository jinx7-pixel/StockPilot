/**
 * Tests for the features section.
 *
 * The grid, the dividers, the accent stripe and the dashboard chrome are CSS.
 * `jsdom` does not apply stylesheets, so none of that is assertable here — it
 * is verified in a real browser at multiple widths. What *is* assertable, and
 * what this file covers, is the part that would actually break a visitor:
 *
 *   - the four capability titles and their bodies are visible,
 *   - the section targets the `#features` anchor the navbar uses,
 *   - the four previews exist but their invented numbers never leak to assistive
 *     tech (the figures are not real readings),
 *   - the entrance class and the per-row delay are wired,
 *   - `prefers-reduced-motion` does not break the page — content is visible
 *     whether the keyframes run or not,
 *   - the layout is editorial, not card-grid: rows live in a list and the
 *     featured row is the first list item,
 *   - the featured row's text is visibly emphasised versus the supporting rows.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FeaturesSection } from './FeaturesSection';

describe('FeaturesSection', () => {
  it('exposes the #features anchor the navbar uses', () => {
    const { container } = render(<FeaturesSection />);

    const section = container.querySelector('section#features');
    expect(section).toBeInTheDocument();
  });

  it('leads with an accessible heading whose text matches the visible headline', () => {
    render(<FeaturesSection />);

    const heading = screen.getByRole('heading', { level: 2, name: /operator needs/i });
    expect(heading).toBeInTheDocument();
  });

  it('shows the eyebrow, headline and supporting paragraph', () => {
    render(<FeaturesSection />);

    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /operator needs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/recommendation engine.*workspace for the people who run the business/i),
    ).toBeInTheDocument();
  });

  it('lists all four capabilities as headings', () => {
    render(<FeaturesSection />);

    for (const title of [
      'Real-Time Inventory Tracking',
      'Smart Stock Control',
      'Inventory Analytics',
      'Team & Business Management',
    ]) {
      expect(screen.getByRole('heading', { name: title, level: 3 })).toBeInTheDocument();
    }
  });

  it('describes each capability with a body that mentions a real surface', () => {
    render(<FeaturesSection />);

    /*
     * The four descriptions ground the section in real app surfaces. Each
     * regex matches a substring of the body so a small wording change does
     * not break the contract.
     */
    const bodies = [
      /low-stock alerts and the full movement history are derived/i, // tracking
      /reorder levels are computed/i, // control
      /stock valuation, demand trend/i, // analytics
      /a business workspace with owner and staff roles/i, // workspace
    ];
    for (const body of bodies) {
      expect(screen.getByText(body)).toBeInTheDocument();
    }
  });

  it('renders four preview blocks but hides them from assistive tech', () => {
    const { container } = render(<FeaturesSection />);

    const previews = container.querySelectorAll('.features-preview');
    expect(previews).toHaveLength(4);

    for (const preview of previews) {
      /*
       * Each preview is its own `aria-hidden="true"` subtree, so a screen reader
       * that walks the section hears the four headings and stops — the imagined
       * SKU codes, unit counts and confidence scores are never announced as
       * readings.
       */
      expect(preview.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('marks every preview as illustrative for sighted users too', () => {
    const { container } = render(<FeaturesSection />);

    /*
     * The four chrome labels (one per preview) each pair with the visible
     * "Illustrative preview" caption. That caption is the contract with a
     * sighted reader that the figures are not live.
     */
    const labels = container.querySelectorAll('.features-preview');
    for (const label of labels) {
      expect(label.textContent ?? '').toMatch(/illustrative preview/i);
    }
  });

  it('keeps the invented dashboard figures out of the accessible tree', () => {
    const { container } = render(<FeaturesSection />);

    /*
     * The four previews *do* render the figures (the design needs them); they
     * just live behind an `aria-hidden` subtree. The contract is therefore
     * twofold:
     *
     *   1. The invented strings are in the DOM — proving each preview rendered
     *      the figure set we intended.
     *   2. The closest `aria-hidden` ancestor swallows them from assistive tech.
     *
     * We use a leaf-only search so the assertion does not match the section
     * root (whose `textContent` concatenates everything).
     */
    const cases: { figure: RegExp; description: string }[] = [
      { figure: /\$184k/, description: 'analytics "Stock value"' },
      { figure: /Arabica Beans 1kg/, description: 'control movement row' },
      { figure: /Nadia S\./, description: 'workspace member name' },
      { figure: /SKU-2071/, description: 'control reorder row' },
    ];

    for (const { figure, description } of cases) {
      const leaf = Array.from(container.querySelectorAll('*')).find((el) => {
        if (!figure.test(el.textContent ?? '')) return false;
        return !Array.from(el.children).some((c) => figure.test(c.textContent ?? ''));
      });
      expect(leaf, `invented figure for ${description} should render`).toBeTruthy();
      const hiddenAncestor = (leaf as Element).closest('[aria-hidden="true"]');
      expect(
        hiddenAncestor,
        `invented figure for ${description} should sit inside an aria-hidden subtree`,
      ).toBeTruthy();
    }
  });

  it('lays the four features out as a vertical list, not a card grid', () => {
    const { container } = render(<FeaturesSection />);

    /*
     * The list of rows. Each row is a single <li>, not a separate <article>
     * — the editorial layout groups them under one <ul>, the way a magazine
     * groups sections under one list. A second <ul> or extra wrapper would
     * break the visual rhythm the section is built around.
     */
    const lists = container.querySelectorAll('ul.features-rows > li');
    expect(lists).toHaveLength(4);

    /*
     * The first row is the featured one (Smart Stock Control). Pin that
     * ordering — it is the contract the rest of the entrance stagger and the
     * visual emphasis depend on.
     */
    const firstHeading = lists[0].querySelector('h3');
    expect(firstHeading?.textContent).toBe('Smart Stock Control');

    /*
     * No <article> anywhere — the section's visual primitive is the list
     * item, not a card. If a future change reintroduces a card grid, this
     * test fails and the redesign conversation has to happen again.
     */
    expect(container.querySelector('article')).toBeNull();
  });

  it('entrance class lives on each row and the featured one runs first', () => {
    const { container } = render(<FeaturesSection />);

    const rows = container.querySelectorAll('li.product-rise');
    expect(rows).toHaveLength(4);

    const delays = Array.from(rows).map(
      (a) => (a as HTMLElement).style.getPropertyValue('--section-delay').trim(),
    );
    /*
     * The featured row sits at delay 0; the three supporting rows stagger
     * afterwards. Order in the DOM is featured-first, then the three smaller.
     */
    expect(delays[0]).toBe('0s');
    expect(Number(delays[1].replace('s', ''))).toBeGreaterThan(0);
    expect(Number(delays[2].replace('s', ''))).toBeGreaterThan(Number(delays[1].replace('s', '')));
    expect(Number(delays[3].replace('s', ''))).toBeGreaterThan(Number(delays[2].replace('s', '')));
  });

  it('emphasises the featured row without making it oversized', () => {
    const { container } = render(<FeaturesSection />);

    const rows = Array.from(container.querySelectorAll<HTMLElement>('li.product-rise'));
    const featuredTitle = rows[0].querySelector('h3');
    const supportingTitle = rows[1].querySelector('h3');

    /*
     * Featured title is `text-xl sm:text-2xl`; supporting titles are
     * `text-base sm:text-lg`. The base sizes are deliberately close — the
     * featured row's emphasis comes from the accent border, the brighter
     * title colour and the inner preview, not from being twice the size of
     * the others.
     */
    expect(featuredTitle?.className ?? '').toMatch(/text-xl/);
    expect(supportingTitle?.className ?? '').toMatch(/text-base/);
  });

  it('lives inside a section whose motion can be disabled without hiding content', () => {
    /*
     * The reduced-motion contract is shared with `ProductSection`: the keyframe
     * starts at opacity 0 and ends at 1, so an element whose animation never
     * runs is simply visible. `product-rise` is the class we depend on; if it
     * ever switched to `opacity: 0` on the base rule, this section's content
     * would vanish for users who ask for reduced motion. Pin the class.
     */
    const { container } = render(<FeaturesSection />);
    const row = container.querySelector('li.product-rise');
    expect(row).toBeInTheDocument();
    expect(row?.className ?? '').toContain('product-rise');
  });

  it('does not contribute any links, buttons or forms', () => {
    const { container } = render(<FeaturesSection />);

    /*
     * The features section is read-only marketing copy — every CTA lives on the
     * hero. A link sneaking in here would compete with the hero's "Get Started"
     * for the visitor's first click.
     */
    expect(container.querySelectorAll('a, button, form')).toHaveLength(0);
  });
});