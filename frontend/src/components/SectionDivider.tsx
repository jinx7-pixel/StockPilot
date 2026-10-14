/**
 * The decorative rule between the hero and the product section.
 *
 * ## What is reused
 *
 * The traveling light runs on `@keyframes stockpilot-badge-trace` — the hero's
 * own badge keyframes — and on the same mask + `offset-path` architecture from
 * `components/animated-badge.tsx`. Nothing about the hero is modified; the
 * keyframes are simply path-agnostic, so a second element can ride them.
 *
 * ## What is not reused, and why it has to differ
 *
 * The badge traces a staircase that runs right-to-left inside a `0 0 70 52`
 * viewBox. Neither half of that transfers:
 *
 *   - **The path.** `TRACE_PATH` bends twice, and it travels backwards. This
 *     needs a single straight segment authored left-to-right.
 *   - **The travelling primitive.** This is the subtle part. The badge gets away
 *     with a `<circle>` only because its box is a near-square 165x56 and `r` was
 *     cut from 20 to 7 to compensate. Stretch that same circle across a
 *     full-width rule and `preserveAspectRatio="none"` squashes it into an
 *     ellipse that smears the light along the entire line — which is exactly
 *     the "bright full-line glow" this is meant not to be.
 *
 *     So the light is a `<rect>` instead, sized in user units and centred on the
 *     origin so its `fill-box` anchor coincides with the circle's, which keeps
 *     `offset-path` placing it identically. After stretching, its width is a
 *     fixed *fraction* of the rule (2.5%), so the streak stays short at any
 *     viewport width instead of scaling up on a wide screen.
 *
 * ## Why the vertical scale is exactly 1
 *
 * `viewBox` height and the box height are both 12px (`h-3`), so `scaleY` is 1 and
 * every vertical measurement below is in real pixels regardless of viewport
 * width. Only x stretches — and stretching x along a horizontal line is
 * geometrically harmless. That is what keeps the halo band a true 5px instead of
 * becoming 72px tall on a desktop screen.
 *
 * ## The glow
 *
 * The light is masked, so a blur applied inside the mask would simply be clipped
 * back to the 1px line. Instead the mask itself is two paths: a 5px stroke at
 * 16% for the halo, then the 1px stroke at full. Because the fill is a gradient
 * that fades along x, the halo fades with it — a glow that travels *with* the
 * streak rather than a line that glows everywhere.
 */

import { useId } from 'react';

/**
 * The traced line, shared verbatim by the SVG mask and the CSS `offset-path`.
 *
 * These must stay byte-identical or the light stops following the line — the
 * same constraint `TRACE_PATH` carries in `animated-badge.tsx`.
 *
 * It runs 0 -> 100 so `offset-distance` increases left-to-right, which is the
 * opposite of the badge's right-to-left travel.
 */
const DIVIDER_PATH = 'M 0 6 H 100';

export function SectionDivider({ color = '#34d399' }: { color?: string }) {
  // Two badges on one page would otherwise resolve to the first one's <defs>
  // and share its geometry.
  const uid = useId().replace(/:/g, '');
  const maskId = `sp-divider-mask-${uid}`;
  const gradId = `sp-divider-grad-${uid}`;

  return (
    <div aria-hidden="true" className="pointer-events-none w-full">
      {/*
        `h-3` matches the viewBox height of 12, which is what pins scaleY to 1.
        See the note above — that equality is load-bearing.
      */}
      <svg
        className="h-3 w-full"
        width="100%"
        height="100%"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        fill="none"
      >
        {/* The static rule. Neutral slate on purpose — the only green here is the light. */}
        <path d={DIVIDER_PATH} stroke="var(--color-slate-700)" strokeWidth="1" />

        <g mask={`url(#${maskId})`}>
          {/*
            Centred on the origin (x=-0.75/y=-3.5 about a 1.5x7 box) so the
            fill-box anchor is (0,0) and `offset-path` places it on the line. A rect
            offset from the origin would start its travel one box-width off.

            Height is 7 to cover the widest mask stroke exactly. It must not be
            *less*: the streak is what clips the halo, so a streak thinner than the
            halo cuts the glow into a hard-edged wedge — the same failure the
            capability-card light hit.

            Width 1.5 is 1.5% of the rule: 21.6px on a desktop, short enough to read
            as a light rather than a dash, and short enough that its gradient tail
            cannot stretch into a long streak.
          */}
          <rect
            className="divider-light"
            x="-0.75"
            y="-3.5"
            width="1.5"
            height="7"
            fill={`url(#${gradId})`}
          />
        </g>

        <defs>
          <mask id={maskId}>
            {/*
              Three strokes, widest first: a faint 7px halo, a tighter 3px one, then
              the solid 1px line. Two stops give a falloff that reads as a glow —
              a single faint stroke either disappears or blooms, and a blur inside
              a mask would just be clipped back to the line.

              This is the light's *thickness*: the streak is masked to the band, so
              the band's width is what the eye reads as how fat the light is. The
              whole band is only revealed where the streak paints, which is why the
              glow travels with the light instead of lighting the entire rule.
            */}
            <path d={DIVIDER_PATH} strokeWidth="7" stroke="white" strokeOpacity="0.16" />
            <path d={DIVIDER_PATH} strokeWidth="3" stroke="white" strokeOpacity="0.42" />
            <path d={DIVIDER_PATH} strokeWidth="1" stroke="white" />
          </mask>
          {/*
            Brightest just before the leading (right) end, then a short fade *into*
            it. With the peak sitting exactly on `100%` the opacity stepped from
            full to nothing in one pixel and the head read as a hard vertical cut —
            visible once the stroke is thicker. The last stop lands at 0.55, so the
            front edge softens over roughly the last 2px of a 21px streak without
            dimming the head itself.
          */}
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0" />
            <stop offset="50%" stopColor={color} stopOpacity="0.85" />
            <stop offset="88%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export default SectionDivider;