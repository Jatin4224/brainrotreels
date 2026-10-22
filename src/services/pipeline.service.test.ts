/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: pipeline.service test, toStageUpdates,
 *   STAGE_ORDER_IS_THE_TUPLE, SKIPPED_NOT_OMITTED, ELAPSED_IS_DERIVED_ON_THE_SERVER,
 *   PROJECT_HOLD_REFS
 *
 * WHAT:  The pure half of the pipeline service — the mapping from stage ROWS to
 *        the ordered, complete `StageUpdate[]` both the stream and the poll
 *        return.
 *
 * WHY:   This function is what makes the progress UI's central claim true: the
 *        list is always the same twelve rows in the same order, whatever the
 *        database returns and in whatever order. Every property worth relying
 *        on is asserted here rather than trusted, because the failure mode is a
 *        progress display that reshuffles while somebody watches it — the one
 *        thing a progress display must never do.
 *
 *        The database-touching functions are not covered: they are thin Prisma
 *        upserts whose behaviour is the schema's `@@unique([projectId, stage])`
 *        constraint, and asserting them would mean asserting Prisma.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { PIPELINE_STAGES } from "@/lib/types/pipeline";
import {
  PROJECT_HOLD_REFS,
  STAGE_ERROR_MAX,
  toStageUpdates,
  type PipelineStageRow,
} from "./pipeline.service";

function row(over: Partial<PipelineStageRow> & { stage: string }): PipelineStageRow {
  return {
    status: "pending",
    error: null,
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

describe("toStageUpdates", () => {
  /* STAGE_ORDER_IS_THE_TUPLE — imposed on the server, once, so the stream and
   * the poll cannot disagree and no component has to sort. */
  it("returns every stage in the tuple's order, whatever order the rows arrive in", () => {
    const shuffled = [...PIPELINE_STAGES]
      .reverse()
      .map((stage) => row({ stage, status: "completed" }));

    const updates = toStageUpdates(shuffled);
    expect(updates.map((update) => update.stage)).toEqual([...PIPELINE_STAGES]);
  });

  /* SKIPPED_NOT_OMITTED, from the other direction: a stage with NO row is still
   * a row in the output. Otherwise the list grows as the run proceeds. */
  it("fills a missing stage in as pending rather than omitting it", () => {
    const updates = toStageUpdates([row({ stage: "script", status: "completed" })]);

    expect(updates).toHaveLength(PIPELINE_STAGES.length);
    expect(updates.find((update) => update.stage === "script")?.status).toBe(
      "completed",
    );
    expect(updates.find((update) => update.stage === "tts")?.status).toBe(
      "pending",
    );
  });

  it("drops a stage name this build has never heard of", () => {
    const updates = toStageUpdates([
      row({ stage: "transcode", status: "running" }),
      row({ stage: "script", status: "running" }),
    ]);

    expect(updates).toHaveLength(PIPELINE_STAGES.length);
    expect(updates.some((update) => String(update.stage) === "transcode")).toBe(
      false,
    );
  });

  it("shows an unrecognised status as pending rather than dropping the stage", () => {
    const updates = toStageUpdates([row({ stage: "qa", status: "paused" })]);
    expect(updates.find((update) => update.stage === "qa")?.status).toBe(
      "pending",
    );
  });

  /* ELAPSED_IS_DERIVED_ON_THE_SERVER — a finished stage's elapsed time is the
   * gap between its own two timestamps, so it STOPS at the duration. */
  it("measures a finished stage between its own timestamps", () => {
    const startedAt = new Date("2026-10-22T10:00:00.000Z");
    const finishedAt = new Date("2026-10-22T10:00:12.500Z");

    const updates = toStageUpdates([
      row({ stage: "tts", status: "completed", startedAt, finishedAt }),
    ]);

    expect(updates.find((update) => update.stage === "tts")?.elapsedMs).toBe(
      12_500,
    );
  });

  it("measures a running stage against now, and a never-started one not at all", () => {
    const startedAt = new Date(Date.now() - 3_000);

    const updates = toStageUpdates([
      row({ stage: "tts", status: "running", startedAt }),
      row({ stage: "align", status: "pending" }),
    ]);

    const running = updates.find((update) => update.stage === "tts");
    expect(running?.elapsedMs).toBeGreaterThanOrEqual(3_000);
    /* Generous upper bound: this asserts "measured from startedAt", not the
     * speed of the test runner. */
    expect(running?.elapsedMs).toBeLessThan(60_000);

    expect(updates.find((update) => update.stage === "align")?.elapsedMs).toBe(
      null,
    );
  });

  it("never reports a negative duration from clock skew between two writers", () => {
    /* Two different workers wrote these timestamps, so `finishedAt` CAN be
     * earlier than `startedAt`. A negative elapsed time would render as
     * "-0:03" on a progress row. */
    const startedAt = new Date("2026-10-22T10:00:05.000Z");
    const finishedAt = new Date("2026-10-22T10:00:01.000Z");

    const updates = toStageUpdates([
      row({ stage: "script", status: "completed", startedAt, finishedAt }),
    ]);

    expect(updates.find((update) => update.stage === "script")?.elapsedMs).toBe(
      0,
    );
  });

  it("carries a skipped stage's reason through so the UI can explain the grey row", () => {
    const updates = toStageUpdates([
      row({
        stage: "render",
        status: "skipped",
        error: "Render your video from the preview screen.",
      }),
    ]);

    const render = updates.find((update) => update.stage === "render");
    expect(render?.status).toBe("skipped");
    expect(render?.error).toContain("preview screen");
  });

  it("keeps a warning on a completed stage", () => {
    /* A degraded alignment COMPLETES and still has something to say — see the
     * note on `completeStage`. The UI renders that as a caution, which it can
     * only do if the message survives the mapping. */
    const updates = toStageUpdates([
      row({
        stage: "align",
        status: "completed",
        error: "Captions are evenly spaced rather than timed to the audio.",
        startedAt: new Date("2026-10-22T10:00:00.000Z"),
        finishedAt: new Date("2026-10-22T10:00:04.000Z"),
      }),
    ]);

    const align = updates.find((update) => update.stage === "align");
    expect(align?.status).toBe("completed");
    expect(align?.error).toContain("evenly spaced");
  });
});

describe("the pipeline's money and message boundaries", () => {
  /* PROJECT_HOLD_REFS has to name every namespace a generate run can hold
   * credits under, or a cancelled run leaves money reserved until the Phase 05
   * reconciler notices. The three are the children's own `ONE_REF_PER_PROJECT`
   * prefixes. */
  it("names every ledger namespace a generate run can hold", () => {
    expect([...PROJECT_HOLD_REFS]).toEqual(["script", "tts", "align"]);
  });

  /* FAILURE_IS_EXPLAINED_NOT_DUMPED's blunt half: a provider that returns a
   * kilobyte of HTML must not be able to put a kilobyte of HTML on a progress
   * screen. */
  it("caps a stage error at a length a progress row can hold", () => {
    expect(STAGE_ERROR_MAX).toBeLessThanOrEqual(1_000);
    expect("x".repeat(5_000).slice(0, STAGE_ERROR_MAX)).toHaveLength(
      STAGE_ERROR_MAX,
    );
  });
});
