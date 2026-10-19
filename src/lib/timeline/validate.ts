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
 * SOURCE OF TRUTH KEYWORDS: validate, ValidationResult, ValidationError,
 *   BOUNDS_EPSILON, NEVER_THROWS, checkWords, checkIds, checkTiming,
 *   checkReferences, checkBounds, checkOverlayDepth, overlaps
 *
 * WHAT:  Checks a candidate document against timelineDocSchema and then against
 *        every invariant the schema cannot express, returning field-level
 *        errors.
 * WHY:   NEVER_THROWS, and the split is the point. Zod can say "duration must
 *        be a number"; it cannot say "this caption points at word 400 of a
 *        380-word script", which is the class of bug that actually ships — a
 *        document that parses perfectly and renders nonsense. The structural
 *        rules below are each one real failure we would otherwise discover in a
 *        paid render.
 *        Rules run in order of dependency and every one of them SKIPS rather
 *        than cascades: a document with a broken word list reports that once,
 *        not once per caption that referenced it.
 * WHERE: Called before any write of Timeline.doc, by apply() after every edit,
 *        and by the render pre-flight in Phase 04.
 */

import { timelineError, type ValidationError, type ValidationResult } from './errors'
import {
  timelineDocSchema,
  type NormalizedBox,
  type TimelineDoc,
  type TimeValue,
  type TrackItem,
} from './schema'
import {
  TIME_EPSILON,
  captionRangeSeconds,
  documentLength,
  isSeconds,
  isWordAnchor,
  iterateItems,
  resolveDuration,
  resolveTimeValue,
} from './time'

/**
 * SOURCE OF TRUTH KEYWORDS: BOUNDS_EPSILON
 *
 * WHAT:  Tolerance for the 0..1 canvas-bounds checks.
 * WHY:   A box laid out as thirds reaches 0.9999999999999999, which is inside
 *        the canvas by any measure a viewer could take.
 * WHERE: checkBounds below.
 */
const BOUNDS_EPSILON = 1e-6

/**
 * SOURCE OF TRUTH KEYWORDS: validate
 *
 * WHAT:  The module's gate. Parses, then applies every structural rule.
 * WHY:   Takes `unknown` because its whole job is to stand between stored or
 *        generated JSON and the typed document — a narrower parameter would
 *        force every caller to assert first, which is the check this function
 *        exists to replace.
 *        Returns the PARSED document, not the input: zod has filled defaults
 *        (`timing`, `fit`, `gain`) by then, so the caller gets the normalised
 *        form and two callers cannot disagree about what a missing `muted`
 *        means.
 * WHERE: Every read of Timeline.doc (after migrate), every write, and apply().
 */
export function validate(doc: unknown): ValidationResult<TimelineDoc> {
  const parsed = timelineDocSchema.safeParse(doc)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) =>
        timelineError(issue.path.join('.') || 'document', 'SCHEMA', issue.message)
      ),
    }
  }

  const candidate = parsed.data
  const errors: ValidationError[] = []

  /* Word tokens first: captions and anchors are both read against them, so a
   * broken word list would otherwise produce an error per consumer. */
  const wordsOk = checkWords(candidate, errors)

  checkIds(candidate, errors)
  checkTiming(candidate, errors, wordsOk)
  checkReferences(candidate, errors)
  checkBounds(candidate, errors)
  checkOverlayDepth(candidate, errors, wordsOk)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, doc: candidate }
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkWords, BAD_WORD_TOKEN
 *
 * WHAT:  The word list is the document's clock. Verifies each token's `i`
 *        matches its position, that it does not end before it starts, and that
 *        the list runs forwards.
 * WHY:   `i` drifting from the array index is the worst bug in this module's
 *        surface: every anchor resolves by index, so a single inserted word
 *        shifts an entire video's captions by one word and nothing crashes.
 *        Returns whether the list is usable, so dependent rules can skip.
 * WHERE: validate(), above.
 */
