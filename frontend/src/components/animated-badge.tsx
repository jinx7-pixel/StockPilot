/**
 * The animated eyebrow badge.
 *
 * ## What was adapted, and why
 *
 * The reference implementation of this badge imports three things this repo does
 * not have, and all three were reworked rather than installed:
 *
 *   - **`motion/react`** drove the `whileInView` fade/blur/lift. That is a
 *     one-shot entrance, which is exactly what the hero's existing `.hero-rise`
 *     animation already does — so the badge takes `className` and plugs into the
 *     hero's own stagger instead of adding a runtime.
 *   - **`next/link`** is a Next.js router; this app is Vite + React Router. The
 *     `href` prop stays optional and, when given, renders a real router `Link`
 *     rather than an `<a>` that would do a full page load.
 *   - **`lucide-react`** supplied `ChevronRight`. The project hand-rolls inline
 *     SVGs everywhere — see the navbar's hamburger and the hero's check marks — so
 *     the icon is inlined too, at zero cost.
 *
 * What is kept verbatim is the part that actually reads as this component: the
 * double `animate-ping` dot, and the masked SVG line above the badge that a
 * light walks along.
 *
 * ## The line sits outside the badge box
 *
 * The SVG is anchored to `bottom-full`, so it is `aria-hidden` and
 * `pointer-events-none`. It is also why the hero needs headroom above the eyebrow:
 * the line reaches up from the badge, and the sticky navbar above is opaque, so
 * anything taller than the gap between them gets sliced.
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

/**
 * The traced path, shared by the SVG mask and the CSS `offset-path` that walks the
 * light along it. They must stay byte-identical or the light stops following the
 * line.
 */
const TRACE_PATH =
  'M 69 49.8 h -30 q -3 0 -3 -3 v -13 q 0 -3 -3 -3 h -23 q -3 0 -3 -3 v -13 q 0 -3 -3 -3 h -30';

/** `#rgb` and `#rrggbb` to `rgba()`. Anything else is passed through untouched. */
function hexToRgba(hexColor: string, alpha: number): string {
  const hex = hexColor.replace('#', '');

  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return hexColor;
}

export function AnimatedBadge({
  text = 'Inventory Intelligence',
  color = '#34d399',
  href,
  className = '',
  style,
}: {
  text?: string;
  /** Hex or any CSS colour. Drives the dot, the ping and the traced line together. */
  color?: string;
  /** Optional router destination. Omit for a non-interactive badge. */
  href?: string;
  className?: string;
  /**
   * Applied to the badge box. The hero passes its `--hero-delay` through here so
   * the badge joins the section's existing stagger instead of carrying a second,
   * competing entrance system.
   */
  style?: CSSProperties;
}) {
  /*
   * The mask and gradient ids must be unique per instance: two badges on one page
   * would otherwise resolve to the first one's <defs> and share its geometry.
   */
  const uid = useId().replace(/:/g, '');
  const maskId = `sp-badge-mask-${uid}`;
  const gradId = `sp-badge-grad-${uid}`;

  const badge = (
    <span
      className={`group relative flex max-w-fit items-center justify-center gap-2.5 rounded-full border border-accent-500/30 bg-accent-500/10 px-3.5 py-1.5 text-accent-400 ${className}`}
      style={style}
    >
      {/*
        The light line traced above the badge.

        Two changes were needed to make the reference's own path actually render
        here, neither of which alters its shape:

        - **`viewBox` is `0 0 70 52`, not `0 0 50 50`.** The path runs out to
          x≈69, so the original viewBox clipped the right-hand half of it away.
        - **`preserveAspectRatio="none"`.** With the default `xMidYMid meet`, a
          50-unit viewBox in this box is scaled to the *short* side and centred,
          which pushed the light circle at cx=0 out of the visible area entirely.

        The circle's radius is reduced from the reference's 20. Stretched into a
        165x56 box it would be an ellipse roughly the size of the whole line and
        light it uniformly — a wash, not a travelling highlight.
      */}
      <span
        className="sp-badge-line pointer-events-none absolute inset-x-0 bottom-full h-14 w-[165px]"
        aria-hidden="true"
      >
        <svg
          className="h-full w-full"
          width="100%"
          height="100%"
          viewBox="0 0 70 52"
          preserveAspectRatio="none"
          fill="none"
        >
          <g mask={`url(#${maskId})`}>
            <circle className="sp-badge-light" cx="0" cy="0" r="7" fill={`url(#${gradId})`} />
          </g>
          <defs>
            <mask id={maskId}>
              <path d={TRACE_PATH} strokeWidth="1" stroke="white" />
            </mask>
            <radialGradient id={gradId} fx="1">
              <stop offset="0%" stopColor={color} />
              <stop offset="20%" stopColor={color} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
        </svg>
      </span>

      {/* The pulse. Two nested pings give the expanding ring its soft double edge. */}
      <span className="relative flex h-1 w-1 shrink-0 items-center justify-center">
        <span
          className="flex h-2 w-2 animate-ping items-center justify-center rounded-full motion-reduce:animate-none"
          style={{ backgroundColor: hexToRgba(color, 0.45) } as CSSProperties}
        >
          <span
            className="flex h-2 w-2 animate-ping items-center justify-center rounded-full motion-reduce:animate-none"
            style={{ backgroundColor: hexToRgba(color, 0.35) } as CSSProperties}
          />
        </span>
        <span
          className="absolute top-1/2 left-1/2 flex h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ backgroundColor: hexToRgba(color, 0.9) } as CSSProperties}
          aria-hidden="true"
        />
      </span>

      <span className="text-xs font-semibold uppercase tracking-[0.18em]">{text}</span>
    </span>
  );

  if (!href) return badge;
  return <Link to={href}>{badge}</Link>;
}

export default AnimatedBadge;