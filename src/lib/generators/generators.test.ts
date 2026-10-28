/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: generators test, NARRATION_IS_SEQUENTIAL,
 *   MUSIC_IS_OPTIONAL, DUCK_IS_A_REQUEST, EMPTY_WORDS_STILL_BUILDS,
 *   GENERATED_DOC_IS_ANCHORED, DOCUMENT_VALIDATES, OFFSETS_MATCH_ALIGNMENT,
 *   DOCUMENTED_GAP_NOT_A_STUB
 *
 * WHAT:  The voiceover generator's output, asserted against the timeline
 *        module's OWN validator rather than against a snapshot — plus the two
 *        agreements it has to keep with other modules: the line offsets Phase
 *        08 computed, and the renderer's idea of what ducks what.
 *
 * WHY:   A generator is the one part of the pipeline that is pure, so it is the
 *        part that can be tested completely without a database, a provider or a
 *        credential — which matters because every provider in this phase's
 *        chain is currently unconfigured. What these tests prove is everything
 *        the shape of the document is responsible for.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { concatAlignedLines } from "@/lib/alignment";
import { BACKDROP_ELEMENT_KIND } from "@/lib/palettes";
import { resolveWordAnchors, validate, type WordToken } from "@/lib/timeline";
import type { DbClient } from "@/lib/config/prisma";
import { GENERATORS, hasGenerator, resolveGenerator } from "./registry";
import { GeneratorNotImplementedError, type GeneratorContext, type NarrationLineInput } from "./types";
import { buildRedditStoryDocument } from "./reddit-story";
import { buildVoiceoverDocument } from "./voiceover";

/* The generator never touches it — BUILD_IS_THE_WHOLE_CONTRACT — so the test
 * does not need a database to prove that. If a generator ever reaches for this,
 * the test fails loudly rather than silently connecting to something. */
const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("a generator must not touch the database");
    },
  },
) as DbClient;

