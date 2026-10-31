/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: resolveSceneAnchors, elementWindowSeconds,
 *   ElementWindow, RESOLVE_BEFORE_STORING, ONE_PLACE_TURNS_WORDS_INTO_TIME,
 *   AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT
 *
 * WHAT:  Turning a scene's word anchors into seconds, and working out when
 *        each element is on screen within its beat.
 *
 * WHY:   ONE_PLACE_TURNS_WORDS_INTO_TIME. `resolveWordAnchors` in
 *        src/lib/timeline/ is the app's single answer to "when does word N
 *        happen", and it walks ITEM timing and caption ranges — it has never
 *        looked inside a scene element's props, and it should not: that would
 *        make the document module depend on one family's vocabulary. So the
 *        scene engine resolves its OWN anchors here, using the same word
 *        tokens, and the claim stays true in the form that matters — there is
 *        one definition of a word's start time and everything reads it.
 *
 *        RESOLVE_BEFORE_STORING. An anchor is how a DESIGNER expresses intent
 *        ("the diagram appears on the word that introduces it", which is one
 *        of the phase's Done-when lines) and seconds are what a renderer
 *        needs. The conversion happens once, when a designed scene is written
 *        into a document — not per frame in a component, which would need the
 *        whole transcript in every item's props and would re-derive the same
 *        number 1800 times for a one-minute render.
 *
 *        AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT is the fallback, and it is
 *        chosen the way UNKNOWN_DRAWS_NOTHING was in the render registry —
 *        by asking which failure costs money. A scene that reaches a renderer
 *        with an anchor still in it is a pipeline bug, and the two honest
 *        responses are to draw the element for the entire beat or to draw
 *        nothing. Drawing it wins: the content is right and only its timing is
 *        wrong, where drawing nothing is a frame the customer paid for with a
 *        hole in it. It warns once per process rather than per frame, for the
 *        same reason the registry does.
 *
 * WHERE: `resolveSceneAnchors` is called by whatever writes a designed scene
 *        into a document (Phase 16d's generator); `elementWindowSeconds` is
 *        called by the MotionScene components, once per element per frame.
 */

import type { WordToken } from "@/lib/timeline";
import type { Scene, SceneTimeValue, StrictSceneElement } from "@/lib/types/scene";

/**
 * SOURCE OF TRUTH KEYWORDS: ElementWindow
 *
 * When an element is on screen, in seconds from the start of its beat.
 * `to` is exclusive and always greater than `from`.
 */
export interface ElementWindow {
  from: number;
  to: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveSceneAnchors, RESOLVE_BEFORE_STORING
 *
 * WHAT:  The same scene with every `in` and `out` expressed in seconds
 *        relative to the beat.
 *
 * WHY:   Takes the beat's own start so the result is SCENE-RELATIVE, which is
 *        what `SceneTimeValue` means by a number (SCENE_RELATIVE_SECONDS) —
 *        an absolute second would be wrong the moment the editor moved the
 *        beat along the timeline.
 *
 *        An anchor past the end of the transcript resolves to the beat's own
 *        bounds rather than throwing: `checkScene` already reports that as
 *        UNKNOWN_WORD_ANCHOR with a path, and a second, louder failure here
 *        would turn a reportable design defect into a crashed generation.
 * WHERE: Phase 16d's generator, once per designed beat.
 */
export function resolveSceneAnchors(args: {
  scene: Scene;
  words: readonly WordToken[];
  /** The beat's start, in seconds from the start of the video. */
  beatStart: number;
  /** The beat's length, in seconds. */
  beatDuration: number;
}): Scene {
  const { scene, words, beatStart, beatDuration } = args;

  const toSeconds = (value: SceneTimeValue, fallback: number): number => {
    if (typeof value === "number") return clamp(value, 0, beatDuration);
    const token = words[value.wordIndex];
    if (token === undefined) return fallback;
    return clamp(token.s - beatStart, 0, beatDuration);
  };

  return {
    layout: scene.layout,
    elements: scene.elements.map((element) => ({
      ...element,
      in: toSeconds(element.in, 0),
      ...(element.out === undefined
        ? {}
        : { out: toSeconds(element.out, beatDuration) }),
    })),
  };
}

/* Warned once per process, not per frame — a 60-second render is 1800 frames
 * and would otherwise write 1800 identical lines into the log that matters
 * most when a render goes wrong. */
const warned = new Set<string>();

/**
 * SOURCE OF TRUTH KEYWORDS: elementWindowSeconds,
 *   AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT
 *
 * WHAT:  When this element is on screen, in seconds from the start of the
 *        beat.
 * WHY:   Pure and total — it always returns a window with positive length, so
 *        a component never has to handle a degenerate one and an element can
 *        never be mounted with nothing to interpolate over. An inverted window
 *        is already a TIMING_INVERTED error from `checkScene`; here it simply
 *        collapses to the beat.
 * WHERE: Every motion primitive, through the element shell.
 */
export function elementWindowSeconds(
  element: StrictSceneElement,
  beatDuration: number,
): ElementWindow {
  const from = resolvedOr(element.in, 0, element.id);
  const to = resolvedOr(element.out, beatDuration, element.id);

  if (!(to > from)) return { from: 0, to: beatDuration };
  return { from: clamp(from, 0, beatDuration), to: clamp(to, 0, beatDuration) };
}

function resolvedOr(
  value: SceneTimeValue | undefined,
  fallback: number,
  elementId: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;

  if (!warned.has(elementId)) {
    warned.add(elementId);
    console.warn(
      `[scene/anchors] Element "${elementId}" still carries word anchor ${value.wordIndex} at render time — ` +
        "showing it for the whole beat. Scenes must go through resolveSceneAnchors before being stored (RESOLVE_BEFORE_STORING).",
    );
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
