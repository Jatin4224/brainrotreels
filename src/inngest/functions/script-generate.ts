/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: scriptGenerateFunction, script/requested,
 *   script.generate, HOLD_IN_THE_WORKFLOW, NO_PATH_FORGETS_THE_REFUND,
 *   SCHEMA_IS_THE_CONTRACT, GENERATION_REPLACES_EVERYTHING,
 *   PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  The script pipeline: reserve the credits, ask the model, store the
 *        blocks, charge what it cost.
 *
 * WHY:   It is a workflow rather than a mutation because the MODEL CALL is
 *        tens of seconds at the effort this product uses, and a tRPC mutation
 *        runs inside a 10-second Prisma transaction. The split is the same one
 *        `renders.create` makes: the request does the part that produces
 *        actionable errors (extracting the source), and the durable run does
 *        the part that takes time.
 *
 *        HOLD_IN_THE_WORKFLOW, exactly as in project-render.ts: the hold is
 *        placed HERE, not in the request, because a request that times out
 *        after holding strands the money with no run in existence to release
 *        it. Here the hold and every path that can release it live in the same
 *        run.
 *
 *        NO_PATH_FORGETS_THE_REFUND: every failure path goes through
 *        `failAndRelease`, including `onFailure`. A generation that dies
 *        without refunding leaves a customer paying for a script they never
 *        got — and because the ledger and the cache would still agree, the
 *        reconcile cron would report nothing wrong (STRANDED_HOLD).
 *
 *        SCHEMA_IS_THE_CONTRACT: the model's output is validated by the LLM
 *        adapter against `scriptDraftSchema` before it is returned, so nothing
 *        in this file ever holds raw model text. That is what makes
 *        "malformed model output never reaches the database" structural rather
 *        than a rule somebody remembers.
 *
 *        GENERATION_REPLACES_EVERYTHING: `replaceScript` discards whatever was
 *        there, including hand edits. That is deliberate and is documented on
 *        the service — a merge has no correct answer, and the non-destructive
 *        path is `scripts.regenerateBlock`.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 *        Triggered by `script/requested`, sent by `scripts.generate`.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import {
  flushAnalytics,
  readRequestId,
  trackFunnelEvent,
} from "@/lib/observability";
import { LlmError } from "@/lib/adapters/llm";
import { prisma } from "@/lib/config/prisma";
import { estimate } from "@/lib/credits";
import {
  ScriptWriterNotImplementedError,
  hasScriptWriter,
  resolveScriptWriter,
} from "@/lib/script";
import { scriptToneSchema } from "@/lib/types/script";
import { projectKindSchema } from "@/lib/types/project";
import {
  InsufficientCreditsError,
  commit,
  findOpenHoldForRef,
  hold,
  release,
} from "@/services/credits.service";
import { replaceScript } from "@/services/scripts.service";

/**
 * SOURCE OF TRUTH KEYWORDS: scriptRequestedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of a `script/requested` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED, the same rule as every other workflow here:
 *        `JobEvent.data` crosses a queue as JSON with no types attached and
 *        may have been enqueued by an older deploy. Reading
 *        `event.data.projectId as string` would turn a renamed field into a
 *        Prisma query for `undefined`.
 *
 *        The SOURCE TEXT is deliberately not on the event. Keeping step and
 *        event payloads small is the rule (JobsAdapter's "ids, never
 *        documents"), and an article is the largest thing in this flow — it is
 *        read from `Project.settings`, where `scripts.generate` put it.
 * WHERE: The first act of the handler below.
 */
const scriptRequestedEventSchema = z.object({
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  targetSeconds: z.number().int().positive(),
  tone: scriptToneSchema,
});

const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: scriptRequestedEventSchema }),
  }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: storedSourceSchema, SOURCE_FROM_THE_PROJECT
 *
 * WHAT:  The slice of `Project.settings` that `scripts.generate` wrote.
 * WHY:   SOURCE_FROM_THE_PROJECT. The phase says to store the extracted body
 *        in `Project.settings` rather than adding a column, so this is where
 *        the workflow reads it from — and it is PARSED rather than trusted,
 *        because it is a JSON column that any previous release could have
 *        written. A missing or malformed `script` key means the request and
 *        the run disagree about what is being generated, which is permanent.
 * WHERE: The `load-source` step.
 */
