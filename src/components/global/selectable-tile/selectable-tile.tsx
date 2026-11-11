"use client"

/**
 * SOURCE OF TRUTH KEYWORDS: SelectableTile, SelectableTileProps,
 *   RADIOGROUP_NOT_A_LIST_OF_BUTTONS, ROVING_TABINDEX, tactile-control,
 *   LOCKED_NOT_HIDDEN, BackgroundPicker, CaptionStudio
 *
 * WHAT:  One option in a grid of visual choices — a bordered tile that lifts
 *        when it is the chosen one, with its preview and caption as children.
 *
 * WHY:   The background picker and the caption-style picker had this tile
 *        character-for-character identical: the same three class lines, the
 *        same checked/unchecked ternary. They LOOKED the same and behaved
 *        differently, which is the worst outcome of a copy — one was a proper
 *        `radiogroup` of `radio`s with a single roving tab stop, the other was
 *        forty `aria-pressed` toggle buttons, each its own tab stop. A person
 *        using a keyboard met two different controls that were drawn the same.
 *
 *        RADIOGROUP_NOT_A_LIST_OF_BUTTONS is settled here rather than left to
 *        the caller: picking one of several visual options IS a radio group,
 *        so the tile is always `role="radio"` and the caller supplies the
 *        group. Nothing can opt into toggle semantics by accident again.
 *
 *        LOCKED_NOT_HIDDEN: `disabled` is for work in flight, never for "your
 *        plan does not include this". A locked tile stays in the keyboard
 *        order so it can be discovered and can explain itself — which is why
 *        `onChoose` fires for it too, and the caller decides whether that
 *        means select or open the upgrade modal.
 *
 * WHERE: src/components/global/background-picker and the caption-style grid
 *        in the project editor's captions step. Pair it with
 *        `useRovingRadioGroup` on the containing element.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

export interface SelectableTileProps {
  /** Drives `aria-checked` and the raised/active look. */
  checked: boolean
  /** The accessible name — the tile's contents are decorative. */
  label: string
  /** Fires on click for locked tiles too; see LOCKED_NOT_HIDDEN. */
  onChoose: () => void
  /** ROVING_TABINDEX — true for the one tile holding the group's tab stop. */
  tabbable?: boolean
  /** Work in flight only, never a plan gate. */
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

export const SelectableTile = React.forwardRef<
  HTMLButtonElement,
  SelectableTileProps
>(function SelectableTile(
  { checked, label, onChoose, tabbable = true, disabled = false, className, children },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      disabled={disabled}
      onClick={onChoose}
      className={cn(
        "tactile-control flex flex-col gap-2 rounded-xl border p-2 text-left transition",
        "outline-none focus-ring",
        checked
          ? "border-primary bg-accent"
          : "border-border hover:bg-accent/50",
        disabled && "opacity-60",
        className
      )}
    >
      {children}
    </button>
  )
})
