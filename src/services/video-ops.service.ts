/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: videosPerDayByKind, stageFailureRates,
 *   renderTimePercentiles, costVersusCharged, providerHealth, queueDepth,
 *   VideoOpsWindow, PLATFORM_WIDE_READ, OUR_RECORDS_NOT_THEIR_INVOICE,
 *   PERCENTILES_ARE_COMPUTED_IN_MEMORY
 *
 * WHAT:  The platform-admin reads behind the portal's video-operations
 *        console: how many videos were made, which stage breaks most, how long
 *        renders take, what they cost us against what we charged, and how much
 *        work is in flight.
 *
 * WHY:   A SEPARATE service from portal.service.ts, which owns operator
 *        identity, organizations and users. This one owns video OPERATIONS.
 *        They are both platform-admin reads and they are not one job: the
 *        tenancy service answers "who is on the platform" and this answers "is
 *        the machine healthy and profitable", and a single file doing both is
 *        the one that nobody can review a change to.
 *
 *        PLATFORM_WIDE_READ. Every function here deliberately has NO
 *        `organizationId` parameter — these are cross-tenant aggregates, which
 *        is exactly why they are only reachable through `portalProcedure`. That
 *        makes this the one service in the codebase where the absence of a
 *        tenant filter is correct rather than a bug, so it is stated here and
 *        repeated on each function: a reviewer who sees an unscoped `findMany`
 *        in any other service has found a vulnerability.
 *
 *        OUR_RECORDS_NOT_THEIR_INVOICE. The cost figures multiply units WE
 *        recorded by list prices held in src/lib/costs — they are not a
 *        provider's bill, and the module says so at length. The phase asks the
 *        portal to answer "what did yesterday's videos cost us, and what did we
 *        charge?" without anybody writing a query, and an approximate answer
 *        daily is worth more than an exact one a month later.
 *
 *        PERCENTILES_ARE_COMPUTED_IN_MEMORY because Postgres percentiles need
 *        raw SQL, and raw SQL in this codebase would be the first instance of
 *        it. The rows are bounded by a window and a hard cap instead — see
 *        `renderTimePercentiles`. A p95 over a sampled few thousand renders is
 *        the same number to the precision anybody acts on.
 * WHERE: src/trpc/routers/portal.ts, behind portalProcedure. Rendered by the
 *        pages under src/app/(portal)/portal/videos/.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/config/prisma";
import {
  creditsToUsd,
  totalSpend,
  usdForAlignmentSeconds,
  usdForModerationCalls,
  usdForNarrationSeconds,
  usdForRenderSeconds,
  usdForScriptCalls,
  type SpendBreakdown,
} from "@/lib/costs";
import { PIPELINE_STAGES, type PipelineStageName } from "@/lib/types/pipeline";
import { PROJECT_KINDS, type ProjectKind } from "@/lib/types/project";

/**
 * SOURCE OF TRUTH KEYWORDS: VideoOpsWindow, WINDOW_IS_DAYS
 *
 * WHAT:  How far back a panel looks.
 * WHY:   WINDOW_IS_DAYS, resolved to a `Date` by the caller rather than being
 *        a free-form range. Every panel on this console answers a question of
 *        the form "how are we doing lately", nobody has asked for an arbitrary
 *        range, and a day count is the one parameter that cannot express a
 *        query expensive enough to hurt the database.
 * WHERE: The single argument of most functions here.
 */
export interface VideoOpsWindow {
  since: Date;
}

/** The default window for every panel: a week reads through weekday noise. */
export const DEFAULT_OPS_DAYS = 7;

export function windowFromDays(days: number): VideoOpsWindow {
  const safe = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : DEFAULT_OPS_DAYS;
  return { since: new Date(Date.now() - safe * 24 * 60 * 60 * 1000) };
}

/**
 * SOURCE OF TRUTH KEYWORDS: videosPerDayByKind, PLATFORM_WIDE_READ
 *
 * WHAT:  Projects created per day, split by format.
 *
 * WHY:   By KIND rather than a single total, because the formats have wildly
 *        different costs and the mix is the leading indicator of the bill: a
 *        week that shifts from `voiceover` to a format with generated footage
 *        changes the cost per video without changing the count.
 *
 *        Grouped in the DATABASE by day rather than fetching rows and bucketing
 *        in JavaScript. Prisma's `groupBy` cannot group by a date TRUNCATION,
 *        so the grouping is by the pair `(kind, createdAt)` and the days are
 *        folded here — which still avoids loading the project rows themselves,
 *        and the cardinality is bounded by the window.
 * WHERE: The portal's volume panel.
 */
