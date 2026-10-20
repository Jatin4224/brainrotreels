/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: projectKindSchema, ProjectKind, projectStatusSchema,
 *   ProjectStatus, aspectRatioSchema, AspectRatio, PROJECT_KINDS,
 *   PROJECT_STATUSES, ASPECT_RATIOS, CANVAS_BY_ASPECT, projectTitleSchema,
 *   createProjectSchema, listProjectsSchema, getProjectSchema,
 *   renameProjectSchema, deleteProjectSchema, duplicateProjectSchema,
 *   PROJECT_PAGE_SIZE, STRING_NOT_ENUM
 *
 * WHAT:  The validated vocabulary of a Project — its kind, status and aspect —
 *        plus the zod input schema for every `projects.*` procedure and the
 *        forms that call them.
 * WHY:   STRING_NOT_ENUM. `Project.kind`, `.status` and `.aspect` are Prisma
 *        `String` columns because this schema has zero enum blocks, so the
 *        database will happily store "redit-story". These unions are the only
 *        thing standing between a typo and a project that no renderer can
 *        open, which is why the router validates against them rather than
 *        trusting its caller. Kept beside the input schemas so the form and the
 *        handler infer from one object and cannot drift.
 *        CANVAS_BY_ASPECT lives here rather than in the timeline module because
 *        it maps a USER-FACING choice to pixels; the timeline module only ever
 *        sees the pixels.
 * WHERE: Imported by src/trpc/routers/projects.ts, the project screens under
 *        src/app/(dashboard)/dashboard/projects/, and src/lib/timeline/schema.ts
 *        (which reuses projectKindSchema for the document's `kind`).
 *        Re-exported from src/lib/types.
 */

import { z } from "zod";

import { jsonObjectSchema } from "./json";

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_KINDS, projectKindSchema, ProjectKind
 *
 * WHAT:  The four formats a project can be. One generator module per kind.
 * WHY:   The tuple is exported as well as the schema because the create form
 *        needs to ENUMERATE the options, and deriving the list from the schema
 *        at the callsite is how two sources of truth get born.
 * WHERE: Project.kind, TimelineDoc.kind, the create-project form.
 */
export const PROJECT_KINDS = [
  "reddit-story",
  "voiceover",
  "quiz",
  "motion",
] as const;

export const projectKindSchema = z.enum(PROJECT_KINDS);

export type ProjectKind = z.infer<typeof projectKindSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_STATUSES, projectStatusSchema, ProjectStatus
 *
 * WHAT:  The lifecycle of a project row.
 * WHY:   `generating` is a claim about a running workflow, so only the pipeline
 *        (Phase 09) writes it — the CRUD router in this phase never moves a
 *        project out of `draft`.
 * WHERE: Project.status; the status badge on the projects list.
 */
export const PROJECT_STATUSES = [
  "draft",
  "generating",
  "ready",
  "failed",
  "cancelled",
] as const;

export const projectStatusSchema = z.enum(PROJECT_STATUSES);

export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: ASPECT_RATIOS, aspectRatioSchema, AspectRatio,
 *   CANVAS_BY_ASPECT
 *
 * WHAT:  The supported output shapes and the canvas each one means.
 * WHY:   The pixel dimensions are fixed per aspect rather than free-form: a
 *        renderer that can be handed any width and height is a renderer whose
 *        cold-start cache never hits, and every caption style would need to be
 *        re-tuned per size. 1080-wide is the short-form standard.
 * WHERE: Project.aspect; consumed when a generator builds a TimelineDoc canvas.
 */
export const ASPECT_RATIOS = ["9:16", "1:1", "16:9"] as const;

export const aspectRatioSchema = z.enum(ASPECT_RATIOS);

export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const CANVAS_BY_ASPECT: Readonly<
  Record<
    AspectRatio,
    { readonly width: number; readonly height: number; readonly fps: number }
  >
> = {
  "9:16": { width: 1080, height: 1920, fps: 30 },
  "1:1": { width: 1080, height: 1080, fps: 30 },
  "16:9": { width: 1920, height: 1080, fps: 30 },
};

/* One definition for both create and rename — a title the create form accepts
 * and the rename form rejects would be a bug nobody notices until a render. */
export const projectTitleSchema = z
  .string()
  .trim()
  .min(1, "Give your project a title.")
  .max(200, "That title is too long.");

/**
 * SOURCE OF TRUTH KEYWORDS: createProjectSchema, CreateProjectValues
 *
 * WHAT:  Input for projects.create.
 * WHY:   `status` is absent on purpose — a new project is always a draft and
 *        accepting the field would let a client declare its own video "ready".
 *
 *        `aspect` is REQUIRED rather than defaulted, and that is a deliberate
 *        choice about where a default lives. A `.default()` here would make the
 *        schema's input and output types differ, which breaks React Hook Form's
 *        resolver typing outright — and it would be the third place a default
 *        '9:16' is written, after the form's `defaultValues` and the Prisma
 *        column. The form always supplies one, so requiring it costs nothing
 *        and means a programmatic caller has to say what shape it wants.
 * WHERE: The create-project form and the router.
 */
export const createProjectSchema = z.object({
  organizationId: z.string().min(1),
  title: projectTitleSchema,
  kind: projectKindSchema,
  aspect: aspectRatioSchema,
  /* The Reddit URL, the topic, or the uploaded document key — whichever the
   * chosen kind reads. Phase 06 is what interprets it. */
  sourceRef: z.string().trim().max(2048).optional(),
  settings: jsonObjectSchema.optional(),
});

export type CreateProjectValues = z.infer<typeof createProjectSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: listProjectsSchema, PROJECT_PAGE_SIZE
 *
 * WHAT:  Input for projects.list — page, free-text search, and the two facets.
 * WHY:   `page` / `pageSize` carry no `.default()` or `.max()` because the
 *        procedure factory reads them from rawInput and owns the clamping
 *        (`paginate: true`); declaring the bounds twice is how the client and
 *        server end up disagreeing about page 0. Same reasoning as
 *        src/trpc/routers/audit-logs.ts.
 * WHERE: The projects list screen and the router.
 */
export const PROJECT_PAGE_SIZE = 20;

export const listProjectsSchema = z.object({
  organizationId: z.string().min(1),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  search: z.string().trim().max(200).optional(),
  kind: projectKindSchema.optional(),
  status: projectStatusSchema.optional(),
});

export type ListProjectsValues = z.infer<typeof listProjectsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_FILTER_ALL, projectFilterSchema,
 *   ProjectFilterValues, PROJECT_FILTER_DEFAULTS, normalizeProjectFilters,
 *   PROJECT_SEARCH_MAX
 *
 * WHAT:  The contract for the projects toolbar — search plus the kind and
 *        status facets — and the normalizer that turns it into router input.
 * WHY:   PROJECT_FILTER_ALL mirrors AUDIT_FILTER_ALL in ./audit and exists for
 *        the same reason: Base UI's Select treats `''` as "nothing selected"
 *        and falls back to the placeholder, so "no filter" needs a real
 *        sentinel value. It is stripped in ONE place, here, so the sentinel
 *        can never reach a `where` clause.
 *        Unlike the audit filters, kind and status ARE closed unions — they
 *        come from this file rather than from the tenant's own rows — so the
 *        normalizer validates them instead of passing a free string through.
 * WHERE: The projects toolbar and table under
 *        src/app/(dashboard)/dashboard/projects/_components.
 */
export const PROJECT_FILTER_ALL = "all";

export const PROJECT_SEARCH_MAX = 200;

export const projectFilterSchema = z.object({
  search: z.string().trim().max(PROJECT_SEARCH_MAX),
  kind: z.string(),
  status: z.string(),
});

export type ProjectFilterValues = z.infer<typeof projectFilterSchema>;

export const PROJECT_FILTER_DEFAULTS: ProjectFilterValues = {
  search: "",
  kind: PROJECT_FILTER_ALL,
  status: PROJECT_FILTER_ALL,
};

export function normalizeProjectFilters(values: ProjectFilterValues): {
  search?: string;
  kind?: ProjectKind;
  status?: ProjectStatus;
} {
  const parsed = projectFilterSchema.parse(values);
  const search = parsed.search.trim();
  const kind = projectKindSchema.safeParse(parsed.kind);
  const status = projectStatusSchema.safeParse(parsed.status);

  /* Keys are omitted rather than set to undefined — `exactOptionalPropertyTypes`
   * is on, and the router's input schema uses `.optional()`. */
  return {
    ...(search ? { search } : {}),
    ...(kind.success ? { kind: kind.data } : {}),
    ...(status.success ? { status: status.data } : {}),
  };
}

export const getProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export const renameProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  title: projectTitleSchema,
});

export type RenameProjectValues = z.infer<typeof renameProjectSchema>;

export const deleteProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export const duplicateProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  /* Omitted means "Copy of <original>", resolved server-side where the
   * original title is already loaded. */
  title: projectTitleSchema.optional(),
});

export type DuplicateProjectValues = z.infer<typeof duplicateProjectSchema>;
