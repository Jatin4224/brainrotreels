/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: projectsRouter, projects.create, projects.list,
 *   projects.get, projects.rename, projects.delete, projects.duplicate,
 *   projects.generate, projects.cancel, projects.getStages, projects.progress,
 *   BRANCH_POLICY, EXPLICIT_GATE_ON_DUPLICATE, AUTO_DERIVED_FROM_RESOURCES,
 *   FIRST_SUBSCRIPTION, STREAM_AND_POLL_ARE_ONE_READ
 *
 * WHAT:  The CRUD surface for projects: create, paginated list, single read
 *        with its migrated timeline, rename, delete and duplicate.
 * WHY:   The plan limit and the usage counter are NOT declared here —
 *        AUTO_DERIVED_FROM_RESOURCES. `projects` carries a `limit` in
 *        src/lib/resources.ts, so the factory gates `projects.create` and bumps
 *        the counter on create and delete by itself. Declaring either here
 *        would double-count.
 *
 *        EXPLICIT_GATE_ON_DUPLICATE is the exception that proves it. The
 *        factory's gate fires on the path segment `create` and nothing else, so
 *        `duplicate` — which also produces a project — would slip past the cap
 *        and leave the counter one short of reality. It is therefore the ONE
 *        handler in this file that checks a gate and bumps a counter by hand.
 *        Renaming the verb to `createCopy` would have bought the automation
 *        back and lost the audit template and the client-side cache key, which
 *        is the worse trade.
 * WHERE: Mounted as `projects` in src/trpc/routers/_app.ts. Reads through
 *        src/services/projects.service.ts; the timeline document is migrated by
 *        src/lib/timeline before it leaves this file.
 */

import { TRPCError } from "@trpc/server";

import type { Prisma } from "@/generated/prisma";
import { enqueue } from "@/lib/adapters/jobs";
import { hasGenerator } from "@/lib/generators";
import {
  REDDIT_RETENTION_DAYS,
  isRedditExpired,
  redditExpiresAt,
  redditThreadSnapshotSchema,
} from "@/lib/types/reddit";
import { jsonObjectSchema } from "@/lib/types/json";