function checkWords(doc: TimelineDoc, errors: ValidationError[]): boolean {
  let ok = true
  let previousStart = Number.NEGATIVE_INFINITY

  doc.words.forEach((token, index) => {
    const path = `words.${index}`
    if (token.i !== index) {
      errors.push(
        timelineError(
          `${path}.i`,
          'BAD_WORD_TOKEN',
          `Word ${index} is labelled ${token.i}. Word indices must match their position.`
        )
      )
      ok = false
    }
    if (token.s < 0) {
      errors.push(timelineError(`${path}.s`, 'BAD_WORD_TOKEN', 'A word cannot start before zero.'))
      ok = false
    }
    if (token.e < token.s - TIME_EPSILON) {
      errors.push(
        timelineError(`${path}.e`, 'BAD_WORD_TOKEN', 'A word cannot end before it starts.')
      )
      ok = false
    }
    if (token.s < previousStart - TIME_EPSILON) {
      errors.push(
        timelineError(`${path}.s`, 'BAD_WORD_TOKEN', 'Words must be in spoken order.')
      )
      ok = false
    }
    previousStart = token.s
  })

  return ok
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkIds, DUPLICATE_ID, GLOBAL_ITEM_IDS
 *
 * WHAT:  Track ids unique, and item ids unique across the WHOLE document.
 * WHY:   GLOBAL_ITEM_IDS. Ops address an item by id alone, with no track
 *        argument, so a duplicate id is not a cosmetic problem — a `delete`
 *        would hit whichever copy the traversal reached first, which is not a
 *        behaviour anyone can reason about.
 * WHERE: validate().
 */
function checkIds(doc: TimelineDoc, errors: ValidationError[]): void {
  const trackIds = new Set<string>()
  doc.tracks.forEach((track, trackIndex) => {
    if (trackIds.has(track.id)) {
      errors.push(
        timelineError(
          `tracks.${trackIndex}.id`,
          'DUPLICATE_ID',
          `More than one track is called "${track.id}".`
        )
      )
    }
    trackIds.add(track.id)
  })

  const itemIds = new Set<string>()
  for (const ref of iterateItems(doc)) {
    if (itemIds.has(ref.item.id)) {
      errors.push(
        timelineError(
          `${ref.path}.id`,
          'DUPLICATE_ID',
          `More than one item is called "${ref.item.id}".`
        )
      )
    }
    itemIds.add(ref.item.id)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkTiming, BAD_DURATION, OUT_OF_RANGE,
 *   UNRESOLVED_ANCHOR, ANCHOR_NOT_FOUND, STALE_RESOLUTION
 *
 * WHAT:  Every rule about when an item happens: positive durations, anchors
 *        that resolve, no anchors left in a resolved document, caption ranges
 *        that exist, cached caption times that still agree with their range,
 *        and nothing reaching past the end of the video.
 * WHY:   Grouped because they share the expensive part — resolving each item's
 *        span once — and because they are the rules that cascade. An item whose
 *        anchor does not resolve has no span, so it is reported once and
 *        skipped rather than also failing the range check.
 * WHERE: validate().
 */
function checkTiming(doc: TimelineDoc, errors: ValidationError[], wordsOk: boolean): void {
  const length = documentLength(doc)
  const mustBeResolved = doc.timing === 'resolved'

  for (const ref of iterateItems(doc)) {
    const { item, path } = ref

    if ('startWord' in item) {
      if (item.endWord < item.startWord) {
        errors.push(
          timelineError(
            `${path}.endWord`,
            'BAD_WORD_RANGE',
            'A caption cannot end before the word it starts on.'
          )
        )
        continue
      }
      if (!wordsOk) continue

      const range = captionRangeSeconds(item.startWord, item.endWord, doc.words)
      if (range === null) {
        errors.push(
          timelineError(
            `${path}.startWord`,
            'BAD_WORD_RANGE',
            `This caption covers words ${item.startWord}–${item.endWord}, but the script has ${doc.words.length}.`
          )
        )
        continue
      }

      /* The cached pair is a derived value. Disagreeing with the range means
       * one of the two was edited alone, and the renderer would believe the
       * cache while the editor shows the range.
       *
       * CACHE_TOLERANCE is a FRAME, not TIME_EPSILON. resolveWordAnchors writes
       * these fields snapped to the frame grid (FRAME_SNAPPING in anchors.ts),
       * so a legitimately-resolved caption is up to half a frame off its raw
       * word times by design. Comparing at microsecond precision would reject
       * every document the resolver produces — which is how a tolerance that
       * looks stricter ends up being wrong. */
      const cacheTolerance = 1 / doc.canvas.fps
      if (item.start !== undefined && isSeconds(item.start)) {
        if (Math.abs(item.start - range.start) > cacheTolerance) {
          errors.push(
            timelineError(
              `${path}.start`,
              'STALE_RESOLUTION',
              'This caption’s start no longer matches the words it covers.'
            )
          )
        }
      }
      if (item.duration !== undefined && isSeconds(item.duration)) {
        /* Two snapped edges, so up to two frames of legitimate difference. */
        if (Math.abs(item.duration - (range.end - range.start)) > 2 * cacheTolerance) {
          errors.push(
            timelineError(
              `${path}.duration`,
              'STALE_RESOLUTION',
              'This caption’s length no longer matches the words it covers.'
            )
          )
        }
      }

      reportOutOfRange(range.start, range.end, length, path, errors)
      continue
    }

    const start = checkTimeValue(item.start, `${path}.start`, doc, errors, mustBeResolved, null)
    if (start === null) continue
    const duration = checkTimeValue(
      item.duration,
      `${path}.duration`,
      doc,
      errors,
      mustBeResolved,
      start
    )
    if (duration === null) continue

    if (start < -TIME_EPSILON) {
      errors.push(
        timelineError(`${path}.start`, 'BAD_DURATION', 'An item cannot start before the video does.')
      )
      continue
    }
    if (duration <= TIME_EPSILON) {
      errors.push(
        timelineError(
          `${path}.duration`,
          'BAD_DURATION',
          'An item needs a length greater than zero to be seen.'
        )
      )
      continue
    }

    reportOutOfRange(start, start + duration, length, path, errors)
  }
}

/* Shared by both branches above so the message and the tolerance are written
 * once. `length` of zero means an empty document, where the rule is vacuous. */
function reportOutOfRange(
  start: number,
  end: number,
  length: number,
  path: string,
  errors: ValidationError[]
): void {
  if (length <= 0) return
  if (end > length + TIME_EPSILON) {
    errors.push(
      timelineError(
        `${path}.duration`,
        'OUT_OF_RANGE',
        `This runs to ${end.toFixed(2)}s, past the end of the ${length.toFixed(2)}s video.`
      )
    )
    return
  }
  if (start > length + TIME_EPSILON) {
    errors.push(
      timelineError(`${path}.start`, 'OUT_OF_RANGE', 'This starts after the video ends.')
    )
  }
}

/* Resolves one TimeValue and reports the two ways it can be wrong. Returns the
 * seconds, or null when the caller should stop looking at this item.
 * `measuredFrom` is the item's resolved start when the value being checked is a
 * DURATION, and null when it is the start itself — a duration anchor names an
 * end, so it cannot be resolved without knowing where the item begins. See
 * DURATION_ANCHOR_IS_AN_END in time.ts. */
function checkTimeValue(
  value: TimeValue,
  path: string,
  doc: TimelineDoc,
  errors: ValidationError[],
  mustBeResolved: boolean,
  measuredFrom: number | null
): number | null {
  if (isWordAnchor(value)) {
    if (mustBeResolved) {
      errors.push(
        timelineError(
          path,
          'UNRESOLVED_ANCHOR',
          'This document is marked resolved but still points at a word instead of a time.'
        )
      )
      return null
    }
    const seconds =
      measuredFrom === null
        ? resolveTimeValue(value, doc.words)
        : resolveDuration(value, measuredFrom, doc.words)
    if (seconds === null) {
      errors.push(
        timelineError(
          path,
          'ANCHOR_NOT_FOUND',
          'This points at a word the script does not contain.'
        )
      )
      return null
    }
    return seconds
  }
  return value
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkReferences, UNKNOWN_ASSET, UNKNOWN_SPEAKER,
 *   ASSET_HANDLE_INDIRECTION
 *
 * WHAT:  Every `assetId` on an item is a key of doc.assets, and every `speaker`
 *        is a key of doc.speakers.
 * WHY:   A dangling handle is invisible until render time, where it becomes a
 *        black rectangle in a video the customer has already paid for. This is
 *        the cheapest place to catch it. See ASSET_HANDLE_INDIRECTION in
 *        schema.ts for why items hold a handle rather than a row id.
 * WHERE: validate().
 */
function checkReferences(doc: TimelineDoc, errors: ValidationError[]): void {
  for (const ref of iterateItems(doc)) {
    const { item, path } = ref

    const assetId = readAssetId(item)
    if (assetId !== undefined && !Object.hasOwn(doc.assets, assetId)) {
      errors.push(
        timelineError(
          `${path}.assetId`,
          'UNKNOWN_ASSET',
          `This item uses "${assetId}", which is not in the document’s asset list.`
        )
      )
    }

    if ('speaker' in item && item.speaker !== undefined && !Object.hasOwn(doc.speakers, item.speaker)) {
      errors.push(
        timelineError(
          `${path}.speaker`,
          'UNKNOWN_SPEAKER',
          `This item is voiced by "${item.speaker}", who is not in the document’s cast.`
        )
      )
    }

    /* Scene elements carry handles too, and a quiz card's image is exactly the
     * kind of thing that goes missing on a regeneration. */
    if ('scene' in item) {
      item.scene.elements.forEach((element, elementIndex) => {
        if (element.assetId !== undefined && !Object.hasOwn(doc.assets, element.assetId)) {
          errors.push(
            timelineError(
              `${path}.scene.elements.${elementIndex}.assetId`,
              'UNKNOWN_ASSET',
              `This element uses "${element.assetId}", which is not in the document’s asset list.`
            )
          )
        }
      })
    }
  }

  doc.words.forEach((token, index) => {
    if (token.speaker !== undefined && !Object.hasOwn(doc.speakers, token.speaker)) {
      errors.push(
        timelineError(
          `words.${index}.speaker`,
          'UNKNOWN_SPEAKER',
          `Word ${index} is attributed to "${token.speaker}", who is not in the document’s cast.`
        )
      )
    }
  })
}

function readAssetId(item: TrackItem): string | undefined {
  return 'assetId' in item ? item.assetId : undefined
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkBounds, OUT_OF_BOUNDS, CANVAS_BOUNDS
 *
 * WHAT:  Boxes and caption positions stay inside the 0..1 canvas.
 * WHY:   Normalized coordinates make an off-canvas element silent — it renders
 *        fine and is simply not in the frame, which reads as "the overlay
 *        didn't work" rather than as a bad number. Checked on the item and on
 *        each scene element.
 * WHERE: validate().
 */
function checkBounds(doc: TimelineDoc, errors: ValidationError[]): void {
  for (const ref of iterateItems(doc)) {
    const { item, path } = ref

    if ('box' in item) {
      reportBox(item.box, `${path}.box`, errors)
    }
    if ('position' in item && item.position !== undefined) {
      const { x, y } = item.position
      if (y < -BOUNDS_EPSILON || y > 1 + BOUNDS_EPSILON) {
        errors.push(
          timelineError(`${path}.position.y`, 'OUT_OF_BOUNDS', 'This caption sits off the canvas.')
        )
      }
      if (x !== undefined && (x < -BOUNDS_EPSILON || x > 1 + BOUNDS_EPSILON)) {
        errors.push(
          timelineError(`${path}.position.x`, 'OUT_OF_BOUNDS', 'This caption sits off the canvas.')
        )
      }
    }
    if ('scene' in item) {
      item.scene.elements.forEach((element, elementIndex) => {
        if (element.box !== undefined) {
          reportBox(element.box, `${path}.scene.elements.${elementIndex}.box`, errors)
        }
      })
    }
  }
}

function reportBox(box: NormalizedBox, path: string, errors: ValidationError[]): void {
  const outside =
    box.x < -BOUNDS_EPSILON ||
    box.y < -BOUNDS_EPSILON ||
    box.w <= 0 ||
    box.x + box.w > 1 + BOUNDS_EPSILON ||
    (box.h !== undefined && (box.h <= 0 || box.y + box.h > 1 + BOUNDS_EPSILON))

  if (outside) {
    errors.push(
      timelineError(path, 'OUT_OF_BOUNDS', 'This sits partly or wholly off the canvas.')
    )
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkOverlayDepth, Z_COLLISION, overlaps
 *
 * WHAT:  Two overlays that are on screen at the same moment may not claim the
 *        same `z`.
 * WHY:   Stacking order between equal depths falls back to document order,
 *        which generators do not control and the editor reorders freely — so
 *        the same document can render two different videos. Overlays that never
 *        share a moment are free to reuse a depth, which is what keeps
 *        generators from having to allocate globally unique numbers.
 * WHERE: validate().
 */
function checkOverlayDepth(
  doc: TimelineDoc,
  errors: ValidationError[],
  wordsOk: boolean
): void {
  if (!wordsOk) return

  const placed: Array<{ z: number; start: number; end: number; path: string }> = []

  for (const ref of iterateItems(doc)) {
    if (ref.track.type !== 'overlay') continue
    const item = ref.item
    if (!('z' in item)) continue

    const start = resolveTimeValue(item.start, doc.words)
    if (start === null) continue
    const duration = resolveDuration(item.duration, start, doc.words)
    if (duration === null) continue
    const span = { z: item.z, start, end: start + duration, path: ref.path }

    for (const other of placed) {
      if (other.z === span.z && overlaps(other, span)) {
        errors.push(
          timelineError(
            `${ref.path}.z`,
            'Z_COLLISION',
            `Two overlays are both at depth ${span.z} at the same time; one would hide the other unpredictably.`
          )
        )
        break
      }
    }
    placed.push(span)
  }
}

/* Touching at a boundary is not overlapping — an overlay that ends exactly as
 * the next begins is the normal way to hand off a slot. */
function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end - TIME_EPSILON && b.start < a.end - TIME_EPSILON
}
