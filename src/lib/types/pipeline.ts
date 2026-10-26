/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PIPELINE_STAGES, PipelineStageName,
 *   pipelineStageNameSchema, PIPELINE_STAGE_STATUSES, PipelineStageStatus,
 *   StageUpdate, stageUpdateSchema, PIPELINE_STAGE_LABELS,
 *   generateProjectSchema, cancelProjectSchema, projectStagesSchema,
 *   projectProgressSchema, generateSettingsSchema, GenerateSettings,
 *   STAGES_ARE_FIXED, SKIPPED_NOT_OMITTED, isTerminalStageStatus,
 *   PIPELINE_POLL_MS
 *
 * WHAT:  The vocabulary of the generate pipeline — its ordered stage list, the
 *        five states a stage can be in, the update the progress subscription
 *        yields, and the input schema of every pipeline procedure.
 *
 * WHY:   STAGES_ARE_FIXED. `PipelineStage.stage` is a Prisma `String` because
 *        this schema has zero enum blocks, so the database will happily store
 *        "allign". This tuple is the only thing standing between a typo in a
 *        workflow step and a progress list with a phantom row in it — and it
 *        is ORDERED, because the UI renders it in this order rather than in
 *        whatever order the rows come back. Adding a stage is an edit here and
 *        nowhere else; the UI derives its list from this tuple.
 *
 *        SKIPPED_NOT_OMITTED is the rule that makes the progress display
 *        stable. A kind that does not use a stage writes it as `skipped`
 *        rather than leaving it out, so the list a customer is watching never
 *        reshuffles as the run proceeds — a progress UI whose rows move is one
 *        nobody can read. `skipped` is therefore a FIRST-CLASS status, not an
 *        absence, and the UI renders it greyed with its reason.
 *
 *        The tuple deliberately names stages NO kind runs yet (`visuals`,
 *        `storyboard`, `design`, `render`). They are here because the list is
 *        the contract between the workflow and the UI, and a phase that adds a
 *        stage must not be able to change the shape of every progress screen.
 *        Phases 11 to 16 fill them in; until then voiceover writes them
 *        `skipped` and says why.
 *
 *        PIPELINE_POLL_MS is the phase's fallback interval and lives here
 *        rather than in the component, because the REST surface in Phase 17
 *        polls the same query and must not invent a second cadence.
 * WHERE: src/services/pipeline.service.ts,
 *        src/inngest/functions/project-generate.ts, the `projects.*` pipeline
 *        procedures, src/lib/generators/, and the progress UI. Re-exported
 *        from src/lib/types.
 */

import { z } from "zod";

/**
 * SOURCE OF TRUTH KEYWORDS: PIPELINE_STAGES, pipelineStageNameSchema,
 *   PipelineStageName, STAGES_ARE_FIXED
 *
 * WHAT:  Every stage of the pipeline, in the order it runs and the order the
 *        UI draws it.
 * WHY:   See STAGES_ARE_FIXED in the file header. The order IS the array
 *        order: nothing sorts these at a callsite, and nothing may.
 * WHERE: The workflow's steps, the progress list, and the `skipped` rows a
 *        kind writes for the stages it does not use.
 */
export const PIPELINE_STAGES = [
  "moderate",
  "script",
  "voices",
  "tts",
  "align",
  "visuals",
  "storyboard",
  "design",
  "qa",
  "timeline",
  "render",
  "finalize",
] as const;

export const pipelineStageNameSchema = z.enum(PIPELINE_STAGES);

export type PipelineStageName = z.infer<typeof pipelineStageNameSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: PIPELINE_STAGE_STATUSES, pipelineStageStatusSchema,
 *   PipelineStageStatus, SKIPPED_NOT_OMITTED
 *
 * WHAT:  What a stage row can say about itself.
 * WHY:   `pending` and `skipped` are both "not running and not done" and are
 *        emphatically not the same thing: `pending` is a promise the run will
 *        reach it, `skipped` is a statement that it never will. Collapsing
 *        them would leave the UI unable to tell a customer whether the thing
 *        they are waiting for is still coming.
 * WHERE: PipelineStage.status.
 */
export const PIPELINE_STAGE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export const pipelineStageStatusSchema = z.enum(PIPELINE_STAGE_STATUSES);

export type PipelineStageStatus = z.infer<typeof pipelineStageStatusSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: PIPELINE_TERMINAL_STATUSES, isTerminalStageStatus
 *
 * WHAT:  Whether a stage will ever change again.
 * WHY:   The subscription and the polling fallback BOTH have to decide when to
 *        stop, and deciding it twice is how one of them hangs open for five
 *        minutes against a finished run. One predicate, two callers.
 * WHERE: `projects.progress`, and the client's poll interval.
 */
export const PIPELINE_TERMINAL_STATUSES: readonly PipelineStageStatus[] = [
  "completed",
  "failed",
  "skipped",
];