function lines(durations: readonly number[]): NarrationLineInput[] {
  return durations.map((durationSec, index) => ({
    id: `line${index}`,
    position: index,
    speakerTag: index % 2 === 0 ? "N" : "A",
    text: `Line number ${index}.`,
    audioAssetId: `ast_${index}`,
    durationSec,
  }));
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

function contextFor(
  overrides: Partial<GeneratorContext> = {},
): GeneratorContext {
  return {
    organizationId: "org_1",
    projectId: "prj_1",
    words: words(12, 9),
    lines: lines([3, 2.5, 3.5]),
    speakers: { N: "voice_n", A: "voice_a" },
    aspect: "9:16",
    settings: {},
    /* Phase 11: the DEFAULT case is still the styled backdrop, because the
     * shipped catalogue is empty (MANIFEST_IS_EMPTY_ON_PURPOSE) and because a
     * generator has to build a complete video without footage. The tests that
     * care pass one in. */
    background: null,
    /* Phase 12: no faces and no thread by default — a voiceover has neither,
     * and the Reddit tests pass both in. */
    cast: {},
    thread: null,
    db: NO_DB,
    ...overrides,
  };
}

describe("buildVoiceoverDocument", () => {
  it("produces a document the timeline module accepts", () => {
    const doc = buildVoiceoverDocument(contextFor());
    const verdict = validate(doc);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  it("is still valid once its anchors are resolved", () => {
    /* GENERATED_DOC_IS_ANCHORED — the document leaves the generator anchored,
     * and the player resolves it. Both forms have to validate or the preview
     * refuses a document the generator considered finished. */
    const doc = buildVoiceoverDocument(contextFor());
    expect(doc.timing).toBe("anchored");

    const resolved = resolveWordAnchors(doc);
    expect(resolved.timing).toBe("resolved");
    const verdict = validate(resolved);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  it("lays narration end to end with no gaps", () => {
    const durations = [3, 2.5, 3.5];
    const doc = buildVoiceoverDocument(contextFor({ lines: lines(durations) }));
    const narration = doc.tracks.find((track) => track.id === "narration");

    expect(narration?.type).toBe("audio");
    const items = narration?.type === "audio" ? narration.items : [];
    expect(items.map((item) => item.start)).toEqual([0, 3, 5.5]);
    expect(items.map((item) => item.duration)).toEqual(durations);
  });

  /**
   * OFFSETS_MATCH_ALIGNMENT — the agreement this phase could most easily get
   * wrong. Phase 08 built ONE narration-wide word array by offsetting each
   * line by the sum of the durations before it; this generator positions each
   * audio item the same way. If the two ever disagree, captions drift further
   * out of sync with every line and nothing in either module notices.
   */
  it("positions audio items exactly where the aligner offset their words", () => {
    const durations = [3, 2.5, 3.5];
    const perLine = durations.map((duration) => words(3, duration));

    let offsetSec = 0;
    const stitched = concatAlignedLines(
      perLine.map((lineWords, index) => {
        const entry = {
          words: lineWords,
          offsetSec,
          speaker: index % 2 === 0 ? "N" : "A",
        };
        offsetSec += durations[index] ?? 0;
        return entry;
      }),
    );

    const doc = buildVoiceoverDocument(
      contextFor({ lines: lines(durations), words: stitched }),
    );
    const narration = doc.tracks.find((track) => track.id === "narration");
    const items = narration?.type === "audio" ? narration.items : [];

    /* Each line's FIRST stitched word starts where its audio item starts. */
    for (const [index, item] of items.entries()) {
      const firstWordOfLine = perLine
        .slice(0, index)
        .reduce((total, lineWords) => total + lineWords.length, 0);
      expect(stitched[firstWordOfLine]?.s).toBeCloseTo(Number(item.start), 3);
    }
  });

  it("spans the backdrop across the whole narration in the chosen palette", () => {
    const doc = buildVoiceoverDocument(
      contextFor({ settings: { generate: { paletteId: "noir" } } }),
    );
    const background = doc.tracks.find((track) => track.id === "background");
    expect(background?.type).toBe("scene");

    const item = background?.type === "scene" ? background.items[0] : undefined;
    expect(item?.render).toBe("backdrop");
    expect(item?.start).toBe(0);
    expect(item?.duration).toBe(9);
    /* PALETTE_IS_BAKED_ONTO_THE_ITEM — the component cannot read the document's
     * style block, so the id has to be on the element the component looks for
     * BY KIND. */
    const fill = item?.scene.elements.find(
      (element) => element.kind === BACKDROP_ELEMENT_KIND,
    );
    expect(fill?.props?.["paletteId"]).toBe("noir");
    expect(doc.style.paletteId).toBe("noir");
  });

  /* MUSIC_IS_OPTIONAL — there is no music library until Phase 11, and a music
   * item pointing at nothing would claim a bed the video does not have. */
  it("omits the music track when no bed is chosen", () => {
    const doc = buildVoiceoverDocument(contextFor());
    expect(doc.tracks.some((track) => track.id === "music")).toBe(false);
    expect(doc.assets["music_bed"]).toBeUndefined();
  });

  /* DUCK_IS_A_REQUEST, and NARRATION_IS_A_SPEAKER on the other side of it: the
   * renderer decides what ducks against what by looking for a `speaker`, so a
   * narration item without one leaves the bed at full volume under the voice. */
  it("asks for ducking on the bed and names a speaker on every narration line", () => {
    const doc = buildVoiceoverDocument(
      contextFor({ settings: { generate: { musicAssetId: "ast_music" } } }),
    );

    const music = doc.tracks.find((track) => track.id === "music");
    const bed = music?.type === "audio" ? music.items[0] : undefined;
    expect(bed?.duck).toBe(true);
    expect(bed?.loop).toBe(true);
    expect(bed?.speaker).toBeUndefined();
    expect(doc.assets["music_bed"]?.assetId).toBe("ast_music");

    const narration = doc.tracks.find((track) => track.id === "narration");
    const items = narration?.type === "audio" ? narration.items : [];
    expect(items.every((item) => item.speaker !== undefined)).toBe(true);
    expect(items.every((item) => item.duck === false)).toBe(true);
  });

  /* EMPTY_WORDS_STILL_BUILDS — the phase's "with STT disabled the video still
   * completes with degraded captions". With NO words at all, it still has to
   * complete. */
  it("builds a playable document with no aligned words", () => {
    const doc = buildVoiceoverDocument(contextFor({ words: [] }));

    expect(doc.tracks.some((track) => track.type === "caption")).toBe(false);
    expect(doc.tracks.some((track) => track.id === "narration")).toBe(true);
    const verdict = validate(doc);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  it("builds a caption track when words exist", () => {
    const doc = buildVoiceoverDocument(contextFor());
    const captions = doc.tracks.find((track) => track.type === "caption");
    expect(captions?.type === "caption" ? captions.items.length : 0).toBeGreaterThan(0);
  });

  it("drops the caption track when the project turned captions off", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        settings: {
          captions: {
            styleId: "bold-pop",
            position: "bottom",
            wordsPerChunk: 3,
            enabled: false,
          },
        },
      }),
    );
    expect(doc.tracks.some((track) => track.type === "caption")).toBe(false);
  });

  it("declares an asset for every narration line and nothing else", () => {
    const doc = buildVoiceoverDocument(contextFor());
    expect(Object.keys(doc.assets).sort()).toEqual([
      "narration_line0",
      "narration_line1",
      "narration_line2",
    ]);
    /* URL_NEVER_IN_THE_DOCUMENT — a document holds asset IDS and licences. */
    expect(
      Object.values(doc.assets).every((asset) => !("url" in asset)),
    ).toBe(true);
  });

  it("keeps a cast member with no line and no voice", () => {
    const doc = buildVoiceoverDocument(
      contextFor({ speakers: { N: "voice_n", A: null, Q: null } }),
    );
    expect(Object.keys(doc.speakers).sort()).toEqual(["A", "N", "Q"]);
    expect(doc.speakers["Q"]).toEqual({});
    expect(doc.speakers["N"]).toEqual({ voiceId: "voice_n" });
  });

  it("takes its canvas from the project's aspect", () => {
    expect(buildVoiceoverDocument(contextFor({ aspect: "9:16" })).canvas).toEqual(
      { width: 1080, height: 1920, fps: 30 },
    );
    const square = buildVoiceoverDocument(contextFor({ aspect: "1:1" }));
    expect(square.canvas).toEqual({ width: 1080, height: 1080, fps: 30 });
    /* SAFE_ZONE_BY_ASPECT — a square export is not going into a vertical feed,
     * so clamping captions away from controls that are not there would waste a
     * sixth of the frame. */
    expect(square.style.safeZone).toBe("none");
  });

  it("falls back to the default palette and caption style on malformed settings", () => {
    const doc = buildVoiceoverDocument(
      contextFor({ settings: { generate: { paletteId: 42 }, captions: "nope" } }),
    );
    expect(doc.style.paletteId).toBe("default");
    expect(validate(doc).ok).toBe(true);
  });

  it("produces nothing but an empty document when there are no lines", () => {
    const doc = buildVoiceoverDocument(contextFor({ lines: [], words: [] }));
    expect(doc.tracks).toEqual([]);
    expect(validate(doc).ok).toBe(true);
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: background tests, FOOTAGE_OR_BACKDROP_NEVER_BOTH,
 *   LOOP_TO_THE_NARRATION, BACKGROUND_IS_A_FACT
 *
 * Phase 11. The background is resolved BEFORE the generator runs
 * (RESOLVED_BEFORE_THE_GENERATOR), so these tests hand one in rather than
 * standing up a library — which is the property worth having: the document
 * build stays provable with no database at all.
 */
describe("buildVoiceoverDocument with a background", () => {
  const FOOTAGE = {
    assetId: "ast_loop",
    durationSec: 4,
    license: "licensed" as const,
    width: 1080,
    height: 1920,
  };

  it("produces a document the timeline module still accepts", () => {
    const doc = buildVoiceoverDocument(contextFor({ background: FOOTAGE }));
    const verdict = validate(doc);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  /* FOOTAGE_OR_BACKDROP_NEVER_BOTH. A backdrop on the scene track composites
   * ABOVE a video item, so keeping both would draw a gradient over the footage
   * the customer chose — and the bug would read as "my background did not
   * apply". */
  it("replaces the backdrop rather than layering over it", () => {
    const doc = buildVoiceoverDocument(contextFor({ background: FOOTAGE }));
    expect(doc.tracks.some((track) => track.id === "background")).toBe(false);

    const footage = doc.tracks.find((track) => track.id === "footage");
    expect(footage?.type).toBe("video");
  });

  /* LOOP_TO_THE_NARRATION — the item spans the whole narration and asks to be
   * looped; the repetition itself is the renderer's
   * (LOOP_VIA_REMOTION_LOOP). */
  it("spans the narration, loops, and stays muted", () => {
    const doc = buildVoiceoverDocument(contextFor({ background: FOOTAGE }));
    const footage = doc.tracks.find((track) => track.id === "footage");
    const item = footage?.type === "video" ? footage.items[0] : undefined;

    expect(item?.start).toBe(0);
    /* The lines are 3 + 2.5 + 3.5; a 4-second clip has to repeat. */
    expect(item?.duration).toBe(9);
    expect(item?.loop).toBe(true);
    expect(item?.muted).toBe(true);
    /* CROP_AT_TRANSCODE — the ingest already produced a 9:16 master, so there
     * is no geometry here. */
    expect(item?.fit).toBe("cover");
  });

  /* The loop divides by the source length, so without one there is nothing to
   * divide by (LOOP_IS_A_MODULO). A clip that holds on its last frame is
   * honest; a loop with no modulus is a division by zero. */
  it("does not ask to loop a clip whose length was never measured", () => {
    const doc = buildVoiceoverDocument(
      contextFor({ background: { ...FOOTAGE, durationSec: null } }),
    );
    const footage = doc.tracks.find((track) => track.id === "footage");
    const item = footage?.type === "video" ? footage.items[0] : undefined;

    expect(item?.loop).toBe(false);
    expect(doc.assets["background"]?.durationInSeconds).toBeUndefined();
  });

  it("carries the licence and the asset id, and no URL", () => {
    const doc = buildVoiceoverDocument(contextFor({ background: FOOTAGE }));
    const ref = doc.assets["background"];

    expect(ref?.assetId).toBe("ast_loop");
    expect(ref?.kind).toBe("video");
    /* The licence travels WITH the document so a render can be refused months
     * later without re-reading anybody's terms. */
    expect(ref?.license).toBe("licensed");
    expect(ref?.durationInSeconds).toBe(4);
    expect(ref !== undefined && "url" in ref).toBe(false);
  });

  /* A background and a music bed are independent choices on independent
   * tracks; picking footage must not silently drop the bed. */
  it("keeps the music bed alongside the footage", () => {
    const doc = buildVoiceoverDocument(
      contextFor({
        background: FOOTAGE,
        settings: { generate: { musicAssetId: "ast_music" } },
      }),
    );
    expect(doc.tracks.some((track) => track.id === "footage")).toBe(true);
    expect(doc.tracks.some((track) => track.id === "music")).toBe(true);
  });

  /* An empty run must emit no background at all rather than a zero-length one,
   * which `validate()` refuses — the same rule the backdrop already follows. */
  it("emits no footage when there is no narration", () => {
    const doc = buildVoiceoverDocument(
      contextFor({ background: FOOTAGE, lines: [], words: [] }),
    );
    expect(doc.tracks).toHaveLength(0);
    expect(doc.assets["background"]).toBeUndefined();
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: reddit-story tests, CARD_THEN_STORY,
 *   ONE_OVERLAY_PER_SPEAKER_RUN, CAST_IS_A_FACT, FOOTAGE_OR_BACKDROP_NEVER_BOTH
 *
 * Phase 12. The cast and the thread arrive as FACTS on the context
 * (RESOLVED_BEFORE_THE_GENERATOR), so the whole format is provable with no
 * database — which is the property that matters here: a Reddit video is the
 * most assembled thing this product makes, and every piece of it is checked
 * without a key, a row or a provider.
 */
describe("buildRedditStoryDocument", () => {
  const CAST = {
    op: {
      avatarId: "avt-sam",
      states: { neutral: "a1", talking: "a2", reaction: "a3" },
    },
    commenter: {
      avatarId: "avt-rae",
      states: { neutral: "b1", talking: "b2", reaction: "b3" },
    },
  };

  const THREAD = {
    title: "My roommate ate my leftovers",
    subreddit: "tifu",
    author: "someone",
  };

  function redditContext(
    overrides: Partial<GeneratorContext> = {},
  ): GeneratorContext {
    return contextFor({
      /* The aligned words have to COVER the narration and no more — Phase 08
       * produces exactly that, and a fixture where they disagree would fail
       *  for a reason that has nothing to do with this format. */
      words: words(12, 7),
      lines: [
        {
          id: "l0",
          position: 0,
          speakerTag: "op",
          text: "First.",
          audioAssetId: "ast_0",
          durationSec: 4,
        },
        {
          id: "l1",
          position: 1,
          speakerTag: "commenter",
          text: "Second.",
          audioAssetId: "ast_1",
          durationSec: 3,
        },
      ],
      speakers: { op: "voice_a", commenter: "voice_b" },
      cast: CAST,
      thread: THREAD,
      ...overrides,
    });
  }

  it("produces a document the timeline module accepts", () => {
    const doc = buildRedditStoryDocument(redditContext());
    const verdict = validate(doc);
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  it("is still valid once its anchors are resolved", () => {
    const verdict = validate(
      resolveWordAnchors(buildRedditStoryDocument(redditContext())),
    );
    expect(verdict.ok, JSON.stringify(verdict.ok ? [] : verdict.errors)).toBe(
      true,
    );
  });

  it("declares itself a reddit-story", () => {
    expect(buildRedditStoryDocument(redditContext()).kind).toBe("reddit-story");
  });

  /* CARD_THEN_STORY — the card is at the FRONT and the narration starts under
   * it, because a silent hold at the front of a video is where a viewer
   * leaves. */
  it("puts the title card first and lets the narration run under it", () => {
    const doc = buildRedditStoryDocument(redditContext());
    const card = doc.tracks.find((track) => track.id === "reddit-card");
    const item = card?.type === "scene" ? card.items[0] : undefined;

    expect(item?.render).toBe("redditCard");
    expect(item?.start).toBe(0);
    /* Capped by CARD_SECONDS, not by the video's length (7s here). */
    expect(item?.duration).toBe(4);

    const narration = doc.tracks.find((track) => track.id === "narration");
    const firstLine =
      narration?.type === "audio" ? narration.items[0] : undefined;
    expect(firstLine?.start).toBe(0);
  });

  it("shows the thread title, subreddit and author on the card", () => {
    const doc = buildRedditStoryDocument(redditContext());
    const card = doc.tracks.find((track) => track.id === "reddit-card");
    const element =
      card?.type === "scene" ? card.items[0]?.scene.elements[0] : undefined;

    expect(element?.text).toBe(THREAD.title);
    expect(element?.props?.["subreddit"]).toBe("tifu");
    expect(element?.props?.["author"]).toBe("someone");
  });

  /* A card never longer than the video — an overhanging item is one
   * `validate()` refuses. */
  it("caps the card at the length of the video", () => {
    const doc = buildRedditStoryDocument(
      redditContext({
        words: words(4, 1.5),
        lines: [
          {
            id: "l0",
            position: 0,
            speakerTag: "op",
            text: "Short.",
            audioAssetId: "ast_0",
            durationSec: 1.5,
          },
        ],
      }),
    );
    const card = doc.tracks.find((track) => track.id === "reddit-card");
    const item = card?.type === "scene" ? card.items[0] : undefined;
    expect(item?.duration).toBe(1.5);
  });

  it("emits no card when the thread snapshot is gone", () => {
    const doc = buildRedditStoryDocument(redditContext({ thread: null }));
    expect(doc.tracks.some((track) => track.id === "reddit-card")).toBe(false);
    /* And the story still renders, which is what makes the retention sweep
     * survivable rather than destructive. */
    expect(validate(doc).ok).toBe(true);
  });

  /* ONE_OVERLAY_PER_SPEAKER_RUN, and AVATAR_Z_IS_STABLE with it. */
  it("gives each speaker run one overlay at one shared depth", () => {
    const doc = buildRedditStoryDocument(redditContext());
    const overlays = doc.tracks.find((track) => track.id === "avatars");
    const items = overlays?.type === "overlay" ? overlays.items : [];

    expect(items).toHaveLength(2);
    expect(items[0]?.render).toBe("characterOverlay");
    expect(new Set(items.map((item) => item.z)).size).toBe(1);

    /* Non-overlapping, which is what makes one shared depth safe — the schema
     * refuses two overlays sharing a depth while both are on screen. */
    const first = items[0];
    const second = items[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(Number(first.start) + Number(first.duration)).toBeCloseTo(
      Number(second.start),
      6,
    );
  });

  it("declares three artwork handles per avatar and no more", () => {
    const doc = buildRedditStoryDocument(redditContext());
    const avatarHandles = Object.keys(doc.assets).filter((key) =>
      key.startsWith("avatar_"),
    );
    expect(avatarHandles.sort()).toEqual([
      "avatar_avt-rae_neutral",
      "avatar_avt-rae_reaction",
      "avatar_avt-rae_talking",
      "avatar_avt-sam_neutral",
      "avatar_avt-sam_reaction",
      "avatar_avt-sam_talking",
    ]);
    /* URL_NEVER_IN_THE_DOCUMENT. */
    expect(Object.values(doc.assets).every((asset) => !("url" in asset))).toBe(
      true,
    );
  });

  /* The same character used by two speakers declares ONE set of handles —
   * which is what deriving the handle from the AVATAR rather than the speaker
   * buys. */
  it("declares one set of handles for a character used twice", () => {
    const doc = buildRedditStoryDocument(
      redditContext({ cast: { op: CAST.op, commenter: CAST.op } }),
    );
    expect(
      Object.keys(doc.assets).filter((key) => key.startsWith("avatar_")),
    ).toHaveLength(3);
  });

  /* UNASSIGNED_IS_NOT_AN_ERROR — a narrator who is never on screen. */
  it("emits no overlay for a speaker with no face", () => {
    const doc = buildRedditStoryDocument(redditContext({ cast: {} }));
    expect(doc.tracks.some((track) => track.id === "avatars")).toBe(false);
    expect(validate(doc).ok).toBe(true);
  });

  it("carries the already-settled state timeline onto each overlay", () => {
    const doc = buildRedditStoryDocument(redditContext());
    const overlays = doc.tracks.find((track) => track.id === "avatars");
    const first = overlays?.type === "overlay" ? overlays.items[0] : undefined;

    /* WINDOWS_ARE_COMPUTED_NOT_DRAWN — the component looks these up rather
     * than deriving them, because it never sees the document. */
    expect(Array.isArray(first?.props?.["states"])).toBe(true);
    expect(first?.props?.["handles"]).toBeDefined();
  });

  /* FOOTAGE_OR_BACKDROP_NEVER_BOTH — shared with the voiceover format through
   * ./common.ts, and asserted here too because this format stacks four tracks
   * over it and a gradient drawn above the footage is the kind of thing that
   * survives review. */
  it("uses footage instead of the backdrop when one is chosen", () => {
    const doc = buildRedditStoryDocument(
      redditContext({
        background: {
          assetId: "ast_loop",
          durationSec: 4,
          license: "licensed",
          width: 1080,
          height: 1920,
        },
      }),
    );
    expect(doc.tracks.some((track) => track.id === "footage")).toBe(true);
    expect(doc.tracks.some((track) => track.id === "background")).toBe(false);
  });

  it("asks for per-speaker caption colours only when the project did", () => {
    const off = buildRedditStoryDocument(redditContext());
    const offTrack = off.tracks.find((track) => track.type === "caption");
    expect(
      offTrack?.type === "caption" ? offTrack.speakerColors : true,
    ).toBeFalsy();

    const on = buildRedditStoryDocument(
      redditContext({
        settings: {
          captions: {
            styleId: "clean",
            position: "bottom",
            wordsPerChunk: 3,
            enabled: true,
            speakerColors: true,
          },
        },
      }),
    );
    const onTrack = on.tracks.find((track) => track.type === "caption");
    expect(onTrack?.type === "caption" ? onTrack.speakerColors : false).toBe(
      true,
    );
  });

  it("produces an empty document when there are no lines", () => {
    const doc = buildRedditStoryDocument(
      redditContext({ lines: [], words: [] }),
    );
    expect(doc.tracks).toHaveLength(0);
  });
});

describe("the generator registry", () => {
  /* DOCUMENTED_GAP_NOT_A_STUB — the unbuilt kind is ABSENT, and that absence is
   * what `projects.generate` turns into a named refusal. A stub returning an
   * empty document would be a silent, black, paid-for video. Phase 13 moved
   * `quiz` out of that list; `motion` is what is left, in Phase 16. */
  it("has the three built formats and not the one unbuilt one", () => {
    expect(Object.keys(GENERATORS).sort()).toEqual([
      "quiz",
      "reddit-story",
      "voiceover",
    ]);
    expect(hasGenerator("voiceover")).toBe(true);
    expect(hasGenerator("reddit-story")).toBe(true);
    expect(hasGenerator("quiz")).toBe(true);
    expect(hasGenerator("motion")).toBe(false);
  });

  it("names the format when a kind has no generator", () => {
    expect(() => resolveGenerator("motion")).toThrow(
      GeneratorNotImplementedError,
    );
    try {
      resolveGenerator("motion");
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorNotImplementedError);
      expect((error as GeneratorNotImplementedError).kind).toBe("motion");
    }
  });

  /* SKIPS_LIVE_ON_THE_GENERATOR. The workflow seeds its stage list from this,
   * so a stage named here that is not a real stage would put a phantom row on
   * every progress screen — and `PipelineStageName` is what stops that. */
  it("declares the stages voiceover does not run", () => {
    expect(resolveGenerator("voiceover").skips).toEqual([
      "visuals",
      "storyboard",
      "design",
      "render",
    ]);
  });
});
