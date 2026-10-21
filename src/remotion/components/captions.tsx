/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionGroup, CaptionGroupProps, CaptionCard,
 *   CAPTIONS_ARE_A_LAYER, ONE_CAPTION_RENDERER, ACTIVE_WORD, DETERMINISM
 *
 * WHAT:  The render side of a caption: it turns the current frame into a
 *        second and hands the card to the one component that draws captions.
 *
 * WHY:   ONE_CAPTION_RENDERER. The drawing lives in
 *        src/components/global/caption-preview/caption-card.tsx, which the
 *        style gallery mounts as well — so a style looks identical in the
 *        gallery, in the Player and in a cloud render. That is the phase's
 *        last "done when" check, and the only way to hold it is to have one
 *        implementation rather than three that agree today.
 *
 *        This file is therefore ONLY the Remotion adapter: it knows about
 *        frames, and the card does not. Which is also what lets the card be
 *        mounted in a plain React page with no Remotion context at all.
 *
 *        CAPTIONS_ARE_A_LAYER, not a render kind. A caption item carries a
 *        word RANGE rather than a `render` field (WORD_RANGE_NOT_TEXT), so it
 *        is not in RENDER_COMPONENTS — the renderer branches on the TRACK
 *        TYPE for captions exactly as it already does for audio.
 *
 *        ACTIVE_WORD is decided from the ABSOLUTE time — this item's own
 *        `from` frame plus the current frame. Deriving it from the relative
 *        frame would highlight the first word of every card for the same
 *        number of frames regardless of how long it was actually spoken.
 *
 *        DETERMINISM: every value here is a function of the props and the
 *        frame. No clock, no randomness — a cached render and a fresh one
 *        must be the same file.
 * WHERE: Mounted by src/remotion/timeline-renderer.tsx for every planned
 *        caption item, inside that item's own Sequence.
 */

import { useCurrentFrame } from "remotion";

import { CaptionCard } from "@/components/global/caption-preview/caption-card";
import { getCaptionStyle } from "@/lib/captions";
import type { CanvasSpec, WordToken } from "@/lib/timeline";
import type { SafeZone } from "@/lib/types/caption";

export interface CaptionGroupProps {
  /** The item's word range, inclusive at both ends. */
  range: { startWord: number; endWord: number };
  /** The whole document's words — the card reads its own slice. */
  words: readonly WordToken[];
  styleId: string;
  safeZone: SafeZone;
  canvas: CanvasSpec;
  /** This item's position in the composition, for absolute time. */
  frames: { from: number; durationInFrames: number };
  /** The caption item's own band, if it carries one. */
  y?: number | undefined;
}

export function CaptionGroup({
  range,
  words,
  styleId,
  safeZone,
  canvas,
  frames,
  y,
}: CaptionGroupProps) {
  const frame = useCurrentFrame();

  const slice = words.slice(range.startWord, range.endWord + 1);
  if (slice.length === 0) return null;

  return (
    <CaptionCard
      style={getCaptionStyle(styleId)}
      words={slice}
      /* ACTIVE_WORD — absolute seconds, from this item's own start. */
      seconds={(frames.from + frame) / canvas.fps}
      canvas={canvas}
      safeZone={safeZone}
      y={y}
    />
  );
}
