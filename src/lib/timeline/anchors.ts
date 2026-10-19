/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: resolveWordAnchors, FRAME_SNAPPING, timing resolved,
 *   resolveCaptionTimes, PARTIAL_RESOLUTION, snapToFrame
 *
 * WHAT:  Replaces every word anchor in a document with absolute seconds snapped
 *        to the canvas frame grid, fills each caption's cached start and
 *        duration from its word range, and marks the document `resolved`.
 * WHY:   FRAME_SNAPPING is the reason this is not a one-line map. The renderer
 *        works in whole frames, so an unsnapped 2.4133s becomes frame 72.399
 *        and is floored somewhere downstream — by Remotion, by the player, by
 *        each independently. Snapping once, here, is what makes the editor's
 *        preview and the paid render agree to the frame.
 *
 *        PARTIAL_RESOLUTION: an anchor that names a word the script does not
 *        contain is LEFT IN PLACE and the document stays `anchored`. Marking it
 *        resolved would make validate() report the anchor as the problem, when
 *        the real problem is the missing word — and silently zeroing it would
 *        render the item at the start of the video. The document comes back
 *        honest about not being ready, and validate() names the dangling
 *        anchor.
 * WHERE: Called by the generate pipeline (Phase 09) once TTS and alignment have
 *        produced doc.words, and by the player before scrubbing.
 */

import type { CaptionItem, TimelineDoc, TimeValue, Track } from './schema'
import {
  captionRangeSeconds,
  cloneDoc,
  framesToSeconds,
  isWordAnchor,
  resolveDuration,
  resolveTimeValue,
  roundSeconds,
  secondsToFrames,
} from './time'

/**
 * SOURCE OF TRUTH KEYWORDS: resolveWordAnchors
 *
 * WHAT:  The resolved copy of a document. The input is never mutated.
 * WHY:   Returns a document rather than a result object because it cannot fail
 *        — anything it could not resolve is reported by validate(), which the
 *        caller runs next anyway. See PARTIAL_RESOLUTION above.
 * WHERE: Phase 09's pipeline; the preview player.
 */
export function resolveWordAnchors(doc: TimelineDoc): TimelineDoc {
  const next = cloneDoc(doc)
  const fps = next.canvas.fps
  let allResolved = true
  const fail = (): void => {
    allResolved = false
  }

  /* Switched per track type rather than mapped over the union: a single
   * `{ ...track, items }` spread would widen every item to the fields the five
   * variants share, and recovering the variant would need a type assertion the
   * lint rules rightly forbid. */
  next.tracks = next.tracks.map((track): Track => {
    switch (track.type) {
      case 'caption':
        return { ...track, items: track.items.map((item) => resolveCaptionTimes(item, next, fps)) }
      case 'video':
        return { ...track, items: track.items.map((item) => resolveSpan(item, next, fps, fail)) }
      case 'scene':
        return { ...track, items: track.items.map((item) => resolveSpan(item, next, fps, fail)) }
      case 'audio':
        return { ...track, items: track.items.map((item) => resolveSpan(item, next, fps, fail)) }
      case 'overlay':
        return { ...track, items: track.items.map((item) => resolveSpan(item, next, fps, fail)) }
    }
  })

  next.timing = allResolved ? 'resolved' : 'anchored'
  return next
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveSpan
 *
 * WHAT:  One item with its start and duration turned into frame-snapped
 *        seconds, or the item untouched when an anchor dangles.
 * WHY:   Generic over the four item variants that carry a span, so the rule is
 *        written once. Built with Object.assign rather than a spread literal
 *        because the spread's type is not assignable back to the variant
 *        without an assertion, and assertions on object literals are banned
 *        here for good reason — they are how a field quietly goes missing.
 * WHERE: resolveWordAnchors(), once per non-caption track type.
 */
function resolveSpan<T extends { start: TimeValue; duration: TimeValue }>(
  item: T,
  doc: TimelineDoc,
  fps: number,
  onDangling: () => void
): T {
  const start = resolveOne(item.start, doc, fps)
  if (start === null) {
    onDangling()
    return item
  }
  /* The duration is resolved AGAINST the snapped start, so an item anchored
   * "from word 4 until word 9" keeps both edges on the frame grid rather than
   * inheriting a sub-frame offset from an unsnapped start. */
  const resolvedEnd = resolveDuration(item.duration, start, doc.words)
  if (resolvedEnd === null) {
    onDangling()
    return item
  }
  const duration = Math.max(
    roundSeconds(snapToFrame(start + resolvedEnd, fps) - start),
    framesToSeconds(1, fps)
  )
  return Object.assign({}, item, { start, duration })
}

/* One TimeValue to a frame-snapped number, or null when its anchor dangles. */
function resolveOne(value: TimeValue, doc: TimelineDoc, fps: number): number | null {
  const seconds = resolveTimeValue(value, doc.words)
  if (seconds === null) return null
  return snapToFrame(seconds, fps)
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveCaptionTimes
 *
 * WHAT:  Writes a caption's `start` and `duration` from the words it covers.
 * WHY:   A caption's range is authoritative and these two fields are a cache of
 *        it, which is why they are written here and never by hand — validate()
 *        reports a disagreement as STALE_RESOLUTION. A range that does not
 *        exist leaves the cache untouched rather than writing zeros.
 *        A caption is never shorter than one frame: a single very short word
 *        would otherwise round to a duration of zero and disappear.
 * WHERE: resolveWordAnchors().
 */
function resolveCaptionTimes(item: CaptionItem, doc: TimelineDoc, fps: number): CaptionItem {
  const range = captionRangeSeconds(item.startWord, item.endWord, doc.words)
  if (range === null) return item

  const start = snapToFrame(range.start, fps)
  const end = snapToFrame(range.end, fps)
  const oneFrame = framesToSeconds(1, fps)
  const duration = Math.max(roundSeconds(end - start), oneFrame)

  return { ...item, start, duration }
}

/**
 * SOURCE OF TRUTH KEYWORDS: snapToFrame, FRAME_SNAPPING
 *
 * WHAT:  The nearest whole-frame instant to a time in seconds.
 * WHY:   Nearest, not floored — see secondsToFrames in time.ts for why the
 *        difference compounds.
 * WHERE: Everything resolved in this file.
 */
export function snapToFrame(seconds: number, fps: number): number {
  return framesToSeconds(secondsToFrames(seconds, fps), fps)
}

/**
 * SOURCE OF TRUTH KEYWORDS: hasUnresolvedAnchors
 *
 * WHAT:  Whether any time in the document is still a word anchor.
 * WHY:   The pipeline needs this as a precondition — a render must never start
 *        on an anchored document — and asking it directly is clearer than
 *        inferring it from `timing`, which a generator sets by hand.
 * WHERE: Phase 04's render pre-flight; the tests for this file.
 */
export function hasUnresolvedAnchors(doc: TimelineDoc): boolean {
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.start !== undefined && isWordAnchor(item.start)) return true
      if (item.duration !== undefined && isWordAnchor(item.duration)) return true
    }
  }
  return false
}
