/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: projectTtsFunction, tts/requested, project.tts,
 *   FAN_OUT_PER_LINE, CACHE_BEFORE_PAYING, ASSIGNMENT_BLOCKS_GENERATION,
 *   PER_LINE_FAILURE, LOUDNESS_IS_NORMALISED, HOLD_IN_THE_WORKFLOW
 *
 * WHAT:  The narration pipeline: split the script into lines, refuse if the
 *        cast is incomplete, then synthesise every line that is not already
 *        recorded.
 *
 * WHY:   FAN_OUT_PER_LINE, the phase's step 5. Each line is its own
 *        `step.run`, so a run that produced twenty lines and then died
 *        re-enters with those twenty replayed from memory and only the
 *        remainder actually synthesised. One step per script would re-record
 *        the lot on every retry, at full price.
 *
 *        CACHE_BEFORE_PAYING is checked INSIDE each line's step, not before
 *        the fan-out. That ordering matters: a cache hit has to be recorded on
 *        the row like any other success, and checking up-front would mean
 *        maintaining a separate "which lines still need doing" list that the
 *        retry logic would then have to reproduce. Inside the step, a hit and
 *        a synthesis end identically.
 *
 *        ASSIGNMENT_BLOCKS_GENERATION — the cast is validated before a single
 *        provider call, and the refusal names the speakers. A project narrated
 *        in a voice the customer did not choose is worse than one that did not
 *        start.
 *
 *        PER_LINE_FAILURE: one line failing marks THAT line failed and lets
 *        the rest finish. The whole caching design exists so a re-run
 *        synthesises only what is missing, and a project-level failure would
 *        throw away every successful line's work.
 *
 *        HOLD_IN_THE_WORKFLOW, as in every other paid pipeline here: credits
 *        are reserved inside the run, after everything that could still refuse
 *        for free, so a request that times out cannot strand money with no run
 *        to release it. The hold covers the lines that will ACTUALLY be
 *        synthesised — cached lines cost nothing and must not be charged for.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 *        Triggered by `tts/requested`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { prisma } from "@/lib/config/prisma";
import { estimate } from "@/lib/credits";
import { narrationTextHash, splitScriptIntoLines } from "@/lib/narration";
import {
  InsufficientCreditsError,
  commit,
  findOpenHoldForRef,
  hold,
  release,
} from "@/services/credits.service";
import {
  findCachedAudio,
  listNarrationLines,
  markLineFailed,
  narrationTotals,
  replaceNarrationLines,
} from "@/services/narration.service";
import { listScriptBlocks } from "@/services/scripts.service";
import { narrateOneLine } from "./narrate-line";
import {
  findVoiceForSynthesis,
  upsertSpeakers,
  validateAssignments,
} from "@/services/voices.service";

const ttsRequestedEventSchema = z.object({
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
});

const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: ttsRequestedEventSchema }),
  }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: plannedLineSchema, STEP_RESULTS_ARE_JSON
 *
 * WHAT:  The per-line facts the fan-out works from.
 * WHY:   STEP_RESULTS_ARE_JSON — a step's return value is serialised, stored
 *        and replayed, so what a resumed run receives is JSON rather than the
 *        object the step returned. Re-parsing at the boundary is what makes
 *        the replayed value and the fresh value the same thing.
 * WHERE: Between the plan step and the fan-out.
 */
const plannedLineSchema = z.object({
  id: z.string(),
  textHash: z.string(),
  voiceId: z.string(),
  providerVoiceId: z.string(),
  needsSynthesis: z.boolean(),
});

const planSchema = z.object({
  lines: z.array(plannedLineSchema),
  toSynthesise: z.number().int().nonnegative(),
});

