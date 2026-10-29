/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: timelineRouter, timelineEditor.open,
 *   timelineEditor.applyOps, timelineEditor.revisions, timelineEditor.restore,
 *   timelineEditor.resynthLine, ApplyOpsResult, ONE_APPLY_TWO_CALLERS,
 *   REVISION_DECIDES_THE_RACE, RESOLVE_BEFORE_EDITING,
 *   AN_INVALID_DOCUMENT_IS_NOT_STORED, FIRST_EDIT_CLAIMS_THE_PROJECT,
 *   GATE_IS_THE_WHOLE_ROUTER
 *
 * WHAT:  The editor's server side: open a project for editing, save a batch of
 *        operations against a known revision, list and restore snapshots, and
 *        re-record one narration line.
 *
 * WHY:   ONE_APPLY_TWO_CALLERS is the whole point of the phase and it is why
 *        this router is thin. Every edit is `apply()` from src/lib/timeline —
 *        the SAME function the browser ran to draw the preview — so the server
 *        is not a second implementation of trim and split that has to be kept
 *        in step. What is left here is the part the browser cannot be trusted
 *        with: who owns the project, which revision it was edited from, and
 *        whether the result is a document we are willing to store.
 *
 *        GATE_IS_THE_WHOLE_ROUTER. Mounted under the registry key
 *        `timelineEditor`, which declares a `flag`, so the procedure factory
 *        refuses EVERY verb here — including `open` — for a plan that does not
 *        include the editor. That is the phase's "a free workspace cannot reach
 *        the editor, server-side included", and it is why the editor reads
 *        through `open` rather than reusing `projects.preview`: preview is a
 *        read every plan is entitled to, so routing the editor through it would
 *        leave the screen's data ungated.
 *
 *        REVISION_DECIDES_THE_RACE. The revision compare is not written here —
 *        it is the WHERE clause of the save (COMPARE_AND_SET in
 *        src/services/timeline.service.ts), so two tabs cannot both win no
 *        matter how the requests interleave. A conflict comes back as a STATUS
 *        rather than an exception, because two tabs is a thing people do and
 *        the answer is a choice the UI offers, not an error toast
 *        (CONFLICT_IS_A_RESULT_NOT_AN_ERROR).
 *
 *        RESOLVE_BEFORE_EDITING. The stored document may still position clips
 *        by word anchor; the ops refuse to touch one (CAPTIONS_FOLLOW_WORDS and
 *        the anchor refusal in requireTimed). So every read and every save runs
 *        `resolveWordAnchors` first and the save stores the RESOLVED document —
 *        which is the phase's step 8, "the editor begins writing absolute times
 *        instead of word anchors", implemented rather than merely intended.
 *
 *        AN_INVALID_DOCUMENT_IS_NOT_STORED. apply() returns a document even
 *        when the result breaks an invariant, because the editor needs
 *        something to render. The SERVER does not store that: a result whose
 *        errors are not all attributable to individual refused ops comes back
 *        as `rejected` with the reasons, the stored document is untouched, and
 *        the customer's screen keeps the broken state so they can fix it. The
 *        phase's contract names two statuses; this is the third, and it exists
 *        because the alternative is a saved timeline the render pre-flight will
 *        refuse with no way back.
 *
 *        FIRST_EDIT_CLAIMS_THE_PROJECT: every accepted save sets
 *        `manualEdited`, which is what makes `projects.generate` branch instead
 *        of overwrite (BRANCH_POLICY there).
 *
 * WHERE: Mounted as `timelineEditor` in src/trpc/routers/_app.ts. Reads and
 *        writes through src/services/timeline.service.ts; the document work is
 *        src/lib/timeline's; the re-record is handed to the `line/changed`
 *        workflow.
 */

import { TRPCError } from "@trpc/server";

import type { Prisma } from "@/generated/prisma";
import type { DbClient } from "@/lib/config/prisma";
import { enqueue } from "@/lib/adapters/jobs";
import { permissions } from "@/lib/permissions";
import { collectAssetHandles, planComposition } from "@/lib/render";
import {
  apply,
  resolveWordAnchors,
  restoreDocOp,
  tryMigrate,
  validate,
  type Op,
  type TimelineDoc,
  type ValidationError,
} from "@/lib/timeline";
import { jsonObjectSchema } from "@/lib/types/json";
import {
  applyOpsSchema,
  listRevisionsSchema,
  openTimelineSchema,
  restoreRevisionSchema,
  resynthLineSchema,
  type ApplyOpsResult,
  type TimelineWireError,
} from "@/lib/types";
import { signDocumentAssets } from "@/services/assets.service";
import { listNarrationLines } from "@/services/narration.service";
import * as timelineService from "@/services/timeline.service";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";

