/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: HeroPromptCard, HERO_INPUT_MODES, heroPromptSchema,
 * HERO_MODE_TABS, AUTH_IS_A_CLICK_NOT_A_REDIRECT, EVERY_INPUT_IS_VALIDATED,
 * THE_FIELD_IS_THE_PITCH, AUTH_CALLBACK_PARAM, authRouteWithCallback
 *
 * WHAT: The hero's input card — four mode tabs (Idea / Script / URL /
 * Document), one textarea whose placeholder follows the tab, and the
 * "Make my video" button that starts the signup.
 *
 * WHY: THE_FIELD_IS_THE_PITCH. A landing page for a tool that turns text
 * into video should let a visitor type the text; the control IS the
 * product demo, which is why it is a real field with real validation
 * rather than a picture of one.
 *
 * AUTH_IS_A_CLICK_NOT_A_REDIRECT, and this is the one place on the
 * public surface where that needs saying twice. Submitting NAVIGATES to
 * sign-up — a deliberate press, not a session read, and nothing on this
 * page asks the server who the visitor is (PUBLIC_PAGE_NO_AUTH holds:
 * this component makes no tRPC call). It is routed through
 * `authRouteWithCallback` so the visitor lands on their projects after
 * authenticating instead of a generic dashboard.
 *
 * HONEST_ABOUT_THE_DRAFT: what they typed is NOT carried through signup
 * yet, so the button says what actually happens rather than implying the
 * video is already being made. Carrying it would mean a contract between
 * this page and the create-project flow — a stashed draft, a consumer
 * that reads it, and an expiry — and a half-built version of that is a
 * visitor watching their paragraph vanish. Wiring it is a change HERE
 * plus a read in the create-project sheet, in one go.
 *
 * EVERY_INPUT_IS_VALIDATED — zod + React Hook Form via zodResolver, the
 * same shadcn approach every other form in this app uses. The rules are
 * per mode (a URL must parse) and live on `heroPromptSchema` in
 * @/lib/types, not here: a validation rule written inside a component is
 * a rule no other caller can reuse and no test can reach.
 *
 * The tabs are buttons in a `radiogroup`, not links and not a `<Tabs>`:
 * they select the MEANING of one field rather than swapping panels, so
 * the text survives a tab change (ONE_SHAPE_FOUR_MODES) and assistive
 * tech is told it is choosing among four options for one control.
 * WHERE: Rendered in the hero of src/app/(marketing)/page.tsx.
 */

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { AUTH_ROUTES, authRouteWithCallback } from "@/lib/config/auth-routes";
import { ROUTES } from "@/lib/config/routes";
import {
  HERO_INPUT_MODES,
  heroPromptSchema,
  type HeroInputMode,
  type HeroPromptValues,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * SOURCE OF TRUTH KEYWORDS: HERO_MODE_TABS, HeroInputMode
 *
 * WHAT: How each input mode is labelled and prompted.
 * WHY: A `Record<HeroInputMode, …>` rather than a list, so adding a mode to
 * `HERO_INPUT_MODES` fails the typecheck here until the tab knows what
 * to call it — a new mode cannot reach the page as a blank button. The
 * order on screen comes from `HERO_INPUT_MODES`, so the schema and the
 * tab row cannot disagree about which modes exist.
 * WHERE: The tab row and the textarea placeholder below.
 */
const HERO_MODE_TABS: Record<
  HeroInputMode,
  { label: string; placeholder: string }
> = {
  idea: {
    label: "Idea",
    placeholder: "Why octopuses have three hearts…",
  },
  script: {
    label: "Script",
    placeholder: "Paste the script you already wrote…",
  },
  url: {
    label: "URL",
    placeholder: "https://reddit.com/r/… or any article link",
  },
  document: {
    label: "Document",
    placeholder: "Paste the text of your doc, deck or newsletter…",
  },
};

/* ONE GEOMETRY, TWO LAYERS. Both the real buttons and the highlight overlay
   wear this, so the overlay sits exactly on top of the button it is
   highlighting. The weight is the same in both states on purpose: the active
   tab used to be font-bold while the others were semibold, so selecting a tab
   CHANGED ITS WIDTH and nudged the row. The yellow pill is the emphasis; the
   letters do not need to thicken as well. */
const TAB_SHAPE = "h-9 shrink-0 rounded-lg px-4 text-sm font-semibold";

export function HeroPromptCard({ className }: { className?: string }) {
  const router = useRouter();

  const form = useForm<HeroPromptValues>({
    resolver: zodResolver(heroPromptSchema),
    defaultValues: { mode: "idea", value: "" },
    mode: "onSubmit",
  });

  /* useWatch, not form.watch(): the watch() function cannot be memoized, so
   * it re-renders this component on EVERY keystroke in the textarea. The
   * subscription only needs to fire when the TAB changes. */
  const mode = useWatch({ control: form.control, name: "mode" });

  /* THE SELECTION MOVES, IT DOES NOT TELEPORT. The pill used to be a
     background-color on whichever button was active, so switching tabs faded
     yellow out in one place and in at another and the eye lost track of it.
     A duplicate row carries the active skin and is CLIPPED to the active
     tab, so transitioning the clip slides one pill between tabs and the text
     underneath flips colour exactly at the pill's edge — something no pair
     of colour transitions can do.

     clip-path and not width/left: it is the sanctioned fourth animatable
     property, it never touches layout, and all four edges are measured so a
     row that wraps on a narrow screen still clips to the right box. */
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root) return;

    const measure = () => {
      const active = root.querySelector<HTMLElement>("[data-tab-active=true]");
      if (!active) return;
      const box = root.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const tab = active.getBoundingClientRect();
      const pct = (value: number, total: number) =>
        `${((value / total) * 100).toFixed(3)}%`;
      setHighlight(
        `inset(${pct(tab.top - box.top, box.height)} ${pct(box.right - tab.right, box.width)} ${pct(box.bottom - tab.bottom, box.height)} ${pct(tab.left - box.left, box.width)})`,
      );
    };

    measure();
    /* Re-measure on resize: the clip is a percentage of a box whose width
       changes with the viewport, and a stale clip lands the pill off the tab. */
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [mode]);
  const activeTab = HERO_MODE_TABS[mode];

  /* Validation has already passed by the time this runs — see
   * HONEST_ABOUT_THE_DRAFT for why the text itself stops here. */
  const onSubmit = () => {
    router.push(authRouteWithCallback(AUTH_ROUTES.signUp, ROUTES.dashboard));
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn(
          "brutal-border brutal-shadow-lg focus-ring-within w-full max-w-xl rounded-2xl bg-card p-2.5 text-left",
          className,
        )}
      >
        <FormField
          control={form.control}
          name="mode"
          render={({ field }) => (
            <FormItem>
              <div
                ref={tabsRef}
                role="radiogroup"
                aria-label="What are you starting from?"
                className="relative flex flex-wrap items-center gap-1"
              >
                {HERO_INPUT_MODES.map((option) => {
                  const tab = HERO_MODE_TABS[option];
                  const isActive = field.value === option;

                  return (
                    /* The pill lives on the overlay below, so these carry
                       only type colour. The active one BRIGHTENS rather than
                       inverting: until hydration measures the clip there is
                       no pill yet, and dark-on-dark text would be unreadable
                       for that moment. */
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      data-tab-active={isActive}
                      onClick={() => field.onChange(option)}
                      className={cn(
                        TAB_SHAPE,
                        "relative z-10 transition-colors outline-none focus-ring motion-reduce:transition-none",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                        isActive && highlight !== null
                          ? "text-brand-accent-foreground"
                          : "",
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}

                {/* The moving pill. Decorative and inert — the real controls
                    are the buttons above, which keep the roles, the checked
                    state and the focus ring. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 flex flex-wrap items-center gap-1",
                    "transition-[clip-path,opacity] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none",
                    highlight === null ? "opacity-0" : "opacity-100",
                  )}
                  style={
                    highlight === null ? undefined : { clipPath: highlight }
                  }
                >
                  {HERO_INPUT_MODES.map((option) => (
                    <span
                      key={option}
                      className={cn(
                        TAB_SHAPE,
                        "flex items-center bg-brand-accent text-brand-accent-foreground",
                      )}
                    >
                      {HERO_MODE_TABS[option].label}
                    </span>
                  ))}
                </span>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem className="mt-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <FormControl>
                  {/* A ROWS-1 TEXTAREA, not an <input>: it looks like the
                      single-line field the design asks for, but Script and
                      Document mean pasting several paragraphs, and an <input>
                      silently makes that miserable. Enter submits (below), so
                      it behaves like the input it resembles. */}
                  <Textarea
                    {...field}
                    rows={1}
                    aria-label={`${activeTab.label} input`}
                    placeholder={activeTab.placeholder}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void form.handleSubmit(onSubmit)();
                      }
                    }}
                    className="min-h-11 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none!"
                  />
                </FormControl>

                <Button
                  type="submit"
                  size="lg"
                  className="brutal-shadow-brand h-11 shrink-0 rounded-xl bg-brand px-5 text-sm font-bold text-brand-foreground hover:bg-brand/90"
                >
                  Generate
                  <ArrowRightIcon className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <FormMessage className="px-3 pb-1" />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
