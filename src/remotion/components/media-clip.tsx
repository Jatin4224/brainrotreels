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
 * SOURCE OF TRUTH KEYWORDS: MediaClip, mediaClipPropsSchema, KEN_BURNS,
 *   LOOP_VIA_REMOTION_LOOP, MISSING_ASSET_DRAWS_NOTHING, OBJECT_FIT_FROM_DOCUMENT,
 *   NO_NETWORK_FALLBACK
 *
 * WHAT:  Draws one video or image item: the document's `fit`, optional looping
 *        for a source shorter than the item, muting and gain, and an optional
 *        Ken Burns drift for stills.
 * WHY:   MISSING_ASSET_DRAWS_NOTHING — an item whose handle has no URL renders
 *        `null`. Three ordinary situations produce that (an ingest still
 *        running, an asset deleted after the document referenced it, a signing
 *        refusal), and all three must leave a gap rather than fail the render:
 *        a missing clip is recoverable, a failed paid render is not. The same
 *        rule as the registry's unknown-kind fallback, applied to media.
 *
 *        LOOP_VIA_REMOTION_LOOP: a background shorter than the narration is
 *        looped with Remotion's `<Loop>`, NOT by setting `loop` on the element.
 *        Remotion renders frames out of order and in parallel, so an element's
 *        own looping has an internal playhead that cannot be relied on;
 *        `<Loop>` mounts the repetition belonging to the current frame, which
 *        keeps a frame a pure function of its number. That is what Phase 04's
 *        render reuse depends on.
 *
 *        OBJECT_FIT_FROM_DOCUMENT: `fit` comes from the item, defaulting to
 *        `cover`, because the decision belongs to whoever authored the
 *        document — the ingest already produced a 9:16 master, so a `cover`
 *        here is normally a no-op, and `contain` is the deliberate escape for
 *        material that must not be cropped twice.
 *
 *        NO_NETWORK_FALLBACK: there is no placeholder image, no spinner and no
 *        remote default. Anything fetched at render time that is not the
 *        customer's own media is a way for a render to vary between runs.
 * WHERE: Registered as `media` in src/remotion/registry.ts. Used by video
 *        items and by overlay items whose render is `media`.
 */

import { Loop, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

import type { RenderItemProps } from '@/lib/types'

/**
 * SOURCE OF TRUTH KEYWORDS: mediaClipPropsSchema, PARSE_AT_THE_COMPONENT
 *
 * WHAT:  The fields MediaClip reads off its item.
 * WHY:   PARSE_AT_THE_COMPONENT. The walker hands every component the same
 *        loose `item` shape (RENDER_COMPONENT_CONTRACT), so each component
 *        narrows what IT needs — which is both the only way to keep the walker
 *        format-agnostic and a genuine safety boundary, because the props
 *        crossed a JSON serialisation on the way here (Remotion ships them to
 *        each render worker, and Phase 04 ships them to Lambda).
 *
 *        It is a SUBSET of the item, not the item's own schema: an overlay item
 *        and a video item both arrive here and they differ in fields MediaClip
 *        does not care about, so a strict parse of either would reject the
 *        other. The permissive-but-typed read is the point.
 * WHERE: The parse at the top of MediaClip.
 */
const mediaClipPropsSchema = z.object({
  assetId: z.string().min(1).optional(),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  loop: z.boolean().default(false),
  muted: z.boolean().default(true),
  gain: z.number().min(0).max(4).optional(),
  /* Overlay items carry a normalized box; video items fill the canvas. */
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number().optional(),
    })
    .optional(),
  props: z
    .object({
      /* Ken Burns is opt-in per item and lives in the open `props` bag rather
       * than on the schema, because it is a presentation knob for one component
       * family — exactly what SceneElement.props exists for. Phase 15's editor
       * exposes it; a generator can set it today. */
      kenBurns: z.boolean().optional(),
      kenBurnsScale: z.number().min(1).max(2).optional(),
    })
    .partial()
    .passthrough()
    .optional(),
})

