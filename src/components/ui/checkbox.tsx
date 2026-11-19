"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        /* HALF_A_STATE_CHANGE — `transition-colors` missed `box-shadow`, and
           `.tactile-control`'s checked state is mostly box-shadow: the tick's
           fill eased while the raised edge snapped. Same list and same 160ms
           as <Button> and the category chips.
           `background-image` stays out for the reason documented there. */
        "tactile-field tactile-control peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-[color,background-color,border-color,box-shadow] duration-[160ms] ease-[var(--ease-settle)] motion-reduce:transition-none outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
