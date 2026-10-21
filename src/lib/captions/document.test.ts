/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: caption document test, buildCaptionTrack, validate,
 *   resolveWordAnchors, DEGRADE_NEVER_FAIL, RESTYLING_IS_FREE,
 *   A_DEGRADED_DOCUMENT_STILL_RENDERS
 *
 * WHAT:  The captions this phase produces, checked against the DOCUMENT rules
 *        rather than against themselves: a built track has to validate, and a
 *        degraded alignment has to produce a document that still renders.
 *
 * WHY:   Every other test here checks the caption library in isolation, which
 *        would pass happily while producing a track `validate()` rejects —
 *        and the symptom of that is a project that cannot be opened at all,
 *        not a caption that looks wrong. This is the seam between Phase 08
 *        and Phase 01, and it is exactly the seam a unit test per module
 *        cannot see.
 *
 *        A_DEGRADED_DOCUMENT_STILL_RENDERS is the phase's own check, minus
 *        the provider: force the degrade path, build the captions from what
 *        it produced, and prove the document is valid and resolvable. The
 *        half that needs a real STT failure is noted in PROGRESS.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { distributeEvenly } from "@/lib/alignment";
import {
  resolveWordAnchors,
  validate,
  type TimelineDoc,
} from "@/lib/timeline";
import { voiceoverFixture } from "@/lib/timeline/fixtures";
import { buildCaptionTrack, CAPTION_TRACK_ID } from "./build-track";
import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE_ID } from "./styles";

function withCaptions(doc: TimelineDoc, styleId: string): TimelineDoc {
  return {
    ...doc,
    style: { ...doc.style, captionStyleId: styleId },
    tracks: [
      ...doc.tracks.filter(
        (track) => !(track.type === "caption" && track.id === CAPTION_TRACK_ID),
      ),
      buildCaptionTrack(doc.words, styleId),
    ],
  };
}

describe("a document with captions built by this phase", () => {
  it("validates in every style in the library", () => {
    const base = voiceoverFixture();

    for (const style of Object.values(CAPTION_STYLES)) {
      const result = validate(withCaptions(base, style.id));
      expect([style.id, result.ok]).toEqual([style.id, true]);
    }
  });

  it("resolves its anchors, and the caption times come from the words", () => {
    const doc = withCaptions(voiceoverFixture(), DEFAULT_CAPTION_STYLE_ID);
    const resolved = resolveWordAnchors(doc);

    expect(validate(resolved).ok).toBe(true);

    const captions = resolved.tracks.find((track) => track.type === "caption");
    expect(captions?.type).toBe("caption");
    if (captions?.type !== "caption") return;

    for (const item of captions.items) {
      /* resolveWordAnchors writes the derived cache — and validate() has just
       * agreed it matches the word range, which is the property that makes a
       * restyle safe. */
      expect(typeof item.start).toBe("number");
      expect(typeof item.duration).toBe("number");
    }
  });

  /**
   * SOURCE OF TRUTH KEYWORDS: RESTYLING_IS_FREE
   */
  it("produces the same caption times whichever style is applied", () => {
    const base = voiceoverFixture();

    const times = Object.values(CAPTION_STYLES).map((style) => {
      const resolved = resolveWordAnchors(withCaptions(base, style.id));
      const track = resolved.tracks.find((item) => item.type === "caption");
      if (track?.type !== "caption") return [];
      return track.items.map((item) => `${item.startWord}:${item.endWord}`);
    });

    /* Styles differ in `maxWords`, so the GROUPING differs — what must not
     * differ is the mapping from a group to its seconds, which is checked by
     * every group's range resolving to its own words' times above. Here the
     * invariant is narrower and stronger: two styles with the SAME maxWords
     * produce byte-identical ranges. */
    const byMaxWords = new Map<number, string[]>();
    for (const [index, style] of Object.values(CAPTION_STYLES).entries()) {
      const existing = byMaxWords.get(style.maxWords);
      const current = times[index] ?? [];
      if (existing === undefined) {
        byMaxWords.set(style.maxWords, current);
        continue;
      }
      expect([style.id, current]).toEqual([style.id, existing]);
    }
  });

  /**
   * SOURCE OF TRUTH KEYWORDS: DEGRADE_NEVER_FAIL,
   *   A_DEGRADED_DOCUMENT_STILL_RENDERS
   */
  it("still produces a valid, renderable document from a degraded alignment", () => {
    const base = voiceoverFixture();
    /* The degrade path, with no provider involved: the words spread evenly
     * across the narration.s MEASURED duration — which is the same duration
     * the real degrade path is given, and the reason a degraded document
     * still fits inside its own video. */
    const measured = base.words[base.words.length - 1]?.e ?? 0;
    const words = distributeEvenly(
      base.words.map((word) => word.w).join(" "),
      measured,
    );

    const doc = withCaptions({ ...base, words }, DEFAULT_CAPTION_STYLE_ID);
    const result = validate(doc);
    expect(result.ok ? [] : result.errors).toEqual([]);

    const resolved = resolveWordAnchors(doc);
    expect(validate(resolved).ok).toBe(true);

    const captions = resolved.tracks.find((track) => track.type === "caption");
    if (captions?.type !== "caption") throw new Error("no caption track");
    expect(captions.items.length).toBeGreaterThan(0);
  });

  it("removes the old caption track rather than stacking a second one", () => {
    const once = withCaptions(voiceoverFixture(), DEFAULT_CAPTION_STYLE_ID);
    const twice = withCaptions(once, "clean-lower");

    const captionTracks = twice.tracks.filter(
      (track) => track.type === "caption",
    );
    expect(captionTracks).toHaveLength(1);
    expect(captionTracks[0]?.type === "caption" ? captionTracks[0].styleId : null).toBe(
      "clean-lower",
    );
  });
});