/** How much a Ken Burns drift scales by over the item's whole span. 8% is
 *  enough to read as motion on a phone without turning into a zoom. */
const KEN_BURNS_DEFAULT_SCALE = 1.08

export function MediaClip({ item, assets, frames, canvas }: RenderItemProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const parsed = mediaClipPropsSchema.safeParse(item)
  if (!parsed.success) return null

  const { assetId, fit, loop, muted, gain, box, props } = parsed.data
  if (assetId === undefined) return null

  const asset = assets[assetId]
  /* MISSING_ASSET_DRAWS_NOTHING — see the file header. */
  if (asset === undefined || asset.url === null) return null

  const url = asset.url

  /* An overlay's box is normalized (1 = full width), so it becomes pixels
   * here — the one place the canvas size enters the component. A video item
   * has no box and fills the frame. */
  const layout: React.CSSProperties =
    box === undefined
      ? { position: 'absolute', inset: 0 }
      : {
          position: 'absolute',
          left: box.x * canvas.width,
          top: box.y * canvas.height,
          width: box.w * canvas.width,
          ...(box.h !== undefined ? { height: box.h * canvas.height } : {}),
        }

  /* KEN_BURNS — a linear drift computed from the frame, so it is a pure
   * function of time and identical on every run. Deliberately linear rather
   * than eased: an eased drift needs an easing curve in the document to be
   * reproducible, and that belongs to Phase 16's motion work. */
  const kenBurns = props?.kenBurns === true
  const scaleTo = props?.kenBurnsScale ?? KEN_BURNS_DEFAULT_SCALE
  /* `frame` is already item-relative — the walker mounts this inside the
   * item's own Sequence (FRAMES_ARE_RELATIVE_INSIDE on RenderItemProps), so
   * subtracting `frames.from` here would push every progress negative. */
  const progress =
    frames.durationInFrames <= 1
      ? 0
      : Math.min(1, Math.max(0, frame / (frames.durationInFrames - 1)))
  const transform = kenBurns ? `scale(${1 + (scaleTo - 1) * progress})` : undefined

  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: fit,
    ...(transform !== undefined ? { transform } : {}),
  }

  if (asset.kind === 'image') {
    return (
      <div style={layout}>
        {/* A plain <img>, not next/image: this tree is rendered by Remotion's
            own bundler in a headless browser, where Next's loader does not
            exist. The URL is already a signed, short-lived one. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img src={url} alt="" style={mediaStyle} />
      </div>
    )
  }

  /* LOOP_VIA_REMOTION_LOOP. Without a known source length there is nothing to
   * loop against (LOOP_IS_A_MODULO), so the clip plays once and holds. */
  const sourceLength = asset.durationInSeconds
  const shouldLoop =
    loop && sourceLength !== undefined && sourceLength > 0 && frames.durationInFrames / fps > sourceLength

  const volume = muted ? 0 : (gain ?? 1)

  if (!shouldLoop) {
    return (
      <div style={layout}>
        <OffthreadVideo src={url} muted={muted} volume={volume} style={mediaStyle} />
      </div>
    )
  }

  /* Remotion's own <Loop>, not a hand-rolled list of sequences and not the
   * `loop` attribute on the element. <Loop> mounts the repetition that belongs
   * to the current frame, which is what keeps a frame a pure function of its
   * number — the element's own `loop` has an internal playhead that Remotion's
   * out-of-order frame rendering cannot rely on. It also trims the final
   * repetition to the parent sequence for free. */
  const sourceFrames = Math.max(1, Math.round(sourceLength * fps))

  return (
    <div style={layout}>
      <Loop durationInFrames={sourceFrames} layout="none">
        <OffthreadVideo src={url} muted={muted} volume={volume} style={mediaStyle} />
      </Loop>
    </div>
  )
}
