/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: contrast test, CONTRAST_IS_A_TEST_NOT_AN_EYE,
 *   CAPTION_STYLES, passesContrast, STYLE_LIBRARY_INVARIANTS
 *
 * WHAT:  The phase's contrast check, run over the whole shipped library, plus
 *        the invariants a style library has to hold to be usable at all.
 * WHY:   The phase asks for the check to live "in a test rather than a
 *        reviewer's eye". This is that test. It fails on the style that is
 *        wrong and names the colour and the background, so the thirty-ninth
 *        style is fixed in the same minute it is written.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE_ID, getCaptionStyle } from "./styles";
import {
  CONTRAST_TEXT_MIN,
  contrastRatio,
  passesContrast,
  relativeLuminance,
} from "./contrast";

const STYLES = Object.values(CAPTION_STYLES);

describe("relativeLuminance", () => {
  it("matches the WCAG reference points", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    /* Mid grey is NOT 0.5 luminance — the gamma expansion is the whole point
     * of using the published formula rather than averaging channels. */
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("refuses a colour it cannot measure", () => {
    expect(() => relativeLuminance("white")).toThrow(/six-digit hex/);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 at the extremes and symmetric", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 2);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });
});

describe("every shipped caption style", () => {
  it("ships at least the thirty styles the phase asks for", () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(STYLES.map((style) => [style.id, style] as const))(
    "%s is legible on light and on dark",
    (_id, style) => {
      const report = passesContrast(style);
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
    },
  );
});

describe("the check actually refuses something", () => {
  /* A test that only ever passes proves nothing about the checker. This is
   * the style somebody will write by accident: a pale fill, a pale outline,
   * invisible the moment the footage is bright. */
  const invisible = {
    ...getCaptionStyle(DEFAULT_CAPTION_STYLE_ID),
    id: "probe-invisible",
    fill: "#F2F2F2",
    highlight: "#FFFFFF",
    stroke: { width: 0.08, color: "#EEEEEE" },
  };

  it("fails a style with no dark outline over a light background", () => {
    const report = passesContrast(invisible);
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("light");
  });

  it("fails a style whose outline is too thin to carry it", () => {
    const hairline = {
      ...getCaptionStyle(DEFAULT_CAPTION_STYLE_ID),
      id: "probe-hairline",
      stroke: { width: 0.01, color: "#000000" },
    };
    const report = passesContrast(hairline);
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("too thin");
  });
});

describe("the library's own invariants", () => {
  it("has a unique id and name for every style", () => {
    const ids = new Set(STYLES.map((style) => style.id));
    const names = new Set(STYLES.map((style) => style.name));
    expect(ids.size).toBe(STYLES.length);
    expect(names.size).toBe(STYLES.length);
  });

  it("keeps the default style free, so a trial can keep what it sees", () => {
    expect(getCaptionStyle(DEFAULT_CAPTION_STYLE_ID).minPlan).toBe("free");
  });

  it("falls back rather than throwing on an unknown id", () => {
    expect(getCaptionStyle("no-such-style").id).toBe(DEFAULT_CAPTION_STYLE_ID);
  });

  it("offers free styles in every family, so no family is a pure teaser", () => {
    const families = new Map<string, boolean>();
    for (const style of STYLES) {
      families.set(
        style.family,
        (families.get(style.family) ?? false) || style.minPlan === "free",
      );
    }
    for (const [family, hasFree] of families) {
      expect(`${family}:${String(hasFree)}`).toBe(`${family}:true`);
    }
  });

  it("keeps every active word readable against its own resting text", () => {
    /* Not a WCAG rule — a product one. The highlight exists to be DISTINCT
     * from the words around it, and a highlight that matches the fill is a
     * karaoke style with no karaoke. Styles that deliberately highlight with
     * white-on-grey still clear this easily. */
    for (const style of STYLES) {
      if (style.highlight === style.fill && style.highlightBox === null) {
        expect(`${style.id} highlights with its own fill colour`).toBe("");
      }
    }
  });

  it("gives any boxed highlight enough contrast to read", () => {
    for (const style of STYLES) {
      if (style.highlightBox === null) continue;
      expect([
        style.id,
        contrastRatio(style.highlight, style.highlightBox) >= CONTRAST_TEXT_MIN,
      ]).toEqual([style.id, true]);
    }
  });
});
