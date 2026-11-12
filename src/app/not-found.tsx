/**
 * SOURCE OF TRUTH KEYWORDS: NotFound, NOT_FOUND_IS_NOT_AN_ERROR, StatePanel,
 *   buttonVariants, notFound, isPortalEnabled
 *
 * WHAT:  The 404 page — an unknown URL, or any server component that called
 *        `notFound()`.
 *
 * WHY:   NOT_FOUND_IS_NOT_AN_ERROR, and the difference is visible here on
 *        purpose. This is NOT a RouteError: there is nothing to retry, nothing
 *        to report and no reference code to quote, because nothing failed —
 *        the address is simply wrong. Rendering the error boundary's panel for
 *        a mistyped URL would tell a customer the product is broken and invite
 *        them to file it, which is the wrong information and the wrong action.
 *        Hence the default tone rather than `destructive`, and a link out as
 *        the only action.
 *
 *        It is a server component, which is why StatePanel carries no
 *        `"use client"` — the one panel renders here and in the client
 *        boundaries without a second version existing.
 *
 *        One file, at the root, rather than per segment: the only in-app
 *        `notFound()` call is the portal layout's `isPortalEnabled()` check,
 *        and an operator who reaches a switched-off portal wants the same
 *        answer as a visitor with a bad link.
 *
 * WHERE: Rendered by Next.js. Inside the root layout, so it is themed.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { StatePanel } from "@/components/global/state-panel";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <StatePanel
          icon={CompassIcon}
          title="Page not found"
          titleAs="h1"
          description="That link does not point anywhere. It may have moved, or it may never have existed."
          action={
            <>
              <Link href="/" className={buttonVariants()}>
                Go to the homepage
              </Link>
              <Link
                href="/dashboard"
                className={buttonVariants({ variant: "outline" })}
              >
                Open the dashboard
              </Link>
            </>
          }
        />
      </div>
    </main>
  );
}
