/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: condenseThread, estimateThreadSeconds,
 *   SCHEMA_IS_THE_CONTRACT, PACING_WARNS_NEVER_TRUNCATES,
 *   DURATION_BEFORE_GENERATION, SPEAKER_COMES_FROM_THE_MODEL
 *
 * WHAT:  Turning a fetched thread into speaker-split narration blocks, and
 *        estimating how long a thread will take to say before anything is
 *        generated.
 *
 * WHY:   A thin layer, exactly like ./generate.ts. The security is in
 *        ./reddit-prompt.ts (the fence, the role labels, the restated
 *        boundary) and in `redditDraftSchema` (the shape the model is
 *        constrained to); the retry is the adapter's. What is left here is
 *        which prompt and which schema, plus the pacing arithmetic — and
 *        keeping it thin is what lets the parts that can actually be wrong be
 *        tested with no model.
 *
 *        SPEAKER_COMES_FROM_THE_MODEL, and that is the one genuinely new thing
 *        about this path. A voiceover script has no cast; a thread does, and
 *        only something that has read the thread can tell which sentence is the
 *        poster's and which is a reply. The model therefore chooses from a
 *        CLOSED enum of three roles, so what reaches the `Speaker` rows is
 *        always one of three literals — a free-text speaker field would let a
 *        thread name its own cast members, which is both an injection surface
 *        and a cast nobody can assign voices to.
 *
 *        DURATION_BEFORE_GENERATION is the phase's step 5, and
 *        `estimateThreadSeconds` is how it is answered for FREE. The customer
 *        must see the final duration and the over-limit warning before a
 *        generation starts, and that needs no model: it is the same
 *        `estimateSpokenSeconds` the script uses, applied to the thread's own
 *        words. It over-estimates slightly — a condensation cuts text, never
 *        adds it — which is the right direction for a warning.
 *
 *        PACING_WARNS_NEVER_TRUNCATES, inherited: nothing is cut here either.
 *        The model is given a word budget and the result carries its measured
 *        duration and an over-limit flag.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter which holds the API
 *        key. The estimator is re-exported from the pure pacing helpers, so the
 *        preview can show the same number without importing any of this.
 * WHERE: src/lib/script/writers.ts (the `reddit-story` writer) and
 *        src/trpc/routers/reddit.ts (the preview's estimate).
 */

import "server-only";

import { getLlmAdapter } from "@/lib/adapters/llm";
import type { RedditThread } from "@/lib/adapters/reddit/types";
import {
  SCRIPT_WARN_SECONDS,
  WORDS_PER_SECOND,
  estimateSpokenSeconds,
} from "@/lib/types/script";
import { redditDraftSchema } from "@/lib/types/reddit";
import { condenseSystemPrompt, condenseUserPrompt, flattenThread } from "./reddit-prompt";
import type { WrittenScript } from "./writers";

/**
 * SOURCE OF TRUTH KEYWORDS: condenseThread, SCHEMA_IS_THE_CONTRACT
 *
 * WHAT:  A thread as an ordered, speaker-tagged script.
 * WHY:   Returns the SAME `WrittenScript` shape the voiceover writer returns,
 *        with `speakerTag` filled in — which is what lets one workflow serve
 *        both formats (ONE_WORKFLOW_MANY_WRITERS in ./writers.ts). The blocks
 *        come back already validated against `redditDraftSchema`, so there is
 *        no branch in this file that inspects raw model output.
 * WHERE: SCRIPT_WRITERS['reddit-story'].
 */
export async function condenseThread(input: {
  /** The thread as prose — flattened, or pasted by the customer. */
  threadText: string;
  /** The thread's own title, or the pasted text's if it had one. */
  title: string;
  targetSeconds: number;
  condense: boolean;
}): Promise<WrittenScript> {
  const llm = await getLlmAdapter();

  const draft = await llm.generate({
    /* Takes no arguments — see UNTRUSTED_TEXT_IS_NEVER_SYSTEM. */
    system: condenseSystemPrompt(),
    user: condenseUserPrompt({
      threadText: input.threadText,
      targetSeconds: input.targetSeconds,
      wordsPerSecond: WORDS_PER_SECOND,
      condense: input.condense,
    }),
    schema: redditDraftSchema,
    purpose: "reddit.condense",
  });

  const blocks = draft.blocks.map((block) => ({
    sectionType: block.sectionType,
    narrationText: block.narrationText,
    /* The model's closed-enum role becomes the block's speaker tag, which
     * becomes a `Speaker` row the customer casts a voice to. */
    speakerTag: block.speaker,
  }));

  const blockSeconds = blocks.map((block) =>
    estimateSpokenSeconds(block.narrationText),
  );
  const estimatedSeconds =
    Math.round(
      blockSeconds.reduce((total, seconds) => total + seconds, 0) * 100,
    ) / 100;

  return {
    /* The THREAD's own title, not the model's invention of one: a Reddit video
     * is about a specific post and the card on screen shows that title, so a
     * second, different title in the project name would be confusing. The
     * model is asked for one anyway (the schema requires it) and it is ignored
     * here — asking for nothing would mean a second schema. On the pasted-text
     * path the caller supplies whatever title it has, which may be the
     * project's own. */
    title: input.title,
    blocks,
    blockSeconds,
    estimatedSeconds,
    overLimit: estimatedSeconds > SCRIPT_WARN_SECONDS,
    warnAtSeconds: SCRIPT_WARN_SECONDS,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: estimateThreadSeconds, DURATION_BEFORE_GENERATION
 *
 * WHAT:  How long this thread would take to narrate, read straight through.
 *
 * WHY:   The number the customer sees BEFORE generating, and it is deliberately
 *        computed from the thread rather than from a model: a model call to
 *        answer "how long will this be" would cost money and still be an
 *        estimate, and the customer needs the answer while they are deciding
 *        whether to spend anything at all.
 *
 *        It measures the FLATTENED thread — the same text the model is given —
 *        so the estimate and the input agree. It therefore over-estimates when
 *        condensation is on, which is the safe direction for a warning: being
 *        told "about 90 seconds, that is long" and getting 70 is a pleasant
 *        surprise, and the reverse is a video that silently broke the limit.
 *
 *        PURE apart from its import: no model, no key, no network. It is in
 *        this server-only module rather than in lib/types because it takes a
 *        `RedditThread`, and the preview that calls it has already fetched one.
 * WHERE: `redditStories.preview`.
 */
export function estimateThreadSeconds(thread: RedditThread): {
  estimatedSeconds: number;
  overLimit: boolean;
  warnAtSeconds: number;
  characters: number;
} {
  const text = flattenThread(thread);
  const estimatedSeconds = estimateSpokenSeconds(text);

  return {
    estimatedSeconds,
    overLimit: estimatedSeconds > SCRIPT_WARN_SECONDS,
    warnAtSeconds: SCRIPT_WARN_SECONDS,
    characters: text.length,
  };
}
