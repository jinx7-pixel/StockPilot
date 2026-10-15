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
 *     fixed *fraction* of the rule, so the streak stays short at any
 *     viewport width instead of scaling up on a wide screen.
 *
 * ## How vertical scale controls glow thickness
 *
 * The viewBox is 12 units tall and stays 12px tall at every breakpoint. Desktop,
 * tablet and mobile CSS resize the light and mask together, keeping the streak
 * centered on the path while changing its glow thickness. X stretches to the
 * section width, so the streak length remains a fraction of the line.
 *
 * ## The glow
 *
 * The light is masked, so a blur applied inside the mask would simply be clipped
 * back to the 1px line. Instead the mask uses a 12px outer stroke at 48% and a
 * 5px inner stroke at 82%, over the 1px core. Because the fill is a gradient
 * that fades along x, the halo fades with it — a brighter glow that travels
 * *with* the streak rather than a line that glows everywhere.
 */

import { useId } from 'react';

/**
 * The traced line, shared verbatim by the SVG mask and the CSS `offset-path`.
 *
 * These must stay byte-identical or the light stops following the line — the
 * same constraint `TRACE_PATH` carries in `animated-badge.tsx`.
 *
 * It runs 0 -> 100 so `offset-distance` increases left-to-right by default.
 * `reverse` opts an instance into right-to-left travel without changing the path.
 */
const DIVIDER_PATH = 'M 0 6 H 100';

export function SectionDivider({
  color = '#34d399',
  reverse = false,
}: {
  color?: string;
  reverse?: boolean;
}) {
  // Two badges on one page would otherwise resolve to the first one's <defs>
  // and share its geometry.
  const uid = useId().replace(/:/g, '');
  const maskId = `sp-divider-mask-${uid}`;
  const gradId = `sp-divider-grad-${uid}`;

  return (
    <div aria-hidden="true" className="pointer-events-none w-full">
      {/*
        The base height matches the 12-unit viewBox. Tablet CSS expands the SVG
        vertically so its glow is thicker there.
      */}
      <svg
        className="divider-svg w-full"
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
            Centred on the origin (x=-1.1/y=-6 about a 2.2x12 box) so the
            fill-box anchor is (0,0) and `offset-path` places it on the line. A rect
            offset from the origin would start its travel one box-width off.

            Base height 12 matches the widest mask stroke. Desktop and tablet CSS
            reduce both to 10; mobile CSS reduces both to 8. Matching them keeps
            the clipped glow soft at each breakpoint.

            The base width is 2.2% of the rule. Desktop CSS shortens it to 1.8%;
            tablet and mobile set their own widths. The x coordinate stays at
            minus half the width so the streak remains centered on the path.
          */}
          <rect
            className={reverse ? 'divider-light divider-light--reverse' : 'divider-light'}
            x="-1.1"
            y="-6"
            width="2.2"
            height="12"
            fill={`url(#${gradId})`}
          />
        </g>

        <defs>
          <mask id={maskId}>
            {/*
              Three strokes, widest first: a brighter 12px outer halo, a tighter
              5px inner glow, then the solid 1px line. The halo stops give a
              falloff that reads as a glow —
              a single faint stroke either disappears or blooms, and a blur inside
              a mask would just be clipped back to the line.

              This is the light's *thickness*: the streak is masked to the band, so
              the band's width is what the eye reads as how fat the light is. The
              whole band is only revealed where the streak paints, which is why the
              glow travels with the light instead of lighting the entire rule.
            */}
            <path
              className="divider-glow-outer"
              d={DIVIDER_PATH}
              strokeWidth="12"
              stroke="white"
              strokeOpacity="0.48"
            />
            <path
              className="divider-glow-inner"
              d={DIVIDER_PATH}
              strokeWidth="5"
              stroke="white"
              strokeOpacity="0.82"
            />
            <path className="divider-glow-core" d={DIVIDER_PATH} strokeWidth="1" stroke="white" />
          </mask>
          {/*
            The gradient flips with `reverse`, keeping the brightest end in front
            of the moving light. The peak sits just before the leading edge, then
            fades into it; ending at full opacity made the head read as a hard cut.
            The last stop softens the edge without dimming the highlight itself.
          */}
          <linearGradient
            id={gradId}
            x1={reverse ? '1' : '0'}
            y1="0"
            x2={reverse ? '0' : '1'}
            y2="0"
          >
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
