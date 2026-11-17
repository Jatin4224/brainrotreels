/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthError, AuthErrorProps, AUTH_SURFACE,
 *   ERRORS_LEAVE_TOO
 *
 * WHAT:  The error banner every auth screen shows when an attempt fails —
 *        renders nothing when there is no error.
 * WHY:   AUTH_SURFACE. This treatment was written inside the Better Auth form
 *        and then wanted again on the app-owned invitation screen. Copying the
 *        classes is how one of them quietly stops matching the other, so it
 *        lives here instead — provider-neutral, next to AuthShell, which is the
 *        folder that already owns the chrome shared by every auth route.
 *        `role="alert"` is part of the component rather than a caller's job:
 *        the message appears after a submit the user is waiting on, so a screen
 *        reader has to announce it, and an alert that depends on each call site
 *        remembering the attribute is one that eventually does not announce.
 *        Returning null on an empty message keeps callers free of the
 *        `{error ? <AuthError .../> : null}` wrapper they would otherwise all
 *        repeat.
 *
 *        ERRORS_LEAVE_TOO is why this one file reaches for framer-motion while
 *        the rest of the app animates in CSS. A banner that is simply unmounted
 *        vanishes between two frames and the submit button jumps up to fill the
 *        gap — and CSS cannot transition an element that is no longer in the
 *        tree. AnimatePresence keeps it mounted long enough to leave. `height`
 *        animates with it so the layout closes WITH the banner instead of
 *        snapping shut: the same exception an accordion gets, affordable here
 *        because a failed sign-in is occasional and nothing else on the screen
 *        is moving while it plays.
 * WHERE: The Better Auth sign-in / sign-up forms and the accept-invitation
 *        screen. Imported BY PATH from the provider forms, never through
 *        ./index — that barrel re-exports the provider surfaces, so importing
 *        it from inside one would close an import cycle.
 */

"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export interface AuthErrorProps {
  /** The message, or null/empty to render nothing. */
  error: string | null | undefined;
}

export function AuthError({ error }: AuthErrorProps) {
  /* Reduced motion keeps the fade and drops the travel — fewer and gentler,
     not nothing, so the banner still announces itself. */
  const reduce = useReducedMotion();
  const offset = reduce ? "translateY(0px)" : "translateY(-4px)";

  return (
    /* initial={false} so a screen that renders WITH an error already present
       does not play an entrance at hydration: that error was always there, and
       animating it in would claim it had just happened. */
    <AnimatePresence initial={false}>
      {error ? (
        <motion.div
          key="auth-error"
          role="alert"
          initial={{ opacity: 0, height: 0, transform: offset }}
          animate={{ opacity: 1, height: "auto", transform: "translateY(0px)" }}
          exit={{ opacity: 0, height: 0, transform: offset }}
          /* A full `transform` string, not the x/y shorthands: this repo is on
             framer-motion 13, where the shorthands animate on the main thread.
             Enter 200ms, leave 140ms — arriving is the part the reader has to
             notice, leaving is the system getting out of the way. */
          transition={{
            duration: 0.2,
            ease: [0.3, 0.7, 0.2, 1],
            opacity: { duration: 0.16 },
          }}
          style={{ overflow: "hidden" }}
        >
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
