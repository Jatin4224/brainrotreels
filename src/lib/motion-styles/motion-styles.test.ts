/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motion-styles test, CODE_VALIDATES_NOT_THE_EYE,
 *   EIGHT_STYLES_THAT_DIFFER, FONT_NOT_BUNDLED_IS_THE_SILENT_ONE,
 *   TOKENS_MUST_CHANGE_THE_PICTURE, UNKNOWN_STYLE_FALLS_BACK
 *
 * WHAT:  That every shipped style is genuinely shippable, that the validator
 *        catches each thing it claims to, and that the library is a library
 *        rather than eight palette swaps.
 *
 * WHY:   The whole shipped library going through `checkMotionStyle` is the
 *        assertion worth having most, and it is the phase's step 9 turned on
 *        the library itself: the same code that validates a MODEL's proposal
 *        validates ours. A style we wrote by hand has no special standing —
 *        it can name a caption treatment that was renamed, or pair a dark
 *        caption with a dark palette, exactly as a model can.
 *
 *        EIGHT_STYLES_THAT_DIFFER is asserted because the failure mode is
 *        silent and embarrassing: a picker whose entries differ only in colour
 *        is a palette picker, and the customer finds out after choosing.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { PLAN_KEYS } from "@/lib/config/plans";
import { PALETTES } from "@/lib/palettes";
import {
  MOTION_PERSONALITIES,
  MOTION_PERSONALITY_TIMING,
  MOTION_RADII,
  MOTION_RADIUS_SCALE,
  MOTION_STROKES,
  MOTION_STROKE_SCALE,
  MUSIC_MOODS,
  motionStyleSchema,
  type MotionStyle,
} from "@/lib/types/motion-style";

import { defineMotionStyle } from "./define";
import {
  DEFAULT_MOTION_STYLE_ID,
  getMotionStyle,
  isMotionStyleId,
  listMotionStyles,
  MOTION_STYLES,
  MOTION_STYLE_LIBRARY,
} from "./index";
import { checkMotionStyle } from "./validate";

