/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LANDING_FORMATS, LANDING_FAQ, LANDING_PROOF_CLIPS,
 *   HANDLED_FOR_YOU, STEP_BLURBS,
 *   LANDING_FEATURE_KEYS, PAGE_OWNED_COPY, COPY_IS_REGISTRY_DERIVED,
 *   MarketingFormat, FaqItem, MarketingProofClip, ResourceKey
 *
 * WHAT:  The landing page's hand-written content — the format cards, the
 *        proof strip, the FAQ, and which registry features the page puts in
 *        front of a visitor.
 *
 * WHY:   PAGE_OWNED_COPY, held apart from the page that renders it so the
 *        markup stays readable and so a copy change is a diff a non-engineer
 *        can follow. Everything here that the product already defines is
 *        REFERENCED rather than restated: `kind` is `ProjectKind`, so a
 *        retired format breaks the build (A_FORMAT_IS_A_PROJECT_KIND), and
 *        `LANDING_FEATURE_KEYS` is `readonly ResourceKey[]`, so a retired
 *        resource does too — the names and blurbs in the feature grid are read
 *        from `RESOURCES` at render time (COPY_IS_REGISTRY_DERIVED).
 *
 *        What is left is the part no registry can own: the words that persuade.
 *        An FAQ answer about credits or watermarks is a PROMISE, so it lives in
 *        one reviewable file rather than scattered through JSX — and when the
 *        promise changes, this is the file to grep.
 *
 *        Plain data, no "use client": a Server Component renders the sections
 *        and only the FAQ's open/closed state is a client fact, so nothing
 *        here is shipped to the browser twice.
 * WHERE: src/app/(marketing)/page.tsx and the _components beside it.
 */

import type {
  FaqItem,
  MarketingFormat,
  MarketingPipelineRow,
  MarketingProofClip,
} from "@/lib/types";
import type { ResourceKey } from "@/lib/resources";

/**
 * SOURCE OF TRUTH KEYWORDS: LANDING_FORMATS, CREATABLE_PROJECT_KINDS
 *
 * WHAT:  The four formats, in the order the page shows them.
 * WHY:   `satisfies` keeps the `kind` values checked against `ProjectKind`
 *        while leaving the array literal readonly and exhaustively typed.
 *        `motion` carries `comingSoon` because it is the one kind outside
 *        `CREATABLE_PROJECT_KINDS` — it is shown, because the studio is real
 *        and shipped, but not sold as something to start today.
 * WHERE: The format section of the landing page.
 */
export const LANDING_FORMATS = [
  {
    kind: "reddit-story",
    label: "Reddit stories",
    description:
      "Paste a thread. The script is written from it, cast to a voice, captioned word by word and cut over background footage.",
  },
  {
    kind: "voiceover",
    label: "Voiceover videos",
    description:
      "Start from a topic or your own script. Narration, visuals and captions are assembled into one vertical cut.",
  },
  {
    kind: "quiz",
    label: "Quiz videos",
    description:
      "Trivia with countdowns and reveals, timed so the answer lands exactly when the beat does.",
  },
  {
    kind: "motion",
    label: "Motion explainers",
    description:
      "Animated explainer scenes built from motion primitives and a beat strip, designed rather than stitched.",
    comingSoon: true,
  },
] as const satisfies readonly MarketingFormat[];

/**
 * SOURCE OF TRUTH KEYWORDS: LANDING_FEATURE_KEYS, ResourceKey, RESOURCES,
 *   COPY_IS_REGISTRY_DERIVED
 *
 * WHAT:  Which registry entries the landing page advertises, in order.
 * WHY:   A CURATION, not a second definition — the names and one-line
 *        descriptions still come from `RESOURCES`, so this list can only
 *        choose between things the product actually gates, and a renamed or
 *        retired resource fails the typecheck instead of shipping an advert
 *        for a feature nobody can reach. Entries whose registry description is
 *        quota-phrased ("… per month") are left out: that sentence is written
 *        for a usage meter, not for somebody deciding whether to sign up.
 * WHERE: The feature grid of the landing page.
 */
export const LANDING_FEATURE_KEYS: readonly ResourceKey[] = [
  "premiumVoices",
  "captionStyles",
  "timelineEditor",
  "motionStudio",
  "backgroundLibrary",
  "avatars",
  "watermarkFree",
  "apiAccess",
];

/**
 * SOURCE OF TRUTH KEYWORDS: LANDING_PROOF_CLIPS, PRODUCT_AS_PROOF
 *
 * WHAT:  The 9:16 samples in the strip under the hero.
 * WHY:   PRODUCT_AS_PROOF — the page's only imagery is output, so each tile
 *        names the format that made it and how long it runs. No `poster` is
 *        set: a fresh deployment has rendered nothing yet, and the tile paints
 *        its format tag over an empty frame rather than linking a 404. An
 *        operator with real renders adds the URLs here, in one place, and the
 *        strip starts showing them.
 * WHERE: src/app/(marketing)/_components/proof-strip.tsx.
 */
export const LANDING_PROOF_CLIPS: readonly MarketingProofClip[] = [
  {
    id: "proof-reddit",
    title: "The one where nobody told the new hire",
    kind: "reddit-story",
    duration: "0:48",
  },
  {
    id: "proof-voiceover",
    title: "Why planes still have ashtrays",
    kind: "voiceover",
    duration: "0:36",
  },
  {
    id: "proof-quiz",
    title: "Guess the capital in 3 seconds",
    kind: "quiz",
    duration: "0:31",
  },
  {
    id: "proof-motion",
    title: "How a heat pump actually works",
    kind: "motion",
    duration: "0:52",
  },
  {
    id: "proof-voiceover-2",
    title: "The shipping container that changed trade",
    kind: "voiceover",
    duration: "0:44",
  },
];

