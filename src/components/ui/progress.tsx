"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * SOURCE OF TRUTH KEYWORDS: Progress, progressVariants, ProgressProps,
 *   tactile-track, PROGRESS_IS_ONE_COMPONENT, DECORATIVE_BAR, VALUE_IS_ARIA,
 *   INDICATOR_TONE_IS_THE_CALLERS, ROOT_IS_LAYOUT_TRACK_IS_THE_GROOVE
 *
 * WHAT:  The one progress/meter bar: a recessed groove with a fill sized from
 *        `value`.
 *
 * WHY:   PROGRESS_IS_ONE_COMPONENT. This existed FIVE times by hand — the
 *        usage meter, the sidebar plan meter, the render panel, the upload
 *        list and the portal's failure-rate bars — and the copies had already
 *        drifted on both axes that matter. Two had lost `tactile-track`, so
 *        they were flat pills beside four recessed grooves. Two had no
 *        `role="progressbar"` at all, and one of those is the RENDER bar, the
 *        longest-running and most-watched indicator in the product: a screen
 *        reader could read the percentage from the text beside it, but was
 *        never told the value had changed. One had lost `rounded-full` on the
 *        fill, giving a square edge inside a round groove. A shared component
 *        is what stops the sixth copy from drifting again.
 *
 *        VALUE_IS_ARIA. Base UI's Progress owns `role="progressbar"`,
 *        `aria-valuenow/min/max` and the fill width, so none of it can be
 *        forgotten per call site — which is precisely how two of the five came
 *        to be missing it.
 *
 *        ROOT_IS_LAYOUT_TRACK_IS_THE_GROOVE. `className` lands on the ROOT,
 *        because that is the element a parent lays out — the ops console makes
 *        the bar a `flex-1` child of a row. The groove's own look (height,
 *        recess, fill colour) is `trackClassName`. Collapsing the two onto one
 *        prop reads tidier and then cannot express that layout.
 *
 *        INDICATOR_TONE_IS_THE_CALLERS. The fill colour is a className, not a
 *        `tone` enum, because every caller derives it from its OWN domain
 *        rule: at-cap vs approaching-cap for usage, a failure-rate threshold
 *        for the ops console, plain brand for a render. An enum would have to
 *        learn all of those; a class seam learns none of them.
 *
 *        DECORATIVE_BAR: a bar whose value is already written in the text
 *        beside it gets announced twice unless it opts out, so `decorative`
 *        hides it rather than making every caller remember `aria-hidden`.
 *
 * WHERE: usage-meter, sidebar/plan-meter, render-panel, media-upload and the
 *        portal video-ops console.
 */

const progressVariants = cva(
  "tactile-track w-full overflow-hidden rounded-full bg-muted",
  {
    variants: {
      size: {
        sm: "h-1",
        default: "h-1.5",
        lg: "h-2",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

export interface ProgressProps
  extends Omit<ProgressPrimitive.Root.Props, "className">,
    VariantProps<typeof progressVariants> {
  /** Accessible name. Required unless the bar is `decorative`. */
  label?: string
  /**
   * The value is already in adjacent text, so the bar is hidden from assistive
   * tech instead of repeating it.
   */
  decorative?: boolean
  /** Layout only — the root is what a parent positions. */
  className?: string
  /** The groove itself: height override, a different track fill. */
  trackClassName?: string
  /** Tone of the fill — see INDICATOR_TONE_IS_THE_CALLERS. */
  indicatorClassName?: string
}

function Progress({
  className,
  trackClassName,
  indicatorClassName,
  size,
  label,
  decorative = false,
  value,
  ...props
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("w-full", className)}
      {...(decorative ? { "aria-hidden": true } : {})}
      {...(label !== undefined && !decorative ? { "aria-label": label } : {})}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className={cn(progressVariants({ size }), trackClassName)}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          /* REDUCED_MOTION_IS_NOT_OPTIONAL — one caller had the opt-out and
             four did not, which is the kind of thing only a shared component
             fixes for good. */
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none",
            indicatorClassName
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress, progressVariants }
