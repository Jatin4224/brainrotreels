/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ForgotPasswordForm, AUTH_SURFACE, AuthError,
 *   AUTH_CTA_CLASS, AUTH_FIELD_CLASS, AUTH_LABEL_CLASS, AUTH_LINK_CLASS
 *
 * WHAT:  Requests a password-reset email. On success shows a
 *        "check your email" screen (shown regardless of whether the address
 *        exists — prevents email enumeration).
 * WHY:   Better Auth emails the reset link via the sendResetPassword hook in
 *        auth.ts; the link lands on AUTH_ROUTES.resetPassword with a token.
 *        AUTH_SURFACE: it wears the SAME skins as sign-in and sign-up, from
 *        @/components/global/auth/auth-styles, rather than its own classes.
 *        This screen is reached mid-flow from the sign-in form, and the
 *        regression that keeps happening is this one being left behind by a
 *        restyle so the field under the same headline is suddenly a different
 *        height. The error banner is <AuthError> for the same reason.
 * WHERE: Rendered by src/app/(auth)/forgot-password/page.tsx inside AuthShell.
 */

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, MailCheckIcon } from "lucide-react";

import { authClient } from "@/lib/better-auth/auth-client";
import { AUTH_ROUTES } from "@/lib/config";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/types";
import { useDevEmailToast } from "@/hooks/use-dev-email-toast";
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
/* By path, not through ./index: that barrel re-exports this very form. */
import { AuthError } from "@/components/global/auth/auth-error";
import {
  AUTH_CTA_CLASS,
  AUTH_FIELD_CLASS,
  AUTH_LABEL_CLASS,
  AUTH_LINK_CLASS,
} from "@/components/global/auth/auth-styles";

export function ForgotPasswordForm() {
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const notifyDevEmail = useDevEmailToast();
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onTouched",
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setError(null);
    const { error: authError } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: AUTH_ROUTES.resetPassword,
    });
    if (authError) {
      setError(authError.message ?? "Something went wrong. Please try again.");
      return;
    }
    setSent(true);
    /* Dev-only: surface the reset link in a toast when Resend isn't configured. */
    void notifyDevEmail(values.email);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="brutal-shadow-lg flex size-28 -rotate-6 items-center justify-center rounded-[2rem] bg-brand-accent">
          <MailCheckIcon className="size-12 rotate-6 text-brand-accent-foreground" />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Check your email
          </h1>
          <p className="text-balance text-base text-muted-foreground">
            If an account exists with that email address, we&apos;ve sent a link
            to reset your password. Check your inbox and spam folder.
          </p>
        </div>
        <Link href={AUTH_ROUTES.signIn} className={AUTH_LINK_CLASS}>
          Back to sign in
        </Link>
      </div>
    );
  }

  const isBusy = form.formState.isSubmitting;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-balance text-base text-muted-foreground">
          Enter your email address and we&apos;ll send you a link to reset your
          password.
        </p>
      </div>
      <AuthError error={error} />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-6"
          noValidate
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
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
          <Button
            type="submit"
            size="lg"
            className={AUTH_CTA_CLASS}
            disabled={isBusy}
            aria-busy={isBusy}
          >
            {isBusy ? (
              <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
            ) : null}
            Send reset link
          </Button>
        </form>
      </Form>
      <div className="text-center text-sm">
        Remember your password?{" "}
        <Link
          href={AUTH_ROUTES.signIn}
          className="underline underline-offset-4"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
