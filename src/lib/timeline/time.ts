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
 * SOURCE OF TRUTH KEYWORDS: isWordAnchor, isSeconds, resolveTimeValue,
 *   captionRangeSeconds, itemSpan, documentLength, secondsToFrames,
 *   framesToSeconds, TIME_EPSILON, roundSeconds, iterateItems, TimelineItemRef,
 *   cloneDoc, SPINE_TRACKS
 *
 * WHAT:  The arithmetic every other file in this module shares: telling an
 *        anchor from a number, turning one into the other, measuring an item or
 *        a whole document, and walking every item once.
 * WHY:   TIME_EPSILON exists because these are floats that came from an
 *        aligner. An item ending at 58.400000000000006 on a 58.4-second video
 *        is not out of range, and a strict `>` comparison would reject it — so
 *        every boundary check in validate.ts goes through these helpers rather
 *        than comparing directly. Frames, likewise, are rounded once here: two
 *        callers rounding differently is how a caption lands one frame off its
 *        word.
 *        iterateItems() is the only traversal. Hand-rolled nested loops over
 *        tracks were the alternative and each one would have its own idea of
 *        what to do with `noUncheckedIndexedAccess`.
 * WHERE: validate.ts, ops.ts, anchors.ts, hash.ts.
 */

import type {
  TimeValue,
  TimelineDoc,
  Track,
  TrackItem,
  WordAnchor,
  WordToken,
} from './schema'

/**
 * SOURCE OF TRUTH KEYWORDS: TIME_EPSILON
 *
 * WHAT:  The tolerance for every float comparison in this module — half a
 *        millisecond.
 * WHY:   Tighter than any perceivable timing error and looser than the drift a
 *        chain of float additions accumulates. See the file's WHY.
 * WHERE: Boundary checks in validate.ts, split bounds in ops.ts.
 */
export const TIME_EPSILON = 0.0005

/**
 * SOURCE OF TRUTH KEYWORDS: isWordAnchor, isSeconds
 *
 * WHAT:  Narrows a TimeValue to one of its two forms.
 * WHY:   `typeof x === 'number'` is scattered everywhere otherwise, and the
 *        anchor case needs to know WHICH anchor shape it has anyway.
 * WHERE: Everywhere a TimeValue is read.
 */
export function isSeconds(value: TimeValue): value is number {
  return typeof value === 'number'
}

export function isWordAnchor(value: TimeValue): value is WordAnchor {
  return typeof value === 'object' && value !== null
}

/**
 * SOURCE OF TRUTH KEYWORDS: roundSeconds
 *
 * WHAT:  Rounds to microsecond precision.
 * WHY:   Applied after any arithmetic that produces a stored time, so a split
 *        at 2.2 does not persist 2.2000000000000002 and change the document's
 *        hash. Six places is finer than one frame at any frame rate we support.
 * WHERE: ops.ts, anchors.ts, hash.ts.
 */
