/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: generateScriptOperation, scriptCostFor,
 *   ONE_PRICE_TWO_SURFACES, REFUSE_BEFORE_PAYING, RECORD_THE_PATH,
 *   EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY,
 *   AN_OPERATION_NEVER_THROWS_A_TRPC_ERROR
 *
 * WHAT:  Reads the customer's source, checks the workspace can pay for the
 *        writing, records what was read, and queues the model call.
 *
 * WHY:   EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY is Phase 06's split and
 *        it survives the move unchanged: the fetch happens in the request, so
 *        a paywall or a dead link is a readable refusal rather than a job that
 *        fails ten seconds later, and the model call goes to a workflow
 *        because it is slow and must resume if the process dies.
 *
 *        REFUSE_BEFORE_PAYING, and the ORDER of the two expensive steps is the
 *        decision worth keeping: the credit check runs BEFORE the extraction,
 *        so a workspace with no credits is not made to wait for a download it
 *        cannot use. The refusal carries `required` and `available` through
 *        the existing `INSUFFICIENT_CREDITS` payload, so every surface can
 *        render a top-up prompt from it without inventing its own shape.
 *
 *        ONE_PRICE_TWO_SURFACES: `scriptCostFor` is exported, because the
 *        price shown on a button, the price refused here and the price held by
 *        the workflow have to be one function. It was private to the router,
 *        which was fine while the router was the only caller; a REST client
 *        that asked what a script costs and then paid a different number is
 *        the bug this export prevents.
 *
 *        AN_OPERATION_NEVER_THROWS_A_TRPC_ERROR — the extraction's own
 *        `SourceExtractionError` is translated into an `unprocessable`
 *        operation failure, keeping its customer-facing message. That message
 *        already offers raw-text entry, which is the phase's requirement, so
 *        it travels as written rather than being replaced with copy of ours.
 * WHERE: `scripts.generate`; POST /scripts (17b); `generate_script` (17c).
 */

import "server-only";

import { enqueue } from "@/lib/adapters/jobs";
import { estimate } from "@/lib/credits";
import { ERROR_CODES, OperationError } from "@/lib/errors";
import { SourceExtractionError, extractSource } from "@/lib/script";
import { getBalance } from "@/services/credits.service";
import {
  findProjectForOrganization,
  recordScriptSource,
} from "@/services/projects.service";
import type { OperationContext } from "@/lib/types/api";
import type { GenerateScriptValues } from "@/lib/types/script";

export type GenerateScriptInput = Omit<
  GenerateScriptValues,
  "organizationId"
>;

/**
 * SOURCE OF TRUTH KEYWORDS: scriptCostFor, ONE_PRICE_TWO_SURFACES
 *
 * WHAT:  What generating a script of this length costs.
 * WHY:   See the file header. Exported so the estimate query, the refusal and
 *        the workflow's hold are provably the same number.
 * WHERE: `generateScriptOperation`, `scripts.estimateCost`, the script
 *        workflow's hold.
 */
export function scriptCostFor(targetSeconds: number) {
  return estimate({ kind: "script", durationSeconds: targetSeconds });
}

export async function generateScriptOperation(
  ctx: OperationContext,
  input: GenerateScriptInput,
) {
  const project = await findProjectForOrganization(
    ctx.db,
    ctx.organizationId,
    input.projectId,
  );
  if (project === null) {
    throw new OperationError("not_found", "Project not found");
  }

  /* REFUSE_BEFORE_PAYING — before the fetch, so a workspace with no credits is
   * not made to wait for a download it cannot use. */
  const cost = scriptCostFor(input.targetSeconds);
  const available = await getBalance(ctx.organizationId, ctx.db);
  if (available < cost.total) {
    throw new OperationError(
      "refused",
      `Writing this script costs ${cost.total} credits and this workspace has ${available}.`,
      {
        errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
        resource: "credits",
        required: cost.total,
        available,
        message: `Not enough credits. ${cost.total} needed, ${available} available.`,
      },
    );
  }

  /* The customer-facing failures all live in here — a paywall, a dead link, a
   * scanned PDF. They are raised as readable messages that offer raw-text
   * entry, which is the phase's own requirement. */
  let extracted;
  try {
    extracted = await extractSource(input.source);
  } catch (error) {
    if (error instanceof SourceExtractionError) {
      console.warn(`[operations/scripts] extraction refused: ${error.detail}`);
      throw new OperationError("unprocessable", error.message);
    }
    throw error;
  }

  /* RECORD_THE_PATH — what the customer gave us and what we made of it, on the
   * project, merged into whatever else `settings` holds. */
  const recorded = await recordScriptSource(ctx.db, {
    organizationId: ctx.organizationId,
    projectId: project.id,
    sourceRef: extracted.finalUrl ?? input.source.value,
    script: {
      sourceKind: extracted.kind,
      sourceTitle: extracted.title ?? null,
      truncated: extracted.truncated,
      targetSeconds: input.targetSeconds,
      tone: input.tone,
      /* The extracted body, so a retry does not re-fetch — and so an operator
       * can see exactly what the model was given. */
      sourceText: extracted.text,
    },
  });

  /* The project went away while we were fetching. Refusing here rather than
   * enqueuing is the point: a job for a deleted project would spend a model
   * request writing a script nothing can hold. */
  if (!recorded) {
    throw new OperationError("not_found", "Project not found");
  }

  /* The model call goes to a workflow. Keyed on the project and the request's
   * shape, so a double-click produces one run while a genuine second attempt
   * with different settings produces another. */
  await enqueue({
    requestId: ctx.requestId,
    name: "script/requested",
    data: {
      projectId: project.id,
      organizationId: ctx.organizationId,
      targetSeconds: input.targetSeconds,
      tone: input.tone,
    },
    id: `script-${project.id}-${input.targetSeconds}-${input.tone}-${extracted.text.length}`,
  });

  return {
    queued: true,
    cost,
    source: {
      kind: extracted.kind,
      title: extracted.title ?? null,
      truncated: extracted.truncated,
      characters: extracted.text.length,
    },
  };
}
