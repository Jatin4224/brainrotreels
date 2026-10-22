/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_CATEGORIES, ModerationCategory,
 *   MODERATION_VERDICTS, ModerationVerdictStatus, ModerationVerdict,
 *   moderationVerdictSchema, MODERATION_SUBJECT_TYPES, ModerationSubjectType,
 *   MODERATION_CONTEXTS, ModerationContext, CATEGORY_LABELS,
 *   describeModerationVerdict, CATEGORIES_ARE_CLOSED, REFUSAL_NAMES_THE_REASON,
 *   listModerationRecordsSchema
 *
 * WHAT:  The vocabulary of content safety — what a classifier may say about a
 *        piece of text, what it may say it about, and how that becomes a
 *        sentence a customer can act on.
 *
 * WHY:   CATEGORIES_ARE_CLOSED. A model asked to label content will happily
 *        invent a category name, and three different spellings of "violence"
 *        across a thousand rows makes the flagged queue unsortable and the
 *        refusal message unwritable. The enum is the contract: a provider that
 *        reports something outside it is mapped to `other` rather than passed
 *        through — the same lossy-on-purpose mapping Phase 07 used for voice
 *        labels, and for the same reason. A row labelled `other` is honest; a
 *        row labelled `hate` because the mapper reached for the nearest option
 *        is a customer accused of something they did not do.
 *
 *        REFUSAL_NAMES_THE_REASON is the phase's own requirement: a refusal
 *        must name the category, not say "this content violates our policy".
 *        That is why every category carries a CUSTOMER-FACING sentence here
 *        rather than in a component — the refusal is raised in a service, a
 *        workflow step and a router, and three copies of the copy would drift.
 *
 *        The verdict statuses are NOT the same union as `Asset.moderationStatus`
 *        (`pending | approved | rejected | skipped`), and conflating them was
 *        the first thing worth getting right. A VERDICT is what a classifier
 *        returned; a STATUS is where a row currently stands. `flagged` is a
 *        verdict with no status of its own — it means "a human should look",
 *        which on an asset is still `pending`. Grep
 *        `VERDICT_IS_NOT_A_STATUS`.
 * WHERE: src/lib/adapters/moderation/, src/services/moderation.service.ts, the
 *        `moderate` stage of src/inngest/functions/project-generate.ts, the
 *        ingest workflow, and the portal's flagged queue. Re-exported from
 *        src/lib/types.
 */

import { z } from "zod";

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_CATEGORIES, ModerationCategory,
 *   CATEGORIES_ARE_CLOSED
 *
 * WHAT:  The things this product refuses to make a video out of.
 *
 * WHY:   Chosen for what a short-form video generator actually gets asked for,
 *        not copied from a general-purpose policy taxonomy. Each one is a
 *        category an operator would want to see counted separately in the
 *        flagged queue, which is the test for whether it deserves to exist:
 *        `csam` and `sexual` are both sexual content and are emphatically not
 *        the same operational event.
 *
 *        `other` is last and is the fallback for anything a provider reports
 *        that does not map. It is not a catch-all for "mildly bad" — a verdict
 *        of `rejected` with category `other` still carries the provider's
 *        reason for an operator to read.
 * WHERE: `ModerationVerdict.categories`, `ModerationRecord.categories`, and
 *        CATEGORY_LABELS below.
 */
export const MODERATION_CATEGORIES = [
  "csam",
  "sexual",
  "violence",
  "hate",
  "harassment",
  "self-harm",
  "illegal",
  "extremism",
  "deception",
  "privacy",
  "other",
] as const;

export const moderationCategorySchema = z.enum(MODERATION_CATEGORIES);

export type ModerationCategory = z.infer<typeof moderationCategorySchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CATEGORY_LABELS, REFUSAL_NAMES_THE_REASON
 *
 * WHAT:  What each category is called when a customer is told about it.
 *
 * WHY:   REFUSAL_NAMES_THE_REASON. "This request was refused because it asks
 *        for content that sexualises a minor" is actionable and unambiguous;
 *        "your content violates our policy" sends the customer to support to
 *        find out which policy. The wire name is a slug for querying and the
 *        label is a phrase for a sentence — the same split as
 *        PIPELINE_STAGE_LABELS.
 *
 *        Typed as a FULL Record, so adding a category without a label is a
 *        compile error rather than a refusal reading "other".
 * WHERE: describeModerationVerdict below, which is the only sanctioned way to
 *        turn a verdict into customer-facing text.
 */
