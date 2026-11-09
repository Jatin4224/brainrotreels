/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: signInSchema, signUpSchema, SignInValues,
 *   SignUpValues, AuthFormMode, AUTH_PASSWORD_MIN_LENGTH, authSchemaFor
 *
 * WHAT:  Zod schemas + inferred value types for the email+password auth
 *        flows, plus the `AuthFormMode` discriminator and a tiny
 *        `authSchemaFor(mode)` lookup so the form can pick a schema by mode.
 * WHY:   Forms, server validators, and future server actions all need the
 *        same input contract — keeping the schemas in `lib/types` (the
 *        type source-of-truth folder per CLAUDE.md) means every caller
 *        infers from the SAME zod object and drift is impossible.
 * WHERE: Imported by src/components/global/auth/auth-form.tsx today; any
 *        future server-side auth router/route handler MUST `safeParse`
 *        against these schemas so the client and server agree byte-for-byte.
 */

import { z } from "zod";

/* Server (auth.ts) does not impose a max; Better Auth's own bcrypt path
 * caps at 72 bytes, but most users will not see that. The 8-character
 * minimum matches the `minLength={8}` hint we surface in the UI. */
export const AUTH_PASSWORD_MIN_LENGTH = 8;

/**
 * SOURCE OF TRUTH KEYWORDS: signInSchema, SignInValues
 *
 * WHAT:  Sign-in payload schema — trimmed email + non-empty password.
 * WHY:   Password length is NOT re-validated here because old accounts may
 *        predate the current 8-char minimum; we only block empty input.
 * WHERE: Used by AuthForm in sign-in mode.
 */
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

export type SignInValues = z.infer<typeof signInSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: signUpSchema, SignUpValues
 *
 * WHAT:  Sign-up payload schema — name + email + password (>= 8 chars).
 * WHY:   `name` is required by Better Auth's email/password sign-up; we
 *        enforce >= 8 here so the user gets a clear validation error before
 *        the round-trip instead of a generic server reject.
 * WHERE: Used by AuthForm in sign-up mode.
 */
export const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name is too long."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email."),
  password: z
    .string()
    .min(
      AUTH_PASSWORD_MIN_LENGTH,
      `At least ${AUTH_PASSWORD_MIN_LENGTH} characters.`,
    ),
});

export type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: AuthFormMode
 *
 * WHAT:  Discriminator for which auth flow the global AuthForm runs.
 * WHY:   Lives next to the schemas so adding a future mode (magic-link,
 *        password-reset) means adding a schema + extending this union and
 *        the lookup below — one file, one diff.
 * WHERE: Consumed by AuthForm and the (auth) route pages.
 */
export type AuthFormMode = "sign-in" | "sign-up";

/**
 * SOURCE OF TRUTH KEYWORDS: AuthValuesByMode
 *
 * WHAT:  Type-level mapping mode → inferred values, so the form's generic
 *        `useForm<AuthValuesByMode[Mode]>()` lights up the right field set.
 * WHY:   Avoids per-mode prop overloads on AuthForm and keeps `field.name`
 *        typed against the exact schema being used.
 * WHERE: Consumed by AuthForm via generic constraint.
 */
export interface AuthValuesByMode {
  "sign-in": SignInValues;
  "sign-up": SignUpValues;
}

/**
 * SOURCE OF TRUTH KEYWORDS: authSchemaFor
 *
 * WHAT:  Runtime lookup: `mode` → its zod schema.
 * WHY:   Lets the form pass the right resolver without a switch at every
 *        call-site; the `as` narrowing is safe because both keys are
 *        exhaustively present.
 * WHERE: Used by AuthForm to build the zodResolver.
 */
export const authSchemaFor = {
  "sign-in": signInSchema,
  "sign-up": signUpSchema,
} as const satisfies Record<AuthFormMode, z.ZodType>;

