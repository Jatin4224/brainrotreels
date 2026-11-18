"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // The track changes colour and (when disabled) opacity. Nothing on
        // it moves, so transition-all was transitioning the width and height
        // between the two size variants for no reason.
        "tactile-field tactile-control peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-[background-color,border-color,opacity] duration-150 ease-[var(--ease-settle)] outline-none motion-reduce:transition-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-ring aria-invalid:border-destructive data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        // 150ms and a named curve. A toggle is flipped tens of times a day,
        // so this is the "fast and subtle, or nothing" tier: the travel is
        // 14px and the only job is to make the new state legible. A bare
        // transition-transform inherited Tailwind's generic ease-in-out,
        // which spends its first frames accelerating — on 14px that is most
        // of the motion.
        className="tactile-raised pointer-events-none block rounded-full bg-background transition-transform duration-150 ease-[var(--ease-settle)] motion-reduce:transition-none group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
