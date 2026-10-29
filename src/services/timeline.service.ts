/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: findTimelineForEdit, commitTimelineRevision,
 *   markProjectManuallyEdited, listTimelineRevisions, findTimelineRevision,
 *   pruneTimelineRevisions, TIMELINE_EDIT_SELECT, TimelineForEdit,
 *   COMPARE_AND_SET, TENANT_SCOPED_QUERY, SNAPSHOT_PER_SAVE
 *
 * WHAT:  The Prisma reads and writes the timeline editor needs: the document
 *        to edit, the concurrency-checked save, the snapshot trail, and the
 *        flag that marks a project as the customer's own work.
 *
 * WHY:   COMPARE_AND_SET is the reason this file exists rather than the editor
 *        reusing `saveTimelineDocument`. That function bumps the revision
 *        unconditionally, which is right for a pipeline rebuilding a document
 *        from scratch and wrong for an editor: the editor has to be TOLD when
 *        the document moved under it. The write here is an `updateMany` whose
 *        WHERE names the revision the caller believed it was editing, so the
 *        database itself decides the race — zero rows updated IS the conflict,
 *        and no amount of load can make two savers both win. A read-then-write
 *        would have the classic gap between the check and the write, and the
 *        symptom would be an edit that vanished with nothing logged.
 *
 *        SNAPSHOT_PER_SAVE: the accepted document is also written to
 *        `timeline_revision`, in the same transaction as the save that
 *        produced it. Not afterwards and not in a job — a snapshot that can be
 *        missing is not a recovery point, and recovering from a bad autosave
 *        is the whole reason the table exists.
 *
 *        TENANT_SCOPED_QUERY, as everywhere in this layer: every function
 *        takes `organizationId` and the ownership check is part of the query
 *        rather than something the caller is trusted to have done. `timeline`
 *        and `timeline_revision` have no organization column of their own, so
 *        the scope is reached through the project relation.
 *
 * WHERE: Called by src/trpc/routers/timeline.ts. The business rules — what a
 *        conflict means to the UI, when `manualEdited` is set, which ops are
 *        legal — live there and in src/lib/timeline, not here.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import type { DbClient } from "@/lib/config/prisma";
import { TIMELINE_REVISION_KEEP } from "@/lib/types/timeline";

/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_EDIT_SELECT, TimelineForEdit
 *
 * WHAT:  Everything the editor needs about a project in one read: the row's
 *        own fields, and the document with its revision.
 * WHY:   The editor is the one screen that legitimately wants
 *        `Timeline.doc` — the explicit select is here to say so, against
 *        PROJECT_LIST_SELECT in projects.service.ts which exists to keep that
 *        column off every other screen.
 *        `manualEdited` and `parentId` come with it because the editor renders
 *        both: the first decides what the regenerate button says, the second
 *        whether this project is already a branch.
 * WHERE: findTimelineForEdit below; the editor's open query.
 */
export const TIMELINE_EDIT_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  kind: true,
  status: true,
  aspect: true,
  manualEdited: true,
  parentId: true,
  timeline: {
    select: { doc: true, docVersion: true, revision: true, updatedAt: true },
  },
} as const satisfies Prisma.ProjectSelect;

export type TimelineForEdit = Prisma.ProjectGetPayload<{
  select: typeof TIMELINE_EDIT_SELECT;
}>;

