/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: avatar window tests, COALESCE_SHORT_STATES,
 *   NO_GAPS_NO_OVERLAPS, ONE_OVERLAY_PER_SPEAKER_RUN,
 *   TALKING_IS_PER_LINE_NOT_PER_WORD, REACTION_IS_THE_ENTRANCE
 *
 * WHAT:  Tests for the avatar window maths — which speaker is on screen when,
 *        and what their face is doing.
 *
 * WHY:   This is the phase's "the correct avatar is visible for each line and
 *        switches on the line boundary WITHOUT FLICKER", and it is a check a
 *        test can make and a human cannot. Flicker is a 120-millisecond state
 *        change: it is invisible frame by frame, obvious as a glitch at speed,
 *        and nobody can reliably eyeball whether a particular narration
 *        produced one.
 *
 *        NO_GAPS_NO_OVERLAPS is asserted as a PROPERTY over every window
 *        rather than case by case, because it is what the overlay component
 *        depends on: it finds its state with one scan and no fallback
 *        arithmetic, so a gap here is a frame where a character is drawn in no
 *        state at all.
 * WHERE: Run by `npm test`. Guards src/lib/generators/avatar-windows.ts.
 */

import { describe, expect, it } from "vitest";

import { AVATAR_FLICKER_MS } from "@/lib/types/avatar";
import { buildAvatarWindows, type SpeakerSpan } from "./avatar-windows";

const FLICKER = AVATAR_FLICKER_MS / 1000;

function line(speakerTag: string, start: number, duration: number): SpeakerSpan {
  return { speakerTag, start, duration };
}

/**
 * NO_GAPS_NO_OVERLAPS — the property the overlay component relies on. Asserted
 * for every window produced by every test below rather than once, because the
 * failure it catches (a frame with no state) is invisible in any single case.
 */
function expectCoversExactly(windows: ReturnType<typeof buildAvatarWindows>) {
  for (const window of windows) {
    expect(window.states.length).toBeGreaterThan(0);

    let cursor = 0;
    for (const span of window.states) {
      expect(span.start).toBeCloseTo(cursor, 6);
      expect(span.duration).toBeGreaterThan(0);
      cursor = span.start + span.duration;
    }
    expect(cursor).toBeCloseTo(window.duration, 6);
  }
}

describe("buildAvatarWindows", () => {
  it("gives each speaker a window covering their own lines", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 3),
      line("commenter", 3, 2),
    ]);

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ speakerTag: "op", start: 0, duration: 3 });
    expect(windows[1]).toMatchObject({
      speakerTag: "commenter",
      start: 3,
      duration: 2,
    });
    expectCoversExactly(windows);
  });

  /* ONE_OVERLAY_PER_SPEAKER_RUN. Three consecutive lines by one person are one
   * person talking — not three overlay items whose `z` would all have to be
   * distinct. */
  it("merges consecutive lines by the same speaker into one window", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 2),
      line("op", 2, 2),
      line("op", 4, 2),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ start: 0, duration: 6 });
    expectCoversExactly(windows);
  });

  /**
   * COALESCE_SHORT_STATES, the headline case. A gap shorter than the flicker
   * threshold is a breath, not a pause — switching the character off for it is
   * the glitch the rule exists to prevent.
   */
  it("absorbs a gap too short to be a deliberate pause", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 2),
      line("op", 2 + FLICKER / 2, 2),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]?.duration).toBeCloseTo(2 + FLICKER / 2 + 2, 6);
    /* And the gap is covered by TALKING rather than a sliver of neutral — it
     * was absorbed, not merely spanned. */
    expect(windows[0]?.states.filter((s) => s.state === "neutral")).toHaveLength(
      0,
    );
    expectCoversExactly(windows);
  });

  it("keeps a real pause as a neutral stretch", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 2),
      /* A full second of silence is somebody thinking, not a breath. */
      line("op", 3, 2),
    ]);

    expect(windows).toHaveLength(1);
    const neutral = windows[0]?.states.filter((s) => s.state === "neutral");
    expect(neutral).toHaveLength(1);
    expect(neutral?.[0]?.duration).toBeCloseTo(1, 6);
    expectCoversExactly(windows);
  });

  /**
   * DROP_THEN_REMERGE. A two-word interjection between two long runs IS the
   * flicker, so it is dropped — and the neighbours are then RE-MERGED, because
   * dropping it on its own would leave a hole where the surrounding
   * character blinked off and back on. One window, not two with a gap: that is
   * what 'leaves the previous character on screen' has to mean.
   */
  it("drops a window too short to read as deliberate, and closes the hole", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 3),
      line("commenter", 3, FLICKER / 2),
      line("op", 3 + FLICKER / 2, 3),
    ]);

    expect(windows.map((w) => w.speakerTag)).toEqual(["op"]);
    expect(windows[0]?.start).toBe(0);
    expect(windows[0]?.duration).toBeCloseTo(6 + FLICKER / 2, 6);
    expectCoversExactly(windows);
  });

  it("switches exactly on the line boundary", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 2.5),
      line("commenter", 2.5, 1.5),
    ]);

    const first = windows[0];
    const second = windows[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    /* No overlap and no gap between the two characters: one leaves as the
     * other arrives. */
    expect(first.start + first.duration).toBeCloseTo(second.start, 6);
  });

  it("ignores lines with no measurable duration", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 0),
      line("op", 0, -1),
      line("op", 0, Number.NaN),
      line("op", 0, 3),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]?.duration).toBe(3);
    expectCoversExactly(windows);
  });

  it("returns nothing for no lines", () => {
    expect(buildAvatarWindows([])).toEqual([]);
  });
});