/**
 * SOURCE OF TRUTH KEYWORDS: LANDING_FAQ, FaqItem, LEGAL_IS_NOT_OPTIONAL
 *
 * WHAT:  The questions a visitor asks before signing up, and the answers.
 * WHY:   Every answer here is a PROMISE the product has to keep, so they are
 *        written where they can be reviewed as a set rather than buried in
 *        JSX. The credit, watermark, ownership and moderation answers are
 *        deliberately phrased to match what the app enforces — the gates, the
 *        credit holds and the takedown route — not what would read best.
 *        `id` is stable so an answer stays deep-linkable through a rewording.
 * WHERE: Rendered by <FaqAccordion> on the landing page.
 */
export const LANDING_FAQ: readonly FaqItem[] = [
  {
    id: "faq-what-it-does",
    question: "What does it actually do?",
    answer:
      "You give it a thread, a topic or your own script. It writes the script, casts and records the narration, times the captions against that recording, assembles the scenes and renders a finished vertical video you can download and post.",
  },
  {
    id: "faq-how-long",
    question: "How long does one video take?",
    answer:
      "Minutes, not hours. Each stage reports progress as it runs, so you can watch the script, the narration and the render land one after another instead of staring at a spinner.",
  },
  {
    id: "faq-credits",
    question: "How does billing work?",
    answer:
      "Your plan sets what your workspace can hold and reach; credits are what generating and rendering consume. A run takes a hold up front and settles against what it actually used, so a failed run does not quietly spend your balance.",
  },
  {
    id: "faq-edit",
    question: "Can I change the result?",
    answer:
      "Yes. Every stage is editable before the next one runs — rewrite a line, recast a speaker, retime a caption — and the timeline editor lets you move scenes, overlays and audio by hand once the pipeline has done the heavy work.",
  },
  {
    id: "faq-watermark",
    question: "Is there a watermark?",
    answer:
      "Watermark-free export is a plan feature. The pricing page lists exactly which plans include it, read from the same registry the export itself checks, so the page cannot promise something the product refuses.",
  },
  {
    id: "faq-ownership",
    question: "Who owns the videos?",
    answer:
      "You do. What you upload stays yours, and what the pipeline makes from it is yours to post, monetise and delete. The terms spell out the narrow exceptions, and anything generated here can be reported through the takedown route.",
  },
  {
    id: "faq-team",
    question: "Can my team work in the same account?",
    answer:
      "Yes — a workspace holds members with roles and permissions, shared media and shared projects, so a writer, an editor and a poster can each do their part without passing one login around.",
  },
  {
    id: "faq-api",
    question: "Is there an API?",
    answer:
      "There is a REST API and an MCP server, so your own tooling or an AI agent can start projects, poll a run and collect the finished file. API access and keys are plan-gated; the reference documents every endpoint.",
  },
];

/**
 * SOURCE OF TRUTH KEYWORDS: HANDLED_FOR_YOU, MarketingPipelineRow,
 *   WHAT_YOU_DONT_HAVE_TO_DO, PIPELINE_STAGES
 *
 * WHAT:  The jobs the pipeline does so the customer does not — the list beside
 *        the walkthrough on the landing page.
 * WHY:   The steps (PROJECT_FLOW_STEPS) say what a customer TOUCHES; this says
 *        what happens without them, which is the actual product. Kept as
 *        separate rows rather than a paragraph so a stage that stops being
 *        automatic has to be deleted from a list somebody reviews. The rows
 *        track the real stages the run moves through, in order.
 * WHERE: The "handled for you" card on the landing page.
 */
export const HANDLED_FOR_YOU: readonly MarketingPipelineRow[] = [
  { label: "Script", detail: "Written from your thread, topic or draft." },
  { label: "Voice", detail: "Cast, recorded and mixed per speaker." },
  { label: "Captions", detail: "Timed word by word against the recording." },
  { label: "Visuals", detail: "Backgrounds, footage and images chosen per scene." },
  { label: "Sound", detail: "Levels balanced so narration sits over the bed." },
  { label: "Render", detail: "Assembled and encoded vertical, ready to post." },
  { label: "Editing", detail: "Yours to adjust — scenes, overlays and audio." },
];

/**
 * SOURCE OF TRUTH KEYWORDS: STEP_BLURBS, PROJECT_FLOW_STEPS, ProjectStepKey,
 *   THE_FLOW_IS_AN_ORDER, PAGE_OWNED_COPY
 *
 * WHAT:  One selling sentence per walkthrough step, keyed by the step's own
 *        `key` from PROJECT_FLOW_STEPS.
 * WHY:   The step LABELS and their ORDER stay in the registry — this page
 *        renders the same list the in-app project nav does — but a nav tab
 *        reads "Voices" and a landing page has to say what that means to
 *        somebody who has never seen the product. Keyed by `key` rather than
 *        held as a parallel array so reordering the flow cannot silently shift
 *        every description by one, which is the failure a positional list has.
 *        A step with no entry simply renders without a blurb: a new stage
 *        should appear on the page the day it ships, not wait for copy.
 * WHERE: The walkthrough on src/app/(marketing)/page.tsx.
 */
export const STEP_BLURBS: Readonly<Record<string, string>> = {
  script: "Paste a thread, type a topic, or bring your own draft. You get a script you can rewrite line by line.",
  voices: "Cast a voice per speaker from the catalogue and hear the read before anything is rendered.",
  captions:
    "Captions are timed against the recorded narration, word by word, in the style you pick.",
  generate:
    "One run assembles the scenes, the visuals, the audio mix and the encode, reporting each stage as it lands.",
  preview: "Watch the finished cut in the browser before it leaves the workspace.",
  edit: "Move scenes, overlays and audio by hand when you want the last ten percent your way.",
};
