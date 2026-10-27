/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildAvatarWindows, AvatarWindow, SpeakerSpan,
 *   AvatarStateSpan, COALESCE_SHORT_STATES, AVATAR_FLICKER_MS,
 *   WINDOWS_ARE_COMPUTED_NOT_DRAWN, ONE_OVERLAY_PER_SPEAKER_RUN,
 *   TALKING_IS_PER_LINE_NOT_PER_WORD, REACTION_IS_THE_ENTRANCE
 *
 * WHAT:  Turns a sequence of narration lines into the on-screen windows each
 *        speaker's avatar occupies, and the state timeline inside each one —
 *        with the flickers merged out.
 *
 * WHY:   WINDOWS_ARE_COMPUTED_NOT_DRAWN, which is the decision that makes this
 *        a module rather than a few lines inside the overlay component — and it
 *        is forced rather than chosen. A render component receives `item`,
 *        `assets`, `frames` and `canvas` and NOT the document
 *        (RENDER_COMPONENT_CONTRACT in src/lib/types/render.ts), so it cannot
 *        read `doc.words` and could not derive a talking state if it wanted to.
 *        Everything is therefore settled here, in the generator, and the
 *        component looks up the frame it is on.
 *
 *        That is also the right place for it: a frame must be a pure function
 *        of its number for Phase 04's render reuse to be correct, and Phase
 *        15's editor has to be able to show the same windows the render will
 *        use.
 *
 *        COALESCE_SHORT_STATES is the phase's step 7: "coalesce state changes
 *        shorter than a flicker threshold — a 120ms avatar flip looks like a
 *        glitch, not a performance". Narration is full of natural gaps: a
 *        comma, a breath, the join between two consecutive lines by the same
 *        speaker. Emitting one window per LINE would switch the active
 *        character on every one of them, and a character that strobes is worse
 *        than one that simply stays on screen.
 *
 *        The merging happens at TWO levels, and which level does what is the
 *        part worth understanding:
 *          1. A WINDOW breaks on the SPEAKER and only on the speaker. Three
 *             consecutive `op` lines are one person talking, not three — and a
 *             PAUSE does not break it either, because a character leaving the
 *             screen mid-thought and returning is a bigger switch than the
 *             flicker this rule was written to prevent.
 *          2. Inside a window, a gap shorter than AVATAR_FLICKER_MS is absorbed
 *             into the talking around it rather than becoming a sub-200ms
 *             `neutral` flash. This is where the threshold earns its keep.
 *        A window shorter than the threshold is DROPPED outright, because
 *        drawing it is the flicker itself.
 *
 *        TALKING_IS_PER_LINE_NOT_PER_WORD, and this is the one place the phase
 *        file's wording ("switches to `talking` on that speaker's word
 *        timings") is deliberately read at a coarser grain. Word timings are
 *        available — aligned words carry a speaker — and using them directly
 *        would switch the mouth shut on every comma, which is precisely the
 *        sub-200ms flip the same phase forbids two sentences later. A LINE is
 *        the measured unit of audio, so a line is a continuous stretch of
 *        talking and the gaps BETWEEN lines are the real pauses. Using lines
 *        satisfies both instructions instead of letting them contradict each
 *        other, and the gap-coalescing below applies to these spans too.
 *
 *        REACTION_IS_THE_ENTRANCE. The phase asks for `reaction` to "play on
 *        marked beats", and nothing in the document marks a beat — there is no
 *        producer for such a mark and inventing one would be a document
 *        concept with one consumer and no author. So the rule chosen is the one
 *        that needs no new concept and is what these videos actually look like:
 *        a character REACTS for a moment as it comes on screen, then speaks.
 *        It is deterministic, it uses the artwork the phase requires, and it is
 *        skipped entirely on a window too short to hold both states. If a beat
 *        marker ever exists, this is the function that consumes it.
 *
 *        ONE_OVERLAY_PER_SPEAKER_RUN: the output is one window per run, not one
 *        per line, which also keeps the document small — a sixty-line thread
 *        would otherwise carry sixty overlay items whose `z` all had to be
 *        distinct (the schema refuses two overlays sharing a depth while both
 *        are on screen).
 *
 *        PURE — no database, no clock, no Remotion. Every rule above is
 *        therefore unit-testable, which is the point: "switches on the line
 *        boundary without flicker" is a thing a test can assert and a human
 *        cannot reliably eyeball.
 * WHERE: src/lib/generators/reddit-story.ts.
 */

import { AVATAR_FLICKER_MS, type AvatarState } from "@/lib/types/avatar";

/**
 * SOURCE OF TRUTH KEYWORDS: SpeakerSpan
 *
 * WHAT:  One narration line's place on the timeline and who said it.
 * WHY:   The minimum this module needs, and deliberately not a
 *        `NarrationLineInput`: the merging is about time and identity only, so
 *        taking the richer type would make these rules untestable without
 *        constructing audio asset ids that have nothing to do with them.
 * WHERE: The input of buildAvatarWindows.
 */
