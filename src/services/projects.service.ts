/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listProjects, findProjectForOrganization,
 *   findProjectWithTimeline, saveTimelineDocument, createProject,
 *   recordScriptSource, PROJECT_LIST_SELECT, ProjectListItem,
 *   ProjectWithTimeline, TENANT_SCOPED_QUERY, DbClient
 *
 * WHAT:  The Prisma reads of the `project` and `timeline` tables that more than
 *        one caller needs.
 * WHY:   TENANT_SCOPED_QUERY. Every function here takes `organizationId` and
 *        puts it in the WHERE clause, including the ones that also have a
 *        primary key. An `id`-only lookup would let a caller read another
 *        workspace's project with a guessed cuid — the procedure factory
 *        proves the caller belongs to the org it NAMED, not that the row does.
 *
 *        PROJECT_LIST_SELECT exists because `Timeline.doc` is a jsonb document
 *        that runs to hundreds of kilobytes. The list screen must never touch
 *        it, so the select is explicit and the join is absent — a `include:
 *        { timeline: true }` on a page of twenty rows is how a list screen
 *        starts timing out in month three.
 * WHERE: Called by src/trpc/routers/projects.ts. The business rules (what a
 *        duplicate is called, which fields a rename may touch) live there, not
 *        here.
 */

import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { jsonObjectSchema } from "@/lib/types/json";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_LIST_SELECT, ProjectListItem
 *
 * WHAT:  The columns the projects list renders, and the row type they infer to.
 * WHY:   Declared `satisfies Prisma.ProjectSelect` so adding a field to the
 *        screen is a one-line change that the row type follows automatically —
 *        and so a typo is a compile error rather than an undefined cell.
 * WHERE: listProjects() below; the columns in projects-table.tsx.
 */
