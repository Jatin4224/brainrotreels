/**
 * SOURCE OF TRUTH KEYWORDS: LandingData, resolveLandingData, DEMO_LANDING_DATA,
 *   WORST_CASE_LANDING_DATA, LandingDataVariant, DEV_ONLY_FIXTURE,
 *   THE_WORST_CASE_IS_SCHEMA_BACKED
 *
 * WHAT:  The landing page's data boundary, plus the worst-case, empty and
 *        single-item fixtures the dev route at /dev/landing renders through
 *        it. LandingPage takes `data` and defaults to DEMO_LANDING_DATA, so
 *        `/` is unchanged and still prerenders.
 *
 * WHY:   The page was built against kind data — four plans whose names are
 *        one word, amounts under three figures, every poster present. None of
 *        that is guaranteed, and most of it is not even ours to guarantee:
 *
 *        THE_WORST_CASE_IS_SCHEMA_BACKED. `envString` (config/env.public.ts)
 *        validates NON-EMPTY AFTER TRIM and nothing else — no maximum — and
 *        `envInteger` is a non-negative integer with no upper bound. So a
 *        plan called "Enterprise & Custom Deployments", an amount of 1299, a
 *        currency symbol of "CHF " and 90 trial days are not invented stress
 *        values: they are what the public env contract already permits any
 *        deployment to set, today, without touching code. The same goes for
 *        `MarketingProofClip.poster`, which proof-strip.tsx documents as
 *        operator-supplied and possibly off-domain — i.e. possibly a 404.
 *
 *        The rest (format labels, FAQ answers, step blurbs) has no limit
 *        anywhere, so the fixture uses the longest value a copywriter would
 *        plausibly write rather than a wall of characters: a break nobody
 *        believes is a break nobody fixes.
 *
 *        DEV_ONLY_FIXTURE. Nothing here is imported by `/`; the route that
 *        renders it 404s in production. The fixtures stay after the fixes as
 *        the regression test for the next person who edits this page.
 * WHERE: Rendered by src/app/(marketing)/dev/landing/page.tsx. Consumed by
 *        the `data` prop of src/app/(marketing)/page.tsx.
 */

import { PROJECT_FLOW_STEPS } from "@/components/global/project-steps/steps";
import { APP_NAME } from "@/lib/config/branding";
import {
  PLANS,
  PLAN_ORDER,
  PLAN_PRICE_CURRENCY_SYMBOL,
  type PlanKey,
} from "@/lib/config/plans";
import { RESOURCES, getEntryPlanForResource } from "@/lib/resources";
import type {
  FaqItem,
  MarketingFormat,
  MarketingPipelineRow,
  MarketingProofClip,
  ProjectKind,
} from "@/lib/types";

import {
  FORMAT_CARD_ART,
  HANDLED_FOR_YOU,
  HERO_COPY,
  LANDING_FAQ,
  LANDING_FEATURE_KEYS,
  LANDING_FORMATS,
  LANDING_PROOF_CLIPS,
  STEP_BLURBS,
} from "./landing-content";

/* HERO_COPY is `as const`, so its own type is a set of literal strings and
   nothing else can be assigned to it. The page only ever reads these as
   text, so the prop widens them to string — otherwise a fixture could not
   state a different headline, which is the entire point. */
export interface LandingHeroCopy {
  eyebrow: string;
  headlineBefore: string;
  headlineHighlight: string;
  headlineAfter: string;
  lead: string;
  socialProof: string;
  renderedBadge: string;
  showcaseFootnote: string;
}

/** A plan card, flattened so a fixture can state one without a PlanDefinition. */
export interface LandingPlanCard {
  key: PlanKey;
  name: string;
  description: string;
  monthlyAmount: number;
  trialDays: number;
}

/** A feature row, with the gate already resolved to a plan NAME or null. */
export interface LandingFeatureRow {
  key: string;
  name: string;
  description: string;
  entryPlanName: string | null;
}

export interface LandingData {
  appName: string;
  currencySymbol: string;
  hero: LandingHeroCopy;
  formats: readonly MarketingFormat[];
  formatArt: Partial<Record<ProjectKind, string>>;
  proofClips: readonly MarketingProofClip[];
  stepBlurbs: Readonly<Record<string, string>>;
  handled: readonly MarketingPipelineRow[];
  features: readonly LandingFeatureRow[];
  plans: readonly LandingPlanCard[];
  faq: readonly FaqItem[];
}

export const LANDING_DATA_VARIANTS = ["demo", "worst", "empty", "one"] as const;
export type LandingDataVariant = (typeof LANDING_DATA_VARIANTS)[number];

/* ── Demo: the real registries, read exactly as the page used to read them ── */

const demoFeatures: readonly LandingFeatureRow[] = LANDING_FEATURE_KEYS.map(
  (key) => {
    const definition = RESOURCES[key];
    const entryPlan = getEntryPlanForResource(key);
    return {
      key,
      name: definition.name,
      description: definition.description,
      /* The " and up" is part of the SENTENCE the badge makes, not of the
         plan name — it used to live in the JSX template. It moves here with
         the rest of the gate resolution so a fixture states the badge
         exactly as it will render. */
      entryPlanName:
        entryPlan === null ? null : `${PLANS[entryPlan].name} and up`,
    };
  },
);

