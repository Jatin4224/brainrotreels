/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildCaptionTrack, BuildCaptionTrackOptions,
 *   CAPTION_TRACK_ID, RESTYLING_IS_FREE, WORD_RANGE_NOT_TEXT,
 *   POSITION_IS_A_BAND, CAPTION_BAND_Y
 *
 * WHAT:  Turns `doc.words` plus a style id into the document's caption track.
 *
 * WHY:   RESTYLING_IS_FREE, which is one of the phase's "done when" checks and
 *        the reason this function returns a TRACK OF WORD RANGES rather than
 *        a track of timed text. Nothing it produces carries a second, so a
 *        restyle cannot move a caption even by accident — the times are
 *        derived from `doc.words` by `captionRangeSeconds`, which is the only
 *        place in the app that derives them. The test asserts the ranges are
 *        identical across every style in the library, which is a stronger
 *        statement than "we were careful".
 *
 *        WORD_RANGE_NOT_TEXT is the schema's own rule (see captionItemSchema)
 *        and this is the function that honours it. A caption never stores a
 *        copy of its words; the editor changes caption text by changing the
 *        words themselves (`setCaptionText` in src/lib/timeline/ops.ts).
 *
 *        It is PURE and framework-free, like the timeline module it feeds —
 *        the same function runs in the generate pipeline, in the gallery's
 *        live preview and in Phase 15's editor, and the three must produce
 *        byte-identical tracks or the preview stops predicting the render.
 * WHERE: `captionStyles.apply`, the generate pipeline (Phase 09), and the
 *        gallery preview.
 */

import type { CaptionItem, CaptionTrack, WordToken } from "@/lib/timeline";
import type { CaptionPosition } from "@/lib/types/caption";
import { groupWords } from "./chunk";
import { getCaptionStyle } from "./styles";

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_TRACK_ID, ONE_CAPTION_TRACK
 *
 * ONE_CAPTION_TRACK, with a FIXED id. Rebuilding the track on every restyle
 * means replacing it, and a generated id would leave the old track behind —
 * two caption lanes drawing the same words on top of each other, which looks
 * like a font-weight bug rather than a duplicate track. The schema allows a
 * second lane (a translation, later); this is the id of the primary one.
 */
export const CAPTION_TRACK_ID = "captions";

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_BAND_Y, POSITION_IS_A_BAND
 *
 * WHAT:  The vertical centre of each band, as a fraction of frame height.
 * WHY:   Deliberately NOT safe-zone-aware. The band is the customer's intent
 *        ("low on the frame") and the safe zone is the platform's constraint;
 *        resolving them here would bake one platform's insets into the
 *        document, so the same project exported for Shorts would still be
 *        positioned for TikTok. The renderer clamps the band into the safe
 *        zone at draw time, where it knows which platform it is drawing for.
 * WHERE: buildCaptionTrack; the renderer clamps these in safe-zone.ts.
 */
export const CAPTION_BAND_Y: Readonly<Record<CaptionPosition, number>> = {
  top: 0.18,
  middle: 0.5,
  bottom: 0.78,
};

export interface BuildCaptionTrackOptions {
  /** Overrides the style's own `maxWords`. The gallery's slider writes it. */
  maxWords?: number;
  /** Overrides the style's own band. */
  position?: CaptionPosition;
  /** For a second lane — a translation. Defaults to the primary track. */
  trackId?: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildCaptionTrack, RESTYLING_IS_FREE
 *
 * WHAT:  The caption track for these words in this style.
 * WHY:   An UNKNOWN style id falls back to the library's default rather than
 *        throwing, for the same reason the render registry draws nothing for
 *        an unknown kind: a document written by a newer release naming a
 *        style this build has never heard of must still produce captions.
 *        Losing the look is recoverable; losing the captions is not.
 *
 *        `start` and `duration` are deliberately NOT written here even though
 *        the schema allows them. They are a CACHE of a derived value, written
 *        by `resolveWordAnchors` at resolve time, and `validate()` refuses
 *        them when they disagree with the word range — so writing them here,
 *        a step before the words may be re-aligned, is how a document ends up
 *        self-contradictory.
 * WHERE: See the file header.
 */
export function buildCaptionTrack(
  words: readonly WordToken[],
  styleId: string,
  options: BuildCaptionTrackOptions = {},
): CaptionTrack {
  const style = getCaptionStyle(styleId);
  const maxWords = options.maxWords ?? style.maxWords;
  const band = options.position ?? style.position;
  const y = CAPTION_BAND_Y[band];

  const items: CaptionItem[] = groupWords(words, maxWords).map(
    (chunk, index) => ({
      id: `${CAPTION_TRACK_ID}-${index}`,
      /* A label is what the editor's track list shows. The first word is the
       * only thing that makes one caption recognisable from another in a list
       * of sixty, and it costs nothing — it is NOT the caption's text and is
       * never drawn (WORD_RANGE_NOT_TEXT). */
      label: labelFor(words, chunk.startWord),
      startWord: chunk.startWord,
      endWord: chunk.endWord,
      position: { y },
    }),
  );

  return {
    id: options.trackId ?? CAPTION_TRACK_ID,
    type: "caption",
    label: "Captions",
    styleId: style.id,
    items,
  };
}

function labelFor(words: readonly WordToken[], index: number): string {
  const word = words[index]?.w ?? "Caption";
  /* labelSchema caps a label; a single word is well inside it, but a
   * transcript can contain a pathological token and a label is not worth a
   * validation failure. */
  return word.slice(0, 40);
}
