/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: HowItWorksDialog, HOW_IT_WORKS, HOW_IT_WORKS_STEPS,
 *   HOW_IT_WORKS_VIDEO, NO_LINK_WITHOUT_A_DESTINATION, EXPLAINER_IS_ON_DEMAND
 *
 * WHAT:  The "How it works" explainer — what the product does, in three
 *        steps, behind the button in the composer's top-right corner.
 *
 * WHY:   EXPLAINER_IS_ON_DEMAND. This is the answer to "what is this going to
 *        do with my words", and a first-time creator needs it — but on every
 *        later visit it is in the way. A dialog the customer opens is the
 *        shape that serves both: nothing is interrupted, and the button stays
 *        in the same corner so it can be found again.
 *
 *        IT IS NOT AN ONBOARDING STEP, deliberately. Nothing here tracks
 *        whether it has been seen, because a modal that appears once on its
 *        own schedule is the thing people dismiss without reading. If it
 *        should auto-open for a first project later, that is a stored flag on
 *        the user and an `open` default — not a change to this component.
 *
 *        NO_LINK_WITHOUT_A_DESTINATION: the "Watch a real build" button
 *        renders only when `HOW_IT_WORKS_VIDEO` is set, which it is not yet.
 *        See the note in ./how-it-works-content.ts — filling that constant in
 *        is the whole change.
 *
 *        The steps are a `<ol>` because they are a sequence and their order is
 *        the content; the numerals in the discs are decoration on top of the
 *        list's own numbering, so a screen reader hears "1" once rather than
 *        twice.
 *
 * WHERE: Rendered by ./composer-screen.tsx, which owns the trigger button.
 */

import Link from "next/link";
import type { Route } from "next";
import { BrainIcon, PlayIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  HOW_IT_WORKS,
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_VIDEO,
} from "./how-it-works-content";

export interface HowItWorksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HowItWorksDialog({
  open,
  onOpenChange,
}: HowItWorksDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[42rem]">
        <DialogHeader className="gap-2 p-6 pb-4 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
            <SparklesIcon
              className="size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            {HOW_IT_WORKS.title}
          </DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-muted-foreground">
            {HOW_IT_WORKS.lead}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex list-none flex-col gap-5 px-6 pb-5">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3.5">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary"
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-bold text-foreground">{step.title}</span>
                <span className="text-[15px] leading-relaxed text-muted-foreground">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <p className="mx-6 mb-6 flex gap-3 rounded-xl bg-secondary p-4 text-[15px] leading-relaxed text-muted-foreground">
          <BrainIcon
            className="mt-0.5 size-4 shrink-0 text-cat-market"
            aria-hidden="true"
          />
          {HOW_IT_WORKS.note}
        </p>

        <DialogFooter className="gap-3 border-t border-border p-5">
          {/* Rendered only when there is something to watch. */}
          {HOW_IT_WORKS_VIDEO ? (
            <Button
              variant="outline"
              size="lg"
              className="h-11 gap-2 rounded-xl px-5 text-[15px] font-medium"
              render={<Link href={HOW_IT_WORKS_VIDEO.src as Route} />}
            >
              <PlayIcon className="size-4 fill-current" aria-hidden="true" />
              {`${HOW_IT_WORKS.watch} (${HOW_IT_WORKS_VIDEO.duration})`}
            </Button>
          ) : null}

          <DialogClose
            render={
              <Button
                size="lg"
                className="h-11 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground"
              />
            }
          >
            {HOW_IT_WORKS.dismiss}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