export const CATEGORY_LABELS: Readonly<Record<ModerationCategory, string>> = {
  csam: "content that sexualises a minor",
  sexual: "sexually explicit content",
  violence: "graphic violence",
  hate: "hateful content targeting a group",
  harassment: "harassment of a person",
  "self-harm": "content promoting self-harm",
  illegal: "instructions for something illegal",
  extremism: "extremist or terrorist content",
  deception: "impersonation or deliberate misinformation",
  privacy: "someone else's private information",
  other: "content our policy does not allow",
};

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_VERDICTS, ModerationVerdictStatus,
 *   VERDICT_IS_NOT_A_STATUS
 *
 * WHAT:  What a classifier concluded.
 *
 * WHY:   Three outcomes, and `flagged` is the one that earns its place. A
 *        binary allow/deny forces every borderline case into one of two wrong
 *        answers: refuse it and you block legitimate work with no appeal, or
 *        allow it and you publish something nobody reviewed. `flagged` means
 *        the work is BLOCKED but a human is asked — which is what the phase's
 *        flagged-moderation queue in the portal is for.
 *
 *        VERDICT_IS_NOT_A_STATUS — see the file header. Nothing here is
 *        assignable to `Asset.moderationStatus`.
 * WHERE: `ModerationVerdict.status`; `ModerationRecord.status`.
 */
export const MODERATION_VERDICTS = ["approved", "rejected", "flagged"] as const;

export const moderationVerdictStatusSchema = z.enum(MODERATION_VERDICTS);

export type ModerationVerdictStatus = z.infer<
  typeof moderationVerdictStatusSchema
>;

/**
 * SOURCE OF TRUTH KEYWORDS: isModerationBlocking, BLOCKED_IS_NOT_REJECTED
 *
 * WHAT:  Whether this verdict stops the work.
 * WHY:   BLOCKED_IS_NOT_REJECTED. Both `rejected` and `flagged` stop the work,
 *        and every caller has to make that decision — so it is written once
 *        here rather than as `status !== 'approved'` in five places, one of
 *        which will eventually be `status === 'rejected'` and let flagged
 *        content through.
 * WHERE: The moderation service, the generate workflow, the ingest workflow.
 */
export function isModerationBlocking(status: ModerationVerdictStatus): boolean {
  return status !== "approved";
}

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_CONTEXTS, ModerationContext
 *
 * WHAT:  What kind of text is being classified.
 *
 * WHY:   The same words mean different things in different places, and the
 *        classifier is told which it is looking at. A customer's PROMPT asking
 *        for "a video about the history of the Blitz" is a request; the
 *        extracted article text it produces is SOURCE MATERIAL that will
 *        legitimately describe bombing; the generated SCRIPT is what will
 *        actually be published in our name. Judging all three by one standard
 *        either refuses history documentaries or publishes things it should
 *        not.
 *
 *        It is also the one field that must never come from the text itself —
 *        it is a closed enum chosen by the CALLER, which is what stops a
 *        pasted article from claiming to be a prompt.
 * WHERE: `ModerationAdapter.classify`.
 */
export const MODERATION_CONTEXTS = ["prompt", "input", "script"] as const;

export const moderationContextSchema = z.enum(MODERATION_CONTEXTS);

export type ModerationContext = z.infer<typeof moderationContextSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_SUBJECT_TYPES, ModerationSubjectType
 *
 * WHAT:  What a `ModerationRecord` is about.
 * WHY:   `subjectType` + `subjectId` rather than four nullable foreign keys,
 *        because the row is an AUDIT TRAIL and the thing it refers to may be
 *        deleted — a customer deleting the project they were refused for must
 *        not delete the record of the refusal. The index on
 *        `[subjectType, subjectId]` is what makes "has this been moderated"
 *        answerable without a join.
 * WHERE: ModerationRecord.subjectType in prisma/schema.prisma.
 */
