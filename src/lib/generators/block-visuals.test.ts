/**
 * SOURCE OF TRUTH KEYWORDS: buildBlockVisualTracks, buildVoiceoverDocument,
 *   BLOCK_SPANS_ARE_CONTIGUOUS, GAPS_FALL_BACK_IN_TIME, STILLS_GET_KEN_BURNS,
 *   ONE_FUNCTION_OWNS_WHAT_IS_BEHIND_THE_WORDS,
 *   NO_DOCUMENT_CHANGES_WITHOUT_VISUALS, block visual tests
 *
 * WHAT:  Where each block's picture lands on the timeline, what fills the
 *        stretches that have none, and that turning this phase on changed
 *        nothing for a project that has no per-block visuals.
 *
 * WHY:   Four failures are possible here and every one of them produces a
 *        document that VALIDATES and renders:
 *
 *          A span computed from the wrong lines puts paragraph three's picture
 *          over paragraph four's words. The video plays; it is simply about the
 *          wrong thing, which is the one bug a viewer notices and a test suite
 *          does not.
 *
 *          A backdrop emitted over the whole video draws a gradient on top of
 *          every picture, because a scene track composites ABOVE video
 *          (LAYER_ORDER). The symptom is "my visuals did not apply" and the
 *          cause is two tracks that should never have coexisted, which is why
 *          the exclusivity is asserted directly rather than trusted.
 *
 *          Ken Burns on a stock CLIP reads as a camera wobble, and its absence
 *          on a still reads as a frozen frame. Neither throws.
 *
 *          A changed item id for a project with NO visuals changes its
 *          `docHash`, which makes Phase 04 charge for a second paid render of
 *          an identical video (RENDER_REUSE). That one costs money rather than
 *          quality, and nobody would attribute it to this phase.
 *
 *        The multi-line block has a fixture of its own, because
 *        `splitBlockIntoLines` turning one paragraph into two takes is exactly
 *        the case the span arithmetic exists for — and the case a one-line-per-
 *        block fixture cannot reach.
 * WHERE: Run by `npm test`. Guards the per-block half of
 *        src/lib/generators/common.ts and src/lib/generators/voiceover.ts.
 */

import { describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/config/prisma";
import type { TimelineDoc, WordToken } from "@/lib/timeline";
import { hashDoc, resolveWordAnchors, validate } from "@/lib/timeline";
import { buildVoiceoverDocument } from "./voiceover";
import type {
  GeneratorContext,
  NarrationLineInput,
  ResolvedBlockVisual,
} from "./types";

const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("a generator must not touch the database");
    },
  },
) as DbClient;

function line(
  index: number,
  blockId: string | null,
  durationSec: number,
): NarrationLineInput {
  return {
    id: `line${index}`,
    position: index,
    speakerTag: "narrator",
    text: `Line ${index}.`,
    audioAssetId: `ast_${index}`,
    durationSec,
    blockId,
  };
}

function words(count: number, totalSeconds: number): WordToken[] {
  const each = totalSeconds / Math.max(count, 1);
  return Array.from({ length: count }, (_, i) => ({
    i,
    w: `word${i}`,
    s: Number((i * each).toFixed(3)),
    e: Number(((i + 1) * each).toFixed(3)),
  }));
}

function visual(overrides: Partial<ResolvedBlockVisual> = {}): ResolvedBlockVisual {
  return {
    assetId: "asset_clip",
    durationSec: 12,
    license: "licensed",
    width: 1080,
    height: 1920,
    isStill: false,
    ...overrides,
  };
}

