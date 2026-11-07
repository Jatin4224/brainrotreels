/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: marketing _components barrel, MarketingHeader,
 *   MarketingFooter, HeroPromptCard, ReelPhone, ReelStage, ProofStrip,
 *   LANDING_FORMATS, LANDING_FAQ,
 *   LANDING_PROOF_CLIPS, LANDING_FEATURE_KEYS, HANDLED_FOR_YOU, STEP_BLURBS,
 *   HERO_COPY
 *
 * WHAT:  Public surface of the `(marketing)` route group's own components and
 *        page-owned content.
 * WHY:   One import in the layout and the landing page instead of four, and
 *        the one place that says which of these are meant to be used from
 *        outside the folder. Route-local on purpose: nothing here is reusable
 *        across the app (the FAQ widget that IS lives in
 *        @/components/global/faq-accordion), so it stays beside the pages it
 *        serves rather than widening components/global with marketing copy.
 * WHERE: Imported as './_components' / '../_components' by
 *        src/app/(marketing)/layout.tsx and src/app/(marketing)/page.tsx.
 */

export { MarketingHeader } from "./marketing-header";
export { MarketingFooter } from "./marketing-footer";
export { HeroPromptCard } from "./hero-prompt-card";
export { ReelPhone, type ReelPhoneProps } from "./reel-phone";
export { ReelStage, type ReelStageProps } from "./reel-stage";
export { ProofStrip, type ProofStripProps } from "./proof-strip";
export {
  HANDLED_FOR_YOU,
  HERO_COPY,
  LANDING_FAQ,
  LANDING_FEATURE_KEYS,
  LANDING_FORMATS,
  LANDING_PROOF_CLIPS,
  LANDING_REELS,
  STEP_BLURBS,
} from "./landing-content";
