/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: lineResynthFunction, line/changed, line.resynth,
 *   LINE_EDIT_INVALIDATES_ONE_LINE, CACHE_BEFORE_PAYING, PER_LINE_FAILURE
 *
 * WHAT:  Re-records ONE narration line after its text changed.
 *
 * WHY:   This is the phase's step 7 and the reason the line is the unit of
 *        synthesis at all. Editing a typo in one sentence must cost one
 *        provider call, not a whole narration — and it must leave every other
 *        line's audio BYTE-IDENTICAL, because re-recording them produces
 *        subtly different takes and the customer hears the seams.
 *
 *        It is a separate workflow from `project.tts` rather than a parameter
 *        on it, for the same reason `scripts.regenerateBlock` is separate from
 *        `scripts.generate`: the destructive whole-pass and the surgical
 *        single-item edit have different failure modes, different costs and
 *        different callers. Phase 15's editor is this one's main caller.
 *
 *        CACHE_BEFORE_PAYING still applies: an edit that restores a line to
 *        text it previously had finds the old audio and costs nothing. That is
 *        not a contrived case — undoing an edit is the most common thing
 *        somebody does in an editor.
 *
 *        Phase 08 re-aligns the line and patches the timeline document after
 *        this. The hook is deliberately absent rather than stubbed: a call to
 *        an aligner that does not exist would be a claim that timings were
 *        refreshed, which every later phase would be entitled to believe.
 *        Grep ALIGNMENT_IS_PHASE_08.
 * WHERE: Registered in src/inngest/functions/index.ts. Triggered by
 *        `line/changed`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { prisma } from "@/lib/config/prisma";
import { narrationTextHash } from "@/lib/narration";
import {
  findNarrationLine,
  markLineFailed,
  updateLineText,
} from "@/services/narration.service";
import { findVoiceForSynthesis } from "@/services/voices.service";
import { narrateOneLine } from "./narrate-line";

const lineChangedEventSchema = z.object({
  lineId: z.string().min(1),
  organizationId: z.string().min(1),
  /* The new text. Optional because the editor may have written it already —
   * when absent, the row's current text is re-recorded as-is, which is what a
   * plain "try that line again" means. */
  text: z.string().max(5_000).optional(),
});

const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: lineChangedEventSchema }),
  }),
});

export const lineResynthFunction = inngestClient.createFunction(
  {
    id: "line-resynth",
    name: "Re-record one narration line",
    triggers: [{ event: "line/changed" }],
    retries: 2,
    /* Two at a time per workspace. Higher than the full narration's limit of
     * one, because an editor session is interactive — somebody fixing three
     * lines should not watch them queue — but still bounded so a held-down
     * button cannot saturate the provider. */
    concurrency: { key: "event.data.organizationId", limit: 2 },
    onFailure: async ({ event }) => {
      const parsed = failureEventSchema.safeParse(event);
      if (!parsed.success) {
        console.error(
          "[line.resynth] Failure handler could not read the original event.",
        );
        return;
      }
      /* The line is left `failed` with a readable reason rather than stuck on
       * `synthesizing`, which in the editor is a spinner that never stops. */
      await markLineFailed(
        prisma,
        parsed.data.data.event.data.organizationId,
        parsed.data.data.event.data.lineId,
        "That line could not be re-recorded. Please try again.",
      );
    },
  },
  async ({ event, step }) => {
    const input = lineChangedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[line.resynth] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { lineId, organizationId, text } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] REHASH — apply the new text and invalidate ONLY this line.
    // ───────────────────────────────────────────────────────────────────────
    const prepared = await step.run("rehash", async () => {
      const line = await findNarrationLine(prisma, organizationId, lineId);
      if (line === null) {
        throw new NonRetriableError(
          `[line.resynth] Line ${lineId} no longer exists.`,
        );
      }

      if (line.voiceId === null) {
        await markLineFailed(
          prisma,
          organizationId,
          lineId,
          "This speaker has no voice assigned yet.",
        );
        throw new NonRetriableError(
          `[line.resynth] Line ${lineId} has no voice assigned.`,
        );
      }

      const voice = await findVoiceForSynthesis(prisma, line.voiceId);
      if (voice === null) {
        await markLineFailed(
          prisma,
          organizationId,
          lineId,
          "That voice is no longer available. Pick another one.",
        );
        throw new NonRetriableError(
          `[line.resynth] Line ${lineId} points at a withdrawn voice.`,
        );
      }

      const nextText = text?.trim() ?? line.text;
      if (nextText.length === 0) {
        await markLineFailed(
          prisma,
          organizationId,
          lineId,
          "There is nothing to say on that line.",
        );
        throw new NonRetriableError(
          `[line.resynth] Line ${lineId} would be empty.`,
        );
      }

      const textHash = narrationTextHash(nextText, line.voiceId);

      /* LINE_EDIT_INVALIDATES_ONE_LINE — detaches this line's audio and sets
       * it back to pending. No other row is written, which is what keeps the
       * rest of the narration byte-identical. */
      await updateLineText(prisma, organizationId, lineId, nextText, textHash);

      return {
        id: lineId,
        /* Carried because it decides the STORAGE KEY — narration lives under
         * its project prefix so deleting a project removes it. See
         * NarrateLineInput. */
        projectId: line.projectId,
        textHash,
        voiceId: line.voiceId,
        providerVoiceId: voice.providerVoiceId,
      };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [2] RECORD — the same path a fan-out line takes, so a cache hit and a
    //     synthesis behave identically here and there.
    // ───────────────────────────────────────────────────────────────────────
    const result = await step.run("record", () =>
      narrateOneLine({
        organizationId,
        projectId: prepared.projectId,
        line: prepared,
      }),
    );

    /* ALIGNMENT_IS_PHASE_08 — deliberately not called. See the file header. */

    return { lineId, cached: result.cached, durationSec: result.durationSec };
  },
);
