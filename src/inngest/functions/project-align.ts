/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: projectAlignFunction, align/requested,
 *   project.align, CACHE_BY_AUDIO, DEGRADE_NEVER_FAIL, TWO_ATTEMPTS_THEN_DEGRADE,
 *   ALIGN_BACK_TO_SCRIPT, PER_LINE_ALIGNMENT, HOLD_IN_THE_WORKFLOW
 *
 * WHAT:  The alignment pipeline: time every recorded line's words against its
 *        own audio, match them back to the script, stitch them into one
 *        narration, and put captions into the document.
 *
 * WHY:   PER_LINE_ALIGNMENT, like the narration fan-out it mirrors. Each line
 *        is its own `step.run`, so a run that aligned twenty lines and then
 *        died re-enters with those twenty replayed from memory and only the
 *        remainder sent to the provider. It also means a re-recorded line can
 *        later be re-aligned alone, and that every word knows which speaker
 *        said it — from the line, not from diarisation.
 *
 *        CACHE_BY_AUDIO is checked FIRST and the run ends immediately on a
 *        hit. That is the phase's "re-aligning unchanged audio makes zero
 *        provider calls", enforced where it cannot be bypassed — the router
 *        checks the same thing, but a workflow triggered by Phase 09's
 *        pipeline will not have gone through the router.
 *
 *        TWO_ATTEMPTS_THEN_DEGRADE is the phase's step 4, implemented INSIDE
 *        the step rather than as workflow retries, and that is deliberate.
 *        Inngest retries end in a FAILED run; this phase's rule is that a
 *        failed aligner must still produce a renderable video. So the two
 *        attempts happen here, and the third outcome is an evenly distributed
 *        line marked degraded — a run that succeeds with a visible warning
 *        rather than a pipeline that stops after the expensive half.
 *
 *        HOLD_IN_THE_WORKFLOW, as in every other paid pipeline here: credits
 *        are reserved inside the run, after everything that could still
 *        refuse for free, and settled against what was actually aligned. A
 *        fully degraded alignment is NOT charged — the customer did not get
 *        the thing they paid for, and billing for a guess is how a degraded
 *        path turns into a complaint.
 * WHERE: Registered in src/inngest/functions/index.ts, served at
 *        /api/inngest. Triggered by `align/requested`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { getSttAdapter, SttError } from "@/lib/adapters/stt";
import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import {
  concatAlignedLines,
  distributeEvenly,
  reconcileToScript,
} from "@/lib/alignment";
import { prisma } from "@/lib/config/prisma";
import { estimate } from "@/lib/credits";
import { wordTokenSchema } from "@/lib/timeline";
import { DEGRADED_ENGINE } from "@/lib/types/caption";
import {
  alignmentPlan,
  applyCaptionsToTimeline,
  readCaptionSettings,
  saveAlignment,
  DEFAULT_CAPTION_SETTINGS,
} from "@/services/alignment.service";
import { signAssetUrl } from "@/services/assets.service";
import {
  InsufficientCreditsError,
  commit,
  findOpenHoldForRef,
  hold,
  release,
} from "@/services/credits.service";

const alignRequestedEventSchema = z.object({
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  force: z.boolean().optional(),
});

const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: alignRequestedEventSchema }),
  }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: plannedAlignLineSchema, STEP_RESULTS_ARE_JSON
 *
 * A step's return value is serialised, stored and replayed, so what a resumed
 * run receives is JSON rather than the object the step returned. Re-parsing
 * at the boundary is what makes the replayed value and the fresh value the
 * same thing.
 */
const plannedAlignLineSchema = z.object({
  id: z.string(),
  position: z.number().int().nonnegative(),
  speakerTag: z.string(),
  text: z.string(),
  audioAssetId: z.string(),
  durationSec: z.number().nonnegative(),
});

const planSchema = z.object({
  lines: z.array(plannedAlignLineSchema),
  audioHash: z.string(),
  totalDurationSec: z.number().nonnegative(),
  cached: z.boolean(),
});