export const projectTtsFunction = inngestClient.createFunction(
  {
    id: "project-tts",
    name: "Narrate a project's script",
    triggers: [{ event: "tts/requested" }],
    /* Two attempts. Every attempt can reach a paid provider, and the failures
     * worth retrying clear immediately or not at all — the permanent ones
     * raise NonRetriableError before they can be retried. */
    retries: 2,
    /* ONE narration at a time per WORKSPACE, which is the phase's step 5: a
     * customer queueing six projects must not be able to saturate the
     * provider and stall every other tenant behind their own backlog. The
     * fan-out below is sequential within a run for the same reason. */
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
          "[project.tts] Failure handler could not read the original event.",
        );
        return;
      }
      await releaseNarrationHold(parsed.data.data.event.data.projectId);
    },
  },
  async ({ event, step }) => {
    const input = ttsRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[project.tts] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { projectId, organizationId } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] PLAN — split the script, make sure every speaker is cast, write the
    //     lines, and decide which of them actually need a provider call.
    // ───────────────────────────────────────────────────────────────────────
    const rawPlan = await step.run("plan-lines", async () => {
      const blocks = await listScriptBlocks(prisma, organizationId, projectId);
      if (blocks.length === 0) {
        throw new NonRetriableError(
          `[project.tts] Project ${projectId} has no script to narrate.`,
        );
      }

      const drafts = splitScriptIntoLines(
        blocks.map((block) => ({
          id: block.id,
          narrationText: block.narrationText,
          speakerTag: block.speakerTag,
        })),
      );

      /* SPEAKERS_FOLLOW_THE_SCRIPT — a rewrite can introduce a tag that did
       * not exist before, and the cast must have a row for it before anybody
       * can assign a voice. Existing assignments survive. */
      const speakers = await upsertSpeakers(prisma, {
        organizationId,
        projectId,
        tags: drafts.map((draft) => draft.speakerTag),
      });

      /* ASSIGNMENT_BLOCKS_GENERATION — before any provider call. */
      const assignments = await validateAssignments(
        prisma,
        organizationId,
        projectId,
      );
      if (!assignments.ok) {
        throw new NonRetriableError(
          `[project.tts] ${projectId} has unassigned speakers: ${assignments.unassigned.join(", ") || "(none cast)"}`,
        );
      }

      const voiceByTag = new Map(
        speakers.map((speaker) => [speaker.tag, speaker.voiceId]),
      );

      /* The hash covers the voice, so it can only be computed once the cast is
       * known — which is why this happens here and not in the splitter. */
      const lines = drafts.map((draft) => {
        const voiceId = voiceByTag.get(draft.speakerTag) ?? null;
        return {
          position: draft.position,
          speakerTag: draft.speakerTag,
          voiceId,
          text: draft.text,
          textHash: narrationTextHash(draft.text, voiceId),
        };
      });

      await replaceNarrationLines(prisma, {
        organizationId,
        projectId,
        lines,
      });

      /* Read back, because the rows now have ids the fan-out addresses. */
      const stored = await listNarrationLines(prisma, organizationId, projectId);

      const planned: z.infer<typeof plannedLineSchema>[] = [];
      for (const line of stored) {
        if (line.voiceId === null) continue;

        const voice = await findVoiceForSynthesis(prisma, line.voiceId);
        if (voice === null) {
          await markLineFailed(
            prisma,
            organizationId,
            line.id,
            "That voice is no longer available. Pick another one.",
          );
          continue;
        }

        /* CACHE_BEFORE_PAYING — decided here so the hold covers only what will
         * actually be synthesised. */
        const cached = await findCachedAudio(prisma, {
          organizationId,
          textHash: line.textHash,
          voiceId: line.voiceId,
        });

        planned.push({
          id: line.id,
          textHash: line.textHash,
          voiceId: line.voiceId,
          providerVoiceId: voice.providerVoiceId,
          needsSynthesis: cached === null,
        });
      }

      return {
        lines: planned,
        toSynthesise: planned.filter((line) => line.needsSynthesis).length,
      };
    });

    const plan = planSchema.parse(rawPlan);

    // ───────────────────────────────────────────────────────────────────────
    // [2] HOLD CREDITS — for the lines that are NOT already recorded. A fully
    //     cached re-run costs nothing and must not reserve anything.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("hold-credits", async () => {
      if (plan.toSynthesise === 0) return { held: 0, skipped: true };

      const existing = await findOpenHoldForRef(prisma, narrationRef(projectId));
      if (existing !== null) {
        return { held: Math.abs(existing.delta), skipped: false };
      }

      /* Priced on the number of lines rather than their length — the tariff's
       * TTS rate is per second of narration, and the real duration is not
       * known until the audio exists. A line is a sentence or two, so this is
       * the best estimate available before paying for it. */
      const cost = estimate({
        kind: "tts",
        durationSeconds: plan.toSynthesise * APPROX_SECONDS_PER_LINE,
      });

      try {
        await hold(
          prisma,
          organizationId,
          cost.total,
          narrationRef(projectId),
          { kind: "tts", projectId, lines: plan.toSynthesise },
        );
        return { held: cost.total, skipped: false };
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          throw new NonRetriableError(
            `[project.tts] ${projectId} could not be held: ${error.message}`,
          );
        }
        throw error;
      }
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] FAN OUT — one step per line. A cache hit and a synthesis end the
    //     same way, so a retry cannot tell them apart and does not have to.
    // ───────────────────────────────────────────────────────────────────────
    for (const line of plan.lines) {
      /* The step id is the LINE id, so a resumed run matches its completed
       * steps by name and replays them rather than re-synthesising. */
      await step.run(`line-${line.id}`, () =>
        narrateOneLine({ organizationId, projectId, line }),
      );
    }

    // ───────────────────────────────────────────────────────────────────────
    // [4] SETTLE — charge for what was actually recorded.
    // ───────────────────────────────────────────────────────────────────────
    const totals = await step.run("settle", async () => {
      const counts = await narrationTotals(prisma, organizationId, projectId);

      const openHold = await findOpenHoldForRef(
        prisma,
        narrationRef(projectId),
      );
      if (openHold !== null) {
        /* CHARGE_WHAT_IT_COST — priced on the REAL narration length now that
         * it exists, rather than on the per-line estimate the hold used. A
         * shorter-than-expected narration releases the difference; see
         * PARTIAL_RELEASE in the credits service. */
        const actual = estimate({
          kind: "tts",
          durationSeconds: counts.durationSec,
        });
        await commit(prisma, openHold.id, actual.total, {
          kind: "tts",
          projectId,
          lines: counts.ready,
        });
      }

      return counts;
    });

    return { projectId, ...totals };
  },
);

/**
 * A line is a sentence or two. Used only to size the HOLD, which is settled
 * against the measured duration — so an inaccurate estimate costs a slightly
 * wrong reservation, never a wrong charge.
 */
const APPROX_SECONDS_PER_LINE = 6;

/**
 * SOURCE OF TRUTH KEYWORDS: narrationRef, ONE_REF_PER_PROJECT
 *
 * WHAT:  The ledger reference a narration hold is keyed on.
 * WHY:   Namespaced, like `script:` and the render's own id, so the three
 *        kinds of hold a project can carry cannot collide — a collision would
 *        make `findOpenHoldForRef` return one pipeline's hold to another's
 *        commit.
 * WHERE: Every hold, commit and release in this file.
 */
function narrationRef(projectId: string): string {
  return `tts:${projectId}`;
}

async function releaseNarrationHold(projectId: string): Promise<void> {
  try {
    const open = await findOpenHoldForRef(prisma, narrationRef(projectId));
    if (open !== null) {
      await release(prisma, open.id, { reason: "narration failed" });
    }
  } catch (error) {
    console.error(
      `[project.tts] ${projectId} hold could not be released:`,
      error,
    );
  }
}
