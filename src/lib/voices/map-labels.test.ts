/**
 * SOURCE OF TRUTH KEYWORDS: mapProviderLabels, LOSSY_BY_DESIGN, OTHER_IS_HONEST,
 *   CATALOGUE_SYNC, label mapping tests
 *
 * WHAT:  Whether a provider's free-text labels become the right filter values.
 *
 * WHY:   This is the only part of the catalogue sync testable without a
 *        provider key, and it is also the part most likely to be quietly
 *        wrong: a mislabelled voice is not an error, it is a customer
 *        filtering for "British", getting a result, and hearing something
 *        else. The substring ordering is the specific hazard — "female"
 *        contains "male", and "african american" contains "american" — so
 *        those are asserted directly rather than left to inspection.
 * WHERE: Run by `npm test`. Guards src/lib/voices/map-labels.ts.
 */

import { describe, expect, it } from "vitest";

import { mapProviderLabels } from "./map-labels";

describe("mapProviderLabels", () => {
  it("reads a well-formed label set", () => {
    expect(
      mapProviderLabels({
        gender: "female",
        accent: "british",
        description: "warm",
      }),
    ).toEqual({ gender: "female", accent: "british", tone: "warm" });
  });

  /**
   * The substring trap. "female" contains "male", so a mapper that checks
   * male first labels every woman in the catalogue as a man.
   */
  it("does not read 'female' as 'male'", () => {
    expect(mapProviderLabels({ gender: "female" }).gender).toBe("female");
    expect(mapProviderLabels({ gender: "male" }).gender).toBe("male");
  });

  /**
   * The other substring trap, and the one that is actively offensive to get
   * wrong: "african american" contains "american".
   */
  it("does not read 'african american' as plain American", () => {
    expect(
      mapProviderLabels({ accent: "african american" }).accent,
    ).toBe("african");
  });

  it("finds a term wherever the provider happened to put it", () => {
    /* Providers move this between `accent`, `description` and `use_case`
     * depending on who entered it. Keying on one field means a catalogue that
     * maps correctly today and silently stops on the next reorganisation. */
    expect(mapProviderLabels({ description: "a calm irish voice" })).toEqual({
      gender: "neutral",
      accent: "irish",
      tone: "calm",
    });
    expect(mapProviderLabels({ use_case: "news", accent: "" }).tone).toBe(
      "authoritative",
    );
  });

  it("maps regional variants onto the coarse axes", () => {
    expect(mapProviderLabels({ accent: "Scottish" }).accent).toBe("british");
    expect(
      mapProviderLabels({ accent: "Received Pronunciation" }).accent,
    ).toBe("british");
    expect(mapProviderLabels({ accent: "New Zealand" }).accent).toBe(
      "australian",
    );
    expect(mapProviderLabels({ accent: "Canadian" }).accent).toBe("american");
    expect(mapProviderLabels({ accent: "Swedish" }).accent).toBe("european");
  });

  it("is case-insensitive, because provider casing is inconsistent", () => {
    expect(mapProviderLabels({ accent: "BRITISH" }).accent).toBe("british");
    expect(mapProviderLabels({ gender: "FeMale" }).gender).toBe("female");
  });

  /**
   * OTHER_IS_HONEST. An unmatched label must NOT be guessed into a plausible
   * option — a voice wrongly labelled `british` is worse than one labelled
   * `other`, because the first is invisible until somebody hears it.
   */
  it("falls back honestly rather than guessing", () => {
    const mapped = mapProviderLabels({ accent: "Martian", gender: "???" });
    expect(mapped.accent).toBe("other");
    expect(mapped.gender).toBe("neutral");
  });

  it("handles an empty label set without throwing", () => {
    expect(() => mapProviderLabels({})).not.toThrow();
    const mapped = mapProviderLabels({});
    expect(mapped.accent).toBe("other");
    expect(mapped.gender).toBe("neutral");
    /* The least committal tone, not `other` — there is no `other` tone, and a
     * voice wrongly called conversational is unremarkable where one wrongly
     * called dramatic is misleading. */
    expect(mapped.tone).toBe("conversational");
  });

  it("always returns values inside the closed unions", () => {
    /* A value outside these would be written to the column and then fail
     * every filter silently — the picker would show a voice that no filter
     * can find. */
    const genders = ["female", "male", "neutral"];
    const accents = [
      "american",
      "british",
      "australian",
      "irish",
      "indian",
      "african",
      "european",
      "other",
    ];
    const tones = [
      "warm",
      "energetic",
      "calm",
      "authoritative",
      "dramatic",
      "conversational",
    ];

    for (const labels of [
      {},
      { gender: "unknown" },
      { accent: "somewhere" },
      { description: "a voice" },
      { a: "b", c: "d" },
    ]) {
      const mapped = mapProviderLabels(labels);
      expect(genders, JSON.stringify(labels)).toContain(mapped.gender);
      expect(accents, JSON.stringify(labels)).toContain(mapped.accent);
      expect(tones, JSON.stringify(labels)).toContain(mapped.tone);
    }
  });
});
