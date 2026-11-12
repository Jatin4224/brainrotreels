"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: RouteError, RouteErrorProps, ERROR_BOUNDARY_BODY,
 *   RESET_BEFORE_RELOAD, REPORT_ONCE_PER_ERROR, DIGEST_IS_THE_CORRELATION_ID,
 *   reportBrowserError, StatePanel, error.tsx, global-error.tsx
 *
 * WHAT:  The body of every `error.tsx` in the app — the panel a reader sees
 *        when a segment threw, with a retry, a way out, and the id to quote.
 *
 * WHY:   ERROR_BOUNDARY_BODY. Next.js requires one `error.tsx` per segment and
 *        each is a client component with the same two props, so without a
 *        shared body the app would carry six near-identical copies of the same
 *        reporting call, the same button pair and the same copy — and they
 *        would drift exactly the way the seven empty states did. Each
 *        `error.tsx` is now a few lines that name its own subsystem and its
 *        own way out; everything else is here.
 *
 *        RESET_BEFORE_RELOAD. The primary action is Next's `reset()`, which
 *        re-renders the segment in place and keeps the layout, the sidebar and
 *        the React Query cache alive. A full reload is offered only as the
 *        second step, because most of these failures are a single failed
 *        render — a transient fetch, a bad id — and throwing away the whole
 *        client state to recover from one is a worse outcome that happens to
 *        feel more thorough.
 *
 *        REPORT_ONCE_PER_ERROR: the effect is keyed on the error instance, not
 *        on mount. A boundary re-renders whenever its parent does, and an
 *        unkeyed report would emit a line per render — turning one failure
 *        into a flood in the exact log stream someone is reading to understand
 *        it.
 *
 *        REFERENCE_ONLY_WHEN_IT_IS_LOOKUPABLE — the reference printed on
 *        screen is Next's `digest` and nothing else, so the string the reader
 *        quotes is the same one in the server log and in the Sentry report
 *        `onRequestError` filed. A client-side throw has no digest and
 *        therefore shows no reference, because there is nothing for support to
 *        look it up in. It is small print rather than a headline: it exists
 *        for the one reader in a hundred who will send it on.
 *
 * WHERE: Composed by every error.tsx — src/app/error.tsx, the route-group
 *        boundaries under (dashboard), (portal), (marketing), (auth),
 *        (onboarding), the project editor's own, and global-error.tsx.
 */

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { StatePanel } from "@/components/global/state-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { reportBrowserError } from "@/lib/observability/report-browser-error";

export interface RouteErrorProps {
  /** Next's boundary prop. `digest` is present only for a server-side throw. */
  error: Error & { digest?: string };
  /** Next's boundary prop — re-renders the segment without a reload. */
  reset: () => void;
  /** The subsystem for the log line, e.g. `ui.dashboard`. */
  logger: string;
  /** Overrides the default headline when a segment can say something better. */
  title?: string;
  /** See StatePanel's TITLE_IS_A_HEADING_ONLY_WHEN_IT_IS_THE_PAGE. */
  titleAs?: "p" | "h1" | "h2";
  /** Overrides the default sentence. */
  description?: React.ReactNode;
  /** A way out of the broken segment — omitted when there is nowhere to go. */
  action?: { href: Route; label: string };
  /** PANEL_OWNS_THE_CARD — `false` inside a surface that is already a card. */
  card?: boolean;
}

export function RouteError({
  error,
  reset,
  logger,
  title = "Something went wrong",
  titleAs = "p",
  description = "This part of the page could not be loaded. Trying again usually clears it.",
  action,
  card = true,
}: RouteErrorProps) {
  /* REPORT_ONCE_PER_ERROR — keyed on the instance, see the file header. The
     effect only reports; it sets no state, because a setState in an effect
     body is a cascading render and the React Compiler lint rightly rejects
     it. Everything on screen is derived below. */
  React.useEffect(() => {
    reportBrowserError(error, {
      logger,
      event: "ui.route_error",
      ...(error.digest !== undefined ? { digest: error.digest } : {}),
    });
  }, [error, logger]);

  /* REFERENCE_ONLY_WHEN_IT_IS_LOOKUPABLE. Shown only for a SERVER-side throw,
     where the digest is a real key into the server log and the Sentry report
     that onRequestError already filed. A client-side render error has neither
     — the only trace is a console line in this reader's own browser — so
     printing an id for one would invite a support request about a code nobody
     can look up. No digest, no reference. */
  const reference = error.digest;

  return (
    <StatePanel
      card={card}
      tone="destructive"
      icon={TriangleAlertIcon}
      title={title}
      titleAs={titleAs}
      description={description}
      action={
        <>
          {/* RESET_BEFORE_RELOAD — the cheap recovery is the primary action. */}
          <Button onClick={reset}>
            <RotateCcwIcon />
            Try again
          </Button>
          {action !== undefined ? (
            /* LINK_NOT_ASCHILD — this Button wraps a Base UI primitive and
               has no `asChild`, so a link that looks like a button is a Link
               carrying buttonVariants. That is the codebase pattern. */
            <Link
              href={action.href}
              className={buttonVariants({ variant: "outline" })}
            >
              {action.label}
            </Link>
          ) : null}
        </>
      }
      footnote={
        reference !== undefined ? (
          <>
            Reference <code className="font-mono">{reference}</code>
          </>
        ) : undefined
      }
    />
  );
}
