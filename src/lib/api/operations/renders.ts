/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: createRenderOperation, getRenderOperation,
 *   REUSE_COSTS_NOTHING, THE_OPERATION_REPORTS_THE_SURFACE_METERS,
 *   REFUSE_BEFORE_PAYING, WATERMARK_RESOLVED_ONCE,
 *   RENDER_STARTS_OUTSIDE_THE_REQUEST, DOWNLOAD_URL_IS_SIGNED_ON_READ
 *
 * WHAT:  Starting a render and reading one back.
 *
 * WHY:   THE_OPERATION_REPORTS_THE_SURFACE_METERS is the decision that made
 *        this file possible, and it is worth reading before changing anything
 *        here.
 *
 *        REUSE_COSTS_NOTHING: a render of a document that has already been
 *        rendered at this resolution returns the existing row and must not
 *        spend a slot from the monthly `renders` quota. On the web that is not
 *        simply "don't increment" — the procedure factory increments the
 *        counter automatically on any successful `<resource>.create`, and it
 *        cannot see that the handler reused a row. The router therefore posts
 *        a compensating `-1`.
 *
 *        That compensation is SURFACE KNOWLEDGE and it stays in the router.
 *        This operation has no way to know whether a `+1` is coming — the REST
 *        surface will meter explicitly and must not post a `-1` at all, or it
 *        would hand out free renders. So the operation does the work and
 *        REPORTS WHAT HAPPENED (`reused`), and each surface meters according
 *        to its own pipeline. An operation that tried to meter would be wrong
 *        on at least one surface, and silently.
 *
 *        REFUSE_BEFORE_PAYING, with the original ordering preserved exactly:
 *        reuse is checked BEFORE credits, because a render that costs nothing
 *        must not be refused for lack of credits — the customer already paid
 *        for that file. Credits are checked BEFORE the row, because a refusal
 *        must leave no trace: a queued `Render` that was never affordable
 *        would show in the panel as a render about to start that never will.
 *
 *        WATERMARK_RESOLVED_ONCE. The watermark is decided here, not in the
 *        workflow, because it is part of the CACHE KEY: the same document
 *        rendered with and without a watermark is two different files, and
 *        resolving it later would let a workspace that upgraded mid-queue
 *        receive the watermarked render it had already paid to replace.
 *
 *        RENDER_STARTS_OUTSIDE_THE_REQUEST — this validates, decides, writes a
 *        row and enqueues, then returns. It never calls the render provider. A
 *        mutation runs inside a short transaction and a provider round trip
 *        that splits a frame range across a hundred functions does not belong
 *        in one.
 * WHERE: `renders.create` / `renders.get`; POST /renders and GET /renders/:id
 *        (17b); `start_render` / `get_render` (17c).
 */

import "server-only";

import { enqueue } from "@/lib/adapters/jobs";
import { estimateRenderCost } from "@/lib/credits";
import { ERROR_CODES, OperationError } from "@/lib/errors";
import { checkBooleanFeature } from "@/lib/feature-gate";
import { planComposition, renderCacheKey } from "@/lib/render";
import { resolveWordAnchors, tryMigrate, validate } from "@/lib/timeline";
import { signAssetUrl } from "@/services/assets.service";
import { getBalance } from "@/services/credits.service";
import { findProjectWithTimeline } from "@/services/projects.service";
import * as rendersService from "@/services/renders.service";
import type { OperationContext } from "@/lib/types/api";
import {
  FINAL_URL_TTL_SECONDS,
  isResolutionAllowedForPlan,
  resolutionsForPlan,
  type CreateRenderValues,
} from "@/lib/types/render";

export type CreateRenderInput = Omit<CreateRenderValues, "organizationId">;

