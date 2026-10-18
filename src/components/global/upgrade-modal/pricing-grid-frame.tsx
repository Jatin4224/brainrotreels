/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PricingGridFrame, DASHED_CELL_STYLE,
 *   RIGHT_FADE_MASK, DASH_COLOR, CORNER_POSITIONS, PRICING_CARD_MAX_WIDTH,
 *   CARDS_DO_NOT_STRETCH, PricingCard, UpgradeContent
 *
 * WHAT:  The dashed "blueprint" frame the pricing cards sit inside — bleeding
 *        outer edge lines, crosshairs at the four corners, and the per-cell
 *        style that draws the internal grid lines.
 * WHY:   The look cannot be done with `border-dashed`: CSS dashes are tiny,
 *        unconfigurable, and double up where two cells meet. Repeating-gradient
 *        lines give exact dash length and gap, and splitting them so each CELL
 *        owns its bottom + right edge while the FRAME owns the outer four means
 *        no line is ever drawn twice, at any column count.
 *        Extracted as its own component because the frame is pure presentation
 *        that knows nothing about plans — the skeleton grid and the real card
 *        grid render inside the identical frame, which is what stops the layout
 *        from shifting when the prices arrive.
 *        Colours come from `--color-border` / `muted-foreground` through
 *        color-mix, never a literal, so the frame follows the theme.
 *        The frame also OWNS the grid's width — see PRICING_CARD_MAX_WIDTH —
 *        because the outer dashes are drawn relative to it, and a frame wider
 *        than its cards would hang its edges in empty space.
 * WHERE: <UpgradeContent /> wraps both its skeleton grid and its card grid in
 *        this; cells apply DASHED_CELL_STYLE.
 */

import * as React from 'react'
import type { CSSProperties } from 'react'

/* Semi-transparent border colour — a token, mixed rather than hardcoded, so the
 * dashes sit under the card content in both themes. */
const DASH_COLOR = 'color-mix(in srgb, var(--color-border) 50%, transparent)'

/**
 * SOURCE OF TRUTH KEYWORDS: DASHED_CELL_STYLE
 *
 * Bottom + right dashed edges for ONE grid cell. Every cell draws the same two
 * edges, so internal lines appear exactly once and the frame below closes the
 * outside.
 */
export const DASHED_CELL_STYLE: CSSProperties = {
  backgroundImage: [
    `repeating-linear-gradient(to right, ${DASH_COLOR} 0 10px, transparent 10px 20px)`,
    `repeating-linear-gradient(to bottom, ${DASH_COLOR} 0 10px, transparent 10px 20px)`,
  ].join(', '),
  backgroundSize: '100% 1.5px, 1.5px 100%',
  backgroundPosition: 'bottom left, top right',
  backgroundRepeat: 'no-repeat',
}

/**
 * SOURCE OF TRUTH KEYWORDS: RIGHT_FADE_MASK
 *
 * Fades loading content out toward the right edge, implying more columns beyond
 * the fold. Applied to the skeletons only — real content must never be masked.
 */
export const RIGHT_FADE_MASK: CSSProperties = {
  maskImage: 'linear-gradient(to right, black 0%, black 65%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, black 0%, black 65%, transparent 100%)',
}

/* Crosshairs mark only where the outer edges meet — the four corners. Internal
 * column boundaries stay bare, which is what keeps the frame minimal. */
const CORNER_POSITIONS = [0, 100] as const

function CornerCross({ position, edge }: { position: number; edge: 'top' | 'bottom' }) {
  return (
    <span
      className={cnEdge(edge)}
      style={{ left: `${position}%` }}
      aria-hidden="true"
    >
      <span className="relative block h-7 w-7">
        <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-muted-foreground/25" />
        <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-muted-foreground/25" />
      </span>
    </span>
  )
}

/* Both crosses are identical apart from which edge they hang off; the class
 * string is the only difference, so it lives in one place. */
function cnEdge(edge: 'top' | 'bottom'): string {
  return edge === 'top'
    ? 'pointer-events-none absolute top-0 z-20 -translate-x-1/2 -translate-y-1/2'
    : 'pointer-events-none absolute bottom-0 z-20 -translate-x-1/2 translate-y-1/2'
}

/**
 * SOURCE OF TRUTH KEYWORDS: PRICING_CARD_MAX_WIDTH, CARDS_DO_NOT_STRETCH
 *
 * WHAT:  The widest a single pricing card is allowed to be, in px.
 * WHY:   CARDS_DO_NOT_STRETCH. A grid that simply divides the available width
 *        gets both ends wrong: four plans on a 1024px surface squash to 256px
 *        columns where the feature lines wrap mid-phrase, and two plans on a
 *        wide screen become 600px slabs that read as panels rather than cards.
 *        Capping the CARD and letting the FRAME shrink to fit gives one shape at
 *        every plan count — the grid centres itself and the dashed edges hug the
 *        cards instead of trailing off into empty space. 320px is the width the
 *        card's own rhythm (price block, CTA, feature list) was drawn against.
 * WHERE: Both grids in <UpgradeContent /> — real cards and skeletons — size
 *        themselves through the `columns` prop below.
 */
export const PRICING_CARD_MAX_WIDTH = 320

export function PricingGridFrame({
  columns,
  children,
}: {
  /** How many card columns this frame will hold at its widest. */
  columns: number
  children: React.ReactNode
}) {
  return (
    <div
      className="relative mx-auto w-full"
      /* The frame is never wider than the cards it contains, so the dashed
       * edges and the corner crosses always land ON the grid. */
      style={{ maxWidth: `${Math.max(1, columns) * PRICING_CARD_MAX_WIDTH}px` }}
    >
      {/* Outer edges. Absolutely positioned rather than a background on the
          container so they can bleed 14px past it and overshoot at the
          corners, where the crosshairs sit. */}
      <span
        className="pointer-events-none absolute top-0 -right-3.5 -left-3.5 z-1 -translate-y-1/2"
        style={{
          height: '1.5px',
          backgroundImage: `repeating-linear-gradient(to right, ${DASH_COLOR} 0 10px, transparent 10px 20px)`,
        }}
      />
      <span
        className="pointer-events-none absolute -right-3.5 -bottom-0 -left-3.5 z-1 translate-y-1/2"
        style={{
          height: '1.5px',
          backgroundImage: `repeating-linear-gradient(to right, ${DASH_COLOR} 0 10px, transparent 10px 20px)`,
        }}
      />
      <span
        className="pointer-events-none absolute -top-3.5 -bottom-3.5 left-0 z-1 -translate-x-1/2"
        style={{
          width: '1.5px',
          backgroundImage: `repeating-linear-gradient(to bottom, ${DASH_COLOR} 0 10px, transparent 10px 20px)`,
        }}
      />
      <span
        className="pointer-events-none absolute -top-3.5 right-0 -bottom-3.5 z-1 translate-x-1/2"
        style={{
          width: '1.5px',
          backgroundImage: `repeating-linear-gradient(to bottom, ${DASH_COLOR} 0 10px, transparent 10px 20px)`,
        }}
      />

      {CORNER_POSITIONS.map((position) => (
        <React.Fragment key={position}>
          <CornerCross position={position} edge="top" />
          <CornerCross position={position} edge="bottom" />
        </React.Fragment>
      ))}

      {children}
    </div>
  )
}
