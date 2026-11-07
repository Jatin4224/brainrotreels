/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthForm, AuthFormProps, GOOGLE_OAUTH_ENABLED,
 *   authClient, signInSchema, signUpSchema, GoogleGlyph, AuthSocialRow,
 *   AuthPasswordField, CheckInbox, AUTH_SURFACE, CTA_PINS_TO_THE_BOTTOM,
 *   ONE_RESPONSIVE_COMPONENT
 *
 * WHAT:  The email+password+Google auth surface. `AuthForm` is a thin
 *        dispatcher that mounts a concrete RHF form per mode (sign-in or
 *        sign-up). Each form is: the segmented mode switch, the OAuth row,
 *        the "or with email" rule, the fields, the one loud CTA, and a
 *        cross-link footer.
 *
 * WHY:   CLAUDE.md mandates zod + react-hook-form for every input surface, so
 *        both forms resolve against the shared schemas in src/lib/types. Two
 *        concrete forms (not one generic) give exact RHF `Path<>` inference
 *        without `any`.
 *
 *        ONE_RESPONSIVE_COMPONENT, per auth-design.md §8: the desktop and
 *        mobile artboards are the SAME component at two widths, not two
 *        screens. Below `lg` the form sits bare on the page background and
 *        its CTA pins to the bottom (CTA_PINS_TO_THE_BOTTOM — the `mt-auto`
 *        below, which only reaches the viewport edge because AuthShell makes
 *        the column fill the screen); at `lg` and up it collects into a card
 *        beside the showcase panel and the mode tabs appear. Branching on
 *        width in JS instead would need a measured breakpoint, which is a
 *        hydration mismatch on the first paint of the one screen that must
 *        not flicker.
 *
 *        The skins come from `@/components/global/auth/auth-styles` rather
 *        than being typed here, so the forgot-password and reset-password
 *        screens cannot drift away from these two.
 *
 * WHERE: Mounted by src/app/(auth)/sign-in|sign-up/page.tsx inside AuthShell,
 *        under <AuthHero>; talks to authClient
 *        (src/lib/better-auth/auth-client.ts); schemas live in
 *        src/lib/types/auth.ts.
 */

import * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/better-auth/auth-client";
import { AUTH_ROUTES, ROUTES, authRouteWithCallback } from "@/lib/config";
/* By path, not through ./index: that barrel re-exports these very forms. */
import { AuthError } from "@/components/global/auth/auth-error";
import { AuthModeTabs } from "@/components/global/auth/auth-mode-switch";
import {
  AUTH_CTA_CLASS,
  AUTH_DIVIDER_CLASS,
  AUTH_FIELD_CLASS,
  AUTH_LABEL_CLASS,
  AUTH_LINK_CLASS,
  AUTH_SOCIAL_BUTTON_CLASS,
} from "@/components/global/auth/auth-styles";
import { useDevEmailToast } from "@/hooks/use-dev-email-toast";
import {
  signInSchema,
  signUpSchema,
  type AuthFormMode,
  type SignInValues,
  type SignUpValues,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { CheckInbox } from "./check-inbox";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthFormProps
 *
 * WHAT:  Props for AuthForm — mode + optional post-success callback URL
 *        (defaults to ROUTES.dashboard).
 * WHERE: Used by the (auth) route pages.
 */
export interface AuthFormProps {
  mode: AuthFormMode;
  callbackURL?: Route;
}

/* Mirrors auth.ts: Google is only wired when the public client ID is set. */
const GOOGLE_OAUTH_ENABLED = Boolean(
  process.env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"],
);

/* The shell of the form column at both widths. Below `lg` it is bare on the
 * page background and grows to fill the viewport so the CTA can pin to the
 * bottom; at `lg` it collapses into the card the desktop artboard draws.
 * AUTH_SURFACE lives in auth-shell.tsx and still holds — the CARD IS A
 * DESKTOP-ONLY TREATMENT owned here, not a container each screen invents. */
const AUTH_CARD_CLASS =
  "flex flex-1 flex-col gap-5 lg:flex-none lg:brutal-border lg:brutal-shadow lg:rounded-[1.375rem] lg:bg-card lg:p-6";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthForm
 *
 * WHAT:  Selects the concrete form by `mode`.
 * WHERE: Rendered by sign-in/page.tsx and sign-up/page.tsx.
 */
/* POST_AUTH_TARGET_IS_THE_DASHBOARD, not "/". `/` is a public landing page
 * (HOME_IS_PUBLIC in src/app/(marketing)/page.tsx), so sending a user who just
 * authenticated there would show them the sales pitch instead of their
 * workspace. ROUTES.dashboard is the documented post-auth destination, and the
 * dashboard layout still owns the no-org → onboarding hop from there. */
export function AuthForm({
  mode,
  callbackURL = ROUTES.dashboard,
}: AuthFormProps) {
  return mode === "sign-in" ? (
    <SignInForm callbackURL={callbackURL} />
  ) : (
    <SignUpForm callbackURL={callbackURL} />
  );
}

/* ---------- Sign-in ---------- */

function SignInForm({ callbackURL }: { callbackURL: Route }) {
  /* The default destination is not worth threading through the URL — only an
   * explicit one is. Compared against ROUTES.dashboard because that IS the
   * default now (POST_AUTH_TARGET_IS_THE_DASHBOARD). */
  const carriedCallback = callbackURL === ROUTES.dashboard ? null : callbackURL;
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });
  const { error, setError, google } = useAuthEffects();
  const isSubmitting = form.formState.isSubmitting;
  const isBusy = isSubmitting || google.isPending;

  async function onSubmit(values: SignInValues) {
    setError(null);
    const { error: authError } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });
    if (authError) {
      setError(
        authError.message ??
          "Could not sign in. Check your details and try again.",
      );
      return;
    }
    window.location.assign(callbackURL);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={AUTH_CARD_CLASS}
        noValidate
      >
        <AuthModeTabs
          mode="sign-in"
          callbackURL={carriedCallback}
          className="hidden lg:grid"
        />

        <AuthSocialRow
          onGoogle={() => google.run(callbackURL, setError)}
          isPending={google.isPending}
          isBusy={isBusy}
        />

        <AuthError error={error} />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className={AUTH_LABEL_CLASS}>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled={isBusy}
                  className={AUTH_FIELD_CLASS}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="gap-2">
              <div className="flex items-center">
                <FormLabel className={AUTH_LABEL_CLASS}>Password</FormLabel>
                <Link
                  href={AUTH_ROUTES.forgotPassword}
                  className={cn(AUTH_LINK_CLASS, "ml-auto text-sm font-medium")}
                >
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <AuthPasswordField
                  autoComplete="current-password"
                  placeholder="Your password"
                  disabled={isBusy}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* CTA_PINS_TO_THE_BOTTOM below lg — see the header. */}
        <div className="mt-auto flex flex-col gap-5 pt-6 lg:mt-0 lg:pt-1">
          <AuthSubmit
            label="Sign in"
            isSubmitting={isSubmitting}
            isBusy={isBusy}
          />
          <AuthFooter
            prompt="New here?"
            ctaLabel="Create account"
            ctaHref={authRouteWithCallback(AUTH_ROUTES.signUp, carriedCallback)}
          />
        </div>
      </form>
    </Form>
  );
}

/* ---------- Sign-up ---------- */

