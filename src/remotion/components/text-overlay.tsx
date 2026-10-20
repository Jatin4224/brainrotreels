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
 * SOURCE OF TRUTH KEYWORDS: TextOverlay, textOverlayPropsSchema,
 *   PIXELS_FROM_NORMALIZED_BOX, BUNDLED_FONT_ONLY, NOT_A_CAPTION,
 *   RENDER_COLOURS_ARE_LITERAL
 *
 * WHAT:  A positioned line of text over the video — a badge, a call to action,
 *        a label.
 * WHY:   NOT_A_CAPTION, and the distinction is load-bearing. A caption carries
 *        a word RANGE and reads its text from `doc.words` so it can never
 *        desynchronise from the audio (WORD_RANGE_NOT_TEXT in the timeline
 *        schema); Phase 08 draws those as their own layer with their own
 *        timing. This component draws text the document states literally, on
 *        the item's own span, and must never be used for speech.
 *
 *        PIXELS_FROM_NORMALIZED_BOX: the box is 0..1 of the canvas, so the
 *        same document lays out identically at 1080×1920 and in a 270-wide
 *        preview. The font size scales off the canvas height for the same
 *        reason — a fixed `48px` would be a different proportion of the frame
 *        at every size, which is how a preview stops matching its render.
 *
 *        RENDER_COLOURS_ARE_LITERAL. Every other component in this codebase is
 *        forbidden from hardcoding colour and must use theme tokens; this one
 *        is the documented exception, and it is not a lapse. These pixels are
 *        composited into an MP4 by a headless browser that has no stylesheet,
 *        no CSS variables and no light/dark mode — a `text-foreground` here
 *        would render as the browser default and the video's text would be
 *        black on dark gameplay footage. Phase 08 moves these values into the
 *        document's own palette (`doc.style.paletteId`), which is where a
 *        render's appearance belongs.
 *
 *        BUNDLED_FONT_ONLY: the family comes from ../fonts, which loads a
 *        woff2 out of `public/`. Never a system stack — the render machine and
 *        the developer's laptop do not have the same fonts installed, so a
 *        system stack silently produces a different video per machine.
 * WHERE: Registered as `text` in src/remotion/registry.ts.
 */

import { z } from 'zod'

import type { RenderItemProps } from '@/lib/types'
import { RENDER_FONT_FAMILY } from '../fonts'

const textOverlayPropsSchema = z.object({
  text: z.string().optional(),
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
      align: z.enum(['left', 'center', 'right']).optional(),
      /* A fraction of the canvas HEIGHT, not a pixel size — see
       * PIXELS_FROM_NORMALIZED_BOX. 0.035 of 1920 is ~67px. */
      sizeRatio: z.number().min(0.005).max(0.2).optional(),
      weight: z.union([z.literal(400), z.literal(700)]).optional(),
    })
    .partial()
    .passthrough()
    .optional(),
})

const DEFAULT_SIZE_RATIO = 0.035

/* The composited palette for this phase. Deliberately only two values, both
 * chosen to stay legible over arbitrary footage: near-white text with a dark
 * shadow behind it. Phase 08 replaces this with doc.style.paletteId. */
const TEXT_COLOR = '#f5f5f5'
const TEXT_SHADOW = '0 2px 12px rgba(0, 0, 0, 0.75)'

export function TextOverlay({ item, canvas }: RenderItemProps) {
  const parsed = textOverlayPropsSchema.safeParse(item)
  if (!parsed.success) return null

  const { text, box, props } = parsed.data
  /* An empty string is not a missing value, but it draws nothing either way —
   * and a document with a blank badge is a generator bug worth seeing as a
   * gap rather than as an invisible element with a shadow. */
  if (text === undefined || text.trim().length === 0) return null

  const align = props?.align ?? 'center'
  const sizeRatio = props?.sizeRatio ?? DEFAULT_SIZE_RATIO
  const weight = props?.weight ?? 700

  const layout: React.CSSProperties =
    box === undefined
      ? { position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end' }
      : {
          position: 'absolute',
          left: box.x * canvas.width,
          top: box.y * canvas.height,
          width: box.w * canvas.width,
          ...(box.h !== undefined ? { height: box.h * canvas.height } : {}),
          display: 'flex',
          alignItems: 'center',
        }

  return (
    <div style={layout}>
      <p
        style={{
          margin: 0,
          width: '100%',
          fontFamily: RENDER_FONT_FAMILY,
          fontWeight: weight,
          fontSize: sizeRatio * canvas.height,
          lineHeight: 1.15,
          textAlign: align,
          color: TEXT_COLOR,
          textShadow: TEXT_SHADOW,
          /* A long call-to-action must wrap rather than overflow its box and
           * bleed off the frame. */
          overflowWrap: 'break-word',
        }}
      >
        {text}
      </p>
    </div>
  )
}
