/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: portalRouter, portalProcedure, portal.videoOps,
 *   portal.listModeration, portal.reviewModeration, VIDEO_OPS_IS_ONE_READ
 *
 * WHAT:  Platform-admin (portal) endpoints — a public-to-any-user `getAccess`
 *        plus admin-gated cross-tenant reads (organizations, users, overview,
 *        activity, and from Phase 10 the video-operations console and the
 *        moderation review queue).
 * WHY:   Portal data spans ALL organizations, so these run on authProcedure (an
 *        identity, no org scope) rather than the org-scoped protectedProcedure.
 *        `portalProcedure` adds the platform-admin gate (owner email or portal
 *        membership) on top. `getAccess` stays ungated so the tenant UI can ask
 *        "should I show the Platform-admin link?" for the current user.
 * WHERE: Mounted as `portal` in src/trpc/routers/_app. Delegates to
 *        src/services/portal.service.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter } from "../init";
import { authProcedure } from "../procedures";
import { isPortalEnabled } from "@/lib/config/portal";
import {
  resolvePortalAdmin,
  listAllOrganizations,
  listAllUsers,
  getPortalOverview,
  listPlatformActivity,
} from "@/services/portal.service";
import {
  DEFAULT_OPS_DAYS,
  costVersusCharged,
  providerHealth,
  queueDepth,
  renderTimePercentiles,
  stageFailureRates,
  videosPerDayByKind,
  windowFromDays,
} from "@/services/video-ops.service";
import {
  countModerationByStatus,
  listModerationRecords,
  overrideModeration,
} from "@/services/moderation.service";
import {
  listModerationRecordsSchema,
  moderationSubjectTypeSchema,
  moderationVerdictStatusSchema,
} from "@/lib/types/moderation";
import { setModerationStatus } from "@/services/assets.service";
import { prisma } from "@/lib/config/prisma";
import { logLine } from "@/lib/observability";

const PORTAL_PAGE_SIZE = 25;

function pageInput() {
  return z.object({ page: z.number().int().positive().optional() });
}

function toSkip(page: number | undefined): number {
  return ((page ?? 1) - 1) * PORTAL_PAGE_SIZE;
}

/* Platform-admin gate: logged-in AND (owner email OR portal-org member). */
const portalProcedure = authProcedure.use(async ({ ctx, next }) => {
  const isAdmin = await resolvePortalAdmin({
    id: ctx.user.id,
    email: ctx.user.email,
  });
  if (!isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Platform admin access required",
    });
  }
  return next();
});