export function isTerminalStageStatus(status: string): boolean {
  return (PIPELINE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** The phase's fallback cadence, shared by the client poll and Phase 17's REST read. */
export const PIPELINE_POLL_MS = 2000;

/**
 * SOURCE OF TRUTH KEYWORDS: StageUpdate, stageUpdateSchema,
 *   ONE_SHAPE_FOR_BOTH_TRANSPORTS, ELAPSED_IS_DERIVED_ON_THE_SERVER
 *
 * WHAT:  One stage's state, as the progress subscription yields it and the
 *        polling query returns it.
 *
 * WHY:   ONE_SHAPE_FOR_BOTH_TRANSPORTS is what makes the phase's "killing the
 *        subscription falls back to polling and the UI keeps updating" true
 *        without a second renderer. The component takes `StageUpdate[]` and
 *        has no idea which transport produced it.
 *
 *        ELAPSED_IS_DERIVED_ON_THE_SERVER: `elapsedMs` is computed where the
 *        clock is authoritative rather than in the browser from two
 *        timestamps. A client whose clock is ten minutes off would otherwise
 *        show a stage that has been running for minus ten minutes, and a
 *        serialised `Date` arriving over SSE makes that mistake easy to make.
 * WHERE: Yielded by `projects.progress`, returned by `projects.getStages`,
 *        rendered by <StageProgress>.
 */
export const stageUpdateSchema = z.object({
  stage: pipelineStageNameSchema,
  status: pipelineStageStatusSchema,
  /* Plain language, never a provider stack trace — see
   * FAILURE_IS_EXPLAINED_NOT_DUMPED in src/services/pipeline.service.ts. */
  error: z.string().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  /** How long the stage has run, or ran. Null until it starts. */
  elapsedMs: z.number().int().nonnegative().nullable(),
});

export type StageUpdate = z.infer<typeof stageUpdateSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: PIPELINE_STAGE_LABELS, LABELS_ARE_NOT_STAGE_NAMES
 *
 * WHAT:  What each stage is called on screen, and the one line that explains
 *        it.
 * WHY:   LABELS_ARE_NOT_STAGE_NAMES. "tts" is an industry acronym and "align"
 *        means nothing to the person watching their video get made, so the
 *        wire name and the human name are different strings. Kept beside the
 *        tuple and typed as a FULL Record, so adding a stage without a label
 *        is a compile error rather than a progress row reading "storyboard".
 * WHERE: <StageProgress>, and the aria-live announcement it builds.
 */
export const PIPELINE_STAGE_LABELS: Readonly<
  Record<PipelineStageName, { readonly label: string; readonly hint: string }>
> = {
  moderate: { label: "Safety check", hint: "Making sure the request is allowed" },
  script: { label: "Writing the script", hint: "Turning the source into narration" },
  voices: { label: "Casting voices", hint: "Checking every speaker has a voice" },
  tts: { label: "Recording narration", hint: "Synthesising each line of speech" },
  align: { label: "Timing captions", hint: "Matching every word to the audio" },
  visuals: { label: "Choosing visuals", hint: "Picking what appears behind the words" },
  storyboard: { label: "Storyboarding", hint: "Deciding what appears when" },
  design: { label: "Designing", hint: "Laying out the on-screen elements" },
  /* Before `timeline`, not after it, and the label says so: this stage checks
   * that every PIECE is present and consistent — audio for every line, a
   * measured duration on each, word timings that cover the narration — because
   * the one thing a progress list must never do is go green out of order. The
   * built document is validated inside `timeline` itself, where a failure can
   * name the item that broke. */
  qa: { label: "Checking the pieces", hint: "Making sure every part of the video is ready" },
  timeline: { label: "Building the timeline", hint: "Assembling the video document" },
  render: { label: "Rendering", hint: "Producing the final file" },
  finalize: { label: "Finishing up", hint: "Pricing the render and tidying up" },
};

/**
 * SOURCE OF TRUTH KEYWORDS: generateSettingsSchema, GenerateSettings,
 *   GENERATE_SETTINGS_LIVE_ON_THE_PROJECT, MUSIC_IS_OPTIONAL
 *
 * WHAT:  The pipeline's per-project preferences, stored under
 *        `Project.settings.generate`.
 *
 * WHY:   GENERATE_SETTINGS_LIVE_ON_THE_PROJECT, for the same reason the
 *        caption settings do (CAPTION_SETTINGS_LIVE_ON_THE_PROJECT in
 *        ./caption): the timeline document is the pipeline's OUTPUT, so a
 *        preference that steers the run cannot live in it — it would not exist
 *        until after the thing it was meant to influence.
 *
 *        `notifyWhenDone` is the phase's "email me when done", and it is
 *        STORED rather than carried on the event on purpose: the customer
 *        ticks it while the run is already going, and an event payload cannot
 *        be edited after it is sent.
 *
 *        MUSIC_IS_OPTIONAL and usually absent. There is no music library until
 *        Phase 11, so a generator has to build a perfectly good video without
 *        one — see the same keyword in src/lib/generators/voiceover.ts.
 * WHERE: Read by the workflow and the generators; written by
 *        `projects.generate`.
 */
export const generateSettingsSchema = z.object({
  notifyWhenDone: z.boolean().default(false),
  /**
   * WHO to email. A `Project` has no creator column — it belongs to the
   * WORKSPACE, not to a person — so the member who asked to be told is
   * recorded here, and the finalize step resolves their address through the
   * auth adapter. Storing the ADDRESS instead would copy a piece of personal
   * data into a settings blob that gets duplicated by `projects.duplicate` and
   * would go stale the moment they changed it.
   */
  notifyUserId: z.string().trim().min(1).max(120).optional(),
  /** An Asset id, if this workspace picked a music bed. */
  musicAssetId: z.string().trim().min(1).max(120).optional(),
  /**
   * SOURCE OF TRUTH KEYWORDS: backgroundAssetId, BACKGROUND_IS_A_SETTING,
   *   NULL_CLEARS_THE_CHOICE
   *
   * The library row or upload that plays behind the narration, from Phase 11.
   * Absent means "the styled backdrop", which is a real and reasonable video
   * rather than a missing choice — see MUSIC_IS_OPTIONAL above for the same
   * argument applied to the music bed.
   *
   * BACKGROUND_IS_A_SETTING and not a column, which the phase file asks for
   * explicitly. It is a preference that STEERS a run, so it belongs with the
   * other preferences on `settings.generate` rather than in the timeline
   * document the run produces — a document does not exist until after the
   * thing it was meant to influence. It is also what the workspace's NEXT
   * project defaults from (see lastBackgroundAssetId in
   * src/services/backgrounds.service.ts), which a column on `Project` would
   * have served equally badly and at the cost of a migration.
   */
  backgroundAssetId: z.string().trim().min(1).max(120).optional(),
  /** Which palette the styled background uses. Defaults per kind. */
  paletteId: z.string().trim().min(1).max(60).optional(),
});

export type GenerateSettings = z.infer<typeof generateSettingsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: ClearableGenerateSettingKey,
 *   CLEARING_IS_NOT_PATCHING
 *
 * WHAT:  The generate settings that can be REMOVED rather than only replaced.
 * WHY:   Derived from the schema rather than listed, so a new optional
 *        preference is clearable the moment it is declared and a REQUIRED one
 *        (`notifyWhenDone`, which carries a default) can never be deleted by
 *        mistake — deleting it would leave a settings object that
 *        `generateSettingsSchema` refuses, and the symptom would be a run that
 *        silently fell back to every default.
 * WHERE: The `clear` argument of writeGenerateSettings in
 *        src/services/pipeline.service.ts.
 */
export type ClearableGenerateSettingKey = {
  [K in keyof GenerateSettings]-?: Record<never, never> extends Pick<
    GenerateSettings,
    K
  >
    ? K
    : never;
}[keyof GenerateSettings];

/**
 * SOURCE OF TRUTH KEYWORDS: generateProjectSchema, GenerateProjectValues,
 *   cancelProjectSchema, projectStagesSchema, projectProgressSchema,
 *   ID_ON_MUTATIONS_PROJECTID_ON_READS
 *
 * WHAT:  Input for `projects.generate`, `projects.cancel`,
 *        `projects.getStages` and `projects.progress`.
 *
 * WHY:   ID_ON_MUTATIONS_PROJECTID_ON_READS, and the split is a decision
 *        rather than an oversight. The two MUTATIONS are `projects.*` verbs
 *        standing alongside `rename`, `delete` and `duplicate`, which all take
 *        `id` — a second name for the same field on the same router is how a
 *        client ends up sending `id` to one procedure and `projectId` to the
 *        next. The two PIPELINE READS take `projectId`, which is the name the
 *        phase's own contract gives them and the name the pipeline uses
 *        everywhere else: every `PipelineStage` row, every workflow event and
 *        every service signature.
 *
 *        `force` exists because a re-run of an unchanged project is otherwise
 *        swallowed by the idempotency key — which is right for a double-click
 *        and wrong for the Retry button on a failed run.
 * WHERE: src/trpc/routers/projects.ts and the generate screen.
 */
export const generateProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  /** The tick on the button; stored on the project so it outlives the request. */
  notifyWhenDone: z.boolean().optional(),
  /** Retry after a failure — bypasses the "nothing changed" short-circuit. */
  force: z.boolean().optional(),
});

export type GenerateProjectValues = z.infer<typeof generateProjectSchema>;

export const cancelProjectSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export type CancelProjectValues = z.infer<typeof cancelProjectSchema>;

export const projectStagesSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export const projectProgressSchema = projectStagesSchema;