export function roundSeconds(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveTimeValue, ANCHOR_RESOLUTION
 *
 * WHAT:  Turns a TimeValue into seconds against a word list, or returns null
 *        when the anchor names a word that is not there.
 * WHY:   Returns null rather than 0 on a miss. Zero is a legal time, so a
 *        missing anchor that resolved to it would render at the start of the
 *        video and look like a design decision; null forces the caller to raise
 *        ANCHOR_NOT_FOUND.
 *        A `{ word }` anchor matches case-insensitively on the FIRST occurrence
 *        and ignores surrounding punctuation, because the model that wrote it
 *        quoted the script, not the tokeniser's output.
 * WHERE: validate.ts (to check ranges), anchors.ts (to eliminate anchors).
 */
export function resolveTimeValue(value: TimeValue, words: readonly WordToken[]): number | null {
  if (isSeconds(value)) return value

  if ('wordIndex' in value) {
    const token = words[value.wordIndex]
    return token === undefined ? null : token.s
  }

  const needle = normalizeWord(value.word)
  for (const token of words) {
    if (normalizeWord(token.w) === needle) return token.s
  }
  return null
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveWordEnd, resolveDuration,
 *   DURATION_ANCHOR_IS_AN_END
 *
 * WHAT:  Resolves a duration that was written as a word anchor.
 * WHY:   DURATION_ANCHOR_IS_AN_END. A `start` anchor means "when this word is
 *        spoken"; a `duration` anchor means "until this word has been spoken" —
 *        it is an END, measured to the word's `e`, and the duration is the
 *        distance from the item's own start. Resolving it the same way as a
 *        start would make "show this until the word 'anyway'" produce a
 *        duration equal to that word's timestamp, which is a nonsense number
 *        that happens to be positive — the worst kind, because it renders.
 *        Inclusive of the named word: "until 'anyway'" shows through it, which
 *        is what the phrase means to the person writing a script.
 * WHERE: itemSpan() below, anchors.ts, validate.ts.
 */
export function resolveWordEnd(anchor: WordAnchor, words: readonly WordToken[]): number | null {
  if ('wordIndex' in anchor) {
    const token = words[anchor.wordIndex]
    return token === undefined ? null : token.e
  }
  const needle = normalizeWord(anchor.word)
  for (const token of words) {
    if (normalizeWord(token.w) === needle) return token.e
  }
  return null
}

export function resolveDuration(
  value: TimeValue,
  start: number,
  words: readonly WordToken[]
): number | null {
  if (isSeconds(value)) return value
  const end = resolveWordEnd(value, words)
  if (end === null) return null
  return roundSeconds(end - start)
}

/**
 * SOURCE OF TRUTH KEYWORDS: captionRangeSeconds
 *
 * WHAT:  The start and end of a caption's word range, in seconds.
 * WHY:   A caption's timing is DERIVED from doc.words and nowhere else — this
 *        is the one function that derives it, so resolveWordAnchors and
 *        validate cannot disagree about what a range means.
 * WHERE: anchors.ts, validate.ts, ops.ts (setCaptionText).
 */
export function captionRangeSeconds(
  startWord: number,
  endWord: number,
  words: readonly WordToken[]
): { start: number; end: number } | null {
  const first = words[startWord]
  const last = words[endWord]
  if (first === undefined || last === undefined) return null
  return { start: first.s, end: last.e }
}

/**
 * SOURCE OF TRUTH KEYWORDS: itemSpan
 *
 * WHAT:  An item's resolved start and end in seconds, or null if either side
 *        is an anchor that does not resolve.
 * WHY:   Caption items are measured from their word range, every other item
 *        from start+duration — one function so no caller has to remember which
 *        kind it is holding.
 * WHERE: validate.ts, ops.ts ripple maths, documentLength().
 */
export function itemSpan(
  item: TrackItem,
  words: readonly WordToken[]
): { start: number; end: number } | null {
  if ('startWord' in item) {
    return captionRangeSeconds(item.startWord, item.endWord, words)
  }

  const start = resolveTimeValue(item.start, words)
  if (start === null) return null
  const duration = resolveDuration(item.duration, start, words)
  if (duration === null) return null
  return { start, end: start + duration }
}

/**
 * SOURCE OF TRUTH KEYWORDS: SPINE_TRACKS, documentLength, VIDEO_LENGTH_RULE
 *
 * WHAT:  How long the finished video is.
 * WHY:   VIDEO_LENGTH_RULE. The length is the furthest point reached by the
 *        SPINE — the video and audio lanes — because those are the two things
 *        that have an intrinsic duration. Captions, overlays and scenes are
 *        decoration on top, and an overlay at 90 seconds on a 58-second video
 *        is a bug worth reporting rather than a reason to make the video 90
 *        seconds long.
 *        A document with no spine at all (a pure motion piece) falls back to
 *        the furthest point on any lane, which makes the range check vacuous
 *        for it rather than failing everything at zero.
 * WHERE: validate.ts (the OUT_OF_RANGE rule), the player's scrubber.
 */
export const SPINE_TRACKS: readonly Track['type'][] = ['video', 'audio']

export function documentLength(doc: TimelineDoc): number {
  const spine = furthestEnd(doc, (track) => SPINE_TRACKS.includes(track.type))
  if (spine > 0) return spine
  return furthestEnd(doc, () => true)
}

function furthestEnd(doc: TimelineDoc, include: (track: Track) => boolean): number {
  let furthest = 0
  for (const track of doc.tracks) {
    if (!include(track)) continue
    for (const item of track.items) {
      const span = itemSpan(item, doc.words)
      if (span !== null && span.end > furthest) furthest = span.end
    }
  }
  return furthest
}

/**
 * SOURCE OF TRUTH KEYWORDS: secondsToFrames, framesToSeconds
 *
 * WHAT:  Seconds to whole frames and back, at a given frame rate.
 * WHY:   Rounded, not floored. Flooring loses up to a frame per conversion and
 *        the losses compound across a chain of items, pulling the end of a
 *        sixty-second video visibly off its audio.
 * WHERE: anchors.ts; the Remotion compositions in Phase 03.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps)
}

export function framesToSeconds(frames: number, fps: number): number {
  return roundSeconds(frames / fps)
}

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineItemRef, iterateItems
 *
 * WHAT:  Every item in the document with the track and indices that locate it.
 * WHY:   The indices are what build the dotted error path, and the track is
 *        what tells a caller which item variant it is holding. Returning an
 *        array rather than a generator keeps this usable in the editor's render
 *        path, where a generator would be re-consumed per frame.
 * WHERE: validate.ts, ops.ts, anchors.ts.
 */
export interface TimelineItemRef {
  track: Track
  trackIndex: number
  itemIndex: number
  item: TrackItem
  path: string
}

export function iterateItems(doc: TimelineDoc): TimelineItemRef[] {
  const refs: TimelineItemRef[] = []
  doc.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item, itemIndex) => {
      refs.push({
        track,
        trackIndex,
        itemIndex,
        item,
        path: `tracks.${trackIndex}.items.${itemIndex}`,
      })
    })
  })
  return refs
}

/**
 * SOURCE OF TRUTH KEYWORDS: cloneDoc, PURE_CLONE
 *
 * WHAT:  A deep copy of a document.
 * WHY:   PURE_CLONE. Every op returns a new document and never mutates its
 *        input, which is what lets the editor keep an undo stack by holding
 *        references. A JSON round-trip is the honest clone here precisely
 *        because a timeline document IS JSON — it holds no Dates, Maps or
 *        functions, and `structuredClone` would additionally survive values the
 *        schema forbids, hiding a document that cannot be stored.
 * WHERE: ops.ts, anchors.ts, migrate.ts.
 */
export function cloneDoc<T>(doc: T): T {
  const parsed: unknown = JSON.parse(JSON.stringify(doc))
  /* The round-trip of a JSON-only value is that same value. The assertion is
   * the one point where that is stated, rather than at every callsite. */
  return parsed as T
}
