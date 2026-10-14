/**
 * Tests for the hero/product divider.
 *
 * The motion and the paint are CSS/SVG and `jsdom` applies no stylesheet, so what
 * is assertable here is the contract that makes the effect correct: the rule is
 * decorative, it is driven by the hero's existing keyframes rather than a second
 * animation system, and the mask path and the CSS `offset-path` cannot drift
 * apart — the one mistake that would make the light travel along nothing.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SectionDivider } from './SectionDivider';

/** The path the CSS `offset-path` must agree with. */
const DIVIDER_PATH = 'M 0 6 H 100';

describe('SectionDivider', () => {
  it('is decorative: hidden from assistive tech and never a hit target', () => {
    const { container } = render(<SectionDivider />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper.className).toContain('pointer-events-none');
  });

  it('contributes no links, headings or text to the page', () => {
    const { container } = render(<SectionDivider />);

    expect(container.querySelectorAll('a, button')).toHaveLength(0);
    expect(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(0);
    expect(container.textContent).toBe('');
  });

  it('draws the static rule in neutral slate, not emerald', () => {
    const { container } = render(<SectionDivider />);

    const staticRule = Array.from(container.querySelectorAll('path')).find(
      (p) => p.getAttribute('stroke') !== null && !p.closest('mask'),
    );

    expect(staticRule).toBeDefined();
    expect(staticRule!.getAttribute('stroke')).toBe('var(--color-slate-700)');
  });

  it('keeps the mask path and the CSS offset-path in agreement', () => {
    const { container } = render(<SectionDivider />);

    const masked = Array.from(container.querySelectorAll('mask path')).map((p) =>
      p.getAttribute('d'),
    );
    // Every stroke of the glow — two halo stops plus the solid line — traces the
    // same geometry.
    expect(masked).toHaveLength(3);
    for (const d of masked) expect(d).toBe(DIVIDER_PATH);
  });

  it('drives the light from the hero badge keyframes', () => {
    const { container } = render(<SectionDivider />);

    const light = container.querySelector('.divider-light');
    expect(light).toBeInTheDocument();
    expect(light?.tagName.toLowerCase()).toBe('rect');

    /*
     * A `<rect>`, not a `<circle>`. Stretched across a full-width rule by
     * `preserveAspectRatio="none"`, a circle flattens into an ellipse that
     * smears the light along the whole line. A rect of fixed user-unit width
     * stays a fixed fraction of the rule at any viewport width.
     *
     * Centred on the origin, because `offset-path` positions the element's
     * `fill-box` anchor — a rect offset from (0,0) would begin its travel one
     * box-width away from the line.
     */
    expect(light?.getAttribute('x')).toBe('-0.75');
    expect(light?.getAttribute('width')).toBe('1.5');
  });

  it('makes the light at least as thick as the widest glow stroke', () => {
    const { container } = render(<SectionDivider />);

    /*
     * The streak is what clips the glow: the mask reveals the halo band only
     * where the streak paints, so a streak shorter than the widest stroke cuts
     * that band into a hard-edged wedge instead of a soft glow. Equal is enough
     * — it is `>=`, not `>`, that matters.
     */
    const height = Number(container.querySelector('.divider-light')?.getAttribute('height'));
    const strokes = Array.from(container.querySelectorAll('mask path')).map((p) =>
      Number(p.getAttribute('stroke-width')),
    );

    expect(Math.max(...strokes)).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(Math.max(...strokes));
  });

  it('gives each divider its own mask and gradient ids', () => {
    const a = render(<SectionDivider />).container;
    const b = render(<SectionDivider />).container;

    const idA = a.querySelector('mask')?.id;
    const idB = b.querySelector('mask')?.id;

    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
    // The light must reference its own instance's gradient.
    expect(a.querySelector('.divider-light')?.getAttribute('fill')).toContain(idA?.replace('mask', 'grad'));
  });

  it('fades at both ends so the streak is never cut off square', () => {
    const { container } = render(<SectionDivider />);

    /*
     * Both ends matter, and for opposite reasons.
     *
     * Trailing (left) end at `0` opacity: that is the tail, and it must reach
     * zero or the streak reads as a hard dash.
     *
     * Leading (right) end *below* full opacity: with the peak sitting exactly on
     * the rect's boundary the opacity stepped from full to nothing in one pixel
     * and the head showed as a vertical cut. Dimming the last stop lets the
     * front edge fade in. Kebab-case — React writes `stopOpacity` as
     * `stop-opacity`.
     */
    const stops = Array.from(container.querySelectorAll('linearGradient stop'));
    expect(stops.length).toBeGreaterThanOrEqual(3);

    const opacity = (el: Element) => {
      const raw = el.getAttribute('stop-opacity');
      return raw === null ? 1 : Number(raw);
    };

    expect(opacity(stops[0])).toBe(0);

    const head = opacity(stops[stops.length - 1]);
    expect(head).toBeGreaterThan(0);
    expect(head).toBeLessThan(1);

    // The brightest stop is near the front but not at it. `offset` is written as
    // a percentage, so strip the sign before comparing numerically.
    const at = (el: Element) => Number((el.getAttribute('offset') ?? '').replace('%', ''));
    const peak = stops.reduce((best, s) => (opacity(s) > opacity(best) ? s : best));
    expect(at(peak)).toBeGreaterThan(70);
    expect(at(peak)).toBeLessThan(100);
  });
});