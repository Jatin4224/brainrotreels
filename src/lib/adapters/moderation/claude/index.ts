/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: claudeModerationAdapter, classify,
 *   REUSES_THE_LLM_SEAM, THIS_SEAM_FAILS_CLOSED, TRUNCATE_NOT_REFUSE,
 *   EMPTY_TEXT_IS_APPROVED, MODERATION_MAX_CHARS
 *
 * WHAT:  The Claude implementation of the moderation contract.
 *
 * WHY:   REUSES_THE_LLM_SEAM. This adapter holds no API key, imports no SDK and
 *        reads no `ANTHROPIC_*` variable: it calls `getLlmAdapter()` and hands
 *        it a Zod schema. That is deliberate and it is the CLAUDE.md rule about
 *        not starting a second pattern applied literally — the LLM seam already
 *        owns the key, the retry-once-on-schema-failure behaviour, the model
 *        choice and the effort level, and a second Anthropic client here would
 *        be a second place to configure, a second place to rate limit and a
 *        second place for the eslint credential fence to have to cover.
 *
 *        It also means the schema IS the boundary. `generate` returns a parsed
 *        `ModerationVerdict` or throws, so there is no code path where this
 *        adapter holds raw model text and decides for itself whether a
 *        classification happened (SCHEMA_IS_THE_CONTRACT in the LLM types).
 *        That matters more here than anywhere else: a classifier that could
 *        return a half-understood string is a classifier an attacker can talk
 *        into ambiguity.
 *
 *        THIS_SEAM_FAILS_CLOSED. Every failure — a missing key, a refusal, a
 *        rate limit, output that would not parse twice — becomes a thrown
 *        `ModerationError`. Nothing in this file can return `approved` because
 *        something went wrong, which is the one property worth protecting:
 *        `src/services/moderation.service.ts` turns the throw into a refusal.
 *
 *        An LLM is the WRONG long-term tool for this job and the seam exists
 *        because of that. It is a judgement model doing a classification task:
 *        it costs more per call than a dedicated classifier, it is slower, and
 *        it is the same model family being asked to police the thing it is
 *        elsewhere asked to write. It is the right FIRST implementation because
 *        it needs no new vendor, no new key and no new contract, and it is
 *        genuinely good at the borderline cases a keyword list cannot do. When
 *        volume makes the bill matter, a dedicated API drops in behind this
 *        contract without a caller changing.
 * WHERE: Selected by MODERATION_PROVIDER. Reached only through
 *        getModerationAdapter() in ../index.ts.
 */

import { LlmError, getLlmAdapter } from "@/lib/adapters/llm";
import {
  moderationVerdictSchema,
  type ModerationVerdict,
} from "@/lib/types/moderation";
import { assertModerationProviderActive } from "../provider";
import {
  ModerationError,
  type ModerationAdapter,
  type ModerationClassifyArgs,
} from "../types";
import { moderationSystemPrompt, moderationUserPrompt } from "./prompt";

assertModerationProviderActive("claude");

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_MAX_CHARS, TRUNCATE_NOT_REFUSE
 *
 * WHAT:  How much text goes to the classifier.
 *
 * WHY:   TRUNCATE_NOT_REFUSE. An extracted article can run to tens of
 *        thousands of characters, and classifying all of it costs real money
 *        per generation for almost no extra signal — disallowed material in a
 *        document is overwhelmingly present in its opening, and the SCRIPT
 *        that gets published is classified separately and in full.
 *
 *        Refusing over-long text was the alternative and it is worse: it would
 *        make the length of a customer's source material into a policy
 *        decision, and the obvious workaround (paste less) does nothing for
 *        safety.
 *
 *        This IS a known limitation rather than a solved problem: material
 *        buried forty thousand characters into a document can reach a script
 *        unclassified. The script-level pass is what catches it, which is why
 *        the pipeline classifies BOTH and not just the input.
 * WHERE: classify, below.
 */
export const MODERATION_MAX_CHARS = 12_000;

export const claudeModerationAdapter: ModerationAdapter = {
  id: "claude",

  async classify(args: ModerationClassifyArgs): Promise<ModerationVerdict> {
    const text = args.text.trim();

    /* EMPTY_TEXT_IS_APPROVED, and it is not a shortcut worth removing: there
     * is nothing to classify, and spending a paid call to be told so would
     * put a provider round-trip on every generation of a project whose source
     * happens to be blank. The callers that must not accept empty text — a
     * script with no body — refuse it on their own grounds, not on safety. */
    if (text.length === 0) {
      return { status: "approved", categories: [] };
    }

    const truncated = text.slice(0, MODERATION_MAX_CHARS);

    try {
      const llm = await getLlmAdapter();
      return await llm.generate({
        system: moderationSystemPrompt(args.context),
        user: moderationUserPrompt(truncated),
        schema: moderationVerdictSchema,
        /* A verdict is three short fields. A generous ceiling here would only
         * pay for a model that decided to explain itself at length. */
        maxTokens: 1_000,
        purpose: args.purpose ?? `moderation.${args.context}`,
      });
    } catch (error) {
      /* A REFUSAL is the interesting case. The model declining to engage with
       * the text at all is strong evidence about the text — but it is not a
       * verdict, because we cannot say which category it refused over. It
       * becomes a thrown error like any other failure, and the service's
       * fail-closed path blocks the work. Reporting it as `rejected` here
       * would be inventing a classification the model never gave. */
      if (error instanceof LlmError) {
        throw new ModerationError(
          "This could not be checked against our content policy right now.",
          {
            detail: `[moderation/claude] ${error.refusal ? "model refused" : "generation failed"}: ${error.detail || error.message}`,
          },
        );
      }

      throw new ModerationError(
        "This could not be checked against our content policy right now.",
        {
          detail: `[moderation/claude] ${error instanceof Error ? error.message : String(error)}`,
        },
      );
    }
  },
};
