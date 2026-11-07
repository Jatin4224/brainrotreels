/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ResetPasswordForm, AUTH_SURFACE, AuthError,
 *   AUTH_CTA_CLASS, AUTH_FIELD_CLASS, AUTH_LABEL_CLASS, AUTH_LINK_CLASS
 *
 * WHAT:  Sets a new password using the token from the reset-link email. Reads
 *        the token from the URL (Better Auth appends ?token=...). Handles the
 *        missing-token case with an "invalid link" screen and confirms success.
 * WHY:   Calls Better Auth resetPassword with the token; the shared
 *        resetPasswordSchema enforces the length + confirm-match rule.
 *        AUTH_SURFACE: wears the SAME skins as sign-in and sign-up, from
 *        @/components/global/auth/auth-styles, so a restyle of the auth flow
 *        cannot leave the last screen of it looking like the old product.
 * WHERE: Rendered by src/app/(auth)/reset-password/page.tsx (inside Suspense,
 *        since it reads searchParams) within AuthShell.
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, CheckCircle2Icon } from "lucide-react";

import { authClient } from "@/lib/better-auth/auth-client";
import { AUTH_ROUTES } from "@/lib/config";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/types";
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

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
    mode: "onTouched",
  });

  async function onSubmit(values: ResetPasswordValues) {
    if (!token) return;
    setError(null);
    const { error: authError } = await authClient.resetPassword({
      newPassword: values.password,
      token,
    });
    if (authError) {
      setError(
        authError.message ??
          "Could not reset your password. The link may have expired.",
      );
      return;
    }
    setDone(true);
  }

  if (!token) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Invalid reset link
        </h1>
        <p className="text-balance text-base text-muted-foreground">
          This password reset link is invalid or has expired. Request a new one.
        </p>
        <Link href={AUTH_ROUTES.forgotPassword} className={AUTH_LINK_CLASS}>
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="brutal-shadow-lg flex size-28 -rotate-6 items-center justify-center rounded-[2rem] bg-brand-accent">
          <CheckCircle2Icon className="size-12 rotate-6 text-brand-accent-foreground" />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Password reset
          </h1>
          <p className="text-balance text-base text-muted-foreground">
            Your password has been updated. Sign in with your new password.
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
          Reset your password
        </h1>
        <p className="text-balance text-base text-muted-foreground">
          Enter a new password for your account.
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={AUTH_LABEL_CLASS}>New password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
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
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={AUTH_LABEL_CLASS}>
                  Confirm password
                </FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Type it once more"
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
            Reset password
          </Button>
        </form>
      </Form>
      <p className="text-center text-base text-muted-foreground">
        <Link href={AUTH_ROUTES.signIn} className={AUTH_LINK_CLASS}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