export const portalRouter = createTRPCRouter({
  /* Ungated (authed): lets the tenant UI decide whether to surface the portal
   * link for the current user without leaking who the owner is. */
  getAccess: authProcedure.query(async ({ ctx }) => ({
    enabled: isPortalEnabled(),
    isPortalAdmin: await resolvePortalAdmin({
      id: ctx.user.id,
      email: ctx.user.email,
    }),
  })),

  getOverview: portalProcedure.query(() => getPortalOverview()),

  listOrganizations: portalProcedure
    .input(pageInput())
    .query(({ input }) =>
      listAllOrganizations(toSkip(input.page), PORTAL_PAGE_SIZE),
    ),

  listUsers: portalProcedure
    .input(pageInput())
    .query(({ input }) => listAllUsers(toSkip(input.page), PORTAL_PAGE_SIZE)),

  listActivity: portalProcedure
    .input(pageInput())
    .query(({ input }) =>
      listPlatformActivity(toSkip(input.page), PORTAL_PAGE_SIZE),
    ),

  /**
   * SOURCE OF TRUTH KEYWORDS: portal.videoOps, VIDEO_OPS_IS_ONE_READ
   *
   * WHAT:  Everything the video-operations console shows: volume by format,
   *        failure rate by stage, render p95, cost against revenue, provider
   *        health and queue depth.
   *
   * WHY:   VIDEO_OPS_IS_ONE_READ — six panels, ONE procedure. The alternative
   *        was a procedure per panel, and it is worse here for a specific
   *        reason: every panel is a different aggregate over the SAME window,
   *        so six procedures would mean six round trips whose windows could
   *        drift apart while the page loaded, and a console whose panels
   *        disagree about what "last 7 days" means is one nobody trusts.
   *
   *        The six reads run concurrently, so the latency is the slowest of
   *        them rather than their sum.
   *
   *        A QUERY, so the factory writes no audit row — an operator opening a
   *        dashboard is not an event worth recording, and the console refetches.
   *        `days` is clamped by `windowFromDays`, so no caller can ask for a
   *        scan of the whole table.
   * WHERE: The console at /portal/videos.
   */
  videoOps: portalProcedure
    .input(
      z.object({
        days: z.number().int().positive().max(90).optional(),
      }),
    )
    .query(async ({ input }) => {
      const window = windowFromDays(input.days ?? DEFAULT_OPS_DAYS);

      const [volume, stages, renderTimes, economics, providers, queue, moderation] =
        await Promise.all([
          videosPerDayByKind(window),
          stageFailureRates(window),
          renderTimePercentiles(window),
          costVersusCharged(window),
          providerHealth(window),
          queueDepth(),
          countModerationByStatus(prisma, window.since),
        ]);

      return {
        days: input.days ?? DEFAULT_OPS_DAYS,
        since: window.since,
        volume,
        stages,
        renderTimes,
        economics,
        providers,
        queue,
        moderation,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: portal.listModeration, PLATFORM_WIDE_READ
   *
   * WHAT:  The moderation decision log, newest first, filterable by verdict.
   * WHY:   The phase's flagged queue. Cross-tenant by design — a safety queue
   *        split per workspace is one nobody works through — which is why it
   *        lives behind `portalProcedure` and takes no `organizationId`.
   * WHERE: /portal/videos/moderation.
   */
  listModeration: portalProcedure
    .input(listModerationRecordsSchema)
    .query(({ input }) =>
      listModerationRecords(
        prisma,
        {
          status: input.status,
          subjectType: input.subjectType,
        },
        { skip: toSkip(input.page), take: PORTAL_PAGE_SIZE },
      ),
    ),

  /**
   * SOURCE OF TRUTH KEYWORDS: portal.reviewModeration, APPEND_ONLY,
   *   REVIEW_UNBLOCKS_THE_ASSET
   *
   * WHAT:  An operator's decision on a held item.
   *
   * WHY:   REVIEW_UNBLOCKS_THE_ASSET, and it has to do BOTH halves to be
   *        useful. The decision is appended to the moderation log (never
   *        editing the classifier's row — APPEND_ONLY, because "the model
   *        flagged this and a person approved it" is the fact an appeal turns
   *        on), AND the asset's own `moderationStatus` is updated, because that
   *        column is what the render chokepoint consults
   *        (NOT_APPROVED_DOES_NOT_RENDER). Writing only the log would leave the
   *        operator's approval with no effect, which is the kind of bug a
   *        review queue hides for months.
   *
   *        It runs on `portalProcedure`, which is built on `authProcedure` and
   *        therefore gets NONE of `protectedProcedure`'s auto-wiring — no
   *        transaction, no usage counter and no audit row. That is correct for a
   *        cross-tenant operator action (there is no single tenant to scope or
   *        meter), but it means the audit trail is this handler's own
   *        responsibility rather than the factory's. It is discharged twice
   *        over: the appended moderation row carries the verdict and the
   *        operator's email, which is a better record than a generic activity
   *        entry, and the log line below carries the request id.
   * WHERE: The review buttons in the moderation queue.
   */
  reviewModeration: portalProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        subjectType: moderationSubjectTypeSchema,
        subjectId: z.string().min(1),
        status: moderationVerdictStatusSchema,
        note: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await overrideModeration(prisma, {
        organizationId: input.organizationId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: input.status,
        /* The operator's identity in the record itself — see the note on
         * `overrideModeration` for why it is here rather than in a column. */
        note: `${ctx.user.email}: ${input.note}`,
      });

      /* The half that actually unblocks the work. Only assets carry a
       * moderation column; a project or a prompt decision is advisory and is
       * acted on by the customer re-running the pipeline. */
      if (input.subjectType === "asset") {
        await setModerationStatus(
          prisma,
          input.subjectId,
          input.status === "approved" ? "approved" : "rejected",
        );
      }

      logLine({
        level: "warn",
        logger: "moderation",
        event: "operator_review",
        requestId: ctx.requestId,
        userId: ctx.user.id,
        organizationId: input.organizationId,
        data: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          verdict: input.status,
        },
      });

      return { reviewed: true };
    }),
});