export const timelineRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: timelineEditor.open, RESOLVE_THEN_SIGN,
   *   PROXY_FOR_SCRUBBING, EDITOR_NEEDS_THE_LINES
   *
   * WHAT:  Everything the editor screen needs in one read: the resolved
   *        document, a signed proxy URL per asset, the composition's canvas and
   *        frame count, the revision to save against, and the narration lines.
   *
   * WHY:   RESOLVE_THEN_SIGN, in that order and for the reason
   *        `projects.preview` states: a renderer handed an anchored document
   *        draws nothing, so signing first would pay for URLs nothing can use.
   *        The quality is fixed at `preview`, which reads `proxy_480` —
   *        PROXY_FOR_SCRUBBING is what keeps a three-minute project smooth
   *        under the playhead, and an editor has no business requesting
   *        masters.
   *
   *        EDITOR_NEEDS_THE_LINES: the voice lane is the one track whose items
   *        are not self-describing. An audio item carries an assetId, and what
   *        a person wants to see is the SENTENCE — which lives on
   *        `NarrationLine` with the id `resynthLine` takes. Fetching them here
   *        rather than on a second query keeps the screen a single round-trip.
   * WHERE: The editor's use-timeline-editor hook.
   */
  open: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(openTimelineSchema)
    .query(async ({ ctx, input }) => {
      const project = await timelineService.findTimelineForEdit(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      if (project === null)
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const { timeline, ...rest } = project;

      /* The two empty states are different and say different things — the same
       * PREVIEW_EMPTY_STATES split the player screen makes. */
      if (timeline === null) {
        return {
          project: rest,
          doc: null,
          revision: 0,
          assets: {},
          composition: null,
          lines: [],
          timelineErrors: [],
        };
      }

      const migrated = tryMigrate(timeline.doc);
      if (!migrated.ok) {
        return {
          project: rest,
          doc: null,
          revision: timeline.revision,
          assets: {},
          composition: null,
          lines: [],
          timelineErrors: migrated.errors,
        };
      }

      const resolved = resolveWordAnchors(migrated.doc);
      const [assets, lines] = await Promise.all([
        signDocumentAssets(
          ctx.db,
          collectAssetHandles(resolved),
          input.organizationId,
          "preview",
        ),
        listNarrationLines(ctx.db, input.organizationId, input.projectId),
      ]);

      return {
        project: rest,
        doc: resolved,
        revision: timeline.revision,
        assets,
        composition: planComposition(resolved),
        lines,
        timelineErrors: [],
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: timelineEditor.applyOps, ApplyOpsResult,
   *   REVISION_DECIDES_THE_RACE, AUTOSAVE_IS_NOT_AUDITED
   *
   * WHAT:  Replays a batch of operations against the stored document and saves
   *        the result, or reports why it did not.
   * WHY:   AUTOSAVE_IS_NOT_AUDITED — `audit: false`, because this fires every
   *        second or so while somebody works and an activity log full of "saved
   *        the timeline" would bury every row anybody reads it for. The
   *        snapshot trail is this feature's history and it holds the document
   *        rather than a sentence about it.
   *
   *        No credit check and no usage counter: editing is free
   *        (EDITING_IS_FREE in the registry entry), and the money is charged
   *        when the result is rendered.
   * WHERE: The editor's debounced save.
   */
  applyOps: protectedProcedure({
    requirePermission: permissions.PROJECTS_UPDATE,
    audit: false,
  })
    .input(applyOpsSchema)
    .mutation(({ ctx, input }): Promise<ApplyOpsResult> =>
      saveOps(ctx.db, input, input.ops, input.revision),
    ),

  /**
   * SOURCE OF TRUTH KEYWORDS: timelineEditor.revisions, TimelineRevisionSummary
   *
   * WHAT:  The restore points for this project, newest first.
   * WHY:   Numbers and times only — see NO_DOCUMENT_IN_A_LIST in the service
   *        for why the documents stay out of a list that is rendered as a menu.
   * WHERE: The editor's history menu.
   */
  revisions: protectedProcedure({ requirePermission: permissions.PROJECTS_READ })
    .input(listRevisionsSchema)
    .query(({ ctx, input }) =>
      timelineService.listTimelineRevisions(
        ctx.db,
        input.organizationId,
        input.projectId,
      ),
    ),

  /**
   * SOURCE OF TRUTH KEYWORDS: timelineEditor.restore, restoreDoc,
   *   RESTORE_IS_AN_OP, HISTORY_IS_APPENDED_NOT_REWOUND
   *
   * WHAT:  Puts an earlier snapshot back as the current document.
   * WHY:   RESTORE_IS_AN_OP. It goes through the same `apply()` as every other
   *        edit, carrying one `restoreDoc` — so the snapshot is validated, the
   *        revision compare still guards it, and a restore of a document that
   *        no longer satisfies an invariant is refused rather than stored. The
   *        obvious implementation (write the jsonb straight back) would skip
   *        all three.
   *
   *        HISTORY_IS_APPENDED_NOT_REWOUND: restoring revision 4 writes a NEW
   *        revision whose document happens to be revision 4's. The counter
   *        never goes backwards, so a client holding revision 9 is correctly
   *        told it is stale, and the restore itself can be undone like any
   *        other edit.
   *
   *        It takes the CURRENT revision from the timeline rather than from the
   *        client: a restore is a deliberate "go back to this", chosen from a
   *        menu that was just fetched, and failing it for a stale revision
   *        would make the one recovery path the least reliable thing in the
   *        editor.
   * WHERE: The editor's history menu.
   */
  restore: protectedProcedure({
    requirePermission: permissions.PROJECTS_UPDATE,
    audit: { action: "restore" },
  })
    .input(restoreRevisionSchema)
    .mutation(async ({ ctx, input }): Promise<ApplyOpsResult> => {
      const snapshot = await timelineService.findTimelineRevision(
        ctx.db,
        input.organizationId,
        input.projectId,
        input.revision,
      );
      if (snapshot === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That version is no longer available",
        });

      const migrated = tryMigrate(snapshot);
      if (!migrated.ok)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That version was written in a format this one cannot open. Nothing has been lost — please contact support.",
        });

      return saveOps(
        ctx.db,
        input,
        [restoreDocOp(resolveWordAnchors(migrated.doc))],
        null,
      );
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: timelineEditor.resynthLine, line/changed,
   *   LINE_EDIT_INVALIDATES_ONE_LINE, RE_RECORDING_INVALIDATES_THE_ALIGNMENT
   *
   * WHAT:  Re-records one narration line, with new words if they were edited.
   * WHY:   An enqueue and nothing else. The synthesis is a provider call, the
   *        credits are held and settled by the workflow, and the run ends by
   *        re-aligning the project — RE_RECORDING_INVALIDATES_THE_ALIGNMENT,
   *        because new audio for one line moves every word timing after it and
   *        the captions would otherwise stay confidently wrong. None of that
   *        fits in a mutation's ten-second transaction.
   *
   *        Keyed on the line AND the text, so a double-click is one run while a
   *        genuine second edit of the same line is a second one. Keying on the
   *        line alone would make fixing a typo twice in a row silently skip the
   *        second fix.
   *
   *        The ownership check is explicit because the id arrives from a
   *        browser: the factory proves the caller belongs to the organization
   *        it named, never that the line does.
   * WHERE: The editor's voice lane.
   */
  resynthLine: protectedProcedure({
    requirePermission: permissions.PROJECTS_UPDATE,
    audit: { action: "resynthLine" },
  })
    .input(resynthLineSchema)
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.db.narrationLine.findFirst({
        where: {
          id: input.lineId,
          organizationId: input.organizationId,
          projectId: input.projectId,
        },
        select: { id: true, text: true },
      });
      if (line === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That narration line no longer exists",
        });

      const text = input.text ?? line.text;

      await enqueue({
        requestId: ctx.requestId,
        name: "line/changed",
        data: {
          lineId: line.id,
          organizationId: input.organizationId,
          text,
        },
        id: `line-${line.id}-${text.length}-${text.slice(0, 40)}`,
      });

      return { queued: true };
    }),
});

