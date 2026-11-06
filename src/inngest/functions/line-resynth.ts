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
 *        RE_RECORDING_INVALIDATES_THE_ALIGNMENT. Phase 08 filled the hook
 *        this file left open (ALIGNMENT_IS_PHASE_08): the run ends by
 *        enqueuing `align/requested`, because new audio for one line moves
 *        every word timing after it and the captions would otherwise stay
 *        confidently wrong. It is an event rather than a call — see the step
 *        for why.
 * WHERE: Registered in src/inngest/functions/index.ts. Triggered by
 *        `line/changed`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { enqueue } from "@/lib/adapters/jobs";
import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { prisma } from "@/lib/config/prisma";
import { estimate } from "@/lib/credits";
import { narrationTextHash } from "@/lib/narration";
import {
  InsufficientCreditsError,
  commit,
  findOpenHoldForRef,
  hold,
  release,
} from "@/services/credits.service";
import {
  findCachedAudio,
  findNarrationLine,
  markLineFailed,
  updateLineText,
} from "@/services/narration.service";
import { findVoiceForSynthesis } from "@/services/voices.service";
import { narrateOneLine } from "./narrate-line";

/**
 * SOURCE OF TRUTH KEYWORDS: resynthRef, ONE_REF_PER_LINE, narrationRef
 *
 * WHAT:  The ledger reference a single-line re-record holds against.
 * WHY:   Keyed on the LINE, not the project, because several lines can be
 *        re-recorded at once (the workflow allows two per workspace) and one
 *        ref per project would make `findOpenHoldForRef` hand one line's hold
 *        to another line's commit.
 *
 *        Its own namespace rather than `tts:`, which `project.tts` uses for the
 *        whole-narration hold and which `PROJECT_HOLD_REFS` releases as
 *        `tts:<projectId>`. Sharing the prefix with a different key shape is
 *        how two holds come to look like one.
 * WHERE: The hold, commit and release in this file.
 */
function resynthRef(lineId: string): string {
  return `resynth:${lineId}`;
}

/**
 * A line is a sentence or two. Sizes the HOLD only — the commit is priced on
 * the measured duration — so an inaccurate guess costs a slightly wrong
 * reservation and never a wrong charge. Deliberately the same number
 * `project.tts` uses: two different estimates for one line would show a
 * customer two prices for the same work.
 */
const APPROX_SECONDS_PER_LINE = 6;

/**
 * SOURCE OF TRUTH KEYWORDS: releaseResynthHold, NO_PATH_FORGETS_THE_REFUND
 *
 * A re-record holds against one line and settles it in the same short run, but
 * the run can still die in between — so the failure handler gives it back, the
 * same way `releaseNarrationHold` does for the whole-narration pass.
 * `PROJECT_HOLD_REFS` cannot cover this one: it looks for
 * `<namespace>:<projectId>` and this ref is keyed on the line.
 */
