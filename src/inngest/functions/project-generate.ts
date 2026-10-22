/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: projectGenerateFunction, project/requested,
 *   project.generate, COMPOSE_DONT_REIMPLEMENT, STAGE_PER_STEP,
 *   SMALL_STEP_PAYLOADS, CANCEL_ON_REQUEST, RECHECK_OWNERSHIP_IN_THE_WORKFLOW,
 *   SKIPPED_NOT_OMITTED, DEGRADE_IS_A_WARNING_NOT_A_FAILURE
 *
 * WHAT:  The generate pipeline: a prompt in, a previewable timeline document
 *        out. Safety check, script, cast, narration, caption timing, the
 *        kind's own document build, and the finish.
 *
 * WHY:   COMPOSE_DONT_REIMPLEMENT is the single most important decision in this
 *        file. The script, narration and alignment pipelines ALREADY EXIST as
 *        workflows of their own (Phases 06, 07, 08), each with its own credit
 *        hold, its own caching, its own fan-out and its own degrade rules. This
 *        workflow `step.invoke`s them as child runs rather than repeating their
 *        steps, and that buys three things a re-implementation would have
 *        thrown away:
 *
 *          Each child still owns its own MONEY. One hold per unit of paid work,
 *          taken and settled by the code that knows what was actually done — a
 *          fully cached narration reserves nothing, a fully degraded alignment
 *          is not charged. A pipeline-level hold over the whole run could not
 *          express either.
 *
 *          Each child still owns its own CACHING. Re-running a project whose
 *          text has not changed makes zero TTS calls and zero STT calls,
 *          because `project.tts` and `project.align` check that themselves
 *          (CACHE_BY_AUDIO, the textHash lookup). The pipeline gets the phase's
 *          resume behaviour for free.
 *
 *          A child run's steps are its OWN steps, so its fan-out does not count
 *          against this run's step payload or its memoised-state size. Phase
 *          07's narration is one step per line across dozens of lines; hosting
 *          that inside this run would make a resumed pipeline replay every one
 *          of them.
 *
 *        STAGE_PER_STEP: every step writes its `PipelineStage` row on entry and
 *        on exit, so the progress UI is reading a side effect of the work
 *        rather than a parallel bookkeeping structure somebody has to remember
 *        to update. The seeding step writes all twelve rows BEFORE anything
 *        happens (SEED_BEFORE_WORK in the service), which is what makes the
 *        list stable while it fills in.
 *
 *        SMALL_STEP_PAYLOADS is the phase's step 3 and it is a hard rule here:
 *        no step returns a document, an audio buffer or a word array. They
 *        return counts and ids. A step that returned the built timeline would
 *        work for a thirty-second video and exceed the payload limit on a long
 *        one, and the failure would look like something else entirely.
 *
 *        CANCEL_ON_REQUEST. `cancelOn` matches a `project/cancelled` event
 *        carrying the same `projectId`, so a cancel stops THIS project's run
 *        and not the next tenant's. Inngest does NOT run `onFailure` for a
 *        cancellation, which is why the credit release and the status write
 *        live in `projects.cancel` as well as here — see
 *        CANCEL_RELEASES_EVERY_HOLD in src/services/pipeline.service.ts. The
 *        children carry the same `cancelOn`, so a cancel during narration stops
 *        the narration too rather than paying for audio nobody will hear.
 *
 *        RECHECK_OWNERSHIP_IN_THE_WORKFLOW is the phase's step 10. This runs
 *        outside `protectedProcedure` and gets none of its gates, so every read
 *        and write goes through a function that takes `organizationId` and puts
 *        it in the WHERE clause. There is no call in this file that loads a
 *        project by id alone.
 *
 *        DEGRADE_IS_A_WARNING_NOT_A_FAILURE. An alignment that fell back to an
 *        even distribution completes its stage with a warning attached, and the
 *        run continues to a finished video. That is the phase's "with STT
 *        disabled the video still completes with degraded captions and a
 *        visible warning" — failing here instead would throw away a narration
 *        the customer has already paid for.
 * WHERE: Registered in src/inngest/functions/index.ts, served at
 *        /api/inngest. Triggered by `project/requested`, which
 *        `projects.generate` enqueues.
 */