function SignUpForm({ callbackURL }: { callbackURL: Route }) {
  /* The default destination is not worth threading through the URL — only an
   * explicit one is. Compared against ROUTES.dashboard because that IS the
   * default now (POST_AUTH_TARGET_IS_THE_DASHBOARD). */
  const carriedCallback = callbackURL === ROUTES.dashboard ? null : callbackURL;
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(
    null,
  );
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
    mode: "onTouched",
  });
  const { error, setError, google } = useAuthEffects();
  const notifyDevEmail = useDevEmailToast();
  const router = useRouter();
  const isSubmitting = form.formState.isSubmitting;
  const isBusy = isSubmitting || google.isPending;

  async function onSubmit(values: SignUpValues) {
    setError(null);
    /* RETURN_TO_AFTER_AUTH: passed to the SDK, not just used after it. With
     * requireEmailVerification on, the user leaves this tab and comes back
     * through the emailed link — Better Auth builds that link's destination
     * from this value, so omitting it sends a verified invitee to '/' and the
     * invitation they were accepting is lost for a second time. */
    const { data, error: authError } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
      callbackURL,
    });
    if (authError) {
      setError(authError.message ?? "Could not create your account. Try again.");
      return;
    }

    /* Dev-only: if Resend isn't configured, surface the verification link in a
     * toast (no-op otherwise). Awaited so the toast is mounted before we
     * navigate — a client-side push preserves it, a full reload would not. */
    await notifyDevEmail(values.email);

    /* A non-null token means Better Auth signed the user straight in, i.e.
     * requireEmailVerification is off (the dev email fallback). Go to the app
     * instead of dead-ending on a screen waiting for mail that can't arrive.
     * With verification enforced the token is null → check-your-email screen. */
    if (data?.token) {
      router.push(callbackURL);
      router.refresh();
      return;
    }
    setSubmittedEmail(values.email);
  }

  if (submittedEmail) {
    return (
      <CheckInbox
        email={submittedEmail}
        callbackURL={callbackURL}
        onChangeEmail={() => setSubmittedEmail(null)}
      />
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={AUTH_CARD_CLASS}
        noValidate
      >
        <AuthModeTabs
          mode="sign-up"
          callbackURL={carriedCallback}
          className="hidden lg:grid"
        />

        <AuthSocialRow
          onGoogle={() => google.run(callbackURL, setError)}
          isPending={google.isPending}
          isBusy={isBusy}
        />

        <AuthError error={error} />

        {/* REQUIRED_BY_THE_PROVIDER: Better Auth's email sign-up takes a name,
            so this field cannot be dropped to match the mobile artboard — a
            blank name would be rejected after the password was typed. It is
            labelled for a creator rather than "Full name" because that is what
            the product calls the person. */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className={AUTH_LABEL_CLASS}>Creator name</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autoComplete="name"
                  placeholder="How your channel is known"
                  disabled={isBusy}
                  className={AUTH_FIELD_CLASS}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className={AUTH_LABEL_CLASS}>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled={isBusy}
                  className={AUTH_FIELD_CLASS}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className={AUTH_LABEL_CLASS}>Password</FormLabel>
              <FormControl>
                {/* The rule is the PLACEHOLDER, not a hint line beneath: the
                    mobile artboard has no room for a third line per field, and
                    zod repeats it as the error the moment it is broken. */}
                <AuthPasswordField
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  disabled={isBusy}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="mt-auto flex flex-col gap-5 pt-6 lg:mt-0 lg:pt-1">
          <AuthSubmit
            label="Create account"
            isSubmitting={isSubmitting}
            isBusy={isBusy}
          />
          <AuthFooter
            prompt="Already creating?"
            ctaLabel="Sign in"
            ctaHref={authRouteWithCallback(AUTH_ROUTES.signIn, carriedCallback)}
          />
          <AuthLegalLine />
        </div>
      </form>
    </Form>
  );
}

/* ---------- Shared bits ---------- */

function AuthSubmit({
  label,
  isSubmitting,
  isBusy,
}: {
  label: string;
  isSubmitting: boolean;
  isBusy: boolean;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      className={AUTH_CTA_CLASS}
      disabled={isBusy}
      /* The screen reader is told the button is working; sighted users get the
         spinner. Both matter here because the press is followed by a network
         round trip with no other feedback. */
      aria-busy={isSubmitting}
    >
      {isSubmitting ? (
        <>
          <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
          {`${label}…`}
        </>
      ) : (
        <>
          {label}
          <ArrowRightIcon className="size-5" aria-hidden="true" />
        </>
      )}
    </Button>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuthPasswordField, SHOW_HIDE_IS_A_BUTTON,
 *   TOUCH_TARGET_44
 *
 * WHAT:  A password input with a Show/Hide toggle inside its right edge.
 * WHY:   SHOW_HIDE_IS_A_BUTTON — a real <button type="button"> with an
 *        `aria-label` that says what pressing it will DO, so it neither
 *        submits the form nor reads as "Show" with no object. The field keeps
 *        70px of right padding so a long password never runs under the
 *        toggle, and the toggle is 44px wide for the touch target.
 *        `tabIndex={-1}`: Tab from the password should reach the submit
 *        button, which is where somebody typing is going; the toggle is
 *        reachable by Shift+Tab and by touch, and sighted keyboard users have
 *        no reason to stop on it mid-flow.
 * WHERE: Both forms above. Receives RHF's field props directly.
 */
const AuthPasswordField = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(function AuthPasswordField({ className, ...props }, ref) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn(AUTH_FIELD_CLASS, "pr-[4.375rem]", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
      >
        {visible ? (
          <EyeOffIcon className="size-5" aria-hidden="true" />
        ) : (
          <EyeIcon className="size-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});

/**
 * SOURCE OF TRUTH KEYWORDS: AuthSocialRow, GOOGLE_OAUTH_ENABLED,
 *   ONE_PROVIDER_IS_FULL_WIDTH
 *
 * WHAT:  The OAuth buttons above the "or with email" rule, or nothing when no
 *        provider is configured.
 * WHY:   ONE_PROVIDER_IS_FULL_WIDTH. auth-design.md draws a two-column row
 *        (Google and Apple), but this deployment wires Google only — Apple is
 *        not in `socialProviders` in src/lib/better-auth/auth.ts — and half a
 *        row of buttons reads as a missing one. A single provider therefore
 *        takes the full width; the grid is `sm:grid-cols-2` ready for the day
 *        a second one is added, and adding it is an entry in the list below
 *        plus the server config, not a layout change.
 *        The whole block disappears when nothing is configured, rule and all:
 *        an "or with email" divider with nothing above it is the oldest bug in
 *        this pattern.
 * WHERE: Both forms above.
 */
function AuthSocialRow({
  onGoogle,
  isPending,
  isBusy,
}: {
  onGoogle: () => void;
  isPending: boolean;
  isBusy: boolean;
}) {
  if (!GOOGLE_OAUTH_ENABLED) return null;

  return (
    <>
      {/* A grid of one today. It stays a grid because adding Apple is then a
          second <Button> and a `sm:grid-cols-2`, not a rewrite of the row. */}
      <div className="grid gap-3">
        <Button
          variant="outline"
          type="button"
          size="lg"
          className={AUTH_SOCIAL_BUTTON_CLASS}
          onClick={onGoogle}
          disabled={isBusy}
          aria-busy={isPending}
        >
          {isPending ? (
            <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleGlyph />
          )}
          Google
        </Button>
      </div>
      <div className={AUTH_DIVIDER_CLASS}>or with email</div>
    </>
  );
}

function AuthFooter({
  prompt,
  ctaLabel,
  ctaHref,
}: {
  prompt: string;
  ctaLabel: string;
  /* TYPED_ROUTE_GUARANTEE: a cross-link destination is checked against the route
   * tree, so a renamed auth page cannot ship as a dead footer link. */
  ctaHref: Route;
}) {
  return (
    <p className="text-center text-base text-muted-foreground">
      {prompt}{" "}
      <Link href={ctaHref} className={AUTH_LINK_CLASS}>
        {ctaLabel}
      </Link>
    </p>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuthLegalLine, CONSENT_IS_ON_THE_BUTTON
 *
 * WHAT:  The "By continuing you agree to…" line under the sign-up CTA.
 * WHY:   CONSENT_IS_ON_THE_BUTTON — stated at the point of agreement rather
 *        than as a checkbox, which is the pattern the rest of the public
 *        surface uses (see the marketing footer's links to the same two
 *        documents). Sign-up only: signing in again is not a new agreement.
 *        The hrefs are literals rather than a config constant because
 *        `AUTH_ROUTES` covers the auth screens and the legal pages have no
 *        registry of their own yet — the marketing footer hard-codes the same
 *        two, and both are typed routes, so a rename fails the build in both
 *        places at once.
 * WHERE: The sign-up form above.
 */
function AuthLegalLine() {
  return (
    <p className="text-center text-sm leading-relaxed text-muted-foreground">
      By continuing you agree to our{" "}
      <Link href="/legal/terms" className={AUTH_LINK_CLASS}>
        Terms
      </Link>{" "}
      and{" "}
      <Link href="/legal/privacy" className={AUTH_LINK_CLASS}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}

/* Shared error state + Google handler. */
function useAuthEffects() {
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  async function run(callbackURL: Route, setErr: (v: string | null) => void) {
    if (isPending) return;
    setErr(null);
    setIsPending(true);
    try {
      const { error: authError } = await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
      if (authError)
        setErr(authError.message ?? "Google sign-in failed. Try again.");
    } finally {
      setIsPending(false);
    }
  }

  return { error, setError, google: { isPending, run } };
}

/* Inline Google "G" mark. */
function GoogleGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="size-5"
      aria-hidden="true"
    >
      <path
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
        fill="currentColor"
      />
    </svg>
  );
}
