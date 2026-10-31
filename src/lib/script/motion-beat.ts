/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: designBeat, DesignedBeat, THE_PIPELINE_ALWAYS_FINISHES,
 *   DETERMINISTIC_CHECKS_FIRST, REPAIR_IS_BOUNDED, DESIGN_ONE_BEAT_ONLY
 *
 * WHAT:  Designs one beat: ask the model for a scene, check it with code, and
 *        on failure re-ask once with the errors — then fall back to a plain
 *        emphasis beat rather than failing.
 *
 * WHY:   THE_PIPELINE_ALWAYS_FINISHES is the phase's step 13 and this function
 *        is where it is true or not. It CANNOT THROW for a design failure:
 *        every path returns a scene, and the worst one is the fallback. "A
 *        user seeing one plain beat is a minor disappointment; a stuck job is
 *        a support ticket and a refund" — so a model that refuses, returns
 *        nonsense twice, or times out still yields a beat.
 *
 *        It CAN throw for a transport failure the caller should retry — a rate
 *        limit, a 5xx. That distinction is `LlmError.permanent`, and it
 *        matters: swallowing a rate limit into a fallback would quietly turn a
 *        retryable blip into a video full of plain beats.
 *
 *        DETERMINISTIC_CHECKS_FIRST, step 12. `checkScene` runs on every
 *        attempt before anything else happens — it is free, it runs in a
 *        millisecond, and it returns a fact with a path attached. The vision
 *        pass the phase describes comes AFTER this, on beats that are already
 *        geometrically correct, because a model asked to review a frame with
 *        text off the edge will report that and nothing else.
 *
 *        REPAIR_IS_BOUNDED at two attempts, the same bound the quiz writer
 *        takes and for the same reason: a second failure is usually the model
 *        being asked the wrong question rather than having a bad moment, and
 *        every attempt is billed. The phase file says "at most two attempts,
 *        then fall back".
 *
 *        DESIGN_ONE_BEAT_ONLY. The unit is one beat, which is what makes
 *        Phase 16d's "redesigning one beat leaves the others byte-identical"
 *        possible: there is no call that produces several scenes, so there is
 *        nothing to re-run when one beat changes. The Inngest fan-out calls
 *        this once per beat.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter. Everything it
 *        decides with — the scene language, the checks, the fallback, the
 *        prompt — is pure and lives elsewhere, so all of it is testable with
 *        no key and no spend.
 * WHERE: The motion design step (the Inngest fan-out), and `redesignBeat`.
 */

import "server-only";

import { getLlmAdapter, LlmError } from "@/lib/adapters/llm";
import { checkScene, fallbackScene } from "@/lib/scene";
import type { WordToken } from "@/lib/timeline";
import type { MotionStyle } from "@/lib/types/motion-style";
import {
  sceneSchema,
  type Beat,
  type LayoutContext,
  type Scene,
  type SceneError,
} from "@/lib/types/scene";

import {
  beatDesignSystemPrompt,
  beatDesignUserPrompt,
} from "./motion-beat-prompt";

/**
 * SOURCE OF TRUTH KEYWORDS: DesignedBeat, A_FALLBACK_IS_RECORDED
 *
 * WHAT:  One designed beat, and how it got there.
 *
 * WHY:   `source` is carried rather than inferred, because the beat strip has
 *        to show it: a customer looking at a plain beat should be able to see
 *        that it IS the fallback and press "redesign" rather than assume that
 *        is what the model thought best. `attempts` and `errors` are kept for
 *        the same reason the LLM adapter keeps `purpose` — when quality is
 *        poor in production the first question is how often the repair is
 *        firing, and a number answers it.
 * WHERE: Stored in `Project.settings` by the design step; read by the beat
 *        strip and the generator.
 */
export interface DesignedBeat {
  beat: Beat;
  scene: Scene;
  source: "designed" | "repaired" | "fallback";
  attempts: number;
  /** The errors from the last refused attempt, empty when none was refused. */
  errors: SceneError[];
}

/* The phase file's bound: "at most two attempts, then fall back". */
const MAX_ATTEMPTS = 2;

/**
 * SOURCE OF TRUTH KEYWORDS: designBeat, THE_PIPELINE_ALWAYS_FINISHES,
 *   REPAIR_IS_BOUNDED
 *
 * WHAT:  A scene for one beat. Always.
 * WHERE: See the file header.
 */
export async function designBeat(args: {
  beat: Beat;
  /** The whole transcript — the beat's own slice is taken here. */
  words: readonly WordToken[];
  style: MotionStyle;
  aspect: string;
  ctx: LayoutContext;
  durationSeconds: number;
}): Promise<DesignedBeat> {
  const { beat, words, style, aspect, ctx, durationSeconds } = args;

  const slice = words.slice(beat.startWord, beat.endWord + 1);
  const adapter = await getLlmAdapter();
  const system = beatDesignSystemPrompt({ style, aspect });

  /* The check context is the same one the editor and the gallery use, so a
   * beat that passes here passes everywhere. `wordCount` is the WHOLE
   * transcript's, because an anchor names an absolute index. */
  const checkContext = {
    ...ctx,
    wordCount: words.length,
    durationSeconds,
  };

  let errors: SceneError[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let scene: Scene;
    try {
      scene = await adapter.generate<Scene>({
        system,
        user: beatDesignUserPrompt({
          beat,
          words: slice,
          durationSeconds,
          errors,
        }),
        schema: sceneSchema,
        purpose: "motion.designBeat",
      });
    } catch (error) {
      /* A TRANSPORT failure is the caller's to retry — swallowing a rate limit
       * into a fallback would turn a retryable blip into a video full of plain
       * beats. A PERMANENT failure (a refusal, or output that failed the schema
       * twice inside the adapter) is a design failure like any other and takes
       * the fallback. */
      if (error instanceof LlmError && !error.permanent) throw error;

      console.warn(
        `[script/motion-beat] Beat ${beat.index} attempt ${attempt} failed: ` +
          (error instanceof LlmError ? error.detail : String(error)),
      );
      break;
    }

    /* DETERMINISTIC_CHECKS_FIRST — free, fast, and specific. */
    const result = checkScene(scene, checkContext);
    if (result.ok) {
      return {
        beat,
        scene,
        source: attempt === 1 ? "designed" : "repaired",
        attempts: attempt,
        errors: [],
      };
    }

    errors = result.errors;
    console.warn(
      `[script/motion-beat] Beat ${beat.index} attempt ${attempt} refused: ` +
        errors.map((e) => `${e.path} ${e.code}`).join(", "),
    );
  }

  return {
    beat,
    scene: fallbackScene({
      words: slice,
      beatIndex: beat.index,
      ctx,
      durationSeconds,
    }),
    source: "fallback",
    attempts: MAX_ATTEMPTS,
    errors,
  };
}
