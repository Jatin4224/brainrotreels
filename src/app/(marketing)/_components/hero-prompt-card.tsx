/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: HeroPromptCard, HERO_INPUT_MODES, heroPromptSchema,
 *   HERO_MODE_TABS, AUTH_IS_A_CLICK_NOT_A_REDIRECT, EVERY_INPUT_IS_VALIDATED,
 *   THE_FIELD_IS_THE_PITCH, AUTH_CALLBACK_PARAM, authRouteWithCallback
 *
 * WHAT:  The hero's input card — four mode tabs (Idea / Script / URL /
 *        Document), one textarea whose placeholder follows the tab, and the
 *        "Make my video" button that starts the signup.
 *
 * WHY:   THE_FIELD_IS_THE_PITCH. A landing page for a tool that turns text
 *        into video should let a visitor type the text; the control IS the
 *        product demo, which is why it is a real field with real validation
 *        rather than a picture of one.
 *
 *        AUTH_IS_A_CLICK_NOT_A_REDIRECT, and this is the one place on the
 *        public surface where that needs saying twice. Submitting NAVIGATES to
 *        sign-up — a deliberate press, not a session read, and nothing on this
 *        page asks the server who the visitor is (PUBLIC_PAGE_NO_AUTH holds:
 *        this component makes no tRPC call). It is routed through
 *        `authRouteWithCallback` so the visitor lands on their projects after
 *        authenticating instead of a generic dashboard.
 *
 *        HONEST_ABOUT_THE_DRAFT: what they typed is NOT carried through signup
 *        yet, so the button says what actually happens rather than implying the
 *        video is already being made. Carrying it would mean a contract between
 *        this page and the create-project flow — a stashed draft, a consumer
 *        that reads it, and an expiry — and a half-built version of that is a
 *        visitor watching their paragraph vanish. Wiring it is a change HERE
 *        plus a read in the create-project sheet, in one go.
 *
 *        EVERY_INPUT_IS_VALIDATED — zod + React Hook Form via zodResolver, the
 *        same shadcn approach every other form in this app uses. The rules are
 *        per mode (a URL must parse) and live on `heroPromptSchema` in
 *        @/lib/types, not here: a validation rule written inside a component is
 *        a rule no other caller can reuse and no test can reach.
 *
 *        The tabs are buttons in a `radiogroup`, not links and not a `<Tabs>`:
 *        they select the MEANING of one field rather than swapping panels, so
 *        the text survives a tab change (ONE_SHAPE_FOUR_MODES) and assistive
 *        tech is told it is choosing among four options for one control.
 * WHERE: Rendered in the hero of src/app/(marketing)/page.tsx.
 */

"use client";

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
import {
  AUTH_ROUTES,
  authRouteWithCallback,
} from "@/lib/config/auth-routes";
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
 * WHAT:  How each input mode is labelled and prompted.
 * WHY:   A `Record<HeroInputMode, …>` rather than a list, so adding a mode to
 *        `HERO_INPUT_MODES` fails the typecheck here until the tab knows what
 *        to call it — a new mode cannot reach the page as a blank button. The
 *        order on screen comes from `HERO_INPUT_MODES`, so the schema and the
 *        tab row cannot disagree about which modes exist.
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
          "brutal-border brutal-shadow-lg w-full max-w-xl rounded-2xl bg-card p-2.5 text-left",
          className,
        )}
      >
        <FormField
          control={form.control}
          name="mode"
          render={({ field }) => (
            <FormItem>
              <div
                role="radiogroup"
                aria-label="What are you starting from?"
                className="flex flex-wrap items-center gap-1"
              >
                {HERO_INPUT_MODES.map((option) => {
                  const tab = HERO_MODE_TABS[option];
                  const isActive = field.value === option;

                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => field.onChange(option)}
                      className={cn(
                        "h-9 rounded-lg px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                        isActive
                          ? "bg-brand-accent font-bold text-brand-accent-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
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
                    className="min-h-11 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
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
