/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: assignVoiceOperation, ONE_OPERATION_THREE_SURFACES,
 *   PLAN_DECIDES_AVAILABILITY, ASSIGNMENT_BLOCKS_GENERATION,
 *   THE_FLAG_IS_READ_NOT_ENFORCED
 *
 * WHAT:  Gives one speaker a voice, after proving the workspace may use that
 *        voice, and reports whether the cast is now complete.
 *
 * WHY:   PLAN_DECIDES_AVAILABILITY, and this is the one place in the seam
 *        where a check inside an operation is correct rather than a gate it
 *        should have left alone. The distinction: the procedure factory
 *        decides whether this workspace may ASSIGN VOICES AT ALL — a
 *        permission and a flag on the `voices` resource. What it cannot
 *        decide is whether THIS PARTICULAR voice is within the plan, because
 *        that depends on a row's `minPlan`, read at assignment time. A
 *        registry gate has no way to express "the voice you named". So the
 *        per-row availability rule lives with the verb, where all three
 *        surfaces get it.
 *
 *        THE_FLAG_IS_READ_NOT_ENFORCED: `premiumVoices` is read here for the
 *        same reason — a voice above the free tier needs the flag as well,
 *        because the flag is what a trial turns off wholesale, and the
 *        combination (within plan AND flag enabled) is the rule. Using
 *        `ctx.plan` for the first half and the flag read for the second keeps
 *        both halves in one expression, which is what stops them drifting.
 *
 *        ASSIGNMENT_BLOCKS_GENERATION — the completeness check is returned
 *        rather than left to the caller, so a panel can re-enable its generate
 *        button and an agent can learn it still has speakers to assign, both
 *        from numbers read AFTER the write rather than before it.
 * WHERE: `voices.assign`; POST /projects/:id/voices (17b); `assign_voices`
 *        (17c).
 */

import "server-only";

import { checkBooleanFeature } from "@/lib/feature-gate";
import { OperationError } from "@/lib/errors";
import * as voicesService from "@/services/voices.service";
import type { OperationContext } from "@/lib/types/api";
import type { AssignVoiceValues } from "@/lib/types/voice";

export type AssignVoiceInput = Omit<AssignVoiceValues, "organizationId">;

export async function assignVoiceOperation(
  ctx: OperationContext,
  input: AssignVoiceInput,
) {
  const voice = await voicesService.findVoice(ctx.db, input.voiceId);
  if (voice === null) {
    throw new OperationError("not_found", "That voice is no longer available.");
  }

  const premium = await checkBooleanFeature(
    ctx.organizationId,
    "premiumVoices",
  );

  /* The plan comes from the CONTEXT rather than a second tier lookup — the
   * surface resolved it to build the context, and reading it again here would
   * be a round trip to learn something we were handed. */
  const withinPlan = voicesService.assertVoiceAllowedOnPlan(
    voice.minPlan,
    ctx.plan,
  );
  const needsPremium = voice.minPlan !== "free";

  if (!withinPlan || (needsPremium && !premium.enabled)) {
    throw new OperationError(
      "refused",
      premium.upgradeMessage ??
        "That voice is not included in your current plan.",
    );
  }

  /* Read FIRST, for the project id — the validation below needs it, and
   * reading it here also turns a guessed speaker id from another workspace
   * into a clean not-found rather than a silent no-op. */
  const speaker = await voicesService.findSpeaker(
    ctx.db,
    ctx.organizationId,
    input.speakerId,
  );
  if (speaker === null) {
    throw new OperationError("not_found", "That speaker no longer exists.");
  }

  /**
   * SOURCE OF TRUTH KEYWORDS: THE_PROJECT_IS_NAMED_NOT_INFERRED
   *
   * The caller asserted which project this speaker is in; this is where the
   * assertion is checked, before anything is written. A mismatch is a
   * `not_found` rather than its own code on purpose — telling a caller "that
   * speaker exists, but in a different project" is a small oracle about rows
   * they did not name, and the fix is the same either way.
   */
  if (speaker.projectId !== input.projectId) {
    throw new OperationError(
      "not_found",
      "That speaker is not part of this project.",
    );
  }

  const updated = await voicesService.assignSpeakerVoice(
    ctx.db,
    ctx.organizationId,
    input.speakerId,
    input.voiceId,
  );
  if (updated === 0) {
    throw new OperationError("not_found", "That speaker no longer exists.");
  }

  /* Returned so a caller can re-enable its generate button without a second
   * round trip — and so the two numbers it compares were read after the write
   * rather than before it. */
  return {
    speakerId: input.speakerId,
    voiceId: input.voiceId,
    assignments: await voicesService.validateAssignments(
      ctx.db,
      ctx.organizationId,
      speaker.projectId,
    ),
  };
}
