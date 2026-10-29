/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: proposeBlockVisuals, BlockVisualProposal,
 *   PLAN_IS_ZIPPED_BY_INDEX, A_MISSING_PROPOSAL_IS_NOT_A_FAILURE,
 *   NO_RETRY_ON_A_PLAN, ONE_CALL_FOR_THE_SCRIPT
 *
 * WHAT:  Asks a model what each narration block should show, and returns one
 *        proposal per block in the order the blocks were given.
 *
 * WHY:   PLAN_IS_ZIPPED_BY_INDEX. The model answers by position
 *        (PLAN_IS_INDEXED_NOT_IDENTIFIED in src/lib/types/visual.ts) and this
 *        function is where the positions become blocks again. An item whose
 *        index is out of range, or a second item claiming an index already
 *        taken, is DROPPED rather than reassigned: the only thing worse than a
 *        block with no picture is a block with the picture that belonged to a
 *        different paragraph, and there is no way to tell which of two
 *        colliding items was meant for which block.
 *
 *        A_MISSING_PROPOSAL_IS_NOT_A_FAILURE, which is why the return type has
 *        a `null` in it rather than this function refusing. A block with no
 *        proposal falls through the chain to the styled backdrop, which is a
 *        complete video (FALLBACK_CHAIN_IS_THE_POINT) — and refusing the whole
 *        script because the model skipped the fourth paragraph would turn a
 *        slightly plainer video into no video at all. The same argument
 *        EMPTY_WORDS_STILL_BUILDS makes about captions.
 *
 *        NO_RETRY_ON_A_PLAN, deliberately unlike the quiz writer. A quiz is
 *        retried because a bad question set is UNUSABLE and the alternative is
 *        a broken video (REJECT_AND_REGENERATE in ./quiz.ts); a thin shot list
 *        is merely plainer. The adapter's own single schema retry
 *        (RETRY_ONCE_WITH_THE_ERROR) already covers malformed output, and
 *        paying for a second opinion about picture choice is money spent on
 *        taste.
 *
 *        ONE_CALL_FOR_THE_SCRIPT — see ./visual-prompt.ts for why the whole
 *        script is one request rather than one per block.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter which holds the API
 *        key. The prompt construction (./visual-prompt.ts) and the selection
 *        rules (src/lib/visuals/) are both pure and live elsewhere, so the
 *        parts that can actually be wrong are testable with no key and no
 *        spend.
 * WHERE: The `visuals` stage of src/inngest/functions/project-generate.ts, via
 *        src/services/visuals.service.ts.
 */

import "server-only";

import { LlmError, getLlmAdapter } from "@/lib/adapters/llm";
import { visualPlanSchema, type VisualPlanItem } from "@/lib/types/visual";
import { visualSystemPrompt, visualUserPrompt } from "./visual-prompt";

/**
 * SOURCE OF TRUTH KEYWORDS: BlockVisualProposal, A_MISSING_PROPOSAL_IS_NOT_A_FAILURE
 *
 * WHAT:  What was proposed for one block, or nothing.
 * WHY:   One entry per block, in block order, with `null` for a block the model
 *        did not answer for — rather than a sparse map the caller has to probe.
 *        A dense array in the caller's own order is what makes
 *        "the chain runs for every block" a `for` loop rather than a lookup
 *        that can quietly miss.
 * WHERE: Returned by `proposeBlockVisuals`.
 */
export type BlockVisualProposal = { query: string; prompt: string } | null;

/**
 * SOURCE OF TRUTH KEYWORDS: MAX_PLAN_TOKENS, BOUNDED_OUTPUT
 *
 * Two short strings per block, so the budget scales with the block count with
 * a floor for the smallest scripts. A caller that guesses too low gets output
 * truncated mid-item, which then fails the schema and burns the adapter's one
 * retry — see `LlmGenerateArgs.maxTokens`.
 */
const TOKENS_PER_BLOCK = 220;
const MIN_PLAN_TOKENS = 1_024;

/**
 * SOURCE OF TRUTH KEYWORDS: proposeBlockVisuals, PLAN_IS_ZIPPED_BY_INDEX,
 *   NO_RETRY_ON_A_PLAN
 *
 * WHAT:  One proposal per block, in block order.
 * WHY:   See the file header. Returns all-nulls rather than throwing when the
 *        model is unreachable or refuses, because every caller's response to
 *        "no plan" is identical to its response to "no proposal for this
 *        block" — the backdrop — and an exception would make the `visuals`
 *        stage fail a run that was going to produce a perfectly good plainer
 *        video. The failure is logged for an operator.
 * WHERE: `planProjectVisuals` in src/services/visuals.service.ts.
 */
export async function proposeBlockVisuals(args: {
  blocks: readonly { narrationText: string }[];
  kindLabel?: string;
  purpose?: string;
}): Promise<BlockVisualProposal[]> {
  const empty: BlockVisualProposal[] = args.blocks.map(() => null);
  if (args.blocks.length === 0) return empty;

  let items: VisualPlanItem[];
  try {
    const adapter = await getLlmAdapter();
    const plan = await adapter.generate({
      system: visualSystemPrompt(),
      user: visualUserPrompt({
        blocks: args.blocks,
        ...(args.kindLabel === undefined ? {} : { kindLabel: args.kindLabel }),
      }),
      schema: visualPlanSchema,
      maxTokens: Math.max(
        MIN_PLAN_TOKENS,
        args.blocks.length * TOKENS_PER_BLOCK,
      ),
      purpose: args.purpose ?? "visuals.plan",
    });
    items = plan.items;
  } catch (error) {
    /* Every failure is the same answer to the caller — see the WHY above. A
     * refusal is logged distinctly because it is the one case an operator can
     * act on by changing the prompt. */
    const detail =
      error instanceof LlmError
        ? `${error.refusal ? "refused" : "failed"}: ${error.detail || error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    console.error(`[script/visuals] no shot plan — ${detail}`);
    return empty;
  }

  /* PLAN_IS_ZIPPED_BY_INDEX. First writer per index wins; a collision is
   * dropped rather than overwriting, because the second item is as likely to
   * be the mistake as the first. */
  const proposals = [...empty];
  for (const item of items) {
    if (item.index < 0 || item.index >= proposals.length) continue;
    if (proposals[item.index] !== null) continue;
    proposals[item.index] = { query: item.query, prompt: item.prompt };
  }

  return proposals;
}
