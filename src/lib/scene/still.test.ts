/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: still document test, buildStillDocument,
 *   stillFrameFor, NO_ASSETS_NO_AUDIO, THE_MIDPOINT_IS_THE_HONEST_FRAME,
 *   A_STILL_DOCUMENT_IS_THE_GRAPHIC_ALONE
 *
 * WHAT:  That the one-beat document a QA still is rendered from is a VALID
 *        timeline document, names no asset, and that the frame chosen from it
 *        is the beat's midpoint.
 *
 * WHY:   The validity assertion is the one that earns its place. This document
 *        is built in a server-only module, handed straight to a Lambda, and
 *        its first reader is a renderer in another process — so an invalid one
 *        fails as a render error with a stack trace from inside Remotion,
 *        minutes later, on a path nobody is watching because the video it is
 *        reviewing has already been delivered. `validate()` here turns that
 *        into a failing unit test.
 *
 *        NO_ASSETS_NO_AUDIO is asserted directly because it is what lets the
 *        reviewer pass an EMPTY asset map. If a scene document ever grew an
 *        asset reference, the still would start failing on a missing signed
 *        URL and the review would quietly stop happening.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { validate } from "@/lib/timeline";
import type { CanvasSpec } from "@/lib/timeline";
import type { Scene } from "@/lib/types/scene";

import { checkScene } from "./check";
import { buildStillDocument, stillFrameFor, STILL_ITEM_ID } from "./still";

const CANVAS: CanvasSpec = { width: 1080, height: 1920, fps: 30 };

const SCENE: Scene = {
  layout: "stack-center",
  elements: [
    {
      id: "headline",
      kind: "title",
      text: "Forty one percent",
      subhead: "never finish setup",
      in: 0,
      entrance: "rise",
      exit: "fade",
    },
  ],
};

const build = (durationSeconds = 3) =>
  buildStillDocument({
    scene: SCENE,
    canvas: CANVAS,
    paletteId: "mono",
    captionStyleId: "none",
    motionStyleId: "studio",
    safeZone: "none",
    durationSeconds,
  });

describe("the still document", () => {
  it("is a valid timeline document", () => {
    const result = validate(build());
    expect(
      result.ok,
      result.ok ? "" : JSON.stringify(result.errors, null, 2),
    ).toBe(true);
  });

  it("names no asset and no speaker", () => {
    /* NO_ASSETS_NO_AUDIO — this is what lets the reviewer render it with an
     * empty asset map and never touch storage. */
    const doc = build();
    expect(Object.keys(doc.assets)).toEqual([]);
    expect(Object.keys(doc.speakers)).toEqual([]);
    expect(doc.words).toEqual([]);
  });

  it("holds exactly one scene item, starting at zero", () => {
    const doc = build();
    expect(doc.tracks).toHaveLength(1);
    const track = doc.tracks[0];
    expect(track?.items).toHaveLength(1);
    const item = track?.items[0];
    expect(item?.id).toBe(STILL_ITEM_ID);
    expect(item?.start).toBe(0);
  });

  it("is `resolved`, because it has no words to anchor against", () => {
    expect(build().timing).toBe("resolved");
  });

  it("carries the style's palette, so the still is the right colour", () => {
    expect(build().style.paletteId).toBe("mono");
    expect(build().style.motionStyleId).toBe("studio");
  });

  it("stays valid for a beat whose words were re-timed to nothing", () => {
    /* A zero-length item is out of range and would fail the whole document;
     * one frame is the floor. */
    const doc = build(0);
    const result = validate(doc);
    expect(
      result.ok,
      result.ok ? "" : JSON.stringify(result.errors, null, 2),
    ).toBe(true);
    expect(doc.tracks[0]?.items[0]?.duration).toBeCloseTo(1 / CANVAS.fps, 6);
  });

  it("holds a scene the checks still pass", () => {
    /* The document is a different container, not a different scene — a still
     * that drew something `checkScene` would refuse would be reviewing a frame
     * the real render never produces. */
    const result = checkScene(SCENE, {
      canvas: CANVAS,
      safeZone: "none",
      durationSeconds: 3,
      /* No anchors in this scene, so nothing resolves against the count — but
       * the context requires one, because an anchor that named a word the
       * transcript does not have is exactly what it exists to catch. */
      wordCount: 0,
    });
    expect(
      result.ok,
      result.ok ? "" : JSON.stringify(result.errors, null, 2),
    ).toBe(true);
  });
});

describe("the frame chosen from it", () => {
  it("is the beat's midpoint", () => {
    /* THE_MIDPOINT_IS_THE_HONEST_FRAME — everything that enters has entered. */
    expect(stillFrameFor({ durationSeconds: 3, fps: 30 })).toBe(45);
    expect(stillFrameFor({ durationSeconds: 1.5, fps: 30 })).toBe(23);
  });

  it("is never negative", () => {
    expect(stillFrameFor({ durationSeconds: 0, fps: 30 })).toBe(0);
    expect(stillFrameFor({ durationSeconds: -4, fps: 30 })).toBe(0);
  });

  it("is a whole frame", () => {
    const frame = stillFrameFor({ durationSeconds: 2.37, fps: 30 });
    expect(Number.isInteger(frame)).toBe(true);
  });
});
