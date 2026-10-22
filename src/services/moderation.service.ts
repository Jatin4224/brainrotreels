/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: moderateText, recordModeration, listModerationRecords,
 *   findLatestModeration, countModerationByStatus, overrideModeration,
 *   ModerationOutcome, FAIL_CLOSED, RECORD_EVERY_DECISION,
 *   VERDICT_IS_NOT_A_STATUS, assetModerationStatusFor, TENANT_SCOPED_QUERY
 *
 * WHAT:  The one place content is classified, the one place the decision is
 *        written down, and the reads the portal's flagged queue needs.
 *
 * WHY:   FAIL_CLOSED is the reason this function exists at all rather than
 *        callers using the adapter directly. The adapter throws when it cannot
 *        classify (THIS_SEAM_FAILS_CLOSED); this is where a throw becomes a
 *        REFUSAL instead of an exception somebody might catch and continue past.
 *        `moderateText` therefore never throws and never returns a verdict
 *        meaning "unknown": a provider outage comes back as `flagged` with a
 *        plain message, which blocks the work (BLOCKED_IS_NOT_REJECTED) and
 *        puts it in front of a human rather than silently refusing a customer
 *        who did nothing wrong.
 *
 *        It is `flagged` rather than `rejected` on an outage deliberately. The
 *        work must not proceed either way, and that is what safety requires —
 *        but telling a customer their content was rejected when the classifier
 *        was simply unreachable is an accusation, and it is also the version
 *        that produces no operational signal. A pile of `flagged` rows with
 *        engine `unavailable` is a monitoring alert; a pile of `rejected` rows
 *        looks like a busy day.
 *
 *        RECORD_EVERY_DECISION, including approvals. The temptation is to
 *        store only the refusals, which is cheaper and is wrong twice over: a
 *        flagged queue cannot show a false-positive rate without the
 *        denominator, and an operator asked "was this checked?" about a
 *        published video needs a row that says yes. The table is append-only
 *        and one row per decision.
 *
 *        VERDICT_IS_NOT_A_STATUS. `assetModerationStatusFor` is the only
 *        sanctioned mapping from a classifier's verdict to the
 *        `Asset.moderationStatus` column, because the two unions differ on
 *        purpose and mapping them at three call sites is how `flagged` content
 *        ends up `approved` at one of them.
 *
 *        TENANT_SCOPED_QUERY for everything a TENANT can reach. The portal
 *        reads are deliberately NOT scoped — they are platform-admin queries
 *        across every workspace, which is exactly why they go through
 *        `portalProcedure` and are named `listAll`-style rather than looking
 *        like an ordinary service read.
 * WHERE: The `moderate` stage of src/inngest/functions/project-generate.ts, the
 *        `moderate` step of src/inngest/functions/asset-ingest.ts, and
 *        src/trpc/routers/portal.ts.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import {
  ModerationError,
  getModerationAdapter,
} from "@/lib/adapters/moderation";
import { type DbClient } from "@/lib/config/prisma";
import {
  describeModerationVerdict,
  isModerationBlocking,
  moderationCategorySchema,
  type ModerationCategory,
  type ModerationContext,
  type ModerationSubjectType,
  type ModerationVerdict,
  type ModerationVerdictStatus,
} from "@/lib/types/moderation";
import type { ModerationStatus } from "@/lib/types/asset";

/**
 * SOURCE OF TRUTH KEYWORDS: UNAVAILABLE_ENGINE, FAIL_CLOSED
 *
 * WHAT:  The `engine` written when no classifier could be reached.
 * WHY:   A sentinel rather than the adapter's id, so "the classifier said this
 *        was borderline" and "the classifier never answered" are
 *        distinguishable in the table forever. Without it an outage is
 *        indistinguishable from a bad day, and the first question in an
 *        incident — how many of these did we refuse because we were down — has
 *        no answer. Grep it to find every row produced by a failure.
 * WHERE: moderateText's fail-closed path.
 */
