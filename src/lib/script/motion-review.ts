/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: reviewBeats, ReviewableBeat, BeatReviewOutcome,
 *   DETERMINISTIC_CHECKS_FIRST, SAMPLED_NOT_EXHAUSTIVE, REVIEW_NEVER_THROWS,
 *   THE_BUSIEST_FRAMES_ARE_THE_RISK, VISION_CATCHES_WHAT_GEOMETRY_CANNOT
 *
 * WHAT:  The phase's step 12, second half: render two or three stills of an
 *        already-designed video and ask a vision model what is wrong with
 *        them.
 *
 * WHY:   DETERMINISTIC_CHECKS_FIRST, and the ordering is the economics of the
 *        whole phase. `checkScene` costs a millisecond and runs on every
 *        attempt of every beat; this costs a Lambda invocation per still plus
 *        a vision request, and runs ONCE per video on a sample. The phase file
 *        says it plainly: "deterministic checks are free and catch most of it;
 *        the vision pass is expensive and catches what geometry cannot".
 *
 *        SAMPLED_NOT_EXHAUSTIVE. Two or three beats, not all forty, which is
 *        what the phase asks for and is also the only affordable shape: a
 *        still per beat would multiply the cost of the design stage and make
 *        the review slower than the thing it reviews. A sample cannot promise
 *        every bad frame is caught — and it is not trying to. It is a smoke
 *        test on the DESIGNER: if the busiest three frames of a video are
 *        clean, the style, the layout engine and the prompt are working, and
 *        if they are a mess, that is worth knowing before a customer finds out.
 *
 *        THE_BUSIEST_FRAMES_ARE_THE_RISK is how the sample is chosen. The
 *        failure this pass exists to find is a frame with too much happening,
 *        so the beats with the most elements are the ones worth the money.
 *        Fallback beats are excluded outright: a fallback is one measured line
 *        of text, there is nothing for a model to find, and the strip already
 *        badges it.
 *
 *        REVIEW_NEVER_THROWS — not even for a transport failure, which is a
 *        deliberate departure from `designBeat` and `labelBeatIntents`. Those
 *        rethrow a rate limit so the caller can retry, because their output is
 *        the product. This function's output is ADVICE, and by the time the
 *        model is called the stills have already been rendered and paid for —
 *        so a retry re-renders them to recover a badge. Returning what it has
 *        is cheaper than being right.
 *
 *        SERVER-ONLY: it reaches both the render adapter and the LLM adapter.
 *        The document it renders and the prompt it sends are both built by
 *        pure code elsewhere, so everything except the two network calls is
 *        testable with no key and no spend.
 * WHERE: The `review-beats` step of src/inngest/functions/project-generate.ts.
 */

import "server-only";

import { getLlmAdapter, LlmError, type LlmImage } from "@/lib/adapters/llm";
import { getRenderAdapter, isRenderConfigured } from "@/lib/adapters/render";
import { buildStillDocument, stillFrameFor } from "@/lib/scene";
import type { CanvasSpec } from "@/lib/timeline";
import type { MotionStyle } from "@/lib/types/motion-style";
import type { SafeZone } from "@/lib/types/caption";
import {
  beatReviewPlanSchema,
  type BeatReviewPlan,
  type Scene,
  type SceneDesignSource,
  type SceneReview,
} from "@/lib/types/scene";

import {
  beatReviewSystemPrompt,
  beatReviewUserPrompt,
} from "./motion-review-prompt";

/* The phase file's "2–3 stills". Three, because the third costs about as much
 * as a tenth of a cent and a sample of two is one bad frame away from
 * looking like a disaster. */
const MAX_REVIEWED = 3;

/**
 * Half the composition's own size. Enough to judge whether a headline is
 * legible on a phone, and a quarter of the pixels a vision model is billed
 * for — see the note on `StillOptions.scale`.
 */
const STILL_SCALE = 0.5;

/** A still this large is a bug, not a frame. Dropped rather than sent. */
const MAX_STILL_BYTES = 4_000_000;

