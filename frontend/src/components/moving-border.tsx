/**
 * A border that appears to orbit the control.
 *
 * ## Why this is CSS and not the `framer-motion` version
 *
 * The widely-copied implementation of this effect drives a gradient blob around
 * an SVG `<rect>` with `useAnimationFrame` plus `getPointAtLength`, which needs
 * `framer-motion`. This repo has a standing rule against adding dependencies
 * unless one is unavoidable, and it is avoidable here: a rotating `conic-gradient`
 * masked down to a 1px ring produces the same travelling highlight, needs no
 * runtime, survives SSR, and costs a few hundred bytes of CSS.
 *
 * It is also more robust. The SVG version has to hardcode a `path()` string per
 * button size, so the orbit drifts out of alignment the moment a width or a
 * responsive breakpoint changes. This one follows the element's own box.
 *
 * ## Anatomy
 *
 * `.moving-border` owns a `::before` ring sitting 1px outside the element's box.
 * The ring is a conic gradient turned by `--sp-mb-angle`, a registered custom
 * property — unregistered custom properties cannot be interpolated, so the angle
 * would snap rather than rotate. The ring is masked with the standard
 * content-box/exclude pair, which is what leaves the middle transparent.
 *
 * ## Deliberate non-responsibilities
 *
 *  - **Display.** The component adds no `display` utility. `hidden` and
 *    `inline-flex` are both display utilities, and which one wins is decided by
 *    the order Tailwind emits them in the stylesheet — not by the order they are
 *    written here. The caller therefore owns display, so a responsive
 *    `hidden md:inline-flex` cannot be silently overridden.
 *  - **Focus and hit-testing.** Both belong to the rendered element, not to the
 *    decoration. Pass the router's `Link` as `as` so the control keeps real link
 *    semantics and one focusable node.
 */

import type { CSSProperties, ElementType, ReactNode } from 'react';

export function MovingBorder({
  as: Component = 'span',
  children,
  className = '',
  duration,
  ...rest
}: {
  /** Element or component to render. Defaults to a plain `span`. */
  as?: ElementType;
  children: ReactNode;
  className?: string;
  /** Seconds per revolution. Omit to use the CSS default. */
  duration?: number;
  /**
   * Forwarded to the rendered element untouched. This is what lets
   * `as={Link}` receive `to`, and what lets an `onClick` close the drawer —
   * the control stays a real link rather than a div with click handling.
   */
  [key: string]: unknown;
}) {
  return (
    <Component
      {...rest}
      className={`moving-border ${className}`}
      style={
        duration
          ? ({ '--moving-border-duration': `${duration}s` } as CSSProperties)
          : undefined
      }
    >
      {children}
    </Component>
  );
}

export default MovingBorder;