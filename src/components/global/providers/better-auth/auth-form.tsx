/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthForm, AuthFormProps, GOOGLE_OAUTH_ENABLED,
 * authClient, signInSchema, signUpSchema, GoogleGlyph, AuthSocialRow,
 * AuthPasswordField, CheckInbox, AUTH_SURFACE, CTA_PINS_TO_THE_BOTTOM,
 * ONE_RESPONSIVE_COMPONENT
 *
 * WHAT: The email+password+Google auth surface. `AuthForm` is a thin
 * dispatcher that mounts a concrete RHF form per mode (sign-in or
 * sign-up). Each form is: the segmented mode switch, the OAuth row,
 * the "or with email" rule, the fields, the one loud CTA, and a
 * cross-link footer.
 *
 * WHY: CLAUDE.md mandates zod + react-hook-form for every input surface, so
 * both forms resolve against the shared schemas in src/lib/types. Two
 * concrete forms (not one generic) give exact RHF `Path<>` inference
 * without `any`.
 *
 * ONE_RESPONSIVE_COMPONENT, per auth-design.md §8: the desktop and
 * mobile artboards are the SAME component at two widths, not two
 * screens. Below `lg` the form sits bare on the page background and
 * its CTA pins to the bottom (CTA_PINS_TO_THE_BOTTOM — the `mt-auto`
 * below, which only reaches the viewport edge because AuthShell makes
 * the column fill the screen); at `lg` and up it collects into a card
 * beside the showcase panel and the mode tabs appear. Branching on
 * width in JS instead would need a measured breakpoint, which is a
 * hydration mismatch on the first paint of the one screen that must
 * not flicker.
 *
 * The skins come from `@/components/global/auth/auth-styles` rather
 * than being typed here, so the forgot-password and reset-password
 * screens cannot drift away from these two.
 *
 * WHERE: Mounted by src/app/(auth)/sign-in|sign-up/page.tsx inside AuthShell,
 * under <AuthHero>; talks to authClient
 * (src/lib/better-auth/auth-client.ts); schemas live in
 * src/lib/types/auth.ts.
 */

import * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, Loader2Icon } from "lucide-react";
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
  type SocialProviderId,
  type SignInValues,
  type SignUpValues,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { CheckInbox } from "./check-inbox";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthFormProps
 *
 * WHAT: Props for AuthForm — mode + optional post-success callback URL
 * (defaults to ROUTES.dashboard).
 * WHERE: Used by the (auth) route pages.
 */
export interface AuthFormProps {
  mode: AuthFormMode;
  callbackURL?: Route;
}

/* SOCIAL_PROVIDERS_ARE_OPT_IN, mirroring resolveSocialProviders() in
 * src/lib/better-auth/auth.ts: a provider is wired only when its PUBLIC
 * client id is set, and the server refuses it without the matching secret.
 * Read at module scope — Next inlines a NEXT_PUBLIC_* read at build time
 * only when it is a literal member access, so these are what make a dead
 * provider drop out of the bundle instead of being decided at runtime. */
const GOOGLE_OAUTH_ENABLED = Boolean(
  process.env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"],
);
const APPLE_OAUTH_ENABLED = Boolean(
  process.env["NEXT_PUBLIC_APPLE_CLIENT_ID"],
);

/* The form column at both widths. AUTH_SURFACE (auth-shell.tsx): the form is
 * BARE on the page background at every width — no card, no border, no second
 * surface. Below `lg` it also grows to fill the viewport, which is what lets
 * the CTA pin to the bottom; at `lg` the message panel beside it is the only
 * bordered thing on screen, and a card around the fields as well would make
 * the page read as two competing panels instead of one pitch and one form. */
const AUTH_CARD_CLASS = "flex flex-1 flex-col gap-5 lg:flex-none";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthForm
 *
 * WHAT: Selects the concrete form by `mode`.
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
  const { error, setError, social } = useAuthEffects();
  const isSubmitting = form.formState.isSubmitting;
  const isBusy = isSubmitting || social.pendingProvider !== null;

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
          onSelect={(provider) => social.run(provider, callbackURL, setError)}
          pendingProvider={social.pendingProvider}
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
  const { error, setError, social } = useAuthEffects();
  const notifyDevEmail = useDevEmailToast();
  const router = useRouter();
  const isSubmitting = form.formState.isSubmitting;
  const isBusy = isSubmitting || social.pendingProvider !== null;

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
          onSelect={(provider) => social.run(provider, callbackURL, setError)}
          pendingProvider={social.pendingProvider}
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
 * TOUCH_TARGET_44
 *
 * WHAT: A password input with a Show/Hide toggle inside its right edge.
 * WHY: SHOW_HIDE_IS_A_BUTTON — a real <button type="button"> with an
 * `aria-label` that says what pressing it will DO, so it neither
 * submits the form nor reads as "Show" with no object. The field keeps
 * 80px of right padding so a long password never runs under the
 * toggle, and the toggle is at least 44px wide for the touch target.
 * `tabIndex={-1}`: Tab from the password should reach the submit
 * button, which is where somebody typing is going; the toggle is
 * reachable by Shift+Tab and by touch, and sighted keyboard users have
 * no reason to stop on it mid-flow.
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
        className={cn(AUTH_FIELD_CLASS, "pr-20", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center rounded-r-xl px-4 text-base font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-ring motion-reduce:transition-none"
      >
        {/* A WORD, NOT AN ICON. The artboard spells it out, and it is the
            right call: a crossed-out eye is read as both "it is hidden" and
            "press to hide" depending on who is looking, while "Show" can only
            mean one thing. The `aria-label` still carries the verb for a
            screen reader, since the visible word alone flips meaning the
            moment the field is revealed. */}
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
});

