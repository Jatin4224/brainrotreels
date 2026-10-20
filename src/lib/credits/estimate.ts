/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: estimate, EstimateInput, CostBreakdown,
 *   CREDIT_RATES, PLACEHOLDER_CREDIT_RATES, ESTIMATE_IS_PURE,
 *   ESTIMATE_ROUNDS_UP, estimateRenderCost
 *
 * WHAT:  What a piece of paid work will cost, itemised.
 *
 * WHY:   ESTIMATE_IS_PURE — no I/O, no database, no clock, no randomness. It
 *        takes facts and returns a breakdown. That is what lets the SAME
 *        function produce the number on the button, the number held before the
 *        work starts, and the number the admin dashboard compares against the
 *        actual. Three different places, one answer; a second implementation
 *        anywhere would show a customer one price and charge another.
 *
 *        It returns a BREAKDOWN and never a bare total
 *        (BREAKDOWN_NEVER_A_BARE_TOTAL on CostBreakdown). A customer who
 *        thinks a render cost too much needs something to point at, and
 *        "12 credits" is unarguable in the bad sense.
 *
 *        ESTIMATE_ROUNDS_UP, always, at the END. Credits are integers — a
 *        fractional credit cannot be held or committed — and rounding down
 *        would mean every short render is charged less than it costs, which at
 *        volume is a slow leak nobody attributes. Rounding once at the end
 *        rather than per line keeps the lines honest: three lines of 0.4 are
 *        1.2 and should cost 2, not 3.
 *
 *        THE RATES ARE PLACEHOLDERS. See PLACEHOLDER_CREDIT_RATES below —
 *        they are deliberately in ONE constant so setting real prices is one
 *        edit to one object, with no arithmetic anywhere else to find.
 * WHERE: `renders.create` (the refusal and the hold), the render workflow's
 *        commit, and the cost shown on every credit-spending button.
 */

import {
  type CostBreakdown,
  type CostLine,
  type CreditableKind,
} from '@/lib/types/credits'

/**
 * SOURCE OF TRUTH KEYWORDS: PLACEHOLDER_CREDIT_RATES, CREDIT_RATES
 *
 * WHAT:  What everything costs, in credits.
 *
 * WHY:   ⚠ THESE NUMBERS ARE PLACEHOLDERS AND HAVE NOT BEEN PRICED. ⚠
 *
 *        They are internally consistent and shaped like a real tariff — a
 *        flat `base` per job plus a per-second rate, 1080p dearer than 720p,
 *        premium voices carrying a surcharge — so every consumer can be built
 *        and tested against them. What they are NOT is a commercial decision:
 *        nobody has compared them to what a Lambda render, a TTS second or a
 *        generated image actually costs to produce, or to what the plans sell
 *        for.
 *
 *        Setting real prices is an edit to THIS OBJECT and nothing else. That
 *        is the whole reason the rates are a single constant and the maths is
 *        a pure function: there is no arithmetic scattered through routers or
 *        components to go hunting for, and no second table to keep in step.
 *
 *        Two properties the CODE depends on, which real prices must preserve:
 *        every rate is a non-negative number, and `perSecond` for a kind with
 *        no duration is 0 rather than absent — a missing rate would produce
 *        NaN and a NaN total would be held, committed and shown to a customer
 *        without anything throwing.
 * WHERE: estimate() below, and nowhere else.
 */
export const CREDIT_RATES = {
  /** Flat cost of starting a job of this kind, whatever its length. */
  base: {
    render: 2,
    script: 1,
    tts: 1,
    alignment: 1,
    footage: 0,
  },
  /** Cost per second of output. Zero for kinds that have no duration. */
  perSecond: {
    render: 0.08,
    script: 0,
    tts: 0.05,
    alignment: 0.01,
    footage: 0,
  },
  /** Multiplier applied to a render's per-second rate, by output size. */
  resolutionMultiplier: {
    '720p': 1,
    '1080p': 1.5,
  },
  /** Each generated image, whatever produced it. */
  perAiImage: 4,
  /** Added per second of narration when a premium voice is used. */
  premiumVoiceSurchargePerSecond: 0.03,
} as const

/**
 * SOURCE OF TRUTH KEYWORDS: EstimateInput, ESTIMATE_TAKES_FACTS
 *
 * WHAT:  Everything that can change what a job costs.
 * WHY:   ESTIMATE_TAKES_FACTS — plain numbers, never a document, a Prisma row
 *        or a `Render`. That is what keeps this module pure and testable, and
 *        it is also what lets Phase 06 and 07 charge for work that has no
 *        document yet. The caller extracts the facts; this does the maths.
 *
 *        Every field but `kind` is optional and defaults to the nothing-case,
 *        because a kind that has no duration or no images must not be forced
 *        to pass zeroes it does not have.
 * WHERE: The single argument of estimate().
 */
export interface EstimateInput {
  kind: CreditableKind
  /** Seconds of output. A render's video length, a TTS clip's narration. */
  durationSeconds?: number
  /** Only meaningful for `render`; ignored otherwise. */
  resolution?: keyof typeof CREDIT_RATES.resolutionMultiplier
  /** Generated images this job will produce. */
  aiImages?: number
  /** Whether the narration uses a premium voice. */
  premiumVoice?: boolean
}

