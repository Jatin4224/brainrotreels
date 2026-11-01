/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: fallbackScene, THE_PIPELINE_ALWAYS_FINISHES,
 *   A_PLAIN_BEAT_IS_NOT_A_FAILURE, FALLBACK_IS_ALWAYS_VALID
 *
 * WHAT:  The scene a beat gets when the designer could not produce a valid one
 *        — a plain emphasis beat built from the beat's own words.
 *
 * WHY:   THE_PIPELINE_ALWAYS_FINISHES is the phase's step 13 and it is a
 *        business rule before it is a technical one: "a user seeing one plain
 *        beat is a minor disappointment; a stuck job is a support ticket and a
 *        refund". Two bounded design attempts and then this, every time.
 *
 *        A_PLAIN_BEAT_IS_NOT_A_FAILURE. The fallback is not an error card or
 *        an empty frame — it is the beat's narration set as a `kineticText`
 *        line, which is a legitimate motion-graphics beat that happens to be
 *        the simplest one. A viewer cannot tell it apart from a designed
 *        emphasis beat, which is the point: the video is worse by one beat,
 *        not visibly broken.
 *
 *        FALLBACK_IS_ALWAYS_VALID is the property that makes it worth having,
 *        and it is the one thing here that could silently not be true — a
 *        fallback that itself failed `checkScene` would turn a recoverable
 *        design failure into a broken video. So it is built to be trivially
 *        valid (one element, the layout with the loosest slot rule, no graph,
 *        no anchors) and `scene.test.ts` asserts it passes the checks for
 *        every gallery beat's worth of text at both aspects and all four safe
 *        zones. The text is TRUNCATED rather than trusted: a nine-second
 *        stretch of narration would overflow at the kinetic role's floor, and
 *        an overflowing fallback is the exact failure this exists to prevent.
 *
 * WHERE: The repair loop in src/lib/script/motion-beat.ts, after two refused
 *        attempts; the generator, for a beat with no stored scene.
 */

import type { WordToken } from "@/lib/timeline";
import type { LayoutContext, Scene } from "@/lib/types/scene";

import { checkScene } from "./check";

/**
 * SOURCE OF TRUTH KEYWORDS: MAX_FALLBACK_WORDS, FALLBACK_IS_MEASURED_NOT_GUESSED
 *
 * The most words a fallback will ever show, before measurement narrows it
 * further.
 *
 * This started as the whole guarantee — a constant chosen as "roughly what
 * fits" — and the test caught it immediately: twelve short words overflow the
 * kinetic role inside TikTok's insets on a 9:16 frame. A number somebody
 * guessed cannot carry FALLBACK_IS_ALWAYS_VALID, because the thing it has to
 * be true for is every transcript, at every aspect, in every safe zone. So the
 * cap is now only an upper bound on the WORK — the fallback measures itself
 * and drops words until it fits. Grep FALLBACK_IS_MEASURED_NOT_GUESSED.
 */
const MAX_FALLBACK_WORDS = 14;

/**
 * SOURCE OF TRUTH KEYWORDS: fallbackScene, FALLBACK_IS_ALWAYS_VALID
 *
 * WHAT:  A valid `emphasis` scene for a beat.
 * WHY:   `stack-center` because it is the only layout that accepts a single
 *        element (LAYOUT_SLOTS), and `kineticText` because the words arriving
 *        with the narration is what makes a plain beat still feel designed.
 *        The entrance is `rise` and the exit `fade`, the quietest pair — a
 *        fallback should not draw attention to itself.
 *
 *        Timed in SECONDS, not anchored. An anchored fallback would need the
 *        word indices to survive into a document that may be re-aligned, and
 *        the whole reason this beat exists is that something upstream already
 *        went wrong — it should depend on as little as possible.
 * WHERE: See the file header.
 */
export function fallbackScene(args: {
  /** The beat's own words, in order. */
  words: readonly WordToken[];
  /** Used only to build a stable element id. */
  beatIndex: number;
  /**
   * The canvas and safe zone it has to fit. Required, because that is what
   * turns FALLBACK_IS_ALWAYS_VALID from a hope into a measurement — the same
   * text fits a 16:9 frame and overflows a 9:16 one inside TikTok's insets.
   */
  ctx: LayoutContext;
  /** The beat's length, for the timing checks. */
  durationSeconds: number;
}): Scene {
  const { words, beatIndex, ctx, durationSeconds } = args;

  const kept = words.slice(0, MAX_FALLBACK_WORDS).map((word) => word.w);

  /* FALLBACK_IS_MEASURED_NOT_GUESSED. Drop a word at a time until the engine's
   * own checks pass. Bounded by the word count, so it always terminates, and
   * the last candidate is a single bullet — which has no text to overflow and
   * is therefore guaranteed to be the valid one. */
  for (let take = kept.length; take >= 0; take -= 1) {
    const scene = sceneWith({
      beatIndex,
      words: kept.slice(0, take),
      truncated: take < words.length,
    });

    if (checkScene(scene, { ...ctx, wordCount: 0, durationSeconds }).ok) {
      return scene;
    }
  }

  /* Unreachable: the `take === 0` pass above is the bullet, which fits any
   * frame this app renders. Constructed rather than asserted, for the reason
   * every other total function in this module gives. */
  return sceneWith({ beatIndex, words: [], truncated: false });
}

function sceneWith(args: {
  beatIndex: number;
  words: readonly string[];
  truncated: boolean;
}): Scene {
  const { beatIndex, words, truncated } = args;
  const text = words.join(" ").trim();

  return {
    layout: "stack-center",
    elements: [
      {
        id: `beat-${beatIndex}-fallback`,
        kind: "kineticText",
        /* An empty beat is possible — a stretch of narration the aligner gave
         * no words for — and an empty string fails the schema's `min(1)`. A
         * single bullet is a frame with something deliberate on it rather than
         * a blank one. */
        text: text.length > 0 ? (truncated ? `${text}…` : text) : "•",
        unit: "word",
        in: 0,
        entrance: "rise",
        exit: "fade",
      },
    ],
  };
}