async function releaseResynthHold(lineId: string): Promise<void> {
  try {
    const open = await findOpenHoldForRef(prisma, resynthRef(lineId));
    if (open !== null) {
      await release(prisma, open.id, { reason: "line re-record failed" });
    }
  } catch (error) {
    console.error(
      `[line.resynth] ${lineId} hold could not be released:`,
      error,
    );
  }
}

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

      /* NO_PATH_FORGETS_THE_REFUND. A run that died between the hold and the
       * settle would otherwise leave the reservation against the balance until
       * the nightly reconciler noticed. Releasing twice is a no-op, so this is
       * safe whether or not a hold was ever taken. */
      await releaseResynthHold(parsed.data.data.event.data.lineId);
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

      /* CACHE_BEFORE_PAYING — decided here, BEFORE the text is written, so the
       * hold covers only a re-record that will actually reach the provider.
       * Undoing an edit is the commonest thing anyone does in an editor and it
       * must stay free. Looked up by (textHash, voiceId) across the workspace,
       * which is the same lookup `project.tts` plans its hold from. */
      const cached = await findCachedAudio(prisma, {
        organizationId,
        textHash,
        voiceId: line.voiceId,
      });

      /* LINE_EDIT_INVALIDATES_ONE_LINE — detaches this line's audio and sets
       * it back to pending. No other row is written, which is what keeps the
       * rest of the narration byte-identical. */
      await updateLineText(prisma, organizationId, lineId, nextText, textHash);

      return {
        needsSynthesis: cached === null,
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
    // [2] HOLD CREDITS — a re-record is a provider call and is charged like
    //     one. A cache hit reserves nothing.
    // ───────────────────────────────────────────────────────────────────────
    /* THE_EDITOR_PAYS_LIKE_THE_PIPELINE. This workflow used to take no hold at
     * all, which made the editor's per-line re-record the one unmetered path
     * to the TTS provider in the product: `project.tts` charges for every line
     * it synthesises, and a customer re-recording lines one at a time got the
     * same work for nothing. The timeline router already told them otherwise
     * ("the credits are held and settled by the workflow").
     *
     * Guarded by `findOpenHoldForRef` so a retried step reuses the existing
     * reservation instead of taking a second one — the same idempotency every
     * other hold step in the pipeline relies on. */
    await step.run("hold-credits", async () => {
      if (!prepared.needsSynthesis) return { held: 0, cached: true };

      const existing = await findOpenHoldForRef(
        prisma,
        resynthRef(prepared.id),
      );
      if (existing !== null) {
        return { held: Math.abs(existing.delta), cached: false };
      }

      /* One line, priced the way `project.tts` prices one: the tariff is per
       * second and the real duration does not exist until the audio does. */
      const cost = estimate({
        kind: "tts",
        durationSeconds: APPROX_SECONDS_PER_LINE,
      });

      try {
        await hold(prisma, organizationId, cost.total, resynthRef(prepared.id), {
          kind: "tts",
          reason: "line re-record",
          projectId: prepared.projectId,
          lineId: prepared.id,
        });
        return { held: cost.total, cached: false };
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          /* Permanent — the balance will not grow by itself. The line is left
           * `failed` with a readable reason rather than on `synthesizing`,
           * which in the editor is a spinner that never stops. */
          await markLineFailed(
            prisma,
            organizationId,
            prepared.id,
            `Re-recording this line needs ${error.required} credits and this workspace has ${error.available}. Top up and try again.`,
          );
          throw new NonRetriableError(
            `[line.resynth] ${prepared.id} could not be held: ${error.message}`,
          );
        }
        throw error;
      }
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] RECORD — the same path a fan-out line takes, so a cache hit and a
    //     synthesis behave identically here and there.
    // ───────────────────────────────────────────────────────────────────────
    const result = await step.run("record", () =>
      narrateOneLine({
        organizationId,
        projectId: prepared.projectId,
        line: prepared,
      }),
    );

    // ───────────────────────────────────────────────────────────────────────
    // [4] SETTLE — charge for the audio that actually exists.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("settle", async () => {
      const openHold = await findOpenHoldForRef(prisma, resynthRef(prepared.id));
      if (openHold === null) return { committed: 0 };

      /* A_ZERO_DURATION_IS_UNMEASURED. `durationSec` comes back null when the
       * row was replaced by a newer run mid-flight, and non-positive when the
       * measurement failed — in both cases this run produced no usable audio,
       * so the reservation goes back rather than being charged. The newer run
       * holds and settles for its own work. */
      if (result.durationSec === null || result.durationSec <= 0) {
        await release(prisma, openHold.id, {
          reason: "line re-record produced no measurable audio",
        });
        return { committed: 0 };
      }

      /* CHARGE_WHAT_IT_COST — priced on the measured duration now that the
       * audio exists, not on the per-line estimate the hold used. A shorter
       * line releases the difference (PARTIAL_RELEASE). A cache hit that was
       * nonetheless held for — the cache filled between the two steps — settles
       * at the real duration too, which is the honest answer either way. */
      const actual = estimate({
        kind: "tts",
        durationSeconds: result.durationSec,
      });
      await commit(prisma, openHold.id, actual.total, {
        kind: "tts",
        reason: "line re-record",
        projectId: prepared.projectId,
        lineId: prepared.id,
      });
      return { committed: actual.total };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] RE-ALIGN — the line's audio changed, so every word timing in the
    //     project is now wrong from this line onwards.
    // ───────────────────────────────────────────────────────────────────────
    /* RE_RECORDING_INVALIDATES_THE_ALIGNMENT. This is the hook Phase 07 left
     * open (ALIGNMENT_IS_PHASE_08). It is an EVENT rather than a call: the
     * alignment is a provider round trip per line and this step has already
     * spent one on the synthesis, so chaining them inside one run doubles the
     * time a run holds its concurrency slot in an interactive editor.
     *
     * The align run is cheap when little changed — its own cache skips every
     * line whose audio it has already timed — and it is enqueued even on a
     * CACHED re-record, because the cache hit means this line's audio is now
     * a DIFFERENT recording from the one the stored alignment was built on.
     *
     * THE_KEY_IS_THE_NEW_AUDIO. Inngest dedupes identical event ids for 24
     * hours, and this key used the TEXT hash — so re-recording one line twice
     * (same text, new take each time, which is what the editor's "re-record"
     * does) produced the same id and the second re-align was silently
     * swallowed, leaving the captions on the first take's timings. Keyed on the
     * line's current audio asset instead: a genuinely new recording is a new
     * key, and a cache hit that returned the same audio is the same key, which
     * is the dedupe behaving correctly rather than hiding work. */
    await step.run("request-realignment", async () => {
      const line = await findNarrationLine(prisma, organizationId, lineId);

      await enqueue({
        name: "align/requested",
        data: { projectId: prepared.projectId, organizationId },
        /* Falls back to the text hash only if the row vanished under us, which
         * means a newer run owns the line and will enqueue its own. */
        id: `align-after-line-${lineId}-${line?.audioAssetId ?? prepared.textHash}`,
      });
      return { queued: true };
    });

    return { lineId, cached: result.cached, durationSec: result.durationSec };
  },
);