/** A still render that has not answered by now is not going to. */
const STILL_TIMEOUT_MS = 30_000;

export interface ReviewableBeat {
  index: number;
  scene: Scene;
  /** The words this beat covers — what the graphic is supposed to be about. */
  text: string;
  durationSeconds: number;
  source: SceneDesignSource;
}

/**
 * SOURCE OF TRUTH KEYWORDS: BeatReviewOutcome, REVIEW_NEVER_THROWS
 *
 * WHAT:  The findings, and why there were not more of them.
 * WHY:   `skipped` is a REASON rather than a boolean because the three cases
 *        read completely differently to an operator: a deployment with no
 *        renderer configured is expected and permanent, a video whose beats
 *        are all fallbacks has nothing worth looking at, and a model or a
 *        render that failed is a thing to go and look at. A boolean would
 *        collapse "working as designed" into "broken".
 */
export interface BeatReviewOutcome {
  /** By beat index. Sparse by design — only the sample is reviewed. */
  reviews: Record<number, SceneReview>;
  /** How many stills were rendered and sent. */
  stills: number;
  skipped: "no-renderer" | "nothing-to-review" | "unavailable" | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: reviewBeats, SAMPLED_NOT_EXHAUSTIVE,
 *   REVIEW_NEVER_THROWS
 *
 * WHAT:  Verdicts for a sample of a video's beats. Never throws.
 * WHERE: See the file header.
 */
export async function reviewBeats(args: {
  beats: readonly ReviewableBeat[];
  canvas: CanvasSpec;
  style: MotionStyle;
  safeZone: SafeZone;
}): Promise<BeatReviewOutcome> {
  const { beats, canvas, style, safeZone } = args;

  const sample = pickBeatsToReview(beats);
  if (sample.length === 0) {
    return { reviews: {}, stills: 0, skipped: "nothing-to-review" };
  }

  /* ASK_BEFORE_YOU_SPEND — checked before any document is built, so a
   * deployment with no AWS says so instead of failing inside a render. */
  if (!(await isRenderConfigured())) {
    return { reviews: {}, stills: 0, skipped: "no-renderer" };
  }

  const stills: {
    beatIndex: number;
    text: string;
    durationSeconds: number;
    image: LlmImage;
  }[] = [];

  for (const beat of sample) {
    const image = await renderOneStill({ beat, canvas, style, safeZone });
    if (image === null) continue;
    stills.push({
      beatIndex: beat.index,
      text: beat.text,
      durationSeconds: beat.durationSeconds,
      image,
    });
  }

  if (stills.length === 0) {
    /* Every still failed. The stage still completes — a video nobody could
     * photograph is not a video nobody can watch. */
    return { reviews: {}, stills: 0, skipped: "unavailable" };
  }

  let plan: BeatReviewPlan;
  try {
    const adapter = await getLlmAdapter();
    plan = await adapter.generate<BeatReviewPlan>({
      system: beatReviewSystemPrompt(),
      user: beatReviewUserPrompt({
        stills: stills.map((still) => ({
          beatIndex: still.beatIndex,
          text: still.text,
          durationSeconds: still.durationSeconds,
        })),
      }),
      images: stills.map((still) => still.image),
      schema: beatReviewPlanSchema,
      purpose: "motion.reviewBeats",
    });
  } catch (error) {
    /* REVIEW_NEVER_THROWS, including for a rate limit — see the file header. */
    console.warn(
      "[script/motion-review] The review request failed; the video keeps " +
        "its design and no findings are stored: " +
        (error instanceof LlmError ? error.detail : String(error)),
    );
    return { reviews: {}, stills: stills.length, skipped: "unavailable" };
  }

  const shown = new Set(stills.map((still) => still.beatIndex));
  const reviews: Record<number, SceneReview> = {};

  for (const entry of plan.beats) {
    /* A verdict about a beat we did not show is a hallucination about a frame
     * that was never rendered, and storing one would badge a good beat. */
    if (!shown.has(entry.index)) {
      console.warn(
        `[script/motion-review] Dropped a verdict for beat ${entry.index}, ` +
          `which was not among the stills sent.`,
      );
      continue;
    }
    reviews[entry.index] = { verdict: entry.verdict, note: entry.note };
  }

  return { reviews, stills: stills.length, skipped: null };
}

/**
 * SOURCE OF TRUTH KEYWORDS: pickBeatsToReview, THE_BUSIEST_FRAMES_ARE_THE_RISK,
 *   SAMPLED_NOT_EXHAUSTIVE
 *
 * WHAT:  The two or three beats worth photographing.
 *
 * WHY:   Sorted by ELEMENT COUNT, descending. The verdicts this pass can
 *        return are clutter, cut-off text and off-topic content, and the first
 *        two get likelier with every element on screen — so the busiest frames
 *        are where the money buys the most information. Ties break on the
 *        index so the choice is deterministic, which matters for being able to
 *        reproduce a finding.
 *
 *        Fallbacks are excluded, not deprioritised: a fallback is one measured
 *        line of narration, it cannot be cluttered or cut off, it is on-topic
 *        by construction, and the strip already shows what it is. Paying to be
 *        told a plain beat is plain is the one certain waste here.
 *
 *        Exported because it decides what a video's review costs and what it
 *        covers, which is worth a test of its own — the rest of this module is
 *        two network calls around it.
 * WHERE: reviewBeats, and motion-review-prompt.test.ts.
 */
export function pickBeatsToReview(
  beats: readonly ReviewableBeat[],
): ReviewableBeat[] {
  return [...beats]
    .filter((beat) => beat.source !== "fallback")
    .sort((a, b) => {
      const byElements = b.scene.elements.length - a.scene.elements.length;
      return byElements !== 0 ? byElements : a.index - b.index;
    })
    .slice(0, MAX_REVIEWED);
}

/**
 * SOURCE OF TRUTH KEYWORDS: renderOneStill, A_STILL_DOCUMENT_IS_THE_GRAPHIC_ALONE,
 *   REVIEW_NEVER_THROWS
 *
 * WHAT:  One beat as base64 image bytes, or null when it could not be had.
 * WHY:   Returns NULL rather than throwing, so one beat that will not render
 *        costs its own still and not the whole review. A render failure here
 *        says nothing about the video: the same document renders in the real
 *        render, which is the one that matters.
 * WHERE: reviewBeats.
 */
async function renderOneStill(args: {
  beat: ReviewableBeat;
  canvas: CanvasSpec;
  style: MotionStyle;
  safeZone: SafeZone;
}): Promise<LlmImage | null> {
  const { beat, canvas, style, safeZone } = args;

  try {
    const adapter = await getRenderAdapter();

    const doc = buildStillDocument({
      scene: beat.scene,
      canvas,
      paletteId: style.paletteId,
      captionStyleId: style.captionTreatment,
      motionStyleId: style.id,
      safeZone,
      durationSeconds: beat.durationSeconds,
    });

    const still = await adapter.renderStill(doc, {
      /* NO_ASSETS_NO_AUDIO — this document names none, by construction. */
      assets: {},
      frame: stillFrameFor({
        durationSeconds: beat.durationSeconds,
        fps: canvas.fps,
      }),
      scale: STILL_SCALE,
    });

    const response = await fetch(still.url, {
      signal: AbortSignal.timeout(STILL_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(
        `[script/motion-review] Beat ${beat.index}: the still was rendered ` +
          `but could not be read (${response.status}).`,
      );
      return null;
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_STILL_BYTES) {
      console.warn(
        `[script/motion-review] Beat ${beat.index}: the still is ` +
          `${bytes.byteLength} bytes, which is too large to send.`,
      );
      return null;
    }

    return {
      data: Buffer.from(bytes).toString("base64"),
      mediaType: still.mediaType,
    };
  } catch (error) {
    console.warn(
      `[script/motion-review] Beat ${beat.index}: could not be photographed: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}
