/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: motion generator test, MOTION_SCENES_ARE_ALREADY_DESIGNED,
 *   A_MISSING_SCENE_IS_A_FALLBACK, SCENES_COVER_THE_NARRATION,
 *   NO_MODEL_INVOLVED, APPLYING_A_STYLE_WRITES_THE_PALETTE
 *
 * WHAT:  That a motion project builds a VALID document from stored beats, that
 *        a beat with no scene still draws something, and that the scenes line
 *        up with the narration.
 *
 * WHY:   NO_MODEL_INVOLVED is the phase's own Done-when line — "a hand-written
 *        three-scene document renders to MP4 with no model involved" — and
 *        this is the half of it a test can carry. The document is built from
 *        settings a human wrote, passed through `validate()`, and every scene
 *        in it is parsed back and checked by the engine. What remains after
 *        this is the MP4 itself, which needs R2 and the Lambda deploy.
 *
 *        The fallback assertion matters most. A design stage that was
 *        interrupted leaves beats with no scene, and the generator is the LAST
 *        place that could turn that into a video with holes in it. Here it is
 *        asserted that it does not.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { fromSceneSpec, checkScene } from "@/lib/scene";
import { validate } from "@/lib/timeline";
import type { WordToken } from "@/lib/timeline";
import { getMotionStyle } from "@/lib/motion-styles";
import { prisma } from "@/lib/config/prisma";

import { buildMotionDocument, readMotionSettings } from "./motion";
import type { GeneratorContext, NarrationLineInput } from "./types";

const WORDS: WordToken[] = Array.from({ length: 24 }, (_, i) => ({
  i,
  w: `word${i}`,
  s: i * 0.4,
  e: (i + 1) * 0.4,
}));

const LINES: NarrationLineInput[] = [
  {
    id: "line-1",
    position: 0,
    speakerTag: "narrator",
    text: WORDS.map((w) => w.w).join(" "),
    audioAssetId: "ast_line_1",
    durationSec: WORDS.length * 0.4,
    blockId: null,
  },
];

function context(settings: Record<string, unknown>): GeneratorContext {
  return {
    organizationId: "org_1",
    projectId: "proj_1",
    words: WORDS,
    lines: LINES,
    speakers: { narrator: "voice_1" },
    aspect: "9:16",
    settings,
    background: null,
    cast: {},
    visuals: {},
    thread: null,
    /* A motion generator never touches the database — it is pure, and the
     * scenes were designed and stored by an earlier stage. The context type
     * carries a client for the formats that do. */
    db: prisma,
  };
}

/* Three beats covering the transcript, two designed by hand and one left
 * without a scene — which is what an interrupted design stage looks like. */
const SETTINGS = {
  motion: {
    styleId: "boardroom",
    beats: [
      {
        index: 0,
        startWord: 0,
        endWord: 7,
        intent: "title",
        scene: {
          layout: "stack-center",
          elements: [
            { id: "a", kind: "title", text: "Three numbers" },
          ],
        },
      },
      {
        index: 1,
        startWord: 8,
        endWord: 15,
        intent: "stat",
        scene: {
          layout: "hero-plus-caption",
          elements: [
            { id: "b", kind: "counter", to: 41, suffix: "%" },
            { id: "c", kind: "callout", text: "never finish setup" },
          ],
        },
      },
      /* No scene — A_MISSING_SCENE_IS_A_FALLBACK. */
      { index: 2, startWord: 16, endWord: 23, intent: "emphasis" },
    ],
  },
  captions: { enabled: true, styleId: "clean-center" },
};