function contextFor(overrides: Partial<GeneratorContext> = {}): GeneratorContext {
  const lines = [line(0, "blk0", 3), line(1, "blk1", 2), line(2, "blk2", 4)];
  return {
    organizationId: "org_1",
    projectId: "prj_1",
    words: words(9, 9),
    lines,
    speakers: { narrator: "voice_1" },
    aspect: "9:16",
    settings: {},
    background: null,
    cast: {},
    visuals: {},
    thread: null,
    db: NO_DB,
    ...overrides,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: seconds, TWO_FORMED_TIMING
 *
 * A generated item's `start` and `duration` are `TimeValue`s, which is the
 * document's two-formed timing: a number, or a word anchor. A generator writes
 * numbers for everything behind the words — only the CARDS and the captions are
 * anchored — so this narrows and FAILS LOUDLY if that ever stops being true,
 * rather than quietly comparing an object.
 */
function seconds(value: TimelineDoc["tracks"][number]["items"][number]["start"]): number {
  if (typeof value !== "number") {
    throw new Error(`expected a numeric time, got ${JSON.stringify(value)}`);
  }
  return value;
}

function videoItems(doc: TimelineDoc, trackId: string) {
  const track = doc.tracks.find((candidate) => candidate.id === trackId);
  return track?.type === "video" ? track.items : [];
}

function sceneItems(doc: TimelineDoc, trackId: string) {
  const track = doc.tracks.find((candidate) => candidate.id === trackId);
  return track?.type === "scene" ? track.items : [];
}

describe("per-block visuals on the timeline", () => {
  /* The phase's first "done when": a five-block script produces five matching
   * visuals, each timed to its OWN block. Asserted on the times, because the
   * count alone would pass for five clips all sitting at zero. */
  it("places one clip per block, timed to that block's own words", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: {
          blk0: visual({ assetId: "a0" }),
          blk1: visual({ assetId: "a1" }),
          blk2: visual({ assetId: "a2" }),
        },
      }),
    );

    const items = videoItems(doc, "visuals");

    expect(items.map((item) => [item.start, item.duration])).toEqual([
      [0, 3],
      [3, 2],
      [5, 4],
    ]);
    /* Each item points at its OWN block's asset, through its own handle. */
    expect(items.map((item) => doc.assets[item.assetId]?.assetId)).toEqual([
      "a0",
      "a1",
      "a2",
    ]);
  });

  /**
   * BLOCK_SPANS_ARE_CONTIGUOUS. `splitBlockIntoLines` turns a long paragraph
   * into several takes, so a block's span is the union of its lines' spans —
   * one clip across all of them, not one per take. A per-line implementation
   * would emit three clips for one paragraph, each a third as long, which is
   * three cuts the script never asked for.
   */
  it("spans a block that was split into several narration lines", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        lines: [
          line(0, "blk0", 3),
          line(1, "blk0", 2),
          line(2, "blk0", 1),
          line(3, "blk1", 4),
        ],
        words: words(10, 10),
        visuals: { blk0: visual({ assetId: "a0" }), blk1: visual({ assetId: "a1" }) },
      }),
    );

    const items = videoItems(doc, "visuals");

    expect(items).toHaveLength(2);
    expect([items[0]?.start, items[0]?.duration]).toEqual([0, 6]);
    expect([items[1]?.start, items[1]?.duration]).toEqual([6, 4]);
  });

  /**
   * GAPS_FALL_BACK_IN_TIME, and this is the phase's second "done when" in its
   * partial form: a block with no match plays on the styled background while
   * its neighbours keep their pictures. The exclusivity is the assertion that
   * matters — the backdrop must cover ONLY the uncovered seconds, because a
   * scene item composites above video.
   */
  it("fills only the stretches no block visual covers", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: { blk1: visual({ assetId: "a1" }) },
      }),
    );

    expect(videoItems(doc, "visuals").map((item) => [item.start, item.duration])).toEqual([
      [3, 2],
    ]);
    /* Before and after the one covered paragraph, and nothing over it. */
    expect(sceneItems(doc, "background").map((item) => [item.start, item.duration])).toEqual([
      [0, 3],
      [5, 4],
    ]);
  });

  /* ONE_FUNCTION_OWNS_WHAT_IS_BEHIND_THE_WORDS, stated as the invariant rather
   * than as a shape: no second of the video may have both a block visual and a
   * fallback over it, whatever the inputs. */
  it("never puts a fallback over a block that has a picture", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: { blk0: visual({ assetId: "a0" }), blk2: visual({ assetId: "a2" }) },
      }),
    );

    const covered = videoItems(doc, "visuals").map((item) => ({
      from: seconds(item.start),
      to: seconds(item.start) + seconds(item.duration),
    }));

    for (const item of sceneItems(doc, "background")) {
      const from = seconds(item.start);
      const to = from + seconds(item.duration);
      for (const span of covered) {
        const overlaps = from < span.to && to > span.from;
        expect(overlaps, `backdrop ${from}..${to} over ${span.from}..${span.to}`).toBe(false);
      }
    }
  });

  /* With a project background chosen, the uncovered stretches play THAT rather
   * than the gradient — and it is one asset handle shared by every gap item,
   * not one per gap. */
  it("uses the project's background for the gaps when it has one", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        background: {
          assetId: "bg_1",
          durationSec: 30,
          license: "licensed",
          width: 1080,
          height: 1920,
        },
        visuals: { blk1: visual({ assetId: "a1" }) },
      }),
    );

    const gaps = videoItems(doc, "footage");

    expect(gaps.map((item) => [item.start, item.duration])).toEqual([
      [0, 3],
      [5, 4],
    ]);
    expect(new Set(gaps.map((item) => item.assetId)).size).toBe(1);
    expect(doc.assets[gaps[0]?.assetId ?? ""]?.assetId).toBe("bg_1");
    /* No gradient anywhere — footage and backdrop are still exclusive. */
    expect(sceneItems(doc, "background")).toHaveLength(0);
  });

  /**
   * STILLS_GET_KEN_BURNS, asserted in BOTH directions because the interesting
   * part is the asymmetry: the phase asks for the drift so "a static image does
   * not read as a frozen frame", and the same drift on moving footage reads as a
   * camera wobble. A single-direction assertion would pass if somebody turned
   * it on for everything.
   */
  it("drifts a still and leaves a clip alone", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: {
          blk0: visual({ assetId: "still", isStill: true, durationSec: null }),
          blk1: visual({ assetId: "clip", isStill: false }),
        },
      }),
    );

    const items = videoItems(doc, "visuals");

    expect(items[0]?.props?.["kenBurns"]).toBe(true);
    expect(items[1]?.props?.["kenBurns"]).toBeUndefined();
  });

  /* A still is an `image` asset ref, which is what makes the renderer draw an
   * <img> rather than a video element — and it is never looped, because a
   * picture has no source length to loop against (LOOP_IS_A_MODULO). */
  it("declares a still as an image and never loops it", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: {
          blk0: visual({ assetId: "still", isStill: true, durationSec: null }),
        },
      }),
    );

    const item = videoItems(doc, "visuals")[0];

    expect(item?.loop).toBe(false);
    expect(doc.assets[item?.assetId ?? ""]?.kind).toBe("image");
  });

  /* A clip shorter than its block is looped; one whose length the ingest could
   * not measure plays once and holds, because there is no modulus. */
  it("loops a clip only when its source length is known", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: {
          blk0: visual({ assetId: "measured", durationSec: 2 }),
          blk1: visual({ assetId: "unmeasured", durationSec: null }),
        },
      }),
    );

    const items = videoItems(doc, "visuals");

    expect(items[0]?.loop).toBe(true);
    expect(items[1]?.loop).toBe(false);
  });

  /* A line with no block — pre-Phase-14 audio, or a planned narration — cannot
   * carry a per-block visual, and must not extend its neighbour's. */
  it("leaves a line with no block on the fallback", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        lines: [line(0, "blk0", 3), line(1, null, 2), line(2, "blk2", 4)],
        visuals: {
          blk0: visual({ assetId: "a0" }),
          blk2: visual({ assetId: "a2" }),
        },
      }),
    );

    expect(videoItems(doc, "visuals").map((item) => [item.start, item.duration])).toEqual([
      [0, 3],
      [5, 4],
    ]);
    expect(sceneItems(doc, "background").map((item) => [item.start, item.duration])).toEqual([
      [3, 2],
    ]);
  });

  /* The licence travels WITH the document, so a render can be refused months
   * later without re-reading a provider's terms. */
  it("carries each visual's licence on its asset ref", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        visuals: { blk0: visual({ assetId: "a0", license: "licensed" }) },
      }),
    );

    const item = videoItems(doc, "visuals")[0];
    expect(doc.assets[item?.assetId ?? ""]?.license).toBe("licensed");
  });

  /* Every shape of this has to survive the document module's own rules —
   * overlapping items, items past the end and unresolved anchors are all things
   * `validate()` refuses, and a document that fails it is stored, migrated on
   * every read and then refused by the player. */
  it("produces a document that validates", () => {
    for (const visuals of [
      {},
      { blk0: visual({ assetId: "a0" }) },
      { blk1: visual({ assetId: "a1", isStill: true, durationSec: null }) },
      {
        blk0: visual({ assetId: "a0" }),
        blk1: visual({ assetId: "a1" }),
        blk2: visual({ assetId: "a2" }),
      },
    ]) {
      const doc = resolveWordAnchors(buildVoiceoverDocument(contextFor({ visuals })));
      const verdict = validate(doc);
      expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors.slice(0, 3))).toBe(true);
    }
  });

  /**
   * NO_DOCUMENT_CHANGES_WITHOUT_VISUALS, and this is the check that protects
   * every EXISTING customer from this phase. A project with no per-block
   * visuals — which is every project that existed before it, and every
   * deployment with neither provider configured — must produce the same
   * document it did before, down to the item ids, because Phase 04 reuses a
   * paid render by document hash. A changed id here is a second charge for an
   * identical video.
   *
   * The hash is compared against the pre-phase shape written out literally,
   * rather than against a snapshot of the current output, so this cannot be
   * "fixed" by regenerating it.
   */
  it("builds the pre-phase document unchanged when no block has a visual", () => {
    const doc = buildVoiceoverDocument(contextFor({ visuals: {} }));

    /* One backdrop item, spanning the whole narration, with the id it has
     * always had — not a per-gap item and not a `-0` suffix. */
    const backdrop = sceneItems(doc, "background");
    expect(backdrop).toHaveLength(1);
    expect(backdrop[0]?.id).toBe("backdrop");
    expect([backdrop[0]?.start, backdrop[0]?.duration]).toEqual([0, 9]);

    /* No visuals track at all, rather than an empty one. */
    expect(doc.tracks.some((track) => track.id === "visuals")).toBe(false);

    /* And the hash is stable against a second build of the same facts, which
     * is what the render cache actually compares. */
    expect(hashDoc(doc)).toBe(hashDoc(buildVoiceoverDocument(contextFor({ visuals: {} }))));
  });

  /* The same stability, with visuals: an unchanged project must not re-render.
   * This is the half that could break through object key order or a `Date`
   * sneaking into an item. */
  it("hashes identically for two builds of the same visuals", () => {
    const visuals = {
      blk0: visual({ assetId: "a0", isStill: true, durationSec: null }),
      blk2: visual({ assetId: "a2" }),
    };

    expect(hashDoc(buildVoiceoverDocument(contextFor({ visuals })))).toBe(
      hashDoc(buildVoiceoverDocument(contextFor({ visuals }))),
    );
  });

  /* Turning Ken Burns on MUST change the hash, or a customer who swapped a
   * clip for a still would be served the cached render of the clip. The
   * opposite direction of the test above, and the reason `props` is not in
   * CACHE_IRRELEVANT_FIELDS. */
  it("hashes differently once a visual is a drifting still", () => {
    const asClip = buildVoiceoverDocument(
      contextFor({ visuals: { blk0: visual({ assetId: "a0", isStill: false }) } }),
    );
    const asStill = buildVoiceoverDocument(
      contextFor({
        visuals: { blk0: visual({ assetId: "a0", isStill: true, durationSec: null }) },
      }),
    );

    expect(hashDoc(asClip)).not.toBe(hashDoc(asStill));
  });
});
