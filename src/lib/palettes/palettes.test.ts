/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: palettes test, UNKNOWN_PALETTE_FALLS_BACK,
 *   ONE_GRADIENT_STRING, EVERY_FIXTURE_PALETTE_EXISTS, CONTRAST_TEXT_MIN
 *
 * WHAT:  That every palette id any document already holds resolves, that an
 *        unknown one falls back rather than failing, and that each palette's
 *        own text colour is actually legible on it.
 *
 * WHY:   EVERY_FIXTURE_PALETTE_EXISTS is the test worth having most. The
 *        fixtures and the v1 migration have been writing `warm`, `mono`,
 *        `electric`, `noir` and `default` into documents since Phase 01, long
 *        before anything resolved them — so this library was written to match
 *        documents that already exist. A renamed or dropped id here is a
 *        stored document whose background silently changes.
 *
 *        The contrast assertion reuses the caption library's own rule rather
 *        than a second luminance calculation, for the reason stated on the
 *        `text` field: there is one answer to "is this legible" in this
 *        codebase and it lives in src/lib/captions/contrast.ts.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { contrastRatio, CONTRAST_TEXT_MIN } from "@/lib/captions";
import { FIXTURES_BY_KIND } from "@/lib/timeline/fixtures";
import { SCENE_TONE_COLOURS, toneColor } from "./tones";
import {
  BACKDROP_ELEMENT_KIND,
  DEFAULT_PALETTE_ID,
  PALETTES,
  backdropGradient,
  getPalette,
  isPaletteId,
  listPalettes,
  paletteSchema,
} from "./index";

describe("the palette library", () => {
  it("has a well-formed entry under every key, keyed by its own id", () => {
    for (const [key, palette] of Object.entries(PALETTES)) {
      expect(paletteSchema.safeParse(palette).success, key).toBe(true);
      expect(palette.id, `${key} is keyed by its own id`).toBe(key);
    }
  });

  /* EVERY_FIXTURE_PALETTE_EXISTS — see the file header. */
  it("resolves every palette id the existing fixtures write", () => {
    for (const [kind, build] of Object.entries(FIXTURES_BY_KIND)) {
      const id = build().style.paletteId;
      expect(isPaletteId(id), `${kind} writes palette "${id}"`).toBe(true);
    }
  });

  it("resolves the id the v1 migration writes", () => {
    /* src/lib/timeline/migrate.ts puts `default` on every legacy document. */
    expect(isPaletteId(DEFAULT_PALETTE_ID)).toBe(true);
  });

  /* UNKNOWN_PALETTE_FALLS_BACK — the caller is a render worker composing a
   * paid video, so an unrecognised id must produce a plain background rather
   * than a black frame or a throw inside a Lambda. */
  it("falls back instead of throwing on an unknown or missing id", () => {
    expect(getPalette("does-not-exist").id).toBe(DEFAULT_PALETTE_ID);
    expect(getPalette(undefined).id).toBe(DEFAULT_PALETTE_ID);
    expect(getPalette("").id).toBe(DEFAULT_PALETTE_ID);
  });

  it("returns the palette that was asked for when it exists", () => {
    expect(getPalette("noir").id).toBe("noir");
    expect(listPalettes()).toHaveLength(Object.keys(PALETTES).length);
  });

  /* ONE_GRADIENT_STRING — the Remotion component and the generate screen both
   * paint this exact string, so it is built in one place. */
  it("builds a gradient carrying both stops", () => {
    const gradient = backdropGradient(getPalette("warm"));
    expect(gradient).toContain(PALETTES["warm"]?.from ?? "");
    expect(gradient).toContain(PALETTES["warm"]?.to ?? "");
    expect(gradient.startsWith("linear-gradient(")).toBe(true);
  });

  /* The price of RENDER_COLOURS_ARE_LITERAL: a literal colour in this codebase
   * has to pass a contrast test rather than a reviewer's eye. */
  it("states a text colour that is legible on its own background", () => {
    for (const palette of listPalettes()) {
      const onFrom = contrastRatio(palette.text, palette.from);
      const onTo = contrastRatio(palette.text, palette.to);
      expect(
        Math.min(onFrom, onTo),
        `${palette.id}: text on its gradient`,
      ).toBeGreaterThanOrEqual(CONTRAST_TEXT_MIN);
    }
  });

  /* The one string the generator writes and the component reads. If it drifts,
   * every generated video gets the DEFAULT background and nothing errors — see
   * BACKDROP_ELEMENT_KIND. */
  it("pins the backdrop element kind", () => {
    expect(BACKDROP_ELEMENT_KIND).toBe("gradient");
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: TONE_CONTRAST_IS_TESTED, SCENE_TONE_COLOURS, toneColor
 *
 * WHAT:  That every motion scene tone is legible on every palette.
 * WHY:   The tones are literal colours, so they owe the same debt every other
 *        literal in this codebase owes (RENDER_COLOURS_ARE_LITERAL): a contrast
 *        test rather than a reviewer's eye. They are the 400-weight tints
 *        BECAUSE every palette in the library is dark, which is an assumption
 *        about the library and not a general truth — so adding a light palette
 *        must fail here rather than ship a callout nobody can read.
 * WHERE: `npm test`.
 */
describe("motion scene tones", () => {
  const TONES = ["neutral", "positive", "warning", "negative"] as const;

  it("is legible on every palette's gradient", () => {
    for (const palette of listPalettes()) {
      for (const tone of TONES) {
        const colour = toneColor(tone, palette);
        const worst = Math.min(
          contrastRatio(colour, palette.from),
          contrastRatio(colour, palette.to),
        );
        expect(
          worst,
          `${palette.id}: ${tone} (${colour}) on its gradient`,
        ).toBeGreaterThanOrEqual(CONTRAST_TEXT_MIN);
      }
    }
  });

  it("gives a neutral tone the palette's own voice rather than a sixth near-white", () => {
    for (const palette of listPalettes()) {
      expect(toneColor("neutral", palette)).toBe(palette.text);
    }
  });

  it("gives the three judgement tones distinct colours", () => {
    const values = Object.values(SCENE_TONE_COLOURS);
    expect(new Set(values).size).toBe(values.length);
  });
});
