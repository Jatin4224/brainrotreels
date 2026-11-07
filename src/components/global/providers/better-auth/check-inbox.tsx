/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CheckInbox, CheckInboxProps, RESEND_COOLDOWN,
 *   VERIFICATION_IS_A_LINK, authClient, sendVerificationEmail,
 *   CTA_PINS_TO_THE_BOTTOM, AUTH_SURFACE
 *
 * WHAT:  The screen a new account lands on while its verification email is in
 *        flight — the mail illustration, who it was sent to, a resend with a
 *        cooldown, and a way back to fix a mistyped address.
 *
 * WHY:   Its own file because it is a SCREEN, not a branch of a form: it has
 *        no fields, its own primary action and its own illustration, and
 *        leaving it inline made the sign-up form two screens in one component.
 *
 *        VERIFICATION_IS_A_LINK. auth-design.md §5.3 draws six boxes for a
 *        6-digit code; this deployment verifies by LINK —
 *        `emailVerification.sendVerificationEmail` in
 *        src/lib/better-auth/auth.ts mails a URL, and no code is ever
 *        generated — so there is nothing for those boxes to hold. Drawing
 *        them anyway would be a control that eats a code nobody was sent.
 *        Everything else in that artboard is here: the 44px back button, the
 *        tilted yellow mail square with its "1 new" pill, the display title,
 *        the address stated as a fact, the resend with its 0:24 countdown and
 *        the "Wrong email?" escape. Moving to codes later means adding the
 *        `emailOTP` plugin server-side and a fieldset of six inputs HERE,
 *        with nothing else on this screen changing.
 *
 *        RESEND_COOLDOWN starts on MOUNT, not on the first press, because an
 *        email has already gone out by the time this renders — a resend
 *        available instantly invites a visitor to send three before the first
 *        one arrives, and a mail provider counts that against the domain.
 *        The countdown is the button's own label rather than a line beside
 *        it: one thing to look at, and it cannot disagree with the disabled
 *        state. `aria-live="polite"` on the status line, so a screen-reader
 *        user hears the result of a resend they cannot see.
 *
 *        It reports success and failure in its own status line rather than
 *        through <AuthError>: that banner is for an attempt that FAILED and
 *        this line has to carry "sent" too.
 *
 * WHERE: Rendered by the sign-up form in ./auth-form.tsx once Better Auth
 *        accepts the account without a session token (i.e. verification is
 *        enforced). Shares the skins in @/components/global/auth/auth-styles.
 */

import * as React from "react";
import type { Route } from "next";
import { ArrowLeftIcon, Loader2Icon, MailIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/better-auth/auth-client";
import {
  AUTH_CTA_CLASS,
  AUTH_LINK_CLASS,
} from "@/components/global/auth/auth-styles";
import { useDevEmailToast } from "@/hooks/use-dev-email-toast";
import { cn } from "@/lib/utils";

/**
 * SOURCE OF TRUTH KEYWORDS: RESEND_COOLDOWN_SECONDS
 *
 * WHAT:  How long the resend stays locked after an email goes out.
 * WHY:   24s is what auth-design.md §5.3 draws, and it is long enough for a
 *        normally-delivered mail to land before a visitor concludes it will
 *        not. A constant, because the countdown and the disabled state both
 *        read it and a literal in two places is how they disagree.
 * WHERE: The timer below.
 */
const RESEND_COOLDOWN_SECONDS = 24;

export interface CheckInboxProps {
  /** The address the verification mail went to. */
  email: string;
  /** Where Better Auth should land the user after they follow the link. */
  callbackURL: Route;
  /** Returns to the sign-up form so a mistyped address can be corrected. */
  onChangeEmail: () => void;
}

export function CheckInbox({
  email,
  callbackURL,
  onChangeEmail,
}: CheckInboxProps) {
  const [secondsLeft, setSecondsLeft] = React.useState(
    RESEND_COOLDOWN_SECONDS,
  );
  const [isSending, setIsSending] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const notifyDevEmail = useDevEmailToast();

  /* ONE INTERVAL for the life of the screen, clearing itself at zero rather
   * than being recreated each tick — a timer rebuilt on every state change
   * drifts, and on a 24-second countdown the drift is visible. */
  React.useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current <= 1 ? 0 : current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  async function handleResend() {
    if (secondsLeft > 0 || isSending) return;
    setIsSending(true);
    setStatus(null);
    setFailed(false);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL,
      });
      if (error) {
        setFailed(true);
        setStatus(
          error.message ?? "Could not send another email. Try again shortly.",
        );
        return;
      }
      /* Dev-only: surfaces the link in a toast when Resend is not configured,
       * so a local resend is as testable as the first send. No-op otherwise. */
      await notifyDevEmail(email);
      setStatus("Sent. Check your inbox again.");
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } finally {
      setIsSending(false);
    }
  }

  const countdown = `0:${String(secondsLeft).padStart(2, "0")}`;

  return (
    <div className="flex flex-1 flex-col lg:flex-none lg:brutal-border lg:brutal-shadow lg:rounded-[1.375rem] lg:bg-card lg:p-8">
      <button
        type="button"
        onClick={onChangeEmail}
        aria-label="Back to create account"
        className="brutal-border flex size-11 items-center justify-center rounded-2xl bg-surface-raised text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
      >
        <ArrowLeftIcon className="size-5" aria-hidden="true" />
      </button>

      <div className="flex flex-col items-center pt-10 text-center">
        {/* The illustration: a tilted yellow square with the envelope in it and
            an orange "1 new" pill clipped to its corner. Decoration — the
            heading beneath says the same thing in words. */}
        <div aria-hidden="true" className="relative">
          <div className="brutal-shadow-lg flex size-[9.5rem] -rotate-6 items-center justify-center rounded-[2.25rem] bg-brand-accent">
            <MailIcon
              className="size-16 rotate-6 text-brand-accent-foreground"
              strokeWidth={2.25}
            />
          </div>
          <span className="brutal-shadow absolute -right-6 -top-3 rotate-[8deg] rounded-full bg-brand px-3.5 py-1.5 text-sm font-bold text-brand-foreground">
            1 new
          </span>
        </div>

        <h1 className="mt-10 font-display text-4xl font-extrabold leading-[1.02] tracking-tight text-foreground">
          Check your inbox
        </h1>

        <p className="mt-4 text-base text-muted-foreground">
          We sent a verification link to
        </p>
        {/* The address is the fact the whole screen turns on — which inbox to
            open, and what "Wrong email?" refers to — so it is stated on its
            own line rather than buried in the sentence. */}
        <p className="mt-1 text-base font-bold text-foreground">{email}</p>

        <p
          aria-live="polite"
          className={cn(
            "mt-5 min-h-5 text-sm",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </p>
      </div>

      {/* CTA_PINS_TO_THE_BOTTOM below lg, exactly as on the form screens. */}
      <div className="mt-auto flex flex-col gap-5 pt-10 lg:mt-0">
        <Button
          type="button"
          size="lg"
          className={AUTH_CTA_CLASS}
          onClick={() => void handleResend()}
          disabled={secondsLeft > 0 || isSending}
          aria-busy={isSending}
        >
          {isSending ? (
            <>
              <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : secondsLeft > 0 ? (
            `Resend link in ${countdown}`
          ) : (
            "Resend verification link"
          )}
        </Button>

        <p className="text-center text-base text-muted-foreground">
          Wrong email?{" "}
          <button
            type="button"
            onClick={onChangeEmail}
            className={AUTH_LINK_CLASS}
          >
            Change it
          </button>
        </p>
      </div>
    </div>
  );
}
