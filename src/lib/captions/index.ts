/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: captions barrel, buildCaptionTrack,
 *   getCaptionStyle, CAPTION_STYLES, passesContrast, captionBox,
 *   CAPTIONS_STAY_PURE
 *
 * WHAT:  The public surface of the caption library — the style data, the
 *        track builder, the layout maths and the contrast rule.
 *
 * WHY:   CAPTIONS_STAY_PURE. Nothing under src/lib/captions/ imports Prisma,
 *        `server-only`, React, Remotion or a Node built-in, which is what
 *        lets the SAME code decide the grouping, the box and the colours in
 *        three places that must agree to the pixel: the gallery's live
 *        preview in the browser, the Remotion Player, and a cloud render in a
 *        Lambda. A single server-side import here would break that silently —
 *        the preview would still work and would quietly stop predicting the
 *        output.
 *
 *        Importers use this barrel rather than the individual files so the
 *        internal split (chunk.ts, text.ts, safe-zone.ts) stays free to
 *        change, exactly as src/lib/timeline/index.ts does.
 * WHERE: Imported as '@/lib/captions' by the captions router, the alignment
 *        service, src/remotion/components/captions.tsx and the style gallery.
 */

export {
  CAPTION_STYLES,
  CAPTION_STYLE_BASE,
  CAPTION_STYLE_FAMILIES,
  DEFAULT_CAPTION_STYLE_ID,
  defineStyle,
  getCaptionStyle,
  isCaptionStyleId,
  listCaptionStyles,
} from "./styles";

export {
  CAPTION_BAND_Y,
  CAPTION_TRACK_ID,
  buildCaptionTrack,
} from "./build-track";
export type { BuildCaptionTrackOptions } from "./build-track";

export { PAUSE_BREAK_SECONDS, groupWords } from "./chunk";
export type { WordChunk } from "./chunk";

export {
  CONTRAST_GRAPHIC_MIN,
  CONTRAST_TEXT_MIN,
  MIN_LOAD_BEARING_STROKE,
  REFERENCE_BACKGROUNDS,
  contrastRatio,
  passesContrast,
  relativeLuminance,
} from "./contrast";
export type { ContrastReport, ReferenceBackgroundId } from "./contrast";

export { captionBox, captionFontPx } from "./safe-zone";
export type { CaptionBox } from "./safe-zone";

export { applyCaptionCase, captionTextShadow, withAlpha } from "./text";

export {
  CAPTION_FONT_FAMILIES,
  RENDER_FONT_FAMILY,
  captionFontFamily,
} from "./fonts";

export {
  SPEAKER_CAPTION_COLORS,
  dominantSpeaker,
  speakerCaptionTint,
  speakerLabelFor,
} from "./speakers";