/**
 * SOURCE OF TRUTH KEYWORDS: estimate, ESTIMATE_ROUNDS_UP
 *
 * WHAT:  The cost of one job, itemised and rounded up to whole credits.
 * WHERE: See the file header.
 */
export function estimate(input: EstimateInput): CostBreakdown {
  const {
    kind,
    durationSeconds = 0,
    resolution = '1080p',
    aiImages = 0,
    premiumVoice = false,
  } = input

  /* Guarded rather than trusted. A negative duration is nonsense that would
   * produce a NEGATIVE line and therefore a job that PAYS the customer; a
   * non-finite one (a NaN arriving from a division by a zero frame rate) would
   * propagate silently all the way to a held amount of NaN. Both collapse to
   * the nothing-case, which charges the base rate and no more. */
  const seconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0
  const images = Number.isFinite(aiImages) && aiImages > 0 ? Math.floor(aiImages) : 0

  const lines: { label: string; credits: number }[] = []

  const base = CREDIT_RATES.base[kind]
  if (base > 0) {
    lines.push({ label: LABELS[kind], credits: base })
  }

  if (seconds > 0) {
    const multiplier =
      kind === 'render' ? CREDIT_RATES.resolutionMultiplier[resolution] : 1
    const perSecond = CREDIT_RATES.perSecond[kind] * multiplier
    if (perSecond > 0) {
      lines.push({
        label:
          kind === 'render'
            ? `${formatSeconds(seconds)} at ${resolution}`
            : formatSeconds(seconds),
        credits: perSecond * seconds,
      })
    }
  }

  if (images > 0) {
    lines.push({
      label: `${images} generated image${images === 1 ? '' : 's'}`,
      credits: CREDIT_RATES.perAiImage * images,
    })
  }

  if (premiumVoice && seconds > 0) {
    lines.push({
      label: 'Premium voice',
      credits: CREDIT_RATES.premiumVoiceSurchargePerSecond * seconds,
    })
  }

  /* ESTIMATE_ROUNDS_UP — once, at the end, over the real sum. Rounding each
   * line first would turn three 0.4s into 3 credits instead of 2. The LINES
   * are rounded for display only, after the total is already decided, so they
   * always add up to something a customer can check. */
  const exactTotal = lines.reduce((sum, line) => sum + line.credits, 0)
  const total = Math.ceil(exactTotal)

  return {
    total,
    lines: roundLinesToTotal(lines, total),
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: estimateRenderCost, ONE_CALLER_ONE_SHAPE
 *
 * WHAT:  A render's cost, from the two facts a render has.
 * WHY:   A named wrapper rather than every caller assembling an EstimateInput
 *        by hand. Three places need a render's cost — the refusal in
 *        `renders.create`, the hold in the workflow, and the commit after it —
 *        and they must agree exactly or a render is refused at one price and
 *        charged at another. One function means they cannot disagree.
 * WHERE: src/trpc/routers/renders.ts and
 *        src/inngest/functions/project-render.ts.
 */
export function estimateRenderCost(args: {
  durationSeconds: number
  resolution: keyof typeof CREDIT_RATES.resolutionMultiplier
}): CostBreakdown {
  return estimate({
    kind: 'render',
    durationSeconds: args.durationSeconds,
    resolution: args.resolution,
  })
}

/* The customer-facing name of each kind. Separate from the union so renaming
 * what a customer sees is not a schema change. */
const LABELS: Readonly<Record<CreditableKind, string>> = {
  render: 'Render',
  script: 'Script generation',
  tts: 'Narration',
  alignment: 'Caption timing',
  footage: 'Generated footage',
}

function formatSeconds(seconds: number): string {
  /* Whole seconds under a minute, m:ss above — a 95-second render reading
   * "95s" is correct and reads as an error. */
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

/**
 * SOURCE OF TRUTH KEYWORDS: roundLinesToTotal, LINES_MUST_ADD_UP
 *
 * WHAT:  Rounds each line to a whole credit and makes the lines sum to the
 *        total that was already computed from the exact values.
 * WHY:   LINES_MUST_ADD_UP. The total is rounded up from the EXACT sum
 *        (ESTIMATE_ROUNDS_UP), so independently rounding each line would
 *        routinely produce a breakdown that does not add up — the single most
 *        corrosive thing an itemised bill can do, because it makes a customer
 *        distrust every number on it including the correct ones. The remainder
 *        is put on the LARGEST line, where a credit of rounding is the
 *        smallest proportion of what is shown.
 * WHERE: estimate(), as its last act.
 */
function roundLinesToTotal(
  lines: readonly { label: string; credits: number }[],
  total: number,
): CostLine[] {
  if (lines.length === 0) return []

  const rounded: CostLine[] = lines.map((line) => ({
    label: line.label,
    credits: Math.max(0, Math.round(line.credits)),
  }))

  const drift = total - rounded.reduce((sum, line) => sum + line.credits, 0)
  if (drift === 0) return rounded

  let largestIndex = 0
  for (let i = 1; i < rounded.length; i += 1) {
    const candidate = rounded[i]
    const current = rounded[largestIndex]
    if (candidate !== undefined && current !== undefined && candidate.credits > current.credits) {
      largestIndex = i
    }
  }

  const target = rounded[largestIndex]
  if (target !== undefined) {
    rounded[largestIndex] = {
      label: target.label,
      credits: Math.max(0, target.credits + drift),
    }
  }

  return rounded
}
