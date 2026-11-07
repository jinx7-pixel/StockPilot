/**
 * Tests for the landing product section.
 *
 * The dashboard preview and its motion are CSS, and `jsdom` applies no stylesheet,
 * so none of that is assertable here — it is verified in a real browser. What
 * *is* assertable, and what this file covers, is the part that would actually
 * break a visitor: the copy, the heading hierarchy, that the section anchors as
 * `#product`, that the invented figures are never announced as real readings, and
 * that nothing here promises a capability the codebase does not have.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductSection } from './ProductSection';

function renderSection() {
  return render(<ProductSection />);
}

describe('ProductSection', () => {
  it('is anchored at #product so the navbar link resolves', () => {
    renderSection();

    expect(screen.getByRole('region', { name: /your inventory\. one clear picture\./i })).toBeInTheDocument();
    expect(document.getElementById('product')).toBeInTheDocument();
  });

  it('leads with a single h2 carrying the heading, under the hero’s h1', () => {
    renderSection();

    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent('Your Inventory. One Clear Picture.');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    // No h1 here — the hero owns it, and a second would flatten the outline.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('shows the eyebrow and supporting copy', () => {
    renderSection();

    expect(screen.getByText(/the product/i)).toBeInTheDocument();
    expect(
      screen.getByText(/catalogue, stock ledger, sales and purchasing/i),
    ).toBeInTheDocument();
  });

  it('describes the workspace preview as illustrative sample data', () => {
    renderSection();

    for (const visual of screen.getAllByRole('img')) {
      expect(visual.getAttribute('aria-label')).toMatch(/illustrative/i);
      expect(visual.getAttribute('aria-label')).toMatch(/sample data/i);
    }
  });

  it('keeps sample figures inside described previews', () => {
    renderSection();

    /*
     * `role="img"` alone is NOT enough, and this test exists because that was
     * measured rather than assumed. Marking children presentational is a rule
     * the accessibility-tree builder computes, and Chrome does not apply it to
     * this subtree: the table still surfaced as 6 rows and 20 cells with "18,940"
     * and "SKU-1042" announced as text.
     *
     * `aria-hidden="true"` on the preview's contents is what actually removes it,
     * and because that is a plain attribute rather than a computed role, jsdom
     * can assert it — Testing Library's role queries do apply `aria-hidden`.
     */
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.queryAllByRole('cell')).toHaveLength(0);

    /*
     * The figures are still in the DOM — sighted users have to see them — so this
     * asserts containment rather than absence. `getByText` walks the DOM and
     * ignores `aria-hidden`, which is exactly why absence is the wrong claim.
     */
    expect(screen.getByText('18,940').closest('[aria-hidden="true"]')).not.toBeNull();
    // Rendered alongside its unit, hence the substring match.
    expect(screen.getByText(/SKU-1042/).closest('[aria-hidden="true"]')).not.toBeNull();

    expect(screen.getAllByRole('img')).toHaveLength(1);


  });

  it('marks the preview as illustrative for sighted users too', () => {
    renderSection();
    expect(screen.getByText(/illustrative preview/i)).toBeInTheDocument();
  });

  it('describes capabilities the codebase actually supports', () => {
    renderSection();

    const text = document.body.textContent ?? '';
    // `actions.ts` creates a *draft* purchase order and nothing else.
    expect(text).toMatch(/draft purchase order/i);
    // The recommendations client renders; it performs no write of its own.
    expect(text).toMatch(/confidence/i);
    expect(text).toMatch(/evidence/i);
  });

  it('promises no capability that does not exist yet', () => {
    renderSection();

    const text = document.body.textContent ?? '';
    for (const claim of [
      /\bAI[- ]powered\b/i,
      /\blive\s+AI\b/i,
      /\bautomatically\s+orders?\b/i,
      /\breal[- ]time\b/i,
      /\bfully\s+automated\b/i,
      // Approving/recommendations are not executable actions in this app.
      /\bapprove\s+recommendations?\b/i,
    ]) {
      expect(text).not.toMatch(claim);
    }
  });

  it('invents no statistics, testimonials or customer numbers', () => {
    renderSection();

    const text = document.body.textContent ?? '';
    for (const claim of [
      /\b\d+\s*customers?\b/i,
      /\b\d+\s*(?:k|m|million)?\s*(?:revenue|users|companies)\b/i,
      /\btestimonials?\b/i,
      /\b\d+(?:\.\d+)?\s*%\s*(?:faster|more|less)\b/i,
    ]) {
      expect(text).not.toMatch(claim);
    }
  });

  it('links to the workflow without making the sample workspace interactive', () => {
    renderSection();
    expect(screen.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '#how-it-works');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('img').querySelector('a, button, input, [tabindex]')).toBeNull();
  });
});
