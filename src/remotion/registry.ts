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
 * SOURCE OF TRUTH KEYWORDS: RENDER_COMPONENTS, resolveRenderComponent,
 *   THE_ONLY_EXTENSION_POINT, UNKNOWN_DRAWS_NOTHING, RenderKind, RenderItemProps
 *
 * WHAT:  The map from a document item's `render` value to the component that
 *        draws it, and the lookup that never throws.
 * WHY:   THE_ONLY_EXTENSION_POINT. This file is the entire answer to "how do I
 *        add a format": Phase 12 adds a Reddit card by writing a component and
 *        adding a key HERE, and Phase 13 and 16 do the same. Nobody edits
 *        TimelineRenderer again — it walks the plan and looks components up,
 *        and it has no idea what a Reddit card is. The brief states that as a
 *        requirement and the registry is how it is kept true.
 *
 *        UNKNOWN_DRAWS_NOTHING: an unrecognised `render` value resolves to
 *        null, logs once, and the render continues. This is not defensive
 *        programming for its own sake — it is the trade architecture.md names
 *        explicitly: a missing element is recoverable, a failed render is money
 *        gone. A document written by a newer release and rendered by an older
 *        worker is the realistic way this happens, and it must degrade rather
 *        than abort.
 *
 *        `Partial<Record<…>>` rather than a full Record, deliberately. Every
 *        RenderKind that is NOT yet implemented is a documented gap rather
 *        than a compile error, so this phase can ship `media` and `text`
 *        without stub components for four unwritten formats — stubs that draw
 *        nothing are indistinguishable from the fallback, and they would hide
 *        which families actually exist.
 * WHERE: Consumed by src/remotion/timeline-renderer.tsx. The components live
 *        in src/remotion/components/.
 */

import type { ComponentType } from 'react'

import { RENDER_KINDS, type RenderKind } from '@/lib/timeline'
import type { RenderItemProps } from '@/lib/types'
import { MediaClip } from './components/media-clip'
import { TextOverlay } from './components/text-overlay'

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_COMPONENTS
 *
 * Implemented in Phase 03:
 *   media → MediaClip   (video, image; cover/contain/fill, looping, Ken Burns)
 *   text  → TextOverlay (a positioned text badge)
 *
 * Deliberately absent, each with the phase that adds it:
 *   motion           → Phase 16 (motion graphics studio)
 *   quizCard         → Phase 13 (quiz format)
 *   redditCard       → Phase 12 (Reddit story format)
 *   characterOverlay → Phase 14 (voiceover visuals)
 *
 * Captions are NOT a render kind and never will be: a caption item carries a
 * word range rather than a `render` field (WORD_RANGE_NOT_TEXT in the timeline
 * schema), so Phase 08 adds a caption LAYER to the composition rather than an
 * entry here.
 */
export const RENDER_COMPONENTS: Partial<
  Record<RenderKind, ComponentType<RenderItemProps>>
> = {
  media: MediaClip,
  text: TextOverlay,
}

/* One warning per unknown kind per process, not per frame. A 60-second render
 * is 1800 frames, and an unknown overlay would otherwise write 1800 identical
 * lines into the log that matters most when a render goes wrong. */
const warned = new Set<string>()

/**
 * SOURCE OF TRUTH KEYWORDS: resolveRenderComponent, UNKNOWN_DRAWS_NOTHING
 *
 * WHAT:  The component for a render kind, or null.
 * WHY:   Returns null rather than throwing or substituting a placeholder. A
 *        visible placeholder was the alternative and it is worse for the paid
 *        path: it would composite a box reading "unsupported" into a customer's
 *        finished video, where silence is the honest failure.
 * WHERE: TimelineRenderer, once per planned item.
 */
export function resolveRenderComponent(
  render: string | null
): ComponentType<RenderItemProps> | null {
  if (render === null) return null

  /* Narrowed against the document's own union, not against this file's keys —
   * so a VALID kind that simply has no component yet (`redditCard` until
   * Phase 12) takes the same path as a garbage value, which is correct: both
   * draw nothing and both are worth one log line. */
  const component = isRenderKind(render) ? RENDER_COMPONENTS[render] : undefined
  if (component !== undefined) return component

  if (!warned.has(render)) {
    warned.add(render)
    console.warn(
      `[remotion/registry] No component for render kind "${render}" — drawing nothing. ` +
        'Add it to RENDER_COMPONENTS in src/remotion/registry.ts.'
    )
  }
  return null
}

function isRenderKind(value: string): value is RenderKind {
  return (RENDER_KINDS as readonly string[]).includes(value)
}
