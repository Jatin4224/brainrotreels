/**
 * SOURCE OF TRUTH KEYWORDS: MarketingMobileNav, MARKETING_NAV_LINKS,
 *   NAV_IS_REACHABLE_ON_A_PHONE, MarketingHeader
 *
 * WHAT:  The menu button and sheet that carry the marketing nav below `md`.
 *
 * WHY:   NAV_IS_REACHABLE_ON_A_PHONE. The header's link row is `hidden
 *        md:flex`, and nothing replaced it underneath: on a phone, Formats,
 *        How it works, Pricing and API simply did not exist in the header.
 *        The footer carries the same links, so the page was not a dead end —
 *        but "there is no way to reach pricing without scrolling the whole
 *        page" is the kind of gap that reads as unfinished, whatever else
 *        the page gets right.
 *
 *        SIGN_IN_MOVES_IN HERE. The header could not simply gain a fourth
 *        control: at 390px the bar already carries the wordmark, Sign in and
 *        Get started, and a menu button on top of those crowds it. Get
 *        started stays in the bar because it is the page's one action; Sign
 *        in moves into the sheet, which is the standard trade and the one
 *        that keeps the bar legible.
 *
 *        A sheet rather than a dropdown: the links are navigation targets on
 *        a touch screen, so they want 48px rows and a surface big enough to
 *        aim at, not a 36px menu. It is the product's own Sheet, so the
 *        open/close motion, the scrim and the focus trap are the ones the
 *        rest of the app already uses — nothing new to tune.
 *
 *        Links are handed in rather than imported, so this file and the
 *        header cannot disagree about what the nav contains, and importing
 *        the header back here cannot close a cycle.
 * WHERE: Rendered by MarketingHeader (./marketing-header.tsx).
 */

"use client";

import * as React from "react";
import Link from "next/link";
import { MenuIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import type { MarketingLink } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface MarketingMobileNavProps {
  links: readonly MarketingLink[];
}

export function MarketingMobileNav({ links }: MarketingMobileNavProps) {
  /* Controlled, because every link has to close it: a client-side
     navigation does not unmount the header, so without this the sheet
     stays open over the page the visitor just asked for. */
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Open menu"
        aria-expanded={open}
        className="rounded-full md:hidden"
        onClick={() => setOpen(true)}
      >
        <MenuIcon className="size-5" aria-hidden="true" />
      </Button>

      <SheetContent side="right" className="w-[17rem] gap-0 p-6">
        {/* The sheet needs an accessible name; it does not need a visible
            heading. Four links under a close button explain themselves. */}
        <SheetTitle className="sr-only">Menu</SheetTitle>

        <nav aria-label="Site" className="mt-10 flex flex-col">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              /* min-h-12: a 48px row is the touch target these are for.
                 The divider is on the row rather than between rows so the
                 last one closes the list. */
              className="flex min-h-12 items-center border-b border-border text-base font-semibold text-foreground outline-none transition-colors hover:text-brand-accent focus-ring motion-reduce:transition-none"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href={AUTH_ROUTES.signIn}
          onClick={() => setOpen(false)}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "mt-6 h-11 w-full rounded-full border-border font-semibold",
          )}
        >
          Sign in
        </Link>
      </SheetContent>
    </Sheet>
  );
}