/**
 * SOURCE OF TRUTH KEYWORDS: saveOps, ONE_APPLY_TWO_CALLERS,
 *   AN_INVALID_DOCUMENT_IS_NOT_STORED, REVISION_DECIDES_THE_RACE,
 *   RESOLVE_BEFORE_EDITING
 *
 * WHAT:  The save both writing verbs share: read, migrate, resolve, apply,
 *        decide, commit.
 *
 * WHY:   One function because `applyOps` and `restore` differ in exactly one
 *        thing — where the ops came from — and every rule after that point is
 *        identical. Two copies of this sequence would be two places for the
 *        revision check to drift out of.
 *
 *        `expectedRevision` of `null` means "whatever the server is on", which
 *        only `restore` passes; see HISTORY_IS_APPENDED_NOT_REWOUND there for
 *        why the one recovery path does not fail on a stale client.
 *
 *        The order is load-bearing. Migration and resolution come BEFORE the
 *        ops because the ops refuse an anchored document; the apply comes
 *        before the commit because a rejected result must leave the stored
 *        document untouched; and `manualEdited` is set only after a successful
 *        commit, so a refused edit does not claim the project.
 * WHERE: timelineEditor.applyOps and timelineEditor.restore.
 */
async function saveOps(
  db: DbClient,
  input: { organizationId: string; projectId: string },
  ops: readonly Op[],
  expectedRevision: number | null,
): Promise<ApplyOpsResult> {
  const project = await timelineService.findTimelineForEdit(
    db,
    input.organizationId,
    input.projectId,
  );
  if (project === null)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  if (project.timeline === null)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This project has no timeline yet. Generate one first.",
    });

  const timeline = project.timeline;

  /* The revision compare happens twice, and both are needed. This one answers
   * the client BEFORE any work is done; the one inside commitTimelineRevision
   * is the WHERE clause that decides an actual race. */
  if (expectedRevision !== null && expectedRevision !== timeline.revision)
    return { status: "conflict", serverRevision: timeline.revision };

  const migrated = tryMigrate(timeline.doc);
  if (!migrated.ok)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This timeline was written in a format this version cannot open, so it cannot be edited. Nothing has been lost — please contact support.",
    });

  /* RESOLVE_BEFORE_EDITING — the ops refuse a document that still points at
   * words, and from the first edit onwards this project stores absolute times. */
  const base = resolveWordAnchors(migrated.doc);
  const result = applyAndCheck(base, ops);
  if (!result.ok) return { status: "rejected", errors: toWireErrors(result.errors) };

  const committed = await timelineService.commitTimelineRevision(
    db,
    input.organizationId,
    input.projectId,
    {
      expectedRevision: timeline.revision,
      doc: toJson(result.doc),
      docVersion: result.doc.version,
    },
  );
  /* The compare-and-set lost: another save committed between the read above
   * and this write. Reported as the same conflict the early check produces, so
   * the client has one path to handle. */
  if (committed === null)
    return { status: "conflict", serverRevision: timeline.revision + 1 };

  await timelineService.markProjectManuallyEdited(
    db,
    input.organizationId,
    input.projectId,
  );

  return {
    status: "applied",
    doc: result.doc,
    revision: committed.revision,
    errors: toWireErrors(result.errors),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: applyAndCheck, AN_INVALID_DOCUMENT_IS_NOT_STORED,
 *   OP_PATHS_ARE_THE_CONTRACT
 *
 * WHAT:  Runs the ops and decides whether the result is storable.
 * WHY:   OP_PATHS_ARE_THE_CONTRACT. apply() reports a refused op under
 *        `ops.<index>` and a broken invariant under the document's own path, so
 *        the two can be told apart — and they mean opposite things here. A
 *        refused op is a mistake the save can carry (four of five ops
 *        succeeding is a usable screen, which is why apply() returns the
 *        document at all); a broken invariant means the RESULT is a document
 *        the renderer will refuse, and storing it would leave the customer with
 *        a project that cannot be exported and no obvious way back.
 *
 *        validate() is run again rather than trusted from apply()'s errors, so
 *        the decision is made against the document actually about to be
 *        written.
 * WHERE: saveOps.
 */
function applyAndCheck(
  base: TimelineDoc,
  ops: readonly Op[],
):
  | { ok: true; doc: TimelineDoc; errors: readonly ValidationError[] }
  | { ok: false; errors: readonly ValidationError[] } {
  const result = apply(base, ops);

  /* Every op was refused: the client is out of step with the document, and a
   * save that stored the unchanged result would report success for an edit
   * that did not happen. */
  if (countRefusedOps(result.errors) === ops.length)
    return { ok: false, errors: result.errors };

  const checked = validate(result.doc);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  return { ok: true, doc: checked.doc, errors: result.errors };
}

/* How many ops apply() refused, deduplicated by index — one refused op can
 * report several fields (`ops.0.start` and `ops.0.duration`). The same count
 * the editor's session makes for the same reason; see failedOpCount there. */
function countRefusedOps(errors: readonly ValidationError[]): number {
  const seen = new Set<string>();
  for (const error of errors) {
    const match = /^ops\.(\d+)(\.|$)/.exec(error.path);
    if (match?.[1] !== undefined) seen.add(match[1]);
  }
  return seen.size;
}

/* The wire form of a validation error. The timeline module's own type carries
 * a closed union for `code`, and superjson would preserve it — but the client
 * only ever renders the message against the path, and a narrower type here
 * would make the editor's error list depend on the module's error vocabulary
 * for no gain. */
function toWireErrors(
  errors: readonly ValidationError[],
): TimelineWireError[] {
  return errors.map((error) => ({
    path: error.path,
    code: error.code,
    message: error.message,
  }));
}

/* A validated document is not directly assignable to Prisma's InputJsonValue —
 * its optional fields widen to `| undefined`, which JSON has no value for — so
 * it goes through the JSON schema, exactly as the generate pipeline's own
 * timeline write does. A parse rather than a cast: the one place a document
 * becomes a database value is the right place to prove it is serialisable. */
function toJson(doc: TimelineDoc): Prisma.InputJsonValue {
  return jsonObjectSchema.parse(doc);
}
