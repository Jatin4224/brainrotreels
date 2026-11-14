/**
 * SOURCE OF TRUTH KEYWORDS: compositionMetadataFor, SANITISE_BEFORE_BOTH_PARSES,
 *   metadata tests, FALLBACK_IS_ONE_FRAME, ONE_SECOND_PAID_RENDER,
 *   dropUnknownRenderKinds, planComposition
 *
 * WHAT:  That the composition is sized from the SANITISED document — the same
 *        one TimelineRenderer draws — and only falls back to a single second
 *        when the document is genuinely unparseable.
 * WHY:   This guards the most expensive silent failure in the render path. The
 *        component sanitises before parsing (FORWARD_COMPATIBLE_DOCUMENT) and
 *        the metadata hook did not, so one item carrying a render kind from a
 *        newer release made the two sides disagree: the hook sized one second
 *        while the component drew the whole video. The render SUCCEEDED and
 *        was billed, and the only symptom was a one-second file
 *        (ONE_SECOND_PAID_RENDER). A unit test is the only cheap way to hold
 *        that ordering true — the alternative is noticing it in a paid render.
 *
 *        The poisoned document is built as raw JSON rather than a typed
 *        TimelineDoc on purpose: an unknown render kind cannot be expressed in
 *        the parsed type, which is precisely why it survived review.
 * WHERE: Run by `npm test`. Guards src/lib/render/metadata.ts, and with it the
 *        `calculateMetadata` prop every composition in src/remotion/root.tsx
 *        passes.
 */

import { describe, expect, it, vi } from "vitest";

import { resolveWordAnchors, timelineDocSchema } from "@/lib/timeline";
import { redditStoryFixture } from "@/lib/timeline/fixtures";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import { planComposition } from "./frame-plan";
import { compositionMetadataFor } from "./metadata";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The fixture, re-serialised to plain JSON and given one extra overlay item
 * whose `render` is a kind this build has never heard of — the shape a
 * document written by a newer release arrives in.
 */
function withItemFromANewerRelease(): Record<string, unknown> {
  const json: unknown = JSON.parse(
    JSON.stringify(resolveWordAnchors(redditStoryFixture())),
  );
  if (!isRecord(json)) throw new Error("fixture did not serialise to an object");

  const tracks = json["tracks"];
  if (!Array.isArray(tracks)) throw new Error("fixture has no tracks array");

  const [first, ...rest] = tracks;
  if (!isRecord(first)) throw new Error("fixture track is not an object");

  const items = Array.isArray(first["items"]) ? first["items"] : [];
  return {
    ...json,
    tracks: [
      {
        ...first,
        items: [
          ...items,
          { id: "from-a-newer-release", render: "someFutureThing" },
        ],
      },
      ...rest,
    ],
  };
}

describe("compositionMetadataFor", () => {
  it("sizes a clean document from the document, not from a constant", () => {
    const doc = resolveWordAnchors(redditStoryFixture());
    const plan = planComposition(doc);

    expect(compositionMetadataFor(doc)).toEqual({
      durationInFrames: plan.durationInFrames,
      fps: plan.fps,
      width: plan.width,
      height: plan.height,
    });
    /* Guards the test itself: a fixture that happened to be one second long
     * would make the regression case below pass for the wrong reason. */
    expect(plan.durationInFrames).toBeGreaterThan(CANVAS_BY_ASPECT["9:16"].fps);
  });

  it("the poisoned document really does fail a raw strict parse", () => {
    /* Without this, the regression test below would still pass if the schema
     * ever stopped rejecting unknown render kinds — and would then be
     * guarding nothing. */
    expect(timelineDocSchema.safeParse(withItemFromANewerRelease()).success).toBe(
      false,
    );
  });

  it("keeps the full length when one item carries an unknown render kind", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const expected = compositionMetadataFor(
      resolveWordAnchors(redditStoryFixture()),
    );

    const actual = compositionMetadataFor(withItemFromANewerRelease());

    /* ONE_SECOND_PAID_RENDER is the bug: before the sanitise step this
     * returned the one-second fallback while the component drew the whole
     * document. */
    expect(actual).toEqual(expected);
    expect(actual.durationInFrames).not.toBe(CANVAS_BY_ASPECT["9:16"].fps);
    /* And it is not merely surviving — nothing was reported as unparseable. */
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to one second on the 9:16 canvas when nothing parses", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(compositionMetadataFor({ tracks: "not an array" })).toEqual({
      durationInFrames: CANVAS_BY_ASPECT["9:16"].fps,
      fps: CANVAS_BY_ASPECT["9:16"].fps,
      width: CANVAS_BY_ASPECT["9:16"].width,
      height: CANVAS_BY_ASPECT["9:16"].height,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("falls back rather than throwing on the shapes a network can deliver", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fallback = {
      durationInFrames: CANVAS_BY_ASPECT["9:16"].fps,
      fps: CANVAS_BY_ASPECT["9:16"].fps,
      width: CANVAS_BY_ASPECT["9:16"].width,
      height: CANVAS_BY_ASPECT["9:16"].height,
    };

    /* A throw here is a Lambda render that spent its budget and produced
     * nothing to look at, so every one of these must return. */
    expect(compositionMetadataFor(undefined)).toEqual(fallback);
    expect(compositionMetadataFor(null)).toEqual(fallback);
    expect(compositionMetadataFor("nonsense")).toEqual(fallback);
    expect(compositionMetadataFor({})).toEqual(fallback);
    error.mockRestore();
  });
});
