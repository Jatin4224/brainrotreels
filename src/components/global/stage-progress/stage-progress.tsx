/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: StageProgress, StageProgressProps, StageRow,
 *   ANNOUNCE_TRANSITIONS, STATUS_IS_NOT_ONLY_COLOUR, ELAPSED_TICKS_LOCALLY,
 *   SLOTS_NOT_BRANCHES, STAGE_LABELS_FROM_THE_REGISTRY,
 *   THE_PIPELINE_IS_THE_SCREEN, PROGRESS_FLOWS_DOWNWARD, list-enter,
 *   stage-connector-fill
 *
 * WHAT:  A vertical list of pipeline stages — each with its status, its icon
 *        and how long it has taken — plus an aria-live region that announces
 *        every transition.
 *
 * WHY:   ANNOUNCE_TRANSITIONS is the phase's step 8 and the reason the live
 *        region exists: a progress display that communicates only by colour and
 *        motion is unusable for part of the audience, and a generation runs for
 *        minutes with nothing else to tell you where it is. The region is
 *        `polite` so it waits for a gap rather than interrupting, holds ONE
 *        sentence at a time (a screen reader reading twelve rows on every
 *        change is worse than silence), and sits outside the list so moving
 *        through the rows does not re-announce them.
 *
 *        STATUS_IS_NOT_ONLY_COLOUR, the same rule applied visually: every row
 *        carries a glyph and a word as well as a tint, so the state survives
 *        greyscale, colour blindness and a bright phone screen outdoors.
 *
 *        ELAPSED_TICKS_LOCALLY. The server sends `elapsedMs` at the instant it
 *        read the row (ELAPSED_IS_DERIVED_ON_THE_SERVER), and a RUNNING stage's
 *        timer then advances in the browser by counting SECONDS SINCE that
 *        reading arrived. Asking the server for a new number every second would
 *        be a request per second per watcher to animate a stopwatch — and
 *        deriving the display from the browser's own clock against the server's
 *        `startedAt` would put clock skew back into the number that
 *        ELAPSED_IS_DERIVED_ON_THE_SERVER exists to keep out. Counting local
 *        ticks on top of the server's figure has neither problem.
 *
 *        SLOTS_NOT_BRANCHES. This component knows nothing about projects,
 *        renders or pipelines: it takes `StageUpdate[]` and renders it, and
 *        everything situational — the buttons, the warning banner, the
 *        thumbnail strip — arrives as a slot. That is what makes it reusable
 *        for the render pipeline and for anything else with ordered steps,
 *        rather than a generate screen with a list inside it.
 *
 *        STAGE_LABELS_FROM_THE_REGISTRY: the human names come from
 *        PIPELINE_STAGE_LABELS, so this file contains no copy about what a
 *        stage does and a renamed stage is one edit in one place.
 *
 *        THE_PIPELINE_IS_THE_SCREEN and PROGRESS_FLOWS_DOWNWARD. A generation
 *        runs for MINUTES and this list is the whole answer to "where is it",
 *        and every transition used to land as an instant repaint — ring, glyph
 *        and word changing in one frame, with a static grey rule between rows
 *        that said nothing about having been crossed. Now the status colours
 *        ease over 200ms and the connector FILLS downward as a stage
 *        finishes, so progress has a visible direction instead of asking the
 *        reader to diff two frames. `transform` and colour only, which is
 *        what keeps it on the compositor while this screen holds a
 *        subscription open and polls beside it. The timings, the row stagger
 *        and the reduced-motion fallbacks live with the CSS in globals.css.
 * WHERE: /dashboard/projects/[id]/generate renders it. Available to any screen
 *        watching an ordered pipeline.
 */

import * as React from "react";
import { Check, CircleDashed, Loader2, MinusCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  PIPELINE_STAGE_LABELS,
  type PipelineStageStatus,
  type StageUpdate,
} from "@/lib/types/pipeline";

export interface StageProgressProps {
  stages: readonly StageUpdate[];
  /** Controls, a cancel button, a retry — whatever this surface needs. */
  actions?: React.ReactNode;
  /** A banner above the list: a failure explanation, a degrade warning. */
  banner?: React.ReactNode;
  /** The thumbnail strip, or anything else that belongs under the list. */
  footer?: React.ReactNode;
  className?: string;
}