import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { prisma } from "@/lib/config/prisma";
import { estimateRenderCost } from "@/lib/credits";
import {
  GeneratorNotImplementedError,
  resolveGenerator,
} from "@/lib/generators";
import { planComposition } from "@/lib/render";
import { resolveWordAnchors, validate } from "@/lib/timeline";
import { jsonObjectSchema } from "@/lib/types/json";
import { scriptToneSchema } from "@/lib/types/script";
import { countScriptBlocks, listScriptBlocks } from "@/services/scripts.service";
import { splitScriptIntoLines } from "@/lib/narration";
import { sendProjectReadyEmail } from "@/services/email.service";
import {
  beginStage,
  completeStage,
  failStage,
  generatorContextFor,
  listStages,
  readGenerateSettings,
  releaseProjectHolds,
  seedStages,
  setProjectStatus,
} from "@/services/pipeline.service";
import { saveTimelineDocument } from "@/services/projects.service";
import { upsertSpeakers, validateAssignments } from "@/services/voices.service";
import { projectKindSchema } from "@/lib/types/project";
import { projectAlignFunction } from "./project-align";
import { projectTtsFunction } from "./project-tts";
import { scriptGenerateFunction } from "./script-generate";

/**
 * SOURCE OF TRUTH KEYWORDS: projectRequestedEventSchema, EVENT_PAYLOAD_PARSED
 *
 * WHAT:  The shape of a `project/requested` event's data.
 * WHY:   EVENT_PAYLOAD_PARSED, the same rule as every other workflow here:
 *        `JobEvent.data` crosses a queue as JSON with no types attached and may
 *        have been enqueued by an older deploy. Reading
 *        `event.data.projectId as string` would turn a renamed field into a
 *        Prisma query for `undefined`.
 * WHERE: The first act of the handler.
 */
const projectRequestedEventSchema = z.object({
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
});

/**
 * SOURCE OF TRUTH KEYWORDS: failureEventSchema, THE_ERROR_IS_IN_THE_EVENT
 *
 * WHAT:  What Inngest hands `onFailure`: the original event, and the error that
 *        finished the run off.
 * WHY:   THE_ERROR_IS_IN_THE_EVENT. The other workflows here read only the
 *        original event, because all they do in `onFailure` is release a hold.
 *        This one also has to EXPLAIN itself on a progress screen, and the only
 *        description of what went wrong is this field. It is parsed with
 *        `.optional()` throughout rather than assumed: the shape is the job
 *        engine's, not ours, and a missing message must produce a generic
 *        sentence rather than a crash inside a failure handler.
 * WHERE: The `onFailure` handler, which passes the message to
 *        `explainFailure`.
 */
