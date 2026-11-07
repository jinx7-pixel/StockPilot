# Landing hero artwork and motion

The public navbar and hero use an original cyan, blue, and violet flower composition inspired by the visual direction of the supplied MiniMax reference. The sections below use white surfaces and blue accents.

## Assets

Generated with the built-in `image_gen` tool, with a transparent background. No MiniMax artwork or video is bundled. The generated PNG was encoded as WebP with its transparency preserved:

- `frontend/public/images/stockpilot-bloom-1280.webp`: 158,448 bytes.
- `frontend/public/images/stockpilot-bloom-640.webp`: 54,802 bytes.

The browser chooses the appropriate asset through `srcset`; high-density phones may choose the larger version. There are no runtime media CDN or webfont requests.

## Final generation prompt

> Use case: stylized-concept. Asset type: original decorative flower for StockPilot website hero, isolated transparent PNG, square composition. Create one exquisite abstract five-petal bloom seen front-on with a slight three-quarter twist, five broad flowing silk/glass petals emerging from a tiny central pinch, asymmetrical elegant organic folded surfaces, cobalt blue and rich ultraviolet purple deep folds blending into luminous ice-cyan and pale blue edges. Soft dreamy depth of field, silky translucent material, cinematic 3D render, luminous fluid sculpture like a wind-swept flower. Broad simple surfaces, not lots of fine veins. Petals occupy 85% of square with ample clear transparent margins, no cropped edges. NO stem, leaves, pollen, vase, text, logo, UI, watermark or background. This is an original design, not a brand asset. Keep soft organic silhouette and high quality translucent petals on true transparent alpha. Must look beautiful large behind white heading on bright azure background.

## Motion and accessibility

This implementation uses an image with a 14-second CSS transform loop, not a video. It rotates, scales and drifts the whole flower; it does not independently animate individual petals. Only the decorative flower composition moves. Content and buttons stay fixed. Two treatments of the same cached asset move together: a defined inner layer (1.5px desktop / 1px mobile blur) and a diffused outer layer (22px / 14px blur). Feathered masks blend the layers, with deeper blue-violet folds and a clean cyan background. Filters and masks stay fixed; only their shared parent transform animates. This approximates the live reference’s depth of field rather than blurring the entire flower uniformly.

- A visible pause/resume control lets visitors stop the background.
- `prefers-reduced-motion: reduce` disables the animation and hides its control.
- Intersection and visibility observers pause it outside the visible hero or in a hidden tab.
- The decorative image has empty alternative text and an `aria-hidden` parent.
- No JavaScript animation loop, canvas, WebGL, or animation package was added.

## Validation

- Production build and 24 targeted hero/navbar tests passed.
- Lint reported no errors; an existing hook-dependency warning remains in ProductsPage.
- Browser checks at widths 320, 390, 1024 and 1440: no horizontal overflow or overlapping hero controls.
- Verified mobile menu, section navigation, pause/resume (frozen transform), off-screen suspension and loading of the reduced-motion stylesheet rule.
- This is not a measured frame-rate guarantee across devices. The existing application bundle still triggers Vite's large-chunk warning.