describe("the shipped library", () => {
  it("ships between six and ten styles, as the phase asks", () => {
    expect(MOTION_STYLE_LIBRARY.length).toBeGreaterThanOrEqual(6);
    expect(MOTION_STYLE_LIBRARY.length).toBeLessThanOrEqual(10);
  });

  it("loses no style to a duplicate id", () => {
    expect(Object.keys(MOTION_STYLES)).toHaveLength(
      MOTION_STYLE_LIBRARY.length,
    );
  });

  it("passes its own validation, every style", () => {
    /* CODE_VALIDATES_NOT_THE_EYE, turned on us. */
    for (const style of MOTION_STYLE_LIBRARY) {
      const result = checkMotionStyle(style);
      expect(result.rejections, `${style.id}`).toEqual([]);
    }
  });

  it("names a real plan on every style", () => {
    for (const style of MOTION_STYLE_LIBRARY) {
      expect(PLAN_KEYS as readonly string[], style.id).toContain(style.minPlan);
    }
  });

  it("includes the default, and the default is the plainest entry", () => {
    expect(isMotionStyleId(DEFAULT_MOTION_STYLE_ID)).toBe(true);
    const base = defineMotionStyle(DEFAULT_MOTION_STYLE_ID, "Studio");
    expect(getMotionStyle(DEFAULT_MOTION_STYLE_ID)).toEqual(base);
  });

  it("differs on at least three tokens between any two styles", () => {
    /* EIGHT_STYLES_THAT_DIFFER. Compared on the six tokens that are visible in
     * a single still or its motion — `minPlan` is commercial, not visual. */
    const visible = (style: MotionStyle) => [
      style.paletteId,
      style.radius,
      style.strokeWeight,
      style.motionPersonality,
      style.captionTreatment,
      style.musicMood,
    ];

    for (let a = 0; a < MOTION_STYLE_LIBRARY.length; a += 1) {
      for (let b = a + 1; b < MOTION_STYLE_LIBRARY.length; b += 1) {
        const first = MOTION_STYLE_LIBRARY[a];
        const second = MOTION_STYLE_LIBRARY[b];
        if (first === undefined || second === undefined) continue;

        const left = visible(first);
        const right = visible(second);
        const differences = left.filter(
          (value, index) => value !== right[index],
        ).length;

        expect(
          differences,
          `${first.id} vs ${second.id} differ on only ${differences} token(s)`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses every palette and every motion personality somewhere", () => {
    /* A token value nothing in the library uses is one nobody has looked at. */
    const used = {
      palettes: new Set(MOTION_STYLE_LIBRARY.map((s) => s.paletteId)),
      personalities: new Set(
        MOTION_STYLE_LIBRARY.map((s) => s.motionPersonality),
      ),
      radii: new Set(MOTION_STYLE_LIBRARY.map((s) => s.radius)),
      strokes: new Set(MOTION_STYLE_LIBRARY.map((s) => s.strokeWeight)),
    };

    expect(
      [...MOTION_PERSONALITIES].filter((p) => !used.personalities.has(p)),
    ).toEqual([]);
    expect([...MOTION_RADII].filter((r) => !used.radii.has(r))).toEqual([]);
    expect([...MOTION_STROKES].filter((s) => !used.strokes.has(s))).toEqual([]);
    /* Not every palette has to be used — five palettes and eight styles means
     * some repeat — but an unused one is worth knowing about. */
    expect(used.palettes.size).toBeGreaterThanOrEqual(4);
  });

  it("returns the default for an unknown or missing id", () => {
    /* UNKNOWN_STYLE_FALLS_BACK — a render must never fail on a style id. */
    expect(getMotionStyle("no-such-style").id).toBe(DEFAULT_MOTION_STYLE_ID);
    expect(getMotionStyle(undefined).id).toBe(DEFAULT_MOTION_STYLE_ID);
    expect(isMotionStyleId("no-such-style")).toBe(false);
  });

  it("lists a copy rather than the library itself", () => {
    const listed = listMotionStyles();
    listed.pop();
    expect(listMotionStyles()).toHaveLength(MOTION_STYLE_LIBRARY.length);
  });
});

describe("the token scales", () => {
  it("has a timing for every personality", () => {
    for (const personality of MOTION_PERSONALITIES) {
      const timing = MOTION_PERSONALITY_TIMING[personality];
      expect(timing.entranceSeconds, personality).toBeGreaterThan(0);
      expect(timing.exitSeconds, personality).toBeGreaterThan(0);
      expect(timing.staggerSeconds, personality).toBeGreaterThan(0);
      /* An entrance longer than the shortest beat the phase allows (1.5s)
       * would mean an element that never finishes arriving. */
      expect(timing.entranceSeconds, personality).toBeLessThan(1);
    }
  });

  it("keeps the radius scale inside what a border-radius fraction means", () => {
    for (const radius of MOTION_RADII) {
      const value = MOTION_RADIUS_SCALE[radius];
      expect(value, radius).toBeGreaterThanOrEqual(0);
      /* Above 0.5 the browser clamps to a pill, so a larger number would be a
       * difference the viewer cannot see and a reader would trust. */
      expect(value, radius).toBeLessThanOrEqual(0.5);
    }
  });

  it("keeps every stroke multiplier visible and sane", () => {
    for (const stroke of MOTION_STROKES) {
      const value = MOTION_STROKE_SCALE[stroke];
      expect(value, stroke).toBeGreaterThan(0.2);
      expect(value, stroke).toBeLessThanOrEqual(2);
    }
  });

  it("defaults music to silence", () => {
    /* MUSIC_LICENCE_IS_NOT_RESOLVED_YET — a style defaulting to `upbeat` would
     * promise music that silently never arrives. */
    expect(MUSIC_MOODS[0]).toBe("none");
    expect(getMotionStyle(DEFAULT_MOTION_STYLE_ID).musicMood).toBe("none");
  });
});

describe("the validator", () => {
  const valid = getMotionStyle(DEFAULT_MOTION_STYLE_ID);

  it("accepts a style from the library", () => {
    expect(checkMotionStyle(valid).ok).toBe(true);
  });

  it("refuses a palette that does not exist", () => {
    const result = checkMotionStyle({ ...valid, paletteId: "vaporwave" });
    expect(result.rejections.map((r) => r.code)).toContain("UNKNOWN_PALETTE");
  });

  it("refuses a caption treatment that does not exist", () => {
    const result = checkMotionStyle({
      ...valid,
      captionTreatment: "clean-minimal",
    });
    expect(result.rejections.map((r) => r.code)).toContain(
      "UNKNOWN_CAPTION_TREATMENT",
    );
  });

  it("refuses a plan that does not exist", () => {
    const result = checkMotionStyle({ ...valid, minPlan: "platinum" });
    expect(result.rejections.map((r) => r.code)).toContain("UNKNOWN_PLAN");
  });

  it("names the token at fault and what would have been valid", () => {
    /* A model is re-asked once with these messages attached, so "invalid
     * palette" would waste the retry. */
    const result = checkMotionStyle({ ...valid, paletteId: "vaporwave" });
    const rejection = result.rejections.find(
      (r) => r.code === "UNKNOWN_PALETTE",
    );

    expect(rejection?.path).toBe("paletteId");
    for (const id of Object.keys(PALETTES)) {
      expect(rejection?.message).toContain(id);
    }
  });

  it("refuses a dark caption treatment on a dark palette", () => {
    /* The pairing check nothing else in the codebase makes: a caption style is
     * measured against REFERENCE_BACKGROUNDS in its own library, never against
     * the palette a motion style happens to pair it with.
     *
     * `bold-ink` is the one style in the thirty-eight whose fill is dark
     * (#101010) — it exists to be read over bright footage, and on the `noir`
     * palette it measures 1.04:1. A model asking for "an inky look on a black
     * background" is a plausible request and this is the refusal that stops it
     * shipping as an unreadable video. */
    const result = checkMotionStyle({
      ...valid,
      paletteId: "noir",
      captionTreatment: "bold-ink",
    });

    const rejection = result.rejections.find(
      (r) => r.code === "CONTRAST_TOO_LOW",
    );
    expect(rejection?.path).toBe("captionTreatment");
    expect(rejection?.message).toContain("bold-ink");
  });

  it("accepts that same caption treatment nowhere, since every palette is dark", () => {
    /* Worth stating rather than leaving implied: `bold-ink` cannot be paired
     * with ANY palette in the library today, because all five are dark. That is
     * a fact about the palette set, not a bug in the style — and if a light
     * palette is ever added, this test is what will notice that the pairing has
     * become legal. */
    for (const paletteId of Object.keys(PALETTES)) {
      const result = checkMotionStyle({
        ...valid,
        paletteId,
        captionTreatment: "bold-ink",
      });
      expect(result.ok, `bold-ink on ${paletteId}`).toBe(false);
    }
  });

  it("parses a style at definition, so a bad token fails at import", () => {
    expect(() =>
      motionStyleSchema.parse({ ...valid, radius: "squircle" }),
    ).toThrow();
  });
});
