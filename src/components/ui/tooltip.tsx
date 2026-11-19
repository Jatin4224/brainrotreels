"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/* SOURCE OF TRUTH KEYWORDS: TooltipProvider, DELAY_THEN_INSTANT,
 * data-instant, overlay-pop
 *
 * THE DELAY IS THE POINT, and this defaulted to 0 — which is to say it
 * defaulted to no delay at all. A tooltip with no delay fires on every
 * incidental pass of the mouse, so dragging the pointer across a toolbar
 * leaves a trail of popups nobody asked to read. The delay exists to tell
 * "resting on this" apart from "moving past it".
 *
 * DELAY_THEN_INSTANT is the other half, and it is what makes the delay
 * affordable. Once ONE tooltip in the group is open, the person has
 * demonstrably decided to read tooltips, and making them wait another 600ms
 * per icon is the thing that makes a toolbar feel slow. `timeout` is Base
 * UI's grace period: inside it the next tooltip opens immediately, and the
 * library marks it `data-instant`, which `.overlay-pop` answers by zeroing
 * the transition. Delay once, then instant — the whole row feels quick
 * without ever firing by accident.
 *
 * `closeDelay: 0` because leaving is unambiguous: the pointer has gone, and
 * a tooltip that hangs around afterwards is just occlusion.
 *
 * Base UI's own `timeout` default is 400ms; it is stated here anyway, since
 * the three numbers only make sense read together. */
function TooltipProvider({
  delay = 600,
  closeDelay = 0,
  timeout = 400,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      closeDelay={closeDelay}
      timeout={timeout}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs overlay-pop origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background tactile-panel-sm has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
