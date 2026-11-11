/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FaqAccordion, FaqAccordionProps, FaqItem,
 * Collapsible, ONE_OPEN_AT_A_TIME, DISCLOSURE_IS_REUSABLE
 *
 * WHAT: A list of question/answer disclosures — one open at a time by
 * default, each row a hairline card with a chevron that rotates when
 * its answer is showing.
 *
 * WHY: DISCLOSURE_IS_REUSABLE. An FAQ is not a marketing-only shape: the
 * same list answers "why was my render refused?" on a gate screen and
 * "what counts as a credit?" in billing. So it is a GLOBAL component
 * taking `items` rather than a section of the landing page with copy
 * baked into it, and it holds no content of its own at all — see
 * `FaqItem` in @/lib/types.
 *
 * Built on the app's existing `Collapsible` (Base UI) rather than
 * introducing a second disclosure primitive. design.md specifies a
 * Radix accordion; adding @radix-ui/react-accordion for one section
 * would mean two accessibility implementations of the same widget in
 * one bundle, and Base UI's Collapsible already gives the
 * aria-expanded / aria-controls pair and the height animation. The
 * rendered result is the same component described there.
 *
 * ONE_OPEN_AT_A_TIME is the default and not the law: `multiple` opens
 * the list up for a long reference page where a reader wants two
 * answers side by side. The open set is owned HERE rather than by each
 * Collapsible, which is the only way a single-open list can close its
 * sibling.
 *
 * A client component because the open state is a client fact; the data
 * it renders is passed in from a Server Component, so no content ships
 * twice.
 * WHERE: src/app/(marketing)/page.tsx renders the landing FAQ from
 * src/app/(marketing)/_components/landing-content.ts. Imported as
 * '@/components/global/faq-accordion'.
 */

"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { FaqItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FaqAccordionProps {
  items: readonly FaqItem[];
  /** Allow several answers open at once. Default: one at a time. */
  multiple?: boolean | undefined;
  /** The item open on first paint — usually the question everybody asks. */
  defaultOpenId?: string | undefined;
  className?: string | undefined;
}

export function FaqAccordion({
  items,
  multiple = false,
  defaultOpenId,
  className,
}: FaqAccordionProps) {
  const [openIds, setOpenIds] = useState<readonly string[]>(
    defaultOpenId === undefined ? [] : [defaultOpenId],
  );

  const toggle = (id: string, open: boolean) => {
    setOpenIds((current) => {
      if (!open) return current.filter((value) => value !== id);
      if (!multiple) return [id];
      return current.includes(id) ? current : [...current, id];
    });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {items.map((item) => {
        const isOpen = openIds.includes(item.id);

        return (
          <Collapsible
            key={item.id}
            open={isOpen}
            onOpenChange={(open) => toggle(item.id, open)}
            className="brutal-border brutal-shadow-sm brutal-hover overflow-hidden rounded-xl bg-background"
          >
            <CollapsibleTrigger
              id={item.id}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-semibold text-foreground outline-none focus-ring"
            >
              {item.question}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                  isOpen && "rotate-180",
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