describe("the motion generator", () => {
  it("builds a document that validates", () => {
    const doc = buildMotionDocument(context(SETTINGS));
    const result = validate(doc);

    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(doc.kind).toBe("motion");
  });

  it("writes the style's palette and caption treatment into the document", () => {
    /* APPLYING_A_STYLE_WRITES_THE_PALETTE and STYLE_BELONGS_IN_THE_DOCUMENT —
     * a restyle has to change the hash, or Phase 04 serves the old render. */
    const style = getMotionStyle("boardroom");
    const doc = buildMotionDocument(context(SETTINGS));

    expect(doc.style.motionStyleId).toBe("boardroom");
    expect(doc.style.paletteId).toBe(style.paletteId);
    expect(doc.style.captionStyleId).toBe(style.captionTreatment);
  });

  it("gives every beat a scene item, including the one with no scene", () => {
    const doc = buildMotionDocument(context(SETTINGS));
    const track = doc.tracks.find((t) => t.type === "scene");
    const items = track?.type === "scene" ? track.items : [];

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.render).toBe("motion");
      expect(item.scene.elements.length).toBeGreaterThan(0);
    }
  });

  it("produces scenes the engine accepts, every one of them", () => {
    /* The round trip that matters: what the generator stored has to parse back
     * through the strict schema and pass the same checks the designer ran. */
    const doc = buildMotionDocument(context(SETTINGS));
    const track = doc.tracks.find((t) => t.type === "scene");
    const items = track?.type === "scene" ? track.items : [];

    for (const item of items) {
      const parsed = fromSceneSpec(item.scene);
      expect(parsed.ok ? [] : parsed.errors, item.id).toEqual([]);
      if (!parsed.ok) continue;

      const duration = typeof item.duration === "number" ? item.duration : 0;
      const result = checkScene(parsed.scene, {
        canvas: doc.canvas,
        safeZone: doc.style.safeZone,
        wordCount: doc.words.length,
        durationSeconds: duration,
      });
      expect(result.errors, item.id).toEqual([]);
    }
  });

  it("times each scene from the words its beat covers", () => {
    /* SCENES_COVER_THE_NARRATION — taken from the aligned words, so a
     * re-alignment moves the scenes with the audio. */
    const doc = buildMotionDocument(context(SETTINGS));
    const track = doc.tracks.find((t) => t.type === "scene");
    const items = track?.type === "scene" ? track.items : [];

    const first = items[0];
    expect(typeof first?.start === "number" ? first.start : -1).toBeCloseTo(
      WORDS[0]?.s ?? 0,
      5,
    );

    /* Contiguous: each beat starts where the previous ended, within a frame. */
    for (let i = 1; i < items.length; i += 1) {
      const previous = items[i - 1];
      const current = items[i];
      if (previous === undefined || current === undefined) continue;
      const prevStart = typeof previous.start === "number" ? previous.start : 0;
      const prevDur =
        typeof previous.duration === "number" ? previous.duration : 0;
      const start = typeof current.start === "number" ? current.start : 0;
      expect(start).toBeGreaterThanOrEqual(prevStart + prevDur - 0.05);
    }
  });

  it("builds a silent document when the design stage never ran", () => {
    /* A project whose design failed still produces a document — the pipeline
     * reports the failed STAGE; the generator makes the best document it can. */
    const doc = buildMotionDocument(context({ captions: { enabled: false } }));
    const result = validate(doc);

    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(doc.tracks.find((t) => t.type === "scene")).toBeUndefined();
  });

  it("drops a beat naming words the transcript no longer has", () => {
    /* A storyboard that no longer matches a re-aligned narration. Dropping the
     * beat is right: an item with a negative duration fails the whole
     * document rather than one beat. */
    const doc = buildMotionDocument(
      context({
        motion: {
          styleId: "studio",
          beats: [{ index: 0, startWord: 0, endWord: 999, intent: "emphasis" }],
        },
      }),
    );

    expect(validate(doc).ok).toBe(true);
    expect(doc.tracks.find((t) => t.type === "scene")).toBeUndefined();
  });

  it("falls back to the default style for an unknown id", () => {
    const doc = buildMotionDocument(
      context({ motion: { styleId: "no-such-style", beats: [] } }),
    );
    expect(doc.style.motionStyleId).toBe("studio");
  });
});

describe("reading the design stage's output", () => {
  it("returns nothing for settings that have never been written", () => {
    expect(readMotionSettings({})).toEqual({ styleId: undefined, beats: [] });
  });

  it("drops a stored scene that does not parse rather than failing", () => {
    /* The same gate `fromSceneSpec` is on the render side: a stored scene with
     * a coordinate in it, or an unknown primitive, must not reach a component. */
    const read = readMotionSettings({
      motion: {
        beats: [
          {
            index: 0,
            startWord: 0,
            endWord: 3,
            intent: "emphasis",
            scene: { layout: "mosaic", elements: [] },
          },
        ],
      },
    });

    /* The whole `motion` blob fails to parse, which is the conservative
     * outcome — a half-read storyboard would place some beats and not others. */
    expect(read.beats).toEqual([]);
  });
});
