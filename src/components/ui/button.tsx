import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// PRESS_IS_NAMED_PROPERTIES. This was `transition-all`, which is the one
// transition value that can never be correct: it animates every property that
// happens to change, so swapping a label for a spinner (AuthSubmit does
// exactly that) animated the button's WIDTH for 150ms, and a size variant
// change animated its height. The press is `transform`; the skins are colour
// and shadow; nothing else here should move at all.
//
// 160ms is the top of the press-feedback band — the same 1px answer, now on a
// curve that moves on the first frame instead of easing into it. --ease-settle
// is the product's one deceleration curve, not a second one invented here.
//
// The 1px press (`active:translate-y-px`) is kept exactly as it was:
// PRESS_IS_FOR_THINGS_THAT_PRESS in globals.css documents 1px as this app's
// press language, sized independently of the control, and a scale(0.97) here
// would fork it for every button in the product.
//
// motion-reduce drops the easing rather than the feedback: the press and the
// hover still happen, they just arrive instantly. Fewer and gentler, not
// nothing — a control that stops answering is not an accessibility win.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-[160ms] ease-[var(--ease-settle)] outline-none select-none focus-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // TACTILE_UI: `bg-primary` stays as the flat fallback under the
        // gradient `.tactile-primary` paints, so a browser without color-mix()
        // still renders a solid primary button. Hover/active live in the
        // utility, not here, because a `hover:bg-*` colour would sit UNDER the
        // gradient image and never show.
        // TACTILE_UI: `.tactile-primary` is a translucent wash, so `bg-primary`
        // is the real fill and a caller passing its own `bg-*` (the landing
        // page hands these `bg-brand`) keeps it and still gets lit from above.
        // Hover/active live in the utility, not here: a `hover:bg-*` colour
        // sits UNDER the wash, so the state change has to be part of it.
        default: "tactile-primary bg-primary text-primary-foreground",
        // `border-border` must stay a UTILITY — the base carries
        // `border-transparent`, and Tailwind v4 orders utilities AFTER the
        // components layer, so a border-color set inside `.tactile-surface`
        // would lose to it and the edge would come out invisible.
        outline:
          "tactile-surface border-border bg-background text-foreground aria-expanded:text-foreground dark:border-input dark:bg-input/30",
        // One step quieter than `outline`: the flat tinted fill keeps its own
        // hover, and only the 1px inner top edge is borrowed from the tactile
        // set — a gradient here would read as a second outline button.
        secondary:
          "tactile-inlay bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive [--focus-ring-color:var(--destructive)] hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