const demoPlans: readonly LandingPlanCard[] = PLAN_ORDER.filter(
  (plan) => PLANS[plan].showPlan,
).map((plan) => ({
  key: plan,
  name: PLANS[plan].name,
  description: PLANS[plan].description,
  monthlyAmount: PLANS[plan].monthlyAmount,
  trialDays: PLANS[plan].trialDays,
}));

export const DEMO_LANDING_DATA: LandingData = {
  appName: APP_NAME,
  currencySymbol: PLAN_PRICE_CURRENCY_SYMBOL,
  hero: HERO_COPY,
  formats: LANDING_FORMATS,
  formatArt: FORMAT_CARD_ART,
  proofClips: LANDING_PROOF_CLIPS,
  stepBlurbs: STEP_BLURBS,
  handled: HANDLED_FOR_YOU,
  features: demoFeatures,
  plans: demoPlans,
  faq: LANDING_FAQ,
};

/* ── Worst case ───────────────────────────────────────────────────────────
   Spread across rows rather than stacked into row 1, because that is how
   real data arrives: one long name here, one missing poster there. */

const WORST_LANDING_DATA: LandingData = {
  /* NEXT_PUBLIC_APP_NAME, no maximum. A rebrand or a white-label fork. It
     lands mid-sentence in the features subhead. */
  appName: "ShortformStudio by Northwind Media Group",

  /* NEXT_PUBLIC_PRICE_CURRENCY_SYMBOL, no maximum and not always one glyph:
     CHF, R$, kr and zł are all real, and several are written with a space. */
  currencySymbol: "CHF ",

  hero: {
    ...HERO_COPY,
    eyebrow: "AI video creation, without the telltale AI look or the slop",
    headlineBefore: "Create short-form content that people",
    headlineHighlight: "actually",
    headlineAfter: "want to watch all the way through",
    lead: "Turn any idea, script, URL, newsletter, podcast episode or document into genuinely high-quality short-form video — with the visuals, motion, voice, sound design, captions and editing all handled for you, in about a minute.",
    socialProof: "12,400+ creators · 38M views generated across 9 platforms",
    renderedBadge: "Rendered and ready to post in 41 seconds",
    showcaseFootnote: "They genuinely cannot stop scrolling this one",
  },

  formats: [
    {
      /* A label long enough to meet the SOON badge in the same row. */
      kind: "reddit-story",
      label: "Reddit stories & comment threads",
      description:
        "Paste a thread. The script is written from it, cast to a voice, captioned word by word and cut over background footage you never have to source.",
      comingSoon: true,
    },
    /* The short one, immediately after the long one — the pair is what shows
       whether the row aligns or just happens to look level. */
    { kind: "voiceover", label: "VO", description: "Topic in, cut out." },
    {
      kind: "quiz",
      label: "Quiz videos",
      description:
        "Trivia with countdowns and reveals, timed so the answer lands exactly when the beat does.",
      comingSoon: true,
    },
    {
      kind: "motion",
      label: "Motion explainers",
      description:
        "Animated explainer scenes built from motion primitives and a beat strip, designed rather than stitched.",
      comingSoon: true,
    },
  ],

  /* One format deliberately has no art: FORMAT_CARD_ART is Partial, and the
     page is supposed to fall back to a text-only card. */
  formatArt: {
    "reddit-story": FORMAT_CARD_ART["reddit-story"] ?? "",
    quiz: FORMAT_CARD_ART.quiz ?? "",
    motion: FORMAT_CARD_ART.motion ?? "",
  },

  proofClips: [
    {
      id: "worst-long-title",
      /* Two lines of title under a line-clamp-2, plus an hour-long runtime:
         a podcast re-cut is a real export, and "1:02:33" is wider than the
         "0:48" the caption row was measured against. */
      title:
        "The leftovers thread that went too far and then kept going for another nine replies",
      kind: "voiceover",
      duration: "1:02:33",
      poster: LANDING_PROOF_CLIPS[0]?.poster ?? "",
    },
    {
      id: "worst-missing-poster",
      /* poster undefined — the documented case for a deployment that has not
         supplied its own frames. */
      title: "No poster supplied by this deployment",
      kind: "quiz",
      duration: "0:31",
    },
    {
      id: "worst-broken-poster",
      /* Operator-supplied and off-domain, as proof-strip.tsx documents — so
         also the case where it 404s after the deployment moves its bucket. */
      title: "Poster URL that no longer resolves",
      kind: "motion",
      duration: "0:52",
      poster: "/auth-reels/this-file-was-deleted.png",
    },
    {
      id: "worst-short",
      title: "Ok",
      kind: "reddit-story",
      duration: "0:06",
      poster: LANDING_PROOF_CLIPS[3]?.poster ?? "",
    },
    {
      id: "worst-unbroken",
      /* A title with no space to break at — a handle, a slug, a filename. */
      title: "r/AmItheAsshole/comments/1d9x2kq/aita_for_labelling_every_egg",
      kind: "voiceover",
      duration: "0:44",
      poster: LANDING_PROOF_CLIPS[4]?.poster ?? "",
    },
  ],

  stepBlurbs: Object.fromEntries(
    PROJECT_FLOW_STEPS.map((step, index) => [
      step.key,
      index === 0
        ? "Paste a thread, type a topic, or bring your own draft — including one you exported from somewhere else — and you get a script you can rewrite line by line, or regenerate whole."
        : (STEP_BLURBS[step.key] ?? ""),
    ]),
  ),

  handled: [
    /* The label column is a fixed w-24 (96px). "Captions" fits; the words a
       pipeline actually uses do not always. */
    {
      label: "Script & beats",
      detail: "Written from your thread, topic or draft.",
    },
    { label: "Voice", detail: "Cast, recorded and mixed per speaker." },
    {
      label: "Captions & subtitles",
      detail:
        "Timed word by word against the recording, in the style you pick, including karaoke and single-word modes.",
    },
    {
      label: "Visuals",
      detail: "Backgrounds, footage and images chosen per scene.",
    },
    {
      label: "Sound",
      detail: "Levels balanced so narration sits over the bed.",
    },
    {
      label: "Render",
      detail: "Assembled and encoded vertical, ready to post.",
    },
    {
      label: "Editing",
      detail: "Yours to adjust — scenes, overlays and audio.",
    },
  ],

  features: demoFeatures.map((row, index) =>
    index === 0
      ? {
          ...row,
          name: "Premium voice catalogue",
          description:
            "Assign the full voice catalogue to your speakers, including the cloned ones, and hear the read before anything is rendered.",
          /* The badge text is a PLAN NAME, so renaming a plan rewrites it. */
          entryPlanName: "Professional (Team) and up",
        }
      : index === 1
        ? { ...row, name: "Captions", description: "Styled, timed, done." }
        : row,
  ),

  plans: [
    {
      key: "free",
      name: "Free",
      description: "Everything you need to try things out.",
      monthlyAmount: 0,
      /* A 1-day trial: the one count on this page that could read "1 days". */
      trialDays: 1,
    },
    {
      key: "starter",
      name: "Starter",
      description: "For a small team getting off the ground.",
      monthlyAmount: 19,
      trialDays: 14,
    },
    {
      key: "pro",
      /* Renamed tiers are an explicit feature of the plan config. */
      name: "Professional (Team)",
      description:
        "For teams that need room to grow, with seats for everyone who touches a render and the limits to match.",
      monthlyAmount: 149,
      trialDays: 14,
    },
    {
      key: "enterprise",
      name: "Enterprise & Custom Deployments",
      description: "Unlimited scale with everything included.",
      /* Four figures, where the layout was measured against two and three.
         No thousands separator is applied anywhere on this page. */
      monthlyAmount: 1299,
      trialDays: 90,
    },
  ],

  faq: [
    {
      id: "worst-long-question",
      question:
        "What happens if I paste a thread that has already been turned into a video by somebody else?",
      answer:
        "You give it a thread, a topic or your own script. It writes the script, casts and records the narration, times the captions against that recording, assembles the scenes and renders a finished vertical video you can download and post.",
    },
    {
      id: "worst-unbroken-answer",
      question: "Where do I read the API docs?",
      /* An answer containing a URL — no break opportunities in the string. */
      answer:
        "Everything is documented at https://docs.shortformstudio-by-northwind-media-group.example.com/reference/rendering/webhooks and mirrored in the MCP server description.",
    },
    ...LANDING_FAQ.slice(2),
  ],
};