export const MODERATION_SUBJECT_TYPES = [
  "project",
  "asset",
  "prompt",
  "script",
] as const;

export const moderationSubjectTypeSchema = z.enum(MODERATION_SUBJECT_TYPES);

export type ModerationSubjectType = z.infer<
  typeof moderationSubjectTypeSchema
>;

/**
 * SOURCE OF TRUTH KEYWORDS: ModerationVerdict, moderationVerdictSchema,
 *   SCHEMA_IS_THE_CONTRACT
 *
 * WHAT:  One classification result.
 *
 * WHY:   This is the schema the model is asked to FILL (the LLM adapter takes
 *        a Zod type and returns a parsed value — SCHEMA_IS_THE_CONTRACT), so
 *        it is written for a model to answer as much as for a caller to read.
 *        `categories` is an array because real content is often two things at
 *        once, and an empty array on an `approved` verdict is the normal case.
 *
 *        `reason` is the model's own words, kept for an OPERATOR. It is never
 *        shown to a customer — `describeModerationVerdict` builds that from
 *        the categories, because a model's free text about why it refused
 *        something is both unpredictable and occasionally a lecture.
 * WHERE: Returned by every moderation adapter; stored on ModerationRecord.
 */
export const moderationVerdictSchema = z
  .object({
    status: moderationVerdictStatusSchema,
    categories: z.array(moderationCategorySchema),
    /** For the operator and the audit trail. Never rendered to a customer. */
    reason: z.string().max(2000).optional(),
  })
  .strict();

export type ModerationVerdict = z.infer<typeof moderationVerdictSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: describeModerationVerdict, REFUSAL_NAMES_THE_REASON
 *
 * WHAT:  The sentence a refused customer reads.
 *
 * WHY:   The ONE place a verdict becomes customer-facing text, so the message
 *        is identical whether the refusal came from the pipeline, an upload or
 *        a router. It names the categories (the phase's requirement) and says
 *        what to do next, because a refusal with no next step is a support
 *        ticket.
 *
 *        A `flagged` verdict gets different copy from a `rejected` one on
 *        purpose: flagged means a human will look, so telling the customer to
 *        edit and retry would be wrong — and telling them they were rejected
 *        when they were not is worse.
 *
 *        An `approved` verdict returns an empty string rather than throwing.
 *        Callers build the message before branching in some paths, and a throw
 *        here would be an exception on the happy path.
 * WHERE: The moderation service, and every surface that reports a refusal.
 */
export function describeModerationVerdict(
  verdict: Pick<ModerationVerdict, "status" | "categories">,
): string {
  if (verdict.status === "approved") return "";

  const named = verdict.categories
    .map((category) => CATEGORY_LABELS[category])
    .filter((label, index, all) => all.indexOf(label) === index);

  const because =
    named.length === 0
      ? CATEGORY_LABELS.other
      : named.length === 1
        ? (named[0] ?? CATEGORY_LABELS.other)
        : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;

  if (verdict.status === "flagged") {
    return `This was held for review because it may contain ${because}. Someone will look at it shortly — you do not need to do anything.`;
  }

  return `This cannot be generated because it contains ${because}. Edit it and try again.`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: listModerationRecordsSchema, MODERATION_PAGE_SIZE
 *
 * WHAT:  Input for the portal's flagged-moderation queue.
 * WHY:   `organizationId` is absent, and that is the one thing to notice: this
 *        is a PLATFORM-ADMIN read across every workspace, so it goes through
 *        `portalProcedure` rather than `protectedProcedure` and has no tenant
 *        to scope to. Every other list schema in this codebase requires one.
 * WHERE: `portal.listModeration` in src/trpc/routers/portal.ts.
 */
export const MODERATION_PAGE_SIZE = 25;

export const listModerationRecordsSchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  status: moderationVerdictStatusSchema.optional(),
  subjectType: moderationSubjectTypeSchema.optional(),
});

export type ListModerationRecordsValues = z.infer<
  typeof listModerationRecordsSchema
>;
