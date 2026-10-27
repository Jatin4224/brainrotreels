/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: seedStages, beginStage, completeStage, failStage,
 *   skipStage, listStages, toStageUpdates, setProjectStatus,
 *   readGenerateSettings, writeGenerateSettings, generatorContextFor,
 *   releaseProjectHolds, PROJECT_HOLD_REFS, FAILURE_IS_EXPLAINED_NOT_DUMPED,
 *   STAGE_WRITES_ARE_UPSERTS, TENANT_SCOPED_QUERY, DbClient
 *
 * WHAT:  Every read and write of the `pipeline_stage` table, the project-status
 *        transitions the pipeline owns, the facts a generator is handed, and
 *        the hold release a cancelled or failed run has to perform.
 *
 * WHY:   STAGE_WRITES_ARE_UPSERTS, keyed on `(projectId, stage)` — which is why
 *        the schema carries that unique constraint. An Inngest step is replayed
 *        from its stored result when a run resumes, but a step that is retried
 *        genuinely runs its body again, so every stage write has to be safe to
 *        perform twice. An insert would leave two rows for one stage and the
 *        progress list would grow a duplicate; an upsert leaves exactly the row
 *        the run last wrote.
 *
 *        FAILURE_IS_EXPLAINED_NOT_DUMPED is the phase's step 9, enforced HERE
 *        rather than in the UI. `failStage` takes a plain-language reason and
 *        nothing else — there is no parameter a caller could pass a stack trace
 *        through — so a provider's internal message cannot reach a customer's
 *        screen by being the easiest thing to hand. The technical detail goes
 *        to `console.error` in the workflow, where an operator reads it.
 *
 *        TENANT_SCOPED_QUERY throughout. `pipeline_stage` has no
 *        `organizationId` of its own — it hangs off the project, like `timeline`
 *        and `alignment` — so every read goes through a `project` filter naming
 *        the workspace. This matters more here than almost anywhere else:
 *        `releaseProjectHolds` MOVES MONEY, and the workflow that calls it runs
 *        outside `protectedProcedure` and gets none of its gates (the phase's
 *        step 10). A lookup by `projectId` alone would let a guessed id release
 *        another workspace's hold.
 *
 *        The STATUS transitions live here and not in the router because the
 *        pipeline owns `Project.status` — `projectStatusSchema` says `generating`
 *        is "a claim about a running workflow", and the CRUD router deliberately
 *        never writes it.
 * WHERE: src/inngest/functions/project-generate.ts and the pipeline procedures
 *        in src/trpc/routers/projects.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { generatorSkipsFor } from "@/lib/generators";
import type { CastMember, GeneratorContext } from "@/lib/generators";
import { type DbClient } from "@/lib/config/prisma";
import { hashValue, wordTokenSchema, type WordToken } from "@/lib/timeline";
import { jsonObjectSchema } from "@/lib/types/json";
import type { PlanKey } from "@/lib/config/plans";
import {
  BACKGROUND_ASSET_KINDS,
  licenseCategoryForSource,
} from "@/lib/types/background";
import { avatarAvailableOnPlan, readAvatarAssetSet } from "@/lib/types/avatar";
import { redditThreadSnapshotSchema } from "@/lib/types/reddit";
import { resolveProjectBackground } from "./backgrounds.service";
import {
  PIPELINE_STAGES,
  generateSettingsSchema,
  type ClearableGenerateSettingKey,
  type GenerateSettings,
  type PipelineStageName,
  type StageUpdate,
} from "@/lib/types/pipeline";
import {
  aspectRatioSchema,
  projectKindSchema,
  type ProjectKind,
  type ProjectStatus,
} from "@/lib/types/project";
import { findOpenHoldForRef, release } from "./credits.service";

/**
 * SOURCE OF TRUTH KEYWORDS: PIPELINE_STAGE_SELECT, PipelineStageRow
 *
 * The columns the progress surfaces need. `id` is excluded deliberately: a
 * stage is addressed by `(projectId, stage)` everywhere, and exposing a
 * surrogate id would invite a client to hold one.
 */