const failureEventSchema = z.object({
  data: z.object({
    event: z.object({ data: projectRequestedEventSchema }),
    error: z
      .object({ name: z.string().optional(), message: z.string().optional() })
      .partial()
      .passthrough()
      .optional(),
  }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: storedScriptRequestSchema, SOURCE_FROM_THE_PROJECT
 *
 * WHAT:  The slice of `Project.settings.script` that `scripts.generate` wrote.
 * WHY:   The script child needs a target length and a tone, and those are the
 *        customer's choices from the generate form — which
 *        `scripts.generate` already recorded on the project
 *        (RECORD_THE_PATH). Reading them back is what lets ONE click re-run the
 *        whole pipeline without asking the same two questions again. Parsed
 *        rather than trusted: it is a jsonb column any previous release could
 *        have written.
 * WHERE: The `script` stage.
 */
const storedScriptRequestSchema = z.object({
  targetSeconds: z.number().int().positive(),
  tone: scriptToneSchema,
  sourceText: z.string().min(1),
});

/**
 * SOURCE OF TRUTH KEYWORDS: scriptPlanSchema, STEP_RESULTS_ARE_JSON,
 *   NEEDED_IMPLIES_A_REQUEST
 *
 * WHAT:  What the `plan-script` step decided.
 * WHY:   STEP_RESULTS_ARE_JSON — a step's return value is serialised, stored
 *        and replayed, so a resumed run receives JSON rather than the object
 *        the step returned. Re-parsing at the boundary is what makes the
 *        replayed value and the fresh value the same thing.
 *
 *        NEEDED_IMPLIES_A_REQUEST: a DISCRIMINATED union rather than one object
 *        with two optional fields, so "we are generating a script" and "we know
 *        its target length and tone" are the same fact in the type system. The
 *        optional-field version compiles with a `?? 60` at the callsite, which
 *        would quietly write a sixty-second script for someone who asked for
 *        thirty.
 */
const scriptPlanSchema = z.discriminatedUnion("needed", [
  z.object({ needed: z.literal(false), blocks: z.number().int().nonnegative() }),
  z.object({
    needed: z.literal(true),
    blocks: z.number().int().nonnegative(),
    targetSeconds: z.number().int().positive(),
    tone: scriptToneSchema,
  }),
]);

/* Keeps the invoke results honest: a child's return value crosses the same JSON
 * boundary a step's does (STEP_RESULTS_ARE_JSON), so what comes back is parsed
 * rather than trusted. Only the fields this pipeline reacts to are declared. */
const alignResultSchema = z
  .object({ degraded: z.boolean().optional(), words: z.number().optional() })
  .partial()
  .passthrough();

const ttsResultSchema = z
  .object({ synthesised: z.number().optional(), failed: z.number().optional() })
  .partial()
  .passthrough();

/**
 * SOURCE OF TRUTH KEYWORDS: GENERATE_CONCURRENCY, GENERATE_RETRIES
 *
 * Two generations at a time per WORKSPACE, which is the phase's step 4. It is
 * deliberately looser than the narration and alignment children's limit of one:
 * those are the steps that hammer a provider, and they throttle themselves
 * per workspace already. This limit is about a customer not being able to queue
 * fifty projects and own the pipeline.
 */
const GENERATE_CONCURRENCY = 2;

export const projectGenerateFunction = inngestClient.createFunction(
  {
    id: "project-generate",
    name: "Generate a project end to end",
    triggers: [{ event: "project/requested" }],
    /* The phase's step 4. The PROVIDER calls are all inside child runs with
     * their own retry policies, so what a retry here re-attempts is the
     * orchestration — and three attempts is what carries a run across a
     * database blip or a deploy mid-flight. Every step is idempotent (the
     * stage writes are upserts, the children are keyed), so a retry resumes
     * rather than repeating paid work. */
    retries: 3,
    concurrency: {
      key: "event.data.organizationId",
      limit: GENERATE_CONCURRENCY,
    },
    /* CANCEL_ON_REQUEST — matched on the project, not the workspace. */
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
          "[project.generate] Failure handler could not read the original event.",
        );
        return;
      }
      await markRunFailed({
        ...parsed.data.data.event.data,
        failure: parsed.data.data.error?.message,
      });
    },
  },
  async ({ event, step }) => {
    const input = projectRequestedEventSchema.safeParse(event.data);
    if (!input.success) {
      throw new NonRetriableError(
        `[project.generate] Event payload is not valid: ${input.error.message}`,
      );
    }
    const { projectId, organizationId } = input.data;

    // ───────────────────────────────────────────────────────────────────────
    // [1] SEED — the whole stage list, before any work, so the customer sees
    //     a complete progress display from the first frame.
    // ───────────────────────────────────────────────────────────────────────
    const kind = await step.run("seed-stages", async () => {
      const project = await prisma.project.findFirst({
        /* RECHECK_OWNERSHIP_IN_THE_WORKFLOW — never by id alone. */
        where: { id: projectId, organizationId },
        select: { kind: true },
      });
      if (project === null) {
        throw new NonRetriableError(
          `[project.generate] Project ${projectId} is not in workspace ${organizationId}.`,
        );
      }

      const parsedKind = projectKindSchema.safeParse(project.kind);
      if (!parsedKind.success) {
        throw new NonRetriableError(
          `[project.generate] Project ${projectId} has an unknown format "${project.kind}".`,
        );
      }

      /* SKIPPED_NOT_OMITTED — every stage gets a row, including the four this
       * kind will never run. */
      await seedStages(prisma, projectId, parsedKind.data);
      await setProjectStatus(prisma, organizationId, projectId, "generating");
      return parsedKind.data;
    });

    const parsedKind = projectKindSchema.parse(kind);

    // ───────────────────────────────────────────────────────────────────────
    // [2] MODERATE — stubbed until Phase 10, and SAYS SO on the stage.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("moderate", async () => {
      await beginStage(prisma, projectId, "moderate");
      /* A green tick with no check behind it would be a lie the next phase has
       * to discover. The stage completes — nothing is blocking — with the
       * warning that makes the gap visible on the screen itself. */
      await completeStage(
        prisma,
        projectId,
        "moderate",
        "Automated content checks arrive in a later release.",
      );
      return { moderated: false };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [3] SCRIPT — reuse what is there, otherwise invoke the script workflow.
    // ───────────────────────────────────────────────────────────────────────
    const rawScriptPlan = await step.run("plan-script", async () => {
      await beginStage(prisma, projectId, "script");

      const existing = await countScriptBlocks(prisma, organizationId, projectId);
      if (existing > 0) return { needed: false as const, blocks: existing };

      const project = await prisma.project.findFirst({
        where: { id: projectId, organizationId },
        select: { settings: true },
      });
      const settings = jsonObjectSchema.safeParse(project?.settings);
      const request = storedScriptRequestSchema.safeParse(
        settings.success ? settings.data["script"] : undefined,
      );

      if (!request.success) {
        /* The customer never gave us anything to write from. Permanent, and
         * the message is the action that fixes it. */
        const reason =
          "There is no script and nothing to write one from. Add a source or write the script yourself, then generate again.";
        await failStage(prisma, projectId, "script", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }

      return {
        needed: true as const,
        blocks: 0,
        targetSeconds: request.data.targetSeconds,
        tone: request.data.tone,
      };
    });

    const scriptPlan = scriptPlanSchema.parse(rawScriptPlan);

    if (scriptPlan.needed) {
      await step.invoke("write-script", {
        function: scriptGenerateFunction,
        data: {
          projectId,
          organizationId,
          targetSeconds: scriptPlan.targetSeconds,
          tone: scriptPlan.tone,
        },
      });
    }

    await step.run("script-done", async () => {
      const blocks = await countScriptBlocks(prisma, organizationId, projectId);
      if (blocks === 0) {
        const reason = "The script came back empty. Try generating it again.";
        await failStage(prisma, projectId, "script", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }
      await completeStage(
        prisma,
        projectId,
        "script",
        scriptPlan.needed ? undefined : "Used the script already on this project.",
      );
      return { blocks };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [4] VOICES — cast the script, then refuse by name if anyone is missing.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("voices", async () => {
      await beginStage(prisma, projectId, "voices");

      /* The cast cannot be validated before it EXISTS, and a speaker row is
       * created from the script's tags. Phase 07 does this inside
       * `project.tts`'s own plan step; it is repeated here — two service calls,
       * no logic — so the run refuses BEFORE the narration child takes out a
       * credit hold. Both calls are idempotent: `upsertSpeakers` never clears
       * an existing assignment (ASSIGNMENTS_SURVIVE_REGENERATION) and
       * `validateAssignments` is a read. */
      const blocks = await listScriptBlocks(prisma, organizationId, projectId);
      const drafts = splitScriptIntoLines(
        blocks.map((block) => ({
          id: block.id,
          narrationText: block.narrationText,
          speakerTag: block.speakerTag,
        })),
      );
      await upsertSpeakers(prisma, {
        organizationId,
        projectId,
        tags: drafts.map((draft) => draft.speakerTag),
      });

      const assignments = await validateAssignments(
        prisma,
        organizationId,
        projectId,
      );
      if (!assignments.ok) {
        /* ASSIGNMENT_BLOCKS_GENERATION, with the speakers NAMED — which is what
         * makes the message actionable rather than a shrug. */
        const reason = assignments.hasSpeakers
          ? `Assign a voice to ${formatList(assignments.unassigned)} before generating.`
          : "This script has no speakers to cast. Generate the script again.";
        await failStage(prisma, projectId, "voices", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }

      await completeStage(prisma, projectId, "voices");
      return { lines: drafts.length };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [5] TTS — the narration fan-out, as its own run.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("tts-begin", () => beginStage(prisma, projectId, "tts"));

    const ttsRaw = await step.invoke("narrate", {
      function: projectTtsFunction,
      data: { projectId, organizationId },
    });

    await step.run("tts-done", async () => {
      const result = ttsResultSchema.safeParse(ttsRaw);
      const failed = result.success ? (result.data.failed ?? 0) : 0;
      /* A line that could not be synthesised is a HOLE in the narration, not a
       * nuisance: the words after it are timed against audio that does not
       * exist. The stage completes with a warning rather than failing, because
       * the lines that DID record are worth a video — and the warning is what
       * tells the customer why it is shorter than they expected. */
      await completeStage(
        prisma,
        projectId,
        "tts",
        failed > 0
          ? `${failed} line${failed === 1 ? "" : "s"} could not be recorded and ${failed === 1 ? "is" : "are"} missing from the narration.`
          : undefined,
      );
      return { failed };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [6] ALIGN — caption timings. Allowed to degrade (never to fail).
    // ───────────────────────────────────────────────────────────────────────
    await step.run("align-begin", () => beginStage(prisma, projectId, "align"));

    const alignRaw = await step.invoke("align", {
      function: projectAlignFunction,
      data: { projectId, organizationId },
    });

    await step.run("align-done", async () => {
      const result = alignResultSchema.safeParse(alignRaw);
      const degraded = result.success && result.data.degraded === true;
      /* DEGRADE_IS_A_WARNING_NOT_A_FAILURE — see the file header. */
      await completeStage(
        prisma,
        projectId,
        "align",
        degraded
          ? "Captions are evenly spaced rather than timed to the audio. Re-align from the captions screen to try again."
          : undefined,
      );
      return { degraded };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [7] QA — are the pieces all there? Before the build, not after it.
    // ───────────────────────────────────────────────────────────────────────
    await step.run("qa", async () => {
      await beginStage(prisma, projectId, "qa");

      const ready = await prisma.narrationLine.count({
        where: { organizationId, projectId, status: "ready" },
      });
      if (ready === 0) {
        const reason =
          "None of the narration could be recorded, so there is no video to build.";
        await failStage(prisma, projectId, "qa", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }

      /* A ready line with no measured duration cannot be positioned on a
       * track, and placing it at zero length would silently drop it from the
       * middle of the narration — see DURATION_IS_MEASURED_NOT_CLAIMED. */
      const unmeasured = await prisma.narrationLine.count({
        where: {
          organizationId,
          projectId,
          status: "ready",
          OR: [{ durationSec: null }, { durationSec: { lte: 0 } }],
        },
      });

      await completeStage(
        prisma,
        projectId,
        "qa",
        unmeasured > 0
          ? `${unmeasured} recorded line${unmeasured === 1 ? "" : "s"} had no measurable audio and ${unmeasured === 1 ? "was" : "were"} left out.`
          : undefined,
      );
      return { ready, unmeasured };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [8] TIMELINE — the kind's own build, validated, then saved.
    //     SMALL_STEP_PAYLOADS: the document never leaves this step.
    // ───────────────────────────────────────────────────────────────────────
    const built = await step.run("build-timeline", async () => {
      await beginStage(prisma, projectId, "timeline");

      const assembled = await generatorContextFor(
        prisma,
        organizationId,
        projectId,
      );
      if (assembled === null) {
        const reason = "This project is no longer available.";
        await failStage(prisma, projectId, "timeline", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }

      let doc;
      try {
        doc = await resolveGenerator(assembled.kind).build(assembled.ctx);
      } catch (error) {
        if (error instanceof GeneratorNotImplementedError) {
          const reason = `${error.kind} videos cannot be generated yet.`;
          await failStage(prisma, projectId, "timeline", reason);
          throw new NonRetriableError(
            `[project.generate] ${projectId}: ${reason}`,
          );
        }
        throw error;
      }

      /* Validated BEFORE it is stored, with the document module's own rules.
       * A document that fails here would be stored, migrated on every read and
       * refused by the player — a broken project with no explanation. The
       * reasons are logged for an operator; the customer gets one sentence. */
      const verdict = validate(doc);
      if (!verdict.ok) {
        console.error(
          `[project.generate] ${projectId}: the generated document is invalid.`,
          verdict.errors.slice(0, 5),
        );
        const reason =
          "The video could not be assembled from these pieces. Try generating again.";
        await failStage(prisma, projectId, "timeline", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }

      const saved = await saveTimelineDocument(prisma, organizationId, projectId, {
        doc: jsonObjectSchema.parse(doc),
        docVersion: doc.version,
      });
      if (!saved) {
        const reason = "This project is no longer available.";
        await failStage(prisma, projectId, "timeline", reason);
        throw new NonRetriableError(`[project.generate] ${projectId}: ${reason}`);
      }

      await completeStage(prisma, projectId, "timeline");

      /* Counts, never the document (SMALL_STEP_PAYLOADS). `durationSeconds` is
       * what the next stage prices, and it comes from the resolved plan rather
       * than from a sum of line durations — the composition is what gets
       * rendered. */
      const plan = planComposition(resolveWordAnchors(doc));
      return {
        tracks: doc.tracks.length,
        words: doc.words.length,
        durationSeconds: plan.durationInSeconds,
      };
    });

    // ───────────────────────────────────────────────────────────────────────
    // [9] FINALIZE — price the render, mark the project ready, tell whoever
    //     asked to be told.
    // ───────────────────────────────────────────────────────────────────────
    const finished = await step.run("finalize", async () => {
      await beginStage(prisma, projectId, "finalize");

      /* The phase's `estimate` step. NOT stored anywhere: `renders.estimate` is
       * the source of truth for what a render costs and recomputes it from the
       * same pure estimator against the resolution the customer picks. A copy
       * on the project would be a second answer that goes stale the moment the
       * rates change. It is computed here so the run's own result says what it
       * produced, and so an operator can see it in the run's log. */
      const cost = estimateRenderCost({
        durationSeconds: built.durationSeconds,
        resolution: "1080p",
      });

      await setProjectStatus(prisma, organizationId, projectId, "ready");
      await completeStage(prisma, projectId, "finalize");

      return { estimatedCredits: cost.total, durationSeconds: built.durationSeconds };
    });

    /* Its OWN step, after the project is already `ready`. A mail provider being
     * down must not fail a run whose video is finished and sitting there — and
     * a retried `finalize` would otherwise send the email twice. */
    await step.run("notify", () =>
      notifyIfRequested({ organizationId, projectId }),
    );

    return {
      projectId,
      kind: parsedKind,
      ...finished,
      tracks: built.tracks,
      words: built.words,
    };
  },
);

/**
 * SOURCE OF TRUTH KEYWORDS: markRunFailed, FAILING_STAGE_IS_RECORDED,
 *   RELEASE_ON_FAILURE
 *
 * WHAT:  What a failed run leaves behind: a `failed` project, a failed stage,
 *        and no money held.
 *
 * WHY:   FAILING_STAGE_IS_RECORDED. `onFailure` fires after every retry is
 *        exhausted and it does not know WHICH step died, so the running stage
 *        is found by reading the rows back — the one stage left `running` is by
 *        definition the one that was in flight. A step that already wrote its
 *        own `failStage` (every expected refusal does) is left alone, because
 *        its message is specific and this one cannot be.
 *
 *        RELEASE_ON_FAILURE is the phase's step 4: the hold is released here,
 *        through the service that knows all three ledger references a generate
 *        run can hold. Each child's own `onFailure` releases its own hold when
 *        the CHILD fails; this covers the parent failing between children, and
 *        it is safe to run either way because `findOpenHoldForRef` returns
 *        nothing for a hold that is already settled.
 * WHERE: The `onFailure` handler above.
 */
async function markRunFailed(args: {
  projectId: string;
  organizationId: string;
  /** The engine's error message, if it gave us one. Never shown verbatim. */
  failure?: string | undefined;
}): Promise<void> {
  const { projectId, organizationId } = args;

  /* Logged in full for an operator, mapped to one sentence for the customer. */
  if (args.failure !== undefined) {
    console.error(`[project.generate] ${projectId} failed: ${args.failure}`);
  }
  const reason = explainFailure(args.failure);

  try {
    const stages = await listStages(prisma, organizationId, projectId);
    const running = stages.find((stage) => stage.status === "running");
    const alreadyFailed = stages.some((stage) => stage.status === "failed");

    if (running !== undefined) {
      await failStage(prisma, projectId, running.stage, reason);
    } else if (!alreadyFailed) {
      /* Nothing was running and nothing had failed: the run died between
       * steps. The first stage that has not finished is the honest place to
       * put the message. */
      const next = stages.find((stage) => stage.status === "pending");
      if (next !== undefined) {
        await failStage(prisma, projectId, next.stage, reason);
      }
    }

    await setProjectStatus(prisma, organizationId, projectId, "failed");
  } catch (error) {
    console.error(
      `[project.generate] ${projectId}: could not record the failure:`,
      error,
    );
  }

  /* RELEASE_ON_FAILURE. Last, and outside the try above, so a failure to
   * record the stage still refunds the customer. */
  const released = await releaseProjectHolds(
    prisma,
    projectId,
    "generation failed",
  );
  if (released > 0) {
    console.warn(
      `[project.generate] ${projectId}: released ${released} open hold(s) after failure.`,
    );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: explainFailure, FAILURE_IS_EXPLAINED_NOT_DUMPED,
 *   NEVER_SURFACE_A_PROVIDER_MESSAGE
 *
 * WHAT:  One sentence a customer can act on, from whatever the engine reported.
 *
 * WHY:   FAILURE_IS_EXPLAINED_NOT_DUMPED is the phase's step 9, and this is
 *        where it is honoured for the failures nobody anticipated. Every
 *        EXPECTED refusal writes its own precise message at the step that found
 *        it — "assign a voice to OP and A", "there is no script and nothing to
 *        write one from". What reaches here is the rest: a provider outage, a
 *        database blip, a bug.
 *
 *        NEVER_SURFACE_A_PROVIDER_MESSAGE. The engine's text is MATCHED
 *        against, never shown. It is written for an operator — it carries
 *        model names, HTTP statuses and sometimes a stack — and the one case
 *        worth distinguishing for a customer is the one they can actually fix,
 *        which is running out of credits. Matching on substrings is crude and
 *        it is the right crudeness here: a wrong match produces a slightly less
 *        specific sentence, while the alternative (typed error codes threaded
 *        out of three child workflows and across a queue boundary) would be a
 *        large amount of machinery for one extra sentence.
 *
 *        Every message ends in what to do next, because a progress screen with
 *        a red row and no instruction is a support ticket.
 * WHERE: markRunFailed, above.
 */
function explainFailure(message: string | undefined): string {
  const text = message?.toLowerCase() ?? "";

  if (text.includes("credit") || text.includes("balance")) {
    return "This workspace ran out of credits part-way through. Top up and press Retry — you have only been charged for the steps that finished.";
  }
  if (text.includes("voice") && text.includes("assign")) {
    return "Every speaker needs a voice before the narration can be recorded. Assign them on the voices screen, then press Retry.";
  }
  if (text.includes("no script")) {
    return "There is no script to work from. Write one or generate it from a source, then press Retry.";
  }
  if (text.includes("api key") || text.includes("not configured")) {
    /* An operator problem, not the customer's — so it does not tell them to
     * retry into the same wall. */
    return "One of the services this needs is unavailable right now. We have been notified; please try again later.";
  }

  return "Something went wrong part-way through and the run stopped. Your held credits have been refunded — press Retry to try again.";
}

/**
 * SOURCE OF TRUTH KEYWORDS: notifyIfRequested, EMAIL_IS_OPT_IN,
 *   ADDRESS_IS_RESOLVED_NOT_STORED
 *
 * WHAT:  Sends the "your video is ready" email, if somebody asked for one.
 *
 * WHY:   EMAIL_IS_OPT_IN and the opt-in lives on the PROJECT, not on the event
 *        — the customer ticks the box while the run is already going, and an
 *        event payload cannot be edited after it is sent
 *        (GENERATE_SETTINGS_LIVE_ON_THE_PROJECT).
 *
 *        ADDRESS_IS_RESOLVED_NOT_STORED: the settings hold a USER ID and the
 *        address is looked up now. Storing the address would copy personal data
 *        into a jsonb blob that `projects.duplicate` copies verbatim, and it
 *        would go stale the moment they changed it.
 *
 *        Every failure here is swallowed and logged. The video is finished and
 *        the project is already `ready`; a dead mail provider must not turn a
 *        successful run into a failed one, which is also why this is a step of
 *        its own rather than a tail on `finalize`.
 * WHERE: The last step of the handler.
 */
async function notifyIfRequested(args: {
  organizationId: string;
  projectId: string;
}): Promise<{ notified: boolean }> {
  const { organizationId, projectId } = args;

  try {
    const settings = await readGenerateSettings(
      prisma,
      organizationId,
      projectId,
    );
    if (settings === null || !settings.notifyWhenDone) return { notified: false };

    const userId = settings.notifyUserId;
    if (userId === undefined) {
      console.warn(
        `[project.generate] ${projectId}: an email was requested but no recipient was recorded.`,
      );
      return { notified: false };
    }

    const [recipient, project] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      }),
      prisma.project.findFirst({
        where: { id: projectId, organizationId },
        select: { title: true },
      }),
    ]);

    if (recipient === null || project === null) return { notified: false };

    const result = await sendProjectReadyEmail({
      to: recipient.email,
      recipientName: recipient.name,
      projectId,
      projectTitle: project.title,
    });
    return { notified: result.success };
  } catch (error) {
    console.error(
      `[project.generate] ${projectId}: the completion email could not be sent:`,
      error,
    );
    return { notified: false };
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatList, SPEAKERS_ARE_NAMED
 *
 * "OP and A", not "OP,A". The message goes straight onto a progress screen, so
 * it has to read like a sentence — the phase asks for a disabled button with
 * the speakers NAMED, and a comma-joined array is a debug string.
 */
function formatList(values: readonly string[]): string {
  if (values.length === 0) return "every speaker";
  if (values.length === 1) return values[0] ?? "every speaker";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