export const UNAVAILABLE_ENGINE = "unavailable";

/** An operator decision rather than a classification. */
export const MANUAL_ENGINE = "manual";

/**
 * SOURCE OF TRUTH KEYWORDS: ModerationOutcome, MESSAGE_IS_BUILT_ONCE
 *
 * WHAT:  A verdict, whether it blocks, and the sentence to show if it does.
 * WHY:   MESSAGE_IS_BUILT_ONCE. Three callers refuse work on this and all three
 *        need the same words, so the message is built here rather than at each
 *        of them — `describeModerationVerdict` is pure and lives in lib/types,
 *        and this is the one place it is called.
 *
 *        `blocked` is carried rather than recomputed because it is the field
 *        every caller branches on, and `status !== 'approved'` written at a
 *        call site is the shape that eventually becomes
 *        `status === 'rejected'` and lets flagged content through.
 * WHERE: Returned by moderateText.
 */
export interface ModerationOutcome {
  status: ModerationVerdictStatus;
  categories: ModerationCategory[];
  blocked: boolean;
  /** Customer-facing. Empty string when nothing is blocked. */
  message: string;
  /** For the operator and the audit row. Never rendered. */
  reason: string | null;
  /** The adapter id, or UNAVAILABLE_ENGINE. */
  engine: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: moderateText, FAIL_CLOSED, RECORD_EVERY_DECISION
 *
 * WHAT:  Classifies one piece of text, records the decision, and returns
 *        whether the work may proceed.
 *
 * WHY:   One function does both the classification and the record because the
 *        two must not come apart: a decision that was made and not written
 *        down is indistinguishable afterwards from one that never happened,
 *        and the version where a caller is trusted to log it is the version
 *        where one caller does not.
 *
 *        It NEVER THROWS. See FAIL_CLOSED in the file header — the point of
 *        this signature is that a caller cannot accidentally continue past a
 *        classifier outage, because there is no exception to swallow and no
 *        nullable to default.
 *
 *        The record write is wrapped so that a database failure cannot turn a
 *        successful REFUSAL into an exception that unwinds past the refusal. If
 *        the row cannot be written the verdict still stands — losing the audit
 *        row is bad, publishing the content because the audit row failed is
 *        worse.
 * WHERE: The generate pipeline's `moderate` stage, and the ingest workflow.
 */
export async function moderateText(
  db: DbClient,
  args: {
    organizationId: string;
    subjectType: ModerationSubjectType;
    subjectId: string;
    text: string;
    context: ModerationContext;
    purpose?: string;
  },
): Promise<ModerationOutcome> {
  const outcome = await classify(args);

  /* RECORD_EVERY_DECISION — approvals included. */
  try {
    await recordModeration(db, {
      organizationId: args.organizationId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      status: outcome.status,
      categories: outcome.categories,
      reason: outcome.reason,
      engine: outcome.engine,
    });
  } catch (error) {
    console.error(
      `[moderation.service] ${args.subjectType}:${args.subjectId}: the decision could not be recorded.`,
      error,
    );
  }

  return outcome;
}

/* The classification half, split out so the record-keeping above reads as one
 * thing. Not exported: a caller that wanted this without the record is a
 * caller making an unrecorded safety decision. */
async function classify(args: {
  text: string;
  context: ModerationContext;
  purpose?: string;
}): Promise<ModerationOutcome> {
  try {
    const adapter = await getModerationAdapter();
    const verdict = await adapter.classify({
      text: args.text,
      context: args.context,
      ...(args.purpose !== undefined ? { purpose: args.purpose } : {}),
    });

    return toOutcome(verdict, adapter.id);
  } catch (error) {
    /* FAIL_CLOSED. Everything lands here: a missing key, an unreachable
     * provider, a model refusal, output that would not parse. The work is
     * blocked and a human is asked — see the file header for why this is
     * `flagged` rather than `rejected`. */
    const detail =
      error instanceof ModerationError
        ? error.detail || error.message
        : error instanceof Error
          ? error.message
          : String(error);

    console.error(`[moderation.service] FAIL_CLOSED — ${detail}`);

    return {
      status: "flagged",
      categories: [],
      blocked: true,
      message:
        "This could not be checked against our content policy, so it has been held for review. Please try again shortly.",
      reason: `classifier unavailable: ${detail}`.slice(0, 1_000),
      engine: UNAVAILABLE_ENGINE,
    };
  }
}

function toOutcome(
  verdict: ModerationVerdict,
  engine: string,
): ModerationOutcome {
  return {
    status: verdict.status,
    categories: [...verdict.categories],
    blocked: isModerationBlocking(verdict.status),
    message: describeModerationVerdict(verdict),
    reason: verdict.reason ?? null,
    engine,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: assetModerationStatusFor, VERDICT_IS_NOT_A_STATUS
 *
 * WHAT:  The `Asset.moderationStatus` a verdict implies.
 * WHY:   The ONE mapping between the two unions — see the file header. A
 *        `flagged` verdict maps to `pending`, not to `rejected` and certainly
 *        not to `approved`: the review has not happened, so the honest column
 *        value is the one meaning "not yet cleared", which is also the value
 *        the render gate blocks on.
 * WHERE: The ingest workflow's `moderate` step.
 */
export function assetModerationStatusFor(
  status: ModerationVerdictStatus,
): ModerationStatus {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "flagged":
      return "pending";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: recordModeration, APPEND_ONLY
 *
 * WHAT:  Writes one decision.
 * WHY:   APPEND_ONLY — no upsert and no update. A second classification of the
 *        same subject is a second row, because the history is the point: a
 *        project refused, edited and then approved has three facts worth
 *        keeping, and an upsert would leave only the last one.
 *
 *        Categories are validated against the closed list on the way in rather
 *        than trusted, because they came from a model: an invented category
 *        would otherwise sit in jsonb forever and break the portal's filter the
 *        first time somebody grouped by it.
 * WHERE: moderateText, and the operator override.
 */
export async function recordModeration(
  db: DbClient,
  args: {
    organizationId: string;
    subjectType: ModerationSubjectType;
    subjectId: string;
    status: ModerationVerdictStatus;
    categories: readonly string[];
    reason: string | null;
    engine: string;
  },
): Promise<void> {
  const categories = args.categories.flatMap((candidate) => {
    const parsed = moderationCategorySchema.safeParse(candidate);
    if (parsed.success) return [parsed.data];
    console.warn(
      `[moderation.service] Dropping unrecognised category "${candidate}".`,
    );
    return [];
  });

  await db.moderationRecord.create({
    data: {
      organizationId: args.organizationId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      status: args.status,
      categories,
      engine: args.engine,
      ...(args.reason !== null ? { reason: args.reason } : {}),
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_RECORD_SELECT, ModerationRecordRow
 *
 * The columns the portal queue renders. Explicit rather than a bare
 * `findMany`, so adding a column to the table does not silently widen a
 * platform-admin payload.
 */
export const MODERATION_RECORD_SELECT = {
  id: true,
  organizationId: true,
  subjectType: true,
  subjectId: true,
  status: true,
  categories: true,
  reason: true,
  engine: true,
  createdAt: true,
} as const satisfies Prisma.ModerationRecordSelect;

export type ModerationRecordRow = Prisma.ModerationRecordGetPayload<{
  select: typeof MODERATION_RECORD_SELECT;
}>;

/**
 * SOURCE OF TRUTH KEYWORDS: findLatestModeration, LATEST_DECISION_WINS
 *
 * WHAT:  The most recent decision about one subject.
 * WHY:   LATEST_DECISION_WINS. The table is append-only, so "what is the
 *        current verdict" is a query rather than a column — and ordering by
 *        `createdAt desc` is the whole of it. Scoped by organization because a
 *        tenant-facing caller must not be able to read another workspace's
 *        decision by guessing a subject id.
 * WHERE: The captions/preview screens' "why was this refused" surface, and the
 *        pipeline's re-run check.
 */
export async function findLatestModeration(
  db: DbClient,
  organizationId: string,
  subjectType: ModerationSubjectType,
  subjectId: string,
): Promise<ModerationRecordRow | null> {
  return db.moderationRecord.findFirst({
    where: { organizationId, subjectType, subjectId },
    orderBy: { createdAt: "desc" },
    select: MODERATION_RECORD_SELECT,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: listModerationRecords, PLATFORM_WIDE_READ
 *
 * WHAT:  The flagged queue, newest first, across every workspace.
 * WHY:   PLATFORM_WIDE_READ — deliberately unscoped, which is why it is only
 *        reachable through `portalProcedure`. It is the one read in this file
 *        with no `organizationId` filter, and that is the thing to notice in
 *        review.
 *
 *        It returns the total alongside the page so the queue can show how far
 *        behind it is; a queue that cannot say "847 waiting" is one nobody
 *        treats as a queue.
 * WHERE: `portal.listModeration`.
 */
export async function listModerationRecords(
  db: DbClient,
  filters: {
    status?: ModerationVerdictStatus | undefined;
    subjectType?: ModerationSubjectType | undefined;
  },
  page: { skip: number; take: number },
): Promise<{ items: ModerationRecordRow[]; total: number }> {
  const where: Prisma.ModerationRecordWhereInput = {
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.subjectType !== undefined
      ? { subjectType: filters.subjectType }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.moderationRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page.skip,
      take: page.take,
      select: MODERATION_RECORD_SELECT,
    }),
    db.moderationRecord.count({ where }),
  ]);

  return { items, total };
}

/**
 * SOURCE OF TRUTH KEYWORDS: countModerationByStatus, FALSE_POSITIVE_RATE
 *
 * WHAT:  How many decisions of each verdict were made in a window.
 * WHY:   FALSE_POSITIVE_RATE is the number this enables, and it is why
 *        approvals are recorded at all (RECORD_EVERY_DECISION): a refusal
 *        count on its own cannot tell an operator whether the classifier got
 *        stricter or the traffic got worse. Grouped in the database rather than
 *        counted in the handler, because the table grows forever.
 * WHERE: The portal's safety panel.
 */
export async function countModerationByStatus(
  db: DbClient,
  since: Date,
): Promise<Record<string, number>> {
  const grouped = await db.moderationRecord.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  return Object.fromEntries(
    grouped.map((row) => [row.status, row._count._all]),
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: overrideModeration, MANUAL_ENGINE, APPEND_ONLY
 *
 * WHAT:  An operator's decision on a flagged item.
 * WHY:   Writes a NEW row with `engine: 'manual'` rather than editing the
 *        classifier's row — APPEND_ONLY, and here the history is the entire
 *        value: "the model flagged this and a named operator approved it" is
 *        the fact an appeal or an audit turns on, and an update would destroy
 *        exactly that.
 *
 *        The operator's identity goes in `reason` rather than a new column,
 *        because this table records DECISIONS and the platform's own audit log
 *        (`ActivityLog`, written by the portal procedure) already records who
 *        did what. A second actor column here would be a second answer to a
 *        question that has one.
 * WHERE: `portal.overrideModeration`.
 */
export async function overrideModeration(
  db: DbClient,
  args: {
    organizationId: string;
    subjectType: ModerationSubjectType;
    subjectId: string;
    status: ModerationVerdictStatus;
    note: string;
  },
): Promise<void> {
  await recordModeration(db, {
    organizationId: args.organizationId,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    status: args.status,
    categories: [],
    reason: args.note.slice(0, 1_000),
    engine: MANUAL_ENGINE,
  });
}