export const PIPELINE_STAGE_SELECT = {
  stage: true,
  status: true,
  error: true,
  startedAt: true,
  finishedAt: true,
} as const satisfies Prisma.PipelineStageSelect;

export type PipelineStageRow = Prisma.PipelineStageGetPayload<{
  select: typeof PIPELINE_STAGE_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: seedStages, SKIPPED_NOT_OMITTED, SEED_BEFORE_WORK
 *
 * WHAT:  Writes the full ordered stage list for a run: `skipped` for the stages
 *        this kind never runs, `pending` for the rest.
 *
 * WHY:   SEED_BEFORE_WORK. This is the FIRST thing a run does, before the
 *        safety check and long before a provider call, because the customer is
 *        already watching — a progress screen that fills in one row at a time
 *        cannot show how much is left, and one whose rows appear in completion
 *        order reshuffles as it goes (SKIPPED_NOT_OMITTED in
 *        src/lib/types/pipeline.ts).
 *
 *        It RESETS every non-skipped stage to `pending`, which is what makes
 *        Retry mean what it says: a second run of a project that failed at
 *        `tts` must not show `completed` against stages the new run has not
 *        reached yet. The rows a previous run wrote are therefore replaced
 *        rather than preserved — a pipeline run has no history, only a current
 *        state, and anything worth keeping is in the audit log.
 * WHERE: The workflow's first step.
 */
export async function seedStages(
  db: DbClient,
  projectId: string,
  kind: ProjectKind,
): Promise<void> {
  const skipped = new Set<PipelineStageName>(generatorSkipsFor(kind));

  /* Sequential rather than a transaction of twelve upserts: this runs inside a
   * workflow step that is already retried, and a partially seeded list is
   * corrected by the retry. A transaction here would hold twelve row locks on
   * a table the progress subscription is reading every second. */
  for (const stage of PIPELINE_STAGES) {
    const isSkipped = skipped.has(stage);
    const data = {
      status: isSkipped ? "skipped" : "pending",
      error: isSkipped ? skipReasonFor(stage) : null,
      startedAt: null,
      finishedAt: null,
    };
    await db.pipelineStage.upsert({
      where: { projectId_stage: { projectId, stage } },
      create: { projectId, stage, ...data },
      update: data,
    });
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: skipReasonFor, SKIP_HAS_A_REASON
 *
 * WHAT:  Why a stage was skipped, in the customer's language.
 * WHY:   SKIP_HAS_A_REASON. A greyed row with no explanation reads as a
 *        failure, and the honest message is that the feature arrives later —
 *        which is also the most useful thing a customer could be told. Stored
 *        in `error` because that column already means "why is this row not
 *        green", and adding a `note` column that duplicates it would make the
 *        UI read two fields to render one line.
 * WHERE: seedStages.
 */
function skipReasonFor(stage: PipelineStageName): string {
  switch (stage) {
    case "visuals":
      return "Backgrounds beyond a styled gradient are not available yet.";
    case "storyboard":
      return "This format has a single scene, so there is nothing to sequence.";
    case "design":
      return "This format's look is set by the caption style you chose.";
    case "render":
      return "Render your video from the preview screen when you are happy with it.";
    default:
      return "Not used by this format.";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: beginStage, completeStage, failStage, skipStage,
 *   STAGE_WRITES_ARE_UPSERTS
 *
 * WHAT:  The four transitions a stage can make.
 * WHY:   `beginStage` clears `finishedAt` and the previous error as well as
 *        setting `startedAt`, so a retried stage does not display a stale
 *        failure next to a running spinner — the single most confusing thing a
 *        progress list can show.
 *
 *        `completeStage` does NOT clear the error, on purpose: a stage that
 *        finished with a WARNING (a degraded alignment) is completed and still
 *        has something to say. The UI renders a completed stage with an error
 *        as a caution rather than a failure.
 * WHERE: Every step of the workflow, on entry and exit.
 */
export async function beginStage(
  db: DbClient,
  projectId: string,
  stage: PipelineStageName,
): Promise<void> {
  const data = {
    status: "running",
    error: null,
    startedAt: new Date(),
    finishedAt: null,
  };
  await db.pipelineStage.upsert({
    where: { projectId_stage: { projectId, stage } },
    create: { projectId, stage, ...data },
    update: data,
  });
}

export async function completeStage(
  db: DbClient,
  projectId: string,
  stage: PipelineStageName,
  /** A warning on an otherwise successful stage — a degraded alignment. */
  warning?: string,
): Promise<void> {
  const data = {
    status: "completed",
    finishedAt: new Date(),
    ...(warning !== undefined ? { error: warning } : {}),
  };
  await db.pipelineStage.upsert({
    where: { projectId_stage: { projectId, stage } },
    create: { projectId, stage, ...data, startedAt: new Date() },
    update: data,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: failStage, FAILURE_IS_EXPLAINED_NOT_DUMPED
 *
 * WHAT:  Marks a stage failed with a reason a customer can read.
 * WHY:   See FAILURE_IS_EXPLAINED_NOT_DUMPED in the file header. `reason` is
 *        the ONLY channel, and it is truncated: a provider that returns a
 *        kilobyte of HTML in its error message must not be able to put a
 *        kilobyte of HTML on a progress screen.
 * WHERE: Every step's catch, and the workflow's onFailure.
 */
export const STAGE_ERROR_MAX = 400;

export async function failStage(
  db: DbClient,
  projectId: string,
  stage: PipelineStageName,
  reason: string,
): Promise<void> {
  const data = {
    status: "failed",
    error: reason.slice(0, STAGE_ERROR_MAX),
    finishedAt: new Date(),
  };
  await db.pipelineStage.upsert({
    where: { projectId_stage: { projectId, stage } },
    create: { projectId, stage, ...data, startedAt: new Date() },
    update: data,
  });
}

export async function skipStage(
  db: DbClient,
  projectId: string,
  stage: PipelineStageName,
  reason: string,
): Promise<void> {
  const data = {
    status: "skipped",
    error: reason.slice(0, STAGE_ERROR_MAX),
    finishedAt: new Date(),
  };
  await db.pipelineStage.upsert({
    where: { projectId_stage: { projectId, stage } },
    create: { projectId, stage, ...data },
    update: data,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: listStages, toStageUpdates, STAGE_ORDER_IS_THE_TUPLE
 *
 * WHAT:  A project's stages, in the order the UI draws them.
 *
 * WHY:   STAGE_ORDER_IS_THE_TUPLE. The rows come back in whatever order the
 *        database gives them — there is no column worth ordering by, since
 *        `startedAt` is null for everything not yet reached — so the order is
 *        imposed from `PIPELINE_STAGES` here, once, on the server. Sorting in
 *        the component instead would mean the subscription and the polling
 *        fallback each needed their own copy of the same sort.
 *
 *        A stage with NO ROW is returned as `pending` rather than omitted, so
 *        the list is always twelve long even in the instant between a run
 *        starting and `seedStages` committing. An unknown stage name in the
 *        table — a row written by a newer release — is dropped, because the UI
 *        has no label for it and a progress row reading "unknown" is worse than
 *        one that is not there.
 * WHERE: `projects.getStages`, `projects.progress`, and the workflow's own
 *        failure summary.
 */
export async function listStages(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<StageUpdate[]> {
  const rows = await db.pipelineStage.findMany({
    where: { projectId, project: { organizationId } },
    select: PIPELINE_STAGE_SELECT,
  });
  return toStageUpdates(rows);
}

export function toStageUpdates(rows: readonly PipelineStageRow[]): StageUpdate[] {
  const byStage = new Map(rows.map((row) => [row.stage, row]));
  const now = Date.now();

  return PIPELINE_STAGES.map((stage) => {
    const row = byStage.get(stage);
    if (row === undefined) {
      return {
        stage,
        status: "pending" as const,
        error: null,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
      };
    }

    /* ELAPSED_IS_DERIVED_ON_THE_SERVER — see the note on stageUpdateSchema. */
    const elapsedMs =
      row.startedAt === null
        ? null
        : Math.max(
            0,
            (row.finishedAt?.getTime() ?? now) - row.startedAt.getTime(),
          );

    return {
      stage,
      status: readStatus(row.status),
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      elapsedMs,
    };
  });
}

/* `status` is a String column, so a row written by a newer release can hold a
 * value this build has never heard of. Treated as `pending` rather than
 * dropped: the stage genuinely exists and is genuinely not finished, which is
 * the closest true statement available. */
function readStatus(status: string): StageUpdate["status"] {
  switch (status) {
    case "pending":
    case "running":
    case "completed":
    case "failed":
    case "skipped":
      return status;
    default:
      console.warn(
        `[pipeline.service] Unrecognised stage status "${status}"; showing it as pending.`,
      );
      return "pending";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: setProjectStatus, PIPELINE_OWNS_THE_STATUS,
 *   TENANT_SCOPED_QUERY
 *
 * WHAT:  Moves a project through the pipeline's own lifecycle.
 * WHY:   PIPELINE_OWNS_THE_STATUS — see the file header. Scoped by
 *        organization and returning whether a row actually moved, so a
 *        workflow whose project was deleted mid-run logs a miss instead of
 *        throwing a Prisma P2025 three steps from the cause.
 * WHERE: The workflow's start, finalize, cancel and failure paths.
 */
export async function setProjectStatus(
  db: DbClient,
  organizationId: string,
  projectId: string,
  status: ProjectStatus,
): Promise<boolean> {
  const result = await db.project.updateMany({
    where: { id: projectId, organizationId },
    data: { status },
  });
  return result.count > 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_HOLD_REFS, releaseProjectHolds,
 *   CANCEL_RELEASES_EVERY_HOLD
 *
 * WHAT:  Releases every open credit hold a generate run could have taken out.
 *
 * WHY:   CANCEL_RELEASES_EVERY_HOLD. Each sub-pipeline takes its OWN hold under
 *        its own ledger reference — `script:`, `tts:`, `align:` (ONE_REF_PER_PROJECT
 *        in each workflow) — and settles it itself on the happy path. Two
 *        situations leave one open anyway, and they are the reason this exists:
 *
 *          A CANCELLED run. Inngest does not run `onFailure` for a cancellation,
 *          so a child that was mid-flight when its parent was cancelled has
 *          nobody to release its hold. The hold would sit against the
 *          workspace's balance until the Phase 05 reconciler noticed.
 *
 *          A parent that failed BETWEEN children. The child that already
 *          settled is fine; a child that never ran holds nothing. This is
 *          belt-and-braces for the window in between.
 *
 *        It is deliberately NOT a general "release everything for this
 *        organization": it releases the holds belonging to ONE project, named
 *        explicitly, because a blunter version would cancel a render the
 *        customer started separately and is still waiting for.
 *
 *        Failures are logged and swallowed. This runs from a cancel handler and
 *        from `onFailure`, and a throw in either produces an unhandled
 *        rejection in a context that has no error path left — the Phase 05
 *        reconciler is the backstop that catches what this misses.
 * WHERE: The workflow's onFailure, and `projects.cancel`.
 */
export const PROJECT_HOLD_REFS = ["script", "tts", "align"] as const;

export async function releaseProjectHolds(
  db: DbClient,
  projectId: string,
  reason: string,
): Promise<number> {
  let released = 0;

  for (const namespace of PROJECT_HOLD_REFS) {
    try {
      const open = await findOpenHoldForRef(db, `${namespace}:${projectId}`);
      if (open === null) continue;
      await release(db, open.id, { reason });
      released += 1;
    } catch (error) {
      console.error(
        `[pipeline.service] ${projectId}: could not release the ${namespace} hold:`,
        error,
      );
    }
  }

  return released;
}

/**
 * SOURCE OF TRUTH KEYWORDS: readGenerateSettings, writeGenerateSettings,
 *   SETTINGS_ARE_MERGED
 *
 * WHAT:  The pipeline's preferences on `Project.settings.generate`.
 * WHY:   SETTINGS_ARE_MERGED, the same rule and the same hazard as
 *        `writeCaptionSettings` in src/services/alignment.service.ts:
 *        `settings` is ONE jsonb column shared by every phase that needs a
 *        project-level preference, so a write reads the existing object and
 *        replaces only the `generate` key. Writing the whole column is how
 *        ticking "email me" silently deletes the caption style and the script's
 *        extracted source text.
 * WHERE: `projects.generate` writes; the workflow and the generators read.
 */
export const DEFAULT_GENERATE_SETTINGS: GenerateSettings = {
  notifyWhenDone: false,
};

export async function readGenerateSettings(
  db: DbClient,
  organizationId: string,
  projectId: string,
): Promise<GenerateSettings | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return null;

  const settings = jsonObjectSchema.safeParse(project.settings);
  if (!settings.success) return { ...DEFAULT_GENERATE_SETTINGS };

  const generate = generateSettingsSchema.safeParse(settings.data["generate"]);
  return generate.success ? generate.data : { ...DEFAULT_GENERATE_SETTINGS };
}

/**
 * SOURCE OF TRUTH KEYWORDS: writeGenerateSettings, CLEARING_IS_NOT_PATCHING
 *
 * `clear` names keys to REMOVE, and it exists because `patch` cannot express
 * removal. `exactOptionalPropertyTypes` is on, so an explicit `undefined` is
 * not assignable to an optional field — and even if it were, spreading it would
 * leave the key present with an undefined value, which is not what "the
 * customer went back to the styled backdrop" means. Phase 11's
 * NULL_CLEARS_THE_CHOICE needs a real delete.
 */
export async function writeGenerateSettings(
  db: DbClient,
  organizationId: string,
  projectId: string,
  patch: Partial<GenerateSettings>,
  clear: readonly ClearableGenerateSettingKey[] = [],
): Promise<boolean> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { settings: true },
  });
  if (project === null) return false;

  const existing = jsonObjectSchema.safeParse(project.settings);
  const bag = existing.success ? existing.data : {};
  const current = generateSettingsSchema.safeParse(bag["generate"]);

  const generate: GenerateSettings = {
    ...(current.success ? current.data : DEFAULT_GENERATE_SETTINGS),
    ...patch,
  };
  for (const key of clear) {
    delete generate[key];
  }

  await db.project.update({
    where: { id: projectId },
    /* SETTINGS_ARE_MERGED — only the `generate` key is replaced. */
    data: { settings: jsonObjectSchema.parse({ ...bag, generate }) },
  });
  return true;
}

/**
 * SOURCE OF TRUTH KEYWORDS: generatorContextFor, GeneratorContext,
 *   CONTEXT_IS_ASSEMBLED_ONCE, RECHECK_OWNERSHIP_IN_THE_WORKFLOW
 *
 * WHAT:  Everything a generator needs, read in one place.
 *
 * WHY:   CONTEXT_IS_ASSEMBLED_ONCE. The generator contract is deliberately
 *        pure, which means somebody has to do the four reads it depends on —
 *        the project, the cast, the recorded lines and the aligned words. Doing
 *        them here keeps the workflow's `timeline` step to one call and keeps
 *        every generator free of Prisma.
 *
 *        RECHECK_OWNERSHIP_IN_THE_WORKFLOW is the phase's step 10 and it is
 *        enforced by this signature: `organizationId` is required and the
 *        project is loaded by `(id, organizationId)`. There is no overload that
 *        takes an id alone, so a caller running outside
 *        `protectedProcedure` — which is every caller, since this is for the
 *        workflow — cannot accidentally load another workspace's project.
 *        Returns null when it does not match, which the step turns into a
 *        NonRetriableError: a project that is not ours will not become ours on
 *        the second attempt.
 *
 *        `words` comes back EMPTY when there is no alignment, rather than
 *        refusing, because a generator must still build a playable document
 *        without captions (EMPTY_WORDS_STILL_BUILDS).
 * WHERE: The `timeline` stage.
 */
export async function generatorContextFor(
  db: DbClient,
  organizationId: string,
  projectId: string,
  plan: PlanKey,
): Promise<{ ctx: GeneratorContext; kind: ProjectKind } | null> {
  const project = await db.project.findFirst({
    /* RECHECK_OWNERSHIP_IN_THE_WORKFLOW — never by id alone. */
    where: { id: projectId, organizationId },
    select: { id: true, kind: true, aspect: true, settings: true },
  });
  if (project === null) return null;

  const kind = projectKindSchema.safeParse(project.kind);
  if (!kind.success) {
    console.error(
      `[pipeline.service] ${projectId}: stored kind "${project.kind}" is not a known format.`,
    );
    return null;
  }

  const [speakers, lines, alignment, background] = await Promise.all([
    db.speaker.findMany({
      where: { organizationId, projectId },
      /* `avatarId` is read here so the cast can be resolved in one more query
       * rather than one per speaker — Phase 12, CAST_IS_A_FACT. */
      select: { tag: true, voiceId: true, avatarId: true },
      orderBy: { tag: "asc" },
    }),
    db.narrationLine.findMany({
      where: { organizationId, projectId, status: "ready" },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        speakerTag: true,
        text: true,
        audioAssetId: true,
        durationSec: true,
      },
    }),
    db.alignment.findFirst({
      where: { projectId, project: { organizationId } },
      select: { words: true },
    }),
    /**
     * SOURCE OF TRUTH KEYWORDS: RESOLVED_BEFORE_THE_GENERATOR,
     *   ONE_RESOLVER_TWO_CALLERS, BACKGROUND_IS_A_FACT
     *
     * Phase 11. Resolved HERE rather than inside the generator, because
     * choosing a background means weighing three candidates against the plan
     * and generators resolve no entitlements (GENERATOR_CONTEXT_IS_FACTS). The
     * same function feeds the picker, which is what keeps what the customer
     * sees selected and what ends up in the video the same row.
     *
     * Null is the normal answer on a shipped checkout — the catalogue is empty
     * until the licensing position is settled — and it means the styled
     * backdrop, which is a complete video.
     */
    resolveProjectBackground(db, {
      organizationId,
      projectId,
      plan,
      kinds: [...BACKGROUND_ASSET_KINDS],
    }),
  ]);

  const settings = jsonObjectSchema.safeParse(project.settings);
  /* The aspect column is a String; an unrecognised value falls back to the
   * product's default shape rather than failing a run that is otherwise fine. */
  const aspect = aspectRatioSchema.safeParse(project.aspect);

  /**
   * SOURCE OF TRUTH KEYWORDS: CAST_IS_A_FACT, RESOLVED_BEFORE_THE_GENERATOR
   *
   * Phase 12. The faces, resolved to artwork ids before the build, for the same
   * reason the background is: it is three tables and a plan check, and a
   * generator may do neither (GENERATOR_CONTEXT_IS_FACTS, GENERATORS_STAY_PURE).
   *
   * ONE query for every avatar the cast names, not one per speaker — a thread
   * with three roles would otherwise be three round trips to answer one
   * question. Resolved AFTER the speakers because it depends on them, which is
   * why it is not in the `Promise.all` above.
   */
  const cast = await resolveCast(db, speakers, plan);

  /**
   * SOURCE OF TRUTH KEYWORDS: SNAPSHOT_IS_WHAT_THE_CARD_SHOWS
   *
   * The thread's facts for the title card, read from the project's own
   * settings rather than re-fetched. Null for every non-Reddit format, and
   * null once the retention window has passed — in which case the story still
   * renders, without its card.
   */
  const thread = readThreadSnapshot(settings.success ? settings.data : {});

  return {
    kind: kind.data,
    ctx: {
      organizationId,
      projectId,
      words: readWords(projectId, alignment?.words),
      /* A line is only usable with both an asset and a measured duration —
       * READY_LINES_ONLY, as in listAlignableLines. */
      lines: lines.flatMap((line) =>
        line.audioAssetId === null || line.durationSec === null
          ? []
          : [
              {
                id: line.id,
                position: line.position,
                speakerTag: line.speakerTag,
                text: line.text,
                audioAssetId: line.audioAssetId,
                durationSec: line.durationSec,
              },
            ],
      ),
      speakers: Object.fromEntries(
        speakers.map((speaker) => [speaker.tag, speaker.voiceId]),
      ),
      aspect: aspect.success ? aspect.data : "9:16",
      settings: settings.success ? settings.data : {},
      background:
        background === null
          ? null
          : {
              assetId: background.row.id,
              durationSec: background.row.durationSec,
              /* LICENSE_TERMS_ARE_NOT_A_CATEGORY — the row's `license` column
               * holds the real terms, which the document's closed enum cannot
               * express. `licenseCategoryFor` maps one to the other and falls
               * back to `unknown`, which is a value a render can be refused on
               * rather than a claim nobody checked. */
              license: licenseCategoryForSource(background.row.source),
              width: background.row.width,
              height: background.row.height,
            },
      cast,
      thread,
      db,
    },
  };
}

/* WORDS_ARE_VALIDATED_ON_READ, as in src/services/alignment.service.ts: the
 * payload is jsonb written by a possibly older release, so it is parsed with
 * the document's own schema. An unparseable alignment yields no captions rather
 * than captions with NaN timings. */
/**
 * SOURCE OF TRUTH KEYWORDS: resolveCast, CAST_IS_A_FACT,
 *   A_SET_IS_COMPLETE_OR_REFUSED, UNASSIGNED_IS_NOT_AN_ERROR
 *
 * WHAT:  Speaker tag → the artwork ids of the avatar assigned to it.
 *
 * WHY:   UNASSIGNED_IS_NOT_AN_ERROR. Three things make a speaker drop out of
 *        the cast, and all three are normal rather than failures: no avatar
 *        assigned (a narrator who is never on screen), an avatar that has since
 *        been withdrawn (`isActive: false` — DEACTIVATE_NEVER_DELETE), and an
 *        avatar above the workspace's plan. Each one means no overlay for that
 *        speaker, which is a video with fewer faces and not a broken one.
 *
 *        A_SET_IS_COMPLETE_OR_REFUSED: an avatar whose `assetSet` does not
 *        parse into all three states is skipped too. A character missing its
 *        resting frame would vanish between sentences, and no overlay is better
 *        than one that flickers to nothing.
 *
 *        The plan check is HERE rather than in the generator because this is
 *        the layer that was given the plan, and it is re-checked at generate
 *        time rather than trusted from the assignment: a workspace can
 *        downgrade between casting a premium character and generating, and the
 *        honest result then is a video without that face rather than a paid
 *        feature leaking.
 * WHERE: generatorContextFor.
 */
async function resolveCast(
  db: DbClient,
  speakers: readonly { tag: string; avatarId: string | null }[],
  plan: PlanKey,
): Promise<Record<string, CastMember | undefined>> {
  const wanted = [
    ...new Set(
      speakers.flatMap((speaker) =>
        speaker.avatarId === null ? [] : [speaker.avatarId],
      ),
    ),
  ];
  if (wanted.length === 0) return {};

  const rows = await db.avatar.findMany({
    where: { id: { in: wanted }, isActive: true },
    select: { id: true, assetSet: true, minPlan: true },
  });

  const usable = new Map<string, CastMember>();
  for (const row of rows) {
    if (!avatarAvailableOnPlan(row.minPlan, plan)) continue;
    const states = readAvatarAssetSet(row.assetSet);
    if (states === null) {
      console.warn(
        `[pipeline.service] Avatar ${row.id} has an incomplete asset set; no overlay will be drawn for it.`,
      );
      continue;
    }
    usable.set(row.id, { avatarId: row.id, states });
  }

  const cast: Record<string, CastMember | undefined> = {};
  for (const speaker of speakers) {
    if (speaker.avatarId === null) continue;
    const member = usable.get(speaker.avatarId);
    if (member !== undefined) cast[speaker.tag] = member;
  }
  return cast;
}

/**
 * SOURCE OF TRUTH KEYWORDS: readThreadSnapshot, SNAPSHOT_IS_WHAT_THE_CARD_SHOWS,
 *   SETTINGS_ARE_PARSED_NOT_TRUSTED
 *
 * WHAT:  The thread facts for a title card, out of `Project.settings.reddit`.
 * WHY:   Null for anything that does not parse, which covers three real cases
 *        with one answer: a non-Reddit project (no `reddit` key at all), a
 *        Reddit project whose snapshot the retention sweep has removed, and a
 *        row written by an older release. All three mean "draw no card", and a
 *        thrown error would fail a run that is otherwise fine.
 *
 *        Only the three fields the card draws are passed on, even though the
 *        snapshot holds more: a generator that could see the URL and the fetch
 *        time would be a generator somebody later puts them on screen from.
 * WHERE: generatorContextFor.
 */
function readThreadSnapshot(
  bag: Record<string, unknown>,
): { title: string; subreddit: string; author: string } | null {
  const parsed = redditThreadSnapshotSchema.safeParse(bag["reddit"]);
  if (!parsed.success) return null;
  return {
    title: parsed.data.title,
    subreddit: parsed.data.subreddit,
    author: parsed.data.author,
  };
}

function readWords(projectId: string, words: unknown): WordToken[] {
  if (words === undefined || words === null) return [];
  const parsed = wordTokenSchema.array().safeParse(words);
  if (parsed.success) return parsed.data;

  console.error(
    `[pipeline.service] ${projectId}: stored alignment words did not parse; building without captions.`,
    parsed.error.issues.slice(0, 3),
  );
  return [];
}

/**
 * SOURCE OF TRUTH KEYWORDS: pipelineIdempotencyKey, projectDocHash,
 *   IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE
 *
 * WHAT:  The enqueue key for one generate request.
 *
 * WHY:   IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE. The phase asks for
 *        `projectId + docHash`, and the subtlety is WHICH document: there is no
 *        timeline document yet on a first run — building one is the point — so
 *        hashing the output is impossible. What is hashed instead is the INPUT
 *        shape: the project's kind, aspect and settings, plus the script and
 *        narration state the run would consume. Two rapid identical requests
 *        produce the same key and therefore one run (the phase's check), while
 *        a genuine second attempt after an edit hashes differently and is not
 *        swallowed.
 *
 *        `hashDoc` is reused rather than a second hashing utility written here.
 *        It canonicalises before hashing, so key order in the settings object
 *        cannot change the key — which a plain `JSON.stringify` would, every
 *        time a phase added a settings field.
 *
 *        A `force` request appends a timestamp bucket, because Retry on a
 *        failed run must produce a NEW run and its inputs are by definition
 *        unchanged. Bucketed to the second rather than raw, so a
 *        double-clicked Retry is still one run.
 * WHERE: `projects.generate`.
 */
export async function pipelineIdempotencyKey(
  db: DbClient,
  organizationId: string,
  projectId: string,
  options: { force?: boolean } = {},
): Promise<string> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { kind: true, aspect: true, settings: true, sourceRef: true },
  });

  const [blocks, lines] = await Promise.all([
    db.scriptBlock.findMany({
      where: { organizationId, projectId },
      orderBy: { position: "asc" },
      select: { position: true, narrationText: true, speakerTag: true },
    }),
    db.narrationLine.findMany({
      where: { organizationId, projectId },
      orderBy: { position: "asc" },
      select: { position: true, textHash: true, status: true },
    }),
  ]);

  /* hashValue canonicalises before hashing, so a plain object of the same facts
   * hashes identically whatever order its keys were built in — see
   * SAME_HASH_FOR_ANY_SHAPE in src/lib/timeline/hash.ts. */
  const shape = {
    kind: project?.kind ?? null,
    aspect: project?.aspect ?? null,
    sourceRef: project?.sourceRef ?? null,
    settings: project?.settings ?? null,
    blocks,
    lines,
  };

  const digest = hashValue(shape);
  const suffix = options.force === true ? `-f${Math.floor(Date.now() / 1000)}` : "";
  return `generate-${projectId}-${digest}${suffix}`;
}
