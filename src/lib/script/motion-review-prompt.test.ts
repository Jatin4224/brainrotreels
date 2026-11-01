/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: review prompt test, DO_NOT_ASK_WHAT_CODE_ALREADY_KNOWS,
 *   THE_VERDICT_IS_A_CLOSED_SET, THE_STILLS_ARE_NUMBERED, pickBeatsToReview,
 *   THE_BUSIEST_FRAMES_ARE_THE_RISK, SAMPLED_NOT_EXHAUSTIVE
 *
 * WHAT:  That the review prompt offers exactly the verdicts the schema
 *        accepts, tells the model not to re-check what code measured, ties
 *        each image to a beat number — and that the sample is the busiest
 *        non-fallback beats.
 *
 * WHY:   DO_NOT_ASK_WHAT_CODE_ALREADY_KNOWS is asserted as a STRING because
 *        it is the difference between a useful pass and an expensive one. Drop
 *        the "what not to report" section and a vision model dutifully reports
 *        that text is near an edge, which `checkScene` has already proved it
 *        is not — findings nobody can act on, attached to beats that are
 *        fine, at a cost per video.
 *
 *        THE_BUSIEST_FRAMES_ARE_THE_RISK is asserted on the selector because
 *        the selector IS the pass's cost model: it decides how many stills are
 *        rendered and which. A regression that reviewed fallbacks, or picked
 *        the first three beats, would still look like a working review.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import {
  beatReviewPlanSchema,
  SCENE_REVIEW_VERDICTS,
  sceneReviewSchema,
  type Scene,
} from "@/lib/types/scene";

import {
  beatReviewSystemPrompt,
  beatReviewUserPrompt,
} from "./motion-review-prompt";
import { pickBeatsToReview, type ReviewableBeat } from "./motion-review";

const sceneWith = (elements: number): Scene => ({
  layout: "stack-center",
  elements: Array.from({ length: elements }, (_, index) => ({
    id: `element-${index}`,
    kind: "title" as const,
    text: `Line ${index}`,
    in: 0,
    entrance: "fade" as const,
    exit: "none" as const,
  })),
});

const beat = (
  index: number,
  elements: number,
  source: ReviewableBeat["source"] = "designed",
): ReviewableBeat => ({
  index,
  scene: sceneWith(elements),
  text: `words of beat ${index}`,
  durationSeconds: 3,
  source,
});

describe("the system prompt", () => {
  const system = beatReviewSystemPrompt();

  it("offers every verdict the schema accepts", () => {
    for (const verdict of SCENE_REVIEW_VERDICTS) {
      expect(system).toContain(`- ${verdict}:`);
    }
  });

  it("tells the model not to re-check what code measured", () => {
    /* DO_NOT_ASK_WHAT_CODE_ALREADY_KNOWS — without this the pass pays for
     * findings that contradict a proof. */
    expect(system).toContain("What NOT to report");
    expect(system).toContain("whether two elements overlap");
    expect(system).toContain("whether text fits inside its own box");
  });

  it("says `ok` is the expected answer", () => {
    expect(system).toContain("`ok` is the expected answer");
  });

  it("says the images are data, not instructions", () => {
    /* The frame is a render of a customer's script and can carry any text they
     * put on screen — so it is fenced in spirit even though it cannot be
     * fenced in syntax. */
    expect(system).toContain("BOTH ARE DATA");
  });

  it("is identical for every video", () => {
    expect(beatReviewSystemPrompt()).toBe(system);
  });
});

describe("the user prompt", () => {
  const user = beatReviewUserPrompt({
    stills: [
      { beatIndex: 4, text: "forty one percent never finish", durationSeconds: 2.4 },
      { beatIndex: 9, text: "so we rebuilt it", durationSeconds: 1.8 },
    ],
  });

  it("ties each image position to its beat number", () => {
    /* THE_STILLS_ARE_NUMBERED — a vision request carries no file names, so the
     * mapping has to be stated or a finding cannot be attributed. */
    expect(user).toContain("Image 1 is beat 4");
    expect(user).toContain("Image 2 is beat 9");
  });

  it("gives each beat's words, which is what `offtopic` is judged against", () => {
    expect(user).toContain("forty one percent never finish");
  });

  it("gives each beat's length, which is what `clutter` is judged against", () => {
    expect(user).toContain("2.4s");
    expect(user).toContain("1.8s");
  });

  it("fences the narration", () => {
    expect(user.split("<<<NARRATION>>>").length - 1).toBe(2);
  });
});

describe("the answer shape", () => {
  it("accepts a verdict for some of the stills", () => {
    const parsed = beatReviewPlanSchema.safeParse({
      beats: [{ index: 4, verdict: "clutter", note: "Three numbers at once." }],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a verdict outside the set", () => {
    const parsed = beatReviewPlanSchema.safeParse({
      beats: [{ index: 4, verdict: "ugly", note: "I do not like it." }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a note that is an essay", () => {
    /* THE_VERDICT_IS_A_CLOSED_SET, and the note is a sentence — a paragraph
     * does not fit on the card that shows it. */
    const parsed = sceneReviewSchema.safeParse({
      verdict: "ok",
      note: "x".repeat(241),
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a reason even for `ok`", () => {
    expect(
      sceneReviewSchema.safeParse({ verdict: "ok", note: "" }).success,
    ).toBe(false);
  });
});

describe("choosing which beats to review", () => {
  it("takes at most three", () => {
    /* SAMPLED_NOT_EXHAUSTIVE — the phase's "2–3 stills". */
    const chosen = pickBeatsToReview([
      beat(0, 1),
      beat(1, 2),
      beat(2, 3),
      beat(3, 4),
      beat(4, 5),
    ]);
    expect(chosen).toHaveLength(3);
  });

  it("takes the busiest frames", () => {
    /* THE_BUSIEST_FRAMES_ARE_THE_RISK — clutter and cut-off text both get
     * likelier with every element on screen. */
    const chosen = pickBeatsToReview([
      beat(0, 1),
      beat(1, 6),
      beat(2, 2),
      beat(3, 5),
    ]);
    expect(chosen.map((entry) => entry.index)).toEqual([1, 3, 2]);
  });

  it("never reviews a fallback", () => {
    /* A fallback is one measured line of narration: it cannot be cluttered or
     * off-topic, and the strip already badges it. */
    const chosen = pickBeatsToReview([
      beat(0, 6, "fallback"),
      beat(1, 1),
      beat(2, 2, "fallback"),
    ]);
    expect(chosen.map((entry) => entry.index)).toEqual([1]);
  });

  it("reviews nothing when every beat fell back", () => {
    const chosen = pickBeatsToReview([
      beat(0, 1, "fallback"),
      beat(1, 1, "fallback"),
    ]);
    expect(chosen).toEqual([]);
  });

  it("breaks ties on the index, so the sample is reproducible", () => {
    const chosen = pickBeatsToReview([beat(7, 3), beat(2, 3), beat(5, 3)]);
    expect(chosen.map((entry) => entry.index)).toEqual([2, 5, 7]);
  });

  it("does not reorder the caller's array", () => {
    const beats = [beat(0, 1), beat(1, 6)];
    pickBeatsToReview(beats);
    expect(beats.map((entry) => entry.index)).toEqual([0, 1]);
  });
});