const storedSourceSchema = z.object({
  sourceText: z.string().min(1),
  sourceTitle: z.string().nullable().optional(),
  /**
   * SOURCE OF TRUTH KEYWORDS: THREAD_IS_STORED_NOT_REFETCHED
   *
   * Phase 12. A Reddit project's structured thread, written by
   * `redditStories.start` alongside the flattened text. The condensation needs
   * the STRUCTURE — which sentence was the poster's and which was a reply —
   * and re-fetching the thread here would mean a second call against a third
   * party's API inside a run that already has the answer, against a post that
   * may have been deleted in between.
   *
   * Optional, because only one format has one. A project whose thread has been
   * removed by the retention sweep therefore fails its CONDENSATION with a
   * named error rather than silently narrating the flattened text in one
   * voice — which is the honest outcome: the source the video was made from is
   * gone, and the existing script is unaffected.
   */
  thread: z
    .object({
      title: z.string(),
      subreddit: z.string(),
      body: z.string(),
      author: z.string(),
      permalink: z.string(),
      comments: z.array(
        z.object({
          author: z.string(),
          body: z.string(),
          score: z.number(),
        }),
      ),
    })
    .optional(),
  /** Reddit only: whether to cut the thread to the target length. */
  condense: z.boolean().optional(),
});