const alignedLineSchema = z.object({
  words: z.array(wordTokenSchema),
  degraded: z.boolean(),
});

/**
 * SOURCE OF TRUTH KEYWORDS: ALIGN_URL_TTL_SECONDS
 *
 * The signed URL only has to outlive one provider call, and that call has a
 * two-minute timeout. Fifteen minutes is slack for a retried step, not a
 * window worth sharing.
 */
const ALIGN_URL_TTL_SECONDS = 900;

/** TWO_ATTEMPTS_THEN_DEGRADE — the phase's "if STT fails twice". */
const ALIGN_ATTEMPTS = 2;

export const projectAlignFunction = inngestClient.createFunction(
  {
    id: "project-align",
    name: "Time a project's captions",
    triggers: [{ event: "align/requested" }],
    /* One retry. The per-line degrade already absorbs provider failures, so a
     * run only fails on something structural — a missing project, a database
     * outage — and those rarely clear on the second attempt either. */
    retries: 1,
    /* ONE alignment at a time per WORKSPACE, like the narration fan-out: a
     * customer queueing six projects must not saturate the provider and
     * stall every other tenant behind their own backlog. */
    concurrency: { key: "event.data.organizationId", limit: 1 },
    /**
     * SOURCE OF TRUTH KEYWORDS: CANCEL_STOPS_PAID_WORK
     *
     * Phase 09 added this. The generate pipeline invokes this workflow as a
     * CHILD run, and cancelling a parent does NOT cancel its children — so
     * without this a customer who pressed Cancel would go on paying a provider
     * for output nobody will ever see. Matched on the PROJECT, so a workspace
     * cancelling its own run cannot stop another tenant's.
     *
     * Inngest does not run `onFailure` for a cancellation, so a hold this run
     * was holding is released by `projects.cancel` instead — see
     * CANCEL_RELEASES_EVERY_HOLD in src/services/pipeline.service.ts.
     */
    cancelOn: [
      {
        event: "project/cancelled",
        if: "event.data.projectId == async.data.projectId",
      },
    ],
    onFailure: async ({ event }) => {
      const parsed = failureEventSchema.safeParse(event);
      if (!parsed.success) {
        console.error(
          "[project.align] Failure handler could not read the original event.",
        );
        return;
      }
      await releaseAlignmentHold(parsed.data.data.event.data.projectId);
    },
  },
  async ({ event, step }) => {
    const input = alignRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[project.align] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { projectId, organizationId } = input.data;
    const force = input.data.force === true;

    // ───────────────────────────────────────────────────────────────────────
    // [1] PLAN — which lines are recorded, and is their audio already timed.
    // ───────────────────────────────────────────────────────────────────────
    const rawPlan = await step.run("plan-alignment", async () => {
      const plan = await alignmentPlan(prisma, organizationId, projectId, {
        force,
      });

      if (plan.lines.length === 0) {
        throw new NonRetriableError(
          `[project.align] Project ${projectId} has no recorded narration to align.`,
        );
      }

      return {
        lines: plan.lines.map((line) => ({
          id: line.id,
          position: line.position,
          speakerTag: line.speakerTag,
          text: line.text,
          audioAssetId: line.audioAssetId,
          durationSec: line.durationSec,
        })),
        audioHash: plan.audioHash,
        totalDurationSec: plan.totalDurationSec,
        cached: plan.cached,
      };
    });

    const plan = planSchema.parse(rawPlan);

    /* CACHE_BY_AUDIO — the whole run ends here on a hit, before a hold and
     * before a single provider call. */
    if (plan.cached) {
      return { projectId, cached: true, words: 0, degraded: false };
    }

    // ───────────────────────────────────────────────────────────────────────
    // [2] HOLD CREDITS — priced on the narration's measured length, which is
    //     already known, so the estimate and the settlement agree unless a
    //     line degrades.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("hold-credits", async () => {
      const existing = await findOpenHoldForRef(prisma, alignRef(projectId));
      if (existing !== null) {
        return { held: Math.abs(existing.delta) };
      }

      const cost = estimate({
        kind: "alignment",
        durationSeconds: plan.totalDurationSec,
      });

      try {
        await hold(prisma, organizationId, cost.total, alignRef(projectId), {
          kind: "alignment",
          projectId,
          lines: plan.lines.length,
        });
        return { held: cost.total };
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw new NonRetriableError(
            `[project.align] ${projectId} could not be held: ${error.message}`,
          );
        }
        throw error;
      }
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] ALIGN — one step per line. Two attempts, then an even distribution
    //     rather than a failure (DEGRADE_NEVER_FAIL).
    // ───────────────────────────────────────────────────────────────────────
    const aligned: { words: z.infer<typeof wordTokenSchema>[]; degraded: boolean }[] =
      [];

    for (const line of plan.lines) {
      /* The step id is the LINE id, so a resumed run matches its completed
       * steps by name and replays them rather than re-aligning. */
      const raw = await step.run(`align-${line.id}`, () =>
        alignOneLine({ organizationId, line }),
      );
      aligned.push(alignedLineSchema.parse(raw));
    }

    // ───────────────────────────────────────────────────────────────────────
    // [4] STITCH AND STORE — one narration-wide word array, re-indexed.
    // ───────────────────────────────────────────────────────────────────────
    const stored = await step.run("store-alignment", async () => {
      let offsetSec = 0;
      const lines = plan.lines.map((line, index) => {
        const words = aligned[index]?.words ?? [];
        const entry = {
          words,
          offsetSec,
          speaker: line.speakerTag,
        };
        offsetSec += line.durationSec;
        return entry;
      });

      const words = concatAlignedLines(lines);
      const degradedCount = aligned.filter((line) => line.degraded).length;
      const adapter = await getSttAdapter();

      await saveAlignment(prisma, {
        projectId,
        words,
        audioHash: plan.audioHash,
        engine:
          degradedCount === aligned.length ? DEGRADED_ENGINE : adapter.id,
        /* Any degraded line degrades the alignment: the customer has to be
         * told the captions are guessed SOMEWHERE, and a per-line flag the
         * UI would have to aggregate is the same information further from
         * the person who needs it. */
        degraded: degradedCount > 0,
      });

      /* The captions themselves, in whatever style the project has chosen.
       * A no-op when no document exists yet — see
       * TIMELINE_IS_OPTIONAL_UNTIL_PHASE_09. */
      const settings =
        (await readCaptionSettings(prisma, organizationId, projectId)) ??
        DEFAULT_CAPTION_SETTINGS;

      const applied = await applyCaptionsToTimeline(prisma, {
        organizationId,
        projectId,
        styleId: settings.styleId,
        position: settings.position,
        wordsPerChunk: settings.wordsPerChunk,
        enabled: settings.enabled,
        words,
      });

      return {
        words: words.length,
        degradedLines: degradedCount,
        captions: applied.captions,
        timelineWritten: applied.written,
      };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [5] SETTLE — charge for what was actually timed.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("settle", async () => {
      const openHold = await findOpenHoldForRef(prisma, alignRef(projectId));
      if (openHold === null) return { settled: false };

      /* A fully degraded alignment is RELEASED, not committed. Nothing was
       * timed — the words are a weighted guess — and charging for it is how
       * a provider outage becomes a refund request. A partial degrade is
       * still charged: most of the narration was really aligned. */
      if (stored.degradedLines === plan.lines.length) {
        await release(prisma, openHold.id, {
          reason: "alignment degraded — nothing was timed",
        });
        return { settled: true, charged: 0 };
      }

      const actual = estimate({
        kind: "alignment",
        durationSeconds: plan.totalDurationSec,
      });
      await commit(prisma, openHold.id, actual.total, {
        kind: "alignment",
        projectId,
        lines: plan.lines.length,
      });
      return { settled: true, charged: actual.total };
    });

    return {
      projectId,
      cached: false,
      words: stored.words,
      degraded: stored.degradedLines > 0,
      captions: stored.captions,
    };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: alignOneLine, TWO_ATTEMPTS_THEN_DEGRADE,
 *   ALIGN_BACK_TO_SCRIPT, DEGRADE_NEVER_FAIL
 *
 * WHAT:  One line's words, timed — or evenly distributed if they could not
 *        be.
 *
 * WHY:   The signed URL is minted INSIDE the step, not in the plan, because a
 *        replayed step must not reuse a URL that expired while the run was
 *        waiting — and a plan holding thirty signed URLs is thirty live
 *        credentials in a serialised step result.
 *
 *        A PERMANENT failure degrades immediately rather than burning the
 *        second attempt: a bad key or an unreadable file fails identically
 *        twice, and the second call is a wasted bill on the one failure that
 *        costs money.
 *
 *        An EMPTY transcript degrades too. The provider succeeded and heard
 *        nothing — silence, or audio it could not read — and
 *        `reconcileToScript` would return nothing, which would drop the whole
 *        line's words out of the document rather than timing them badly.
 * WHERE: Step 3 above.
 */
async function alignOneLine(args: {
  organizationId: string;
  line: z.infer<typeof plannedAlignLineSchema>;
}): Promise<{ words: unknown; degraded: boolean }> {
  const { organizationId, line } = args;

  for (let attempt = 1; attempt <= ALIGN_ATTEMPTS; attempt += 1) {
    try {
      const audioUrl = await signAssetUrl(
        line.audioAssetId,
        organizationId,
        ALIGN_URL_TTL_SECONDS,
      );
      if (audioUrl === null) {
        /* The asset was deleted between the plan and this step. Permanent:
         * there is nothing to align and a retry signs the same nothing. */
        console.error(
          `[project.align] line ${line.id}: its audio asset is gone; distributing evenly.`,
        );
        break;
      }

      const stt = await getSttAdapter();
      const heard = await stt.align({ audioUrl, scriptText: line.text });

      if (heard.length > 0) {
        /* ALIGN_BACK_TO_SCRIPT — the transcript is used for its TIMINGS
         * only; the words are always the customer's. */
        const words = reconcileToScript(heard, line.text);
        if (words.length > 0) return { words, degraded: false };
      }

      console.warn(
        `[project.align] line ${line.id}: the aligner heard nothing; distributing evenly.`,
      );
      break;
    } catch (error) {
      const failure = error instanceof SttError ? error : null;
      console.error(
        `[project.align] line ${line.id} attempt ${attempt}: ${failure?.detail ?? String(error)}`,
      );

      if (failure !== null && failure.permanent) break;
      if (attempt === ALIGN_ATTEMPTS) break;
    }
  }

  /* DEGRADE_NEVER_FAIL — across the MEASURED duration, so a degraded line is
   * at least correct at both ends and in total. */
  return {
    words: distributeEvenly(line.text, line.durationSec),
    degraded: true,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: alignRef, ONE_REF_PER_PROJECT
 *
 * WHAT:  The ledger reference an alignment hold is keyed on.
 * WHY:   Namespaced, like `script:` and `tts:`, so the holds a project can
 *        carry cannot collide — a collision would make `findOpenHoldForRef`
 *        return one pipeline's hold to another's commit.
 * WHERE: Every hold, commit and release in this file.
 */
function alignRef(projectId: string): string {
  return `align:${projectId}`;
}

async function releaseAlignmentHold(projectId: string): Promise<void> {
  try {
    const open = await findOpenHoldForRef(prisma, alignRef(projectId));
    if (open !== null) {
      await release(prisma, open.id, { reason: "alignment failed" });
    }
  } catch (error) {
    console.error(
      `[project.align] ${projectId} hold could not be released:`,
      error,
    );
  }
}
