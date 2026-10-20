/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: generateScript, regenerateScriptBlock,
 *   GeneratedScript, SCHEMA_IS_THE_CONTRACT, PACING_WARNS_NEVER_TRUNCATES,
 *   MODERATION_STUB, CONTEXT_IN_ONLY_ONE_OUT
 *
 * WHAT:  The two generation calls: write a whole script, and rewrite one block.
 *
 * WHY:   A thin layer on purpose. The security lives in `prompt.ts` (the
 *        untrusted-text fence) and in `types/script.ts` (the schema the model
 *        is constrained to); the retry lives in the adapter. What is left here
 *        is the decision of WHICH prompt and WHICH schema, plus the pacing
 *        arithmetic — and keeping it that thin is what lets the interesting
 *        parts be tested without a model.
 *
 *        PACING_WARNS_NEVER_TRUNCATES, the phase's step 7. The estimated
 *        duration comes back with the script and a flag saying whether it is
 *        over the limit. Nothing is cut. A script trimmed to fit loses the
 *        customer's payoff — always at the END, where they will not notice
 *        until the video is made — and the model was already given the word
 *        budget, so an over-length result is a judgement call that belongs to
 *        the person who asked for it.
 *
 *        MODERATION_STUB: Phase 10 owns moderation. There is no call here and
 *        no `approved` flag written anywhere, for the same reason the ingest
 *        workflow writes `skipped` rather than `approved` — a stub that
 *        claimed something had been checked is a claim every later phase would
 *        be entitled to believe.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter which holds the API
 *        key. The pacing helpers it uses are pure and live in types/script.ts,
 *        so the UI can show the same numbers without importing any of this.
 * WHERE: src/trpc/routers/scripts.ts.
 */

import "server-only";

import { getLlmAdapter } from "@/lib/adapters/llm";
import {
  SCRIPT_WARN_SECONDS,
  WORDS_PER_SECOND,
  blockRewriteSchema,
  countSpokenWords,
  estimateSpokenSeconds,
  scriptDraftSchema,
  type ScriptBlockDraft,
  type ScriptTone,
  type SectionType,
} from "@/lib/types/script";
import {
  regenerateBlockPrompt,
  scriptSystemPrompt,
  scriptUserPrompt,
} from "./prompt";

/**
 * SOURCE OF TRUTH KEYWORDS: GeneratedScript, PACING_WARNS_NEVER_TRUNCATES
 *
 * WHAT:  A finished draft, with the pacing verdict attached.
 * WHY:   `estimatedSeconds` and `overLimit` travel WITH the blocks rather than
 *        being recomputed by each consumer. The warning the customer sees, the
 *        number stored on each row and the figure the credit estimate used
 *        must be the same arithmetic over the same text — three
 *        recomputations are three chances to disagree, and the one that
 *        disagrees is always the one in front of the customer.
 * WHERE: Returned by generateScript; consumed by the scripts router.
 */
export interface GeneratedScript {
  title: string;
  blocks: ScriptBlockDraft[];
  /** Per-block seconds, index-aligned with `blocks`. */
  blockSeconds: number[];
  estimatedSeconds: number;
  overLimit: boolean;
  warnAtSeconds: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: generateScript, SCHEMA_IS_THE_CONTRACT
 *
 * WHAT:  Turns source text into an ordered, typed script.
 * WHY:   The schema passed to the adapter is `scriptDraftSchema`, so what
 *        comes back is already the right shape or the call threw — there is no
 *        branch here that inspects raw model output, which is the property
 *        "malformed model output never reaches the database" depends on.
 *
 *        The source text is wrapped by `scriptUserPrompt`, never concatenated
 *        into the system prompt. Grep UNTRUSTED_TEXT_IS_NEVER_SYSTEM before
 *        changing how these two arguments are built.
 * WHERE: The `scripts.generate` handler.
 */
export async function generateScript(input: {
  sourceText: string;
  targetSeconds: number;
  tone: ScriptTone;
  title?: string | undefined;
}): Promise<GeneratedScript> {
  const llm = await getLlmAdapter();

  const draft = await llm.generate({
    system: scriptSystemPrompt(),
    user: scriptUserPrompt({
      sourceText: input.sourceText,
      targetSeconds: input.targetSeconds,
      tone: input.tone,
      wordsPerSecond: WORDS_PER_SECOND,
      title: input.title,
    }),
    schema: scriptDraftSchema,
    purpose: "script.generate",
  });

  return withPacing(draft.title, draft.blocks);
}

/**
 * SOURCE OF TRUTH KEYWORDS: regenerateScriptBlock, CONTEXT_IN_ONLY_ONE_OUT
 *
 * WHAT:  Rewrites one block, given its neighbours for context.
 * WHY:   CONTEXT_IN_ONLY_ONE_OUT — the phase's step 8. The surrounding blocks
 *        go IN so the rewrite still fits (a hook rewritten blind introduces
 *        something the body never pays off), and `blockRewriteSchema` is
 *        deliberately a single-field object so the model CANNOT return a
 *        second block. The caller persists exactly one row; every other block
 *        is untouched and therefore byte-identical.
 *
 *        The target word count is derived from the block being replaced, so a
 *        rewrite keeps the script's shape — a three-second beat does not come
 *        back as a twelve-second one and silently push the video over its
 *        limit.
 * WHERE: The `scripts.regenerateBlock` handler.
 */
export async function regenerateScriptBlock(input: {
  sectionType: SectionType;
  currentText: string;
  before: readonly string[];
  after: readonly string[];
  tone: ScriptTone;
  instruction?: string | undefined;
}): Promise<{ narrationText: string; estimatedSeconds: number }> {
  const llm = await getLlmAdapter();

  /* A floor, because a very short block ("Wait.") would otherwise ask for
   * about one word and get something unusable back. */
  const targetWords = Math.max(8, countSpokenWords(input.currentText));

  const rewrite = await llm.generate({
    system: scriptSystemPrompt(),
    user: regenerateBlockPrompt({
      sectionType: input.sectionType,
      currentText: input.currentText,
      before: input.before,
      after: input.after,
      tone: input.tone,
      targetWords,
      instruction: input.instruction,
    }),
    schema: blockRewriteSchema,
    purpose: "script.regenerateBlock",
  });

  return {
    narrationText: rewrite.narrationText,
    estimatedSeconds: estimateSpokenSeconds(rewrite.narrationText),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: withPacing, PACING_WARNS_NEVER_TRUNCATES
 *
 * WHAT:  Attaches per-block and total durations, and the over-limit verdict.
 * WHY:   One place, so the total is provably the sum of the parts. Summing the
 *        per-block numbers rather than estimating the joined text also means
 *        the row values and the total cannot disagree by a rounding step —
 *        which they would if each were computed from a different string.
 * WHERE: generateScript.
 */
function withPacing(
  title: string,
  blocks: ScriptBlockDraft[],
): GeneratedScript {
  const blockSeconds = blocks.map((block) =>
    estimateSpokenSeconds(block.narrationText),
  );
  const estimatedSeconds =
    Math.round(
      blockSeconds.reduce((total, seconds) => total + seconds, 0) * 100,
    ) / 100;

  return {
    title,
    blocks,
    blockSeconds,
    estimatedSeconds,
    overLimit: estimatedSeconds > SCRIPT_WARN_SECONDS,
    warnAtSeconds: SCRIPT_WARN_SECONDS,
  };
}