/* ── Empty and One ───────────────────────────────────────────────────────
   Not hypothetical: `showPlan` is env-driven per tier, so a deployment that
   sells one tier renders one card, and one that sells none renders zero. */

const EMPTY_LANDING_DATA: LandingData = {
  ...DEMO_LANDING_DATA,
  formats: [],
  proofClips: [],
  features: [],
  plans: [],
  faq: [],
};

const ONE_LANDING_DATA: LandingData = {
  ...DEMO_LANDING_DATA,
  formats: DEMO_LANDING_DATA.formats.slice(0, 1),
  proofClips: DEMO_LANDING_DATA.proofClips.slice(0, 1),
  features: DEMO_LANDING_DATA.features.slice(0, 1),
  plans: DEMO_LANDING_DATA.plans.slice(2, 3),
  faq: DEMO_LANDING_DATA.faq.slice(0, 1),
};

const BY_VARIANT: Record<LandingDataVariant, LandingData> = {
  demo: DEMO_LANDING_DATA,
  worst: WORST_LANDING_DATA,
  empty: EMPTY_LANDING_DATA,
  one: ONE_LANDING_DATA,
};

export function isLandingDataVariant(
  value: string | undefined,
): value is LandingDataVariant {
  return LANDING_DATA_VARIANTS.includes(value as LandingDataVariant);
}

export function resolveLandingData(variant: string | undefined): {
  variant: LandingDataVariant;
  data: LandingData;
} {
  const key = isLandingDataVariant(variant) ? variant : "demo";
  return { variant: key, data: BY_VARIANT[key] };
}