import { createStructuredError, createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { checkFeatureGate, getOrganizationTier } from "@/lib/feature-gate";
import { getUpgradeMessage } from "@/lib/resources";
import { checkDailyGenerationCap, requiresVerifiedEmail } from "@/lib/safety";
import { ERROR_CODES } from "@/lib/errors";
import { incrementUsage } from "@/services/usage.service";
import { signDocumentAssets } from "@/services/assets.service";
import {
  findProjectForOrganization,
  findProjectWithTimeline,
  listProjects,
} from "@/services/projects.service";
import {
  TimelineMigrationError,
  resolveWordAnchors,
  tryMigrate,
} from "@/lib/timeline";
import { collectAssetHandles, planComposition } from "@/lib/render";
import {
  createProjectSchema,
  deleteProjectSchema,
  duplicateProjectSchema,
  getProjectSchema,
  listProjectsSchema,
  previewProjectSchema,
  projectKindSchema,
  renameProjectSchema,
} from "@/lib/types";
import {
  PIPELINE_POLL_MS,
  isTerminalStageStatus,
  cancelProjectSchema,
  generateProjectSchema,
  projectProgressSchema,
  projectStagesSchema,
  type StageUpdate,
} from "@/lib/types/pipeline";
import {
  listStages,
  pipelineIdempotencyKey,
  releaseProjectHolds,
  setProjectStatus,
  writeGenerateSettings,
} from "@/services/pipeline.service";

export const projectsRouter = createTRPCRouter({
  /* No gate, no counter, no audit row written here — the factory does all three
   * because the path is `projects.create` and the registry entry has a limit. */
  create: protectedProcedure({ requirePermission: permissions.PROJECTS_CREATE })
    .input(createProjectSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.project.create({
        data: {
          organizationId: input.organizationId,
          title: input.title,
          kind: input.kind,
          aspect: input.aspect,
          ...(input.sourceRef !== undefined
            ? { sourceRef: input.sourceRef }
            : {}),
          ...(input.settings !== undefined ? { settings: input.settings } : {}),
        },
      }),
    ),

  list: protectedProcedure({
    requirePermission: permissions.PROJECTS_READ,
    paginate: true,
  })
    .input(listProjectsSchema)
    .query(async ({ ctx, input }) => {
      const { skip, take, pageSize } = ctx.pagination;
      const page = await listProjects(
        ctx.db,
        {
          organizationId: input.organizationId,
          search: input.search,
          kind: input.kind,
          status: input.status,
        },
        { skip, take },
      );
      /* SERVER_TOTAL_PAGES — computed here, against the pageSize the FACTORY
       * clamped to, so the client's pager cannot disagree with the query that
       * produced the rows. The service stays pure Prisma and does no maths. */
      return {
        ...page,
        totalPages: Math.max(1, Math.ceil(page.total / pageSize)),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.get, MIGRATE_ON_EVERY_READ
   *
   * WHAT:  One project with its timeline document, migrated to the current
   *        version before it is returned.
   * WHY:   MIGRATE_ON_EVERY_READ. The stored document may have been written by
   *        any previous release, and this is the boundary where that stops
   *        being true — nothing downstream of here handles an old version.
   *        A document that cannot be migrated returns `timeline: null` with the
   *        reasons attached rather than failing the whole query: the project
   *        page still has a title, a status and a delete button to offer, and a
   *        hard failure would strand the customer with no way to remove the
   *        broken project.
   * WHERE: The project detail screen; the editor in Phase 15.
   */
  get: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(getProjectSchema)
    .query(async ({ ctx, input }) => {
      const project = await findProjectWithTimeline(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      const { timeline, ...rest } = project;

      /**
       * SOURCE OF TRUTH KEYWORDS: reddit, RETENTION_IS_DERIVED_NOT_STORED,
       *   NOTHING_IS_SILENT
       *
       * Phase 12. For a Reddit story: what thread it was made from and when
       * our copy of that thread expires.
       *
       * NOTHING_IS_SILENT is the phase's own requirement — show the expiry
       * date rather than deleting silently — so the date is returned from the
       * moment the project exists, not once it is close. It is DERIVED from
       * `createdAt` rather than stored, so changing the window changes every
       * project's date at once instead of leaving old rows on the old one.
       *
       * `sourceExpired` is computed rather than inferred from the snapshot
       * being absent, because the two mean different things: a project whose
       * thread was swept is expired, and a project started from PASTED TEXT
       * never had a snapshot at all.
       */
      const redditBlock = redditBlockFor(rest);

      if (timeline === null) {
        return {
          ...rest,
          reddit: redditBlock,
          timeline: null,
          timelineErrors: [],
        };
      }

      const migrated = tryMigrate(timeline.doc);
      if (!migrated.ok) {
        return {
          ...rest,
          reddit: redditBlock,
          timeline: null,
          timelineErrors: migrated.errors,
        };
      }

      return {
        ...rest,
        reddit: redditBlock,
        timeline: {
          doc: migrated.doc,
          revision: timeline.revision,
          updatedAt: timeline.updatedAt,
        },
        timelineErrors: [],
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.preview, RESOLVE_THEN_SIGN,
   *   PREVIEW_IS_A_READ, planComposition, signDocumentAssets
   *
   * WHAT:  Everything needed to PLAY a project: its document resolved to
   *        absolute times, a signed URL per asset, and the composition's
   *        canvas and frame count.
   * WHY:   A separate procedure from `get`, because the two answer different
   *        questions and cost different amounts. `get` returns a project for a
   *        screen to list or rename; this one signs a URL per asset and is
   *        therefore the expensive read — putting it on `get` would make every
   *        projects list page pay for media it never shows.
   *
   *        RESOLVE_THEN_SIGN, in that order and for a reason: the document is
   *        migrated, then run through `resolveWordAnchors()` so every time is
   *        an absolute second, and only then are assets signed. A renderer
   *        handed an anchored document draws nothing (SKIP_UNRESOLVED_ITEM), so
   *        signing first would mean paying for URLs nothing can use. Resolution
   *        is also what makes `planComposition` able to state a frame count.
   *
   *        The quality defaults to `preview`, which reads `proxy_480` — the
   *        pairing that keeps the browser responsive while the final render
   *        uses the master. A caller asking for `final` gets longer-lived URLs
   *        against the full-size variants; Phase 04's pre-flight is the caller
   *        that will.
   *
   *        PREVIEW_IS_A_READ: a query, so the factory writes no audit row and
   *        bumps no counter. Watching your own video is not an event worth
   *        recording, and Phase 04's `renders.create` is where a BILLED action
   *        starts.
   * WHERE: The player on /dashboard/projects/[id]/preview.
   */
  preview: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(previewProjectSchema)
    .query(async ({ ctx, input }) => {
      const project = await findProjectWithTimeline(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      const { timeline, ...rest } = project;
      if (timeline === null) {
        return {
          project: rest,
          doc: null,
          assets: {},
          composition: null,
          timelineErrors: [],
        };
      }

      const migrated = tryMigrate(timeline.doc);
      if (!migrated.ok) {
        return {
          project: rest,
          doc: null,
          assets: {},
          composition: null,
          timelineErrors: migrated.errors,
        };
      }

      const resolved = resolveWordAnchors(migrated.doc);
      const assets = await signDocumentAssets(
        ctx.db,
        collectAssetHandles(resolved),
        input.organizationId,
        input.quality ?? "preview",
      );

      return {
        project: rest,
        doc: resolved,
        assets,
        composition: planComposition(resolved),
        timelineErrors: [],
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.rename
   *
   * WHAT:  Changes a project's title and nothing else.
   * WHY:   A narrow verb rather than a general `update`, because the only other
   *        writable fields are `status` and `manualEdited`, and neither is the
   *        customer's to set — the pipeline owns one and the editor owns the
   *        other. A general update would have to defend each of them.
   *        The existence check is explicit so the error is NOT_FOUND rather
   *        than a Prisma P2025 surfacing as an internal error.
   * WHERE: The rename dialog on the projects list.
   */
  rename: protectedProcedure({ requirePermission: permissions.PROJECTS_UPDATE })
    .input(renameProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      return ctx.db.project.update({
        where: { id: existing.id },
        data: { title: input.title },
      });
    }),

  /* The counter decrement and the audit row are the factory's, as on create.
   * The Timeline row goes with it through the schema's onDelete: Cascade. */
  delete: protectedProcedure({ requirePermission: permissions.PROJECTS_DELETE })
    .input(deleteProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      return ctx.db.project.delete({ where: { id: existing.id } });
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.duplicate, EXPLICIT_GATE_ON_DUPLICATE,
   *   BRANCH_POLICY
   *
   * WHAT:  Copies a project and its timeline document into a new project.
   * WHY:   EXPLICIT_GATE_ON_DUPLICATE — see the file header for why this one
   *        handler checks the plan cap and bumps the counter itself. Both run
   *        inside the handler's transaction, so a failed copy cannot leave the
   *        counter inflated.
   *
   *        BRANCH_POLICY: `parentId` is set to the SOURCE project. That is the
   *        same link a regeneration of a manually-edited project will use in
   *        Phase 15, deliberately — a copy and a branch are the same shape, and
   *        giving them two shapes would mean the version history could not show
   *        them in one tree. `manualEdited` is NOT copied: the duplicate has
   *        had no manual work done to it yet, and inheriting the flag would
   *        make the first regeneration branch again for no reason.
   *
   *        The document is copied verbatim, un-migrated. Migrating on copy
   *        would mean a duplicate renders differently from the original it was
   *        taken from, which is exactly what someone duplicating a finished
   *        video does not want; `get` migrates on read, as everything does.
   * WHERE: The row menu on the projects list.
   */
  duplicate: protectedProcedure({
    requirePermission: permissions.PROJECTS_CREATE,
    audit: { action: "duplicate" },
  })
    .input(duplicateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const source = await findProjectWithTimeline(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      /* Built to the same shape the factory's own gate throws, so the client's
       * upgrade modal opens identically whether the cap was hit by `create` or
       * by `duplicate` — see UPGRADE_COPY_FROM_REGISTRY in protected.ts. */
      const gate = await checkFeatureGate(input.organizationId, "projects", 1);
      if (!gate.allowed) {
        throw createStructuredError(
          "FORBIDDEN",
          gate.reason || "Plan limit reached",
          {
            errorCode: ERROR_CODES.USAGE_LIMIT_REACHED,
            resource: "projects",
            limit: gate.limit ?? 0,
            current: gate.currentUsage ?? 0,
            currentPlan: gate.plan,
            upgradeRequired: true,
            message:
              gate.reason || "You have reached your plan limit for projects",
            upgradeMessage: gate.upgradeMessage,
          },
        );
      }

      const copy = await ctx.db.project.create({
        data: {
          organizationId: source.organizationId,
          title: input.title ?? `Copy of ${source.title}`,
          kind: source.kind,
          aspect: source.aspect,
          parentId: source.id,
          ...(source.sourceRef !== null ? { sourceRef: source.sourceRef } : {}),
          ...(source.settings !== null ? { settings: source.settings } : {}),
        },
      });

      if (source.timeline !== null) {
        await ctx.db.timeline.create({
          data: {
            projectId: copy.id,
            docVersion: source.timeline.docVersion,
            /* `doc` is a non-nullable Json column that Prisma still READS as
             * the nullable JsonValue, so a round-trip through a write needs
             * this. Same pattern and same reason as
             * src/services/activity-log.service.ts:188. */
            doc: source.timeline.doc as Prisma.InputJsonValue,
            revision: 0,
          },
        });
      }

      await incrementUsage(input.organizationId, "projects", 1, ctx.db);
      return copy;
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.generate, ONE_CLICK_ONE_RUN,
   *   IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE, REFUSE_AN_UNBUILT_FORMAT,
   *   CREDITS_ARE_REFUSED_BY_THE_CHILDREN
   *
   * WHAT:  Starts the whole pipeline: script, cast, narration, caption timing,
   *        document.
   *
   * WHY:   ONE_CLICK_ONE_RUN. The handler does almost nothing — it checks what
   *        can be checked for free, records the "email me" choice, and enqueues.
   *        A mutation runs inside a 10-second Prisma transaction and this work
   *        takes minutes across three providers, so anything other than an
   *        enqueue here would be a request that times out while the work it
   *        started carries on invisibly.
   *
   *        IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE is the phase's "two rapid
   *        identical generate requests produce exactly one run", and it is
   *        enforced by the enqueue KEY rather than by a status check. A status
   *        check cannot work: both requests read `draft` before either writes
   *        `generating`, which is the classic double-submit race. The key is
   *        computed from the project's inputs, so two identical clicks collapse
   *        to one run inside the queue itself — see
   *        `pipelineIdempotencyKey`. The `generating` check below is still worth
   *        having, but as an ANSWER for the UI ("it is already running") rather
   *        than as the guarantee.
   *
   *        REFUSE_AN_UNBUILT_FORMAT: three of the four kinds have no generator
   *        until Phases 12, 13 and 16. They are refused HERE, before a run
   *        starts, with the format named — rather than after a pipeline has
   *        written a script and recorded a narration and then discovered it
   *        cannot assemble them. The workflow re-checks anyway
   *        (UNBUILT_KIND_IS_NAMED), because a kind could be changed between the
   *        click and the run.
   *
   *        CREDITS_ARE_REFUSED_BY_THE_CHILDREN, deliberately. There is no
   *        balance check here, unlike `scripts.generate` and `renders.create`:
   *        this run's cost is the sum of three jobs whose sizes are not known
   *        until the script exists, so any number this handler could compare
   *        against would be a guess. Each child refuses with its own exact
   *        figure, and the pipeline turns that into a plain-language stage
   *        failure with the credits released (RELEASE_ON_FAILURE). A guessed
   *        paywall here would refuse runs that would have succeeded.
   *
   *        THREE GUARDRAILS, added in Phase 10, all of them pre-flight: a
   *        verified email on the free tier, the per-plan daily cap, and the
   *        registry's burst limit. The first two are explicit below; the THIRD
   *        is not, because the procedure factory applies `rateLimit.generate`
   *        off the path verb (DAILY_CAP_ON_GENERATE in src/lib/resources.ts).
   *
   *        The burst limit and the daily cap are not redundant and neither
   *        replaces the other: 30 an hour stops a loop, and 5 a day stops a
   *        free workspace running up a provider bill all afternoon at a
   *        perfectly human pace.
   * WHERE: The Generate button on the project's generate screen.
   */
  generate: protectedProcedure({
    requirePermission: permissions.PROJECTS_GENERATE,
    audit: { action: "generate" },
  })
    .input(generateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!project)
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      /* REFUSE_AN_UNBUILT_FORMAT — the kind column is a String, so an
       * unrecognised value lands here too and gets the same honest answer. */
      const kind = projectKindSchema.safeParse(project.kind);
      if (!kind.success || !hasGenerator(kind.data)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${project.kind} videos cannot be generated yet. Only voiceover projects can.`,
        });
      }

      /* LAUNCH_GUARDRAILS, both before anything is enqueued. They run AFTER
       * the format refusal above because that one is free, and BEFORE the
       * settings write below because a refused request should leave nothing
       * behind.
       *
       * The plan is read ONCE and both guardrails use it: two reads could
       * disagree across an upgrade that landed between them. */
      const tier = await getOrganizationTier(input.organizationId);

      /* VERIFICATION_IS_A_GENERATION_GATE. Better Auth already enforces
       * verification at sign-in; this is the separate check the phase asks
       * for, and it exists because a free workspace is allowed to look around
       * before we know its address is real. */
      if (requiresVerifiedEmail(tier.tier) && !ctx.user.emailVerified) {
        throw createStructuredError(
          "FORBIDDEN",
          "Verify your email address before generating a video.",
          {
            errorCode: ERROR_CODES.EMAIL_NOT_VERIFIED,
            email: ctx.user.email,
            message:
              "Check your inbox for the verification link, then try again.",
          },
        );
      }

      /* A_RATE_NOT_A_QUOTA — the per-plan daily cap. It CONSUMES an allowance,
       * so it is the last refusal in the handler: anything checked after it
       * would be refusing a request whose allowance had already been spent.
       * The idempotency key on the enqueue is what keeps a double-clicked
       * button from spending two.
       *
       * Reported as USAGE_LIMIT_REACHED rather than RATE_LIMITED because
       * upgrading genuinely raises it — the client should open the upgrade
       * modal, not tell the customer to slow down. The reset hint is in the
       * message the cap built. */
      const cap = await checkDailyGenerationCap(
        input.organizationId,
        tier.tier,
      );
      if (!cap.allowed) {
        throw createStructuredError("FORBIDDEN", cap.message, {
          errorCode: ERROR_CODES.USAGE_LIMIT_REACHED,
          resource: "projects",
          limit: cap.limit ?? 0,
          current: cap.limit ?? 0,
          currentPlan: tier.tier,
          upgradeRequired: true,
          message: cap.message,
          upgradeMessage: getUpgradeMessage("projects", tier.tier),
        });
      }

      if (project.status === "generating" && input.force !== true) {
        /* Not an error: the customer pressed a button that is already doing
         * what they asked for, and the screen they are on is the progress
         * screen. An error toast here would be noise on a working run. */
        return { queued: false, alreadyRunning: true };
      }

      /* Recorded BEFORE the enqueue, so the run cannot reach its `notify` step
       * before the preference it reads has been written. SETTINGS_ARE_MERGED —
       * only the `generate` key is touched. */
      if (input.notifyWhenDone !== undefined) {
        await writeGenerateSettings(ctx.db, input.organizationId, input.id, {
          notifyWhenDone: input.notifyWhenDone,
          /* ADDRESS_IS_RESOLVED_NOT_STORED — the id, never the address. */
          ...(input.notifyWhenDone ? { notifyUserId: ctx.user.id } : {}),
        });
      }

      const idempotencyKey = await pipelineIdempotencyKey(
        ctx.db,
        input.organizationId,
        input.id,
        { force: input.force === true },
      );

      await enqueue({
        requestId: ctx.requestId,
        name: "project/requested",
        data: { projectId: input.id, organizationId: input.organizationId },
        id: idempotencyKey,
      });

      return { queued: true, alreadyRunning: false };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.cancel, CANCEL_IS_THREE_WRITES,
   *   CANCEL_RELEASES_EVERY_HOLD
   *
   * WHAT:  Stops a running generation.
   *
   * WHY:   CANCEL_IS_THREE_WRITES, and all three are needed because Inngest
   *        does NOT run a function's `onFailure` when a run is cancelled —
   *        there is no failure, so the cleanup the failure path performs never
   *        happens:
   *
   *          The EVENT stops the run, and the children with it: the pipeline
   *          and all three sub-workflows carry a `cancelOn` matching this
   *          event's `projectId` (CANCEL_STOPS_PAID_WORK), so a cancel during
   *          narration stops the narration rather than paying for audio nobody
   *          will hear.
   *
   *          The STATUS write is what the projects list reads. Left alone, a
   *          cancelled project would sit at `generating` forever with no run
   *          behind it.
   *
   *          The HOLD RELEASE is the money. Each child holds credits under its
   *          own ledger reference and settles them itself on the happy path; a
   *          cancellation is the one exit where nobody settles, so the holds
   *          are released here, by name, for this project only — see
   *          CANCEL_RELEASES_EVERY_HOLD.
   *
   *        The writes happen BEFORE the event is sent, deliberately. If the
   *        send fails the customer is told, and they are left with a cancelled
   *        project and no held credits rather than a `generating` project with
   *        money reserved against it. The worst case is a run that finishes
   *        work nobody is charged for, which is strictly better than the
   *        reverse.
   * WHERE: The Cancel button on the progress screen.
   */
  cancel: protectedProcedure({
    requirePermission: permissions.PROJECTS_CANCEL,
    audit: { action: "cancel" },
  })
    .input(cancelProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.id,
      );
      if (!project)
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      if (project.status !== "generating") {
        return { cancelled: false, released: 0 };
      }

      await setProjectStatus(
        ctx.db,
        input.organizationId,
        input.id,
        "cancelled",
      );
      const released = await releaseProjectHolds(
        ctx.db,
        input.id,
        "generation cancelled",
      );

      await enqueue({
        requestId: ctx.requestId,
        name: "project/cancelled",
        data: { projectId: input.id, organizationId: input.organizationId },
        /* No idempotency key. Cancelling twice is harmless — the second event
         * finds nothing to cancel — and a key would make a SECOND cancel of a
         * re-started run silently do nothing. */
      });

      return { cancelled: true, released };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.getStages, STREAM_AND_POLL_ARE_ONE_READ,
   *   PIPELINE_POLL_MS
   *
   * WHAT:  Every stage of a project's pipeline, with its status and elapsed
   *        time.
   *
   * WHY:   STREAM_AND_POLL_ARE_ONE_READ. This is the phase's step 7 — the
   *        fallback for clients and proxies that will not hold a stream, and
   *        the read Phase 17's REST API uses, which must not depend on SSE at
   *        all. It returns exactly what `progress` yields (`StageUpdate[]`), so
   *        the component renders one shape and neither transport has a
   *        renderer of its own.
   *
   *        A query, so the factory writes no audit row: watching a progress
   *        bar is not an event worth recording, and at a two-second poll it
   *        would be the single largest producer of audit rows in the app.
   * WHERE: The progress screen's fallback poll, and Phase 17's REST read.
   */
  getStages: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(projectStagesSchema)
    .query(({ ctx, input }) =>
      listStages(ctx.db, input.organizationId, input.projectId),
    ),

  /**
   * SOURCE OF TRUTH KEYWORDS: projects.progress, FIRST_SUBSCRIPTION,
   *   SNAPSHOT_NOT_DELTA, WHY_THE_SERVER_POLLS, PROGRESS_STREAM_MAX_MS
   *
   * WHAT:  Stage transitions, pushed as they happen.
   *
   * WHY:   FIRST_SUBSCRIPTION — the first `.subscription()` in this codebase,
   *        and it needed no new infrastructure, which is the point. The SSE
   *        transport has been configured and unused since Phase 00: `initTRPC`
   *        carries the `sse` block with its five-minute cap and ten-second
   *        ping, the client's `splitLink` already routes subscriptions to
   *        `httpSubscriptionLink`, and the route already sets
   *        `X-Accel-Buffering: no` so no proxy buffers the chunks.
   *
   *        SNAPSHOT_NOT_DELTA. Each yield is the COMPLETE stage list, not the
   *        one row that changed. A delta stream would be smaller and would be
   *        wrong the first time a client missed an event: twelve rows is under
   *        a kilobyte, and a snapshot makes reconnection trivially correct —
   *        the client throws away what it had and renders what arrived, so
   *        there is no state to resynchronise and no `tracked()` id to resume
   *        from.
   *
   *        WHY_THE_SERVER_POLLS, and it is worth being plain about: there is no
   *        pub/sub in this stack. The writes come from Inngest workers in other
   *        processes, so nothing in THIS process can be notified when a stage
   *        row changes — the only honest options are a database poll or new
   *        infrastructure. The poll lives on the SERVER rather than in the
   *        browser, which is what the customer actually gains: one HTTP
   *        connection instead of a request every two seconds, no tab-throttling
   *        of a background timer, and a transition on screen within the poll
   *        interval of it being written. If a real pub/sub arrives, the change
   *        is the body of this loop and nothing else — the client, the fallback
   *        query and the component are all unaffected.
   *
   *        PROGRESS_STREAM_MAX_MS stops the generator just under the transport's
   *        own five-minute cap, so the server closes a finished stream cleanly
   *        and the client reconnects (and immediately receives a fresh
   *        snapshot) rather than the connection being severed mid-yield. The
   *        loop also returns the moment nothing can change again, so a stream
   *        watching a finished run does not hold a connection for five minutes
   *        polling a row that will never move.
   * WHERE: The progress screen. Falls back to `getStages` when the stream drops
   *        — see STREAM_AND_POLL_ARE_ONE_READ.
   */
  progress: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(projectProgressSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      let lastFingerprint = "";
      const closeAt = Date.now() + PROGRESS_STREAM_MAX_MS;

      while (!signal?.aborted && Date.now() < closeAt) {
        const stages = await listStages(
          ctx.db,
          input.organizationId,
          input.projectId,
        );

        /* Only yield on a CHANGE. An unchanged snapshot every two seconds
         * would re-render the list — and re-trigger its aria-live
         * announcement — for a run that is sitting in a provider call. The
         * fingerprint deliberately excludes `elapsedMs`, which ticks on every
         * read by construction and would make every snapshot a change. */
        const fingerprint = fingerprintStages(stages);
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          yield stages;
        }

        /* Nothing can change again: every stage has reached a terminal state.
         * Returning closes the stream, which is what tells the client to stop
         * holding a connection open. */
        if (stages.every((stage) => isTerminalStageStatus(stage.status))) return;

        await sleep(PIPELINE_POLL_MS, signal);
      }
    }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: PROGRESS_STREAM_MAX_MS
 *
 * Just under the `sse.maxDurationMs` configured on `initTRPC` (five minutes).
 * The generator returning is a clean close the client reconnects from; the
 * transport hitting its own cap severs the response mid-stream.
 */
const PROGRESS_STREAM_MAX_MS = 4 * 60 * 1_000;

/**
 * SOURCE OF TRUTH KEYWORDS: fingerprintStages, SNAPSHOT_NOT_DELTA
 *
 * WHAT:  A string that changes exactly when something worth re-rendering has
 *        changed.
 * WHY:   `elapsedMs` is excluded on purpose — it is derived from the clock on
 *        every read (ELAPSED_IS_DERIVED_ON_THE_SERVER), so including it would
 *        make every poll a "change" and defeat the comparison entirely. The
 *        client renders a running stage's elapsed time from its own ticking
 *        clock, which is what a stopwatch wants anyway.
 * WHERE: The `progress` loop above.
 */
function fingerprintStages(stages: readonly StageUpdate[]): string {
  return stages
    .map((stage) => `${stage.stage}:${stage.status}:${stage.error ?? ""}`)
    .join("|");
}

/**
 * SOURCE OF TRUTH KEYWORDS: sleep, ABORTABLE_SLEEP
 *
 * WHAT:  A delay that ends early when the client disconnects.
 * WHY:   ABORTABLE_SLEEP. A bare `setTimeout` promise would keep the loop — and
 *        its database handle — alive for the rest of the interval after the
 *        browser has gone, which at a two-second poll means every closed tab
 *        leaves one more query in flight. The listener is removed on both exits
 *        so a long stream does not accumulate them on one signal.
 * WHERE: The `progress` loop above.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/* Re-exported so a caller catching a failed migration from `get` does not have
 * to reach into the timeline module for the error class. */
export { TimelineMigrationError };

/**
 * SOURCE OF TRUTH KEYWORDS: redditBlockFor, RETENTION_IS_DERIVED_NOT_STORED,
 *   NOTHING_IS_SILENT, SNAPSHOT_IS_WHAT_THE_CARD_SHOWS
 *
 * WHAT:  The Reddit facts `projects.get` returns, or null for every other
 *        format.
 *
 * WHY:   NOTHING_IS_SILENT. The phase requires the expiry date to be on the
 *        project screen rather than a thread disappearing without warning, so
 *        the date is returned from the moment a Reddit project exists — not
 *        once it is nearly due. It is DERIVED from `createdAt`
 *        (RETENTION_IS_DERIVED_NOT_STORED), so an operator changing the window
 *        changes every project's date at once instead of leaving old rows on
 *        the old one.
 *
 *        `sourceExpired` is COMPUTED from the date rather than inferred from
 *        the snapshot being absent, because the two mean genuinely different
 *        things and the UI words them differently: a project whose thread the
 *        sweep removed is expired, and a project started from PASTED TEXT
 *        never had a snapshot at all.
 *
 *        Only the snapshot's display fields are returned. The stored thread
 *        BODY and its comments are not — nothing on a screen shows them, and
 *        putting somebody else's full thread in a tRPC response that a browser
 *        caches would be a copy of it in one more place.
 * WHERE: `projects.get`.
 */
function redditBlockFor(project: {
  kind: string;
  createdAt: Date;
  sourceRef: string | null;
  settings: Prisma.JsonValue;
}): {
  expiresAt: string;
  retentionDays: number;
  sourceExpired: boolean;
  thread: {
    url: string;
    title: string;
    subreddit: string;
    author: string;
    commentCount: number;
  } | null;
} | null {
  if (project.kind !== "reddit-story") return null;

  const bag = jsonObjectSchema.safeParse(project.settings);
  const snapshot = redditThreadSnapshotSchema.safeParse(
    bag.success ? bag.data["reddit"] : undefined,
  );

  return {
    expiresAt: redditExpiresAt(project.createdAt).toISOString(),
    retentionDays: REDDIT_RETENTION_DAYS,
    sourceExpired: isRedditExpired(project.createdAt),
    thread: snapshot.success
      ? {
          url: snapshot.data.url,
          title: snapshot.data.title,
          subreddit: snapshot.data.subreddit,
          author: snapshot.data.author,
          commentCount: snapshot.data.commentCount,
        }
      : null,
  };
}
