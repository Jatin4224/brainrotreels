/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AnalyticsProvider, POSTHOG_IS_OPTIONAL,
 *   PAGEVIEWS_ARE_THE_CLIENT_HALF, SERVER_SIDE_FUNNEL, NO_AUTOCAPTURE
 *
 * WHAT:  Initialises PostHog in the browser for pageviews, and nothing else.
 *
 * WHY:   PAGEVIEWS_ARE_THE_CLIENT_HALF, and the division of labour matters.
 *        The FUNNEL — signed_up, first_script, first_generation, first_render,
 *        purchased — is emitted from the SERVER
 *        (src/lib/observability/analytics.ts), because those counts have to be
 *        trustworthy and a browser event is lost to an ad blocker, a closed tab
 *        or a failed beacon. What only the browser can see is navigation: which
 *        page somebody landed on, where they went, where they stopped. So this
 *        provider sends pageviews and leaves conversions to the server.
 *
 *        NO_AUTOCAPTURE. PostHog's default is to record every click, input and
 *        form submission on the page. That is switched off deliberately: this
 *        app has customer scripts and prompts in text areas, and autocapture
 *        has a long history of hoovering up field values nobody intended to
 *        send to a third party. Events are declared, never discovered.
 *
 *        POSTHOG_IS_OPTIONAL — with no key it renders children and loads
 *        nothing, the same posture as Resend, R2 and Sentry. The import is
 *        inside the effect, so an unconfigured deployment never downloads the
 *        SDK at all.
 *
 *        CONSENT_GATES_THE_SDK. It also loads nothing until the visitor has
 *        ACCEPTED analytics cookies — the consent value comes from
 *        ./cookie-consent and gates the dynamic import itself, so declining
 *        means no request and no cookie rather than a tracker that runs anyway.
 *        That is the only version of a cookie banner worth having.
 *
 *        Pageviews are sent MANUALLY rather than by PostHog's own history
 *        listener, because this is an App Router app: the SDK's automatic
 *        capture misses client-side navigations in some configurations and
 *        double-counts them in others. `usePathname` is the framework's own
 *        answer to "where are we now", so it is the signal used.
 * WHERE: Mounted in src/app/layout.tsx, inside the tRPC provider so it sits in
 *        the same tree as everything else client-side.
 */

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useAnalyticsConsent } from "./cookie-consent";

/* Resolved at module scope: these are NEXT_PUBLIC_ variables, inlined at build
 * time, so reading them per render would buy nothing. */
const POSTHOG_KEY = process.env["NEXT_PUBLIC_POSTHOG_KEY"];
const POSTHOG_HOST =
  process.env["NEXT_PUBLIC_POSTHOG_HOST"] ?? "https://us.i.posthog.com";

export function AnalyticsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {POSTHOG_KEY ? (
        /* Suspense because `useSearchParams` suspends during a static render,
         * and a provider that suspended would hold up the whole page. The
         * tracker renders nothing, so there is no fallback to show. */
        <React.Suspense fallback={null}>
          <PageViewTracker />
        </React.Suspense>
      ) : null}
      {children}
    </>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: PageViewTracker, NO_AUTOCAPTURE
 *
 * WHAT:  Loads the SDK once, then sends one `$pageview` per navigation.
 * WHY:   Split from the provider so the `useSearchParams` suspension is
 *        contained to a component that renders nothing — see the Suspense note
 *        above. The query string is included because it carries the campaign
 *        parameters that make a landing-page funnel attributable, which is the
 *        one thing pageviews are for here.
 * WHERE: AnalyticsProvider.
 */
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { consent } = useAnalyticsConsent();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    /* CONSENT_GATES_THE_SDK. Until somebody accepts, the module is never
     * imported — so no request is made and no cookie is set. A banner that
     * recorded a choice and loaded the tracker anyway would be theatre, and
     * exactly what the rules it claims to satisfy prohibit. */
    if (!POSTHOG_KEY || consent !== "granted") return;
    let cancelled = false;

    void (async () => {
      try {
        const posthog = (await import("posthog-js")).default;
        if (cancelled) return;

        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          /* NO_AUTOCAPTURE — see the file header. */
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: true,
          /* Session recording would capture the contents of a customer's
             script editor. Off, and not a setting worth making configurable. */
          disable_session_recording: true,
        });
        setReady(true);
      } catch (error) {
        /* Analytics never breaks a page. */
        console.error("[analytics] PostHog could not be loaded:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [consent]);

  React.useEffect(() => {
    if (!ready || !POSTHOG_KEY || consent !== "granted") return;

    void (async () => {
      try {
        const posthog = (await import("posthog-js")).default;
        const query = searchParams.toString();
        posthog.capture("$pageview", {
          $current_url: query ? `${pathname}?${query}` : pathname,
        });
      } catch {
        /* Already reported by the init effect if the module is unavailable. */
      }
    })();
  }, [ready, consent, pathname, searchParams]);

  return null;
}