/**
 * SOURCE OF TRUTH KEYWORDS: forgotPasswordSchema, ForgotPasswordValues
 *
 * WHAT:  Forgot-password request payload — just the email.
 * WHERE: Used by the forgot-password form.
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email."),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: resetPasswordSchema, ResetPasswordValues
 *
 * WHAT:  Reset-password payload — new password + confirmation (must match).
 * WHERE: Used by the reset-password form.
 */
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(
        AUTH_PASSWORD_MIN_LENGTH,
        `At least ${AUTH_PASSWORD_MIN_LENGTH} characters.`,
      ),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: AuthScreenCopy, AUTH_SCREEN_COPY, AuthFormMode,
 *   PAGE_OWNED_COPY, THE_HEADLINE_IS_SPLIT, TWO_HEADINGS_ONE_SCREEN
 *
 * WHAT:  Everything the sign-in and sign-up screens say that is NOT a field
 *        label — both of the screen's headings, the lead under the compact
 *        one, the submit label and the mobile cross-link.
 *
 * WHY:   PAGE_OWNED_COPY, the same discipline `HERO_COPY` keeps on the
 *        landing page. Both modes render ONE component, so the words are the
 *        only thing that differs between them; holding them in a
 *        `Record<AuthFormMode, AuthScreenCopy>` means adding a third mode
 *        fails the typecheck here until it has been given words, rather than
 *        rendering a screen with a blank heading.
 *
 *        TWO_HEADINGS_ONE_SCREEN, which is why there are two sets of headline
 *        fields rather than one. At `lg` and up the pitch lives in the panel
 *        on the right, so the form column opens with a short, plain
 *        "Welcome back" — a second display headline beside the first would be
 *        two things shouting at each other. Below `lg` there IS no panel, so
 *        the form column has to carry the pitch itself and wears the big
 *        display headline instead. Same component, same copy record, one
 *        `lg:` swap — see AuthHero.
 *
 *        THE_HEADLINE_IS_SPLIT for the same reason the hero's is: the yellow
 *        block is a positioned element BEHIND one phrase, so the screen has to
 *        know where that phrase starts and ends. One string with markup in it
 *        would make rewording the headline a code change.
 *
 * WHERE: `AUTH_SCREEN_COPY` in src/components/global/auth/auth-content.ts,
 *        read by src/components/global/auth/auth-hero.tsx.
 */
export interface AuthScreenCopy {
  /** The compact heading shown from `lg` up, e.g. "Welcome back". */
  title: string;
  /** One short sentence under `title`. Shown from `lg` up only. */
  lead: string;
  /** Below `lg`: the display headline, split at the highlighted phrase. */
  mobileHeadlineBefore: string;
  /** The one phrase the tilted block sits behind. */
  mobileHeadlineHighlight: string;
  mobileHeadlineAfter: string;
  /** The primary button's label. */
  submitLabel: string;
  /** Under the mobile CTA, left of the cross-link. */
  footerPrompt: string;
  footerCta: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuthPanelCopy, AUTH_PANEL_COPY, HERO_COPY,
 *   AUTH_MESSAGE_PANEL, OPERATOR_OWNS_THESE_CLAIMS, THE_HEADLINE_IS_SPLIT
 *
 * WHAT:  The words on the panel beside the desktop auth form — the display
 *        headline, the paragraph under it and the social-proof line.
 *
 * WHY:   The panel is the landing page's pitch, restated beside the fields,
 *        so its words MIRROR `HERO_COPY`. They are a separate constant rather
 *        than an import because `HERO_COPY` is route-local to
 *        `(marketing)/_components` and a global component reaching into a
 *        route's private folder is the wrong direction — but the two must be
 *        corrected TOGETHER, and the comment on `AUTH_PANEL_COPY` says so.
 *        OPERATOR_OWNS_THESE_CLAIMS: `socialProof` is the operator's figures,
 *        unverifiable from this codebase, and a visitor who presses "Get
 *        started" sees it twice within one click — two different numbers
 *        across that click is the failure this pairing guards against.
 * WHERE: `AUTH_PANEL_COPY` in src/components/global/auth/auth-content.ts,
 *        rendered by src/components/global/auth/auth-showcase.tsx.
 */
export interface AuthPanelCopy {
  headlineBefore: string;
  headlineHighlight: string;
  headlineAfter: string;
  lead: string;
  socialProof: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SOCIAL_PROVIDER_IDS, SocialProviderId,
 *   SOCIAL_PROVIDERS_ARE_OPT_IN, NO_DEAD_PROVIDER_BUTTONS, resolveSocialProviders
 *
 * WHAT:  The OAuth providers this app can be configured with, as the ids
 *        Better Auth knows them by.
 * WHY:   Both halves of the feature read this list — the server resolver that
 *        builds `socialProviders` and the button row that offers them — so it
 *        is a contract, which per CLAUDE.md puts it in `lib/types` rather
 *        than in either consumer. The ids are Better Auth's own provider
 *        names, NOT display labels: they are passed straight to
 *        `authClient.signIn.social({ provider })`, so a typo here is a
 *        runtime "unsupported provider" rather than a compile error, and
 *        keeping them in one `as const` is what stops the server and the
 *        client inventing two spellings of the same provider.
 * WHERE: `SOCIAL_PROVIDERS` in the Better Auth auth form, and
 *        `resolveSocialProviders` in src/lib/better-auth/auth.ts.
 */
export const SOCIAL_PROVIDER_IDS = ["google", "apple"] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];