export interface SpeakerSpan {
  speakerTag: string;
  start: number;
  duration: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AvatarStateSpan
 *
 * WHAT:  One stretch of one state, in seconds RELATIVE TO THE WINDOW.
 * WHY:   Relative, because the component is mounted inside its own
 *        `<Sequence>` and `useCurrentFrame()` returns a frame relative to the
 *        item (FRAMES_ARE_RELATIVE_INSIDE). Absolute times would make every
 *        component do the same subtraction, and the one that forgot would draw
 *        the right states at the wrong moments.
 * WHERE: `AvatarWindow.states`; the overlay's lookup.
 */
export interface AvatarStateSpan {
  state: AvatarState;
  start: number;
  duration: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AvatarWindow
 *
 * WHAT:  One continuous stretch during which a speaker is the one on screen,
 *        and what their face is doing throughout it.
 * WHERE: Returned by buildAvatarWindows; becomes one overlay item each.
 */
export interface AvatarWindow {
  speakerTag: string;
  start: number;
  duration: number;
  /** Ordered, non-overlapping, covering the whole window. */
  states: AvatarStateSpan[];
}

const FLICKER_SECONDS = AVATAR_FLICKER_MS / 1000;

/**
 * SOURCE OF TRUTH KEYWORDS: REACTION_SECONDS, REACTION_IS_THE_ENTRANCE
 *
 * How long a character reacts as it arrives. Short — it is a beat, not a pose —
 * and above the flicker threshold, because a reaction shorter than that is the
 * glitch rather than the performance. A window that cannot hold a reaction AND
 * a visible stretch of talking gets no reaction at all.
 */
const REACTION_SECONDS = 0.45;

/**
 * SOURCE OF TRUTH KEYWORDS: buildAvatarWindows, COALESCE_SHORT_STATES
 *
 * WHAT:  The windows, merged and cleaned, each with its state timeline.
 * WHY:   See the file header. The input is assumed to be in TIME ORDER, which
 *        it is: the generator lays narration lines end to end by accumulating
 *        measured durations (NARRATION_IS_SEQUENTIAL), so a sort here would be
 *        defending against a caller that cannot exist — and a sort that
 *        silently reordered a mis-built sequence would hide the bug rather than
 *        surfacing it.
 *
 *        Zero-length and negative spans are dropped rather than clamped: a line
 *        with no measured duration cannot be positioned at all, and the QA
 *        stage already refuses a run where that is widespread.
 * WHERE: The `reddit-story` generator's overlay track.
 */
export function buildAvatarWindows(
  spans: readonly SpeakerSpan[],
): AvatarWindow[] {
  /* Merged runs, each remembering the LINES inside it — the lines are what the
   * talking state is derived from (TALKING_IS_PER_LINE_NOT_PER_WORD). */
  const runs: { speakerTag: string; lines: SpeakerSpan[] }[] = [];

  for (const span of spans) {
    if (!Number.isFinite(span.start) || !Number.isFinite(span.duration)) continue;
    if (span.duration <= 0) continue;

    const current = runs[runs.length - 1];

    /**
     * THE RUN BREAKS ON THE SPEAKER AND ONLY ON THE SPEAKER.
     *
     * A gap deliberately does NOT break it, and that is worth being explicit
     * about, because the obvious reading of "coalesce short gaps" is to break
     * on long ones. Breaking on a pause would mean a character LEAVING THE
     * SCREEN while the same person is mid-thought and returning a second later
     * — a bigger and more jarring switch than the flicker the rule was written
     * to prevent. One person talking is one window; a pause inside it becomes a
     * `neutral` stretch in the state timeline below, which is the character
     * standing there not talking, exactly as it should be.
     *
     * The gap threshold still does real work, one level down in
     * `buildStateTimeline`: a gap too short to be a deliberate pause is
     * absorbed into the talking around it rather than becoming a 180ms neutral
     * flash. That is where COALESCE_SHORT_STATES actually applies.
     */
    if (current !== undefined && current.speakerTag === span.speakerTag) {
      current.lines.push(span);
      continue;
    }

    runs.push({ speakerTag: span.speakerTag, lines: [span] });
  }

  /**
   * SOURCE OF TRUTH KEYWORDS: DROP_THEN_REMERGE
   *
   * DROP_THEN_REMERGE, in that order, and the order is the whole point.
   *
   * A run shorter than the threshold is the flicker itself — a two-word
   * interjection between two long runs — and drawing it is the glitch. But
   * dropping it on its own would leave a HOLE: the surrounding speaker's
   * character would blink off for the length of the interjection and back on,
   * which is the same flicker wearing a different hat.
   *
   * So the short runs are removed and then the neighbours are re-merged, which
   * is what "dropping it leaves the previous character on screen" actually
   * requires. The two passes cannot be one: a single pass cannot know that the
   * run it is about to start will turn out to be too short to keep.
   */
  const kept = runs.filter((run) => runDuration(run.lines) >= FLICKER_SECONDS);

  const merged: typeof kept = [];
  for (const run of kept) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.speakerTag === run.speakerTag) {
      previous.lines.push(...run.lines);
      continue;
    }
    merged.push({ speakerTag: run.speakerTag, lines: [...run.lines] });
  }