export async function findTimelineForEdit(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<TimelineForEdit | null> {
  return db.project.findFirst({
    where: { id: projectId, organizationId },
    select: TIMELINE_EDIT_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: commitTimelineRevision, COMPARE_AND_SET,
 *   SNAPSHOT_PER_SAVE, CommitResult
 *
 * WHAT:  Writes an edited document if and only if the timeline is still on the
 *        revision the caller edited, and records a snapshot of what it wrote.
 *
 * WHY:   See COMPARE_AND_SET in the file header for why the revision is in the
 *        WHERE clause rather than checked first. Three consequences worth
 *        naming:
 *
 *        The caller gets `null` for a conflict rather than an exception,
 *        because a conflict is an expected outcome of two tabs and the router
 *        turns it into a choice the customer is offered
 *        (CONFLICT_IS_A_RESULT_NOT_AN_ERROR in src/lib/types/timeline.ts).
 *
 *        The ownership check runs FIRST and separately. `timeline` is keyed on
 *        `projectId` alone, so a caller passing another workspace's project id
 *        would otherwise write into their video — the procedure factory proves
 *        the caller belongs to the organization it NAMED, never that the row
 *        does.
 *
 *        The snapshot carries the NEW revision, so restoring revision N means
 *        reading the document as it stood after save N. Pruning happens in the
 *        same call because a trail that is only trimmed by a cron job is a
 *        trail that grows without bound the first time the cron job breaks.
 *
 *        Every statement here assumes it is already inside a transaction — the
 *        procedure factory wraps mutations in one — which is what makes the
 *        save, the snapshot and the prune a single outcome.
 * WHERE: timelineEditor.applyOps and timelineEditor.restore.
 */
export async function commitTimelineRevision(
  db: DbClient,
  organizationId: string,
  projectId: string,
  args: {
    expectedRevision: number;
    doc: Prisma.InputJsonValue;
    docVersion: number;
  },
): Promise<{ revision: number } | null> {
  const owned = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true },
  });
  if (owned === null) return null;

  const nextRevision = args.expectedRevision + 1;

  const written = await db.timeline.updateMany({
    where: { projectId, revision: args.expectedRevision },
    data: {
      doc: args.doc,
      docVersion: args.docVersion,
      revision: nextRevision,
    },
  });
  if (written.count === 0) return null;

  await db.timelineRevision.create({
    data: { projectId, revision: nextRevision, doc: args.doc },
  });
  await pruneTimelineRevisions(db, projectId);

  return { revision: nextRevision };
}

/**
 * SOURCE OF TRUTH KEYWORDS: markProjectManuallyEdited, manualEdited,
 *   BRANCH_POLICY, FIRST_EDIT_CLAIMS_THE_PROJECT
 *
 * WHAT:  Records that a human has edited this project's timeline.
 * WHY:   FIRST_EDIT_CLAIMS_THE_PROJECT. From this point the document is the
 *        customer's rather than the generator's, and a regeneration must
 *        BRANCH instead of overwriting it — the rule the schema comment on
 *        `Project.manualEdited` states and projects.generate enforces.
 *        Written with an updateMany scoped by organization and by the flag
 *        still being false, so the common case (every save after the first)
 *        updates no rows and costs no write amplification on a column the
 *        projects list reads.
 * WHERE: timelineEditor.applyOps, on every save.
 */
export async function markProjectManuallyEdited(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  await db.project.updateMany({
    where: { id: projectId, organizationId, manualEdited: false },
    data: { manualEdited: true },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: listTimelineRevisions, TimelineRevisionSummary,
 *   NO_DOCUMENT_IN_A_LIST
 *
 * WHAT:  The snapshot trail for one project, newest first, without the
 *        documents.
 * WHY:   NO_DOCUMENT_IN_A_LIST — twenty snapshots of a 200KB document is 4MB,
 *        and a dropdown listing restore points needs a number and a time. The
 *        document is read by findTimelineRevision when one is actually chosen,
 *        which is the same reason PROJECT_LIST_SELECT omits it.
 * WHERE: timelineEditor.revisions; the editor's history menu.
 */
export interface TimelineRevisionSummary {
  revision: number;
  createdAt: Date;
}

export async function listTimelineRevisions(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<TimelineRevisionSummary[]> {
  return db.timelineRevision.findMany({
    where: { projectId, project: { organizationId } },
    select: { revision: true, createdAt: true },
    orderBy: { revision: "desc" },
    take: TIMELINE_REVISION_KEEP,
  });
}

export async function findTimelineRevision(
  db: DbClient,
  organizationId: string,
  projectId: string,
  revision: number,
): Promise<Prisma.JsonValue | null> {
  const row = await db.timelineRevision.findFirst({
    where: { projectId, revision, project: { organizationId } },
    select: { doc: true },
  });
  return row?.doc ?? null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: pruneTimelineRevisions, TIMELINE_REVISION_KEEP,
 *   SNAPSHOTS_ARE_PRUNED
 *
 * WHAT:  Deletes a project's snapshots beyond the newest TIMELINE_REVISION_KEEP.
 * WHY:   By revision rather than by age, because what a customer wants back is
 *        "the state before the last few saves" and an afternoon of editing
 *        produces hundreds of saves in one hour — an age cut-off would keep all
 *        of them and then drop the lot at once.
 *        The ids are selected and then deleted by id: Prisma has no
 *        `deleteMany` with an offset, and the alternative (a raw SQL window
 *        function) would be the only raw query in the service layer for a
 *        bounded delete of at most a handful of rows.
 * WHERE: commitTimelineRevision, in the same transaction as the save.
 */
export async function pruneTimelineRevisions(
  db: DbClient,
  projectId: string,
): Promise<void> {
  const stale = await db.timelineRevision.findMany({
    where: { projectId },
    select: { id: true },
    orderBy: { revision: "desc" },
    skip: TIMELINE_REVISION_KEEP,
  });
  if (stale.length === 0) return;

  await db.timelineRevision.deleteMany({
    where: { id: { in: stale.map((row) => row.id) } },
  });
}