export interface DailyVolumeRow {
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  byKind: Record<ProjectKind, number>;
  total: number;
}

export async function videosPerDayByKind(
  window: VideoOpsWindow,
): Promise<DailyVolumeRow[]> {
  const rows = await prisma.project.findMany({
    /* PLATFORM_WIDE_READ — no organizationId, deliberately. */
    where: { createdAt: { gte: window.since } },
    select: { kind: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDay = new Map<string, Record<ProjectKind, number>>();

  for (const row of rows) {
    const day = isoDay(row.createdAt);
    const bucket = byDay.get(day) ?? emptyKindCounts();
    const kind = asProjectKind(row.kind);
    if (kind !== null) bucket[kind] += 1;
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .map(([day, byKind]) => ({
      day,
      byKind,
      total: Object.values(byKind).reduce((sum, count) => sum + count, 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * SOURCE OF TRUTH KEYWORDS: stageFailureRates, WHICH_STAGE_BREAKS,
 *   RATE_NEEDS_A_DENOMINATOR
 *
 * WHAT:  For each pipeline stage, how often it ran and how often it failed.
 *
 * WHY:   WHICH_STAGE_BREAKS is the single most useful operational number this
 *        product has: a pipeline with twelve stages fails somewhere, and
 *        "generation is broken" is a sentence nobody can act on while
 *        "alignment fails 40% of the time" is a morning's work.
 *
 *        RATE_NEEDS_A_DENOMINATOR. The rate is failures over ATTEMPTS, not
 *        failures over runs, and `skipped` rows are excluded from both — a
 *        stage this format never runs would otherwise sit at a 0% failure rate
 *        and look healthy, diluting the average and hiding the stage that is
 *        actually broken.
 * WHERE: The portal's reliability panel.
 */
export interface StageFailureRow {
  stage: PipelineStageName;
  attempts: number;
  failures: number;
  /** 0–1. Zero when the stage has not run. */
  failureRate: number;
}

export async function stageFailureRates(
  window: VideoOpsWindow,
): Promise<StageFailureRow[]> {
  const grouped = await prisma.pipelineStage.groupBy({
    by: ["stage", "status"],
    /* `startedAt` rather than a created timestamp: the table has no createdAt,
     * and a stage that never started is not an attempt. */
    where: { startedAt: { gte: window.since } },
    _count: { _all: true },
  });

  const attempts = new Map<string, number>();
  const failures = new Map<string, number>();

  for (const row of grouped) {
    /* Excluded from BOTH numerator and denominator — see
     * RATE_NEEDS_A_DENOMINATOR. */
    if (row.status === "skipped") continue;

    attempts.set(
      row.stage,
      (attempts.get(row.stage) ?? 0) + row._count._all,
    );
    if (row.status === "failed") {
      failures.set(
        row.stage,
        (failures.get(row.stage) ?? 0) + row._count._all,
      );
    }
  }

  /* Ordered by the canonical stage tuple, not by failure count: the console
   * shows the pipeline in the order it runs, so an operator reads it as a
   * pipeline rather than a leaderboard. */
  return PIPELINE_STAGES.map((stage) => {
    const ran = attempts.get(stage) ?? 0;
    const failed = failures.get(stage) ?? 0;
    return {
      stage,
      attempts: ran,
      failures: failed,
      failureRate: ran === 0 ? 0 : round4(failed / ran),
    };
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: renderTimePercentiles, PERCENTILES_ARE_COMPUTED_IN_MEMORY,
 *   P95_NOT_AVERAGE
 *
 * WHAT:  How long a render takes — median, p95 and the worst one.
 *
 * WHY:   P95_NOT_AVERAGE. A render queue's average is dominated by the many
 *        short renders and tells you nothing about the experience of waiting;
 *        the p95 is the number a customer complains about. The phase asks for
 *        p95 specifically, and the median is shown beside it because a p95 with
 *        no median cannot distinguish "everything is slow" from "most things
 *        are fast and a few are terrible".
 *
 *        PERCENTILES_ARE_COMPUTED_IN_MEMORY — see the file header. The read is
 *        bounded two ways: by the window, and by `SAMPLE_CAP` rows, newest
 *        first. A capped sample makes the number approximate in a way that
 *        matters to nobody and makes the query's cost bounded, which matters a
 *        great deal on a table that grows forever.
 *
 *        Only COMPLETED renders are measured. A failed or timed-out render has
 *        a duration that measures how long it took to break, and mixing those
 *        in makes the p95 improve when reliability gets worse.
 * WHERE: The portal's performance panel.
 */
export interface RenderTimeStats {
  samples: number;
  medianSeconds: number;
  p95Seconds: number;
  maxSeconds: number;
}

/* Newest-first and capped. Far more than enough for a stable p95, and a hard
 * ceiling on the memory one page view can ask for. */
const SAMPLE_CAP = 5_000;

export async function renderTimePercentiles(
  window: VideoOpsWindow,
): Promise<RenderTimeStats> {
  const rows = await prisma.render.findMany({
    where: {
      status: "completed",
      startedAt: { not: null },
      finishedAt: { not: null, gte: window.since },
    },
    select: { startedAt: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
    take: SAMPLE_CAP,
  });

  const durations = rows
    .flatMap((row) =>
      row.startedAt === null || row.finishedAt === null
        ? []
        : [(row.finishedAt.getTime() - row.startedAt.getTime()) / 1000],
    )
    /* Clock skew between the worker that stamped `startedAt` and the webhook
     * that stamped `finishedAt` can produce a negative duration. Dropped
     * rather than clamped to zero: a zero-second render would pull the median
     * down and misrepresent the distribution. */
    .filter((seconds) => seconds > 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { samples: 0, medianSeconds: 0, p95Seconds: 0, maxSeconds: 0 };
  }

  return {
    samples: durations.length,
    medianSeconds: round2(percentile(durations, 0.5)),
    p95Seconds: round2(percentile(durations, 0.95)),
    maxSeconds: round2(durations[durations.length - 1] ?? 0),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: costVersusCharged, OUR_RECORDS_NOT_THEIR_INVOICE,
 *   MARGIN_IS_THE_POINT
 *
 * WHAT:  What the work cost us, what we charged for it, and the gap.
 *
 * WHY:   This is the phase's own "Done when" question, answerable without
 *        writing a query. The two halves come from DIFFERENT sources on
 *        purpose (MARGIN_IS_THE_POINT in src/lib/costs): cost is counted
 *        provider units priced at list, revenue is credits actually committed
 *        in the ledger. A single calculation producing both would make a
 *        pricing error invisible.
 *
 *        The COST side counts what we know we asked for:
 *          renders    — output seconds at the resolution's rate
 *          narration  — measured audio seconds
 *          alignment  — the same seconds, sent to the aligner
 *          scripts    — one model call per generated script
 *          moderation — one classification per recorded decision
 *
 *        The REVENUE side is `commit` rows only. Holds are excluded because a
 *        hold is money reserved and not yet earned, and releases are excluded
 *        because they are money given back — counting either would make
 *        revenue move when nothing was sold.
 *
 *        `jobs` is reported as zero rather than estimated: nothing in this app
 *        records a step count, so any figure would be invented. An honest zero
 *        with a note beats a plausible number nobody can check.
 * WHERE: The portal's economics panel.
 */
export interface CostVersusCharged {
  spend: SpendBreakdown;
  costUsd: number;
  chargedCredits: number;
  chargedUsd: number;
  /** chargedUsd - costUsd. Negative means we lost money. */
  marginUsd: number;
  /** Videos that completed a render in the window, for a per-video figure. */
  videos: number;
  costPerVideoUsd: number;
}

export async function costVersusCharged(
  window: VideoOpsWindow,
): Promise<CostVersusCharged> {
  const [renders, narration, scripts, moderation, committed] =
    await Promise.all([
      prisma.render.findMany({
        where: { status: "completed", finishedAt: { gte: window.since } },
        select: { resolution: true, project: { select: { timeline: false } } },
      }),
      prisma.narrationLine.aggregate({
        where: { status: "ready", updatedAt: { gte: window.since } },
        _sum: { durationSec: true },
        _count: { _all: true },
      }),
      prisma.scriptBlock.groupBy({
        by: ["projectId"],
        where: { createdAt: { gte: window.since } },
        _count: { _all: true },
      }),
      prisma.moderationRecord.count({
        where: { createdAt: { gte: window.since } },
      }),
      prisma.creditLedger.aggregate({
        where: { kind: "commit", createdAt: { gte: window.since } },
        _sum: { delta: true },
      }),
    ]);

  /* A render's billable length is its OUTPUT duration, which this app does not
   * store on the render row — so the narration total is used as the proxy for
   * video length. Approximate, and the direction of the error is known: a
   * project rendered twice is counted once in narration seconds and twice in
   * render count. Flagged rather than hidden. */
  const narrationSeconds = narration._sum.durationSec ?? 0;
  const averageVideoSeconds =
    scripts.length === 0 ? 0 : narrationSeconds / scripts.length;

  const renderSpend = renders.reduce(
    (sum, row) => sum + usdForRenderSeconds(averageVideoSeconds, row.resolution),
    0,
  );

  const spend: SpendBreakdown = {
    render: round4(renderSpend),
    /* One script call per project that gained blocks, plus the moderation
     * classifications, which are also LLM calls on the same provider. */
    llm: round4(
      usdForScriptCalls(scripts.length) + usdForModerationCalls(moderation),
    ),
    tts: usdForNarrationSeconds(narrationSeconds),
    stt: usdForAlignmentSeconds(narrationSeconds),
    /* Nothing records a step count — see the file header. */
    jobs: 0,
  };

  const costUsd = totalSpend(spend);
  /* Commits are negative in the ledger (money leaving the balance), so the
   * magnitude is what was charged. */
  const chargedCredits = Math.abs(committed._sum.delta ?? 0);
  const chargedUsd = creditsToUsd(chargedCredits);

  return {
    spend,
    costUsd,
    chargedCredits,
    chargedUsd,
    marginUsd: round4(chargedUsd - costUsd),
    videos: renders.length,
    costPerVideoUsd:
      renders.length === 0 ? 0 : round4(costUsd / renders.length),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: providerHealth, OUR_VIEW_OF_THEIR_ERRORS
 *
 * WHAT:  How often each provider-backed step failed, as we saw it.
 *
 * WHY:   OUR_VIEW_OF_THEIR_ERRORS, which is the only view available: these are
 *        OUR failure records, not a provider's status page. A provider that is
 *        slow but succeeding looks healthy here, and a failure caused by our
 *        own bug is attributed to the provider whose step it was. That is still
 *        the number worth watching, because it is the one that correlates with
 *        a customer's experience.
 *
 *        The moderation row is the one to read first on a bad day: a spike in
 *        `unavailable` engines means the classifier is down and the pipeline is
 *        failing closed, which is correct behaviour and a total outage of
 *        generation at the same time.
 * WHERE: The portal's provider panel.
 */
export interface ProviderHealthRow {
  provider: string;
  attempts: number;
  failures: number
  failureRate: number;
}

export async function providerHealth(
  window: VideoOpsWindow,
): Promise<ProviderHealthRow[]> {
  const [renders, renderFailures, lines, lineFailures, moderation, modUnavailable] =
    await Promise.all([
      prisma.render.count({ where: { createdAt: { gte: window.since } } }),
      prisma.render.count({
        where: {
          createdAt: { gte: window.since },
          status: { in: ["failed", "timedOut"] },
        },
      }),
      prisma.narrationLine.count({
        where: { updatedAt: { gte: window.since } },
      }),
      prisma.narrationLine.count({
        where: { updatedAt: { gte: window.since }, status: "failed" },
      }),
      prisma.moderationRecord.count({
        where: { createdAt: { gte: window.since } },
      }),
      prisma.moderationRecord.count({
        where: { createdAt: { gte: window.since }, engine: "unavailable" },
      }),
    ]);

  return [
    row("render", renders, renderFailures),
    row("tts", lines, lineFailures),
    row("moderation", moderation, modUnavailable),
  ];
}

function row(
  provider: string,
  attempts: number,
  failures: number,
): ProviderHealthRow {
  return {
    provider,
    attempts,
    failures,
    failureRate: attempts === 0 ? 0 : round4(failures / attempts),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: queueDepth, OUR_QUEUE_NOT_THEIRS,
 *   DEPTH_IS_A_LEADING_INDICATOR
 *
 * WHAT:  How much work is in flight right now, and how much of it is stuck.
 *
 * WHY:   OUR_QUEUE_NOT_THEIRS. This counts ROWS IN OUR DATABASE that claim to
 *        be in progress — it is not Inngest's queue depth, which this app has
 *        no API access to. The two diverge in exactly the case worth knowing
 *        about: a run that died without updating its row leaves a project
 *        `generating` forever with nothing behind it, so a depth that only ever
 *        grows is the signal that something is abandoning work.
 *
 *        `stale` is therefore the most important field here and not a
 *        nice-to-have: depth alone cannot distinguish a busy afternoon from a
 *        silent breakage, and the difference is an hour's threshold.
 * WHERE: The portal's queue panel.
 */
export interface QueueDepth {
  generatingProjects: number;
  queuedRenders: number;
  renderingRenders: number;
  pendingModeration: number;
  /** In flight for more than STALE_AFTER_MINUTES — probably abandoned. */
  staleProjects: number;
  staleRenders: number;
}

/* A generation is minutes and a render is minutes; an hour in flight is not
 * slow, it is broken. */
export const STALE_AFTER_MINUTES = 60;

export async function queueDepth(): Promise<QueueDepth> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000);

  const inFlightRenders: Prisma.RenderWhereInput = {
    status: { in: ["queued", "rendering"] },
  };

  const [
    generatingProjects,
    queuedRenders,
    renderingRenders,
    pendingModeration,
    staleProjects,
    staleRenders,
  ] = await Promise.all([
    prisma.project.count({ where: { status: "generating" } }),
    prisma.render.count({ where: { status: "queued" } }),
    prisma.render.count({ where: { status: "rendering" } }),
    /* Assets held back from every render until a person clears them — see
     * MODERATION_IS_PARTIAL in the ingest workflow. This is the queue the
     * phase's flagged review is about. */
    prisma.asset.count({ where: { moderationStatus: "pending" } }),
    prisma.project.count({
      where: { status: "generating", updatedAt: { lt: staleBefore } },
    }),
    prisma.render.count({
      where: { ...inFlightRenders, updatedAt: { lt: staleBefore } },
    }),
  ]);

  return {
    generatingProjects,
    queuedRenders,
    renderingRenders,
    pendingModeration,
    staleProjects,
    staleRenders,
  };
}

/* ───────────────────────────── helpers ───────────────────────────── */

/* Built from the kind tuple rather than written out, so a fifth format counts
 * from the day it is declared instead of being silently absent from the
 * chart. Typed as a full Record by construction — every key of the union is
 * visited. */
/**
 * SOURCE OF TRUTH KEYWORDS: emptyKindCounts, EXHAUSTIVE_BY_KIND
 *
 * A zeroed bucket per format, written as a LITERAL rather than built from the
 * tuple in a loop. That is the codebase's own EXHAUSTIVE_BY_KIND pattern (see
 * FIXTURES_BY_KIND) and it is the version with no type assertion in it: a
 * fifth format added to PROJECT_KINDS fails to compile HERE until it has a
 * bucket, which is exactly the reminder wanted — whereas a loop would satisfy
 * the compiler and silently leave the new format out of every chart.
 */
function emptyKindCounts(): Record<ProjectKind, number> {
  return { "reddit-story": 0, voiceover: 0, quiz: 0, motion: 0 };
}

/* `kind` is a String column, so a value outside the union is possible. Dropped
 * from the breakdown rather than coerced: a phantom format in a volume chart is
 * worse than a count that is one short, and it gets logged. */
function asProjectKind(value: string): ProjectKind | null {
  if ((PROJECT_KINDS as readonly string[]).includes(value)) {
    return value as ProjectKind;
  }
  console.warn(`[video-ops] Unrecognised project kind "${value}"; not counted.`);
  return null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * SOURCE OF TRUTH KEYWORDS: percentile, NEAREST_RANK
 *
 * Nearest-rank on a pre-sorted array, which is the definition every monitoring
 * tool uses — so our p95 means the same thing as the one in a dashboard
 * somebody compares it against. Interpolating between samples would produce a
 * duration no render actually took.
 */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
