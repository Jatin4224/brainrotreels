/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: labelBeatIntents, ONE_CALL_FOR_THE_WHOLE_VIDEO,
 *   INTENT_HAS_A_FREE_DEFAULT, THE_PIPELINE_ALWAYS_FINISHES,
 *   AN_UNKNOWN_INDEX_IS_DROPPED, NO_BEATS_NO_REQUEST
 *
 * WHAT:  Asks a model what each beat of one video is about, and returns the
 *        answer as the sparse map `assignIntents` takes.
 *
 * WHY:   This is the step that makes the primitive library reachable. The
 *        storyboard hands every beat the free default `emphasis`
 *        (INTENT_HAS_A_FREE_DEFAULT), and a designer told "this beat is
 *        emphasis" writes a text block — so without this call nine of the ten
 *        primitives are built, tested, drawable and never chosen. The scene
 *        language, the layout engine and the checks all work; the video just
 *        looks like one thing.
 *
 *        ONE_CALL_FOR_THE_WHOLE_VIDEO. One request labels every beat, which is
 *        both the cheap shape and the accurate one — see the reasoning on
 *        `beatIntentPlanSchema`. For a forty-beat video that is one request
 *        added to forty, so this step raises the cost of the design stage by
 *        about two and a half per cent.
 *
 *        THE_PIPELINE_ALWAYS_FINISHES, as everywhere else in 16d. A design
 *        failure here CANNOT throw: a refusal, nonsense, or output that failed
 *        the schema twice returns an EMPTY MAP, every beat keeps its default,
 *        and the video is designed exactly as it would have been before this
 *        function existed. That is the whole point of making the intent a
 *        separate call from the design — the degraded mode is the previous
 *        release's behaviour rather than a broken video. A TRANSPORT failure
 *        still throws, because a rate limit swallowed into an empty map would
 *        turn a retryable blip into a video of plain beats.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter. The prompt it uses
 *        and the function that applies its answer are both pure and live
 *        elsewhere, so the judgement in this step is testable with no key and
 *        no spend.
 * WHERE: The `beat-intents` step of src/inngest/functions/project-generate.ts,
 *        between the storyboard and the per-beat design.
 */

import "server-only";

import { getLlmAdapter, LlmError } from "@/lib/adapters/llm";
import type { WordToken } from "@/lib/timeline";
import {
  beatIntentPlanSchema,
  type Beat,
  type BeatIntent,
  type BeatIntentPlan,
} from "@/lib/types/scene";

import {
  beatIntentsSystemPrompt,
  beatIntentsUserPrompt,
} from "./motion-intents-prompt";

/**
 * SOURCE OF TRUTH KEYWORDS: labelBeatIntents, AN_UNKNOWN_INDEX_IS_DROPPED,
 *   NO_BEATS_NO_REQUEST
 *
 * WHAT:  An intent per beat the model was confident about. Never throws for a
 *        bad answer; throws only for a failure worth retrying.
 *
 * WHY:   NO_BEATS_NO_REQUEST — a silent project has no beats, and asking a
 *        model to label nothing is a billed request for an empty object.
 *
 *        AN_UNKNOWN_INDEX_IS_DROPPED. A model that answers for beat 99 of a
 *        twelve-beat video is ignored rather than trusted. `assignIntents`
 *        would ignore it anyway — it walks the beats and looks each one up —
 *        but dropping it HERE is what makes the returned map honest enough to
 *        store and to log a count from.
 * WHERE: See the file header.
 */
export async function labelBeatIntents(args: {
  beats: readonly Beat[];
  /** The whole transcript; each beat's slice is taken in the prompt. */
  words: readonly WordToken[];
  /** Seconds per beat, by beat index. */
  secondsByIndex: Readonly<Record<number, number>>;
}): Promise<Record<number, BeatIntent>> {
  const { beats, words, secondsByIndex } = args;

  if (beats.length === 0) return {};

  const adapter = await getLlmAdapter();

  let plan: BeatIntentPlan;
  try {
    plan = await adapter.generate<BeatIntentPlan>({
      system: beatIntentsSystemPrompt(),
      user: beatIntentsUserPrompt({ beats, words, secondsByIndex }),
      schema: beatIntentPlanSchema,
      purpose: "motion.labelBeatIntents",
    });
  } catch (error) {
    /* A transport failure is the caller's to retry — see the file header. */
    if (error instanceof LlmError && !error.permanent) throw error;

    console.warn(
      "[script/motion-intents] Labelling failed; every beat keeps its " +
        "default intent: " +
        (error instanceof LlmError ? error.detail : String(error)),
    );
    return {};
  }

  const known = new Set(beats.map((beat) => beat.index));
  const intents: Record<number, BeatIntent> = {};
  let unknown = 0;

  for (const entry of plan.beats) {
    if (!known.has(entry.index)) {
      unknown += 1;
      continue;
    }
    intents[entry.index] = entry.intent;
  }

  if (unknown > 0) {
    console.warn(
      `[script/motion-intents] Dropped ${unknown} label(s) naming a beat ` +
        `this storyboard does not have.`,
    );
  }

  return intents;
}