export async function createRenderOperation(
  ctx: OperationContext,
  input: CreateRenderInput,
) {
  const project = await findProjectWithTimeline(
    ctx.db,
    ctx.organizationId,
    input.projectId,
  );
  if (project === null) {
    throw new OperationError("not_found", "Project not found");
  }

  if (project.timeline === null) {
    throw new OperationError(
      "precondition",
      "This project has no timeline yet. Generate one before rendering.",
    );
  }

  /* LOCKED_NOT_HIDDEN is a client affordance; this is the boundary. A disabled
   * radio stops a mistake, not a request — and a REST caller has no radio. */
  if (!isResolutionAllowedForPlan(ctx.plan, input.resolution)) {
    throw new OperationError(
      "refused",
      `${input.resolution} rendering is not included in your plan. ` +
        `Available: ${resolutionsForPlan(ctx.plan).join(", ")}.`,
    );
  }

  const migrated = tryMigrate(project.timeline.doc);
  if (!migrated.ok) {
    throw new OperationError(
      "unprocessable",
      "This timeline was written in a format this version cannot open, so it cannot be rendered.",
    );
  }

  const resolved = resolveWordAnchors(migrated.doc);
  const validated = validate(resolved);
  if (!validated.ok) {
    throw new OperationError(
      "unprocessable",
      /* The first error only. `validate` returns one per problem and they are
       * usually one cause repeated; the panel renders this inline. */
      `This timeline cannot be rendered: ${validated.errors[0]?.message ?? "it is not valid."}`,
    );
  }

  /**
   * SOURCE OF TRUTH KEYWORDS: AN_EMPTY_TIMELINE_IS_REFUSED_HERE,
   *   planComposition, preflightFactsSchema
   *
   * A document with no items — or whose every item is zero-length — has a
   * length of 0, and nothing upstream rejects it: `timelineDocSchema` puts no
   * `.min(1)` on `tracks` or `items`, and `validate`'s checks are all about
   * items that DO exist. Deleting every clip in the Phase 15 editor produces
   * exactly this.
   *
   * It was caught eventually, by `preflightFactsSchema` requiring a positive
   * `durationInSeconds` — but that parse happens inside the workflow and
   * OUTSIDE any `step.run`, so it threw a raw ZodError, burned both retries,
   * and reached the customer as "Rendering this video did not finish. Please
   * try again." Retrying an empty timeline produces the same nothing.
   *
   * Refused here instead, where the panel renders the message inline and no
   * credits have moved. `precondition` rather than `unprocessable` because it
   * is an instruction: add something to the timeline and this works.
   */
  if (planComposition(validated.doc).durationInSeconds <= 0) {
    throw new OperationError(
      "precondition",
      "This timeline is empty — there is nothing to render yet.",
    );
  }

  /* WATERMARK_RESOLVED_ONCE — see the file header. */
  const watermarkFree = await checkBooleanFeature(
    ctx.organizationId,
    "watermarkFree",
  );
  const watermark = !watermarkFree.enabled;

  const docHash = renderCacheKey({
    doc: validated.doc,
    resolution: input.resolution,
    watermark,
  });

  const existing = await rendersService.findReusableRender(
    ctx.db,
    project.id,
    docHash,
  );
  if (existing !== null) {
    /* REUSE_COSTS_NOTHING. The caller is told, and the caller meters — see
     * THE_OPERATION_REPORTS_THE_SURFACE_METERS in the file header. */
    return { render: existing, reused: true, cost: null };
  }

  /**
   * SOURCE OF TRUTH KEYWORDS: REFUSE_BEFORE_PAYING, INSUFFICIENT_CREDITS
   *
   * This refuses on the ESTIMATE; the hold is placed by the workflow. The two
   * are separated because the gap between them is small and the alternative is
   * worse: holding here would put a credit movement inside the request's short
   * transaction, and a request that timed out after holding would strand the
   * money with no workflow in existence to release it.
   */
  const cost = estimateRenderCost({
    durationSeconds: planComposition(validated.doc).durationInSeconds,
    resolution: input.resolution,
  });

  const available = await getBalance(ctx.organizationId, ctx.db);
  if (available < cost.total) {
    throw new OperationError(
      "refused",
      `This render costs ${cost.total} credits and this workspace has ${available}.`,
      {
        errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
        resource: "credits",
        required: cost.total,
        available,
        message: `Not enough credits to render. ${cost.total} needed, ${available} available.`,
      },
    );
  }

  const render = await rendersService.createQueuedRender(ctx.db, {
    organizationId: ctx.organizationId,
    projectId: project.id,
    docHash,
    resolution: input.resolution,
    watermark,
  });

  /* Keyed on the render id, not on the document: a retry of the SAME row must
   * be able to enqueue again (it is a new attempt of a render the customer
   * asked for twice), while a double-click on one request must not produce two
   * runs. The id is unique per row, so both hold. */
  await enqueue({
    requestId: ctx.requestId,
    name: "render/requested",
    data: {
      renderId: render.id,
      organizationId: ctx.organizationId,
      attempt: render.attempts,
    },
    id: `render-${render.id}-attempt-${render.attempts}`,
  });

  /* The cost travels back so a caller can say what the render will cost
   * without re-deriving it — and so the number the customer is told is
   * provably the number that was checked against their balance. */
  return { render, reused: false, cost };
}

/**
 * SOURCE OF TRUTH KEYWORDS: getRenderOperation, DOWNLOAD_URL_IS_SIGNED_ON_READ
 *
 * WHAT:  One render, with a download URL when there is something to download.
 * WHY:   DOWNLOAD_URL_IS_SIGNED_ON_READ, with the LONG ttl rather than the
 *        short default: the URL is handed to a client that will download tens
 *        of megabytes, possibly on a phone on a train, and a link that expires
 *        mid-download is a failure the customer cannot explain. It is signed
 *        per request rather than stored, so revoking access is a matter of not
 *        signing again.
 * WHERE: See the file header.
 */
export async function getRenderOperation(
  ctx: OperationContext,
  input: { id: string },
) {
  const render = await rendersService.findRenderForOrganization(
    ctx.db,
    ctx.organizationId,
    input.id,
  );
  if (render === null) {
    throw new OperationError("not_found", "Render not found");
  }

  const [downloadUrl, posterUrl] = await Promise.all([
    render.outputAssetId === null
      ? Promise.resolve(null)
      : signAssetUrl(
          render.outputAssetId,
          ctx.organizationId,
          FINAL_URL_TTL_SECONDS,
        ),
    render.posterAssetId === null
      ? Promise.resolve(null)
      : signAssetUrl(
          render.posterAssetId,
          ctx.organizationId,
          FINAL_URL_TTL_SECONDS,
        ),
  ]);

  return { render, downloadUrl, posterUrl };
}