export const PROJECT_LIST_SELECT = {
  id: true,
  title: true,
  kind: true,
  status: true,
  aspect: true,
  manualEdited: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProjectSelect;

export type ProjectListItem = Prisma.ProjectGetPayload<{
  select: typeof PROJECT_LIST_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: listProjects, ProjectListFilters
 *
 * WHAT:  One page of a workspace's projects, newest first, with the total for
 *        the pager.
 * WHY:   Ordered by `updatedAt`, not `createdAt`: the project someone touched
 *        last is the one they came back for. The count runs in the same
 *        Promise.all rather than after, because the pager needs both and a
 *        sequential pair doubles the screen's latency for no reason.
 *        `search` is a case-insensitive title match — there is no body text to
 *        search on a project, and matching the jsonb document would be a very
 *        expensive way to answer a question nobody asked.
 * WHERE: projects.list.
 */
export async function listProjects(
  db: DbClient,
  filters: {
    organizationId: string;
    search?: string | undefined;
    kind?: string | undefined;
    status?: string | undefined;
  },
  pagination: { skip: number; take: number },
): Promise<{ items: ProjectListItem[]; total: number }> {
  const where: Prisma.ProjectWhereInput = {
    organizationId: filters.organizationId,
    ...(filters.kind !== undefined ? { kind: filters.kind } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.search !== undefined && filters.search.length > 0
      ? { title: { contains: filters.search, mode: "insensitive" } }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.project.findMany({
      where,
      select: PROJECT_LIST_SELECT,
      orderBy: { updatedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.project.count({ where }),
  ]);

  return { items, total };
}

/**
 * SOURCE OF TRUTH KEYWORDS: findProjectForOrganization, TENANT_SCOPED_QUERY
 *
 * WHAT:  One project by id, only if it belongs to this workspace.
 * WHY:   `findFirst` with both columns rather than `findUnique` by id — see
 *        TENANT_SCOPED_QUERY above. Returns null rather than throwing so the
 *        router can decide between NOT_FOUND and a softer answer.
 * WHERE: projects.get, .rename, .delete, .duplicate.
 */
export async function findProjectForOrganization(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<Prisma.ProjectGetPayload<Record<string, never>> | null> {
  return db.project.findFirst({ where: { id, organizationId } });
}

/**
 * SOURCE OF TRUTH KEYWORDS: ProjectWithTimeline, findProjectWithTimeline
 *
 * WHAT:  A project together with its timeline row.
 * WHY:   The one place the jsonb document is loaded, so there is a single
 *        callsite to audit when asking "who reads a whole timeline?". The
 *        document still has to go through migrate() before anything reads it —
 *        this function does not do that, because the service layer is pure
 *        Prisma and migrate() is business logic.
 * WHERE: projects.get; the editor (Phase 15) and the render pre-flight
 *        (Phase 04).
 */
export type ProjectWithTimeline = Prisma.ProjectGetPayload<{
  include: { timeline: true };
}>;

export async function findProjectWithTimeline(
  db: DbClient,
  organizationId: string,
  id: string,
): Promise<ProjectWithTimeline | null> {
  return db.project.findFirst({
    where: { id, organizationId },
    include: { timeline: true },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: saveTimelineDocument, UPSERT_BY_PROJECT,
 *   REVISION_IS_BUMPED_ON_EVERY_WRITE, TENANT_SCOPED_QUERY
 *
 * WHAT:  Writes a project's timeline document, creating the row if the project
 *        has never had one.
 *
 * WHY:   An UPSERT keyed on `projectId`, because `Timeline` is strictly 1:1
 *        with a project and a regeneration REPLACES the document rather than
 *        adding a version — branching a manually-edited project is a new
 *        PROJECT with a `parentId` (BRANCH_POLICY in the router), not a second
 *        timeline row.
 *
 *        REVISION_IS_BUMPED_ON_EVERY_WRITE. `revision` is the editor's
 *        optimistic-concurrency counter, and a generation is as much an edit as
 *        a drag in the editor is: a client holding the old revision has to be
 *        told its view is stale rather than silently overwriting a document the
 *        pipeline just rebuilt. `docVersion` is the DOCUMENT SCHEMA version and
 *        comes off the document itself — two different numbers that are easy to
 *        confuse (see the note on the model in prisma/schema.prisma).
 *
 *        TENANT_SCOPED_QUERY is enforced by requiring `organizationId` and
 *        checking the project first. `timeline` has no organization column of
 *        its own, so an upsert straight onto `projectId` would let a workflow
 *        with a guessed id write into another workspace's video. The ownership
 *        re-check matters here more than in a router, because the one caller is
 *        a background workflow that gets none of `protectedProcedure`'s gates.
 *        Returns false rather than throwing when the project is not ours, so a
 *        run whose project was deleted mid-flight logs a miss instead of a
 *        Prisma P2025 three steps from the cause.
 *
 *        This is a pure Prisma write and nothing more: validating the document
 *        is the CALLER's job (the `timeline` stage does it with the timeline
 *        module's own `validate`), because the service layer holds no business
 *        rules.
 * WHERE: The `timeline` stage of src/inngest/functions/project-generate.ts.
 */
export async function saveTimelineDocument(
  db: DbClient,
  organizationId: string,
  projectId: string,
  args: { doc: Prisma.InputJsonValue; docVersion: number },
): Promise<boolean> {
  const owned = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true },
  });
  if (owned === null) return false;

  await db.timeline.upsert({
    where: { projectId },
    create: {
      projectId,
      doc: args.doc,
      docVersion: args.docVersion,
      revision: 0,
    },
    update: {
      doc: args.doc,
      docVersion: args.docVersion,
      revision: { increment: 1 },
    },
  });
  return true;
}

/**
 * SOURCE OF TRUTH KEYWORDS: createProject, SERVICES_OWN_THE_DATABASE,
 *   THE_WRITE_MOVED_OUT_OF_THE_ROUTER
 *
 * WHAT:  A new project row.
 *
 * WHY:   THE_WRITE_MOVED_OUT_OF_THE_ROUTER. This was `ctx.db.project.create`
 *        inline in `projects.create`, which worked because the router had a
 *        Prisma handle. Phase 17 makes the same verb reachable from a REST
 *        route and an MCP tool, and the operation that serves all three may
 *        not touch Prisma itself (CLAUDE.md rule 3) — so the write belongs
 *        here, where every other write to this table already lives and where
 *        `import 'server-only'` keeps it off a client bundle.
 *
 *        The optional fields are spread conditionally rather than passed as
 *        `undefined`, because `exactOptionalPropertyTypes` distinguishes the two
 *        and Prisma treats an explicit `undefined` differently from an absent
 *        key on a column with a default.
 * WHERE: createProjectOperation.
 */
export async function createProject(
  db: DbClient,
  args: {
    organizationId: string;
    title: string;
    kind: string;
    aspect: string;
    sourceRef?: string | undefined;
    settings?: Prisma.InputJsonValue | undefined;
  },
): Promise<Prisma.ProjectGetPayload<Record<string, never>>> {
  return db.project.create({
    data: {
      organizationId: args.organizationId,
      title: args.title,
      kind: args.kind,
      aspect: args.aspect,
      ...(args.sourceRef !== undefined ? { sourceRef: args.sourceRef } : {}),
      ...(args.settings !== undefined ? { settings: args.settings } : {}),
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: recordScriptSource, RECORD_THE_PATH,
 *   SETTINGS_ARE_MERGED_NOT_REPLACED, TENANT_SCOPED_QUERY
 *
 * WHAT:  Stores what the customer gave us and what we made of it, on the
 *        project, before the script workflow is enqueued.
 *
 * WHY:   RECORD_THE_PATH is Phase 06's rule and the columns are the ones it
 *        chose: `sourceRef` is the normalised input and `settings.script`
 *        carries the extracted body and its provenance. The body is kept so a
 *        retry does not re-fetch a URL that may since have gone behind a
 *        paywall, and so an operator can see exactly what the model was given
 *        when a script comes out wrong.
 *
 *        SETTINGS_ARE_MERGED_NOT_REPLACED. `Project.settings` holds every
 *        feature's configuration — captions, generate, motion — so this reads,
 *        merges and writes rather than assigning. Replacing the object would
 *        silently drop a customer's caption choice the first time they
 *        generated a script.
 *
 *        Scoped by `organizationId` as well as `id` (TENANT_SCOPED_QUERY) and
 *        returns whether a row matched, so a project deleted between the read
 *        and this write is a clean refusal rather than a silent no-op
 *        followed by an enqueued job for a project that is gone.
 * WHERE: generateScriptOperation.
 */
export async function recordScriptSource(
  db: DbClient,
  args: {
    organizationId: string;
    projectId: string;
    sourceRef: string;
    script: Prisma.InputJsonObject;
  },
): Promise<boolean> {
  const project = await db.project.findFirst({
    where: { id: args.projectId, organizationId: args.organizationId },
    select: { settings: true },
  });
  if (project === null) return false;

  const existing = jsonObjectSchema.safeParse(project.settings);

  const result = await db.project.updateMany({
    where: { id: args.projectId, organizationId: args.organizationId },
    data: {
      sourceRef: args.sourceRef,
      settings: {
        ...(existing.success ? existing.data : {}),
        script: args.script,
      },
    },
  });

  return result.count > 0;
}