/**
 * SOURCE OF TRUTH KEYWORDS: AuthSocialRow, SOCIAL_PROVIDERS, SocialProviderId,
 * GOOGLE_OAUTH_ENABLED, APPLE_OAUTH_ENABLED, SOCIAL_PROVIDERS_ARE_OPT_IN,
 * NO_DEAD_PROVIDER_BUTTONS
 *
 * WHAT: The OAuth buttons above the "or with email" rule — Google, Apple, or
 * nothing when neither is configured.
 *
 * WHY: NO_DEAD_PROVIDER_BUTTONS, which is the rule the list below exists to
 * keep. A provider renders only when its PUBLIC client id is present,
 * mirroring `resolveSocialProviders` in src/lib/better-auth/auth.ts
 * exactly — the server refuses a provider it has no secret for, and a
 * button that opens a round trip ending in "unsupported provider"
 * reads to a user as the product being broken rather than the provider
 * being switched off. The envs are the two halves of one switch.
 *
 * A LIST, not two hand-written buttons: the row's column count is
 * derived from how many are enabled, so one provider is full width and
 * two split the row, with no layout branch to get wrong. Adding a
 * third is an entry here plus a resolver on the server.
 *
 * The whole block disappears when nothing is configured, rule and all:
 * an "or with email" divider with nothing above it is the oldest bug
 * in this pattern.
 *
 * WHERE: Both forms above. `onSelect` is given the provider id and routes it
 * to authClient.signIn.social.
 */
const SOCIAL_PROVIDERS = [
  {
    id: "google",
    label: "Google",
    enabled: GOOGLE_OAUTH_ENABLED,
    Glyph: GoogleGlyph,
  },
  {
    id: "apple",
    label: "Apple",
    enabled: APPLE_OAUTH_ENABLED,
    Glyph: AppleGlyph,
  },
] as const satisfies readonly {
  id: SocialProviderId;
  label: string;
  enabled: boolean;
  Glyph: () => React.JSX.Element;
}[];

function AuthSocialRow({
  onSelect,
  pendingProvider,
  isBusy,
}: {
  onSelect: (provider: SocialProviderId) => void;
  pendingProvider: SocialProviderId | null;
  isBusy: boolean;
}) {
  const providers = SOCIAL_PROVIDERS.filter((provider) => provider.enabled);
  if (providers.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "grid gap-3",
          providers.length > 1 ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {providers.map((provider) => (
          <Button
            key={provider.id}
            variant="outline"
            type="button"
            size="lg"
            className={AUTH_SOCIAL_BUTTON_CLASS}
            onClick={() => onSelect(provider.id)}
            disabled={isBusy}
            aria-busy={pendingProvider === provider.id}
          >
            {pendingProvider === provider.id ? (
              <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <provider.Glyph />
            )}
            {provider.label}
          </Button>
        ))}
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
  /* MOBILE ONLY. At `lg` the segmented tabs sit directly above the fields and
     offer the same move; the artboard carries this line only where those tabs
     are hidden. */
  return (
    <p className="text-center text-base text-muted-foreground lg:hidden">
      {prompt}{" "}
      <Link href={ctaHref} className={AUTH_LINK_CLASS}>
        {ctaLabel}
      </Link>
    </p>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: useAuthEffects, pendingProvider, SocialProviderId
 *
 * WHAT: Shared error state plus the OAuth handler for both forms.
 * WHY: `pendingProvider` is the id of the provider being used, not a
 * boolean: with two buttons in the row, a single `isPending` would
 * spin BOTH of them on one click. It doubles as the re-entrancy guard
 * the boolean was — a non-null value means a redirect is already in
 * flight. The provider id goes into the failure message so "Apple
 * sign-in failed" names the thing that actually failed.
 * WHERE: SignInForm and SignUpForm above.
 */
function useAuthEffects() {
  const [error, setError] = React.useState<string | null>(null);
  const [pendingProvider, setPendingProvider] =
    React.useState<SocialProviderId | null>(null);

  async function run(
    provider: SocialProviderId,
    callbackURL: Route,
    setErr: (v: string | null) => void,
  ) {
    if (pendingProvider !== null) return;
    setErr(null);
    setPendingProvider(provider);
    try {
      const { error: authError } = await authClient.signIn.social({
        provider,
        callbackURL,
      });
      if (authError) {
        const label = provider === "apple" ? "Apple" : "Google";
        setErr(authError.message ?? `${label} sign-in failed. Try again.`);
      }
    } finally {
      setPendingProvider(null);
    }
  }

  return { error, setError, social: { pendingProvider, run } };
}

/* Inline Apple mark. Apple's brand guidelines require their own logo on a
 * "Sign in with Apple" control; this is the glyph alone, which is what the
 * artboard draws. Swap in the official asset before shipping to production. */
function AppleGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="size-5"
      aria-hidden="true"
    >
      <path
        d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.9-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.28-1.27 3.13-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.12M14.5 4.76c.71-.87 1.19-2.07 1.06-3.27-1.02.04-2.26.68-3 1.54-.66.77-1.24 2-1.08 3.17 1.14.09 2.3-.58 3.02-1.44"
        fill="currentColor"
      />
    </svg>
  );
}

/* Inline Google "G" mark, drawn in `currentColor`.
 * TODO(brand): this is the single-colour outline of Google's G, not the
 * official four-colour asset — the repo ships no Google brand file, and
 * Google's "Sign in with Google" guidelines require their own mark on the
 * button. Drop the official SVG into public/ and point this at it before
 * production. The same applies to <AppleGlyph> above. */
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
