/**
 * SOURCE OF TRUTH KEYWORDS: publicEnv, RAW_PUBLIC_ENV, LITERAL_ENV_READ,
 *                           NEXT_PUBLIC inlining, envString, envBoolean, envInteger
 *
 * WHAT:  Every `NEXT_PUBLIC_*` variable, read literally, parsed and typed.
 * WHY:   LITERAL_ENV_READ is the whole point of this file. Next.js replaces
 *        `process.env.NEXT_PUBLIC_X` in the CLIENT bundle only for a LITERAL
 *        member or index access. A computed read — `process.env[key]` inside a
 *        helper — is left alone, so it evaluates against an empty object in the
 *        browser and silently yields the fallback. `plans.ts` did exactly that
 *        for every plan name, description, showPlan and trialDays, which meant
 *        an operator could rename a plan in .env, see it correctly on the
 *        server, and watch the pricing card render the template default. Every
 *        read below is therefore spelled out in full, once, in RAW_PUBLIC_ENV.
 *        Nothing here throws. These values are all optional with defaults, and
 *        a missing one must never prevent the setup checklist from rendering —
 *        see required-env.ts, which owns "is this configured" separately.
 * WHERE: Consumed by plans.ts and branding.ts. Safe to import from a client
 *        component; server-only variables live in env.server.ts instead.
 */

import { z } from 'zod'

/* LITERAL_ENV_READ: do not refactor into a loop or a helper taking a key.
 * Each access must survive as written for Next to inline it client-side. */
const RAW_PUBLIC_ENV = {
  NEXT_PUBLIC_AUTH_PROVIDER: process.env['NEXT_PUBLIC_AUTH_PROVIDER'],
  NEXT_PUBLIC_APP_NAME: process.env['NEXT_PUBLIC_APP_NAME'],
  NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
  NEXT_PUBLIC_APP_DESCRIPTION: process.env['NEXT_PUBLIC_APP_DESCRIPTION'],
  NEXT_PUBLIC_APP_DOMAIN: process.env['NEXT_PUBLIC_APP_DOMAIN'],
  NEXT_PUBLIC_REGISTRATION_OPEN: process.env['NEXT_PUBLIC_REGISTRATION_OPEN'],
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'],
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],

  NEXT_PUBLIC_FREE_NAME: process.env['NEXT_PUBLIC_FREE_NAME'],
  NEXT_PUBLIC_FREE_DESCRIPTION: process.env['NEXT_PUBLIC_FREE_DESCRIPTION'],
  NEXT_PUBLIC_FREE_SHOW_PLAN: process.env['NEXT_PUBLIC_FREE_SHOW_PLAN'],
  NEXT_PUBLIC_FREE_TRIAL_DAYS: process.env['NEXT_PUBLIC_FREE_TRIAL_DAYS'],

  NEXT_PUBLIC_STARTER_NAME: process.env['NEXT_PUBLIC_STARTER_NAME'],
  NEXT_PUBLIC_STARTER_DESCRIPTION: process.env['NEXT_PUBLIC_STARTER_DESCRIPTION'],
  NEXT_PUBLIC_STARTER_SHOW_PLAN: process.env['NEXT_PUBLIC_STARTER_SHOW_PLAN'],
  NEXT_PUBLIC_STARTER_TRIAL_DAYS: process.env['NEXT_PUBLIC_STARTER_TRIAL_DAYS'],
  NEXT_PUBLIC_STARTER_PRICE_MONTHLY: process.env['NEXT_PUBLIC_STARTER_PRICE_MONTHLY'],
  NEXT_PUBLIC_STARTER_PRICE_YEARLY: process.env['NEXT_PUBLIC_STARTER_PRICE_YEARLY'],

  NEXT_PUBLIC_PRO_NAME: process.env['NEXT_PUBLIC_PRO_NAME'],
  NEXT_PUBLIC_PRO_DESCRIPTION: process.env['NEXT_PUBLIC_PRO_DESCRIPTION'],
  NEXT_PUBLIC_PRO_SHOW_PLAN: process.env['NEXT_PUBLIC_PRO_SHOW_PLAN'],
  NEXT_PUBLIC_PRO_TRIAL_DAYS: process.env['NEXT_PUBLIC_PRO_TRIAL_DAYS'],
  NEXT_PUBLIC_PRO_PRICE_MONTHLY: process.env['NEXT_PUBLIC_PRO_PRICE_MONTHLY'],
  NEXT_PUBLIC_PRO_PRICE_YEARLY: process.env['NEXT_PUBLIC_PRO_PRICE_YEARLY'],

  NEXT_PUBLIC_ENTERPRISE_NAME: process.env['NEXT_PUBLIC_ENTERPRISE_NAME'],
  NEXT_PUBLIC_ENTERPRISE_DESCRIPTION: process.env['NEXT_PUBLIC_ENTERPRISE_DESCRIPTION'],
  NEXT_PUBLIC_ENTERPRISE_SHOW_PLAN: process.env['NEXT_PUBLIC_ENTERPRISE_SHOW_PLAN'],
  NEXT_PUBLIC_ENTERPRISE_TRIAL_DAYS: process.env['NEXT_PUBLIC_ENTERPRISE_TRIAL_DAYS'],
  NEXT_PUBLIC_ENTERPRISE_PRICE_MONTHLY: process.env['NEXT_PUBLIC_ENTERPRISE_PRICE_MONTHLY'],
  NEXT_PUBLIC_ENTERPRISE_PRICE_YEARLY: process.env['NEXT_PUBLIC_ENTERPRISE_PRICE_YEARLY'],
} as const

export type PublicEnvKey = keyof typeof RAW_PUBLIC_ENV

/**
 * SOURCE OF TRUTH KEYWORDS: envString, envBoolean, envInteger, BLANK_IS_UNSET
 *
 * WHAT:  Coercion helpers applied to an already-read value.
 * WHY:   They take the VALUE, never the key — taking a key is what reintroduces
 *        the computed-read bug. BLANK_IS_UNSET: `.env.example` ships keys as
 *        empty strings, so an empty or whitespace value must mean "not set"
 *        rather than "set to empty", or copying the example file would blank
 *        every plan name.
 */
const trimmed = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0)

export function envString(value: string | undefined, fallback: string): string {
  const parsed = trimmed.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

export function envBoolean(value: string | undefined, fallback: boolean): boolean {
  const parsed = trimmed.safeParse(value)
  if (!parsed.success) return fallback
  return parsed.data === 'true'
}

/* Rejects NaN and negatives rather than letting them through as a cap. */
const nonNegativeInt = z.coerce.number().int().nonnegative()

export function envInteger(value: string | undefined, fallback: number): number {
  const text = trimmed.safeParse(value)
  if (!text.success) return fallback
  const parsed = nonNegativeInt.safeParse(text.data)
  return parsed.success ? parsed.data : fallback
}

/* An unset optional string stays `undefined` rather than becoming `''`, so
 * exactOptionalPropertyTypes consumers can spread it conditionally. */
export function envOptional(value: string | undefined): string | undefined {
  const parsed = trimmed.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
 * SOURCE OF TRUTH KEYWORDS: publicEnv
 *
 * WHAT:  The parsed public environment. Values only — no "is it configured"
 *        reporting, which belongs to required-env.ts.
 * WHERE: plans.ts, branding.ts.
 */
export const publicEnv = RAW_PUBLIC_ENV
