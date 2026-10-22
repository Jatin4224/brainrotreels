/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CookieConsent, useAnalyticsConsent,
 *   CONSENT_STORAGE_KEY, CONSENT_GATES_THE_SDK, NO_CONSENT_NO_SCRIPT,
 *   ESSENTIAL_COOKIES_NEED_NO_CONSENT
 *
 * WHAT:  The cookie banner, and the hook that tells the analytics provider
 *        whether it may load.
 *
 * WHY:   CONSENT_GATES_THE_SDK, which is the only version of this worth
 *        building. A banner that records a choice and loads the tracker anyway
 *        is theatre and is precisely what the rules it claims to satisfy
 *        prohibit. So the consent value is read by `AnalyticsProvider`, and
 *        until somebody accepts, NO_CONSENT_NO_SCRIPT: the PostHog module is
 *        never imported, no request is made and no cookie is set.
 *
 *        ESSENTIAL_COOKIES_NEED_NO_CONSENT, which is why the banner only talks
 *        about analytics. The session cookie, the theme preference and the CSRF
 *        token are strictly necessary to provide a service the visitor asked
 *        for, and asking permission for them would be both legally unnecessary
 *        and misleading about what declining does.
 *
 *        The choice lives in `localStorage` rather than a cookie, deliberately:
 *        a consent COOKIE is itself a cookie set before consent, and while it
 *        is defensible as essential, localStorage avoids the argument
 *        entirely. The trade is that the choice is per-browser and does not
 *        reach the server — which is correct here, because the only thing that
 *        acts on it is client-side.
 *
 *        It renders NOTHING when analytics is not configured. A banner asking
 *        permission for a tracker that does not exist trains people to dismiss
 *        banners.
 * WHERE: Mounted in src/app/layout.tsx beside AnalyticsProvider, which reads
 *        the same hook.
 */

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * SOURCE OF TRUTH KEYWORDS: CONSENT_STORAGE_KEY, CONSENT_EVENT
 *
 * WHAT:  Where the choice is kept, and the event that announces a change.
 * WHY:   `localStorage` does not notify the tab that wrote it, so a custom
 *        event is what lets the analytics provider start the moment somebody
 *        accepts rather than on the next navigation. Without it, accepting
 *        would appear to do nothing until a reload.
 * WHERE: This file and the analytics provider.
 */
export const CONSENT_STORAGE_KEY = "analytics-consent";

export const CONSENT_EVENT = "analytics-consent-change";

type Consent = "granted" | "denied" | "unset";

function readConsent(): Consent {
  /* Wrapped, because every storage access can throw: a private window, blocked
   * site data, or an embedded context. The safe default is `unset`, which
   * shows the banner and loads nothing. */
  try {
    const stored = globalThis.localStorage?.getItem(CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") return stored;
  } catch {
    /* Storage unavailable — treat as undecided and load nothing. */
  }
  return "unset";
}

function writeConsent(value: Consent): void {
  try {
    globalThis.localStorage?.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    /* A choice we cannot persist still applies for this page view, which the
     * event below delivers. */
  }
  globalThis.dispatchEvent(new Event(CONSENT_EVENT));
}

/**
 * SOURCE OF TRUTH KEYWORDS: subscribeToConsent, CONSENT_IS_AN_EXTERNAL_STORE
 *
 * WHAT:  Notifies React when the stored choice changes.
 * WHY:   Two sources. `CONSENT_EVENT` is this tab's own change — localStorage
 *        does not notify the tab that wrote it, so without the event accepting
 *        would appear to do nothing until a reload. `storage` is the OTHER
 *        tabs, so a choice made in one is honoured in the rest immediately.
 * WHERE: The store subscription below.
 */
/* A module-level function rather than an inline arrow, so its identity is
 * stable across renders — `useSyncExternalStore` compares the snapshot
 * getters, and a new closure each render makes it re-subscribe. */
function serverConsent(): Consent {
  return "unset";
}

function subscribeToConsent(onChange: () => void): () => void {
  globalThis.addEventListener(CONSENT_EVENT, onChange);
  globalThis.addEventListener("storage", onChange);
  return () => {
    globalThis.removeEventListener(CONSENT_EVENT, onChange);
    globalThis.removeEventListener("storage", onChange);
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: useAnalyticsConsent, CONSENT_IS_AN_EXTERNAL_STORE,
 *   HYDRATION_SAFE_DEFAULT
 *
 * WHAT:  The current choice, updating when it changes.
 *
 * WHY:   CONSENT_IS_AN_EXTERNAL_STORE, so it is read with
 *        `useSyncExternalStore` rather than mirrored into state from an effect.
 *        That is not a style preference: `localStorage` plus an event IS an
 *        external store, and the state-plus-effect version is both an extra
 *        render pass and a `setState` in an effect body, which this codebase's
 *        eslint rules forbid for that reason. React's own hook subscribes,
 *        reads and re-renders without the intermediate copy.
 *
 *        HYDRATION_SAFE_DEFAULT — the server snapshot is `unset`, because the
 *        server has no localStorage. Reading storage during render would
 *        produce markup that disagrees with the client's first paint and React
 *        would discard the tree. The visible cost is one frame without the
 *        banner, which is also what you want: no flash of a banner for somebody
 *        who already decided.
 * WHERE: CookieConsent below, and AnalyticsProvider.
 */
export function useAnalyticsConsent(): {
  consent: Consent;
  grant: () => void;
  deny: () => void;
} {
  const consent = React.useSyncExternalStore(
    subscribeToConsent,
    readConsent,
    /* The server, and the first client render before hydration. */
    serverConsent,
  );

  return {
    consent,
    grant: () => writeConsent("granted"),
    deny: () => writeConsent("denied"),
  };
}

/* Resolved at module scope — a NEXT_PUBLIC_ variable inlined at build time. */
const ANALYTICS_CONFIGURED = Boolean(process.env["NEXT_PUBLIC_POSTHOG_KEY"]);

export function CookieConsent() {
  const { consent, grant, deny } = useAnalyticsConsent();

  /* No tracker, no banner — see the file header. */
  if (!ANALYTICS_CONFIGURED) return null;
  if (consent !== "unset") return null;

  return (
    <div
      /* A region rather than a dialog: it does not trap focus and does not
       * block the page, because nothing behind it is gated on the choice. A
       * modal would make a visitor answer before reading the policy the banner
       * links to. */
      role="region"
      aria-label="Cookie choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use analytics cookies to see which pages people use. Declining
          changes nothing about how the product works.{" "}
          <Link href="/legal/privacy" className="underline">
            Privacy policy
          </Link>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={deny}>
            Decline
          </Button>
          <Button size="sm" onClick={grant}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