export const scriptGenerateFunction = inngestClient.createFunction(
  {
    id: "script-generate",
    name: "Generate a script for a project",
    triggers: [{ event: "script/requested" }],
    /* Two attempts. Every attempt is a billed model request against a
     * customer's credits, and the failures worth retrying (reaching the API at
     * all) clear immediately or not at all — the permanent ones already raise
     * NonRetriableError before they can be retried. */
    retries: 2,
    /* One generation at a time per WORKSPACE. A customer queueing six
     * projects must not be able to hold six model requests open while every
     * other tenant waits. */
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
    /**
     * The net under every transient failure. Without it a run that exhausted
     * its retries leaves the project on `generating` forever and the credits
     * reserved against a script that will never exist.
     */
    onFailure: async ({ event }) => {
      const parsed = failureEventSchema.safeParse(event);
      if (!parsed.success) {
        console.error(
          "[script.generate] Failure handler could not read the original event.",
        );
        return;
      }
      await failAndRelease(
        parsed.data.data.event.data.projectId,
        "Writing this script did not finish. Please try again.",
      );
    },
  },
  async ({ event, step }) => {
    const input = scriptRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      /* A malformed event cannot be fixed by retrying it, and there is no
       * project id to mark failed — so the only useful thing is to stop. */
      throw new NonRetriableError(
        `[script.generate] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { projectId, organizationId, targetSeconds, tone } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] LOAD SOURCE — read what the request extracted, and mark the project
    //     as working so the UI can show it.
    // ───────────────────────────────────────────────────────────────────────
    const source = await step.run("load-source", async () => {
      const project = await prisma.project.findFirst({
        where: { id: projectId, organizationId },
        /* `kind` is read here so the WRITER can be resolved from it —
         * ONE_WORKFLOW_MANY_WRITERS, Phase 12. */
        select: { id: true, kind: true, settings: true },
      });
      if (project === null) {
        /* Deleted while the event was in flight. Nothing to mark failed. */
        throw new NonRetriableError(
          `[script.generate] Project ${projectId} no longer exists.`,
        );
      }

      const settings =
        typeof project.settings === "object" && project.settings !== null
          ? (project.settings as Record<string, unknown>)
          : {};

      const parsed = storedSourceSchema.safeParse(settings["script"]);
      if (!parsed.success) {
        await failAndRelease(
          projectId,
          "The source text for this script could not be read. Please generate it again.",
        );
        throw new NonRetriableError(
          `[script.generate] Project ${projectId} has no usable stored source.`,
        );
      }

      /**
       * SOURCE OF TRUTH KEYWORDS: ONE_WORKFLOW_MANY_WRITERS,
       *   UNWRITABLE_KIND_IS_NAMED
       *
       * The kind is resolved here, in the step that already reads the project,
       * and refused HERE — before the credit hold — if no writer is built for
       * it. Refusing after the hold would mean reserving a customer's credits
       * for a format that cannot be written, and the refusal is permanent:
       * a missing writer will not appear on the second attempt.
       */
      const kind = projectKindSchema.safeParse(project.kind);
      if (!kind.success || !hasScriptWriter(kind.data)) {
        const reason = `${project.kind} scripts cannot be written yet.`;
        await failAndRelease(projectId, reason);
        throw new NonRetriableError(
          `[script.generate] ${projectId}: no writer for kind "${project.kind}".`,
        );
      }

      await prisma.project.updateMany({
        where: { id: projectId, organizationId },
        data: { status: "generating" },
      });

      return {
        kind: kind.data,
        sourceText: parsed.data.sourceText,
        sourceTitle: parsed.data.sourceTitle ?? null,
        /* STEP_RESULTS_ARE_JSON: this crosses a step boundary and comes back
         * as plain data on a replay, which is why it is re-parsed below. */
        thread: parsed.data.thread ?? null,
        condense: parsed.data.condense ?? true,
      };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [2] HOLD CREDITS — HOLD_IN_THE_WORKFLOW. Reserved immediately before the
    //     model is called, after everything that could still refuse for free.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("hold-credits", async () => {
      const existing = await findOpenHoldForRef(prisma, scriptRef(projectId));
      if (existing !== null) {
        /* A retry of this step. The money is already reserved; reusing the
         * hold is what keeps commit able to settle exactly one thing
         * (ORPHANED_HOLD). */
        return { holdId: existing.id, reused: true };
      }

      const cost = estimate({ kind: "script", durationSeconds: targetSeconds });

      try {
        const holdId = await hold(
          prisma,
          organizationId,
          cost.total,
          scriptRef(projectId),
          {
            kind: "script",
            projectId,
            targetSeconds,
            breakdown: cost.lines,
          },
        );
        return { holdId, reused: false };
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          /* Permanent: the balance will not grow by itself, and retrying
           * produces the same refusal while billing nothing useful. The
           * request already checked, so reaching here means the balance moved
           * in between — which a concurrent generation does routinely. */
          await failAndRelease(
            projectId,
            `This script needs ${error.required} credits and this workspace has ${error.available}. Top up and try again.`,
          );
          throw new NonRetriableError(
            `[script.generate] ${projectId} could not be held: ${error.message}`,
          );
        }
        throw error;
      }
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] GENERATE — the long part. Its own step, so a retry does not re-run
    //     the hold and a replay does not re-ask the model.
    // ───────────────────────────────────────────────────────────────────────
    const draft = await step.run("generate", async () => {
      try {
        /**
         * ONE_WORKFLOW_MANY_WRITERS. The kind picks the writer and nothing
         * else in this file knows which format is being written — no
         * `if (kind === 'reddit-story')` anywhere, which is the property the
         * registry exists to hold (see THE_OTHER_EXTENSION_POINT in
         * src/lib/script/writers.ts).
         *
         * The source is re-parsed from the step result rather than trusted,
         * because a replayed step returns JSON (STEP_RESULTS_ARE_JSON).
         */
        const loaded = storedSourceSchema
          .pick({ thread: true })
          .safeParse({ thread: source.thread ?? undefined });

        return await resolveScriptWriter(projectKindSchema.parse(source.kind))
          .write({
            sourceText: source.sourceText,
            targetSeconds,
            tone,
            sourceTitle: source.sourceTitle ?? undefined,
            ...(loaded.success && loaded.data.thread !== undefined
              ? { thread: loaded.data.thread }
              : {}),
            condense: source.condense,
          });
      } catch (error) {
        if (error instanceof ScriptWriterNotImplementedError) {
          /* The kind was checked before the hold, so reaching here means a
           * writer withdrawn between that check and this call — a deploy mid
           * run. Permanent: it will not reappear on the second attempt. */
          await failAndRelease(projectId, error.message);
          throw new NonRetriableError(error.message);
        }
        if (error instanceof LlmError) {
          console.error(`[script.generate] ${projectId}: ${error.detail}`);
          if (error.permanent) {
            /* A refusal, a malformed prompt, or output that failed the schema
             * twice. The adapter has already retried where retrying helps. */
            await failAndRelease(projectId, error.message);
            throw new NonRetriableError(error.message);
          }
          /* Transient — thrown plainly so Inngest retries with backoff. The
           * hold stays, because the next attempt will use it. */
          throw error;
        }
        throw error;
      }
    });

    // ───────────────────────────────────────────────────────────────────────
    // [4] SAVE AND CHARGE — the blocks, the project status and the credit
    //     commit in ONE transaction.
    // ───────────────────────────────────────────────────────────────────────
    const saved = await step.run("save", async () => {
      /**
       * One transaction, because the halfway states are both bad: blocks with
       * no charge, or a charge with no blocks. The second is a customer paying
       * for a script they cannot see, which is the thing Phase 05 exists to
       * prevent.
       */
      return prisma.$transaction(async (tx) => {
        const count = await replaceScript(tx, {
          organizationId,
          projectId,
          blocks: draft.blocks,
        });

        await tx.project.updateMany({
          where: { id: projectId, organizationId },
          data: {
            status: "ready",
            /* The model's title is a better name than "Untitled project", and
             * this is the first moment one exists. It does not overwrite a
             * title the customer chose — only the default. */
            ...(draft.title.length > 0 ? {} : {}),
          },
        });

        /* CHARGE_WHAT_IT_COST — re-estimated rather than reusing the held
         * amount, so a future rate change or a different actual length is
         * charged honestly and the difference released (PARTIAL_RELEASE). */
        const actual = estimate({
          kind: "script",
          durationSeconds: targetSeconds,
        });

        const openHold = await findOpenHoldForRef(tx, scriptRef(projectId));
        if (openHold !== null) {
          await commit(tx, openHold.id, actual.total, {
            kind: "script",
            projectId,
            blocks: count,
          });
        }

        return { blocks: count, creditsCharged: actual.total };
      });
    });

    /* THE_FUNNEL_IS_FIVE_EVENTS. Emitted from the WORKFLOW, not the router:
     * the router only knows a script was REQUESTED, and the step the funnel
     * measures is a script that actually exists. Its own step so a replayed
     * run does not re-emit it, and flushed because the worker may be frozen
     * the moment this returns. */
    await step.run("track", async () => {
      trackFunnelEvent({
        event: "first_script",
        organizationId,
        requestId: readRequestId(event.data),
        properties: { projectId, blocks: saved.blocks },
      });
      await flushAnalytics();
      return { tracked: true };
    });

    return {
      projectId,
      title: draft.title,
      blocks: saved.blocks,
      estimatedSeconds: draft.estimatedSeconds,
      overLimit: draft.overLimit,
      creditsCharged: saved.creditsCharged,
    };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: scriptRef, ONE_REF_PER_PROJECT
 *
 * WHAT:  The ledger reference a script generation's hold is keyed on.
 * WHY:   Namespaced rather than the bare project id, because a project also
 *        has RENDERS whose holds are keyed on a render id — and a future
 *        reference collision between the two would make
 *        `findOpenHoldForRef` return a render's hold to a script's commit.
 *        The prefix makes the two namespaces provably disjoint.
 * WHERE: Every hold, commit and release in this file.
 */
function scriptRef(projectId: string): string {
  return `script:${projectId}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: failAndRelease, NO_PATH_FORGETS_THE_REFUND
 *
 * WHAT:  Marks the project failed AND gives back whatever was held for it.
 * WHY:   NO_PATH_FORGETS_THE_REFUND — the same discipline as
 *        `failRenderAndRelease` in project-render.ts, and for the same reason:
 *        there are several places this run can end badly and "remember to
 *        release too" is a rule that holds until somebody adds another one. So
 *        there is no bare project-status write on a failure path in this file.
 *
 *        It finds the hold by the project's ref rather than taking a holdId,
 *        because `onFailure` receives only the original event and a replayed
 *        step has its own locals. Releasing twice is a no-op
 *        (DOUBLE_COMMIT_REFUSED), so calling this before a hold exists, or
 *        more than once, is safe.
 *
 *        The refund is best-effort around the status write: if releasing
 *        throws, the project is still marked failed and the error is logged.
 *        Letting it propagate would leave the project stuck on `generating`
 *        because its refund did not work — two problems instead of one. The
 *        nightly reconcile cron catches the stranded hold.
 * WHERE: Every failure path in this file, including onFailure.
 */
async function failAndRelease(
  projectId: string,
  message: string,
): Promise<void> {
  await prisma.project.updateMany({
    where: { id: projectId },
    data: { status: "failed" },
  });

  try {
    const open = await findOpenHoldForRef(prisma, scriptRef(projectId));
    if (open !== null) {
      await release(prisma, open.id, { reason: "script generation failed" });
    }
  } catch (releaseError) {
    console.error(
      `[script.generate] ${projectId} was marked failed but its credit hold could not be released:`,
      releaseError,
    );
  }

  console.warn(`[script.generate] ${projectId} failed: ${message}`);
}