export function StageProgress({
  stages,
  actions,
  banner,
  footer,
  className,
}: StageProgressProps) {
  const announcement = useStageAnnouncement(stages);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {banner}

      {/* ANNOUNCE_TRANSITIONS. Visually hidden rather than absent: the
          announcement duplicates what the list already shows, so showing it
          twice would be clutter — but it has to be in the accessibility tree
          to be read at all. `aria-atomic` makes the reader say the whole new
          sentence rather than only the words that changed. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {/* THE_PIPELINE_IS_THE_SCREEN — `.list-enter` steps the rows 35ms
          apart on mount so the pipeline lays itself out top to bottom, in the
          order it is about to run in. Mount only: the rows are keyed by stage,
          so a stream update re-renders them without re-animating. It is the
          app's shared many-small-items schedule (ONE_SCHEDULE_PER_SHAPE), so
          the cap and the reduced-motion fallback live with the CSS in
          globals.css. */}
      <ol className="list-enter flex flex-col">
        {stages.map((stage, index) => (
          <StageRow
            key={stage.stage}
            stage={stage}
            isLast={index === stages.length - 1}
          />
        ))}
      </ol>

      {actions}
      {footer}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: StageRow, STATUS_IS_NOT_ONLY_COLOUR
 *
 * One stage. The connector line between rows is drawn by the row ABOVE and
 * omitted on the last one, so the list has no trailing stub under the final
 * stage — which otherwise reads as a step nobody has labelled.
 */
function StageRow({
  stage,
  isLast,
}: {
  stage: StageUpdate;
  isLast: boolean;
}) {
  const label = PIPELINE_STAGE_LABELS[stage.stage];
  const look = STATUS_LOOK[stage.status];

  /* PROGRESS_FLOWS_DOWNWARD — whether this row's connector is full, i.e.
   * whether the pipeline got PAST this stage. `completed` and `skipped`
   * both let the run continue, so both fill. `failed` deliberately does NOT:
   * nothing flowed onward, and a filled line under a failed stage would say
   * the opposite of the red ring above it. */
  const flowed = stage.status === "completed" || stage.status === "skipped";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        {/* A stage transition used to be an instant repaint — ring, glyph and
            word all changing in one frame on the one surface in the product
            whose entire job is state indication. The properties are named
            rather than `transition-colors`, which would quietly cover `fill`
            and `stroke` and miss nothing that matters here; 200ms sits inside
            the UI budget and on the app's own `--ease-settle`. */}
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border transition-[color,background-color,border-color] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none",
            look.ring,
          )}
          /* The glyph is decoration: the row's accessible content is its text,
           * and the status word below says the same thing in words. */
          aria-hidden
        >
          <look.Icon
            className={cn(
              "size-3.5 transition-colors duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none",
              look.icon,
              look.spin && "animate-spin",
            )}
          />
        </span>
        {isLast ? null : (
          /* PROGRESS_FLOWS_DOWNWARD. The track holds the unfilled grey and the
              span inside it scales from its top edge, so finishing a stage
              sends a brand line DOWN into the next one — `transform` only, no
              colour to interpolate and no layout to recompute while this page
              is holding a subscription open and polling beside it.
              `overflow-hidden` is load-bearing: without it the collapsed
              `scaleY(0)` fill still paints its 1px seam at the top. */
          <span
            aria-hidden
            className="relative my-1 w-px flex-1 overflow-hidden bg-border"
          >
            <span
              data-filled={flowed}
              className="stage-connector-fill absolute inset-0 bg-primary"
            />
          </span>
        )}
      </div>

      <div className={cn("flex-1 pb-5", isLast && "pb-0")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {/* The label brightens as its stage wakes up, and it is the same
              200ms as the ring beside it on purpose: one state change must not
              arrive in two instalments. */}
          <p
            className={cn(
              "text-sm font-medium transition-colors duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none",
              stage.status === "pending" || stage.status === "skipped"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {label.label}
          </p>
          {/* STATUS_IS_NOT_ONLY_COLOUR — the state in words, always. The WORD
              swaps instantly and should: it is content, and crossfading a
              one-word status is how you make a reader wait to find out. Only
              its colour eases. */}
          <p
            className={cn(
              "text-xs transition-colors duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none",
              look.text,
            )}
          >
            {look.word}
          </p>
          {stage.elapsedMs === null ? null : (
            /* Keyed on the server's reading, which is what RESETS the local
             * tick count: a remount starts it at zero, so the two can never
             * compound. A running stage's reading only changes when something
             * real happens, because the stream's change detection excludes
             * `elapsedMs` (SNAPSHOT_NOT_DELTA) — so this is a stable key and
             * not one that remounts every poll. */
            <StageElapsed
              key={stage.elapsedMs}
              elapsedMs={stage.elapsedMs}
              running={stage.status === "running"}
            />
          )}
        </div>

        {/* A pending or running stage explains what it is for; a finished one
            shows whatever it had to say instead — a skip reason, a warning, a
            failure. The hint would be noise next to either. */}
        <p
          className={cn(
            "text-xs",
            stage.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {stage.error ?? label.hint}
        </p>
      </div>
    </li>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: STATUS_LOOK, STATUS_IS_NOT_ONLY_COLOUR,
 *   NO_HARDCODED_COLOURS
 *
 * WHAT:  The glyph, the word and the tokens for each status.
 * WHY:   A full Record over the status union, so adding a status is a compile
 *        error here rather than a row that renders with no icon. Every colour
 *        is a THEME TOKEN — this is app chrome, not video, so the literal
 *        colours allowed in src/lib/palettes and the caption library are
 *        forbidden here.
 *
 *        A completed stage carrying an `error` is a WARNING rather than a
 *        success, and the row picks that up from the message's presence — see
 *        the note on `completeStage`. It is not a sixth status: the stage
 *        genuinely completed, and making it one would mean every consumer of
 *        the status union had to learn a state that is really a nuance.
 * WHERE: StageRow.
 */
const STATUS_LOOK: Readonly<
  Record<
    PipelineStageStatus,
    {
      Icon: React.ComponentType<{ className?: string }>;
      word: string;
      ring: string;
      icon: string;
      text: string;
      spin?: boolean;
    }
  >
> = {
  pending: {
    Icon: CircleDashed,
    word: "Waiting",
    ring: "border-border bg-muted/40",
    icon: "text-muted-foreground",
    text: "text-muted-foreground",
  },
  running: {
    Icon: Loader2,
    word: "Working",
    ring: "border-primary bg-primary/10",
    icon: "text-primary",
    text: "text-primary",
    spin: true,
  },
  completed: {
    Icon: Check,
    word: "Done",
    ring: "border-primary bg-primary/10",
    icon: "text-primary",
    text: "text-muted-foreground",
  },
  failed: {
    Icon: X,
    word: "Failed",
    ring: "border-destructive bg-destructive/10",
    icon: "text-destructive",
    text: "text-destructive",
  },
  skipped: {
    Icon: MinusCircle,
    word: "Skipped",
    ring: "border-border bg-muted/40",
    icon: "text-muted-foreground",
    text: "text-muted-foreground",
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: useStageAnnouncement, ANNOUNCE_TRANSITIONS,
 *   ONE_SENTENCE_AT_A_TIME
 *
 * WHAT:  The sentence the live region holds.
 *
 * WHY:   ONE_SENTENCE_AT_A_TIME. It describes the most recent TRANSITION, not
 *        the whole list — a region that re-read twelve rows on every change
 *        would talk over itself for the length of the run. The precedence is
 *        the order a listener cares about: a failure first, then whatever is
 *        working now, then the finish.
 *
 *        Derived from the stages with `useMemo` rather than pushed into state
 *        from an effect, so there is no setState-in-effect cascade and no way
 *        for the announcement to disagree with the rows next to it.
 * WHERE: StageProgress.
 */
function useStageAnnouncement(stages: readonly StageUpdate[]): string {
  return React.useMemo(() => {
    const failed = stages.find((stage) => stage.status === "failed");
    if (failed !== undefined) {
      return `${PIPELINE_STAGE_LABELS[failed.stage].label} failed. ${failed.error ?? ""}`.trim();
    }

    const running = stages.find((stage) => stage.status === "running");
    if (running !== undefined) {
      const done = stages.filter((stage) => stage.status === "completed").length;
      return `${PIPELINE_STAGE_LABELS[running.stage].label}. Step ${done + 1} of ${stages.length}.`;
    }

    const anyStarted = stages.some((stage) => stage.status !== "pending");
    if (!anyStarted) return "Waiting to start.";

    const unfinished = stages.some(
      (stage) => stage.status === "pending",
    );
    return unfinished ? "Waiting for the next step." : "Your video is ready.";
  }, [stages]);
}

/**
 * SOURCE OF TRUTH KEYWORDS: StageElapsed, ELAPSED_TICKS_LOCALLY,
 *   RENDER_STAYS_PURE, RESET_BY_KEY
 *
 * WHAT:  One stage's elapsed time, advancing by the second while it runs.
 *
 * WHY:   ELAPSED_TICKS_LOCALLY — see the file header. What is displayed is the
 *        server's figure plus one second per local tick since it arrived.
 *
 *        RENDER_STAYS_PURE is why it is COUNTED rather than computed from
 *        `Date.now()`. This codebase enforces React's purity rules with eslint
 *        (the same rules DETERMINISM leans on in src/remotion), and a clock or
 *        a ref read during render breaks them: the render would produce a
 *        different answer each time React happened to call it, which is the
 *        instability the rule exists to prevent.
 *
 *        RESET_BY_KEY is why this is a COMPONENT rather than a hook on the row.
 *        A new reading has to reset the local count, and the obvious way to do
 *        that — `setTicks(0)` at the top of the effect — is a setState in an
 *        effect body, which this codebase also forbids and for good reason: it
 *        is a second render pass on every update. Keying the component on the
 *        reading makes React do the reset by remounting, which needs no state
 *        synchronisation at all.
 *
 *        The interval exists only while the stage is running, so a finished
 *        list holds no timers and a twelve-row list has at most one. A finished
 *        stage renders the server's final figure untouched, which is what makes
 *        the time STOP at the duration rather than running on for as long as
 *        the page is open.
 * WHERE: StageRow, keyed on `stage.elapsedMs`.
 */
function StageElapsed({
  elapsedMs,
  running,
}: {
  elapsedMs: number;
  running: boolean;
}) {
  const [ticks, setTicks] = React.useState(0);

  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTicks((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {formatElapsed(running ? elapsedMs + ticks * 1000 : elapsedMs)}
    </p>
  );
}

/* "1:04", not "64s" — a generation runs for minutes, and a bare second count
 * stops being readable about ninety seconds in. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
