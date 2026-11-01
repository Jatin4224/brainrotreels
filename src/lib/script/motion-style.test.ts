/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motion style designer test, ID_IS_MINTED_BY_CODE,
 *   CODE_VALIDATES_NOT_THE_EYE, A_PROPOSAL_IS_NOT_A_STYLE,
 *   REJECT_AND_REGENERATE
 *
 * WHAT:  The pure halves of "design one for me": that a proposal becomes a
 *        style of the same type as a library one, that the minted id cannot
 *        collide with a library style, and that a bad proposal is caught by
 *        the validator rather than by a reviewer.
 *
 * WHY:   Nothing in this codebase mocks the LLM adapter — the convention every
 *        model-calling module follows is that the parts which can actually be
 *        wrong are pure and tested, and the adapter call itself is exercised
 *        against a real provider. So this asserts the two things that decide
 *        whether the designer is safe: the minting, and the fact that an
 *        invalid proposal FAILS `checkMotionStyle`. The retry loop around them
 *        is four lines of control flow over those two facts.
 *
 *        The "would be refused" tests are the phase's step 9 from the model's
 *        side. A proposal naming a palette that does not exist, or a caption
 *        treatment that was renamed, is exactly what a model does — and it has
 *        to be caught by code, because the failure it would otherwise cause is
 *        a silently wrong video.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { checkMotionStyle, MOTION_STYLES } from "@/lib/motion-styles";
import {
  motionStyleProposalSchema,
  type MotionStyleProposal,
} from "@/lib/types/motion-style";

import { mintStyleId, styleFromProposal } from "./motion-style";

const PROPOSAL: MotionStyleProposal = {
  name: "Quiet Ledger",
  paletteId: "mono",
  fonts: { display: "display", body: "display" },
  radius: "square",
  strokeWeight: "hairline",
  motionPersonality: "calm",
  captionTreatment: "editorial-band",
  musicMood: "ambient",
  rationale: "Grey and unhurried, so the numbers carry the video.",
};

describe("minting a designed style's id", () => {
  it("never collides with a library style", () => {
    /* ID_IS_MINTED_BY_CODE. A model-chosen id could silently replace a library
     * style on a screen listing both. */
    for (const libraryId of Object.keys(MOTION_STYLES)) {
      expect(mintStyleId(libraryId)).not.toBe(libraryId);
    }
    expect(mintStyleId("Studio")).toBe("designed-studio");
  });

  it("slugs a name into something usable as an id", () => {
    expect(mintStyleId("Quiet Ledger")).toBe("designed-quiet-ledger");
    expect(mintStyleId("  Bold   Launch!  ")).toBe("designed-bold-launch");
  });

  it("never produces a bare prefix", () => {
    /* Two styles named only in punctuation would otherwise both be
     * `designed-`, and the second would replace the first. */
    for (const name of ["!!!", "—", "数字"]) {
      expect(mintStyleId(name)).toBe("designed-style");
    }
  });

  it("caps the slug so an id stays an id", () => {
    const long = mintStyleId("a".repeat(200));
    expect(long.length).toBeLessThanOrEqual("designed-".length + 40);
  });
});

describe("turning a proposal into a style", () => {
  it("produces a style that passes validation", () => {
    const style = styleFromProposal(PROPOSAL);
    expect(checkMotionStyle(style).rejections).toEqual([]);
  });

  it("carries every proposed token through unchanged", () => {
    const style = styleFromProposal(PROPOSAL);

    expect(style.paletteId).toBe(PROPOSAL.paletteId);
    expect(style.radius).toBe(PROPOSAL.radius);
    expect(style.strokeWeight).toBe(PROPOSAL.strokeWeight);
    expect(style.motionPersonality).toBe(PROPOSAL.motionPersonality);
    expect(style.captionTreatment).toBe(PROPOSAL.captionTreatment);
    expect(style.musicMood).toBe(PROPOSAL.musicMood);
    expect(style.fonts).toEqual(PROPOSAL.fonts);
  });

  it("sets the plan itself rather than taking the model's word", () => {
    /* What a style costs is a commercial decision; a model choosing `free`
     * here would be inventing pricing. */
    expect(styleFromProposal(PROPOSAL).minPlan).toBe("pro");
  });

  it("does not carry the rationale into the style", () => {
    /* A_PROPOSAL_IS_NOT_A_STYLE — the rationale describes a decision, and a
     * renderer should not be carrying a sentence about why a model chose
     * something in March. */
    expect(Object.keys(styleFromProposal(PROPOSAL))).not.toContain("rationale");
  });
});

describe("what the validator refuses from a model", () => {
  it("refuses a palette the model invented", () => {
    const style = styleFromProposal({ ...PROPOSAL, paletteId: "midnight" });
    expect(checkMotionStyle(style).rejections.map((r) => r.code)).toContain(
      "UNKNOWN_PALETTE",
    );
  });

  it("refuses a caption treatment the model invented", () => {
    const style = styleFromProposal({
      ...PROPOSAL,
      captionTreatment: "editorial-serious",
    });
    expect(checkMotionStyle(style).rejections.map((r) => r.code)).toContain(
      "UNKNOWN_CAPTION_TREATMENT",
    );
  });

  it("gives a refusal the model can act on", () => {
    /* REJECT_AND_REGENERATE — the refusal is quoted verbatim into the retry
     * prompt, so it has to name the token AND the valid options. */
    const style = styleFromProposal({ ...PROPOSAL, paletteId: "midnight" });
    const rejection = checkMotionStyle(style).rejections.find(
      (r) => r.code === "UNKNOWN_PALETTE",
    );

    expect(rejection?.path).toBe("paletteId");
    expect(rejection?.message).toContain("mono");
  });

  it("cannot be handed a font family, because the schema has no room for one", () => {
    /* The phase's named failure — "a model-proposed font that is not bundled
     * renders as a fallback and silently ruins the video" — is refused one
     * level EARLIER than the validator: `fonts.display` is a closed union, so
     * "Impact" never becomes a MotionStyle at all.
     *
     * Asserted against the schema rather than by casting a bad object into
     * `styleFromProposal`, because `safeParse` takes untyped input — which is
     * exactly the shape model output arrives in, and needs no cast to say so. */
    const result = motionStyleProposalSchema.safeParse({
      ...PROPOSAL,
      fonts: { display: "Impact", body: "Impact" },
    });

    expect(result.success).toBe(false);
  });

  it("refuses a radius or personality the model invented, at the schema", () => {
    for (const bad of [
      { ...PROPOSAL, radius: "squircle" },
      { ...PROPOSAL, motionPersonality: "dramatic" },
      { ...PROPOSAL, musicMood: "lo-fi" },
    ]) {
      expect(motionStyleProposalSchema.safeParse(bad).success).toBe(false);
    }
  });
});
