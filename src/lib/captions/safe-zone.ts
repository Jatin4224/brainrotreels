/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: captionBox, CaptionBox, SAFE_ZONE_IS_PER_PLATFORM,
 *   OVERFLOW_IS_A_BUG, clampIntoSafeZone, captionFontPx
 *
 * WHAT:  Where a caption is allowed to be drawn, in pixels, for one canvas
 *        and one platform — and the clamp that keeps a band inside it.
 *
 * WHY:   OVERFLOW_IS_A_BUG, NOT A COSMETIC ISSUE — the phase's step 10. A long
 *        German compound, a fast run of four words, a style at 8.5vh: each on
 *        its own fits, and together they run off the frame or under TikTok's
 *        button rail. The defence is not a careful style; it is a BOX that
 *        the text is laid out inside, with wrapping on and a width it cannot
 *        exceed. That makes overflow impossible by construction rather than
 *        unlikely by inspection, and the hostile-line test proves it on the
 *        worst input anyone could write.
 *
 *        The maths is HERE rather than in the component for one reason: the
 *        gallery's live preview and the Remotion renderer must agree to the
 *        pixel, and the only way to guarantee that is for both to call the
 *        same function. A preview that positions captions "about the same
 *        way" is a preview that stops being a preview the moment a style sits
 *        near the edge of its band.
 *
 *        SAFE_ZONE_IS_PER_PLATFORM — the insets come from SAFE_ZONE_INSETS,
 *        which is in lib/types next to the rest of the caption vocabulary.
 * WHERE: src/remotion/components/captions.tsx and the gallery preview.
 */

import type { CanvasSpec } from "@/lib/timeline";
import {
  SAFE_ZONE_INSETS,
  type CaptionPosition,
  type CaptionStyle,
  type SafeZone,
} from "@/lib/types/caption";

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionBox
 *
 * WHAT:  The rectangle a caption is drawn inside, in canvas pixels.
 * WHY:   A BOX rather than a point, because a caption has to wrap and a point
 *        cannot say how wide a line may get. `centerY` is carried alongside
 *        rather than derived by the caller, so the band's meaning — the
 *        vertical CENTRE of the text block, not its top — is stated once.
 * WHERE: Returned by captionBox; consumed by the caption component.
 */
export interface CaptionBox {
  left: number;
  width: number;
  top: number;
  height: number;
  centerY: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: captionFontPx
 *
 * WHAT:  A style's size in real pixels on this canvas.
 * WHY:   `sizeVh` is a fraction of FRAME HEIGHT (see CaptionStyle), so the
 *        same document produces proportionally identical captions at 720p,
 *        1080p and 4K. Deriving it anywhere else is how a preview proxy and a
 *        final render disagree about how big the text is.
 * WHERE: The caption component; the gallery preview.
 */
export function captionFontPx(style: CaptionStyle, canvas: CanvasSpec): number {
  return (style.sizeVh / 100) * canvas.height;
}

/**
 * SOURCE OF TRUTH KEYWORDS: captionBox, OVERFLOW_IS_A_BUG, clampIntoSafeZone
 *
 * WHAT:  The safe rectangle, and the caption's centre within it.
 *
 * WHY:   The band (`position`, or a caption item's own `position.y`) is a
 *        WISH and the safe zone is a CONSTRAINT, so the wish is clamped into
 *        the constraint rather than added to it. A style that asks to sit at
 *        0.9 on TikTok does not get to sit under the button rail; it gets the
 *        lowest position that is still safe. Clamping — rather than refusing,
 *        or silently centring — keeps the customer's intent as far as the
 *        platform allows, which is what they would do by hand.
 *
 *        The clamp reserves `blockHeight` so the TOP of a two-line caption is
 *        inside the zone too, not just its centre. Reserving only the centre
 *        is the off-by-one that puts the first line of a wrapped caption over
 *        the platform's own UI — and it only shows up on long lines, which is
 *        to say in production.
 * WHERE: The caption component, once per caption.
 */
export function captionBox(args: {
  canvas: CanvasSpec;
  safeZone: SafeZone;
  /** The band the style or the caption item asks for. */
  band: CaptionPosition | number;
  /** The height the text will occupy, in pixels. */
  blockHeight: number;
}): CaptionBox {
  const { canvas, safeZone, band, blockHeight } = args;
  const insets = SAFE_ZONE_INSETS[safeZone];

  const left = Math.round(insets.sides * canvas.width);
  const width = Math.round(canvas.width - 2 * insets.sides * canvas.width);
  const top = Math.round(insets.top * canvas.height);
  const bottom = Math.round(canvas.height - insets.bottom * canvas.height);
  const height = bottom - top;

  const wishedY =
    typeof band === "number" ? band * canvas.height : bandY(band) * canvas.height;

  /* Half the block at each end, so the whole text sits inside the zone. A
   * block TALLER than the zone (a hostile line in a large style) centres
   * instead of being pushed off one edge — the overflow is then symmetric and
   * the middle of the caption is still readable, which is the least bad
   * outcome available. */
  const halfBlock = blockHeight / 2;
  const centerY =
    blockHeight >= height
      ? top + height / 2
      : clamp(wishedY, top + halfBlock, bottom - halfBlock);

  return { left, width, top, height, centerY };
}

/**
 * SOURCE OF TRUTH KEYWORDS: bandY, POSITION_IS_A_BAND
 *
 * The same three numbers as CAPTION_BAND_Y in build-track.ts, reached from
 * the other side: build-track writes a band onto an item, this reads a band
 * that was never written. They are deliberately separate constants — one is a
 * document value and one is a rendering default, and collapsing them would
 * make a change to the gallery's slider silently rewrite stored documents.
 */
function bandY(band: CaptionPosition): number {
  switch (band) {
    case "top":
      return 0.18;
    case "middle":
      return 0.5;
    case "bottom":
      return 0.78;
    default: {
      const exhaustive: never = band;
      throw new Error(`[captions/safe-zone] Unknown band ${String(exhaustive)}`);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
