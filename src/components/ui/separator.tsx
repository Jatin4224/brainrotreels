"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        /* Base UI renders `data-orientation="horizontal" | "vertical"` (see
           SeparatorDataAttributes), NOT bare `data-horizontal` /
           `data-vertical`. Targeting the bare attributes meant NONE of these
           rules ever matched: separators rendered with no height or width at
           all — invisible when horizontal, a zero-width sliver when vertical.

           The vertical default is a plain `h-4`, NOT `self-stretch`. A
           stretched flex item with a definite height is placed at flex-START,
           so a call site adding its own height silently lost the parent's
           `items-center` and the rule floated to the top of the row. A plain
           height keeps alignment with the parent and is overridable: it shares
           the `h-*` key, so tailwind-merge lets a call site swap it, which a
           `data-[orientation=…]:` variant could not (higher specificity). */
        "h-4 shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
