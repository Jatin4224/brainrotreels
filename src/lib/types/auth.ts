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
 * SOURCE OF TRUTH KEYWORDS: AuthShowcaseTone, AuthShowcaseCard,
 *   AUTH_SHOWCASE_PANEL, ReelShowcaseItem, PRODUCT_AS_PROOF
 *
 * WHAT:  One of the three fanned 9:16 example cards in the desktop auth
 *        screen's showcase panel — its tag, its hook line, and which of the
 *        three brand surfaces it is painted in.
 * WHY:   AUTH_SHOWCASE_PANEL is DECOR, not proof, which is exactly why it has
 *        its own type instead of borrowing `ReelShowcaseItem`. That type
 *        carries a poster image, a username and five engagement counts because
 *        the landing page's phone is a simulated feed; the auth panel is three
 *        flat colour blocks with a line of text on each, and typing it as a
 *        reel would oblige every caller to invent a poster and a like count
 *        that nothing renders.
 *        `tone` is a closed union rather than a class name so the card cannot
 *        smuggle a raw colour in — the component maps each tone to the theme
 *        tokens, which is what keeps TOKENS_NOT_HEX true for this panel.
 * WHERE: `AUTH_SHOWCASE_CARDS` in
 *        src/components/global/auth/auth-content.ts, rendered by
 *        src/components/global/auth/auth-showcase.tsx.
 */
export type AuthShowcaseTone = "surface" | "accent" | "brand";

export interface AuthShowcaseCard {
  /** Stable React key. */
  id: string;
  /** The small pill at the card's top-left, e.g. "Science". */
  tag: string;
  /** The hook line across the card's lower half. */
  title: string;
  tone: AuthShowcaseTone;
  /** Shows the thin progress bar under the title — the centre card only. */
  playing?: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuthScreenCopy, AUTH_SCREEN_COPY, AuthFormMode,
 *   PAGE_OWNED_COPY, THE_HEADLINE_IS_SPLIT
 *
 * WHAT:  Everything the sign-in and sign-up screens say that is NOT a field
 *        label — the badge, the split headline, the lead, the top-bar prompt
 *        and the submit label.
 * WHY:   PAGE_OWNED_COPY, the same discipline `HERO_COPY` keeps on the landing
 *        page. Both modes render ONE component, so the words are the only
 *        thing that differs between them; holding them in a
 *        `Record<AuthFormMode, AuthScreenCopy>` means adding a third mode
 *        fails the typecheck here until it has been given words, rather than
 *        rendering a screen with a blank headline.
 *        THE_HEADLINE_IS_SPLIT for the same reason the hero's is: the yellow
 *        block is a positioned element BEHIND one phrase, so the screen has to
 *        know where that phrase starts and ends. One string with markup in it
 *        would make rewording the headline a code change.
 * WHERE: `AUTH_SCREEN_COPY` in src/components/global/auth/auth-content.ts,
 *        read by src/components/global/auth/auth-hero.tsx and the top bar
 *        built in src/app/(auth)/sign-in|sign-up/page.tsx.
 */
export interface AuthScreenCopy {
  /** The yellow pill above the headline. */
  badge: string;
  headlineBefore: string;
  /** The one phrase the tilted block sits behind. */
  headlineHighlight: string;
  headlineAfter: string;
  lead: string;
  /** Top bar, left of the pill: "New here?" / "Already creating?". */
  navPrompt: string;
  /** Top bar pill label — always the OPPOSITE mode. */
  navCta: string;
  /** The primary button's label. */
  submitLabel: string;
  /** The footer line under the mobile CTA, left of the cross-link. */
  footerPrompt: string;
  footerCta: string;
}
