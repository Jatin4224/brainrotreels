/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthForm, AuthShell, AuthError, AuthHero,
 *   AuthShowcase, AuthModeNav, AuthModeTabs, ForgotPasswordForm,
 *   ResetPasswordForm, AuthFormProps, AuthShellProps, AuthErrorProps,
 *   AuthHeroProps, AuthShowcaseProps, AuthModeSwitchProps, AUTH_SCREEN_COPY,
 *   AUTH_SHOWCASE_COPY
 *
 * WHAT:  Barrel export for the global auth UI primitives — the chrome
 *        (shell, hero, showcase, mode switch, error banner), the
 *        provider-branched screens, and the screens' copy. Mode/schema types
 *        deliberately re-exported from @/lib/types (the type source of
 *        truth) — NOT from here.
 * WHY:   One import surface for UI; one separate surface for contracts.
 *        The style constants in ./auth-styles are NOT re-exported: their
 *        consumers are the provider forms, which must import from this folder
 *        BY PATH to avoid closing an import cycle back through the screens
 *        this barrel re-exports.
 * WHERE: Imported by every page under src/app/(auth)/.
 */

export { AuthScreen as AuthForm } from "@/components/global/providers/server";
export type { AuthScreenProps as AuthFormProps } from "@/components/global/providers/server";
export { AuthShell } from "./auth-shell";
export { AuthError } from "./auth-error";
export { AuthHero } from "./auth-hero";
export { AuthShowcase } from "./auth-showcase";
export { AuthModeNav, AuthModeTabs } from "./auth-mode-switch";
export { AUTH_SCREEN_COPY, AUTH_SHOWCASE_COPY } from "./auth-content";
export type { AuthErrorProps } from "./auth-error";
export type { AuthShellProps } from "./auth-shell";
export type { AuthHeroProps } from "./auth-hero";
export type { AuthShowcaseProps } from "./auth-showcase";
export type { AuthModeSwitchProps } from "./auth-mode-switch";
export { ForgotPasswordScreen as ForgotPasswordForm } from "@/components/global/providers/server";
export { ResetPasswordScreen as ResetPasswordForm } from "@/components/global/providers/server";
