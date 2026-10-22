/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: moderation types test, REFUSAL_NAMES_THE_REASON,
 *   BLOCKED_IS_NOT_REJECTED, CATEGORIES_ARE_CLOSED, VERDICT_IS_NOT_A_STATUS
 *
 * WHAT:  The vocabulary of content safety: that every category can be named in
 *        a sentence, that `flagged` blocks, and that the refusal copy says what
 *        it was refused for.
 *
 * WHY:   The refusal message is the only part of this phase a customer ever
 *        sees, and the phase's own requirement is that it names the category
 *        rather than citing a policy. That is a property worth asserting
 *        rather than eyeballing — a category added without a label would
 *        otherwise produce a refusal reading "content our policy does not
 *        allow", which is exactly the message this phase exists to avoid.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { MODERATION_STATUSES } from "./asset";
import {
  CATEGORY_LABELS,
  MODERATION_CATEGORIES,
  MODERATION_CONTEXTS,
  MODERATION_VERDICTS,
  describeModerationVerdict,
  isModerationBlocking,
  moderationVerdictSchema,
} from "./moderation";

describe("the category vocabulary", () => {
  /* CATEGORIES_ARE_CLOSED — a label for every one, so no refusal can fall back
   * to the generic sentence by accident. */
  it("can name every category in a sentence", () => {
    for (const category of MODERATION_CATEGORIES) {
      const label = CATEGORY_LABELS[category];
      expect(label, category).toBeTruthy();
      /* Lower case and no trailing stop: the labels are interpolated INTO a
       * sentence ("...contains graphic violence."), so a capitalised or
       * punctuated label reads as a splice. */
      expect(label, category).toBe(label.toLowerCase());
      expect(label.endsWith("."), category).toBe(false);
    }
  });

  it("has a label map with no extra keys", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(
      [...MODERATION_CATEGORIES].sort(),
    );
  });

  /* VERDICT_IS_NOT_A_STATUS. If these two unions ever overlap by accident,
   * somebody will assign one to the other and `flagged` content will render.
   * `approved` and `rejected` are deliberately shared; nothing else may be. */
  it("keeps verdicts and asset statuses distinct", () => {
    const shared = MODERATION_VERDICTS.filter((verdict) =>
      (MODERATION_STATUSES as readonly string[]).includes(verdict),
    );
    expect(shared.sort()).toEqual(["approved", "rejected"]);
    expect(
      (MODERATION_STATUSES as readonly string[]).includes("flagged"),
    ).toBe(false);
  });
});

describe("isModerationBlocking", () => {
  /* BLOCKED_IS_NOT_REJECTED — the one that is easy to get wrong, and the
   * failure mode is flagged content being published. */
  it("blocks anything that is not an approval", () => {
    expect(isModerationBlocking("approved")).toBe(false);
    expect(isModerationBlocking("rejected")).toBe(true);
    expect(isModerationBlocking("flagged")).toBe(true);
  });
});

describe("describeModerationVerdict", () => {
  /* REFUSAL_NAMES_THE_REASON — the phase's own requirement. */
  it("names the category it refused over", () => {
    const message = describeModerationVerdict({
      status: "rejected",
      categories: ["violence"],
    });
    expect(message).toContain(CATEGORY_LABELS.violence);
    expect(message).toContain("Edit it and try again");
  });

  it("names several categories as a readable list", () => {
    const message = describeModerationVerdict({
      status: "rejected",
      categories: ["hate", "harassment"],
    });
    expect(message).toContain(CATEGORY_LABELS.hate);
    expect(message).toContain(CATEGORY_LABELS.harassment);
    expect(message).toContain(" and ");
    /* Not a joined array dumped into a sentence. */
    expect(message).not.toContain("[");
  });

  it("does not repeat a label when two categories share one", () => {
    const message = describeModerationVerdict({
      status: "rejected",
      categories: ["other", "other"],
    });
    const occurrences = message.split(CATEGORY_LABELS.other).length - 1;
    expect(occurrences).toBe(1);
  });

  /* A refusal with no categories still has to be a sentence. A model can
   * return `rejected` with an empty list, and "contains ." is not a message. */
  it("falls back to the generic label when no category was given", () => {
    const message = describeModerationVerdict({
      status: "rejected",
      categories: [],
    });
    expect(message).toContain(CATEGORY_LABELS.other);
  });

  /* The copy for `flagged` must NOT tell the customer to edit and retry —
   * nothing is wrong with their content yet and a person is looking at it. */
  it("tells a flagged customer to wait rather than to edit", () => {
    const message = describeModerationVerdict({
      status: "flagged",
      categories: ["sexual"],
    });
    expect(message).toContain("held for review");
    expect(message).not.toContain("Edit it and try again");
  });

  it("says nothing at all about an approval", () => {
    expect(
      describeModerationVerdict({ status: "approved", categories: [] }),
    ).toBe("");
  });
});

describe("moderationVerdictSchema", () => {
  /* This is the schema the MODEL fills, so what it refuses matters as much as
   * what it accepts: an invented category must not reach the database. */
  it("refuses a category outside the closed list", () => {
    const parsed = moderationVerdictSchema.safeParse({
      status: "rejected",
      categories: ["spicy"],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown verdict", () => {
    expect(
      moderationVerdictSchema.safeParse({ status: "maybe", categories: [] })
        .success,
    ).toBe(false);
  });

  it("refuses extra fields rather than silently dropping them", () => {
    /* `.strict()` — a model that invents a `confidence` field is a model whose
     * output we do not understand, and quietly ignoring it hides that. */
    expect(
      moderationVerdictSchema.safeParse({
        status: "approved",
        categories: [],
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it("accepts the ordinary approval and the ordinary refusal", () => {
    expect(
      moderationVerdictSchema.safeParse({ status: "approved", categories: [] })
        .success,
    ).toBe(true);
    expect(
      moderationVerdictSchema.safeParse({
        status: "flagged",
        categories: ["other"],
        reason: "borderline",
      }).success,
    ).toBe(true);
  });
});

describe("the context vocabulary", () => {
  /* The three contexts exist because they are judged differently. If this ever
   * collapses to one, the rubric in the Claude prompt is meaningless. */
  it("has the three standards the classifier distinguishes", () => {
    expect([...MODERATION_CONTEXTS].sort()).toEqual([
      "input",
      "prompt",
      "script",
    ]);
  });
});