describe("the state timeline", () => {
  /* REACTION_IS_THE_ENTRANCE — the rule chosen in the absence of a beat
   * marker: a character reacts as it arrives, then speaks. */
  it("opens on a reaction, then talks", () => {
    const windows = buildAvatarWindows([line("op", 0, 4)]);
    const states = windows[0]?.states ?? [];

    expect(states[0]?.state).toBe("reaction");
    expect(states[0]?.start).toBe(0);
    expect(states[1]?.state).toBe("talking");
    expectCoversExactly(windows);
  });

  /* A window that cannot hold a reaction AND a visible stretch of talking gets
   * no reaction: a reaction that is the whole window is a character that
   * appears, pulls a face and vanishes. */
  it("skips the reaction on a window with no room for it", () => {
    const windows = buildAvatarWindows([line("op", 0, FLICKER * 1.2)]);
    const states = windows[0]?.states ?? [];

    expect(states.every((span) => span.state !== "reaction")).toBe(true);
    expectCoversExactly(windows);
  });

  /**
   * TALKING_IS_PER_LINE_NOT_PER_WORD. The gaps that survive are the ones
   * between LINES, and every state span is at least the flicker threshold long
   * — which is the whole claim this module makes.
   */
  it("never emits a state span shorter than the flicker threshold", () => {
    const windows = buildAvatarWindows([
      line("op", 0, 2),
      line("op", 2 + FLICKER / 3, 2),
      line("op", 4 + FLICKER / 3, 0.05),
      line("op", 5, 2),
      line("commenter", 7.02, 3),
    ]);

    for (const window of windows) {
      for (const span of window.states) {
        expect(
          span.duration,
          `${span.state} at ${span.start} is ${span.duration}s`,
        ).toBeGreaterThanOrEqual(FLICKER - 1e-9);
      }
    }
    expectCoversExactly(windows);
  });

  it("covers the whole window even over many lines", () => {
    const spans: SpeakerSpan[] = [];
    let at = 0;
    for (let i = 0; i < 40; i += 1) {
      spans.push(line(i % 3 === 0 ? "commenter" : "op", at, 1.37));
      at += 1.37 + 0.21;
    }

    const windows = buildAvatarWindows(spans);
    expect(windows.length).toBeGreaterThan(1);
    /* The accumulation over forty lines is where a floating-point remainder
     * would leave the last frames of a window uncovered. */
    expectCoversExactly(windows);
  });
});
