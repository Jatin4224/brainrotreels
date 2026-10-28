/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: speaker caption tests, COLOUR_IS_NEVER_THE_ONLY_SIGNAL,
 *   COLOUR_IS_DERIVED_NOT_STORED, NARRATOR_IS_ALWAYS_WHITE, ONE_TAG_PER_CARD,
 *   CONTRAST_IS_CHECKED
 *
 * WHAT:  Tests for per-speaker caption colouring — the colour, the name tag
 *        that must come with it, and which speaker a card belongs to.
 *
 * WHY:   Two of these assert accessibility properties rather than behaviour,
 *        and they are the reason this file exists. A tint with no name tag is
 *        invisible to roughly one man in twelve, so the pairing is asserted
 *        structurally (one function, both values) rather than trusted to review.
 *        And every colour is held to the same contrast rule Phase 08 applies to
 *        the caption library, because a caption sits over footage nobody chose.
 *
 *        COLOUR_IS_DERIVED_NOT_STORED is asserted as STABILITY: the same tag
 *        must give the same colour every time, because the alternative is a
 *        speaker whose colour changes between two generations of the same
 *        project.
 * WHERE: Run by `npm test`. Guards src/lib/captions/speakers.ts.
 */

import { describe, expect, it } from "vitest";

import type { WordToken } from "@/lib/timeline";
import { CONTRAST_TEXT_MIN, contrastRatio } from "./contrast";
import {
  SPEAKER_CAPTION_COLORS,
  dominantSpeaker,
  speakerCaptionTint,
  speakerLabelFor,
} from "./speakers";

function word(i: number, speaker?: string): WordToken {
  return {
    i,
    w: `w${i}`,
    s: i,
    e: i + 1,
    ...(speaker === undefined ? {} : { speaker }),
  };
}

describe("speakerCaptionTint", () => {
  /**
   * COLOUR_IS_NEVER_THE_ONLY_SIGNAL, asserted structurally: there is no way to
   * get the colour without also getting the label, because one call returns
   * both. This test fails the moment somebody splits them into two functions,
   * which is exactly when the tint could start shipping without the tag.
   */
  it("always returns a label with the colour", () => {
    for (const tag of ["narrator", "op", "commenter", "guest", "A"]) {
      const tint = speakerCaptionTint(tag);
      expect(tint.color, tag).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tint.label.length, tag).toBeGreaterThan(0);
    }
  });

  /* NARRATOR_IS_ALWAYS_WHITE — the voice in most of every video, so tinting it
   * would colour most captions in the product for no informational gain. It
   * also means a single-speaker video looks exactly as it did before this
   * feature existed. */
  it("leaves the narrator the plain caption colour", () => {
    expect(speakerCaptionTint("narrator").color).toBe(
      SPEAKER_CAPTION_COLORS[0],
    );
    expect(speakerCaptionTint("NARRATOR").color).toBe(
      SPEAKER_CAPTION_COLORS[0],
    );
    expect(speakerCaptionTint("").color).toBe(SPEAKER_CAPTION_COLORS[0]);
  });

  /* And nobody else gets white, or the tint would carry no signal at all. */
  it("never gives another speaker the narrator's colour", () => {
    for (const tag of ["op", "commenter", "guest", "A", "B", "host"]) {
      expect(speakerCaptionTint(tag).color, tag).not.toBe(
        SPEAKER_CAPTION_COLORS[0],
      );
    }
  });

  /* COLOUR_IS_DERIVED_NOT_STORED — stability is the property that makes
   * deriving it safe. A speaker whose colour changed between two generations
   * of the same project would look like a bug in the renderer. */
  it("gives the same tag the same colour every time", () => {
    for (const tag of ["op", "commenter", "guest"]) {
      const first = speakerCaptionTint(tag);
      expect(speakerCaptionTint(tag)).toEqual(first);
      expect(speakerCaptionTint(tag.toUpperCase()).color).toBe(first.color);
    }
  });

  it("distinguishes the three Reddit roles from each other", () => {
    const colors = new Set(
      ["narrator", "op", "commenter"].map(
        (tag) => speakerCaptionTint(tag).color,
      ),
    );
    expect(colors.size).toBe(3);
  });

  /**
   * CONTRAST_IS_CHECKED. Captions are drawn over arbitrary footage, so every
   * tint is held to the same rule the caption library is — against the darkest
   * background a caption is drawn on. A mid-tone colour that reads beautifully
   * in a design tool disappears over a bright gameplay clip, and the reverse
   * over a dark one.
   */
  it("keeps every colour legible over a dark backing", () => {
    for (const color of SPEAKER_CAPTION_COLORS) {
      /* The same threshold `passesContrast` holds the caption library to, and
       * against the same reference background. A caption is drawn with a
       * shadow over arbitrary footage, so the dark reference is the one that
       * decides whether a tint survives. */
      expect(contrastRatio(color, "#000000"), color).toBeGreaterThanOrEqual(
        CONTRAST_TEXT_MIN,
      );
    }
  });
});

describe("speakerLabelFor", () => {
  it("uses the proper name for a Reddit role", () => {
    expect(speakerLabelFor("op")).toBe("OP");
    expect(speakerLabelFor("commenter")).toBe("Reply");
    expect(speakerLabelFor("narrator")).toBe("Narrator");
  });

  /* A format with its own tags gets a readable tag for free rather than a
   * blank — which is what stops this feature from being Reddit-only. */
  it("title-cases an unknown tag", () => {
    expect(speakerLabelFor("guest")).toBe("Guest");
    expect(speakerLabelFor("host")).toBe("Host");
  });

  it("bounds a pathological tag so it cannot push the caption off the card", () => {
    expect(speakerLabelFor("a".repeat(200)).length).toBeLessThanOrEqual(14);
  });

  it("is empty for an empty tag", () => {
    expect(speakerLabelFor("   ")).toBe("");
  });
});

describe("dominantSpeaker", () => {
  /**
   * ONE_TAG_PER_CARD. A caption groups three or four words by COUNT and knows
   * nothing about speakers, so a card can straddle a speaker change — and it
   * is drawn in one colour. The majority is the honest answer.
   */
  it("picks the speaker who said most of the words", () => {
    expect(
      dominantSpeaker([word(0, "op"), word(1, "commenter"), word(2, "op")]),
    ).toBe("op");
  });

  /* A tie goes to the FIRST word, because a viewer attributes a caption to
   * whoever began it. */
  it("gives a tie to the speaker who started the card", () => {
    expect(dominantSpeaker([word(0, "commenter"), word(1, "op")])).toBe(
      "commenter",
    );
    expect(dominantSpeaker([word(0, "op"), word(1, "commenter")])).toBe("op");
  });

  /* Null for every document written before Phase 08 started tagging words, and
   * for every degraded alignment. The caller then draws the caption exactly as
   * it always did. */
  it("answers null when no word carries a speaker", () => {
    expect(dominantSpeaker([word(0), word(1)])).toBeNull();
    expect(dominantSpeaker([])).toBeNull();
  });

  it("ignores untagged words rather than counting them as a speaker", () => {
    expect(dominantSpeaker([word(0), word(1, "op"), word(2)])).toBe("op");
  });
});