  const windows: AvatarWindow[] = [];

  for (const run of merged) {
    const first = run.lines[0];
    if (first === undefined) continue;

    const start = first.start;
    const duration = runDuration(run.lines);

    windows.push({
      speakerTag: run.speakerTag,
      start,
      duration,
      states: buildStateTimeline(run.lines, start, duration),
    });
  }

  return windows;
}

/** First line's start to last line's end. Zero for an empty run. */
function runDuration(lines: readonly SpeakerSpan[]): number {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first === undefined || last === undefined) return 0;
  return last.start + last.duration - first.start;
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildStateTimeline, REACTION_IS_THE_ENTRANCE,
 *   TALKING_IS_PER_LINE_NOT_PER_WORD, NO_GAPS_NO_OVERLAPS
 *
 * WHAT:  What the face does across one window, in window-relative seconds.
 *
 * WHY:   NO_GAPS_NO_OVERLAPS is the property the component depends on: the
 *        spans are ordered, they do not overlap, and together they cover the
 *        whole window. That is what lets the component find its state with one
 *        scan and no fallback arithmetic — and the test asserts it, because a
 *        gap here is a frame where the character is drawn in no state at all.
 *
 *        The timeline is built in two passes and then cleaned:
 *          1. a `reaction` lead-in, if the window can spare it;
 *          2. `talking` for each line, `neutral` for the gaps between them.
 *        Spans shorter than the flicker threshold are then absorbed into their
 *        predecessor rather than emitted, which is the same rule the windows
 *        themselves follow — a 120ms neutral gap between two sentences is not a
 *        pause, it is a breath.
 * WHERE: buildAvatarWindows.
 */
function buildStateTimeline(
  lines: readonly SpeakerSpan[],
  windowStart: number,
  windowDuration: number,
): AvatarStateSpan[] {
  const raw: AvatarStateSpan[] = [];

  /* REACTION_IS_THE_ENTRANCE — only when there is room for it and for a
   * visible stretch of talking afterwards. */
  const hasRoomToReact = windowDuration >= REACTION_SECONDS + FLICKER_SECONDS;
  const talkingFrom = hasRoomToReact ? REACTION_SECONDS : 0;
  if (hasRoomToReact) {
    raw.push({ state: "reaction", start: 0, duration: REACTION_SECONDS });
  }

  let cursor = talkingFrom;

  for (const line of lines) {
    const lineStart = Math.max(cursor, line.start - windowStart);
    const lineEnd = line.start + line.duration - windowStart;
    if (lineEnd <= lineStart) continue;

    /* The gap before this line is a real pause between sentences. */
    if (lineStart > cursor) {
      raw.push({
        state: "neutral",
        start: cursor,
        duration: lineStart - cursor,
      });
    }

    raw.push({
      state: "talking",
      start: lineStart,
      duration: lineEnd - lineStart,
    });
    cursor = lineEnd;
  }

  /* Whatever is left at the end — the window is bounded by its last line, so
   * this is normally nothing, and is a rounding remainder when it is not. */
  if (cursor < windowDuration) {
    raw.push({
      state: "neutral",
      start: cursor,
      duration: windowDuration - cursor,
    });
  }

  return coalesce(raw, windowDuration);
}

/**
 * SOURCE OF TRUTH KEYWORDS: coalesce, COALESCE_SHORT_STATES, NO_GAPS_NO_OVERLAPS
 *
 * WHAT:  Merges away spans too short to read as deliberate, and guarantees the
 *        result covers the window exactly.
 * WHY:   A span below the flicker threshold is extended INTO rather than
 *        emitted — the previous state simply holds through it. Two adjacent
 *        spans of the same state are also joined, which happens as soon as a
 *        short one in between is absorbed.
 *
 *        The last span is stretched to the window's end so the coverage is
 *        exact. Floating-point accumulation over sixty lines would otherwise
 *        leave a few microseconds uncovered, and the component's final frame
 *        would find no state.
 * WHERE: buildStateTimeline.
 */
function coalesce(
  spans: readonly AvatarStateSpan[],
  windowDuration: number,
): AvatarStateSpan[] {
  const merged: AvatarStateSpan[] = [];

  for (const span of spans) {
    const previous = merged[merged.length - 1];

    if (previous === undefined) {
      /* The first span always survives, even if it is short — dropping it
       * would leave the window's opening frames uncovered. */
      merged.push({ ...span, start: 0 });
      continue;
    }

    if (span.state === previous.state || span.duration < FLICKER_SECONDS) {
      previous.duration = span.start + span.duration - previous.start;
      continue;
    }

    merged.push({ ...span });
  }

  const last = merged[merged.length - 1];
  if (last === undefined) {
    /* An empty timeline cannot happen through buildStateTimeline (a window
     * always has at least one line), but a window with no states would draw a
     * character in no state at all — so the resting frame is the answer. */
    return [{ state: "neutral", start: 0, duration: windowDuration }];
  }
  last.duration = windowDuration - last.start;

  return merged;
}
