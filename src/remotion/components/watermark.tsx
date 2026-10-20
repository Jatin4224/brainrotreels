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
 * SOURCE OF TRUTH KEYWORDS: Watermark, WATERMARK_IS_NOT_A_TRACK_ITEM,
 *   WATERMARK_BY_ENTITLEMENT, RENDER_COLOURS_ARE_LITERAL,
 *   WATERMARK_MUST_SURVIVE_A_CROP, DETERMINISM
 *
 * WHAT:  The free-plan watermark: the product's name over the bottom of every
 *        frame of a render a workspace is not entitled to export clean.
 *
 * WHY:   WATERMARK_IS_NOT_A_TRACK_ITEM, and this is why it is a component
 *        rather than an overlay the pipeline appends to the document. An
 *        overlay item would be IN the document, which means it would be
 *        covered by `hashDoc`, visible to the editor, deletable by a customer
 *        with the Phase 15 timeline in front of them, and decided by whatever
 *        generated the document — which the phase forbids outright. Drawing it
 *        here, from a prop, outside the walked plan, makes it something only
 *        the renderer can add and nothing in the document can remove.
 *
 *        It is mounted ABOVE every track for the same reason: the walker
 *        composites items by layer (LAYER_ORDER), and a watermark that
 *        participated in that ordering could be painted over by any full-frame
 *        clip. It sits outside the walk entirely.
 *
 *        WATERMARK_MUST_SURVIVE_A_CROP. Positioned in from the bottom by a
 *        fraction of the HEIGHT rather than flush to the edge, because the
 *        obvious way to remove a bottom-edge watermark is to crop a few
 *        percent off the frame — which a phone editor does in two taps. Inset
 *        far enough that cropping it out costs a visible slice of the video.
 *        It is also deliberately NOT fully opaque: a watermark that ruins the
 *        video is one nobody will pay to remove, because they will not use the
 *        product at all.
 *
 *        RENDER_COLOURS_ARE_LITERAL: the same documented exception as
 *        TextOverlay, for the same reason. These pixels are composited by a
 *        headless browser with no stylesheet and no CSS variables, so a theme
 *        token would render as the browser default — read the note on that
 *        component before changing either.
 *
 *        DETERMINISM: static. No clock, no randomness, and no dependence on
 *        `useCurrentFrame()` — it is identical on every frame, which is both
 *        what a watermark should be and what keeps two renders of one document
 *        byte-identical.
 * WHERE: Mounted by TimelineRenderer when its `watermark` prop is true, which
 *        is set by the render pre-flight from
 *        `checkBooleanFeature(organizationId, 'watermarkFree')` — see
 *        WATERMARK_RESOLVED_ONCE in src/trpc/routers/renders.ts.
 */

import { AbsoluteFill } from 'remotion'

import { APP_NAME } from '@/lib/config/branding'
import { RENDER_FONT_FAMILY } from '../fonts'

/* All three are fractions of the canvas, never pixels — the same rule as
 * PIXELS_FROM_NORMALIZED_BOX, so the mark is the same proportion of the frame
 * at 720p, at 1080p and in a 270-wide preview. */
const SIZE_RATIO = 0.028
const BOTTOM_INSET_RATIO = 0.06

const MARK_COLOR = 'rgba(245, 245, 245, 0.92)'

/**
 * SOURCE OF TRUTH KEYWORDS: WATERMARK_NEEDS_ITS_OWN_BACKGROUND
 *
 * WHY:   A dark pill behind the text, not a text-shadow. The first version of
 *        this component used near-white text with a soft shadow, exactly like
 *        TextOverlay — and a real render proved it invisible: the frame
 *        happened to have a white vertical band under the mark, and the word
 *        simply disappeared into it. A shadow spreads a few pixels and cannot
 *        save light-on-light.
 *
 *        That is not a cosmetic bug for a watermark specifically. A watermark
 *        that vanishes over pale footage is a free export for anyone whose
 *        video has a bright bottom third, which is most screen recordings and
 *        every white-background explainer. The pill guarantees contrast
 *        whatever is behind it.
 *
 *        Kept translucent rather than solid so it still reads as an overlay on
 *        the video instead of a bar stuck across it — legible without ruining
 *        the frame, which is the balance the component header describes.
 */
const MARK_BACKDROP = 'rgba(0, 0, 0, 0.45)'

export function Watermark({ canvas }: { canvas: { width: number; height: number } }) {
  return (
    <AbsoluteFill
      style={{
        /* `none` so the mark cannot intercept anything in the Player's
         * preview — the render has no pointer, but the preview does, and a
         * full-frame overlay would swallow the scrubber's clicks. */
        pointerEvents: 'none',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: BOTTOM_INSET_RATIO * canvas.height,
      }}
    >
      <span
        style={{
          fontFamily: RENDER_FONT_FAMILY,
          fontWeight: 700,
          fontSize: SIZE_RATIO * canvas.height,
          letterSpacing: '0.04em',
          color: MARK_COLOR,
          /* WATERMARK_NEEDS_ITS_OWN_BACKGROUND — see the note on
           * MARK_BACKDROP. All four values scale off the canvas for the same
           * reason the font size does. */
          backgroundColor: MARK_BACKDROP,
          paddingLeft: SIZE_RATIO * canvas.height * 0.7,
          paddingRight: SIZE_RATIO * canvas.height * 0.7,
          paddingTop: SIZE_RATIO * canvas.height * 0.3,
          paddingBottom: SIZE_RATIO * canvas.height * 0.3,
          borderRadius: SIZE_RATIO * canvas.height * 0.5,
          /* The mark must never wrap: a two-line watermark is a layout
           * accident, and the name is short by definition. */
          whiteSpace: 'nowrap',
        }}
      >
        {APP_NAME}
      </span>
    </AbsoluteFill>
  )
}
